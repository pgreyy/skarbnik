//! Loads and runs one WebAssembly module inside the wasmi interpreter, with strict limits.
//!
//! Loading checks the module once: size, that it parses and validates, that it imports nothing
//! (so it cannot call out to the host), that it has the expected exports, and that its memory is
//! small. Running gives every input a brand new instance with a fixed fuel budget (fuel counts
//! executed instructions, so an endless loop stops), a memory cap and a call depth cap. A fresh
//! instance per input means a module cannot remember anything between inputs.
//!
//! The module's interface (ABI):
//!   memory              its linear memory, at most `max_memory_pages` pages of 64 KiB
//!   input_buf() -> i32  address where the harness writes the input bytes
//!   parse(len) -> i32   the answer for the first `len` bytes at that address

use wasmi::{
    CompilationMode, Config, Engine, ExternType, Linker, Module, ResourceLimiter, Store,
    StoreLimits, StoreLimitsBuilder, TrapCode, ValType,
};

/// Optional cycle profile, used by the zkVM guest to see where its cycles go. Nothing is measured
/// unless a clock is set with `set_clock`, so the native checker and normal proofs are unaffected.
/// Phases: `LOAD` (parse, validate, compile and trial instance of a module), `SETUP` (fresh store and
/// instance per input, writing the input), `RUN` (the patch's `parse` call).
pub mod profile {
    use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
    use std::sync::OnceLock;

    static CLOCK: OnceLock<fn() -> u64> = OnceLock::new();
    pub static LOAD: AtomicU64 = AtomicU64::new(0);
    pub static SETUP: AtomicU64 = AtomicU64::new(0);
    pub static RUN: AtomicU64 = AtomicU64::new(0);

    /// Sets the clock (in the guest: the zkVM cycle counter). Can be set once.
    pub fn set_clock(clock: fn() -> u64) {
        let _ = CLOCK.set(clock);
    }

    pub(crate) fn now() -> Option<u64> {
        CLOCK.get().map(|clock| clock())
    }

    pub(crate) fn add(counter: &AtomicU64, start: Option<u64>) {
        if let (Some(start), Some(end)) = (start, now()) {
            counter.fetch_add(end.saturating_sub(start), Relaxed);
        }
    }

    /// Cycles spent so far in each phase.
    pub fn totals() -> (u64, u64, u64) {
        (LOAD.load(Relaxed), SETUP.load(Relaxed), RUN.load(Relaxed))
    }
}

/// Every limit the checker enforces. The same values must be used for the candidate and the
/// original, and they are part of what a verdict means.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Limits {
    /// Largest accepted module, in bytes.
    pub max_module_bytes: usize,
    /// Largest memory, in 64 KiB pages, both declared and after growing.
    pub max_memory_pages: u64,
    /// Largest number of table elements.
    pub max_table_elements: usize,
    /// Fuel (roughly, executed instructions) for one input, including instantiation.
    pub fuel_per_run: u64,
    /// Deepest call stack.
    pub max_call_depth: usize,
    /// Longest input the harness will pass.
    pub max_input_len: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_module_bytes: 2048,
            max_memory_pages: 2,
            max_table_elements: 64,
            fuel_per_run: 50_000,
            max_call_depth: 64,
            max_input_len: 256,
        }
    }
}

/// What happened when a module ran on one input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// `parse` returned this value.
    Returned(i32),
    /// The run crashed. `out_of_fuel` is true when it was stopped for running too long.
    Trapped { out_of_fuel: bool, detail: String },
}

impl Outcome {
    pub fn is_trap(&self) -> bool {
        matches!(self, Outcome::Trapped { .. })
    }
}

/// One run: the outcome and how much fuel it used.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunResult {
    pub outcome: Outcome,
    pub fuel_used: u64,
}

/// Why a module was refused before it ran.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadError {
    TooLarge { bytes: usize, max: usize },
    DoesNotParse(String),
    HasImports(usize),
    MissingExport(&'static str),
    WrongExportType(&'static str),
    MemoryTooLarge { pages: u64, max: u64 },
    CannotInstantiate(String),
}

/// A module that passed the load checks and can be run on inputs.
pub struct Loaded {
    engine: Engine,
    module: Module,
    limits: Limits,
}

fn store_limits(limits: &Limits) -> StoreLimits {
    StoreLimitsBuilder::new()
        .memory_size(limits.max_memory_pages as usize * 65_536)
        .table_elements(limits.max_table_elements)
        .instances(1)
        .memories(1)
        .tables(1)
        .trap_on_grow_failure(true)
        .build()
}

fn trap_outcome(err: &wasmi::Error) -> Outcome {
    Outcome::Trapped {
        out_of_fuel: err.as_trap_code() == Some(TrapCode::OutOfFuel),
        detail: format!("{err}"),
    }
}

fn is_func(ty: Option<ExternType>, params: &[ValType], results: &[ValType]) -> Option<bool> {
    match ty? {
        ExternType::Func(f) => Some(f.params() == params && f.results() == results),
        _ => Some(false),
    }
}

impl Loaded {
    /// Runs every load check. On success the module is ready to run.
    pub fn load(bytes: &[u8], limits: &Limits) -> Result<Loaded, LoadError> {
        let started = profile::now();
        let result = Self::load_inner(bytes, limits);
        profile::add(&profile::LOAD, started);
        result
    }

    fn load_inner(bytes: &[u8], limits: &Limits) -> Result<Loaded, LoadError> {
        if bytes.len() > limits.max_module_bytes {
            return Err(LoadError::TooLarge { bytes: bytes.len(), max: limits.max_module_bytes });
        }
        let mut config = Config::default();
        config
            .consume_fuel(true)
            .floats(false)
            .wasm_multi_memory(false)
            .allow_start_fn(false)
            .compilation_mode(CompilationMode::Eager)
            .set_max_recursion_depth(limits.max_call_depth);
        let engine = Engine::new(&config);
        let module =
            Module::new(&engine, bytes).map_err(|e| LoadError::DoesNotParse(format!("{e}")))?;

        let imports = module.imports().count();
        if imports > 0 {
            return Err(LoadError::HasImports(imports));
        }
        match module.get_export("memory") {
            Some(ExternType::Memory(m)) => {
                if m.minimum() > limits.max_memory_pages {
                    return Err(LoadError::MemoryTooLarge {
                        pages: m.minimum(),
                        max: limits.max_memory_pages,
                    });
                }
            }
            Some(_) => return Err(LoadError::WrongExportType("memory")),
            None => return Err(LoadError::MissingExport("memory")),
        }
        match is_func(module.get_export("input_buf"), &[], &[ValType::I32]) {
            None => return Err(LoadError::MissingExport("input_buf")),
            Some(false) => return Err(LoadError::WrongExportType("input_buf")),
            Some(true) => {}
        }
        match is_func(module.get_export("parse"), &[ValType::I32], &[ValType::I32]) {
            None => return Err(LoadError::MissingExport("parse")),
            Some(false) => return Err(LoadError::WrongExportType("parse")),
            Some(true) => {}
        }

        let loaded = Loaded { engine, module, limits: limits.clone() };
        // One trial instantiation catches problems that only show up then (for example a memory
        // or table above the store limits, or a data segment out of range).
        let mut store = loaded.new_store();
        Linker::<StoreLimits>::new(&loaded.engine)
            .instantiate_and_start(&mut store, &loaded.module)
            .map_err(|e| LoadError::CannotInstantiate(format!("{e}")))?;
        Ok(loaded)
    }

    fn new_store(&self) -> Store<StoreLimits> {
        let mut store = Store::new(&self.engine, store_limits(&self.limits));
        store.limiter(|l| l as &mut dyn ResourceLimiter);
        store.set_fuel(self.limits.fuel_per_run).expect("fuel metering is enabled");
        store
    }

    /// Runs the module on one input in a fresh instance.
    pub fn run(&self, input: &[u8]) -> RunResult {
        let started = profile::now();
        let mut store = self.new_store();
        let outcome = self.run_in(&mut store, input, started);
        let left = store.get_fuel().unwrap_or(0);
        RunResult { outcome, fuel_used: self.limits.fuel_per_run.saturating_sub(left) }
    }

    fn run_in(&self, store: &mut Store<StoreLimits>, input: &[u8], setup_started: Option<u64>) -> Outcome {
        if input.len() > self.limits.max_input_len {
            return Outcome::Trapped { out_of_fuel: false, detail: "input too long".into() };
        }
        let linker = Linker::<StoreLimits>::new(&self.engine);
        let instance = match linker.instantiate_and_start(&mut *store, &self.module) {
            Ok(i) => i,
            Err(e) => return trap_outcome(&e),
        };
        let (Ok(input_buf), Ok(parse), Some(memory)) = (
            instance.get_typed_func::<(), i32>(&*store, "input_buf"),
            instance.get_typed_func::<i32, i32>(&*store, "parse"),
            instance.get_memory(&*store, "memory"),
        ) else {
            return Outcome::Trapped { out_of_fuel: false, detail: "exports missing".into() };
        };
        let ptr = match input_buf.call(&mut *store, ()) {
            Ok(p) => p as u32 as usize,
            Err(e) => return trap_outcome(&e),
        };
        if memory.write(&mut *store, ptr, input).is_err() {
            return Outcome::Trapped {
                out_of_fuel: false,
                detail: "input buffer is outside memory".into(),
            };
        }
        profile::add(&profile::SETUP, setup_started);
        let run_started = profile::now();
        let outcome = match parse.call(&mut *store, input.len() as i32) {
            Ok(v) => Outcome::Returned(v),
            Err(e) => trap_outcome(&e),
        };
        profile::add(&profile::RUN, run_started);
        outcome
    }
}
