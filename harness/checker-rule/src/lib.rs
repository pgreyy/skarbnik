//! The rule checker: decides PASS or FAIL for a patch to a program whose bug is judged by a public rule, not by one
//! exact answer. Two kinds of bug share it:
//!   A, property bugs (injection, path traversal): many correct fixes give different outputs, so each output must obey
//!      the vendor's public safety rule. The secret is one call.
//!   B, access control bugs (missing authorization, IDOR): the bug shows only after a series of calls on a program that
//!      keeps state between calls. The secret is a call sequence.
//!
//! The program's interface: `memory`; `input_buf() -> i32` (where the harness writes a call's argument bytes);
//! `output_buf() -> i32` (where the program leaves its output bytes); `call(op, len) -> i32` (runs operation `op` on the
//! first `len` argument bytes and returns the output's length, or a negative code with no output); and optionally
//! `init()`, run once before the first call. One run is a fresh instance, `init`, then the calls in order; memory
//! persists across the calls of one run and never between runs.
//!
//! The rule module, public, its sha256 bound into the corpus hash: `memory`, `rule_buf() -> i32` and
//! `check(len) -> i32`; the harness writes the transcript (every call and its result, see `rule_bytes`) at `rule_buf`
//! and `check` returns 0 for ok and anything else for a violation.
//!
//! The steps, in order (the first one that fails decides the verdict):
//! 1. Validate: the candidate loads under the limits.
//! 2. Secret: on the secret call sequence it does not trap, and the rule says ok.
//! 3. Public tests: on each public test sequence its results are exactly the expected ones.
//! 4. Fairness: on `fuzz_count` mutations of the public tests, it does not trap where the reference fix does not, the
//!    rule says ok, and where the original and the reference fix give the same results (a benign sequence), it gives
//!    them too. So a fix that returns nothing, denies everything or breaks normal use fails here.
//! 5. Variants: on `variant_count` changed copies of the secret (argument bytes such as users and ids changed, a byte
//!    inserted or deleted, two calls swapped, a call repeated or dropped) it does not trap and the rule says ok.
//! 6. Sweep: at up to 4 private byte positions of the secret, every value 0 to 255: no trap, and the rule says ok.
//!
//! Proof 0: the secret decodes, the original does not trap on it and the rule says violation (it is really buggy),
//! the original gives its own public tests' results, and the reference fix passes the full check.

use kintsugi_check::gen::Rng;
use kintsugi_check::{Round, Verdict};
use wasmi::{
    CompilationMode, Config, Engine, ExternType, Linker, Module, ResourceLimiter, Store, StoreLimits,
    StoreLimitsBuilder, TrapCode, ValType,
};

/// Domain tags, so a record or corpus of this checker can never be read as another checker's.
pub const RECORD_DOMAIN: &[u8] = b"skarbnik-rule-v1";
pub const CORPUS_DOMAIN: &[u8] = b"skarbnik-rule-corpus-v1";
pub const MAX_SWEEP_POSITIONS: usize = 4;
const FAIRNESS_DOMAIN: u64 = 0x736b_7275_6c65_3031; // "skrule01"
const VARIANT_DOMAIN: u64 = 0x736b_7275_6c65_3032; // "skrule02"

// ---------------------------------------------------------------- call sequences and transcripts

/// One call: an operation number and its argument bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Call {
    pub op: u8,
    pub args: Vec<u8>,
}

/// A call sequence as bytes: for each call, the op (1 byte), the argument length (1 byte), the arguments.
pub fn encode(calls: &[Call]) -> Vec<u8> {
    let mut out = Vec::new();
    for c in calls {
        out.push(c.op);
        out.push(c.args.len().min(255) as u8);
        out.extend_from_slice(&c.args[..c.args.len().min(255)]);
    }
    out
}

/// Reads a call sequence; None when the bytes are not a whole number of calls.
pub fn decode(bytes: &[u8]) -> Option<Vec<Call>> {
    let (mut i, mut out) = (0, Vec::new());
    while i < bytes.len() {
        let op = bytes[i];
        let n = *bytes.get(i + 1)? as usize;
        let args = bytes.get(i + 2..i + 2 + n)?.to_vec();
        out.push(Call { op, args });
        i += 2 + n;
    }
    Some(out)
}

/// What one call gave: a return code (a length when it is 0 or more) and the output bytes, or a trap.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Result1 {
    Returned { code: i32, output: Vec<u8> },
    Trapped { out_of_fuel: bool },
}

/// The results of a run, one per call; a trap ends the run, so the last entry may be the trap.
pub type Transcript = Vec<Result1>;

pub fn trapped(t: &Transcript) -> bool {
    t.iter().any(|r| matches!(r, Result1::Trapped { .. }))
}

/// A transcript as bytes (public tests store it): for each result, a status byte (0 returned, 1 trapped, 2 out of
/// fuel), the code (i32 little endian), the output length (u16 little endian) and the output.
pub fn encode_transcript(t: &Transcript) -> Vec<u8> {
    let mut out = Vec::new();
    for r in t {
        let (status, code, output): (u8, i32, &[u8]) = match r {
            Result1::Returned { code, output } => (0, *code, output),
            Result1::Trapped { out_of_fuel } => (if *out_of_fuel { 2 } else { 1 }, 0, &[]),
        };
        out.push(status);
        out.extend_from_slice(&code.to_le_bytes());
        out.extend_from_slice(&(output.len() as u16).to_le_bytes());
        out.extend_from_slice(output);
    }
    out
}

// ---------------------------------------------------------------- limits and loading

/// Every limit the rule checker enforces; part of what a verdict means.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Limits {
    pub max_module_bytes: usize,
    pub max_rule_bytes: usize,
    pub max_memory_pages: u64,
    pub max_rule_memory_pages: u64,
    pub max_table_elements: usize,
    pub fuel_per_call: u64,
    pub rule_fuel: u64,
    pub max_call_depth: usize,
    pub max_calls: usize,
    pub max_sequence_bytes: usize,
    pub max_output: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_module_bytes: 2048,
            max_rule_bytes: 4096,
            max_memory_pages: 2,
            max_rule_memory_pages: 4,
            max_table_elements: 64,
            fuel_per_call: 50_000,
            rule_fuel: 2_000_000,
            max_call_depth: 64,
            max_calls: 64,
            max_sequence_bytes: 1024,
            max_output: 1024,
        }
    }
}

/// Why a module was refused before it ran.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadError {
    TooLarge(usize),
    DoesNotParse(String),
    HasImports(usize),
    MissingExport(&'static str),
    WrongExportType(&'static str),
    MemoryTooLarge(u64),
    CannotInstantiate(String),
}

fn is_func(ty: Option<ExternType>, params: &[ValType], results: &[ValType]) -> Option<bool> {
    match ty? {
        ExternType::Func(f) => Some(f.params() == params && f.results() == results),
        _ => Some(false),
    }
}

/// A module that passed the load checks: a program (call interface) or a rule (check interface).
pub struct Loaded {
    engine: Engine,
    module: Module,
    pages: u64,
    tables: usize,
    has_init: bool,
}

fn store(engine: &Engine, pages: u64, tables: usize, fuel: u64) -> Store<StoreLimits> {
    let limits = StoreLimitsBuilder::new()
        .memory_size(pages as usize * 65_536)
        .table_elements(tables)
        .instances(1)
        .memories(1)
        .tables(1)
        .trap_on_grow_failure(true)
        .build();
    let mut s = Store::new(engine, limits);
    s.limiter(|l| l as &mut dyn ResourceLimiter);
    s.set_fuel(fuel).expect("fuel metering is enabled");
    s
}

fn load(bytes: &[u8], max_bytes: usize, pages: u64, limits: &Limits, exports: &[(&'static str, &[ValType], &[ValType])]) -> Result<Loaded, LoadError> {
    if bytes.len() > max_bytes {
        return Err(LoadError::TooLarge(bytes.len()));
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
    let module = Module::new(&engine, bytes).map_err(|e| LoadError::DoesNotParse(format!("{e}")))?;
    let imports = module.imports().count();
    if imports > 0 {
        return Err(LoadError::HasImports(imports));
    }
    match module.get_export("memory") {
        Some(ExternType::Memory(m)) if m.minimum() > pages => return Err(LoadError::MemoryTooLarge(m.minimum())),
        Some(ExternType::Memory(_)) => {}
        Some(_) => return Err(LoadError::WrongExportType("memory")),
        None => return Err(LoadError::MissingExport("memory")),
    }
    for (name, params, results) in exports {
        match is_func(module.get_export(name), params, results) {
            None => return Err(LoadError::MissingExport(name)),
            Some(false) => return Err(LoadError::WrongExportType(name)),
            Some(true) => {}
        }
    }
    let has_init = match is_func(module.get_export("init"), &[], &[]) {
        None => false,
        Some(true) => true,
        Some(false) => return Err(LoadError::WrongExportType("init")),
    };
    let loaded = Loaded { engine, module, pages, tables: limits.max_table_elements, has_init };
    let mut s = store(&loaded.engine, pages, loaded.tables, limits.fuel_per_call);
    Linker::<StoreLimits>::new(&loaded.engine)
        .instantiate_and_start(&mut s, &loaded.module)
        .map_err(|e| LoadError::CannotInstantiate(format!("{e}")))?;
    Ok(loaded)
}

fn trap(e: &wasmi::Error) -> Result1 {
    Result1::Trapped { out_of_fuel: e.as_trap_code() == Some(TrapCode::OutOfFuel) }
}

impl Loaded {
    /// Loads a program: `memory`, `input_buf`, `output_buf`, `call(op, len)`, and optionally `init`.
    pub fn program(bytes: &[u8], limits: &Limits) -> Result<Loaded, LoadError> {
        load(bytes, limits.max_module_bytes, limits.max_memory_pages, limits, &[
            ("input_buf", &[], &[ValType::I32]),
            ("output_buf", &[], &[ValType::I32]),
            ("call", &[ValType::I32, ValType::I32], &[ValType::I32]),
        ])
    }

    /// Loads a rule: `memory`, `rule_buf`, `check(len)`.
    pub fn rule(bytes: &[u8], limits: &Limits) -> Result<Loaded, LoadError> {
        load(bytes, limits.max_rule_bytes, limits.max_rule_memory_pages, limits, &[
            ("rule_buf", &[], &[ValType::I32]),
            ("check", &[ValType::I32], &[ValType::I32]),
        ])
    }

    /// Runs a call sequence in a fresh instance: `init`, then every call, each with its own fuel. A trap ends the run.
    pub fn run(&self, calls: &[Call], limits: &Limits) -> Transcript {
        let mut out = Vec::new();
        let mut s = store(&self.engine, self.pages, self.tables, limits.fuel_per_call);
        let instance = match Linker::<StoreLimits>::new(&self.engine).instantiate_and_start(&mut s, &self.module) {
            Ok(i) => i,
            Err(e) => return vec![trap(&e)],
        };
        let (Ok(input_buf), Ok(output_buf), Ok(call), Some(memory)) = (
            instance.get_typed_func::<(), i32>(&s, "input_buf"),
            instance.get_typed_func::<(), i32>(&s, "output_buf"),
            instance.get_typed_func::<(i32, i32), i32>(&s, "call"),
            instance.get_memory(&s, "memory"),
        ) else {
            return vec![Result1::Trapped { out_of_fuel: false }];
        };
        if self.has_init {
            if let Ok(init) = instance.get_typed_func::<(), ()>(&s, "init") {
                if let Err(e) = init.call(&mut s, ()) {
                    return vec![trap(&e)];
                }
            }
        }
        for c in calls.iter().take(limits.max_calls) {
            s.set_fuel(limits.fuel_per_call).expect("fuel metering is enabled");
            let ptr = match input_buf.call(&mut s, ()) {
                Ok(p) => p as u32 as usize,
                Err(e) => {
                    out.push(trap(&e));
                    return out;
                }
            };
            if memory.write(&mut s, ptr, &c.args).is_err() {
                out.push(Result1::Trapped { out_of_fuel: false });
                return out;
            }
            let code = match call.call(&mut s, (c.op as i32, c.args.len() as i32)) {
                Ok(v) => v,
                Err(e) => {
                    out.push(trap(&e));
                    return out;
                }
            };
            let mut output = Vec::new();
            if code > 0 {
                let n = code as usize;
                let optr = match output_buf.call(&mut s, ()) {
                    Ok(p) => p as u32 as usize,
                    Err(e) => {
                        out.push(trap(&e));
                        return out;
                    }
                };
                output = vec![0u8; n];
                if n > limits.max_output || memory.read(&s, optr, &mut output).is_err() {
                    out.push(Result1::Trapped { out_of_fuel: false });
                    return out;
                }
            }
            out.push(Result1::Returned { code, output });
        }
        out
    }

    /// The rule's answer on a call sequence and the transcript it gave: true for ok. A rule that traps, runs out of
    /// fuel or has no room for the transcript answers violation.
    pub fn judge(&self, calls: &[Call], t: &Transcript, limits: &Limits) -> bool {
        let bytes = rule_bytes(calls, t);
        let mut s = store(&self.engine, self.pages, self.tables, limits.rule_fuel);
        let Ok(instance) = Linker::<StoreLimits>::new(&self.engine).instantiate_and_start(&mut s, &self.module) else {
            return false;
        };
        let (Ok(rule_buf), Ok(check), Some(memory)) = (
            instance.get_typed_func::<(), i32>(&s, "rule_buf"),
            instance.get_typed_func::<i32, i32>(&s, "check"),
            instance.get_memory(&s, "memory"),
        ) else {
            return false;
        };
        let Ok(ptr) = rule_buf.call(&mut s, ()) else { return false };
        if memory.write(&mut s, ptr as u32 as usize, &bytes).is_err() {
            return false;
        }
        matches!(check.call(&mut s, bytes.len() as i32), Ok(0))
    }
}

/// What the rule reads: for each call, the op (1 byte), the argument length (u16 little endian), the arguments, then
/// the result as in `encode_transcript` (status, code, output length, output). Calls after a trap are left out.
pub fn rule_bytes(calls: &[Call], t: &Transcript) -> Vec<u8> {
    let mut out = Vec::new();
    for (c, r) in calls.iter().zip(t.iter()) {
        out.push(c.op);
        out.extend_from_slice(&(c.args.len() as u16).to_le_bytes());
        out.extend_from_slice(&c.args);
        out.extend_from_slice(&encode_transcript(&vec![r.clone()]));
    }
    out
}

// ---------------------------------------------------------------- generators

fn mutate(calls: &mut Vec<Call>, rng: &mut Rng, structural: bool, max_calls: usize) {
    // the kinds: 0 one argument byte changed, 1 two changed, 2 two calls swapped, 3 a call repeated, 4 a call dropped,
    // 5 a byte inserted into an argument, 6 a byte deleted from one (the length changes, so a patch that only
    // recognises the secret's exact length or layout is still tried on a near copy of the attack)
    let kinds: &[u64] = if structural && calls.len() > 1 { &[0, 1, 2, 3, 4, 5, 6] } else { &[0, 1, 5, 6] };
    let kind = kinds[rng.below(kinds.len() as u64) as usize];
    let with_args: Vec<usize> = (0..calls.len()).filter(|&i| !calls[i].args.is_empty()).collect();
    match kind {
        0 | 1 if !with_args.is_empty() => {
            for _ in 0..=kind {
                let i = with_args[rng.below(with_args.len() as u64) as usize];
                let j = rng.below(calls[i].args.len() as u64) as usize;
                calls[i].args[j] = rng.byte();
            }
        }
        2 => {
            let i = rng.below(calls.len() as u64 - 1) as usize;
            calls.swap(i, i + 1);
        }
        3 if calls.len() < max_calls => {
            let i = rng.below(calls.len() as u64) as usize;
            let c = calls[i].clone();
            calls.insert(i, c);
        }
        4 => {
            let i = rng.below(calls.len() as u64) as usize;
            calls.remove(i);
        }
        5 if !calls.is_empty() => {
            let i = rng.below(calls.len() as u64) as usize;
            if calls[i].args.len() < 255 {
                let j = rng.below(calls[i].args.len() as u64 + 1) as usize;
                let b = rng.byte();
                calls[i].args.insert(j, b);
            }
        }
        6 if !with_args.is_empty() => {
            let i = with_args[rng.below(with_args.len() as u64) as usize];
            let j = rng.below(calls[i].args.len() as u64) as usize;
            calls[i].args.remove(j);
        }
        _ => {}
    }
}

/// Fairness inputs: `count` mutations of the public tests (one to three changes each), seeded.
pub fn fairness_sequences(tests: &[Vec<Call>], seed: &[u8; 32], count: u32, limits: &Limits) -> Vec<Vec<Call>> {
    let mut rng = Rng::from_seed(seed, FAIRNESS_DOMAIN);
    let pool: Vec<&Vec<Call>> = tests.iter().filter(|t| !t.is_empty()).collect();
    (0..count)
        .map(|_| {
            if pool.is_empty() {
                return vec![Call { op: 0, args: (0..rng.below(16)).map(|_| rng.byte()).collect() }];
            }
            let mut calls = pool[rng.below(pool.len() as u64) as usize].clone();
            for _ in 0..=rng.below(3) {
                mutate(&mut calls, &mut rng, true, limits.max_calls);
            }
            calls
        })
        .collect()
}

/// Variants of the secret: `count` changed copies (argument bytes, a swap, a repeat or a drop), seeded.
pub fn secret_variants(secret: &[Call], seed: &[u8; 32], count: u32, limits: &Limits) -> Vec<Vec<Call>> {
    let mut rng = Rng::from_seed(seed, VARIANT_DOMAIN);
    (0..count)
        .map(|_| {
            let mut calls = secret.to_vec();
            mutate(&mut calls, &mut rng, true, limits.max_calls);
            calls
        })
        .collect()
}

// ---------------------------------------------------------------- the check

/// One public test: a call sequence (encoded) and the transcript the original gives (encoded).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Test {
    pub sequence: Vec<u8>,
    pub expected: Vec<u8>,
}

/// What the vendor fixes when a bounty of this mode opens.
pub struct RuleBounty<'a> {
    pub original: &'a [u8],
    pub rule: &'a [u8],
    pub public_tests: &'a [Test],
    /// Private: the secret call sequence (encoded), the reference fix and the sweep positions.
    pub secret: &'a [u8],
    pub reference_fix: &'a [u8],
    pub sweep_positions: &'a [u16],
}

/// Which step decided a FAIL. Internal only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reason {
    Setup(String),
    CandidateInvalid(LoadError),
    SecretTrapped,
    SecretRule,
    PublicTest(usize),
    FairnessTrap(usize),
    FairnessRule(usize),
    FairnessDiffers(usize),
    VariantTrap(usize),
    VariantRule(usize),
    SweepTrap { position: u16, value: u8 },
    SweepRule { position: u16, value: u8 },
    // Proof 0
    OriginalNotBuggy,
    OriginalTrapsOnSecret,
    OriginalFailsPublicTest(usize),
    ReferenceFixFails(Box<Reason>),
}

impl Reason {
    pub fn step(&self) -> String {
        match self {
            Reason::Setup(s) => format!("setup: {s}"),
            Reason::CandidateInvalid(e) => format!("1 validate: {e:?}"),
            Reason::SecretTrapped => "2 secret: trapped".into(),
            Reason::SecretRule => "2 secret: the rule says violation".into(),
            Reason::PublicTest(i) => format!("3 public test {i}: other results"),
            Reason::FairnessTrap(i) => format!("4 fairness {i}: trapped where the reference fix does not"),
            Reason::FairnessRule(i) => format!("4 fairness {i}: the rule says violation"),
            Reason::FairnessDiffers(i) => format!("4 fairness {i}: a benign sequence, other results than the reference fix"),
            Reason::VariantTrap(i) => format!("5 variant {i}: trapped"),
            Reason::VariantRule(i) => format!("5 variant {i}: the rule says violation"),
            Reason::SweepTrap { position, value } => format!("6 sweep: position {position} set to {value}: trapped"),
            Reason::SweepRule { position, value } => format!("6 sweep: position {position} set to {value}: the rule says violation"),
            Reason::OriginalNotBuggy => "proof0: the rule says ok for the original on the secret".into(),
            Reason::OriginalTrapsOnSecret => "proof0: the original traps on the secret".into(),
            Reason::OriginalFailsPublicTest(i) => format!("proof0: the original does not give public test {i}'s results"),
            Reason::ReferenceFixFails(r) => format!("proof0: reference fix fails: {}", r.step()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Report {
    pub verdict: Verdict,
    pub reason: Option<Reason>,
    pub runs: u32,
}

fn fail(reason: Reason, runs: u32) -> Report {
    Report { verdict: Verdict::Fail, reason: Some(reason), runs }
}

/// Why the private parts of a bounty are not usable, or None.
pub fn setup_problem(b: &RuleBounty, limits: &Limits) -> Option<String> {
    if b.secret.len() > limits.max_sequence_bytes {
        return Some("the secret sequence is too long".into());
    }
    match decode(b.secret) {
        None => return Some("the secret is not a whole call sequence".into()),
        Some(c) if c.is_empty() || c.len() > limits.max_calls => return Some("the secret has no calls or too many".into()),
        _ => {}
    }
    if b.sweep_positions.len() > MAX_SWEEP_POSITIONS {
        return Some("more than 4 sweep positions".into());
    }
    for (i, p) in b.sweep_positions.iter().enumerate() {
        if *p as usize >= b.secret.len() || b.sweep_positions[..i].contains(p) {
            return Some("a sweep position is outside the secret or named twice".into());
        }
    }
    None
}

/// The verdict only. This is what the zkVM guest commits.
pub fn check(candidate: &[u8], b: &RuleBounty, round: &Round, limits: &Limits) -> Verdict {
    check_report(candidate, b, round, limits).verdict
}

pub fn check_report(candidate: &[u8], b: &RuleBounty, round: &Round, limits: &Limits) -> Report {
    if let Some(why) = setup_problem(b, limits) {
        return fail(Reason::Setup(why), 0);
    }
    let secret = decode(b.secret).expect("checked");
    let (rule, reference, original) = match (Loaded::rule(b.rule, limits), Loaded::program(b.reference_fix, limits), Loaded::program(b.original, limits)) {
        (Ok(r), Ok(f), Ok(o)) => (r, f, o),
        _ => return fail(Reason::Setup("the rule, the reference fix or the original does not load".into()), 0),
    };
    let cand = match Loaded::program(candidate, limits) {
        Ok(m) => m,
        Err(e) => return fail(Reason::CandidateInvalid(e), 0),
    };
    let count = std::cell::Cell::new(0u32);
    let run = |m: &Loaded, calls: &[Call]| {
        count.set(count.get() + 1);
        m.run(calls, limits)
    };
    // 2. the secret
    let t = run(&cand, &secret);
    if trapped(&t) {
        return fail(Reason::SecretTrapped, count.get());
    }
    if !rule.judge(&secret, &t, limits) {
        return fail(Reason::SecretRule, count.get());
    }
    // 3. public tests, exact
    let mut test_calls = Vec::new();
    for (i, test) in b.public_tests.iter().enumerate() {
        let Some(calls) = decode(&test.sequence) else { return fail(Reason::Setup(format!("public test {i} does not decode")), count.get()) };
        if encode_transcript(&run(&cand, &calls)) != test.expected {
            return fail(Reason::PublicTest(i), count.get());
        }
        test_calls.push(calls);
    }
    // 4. fairness: mutations of the public tests
    for (i, calls) in fairness_sequences(&test_calls, &round.fuzz_seed, round.fuzz_count, limits).iter().enumerate() {
        let (r, c) = (run(&reference, calls), run(&cand, calls));
        if trapped(&c) && !trapped(&r) {
            return fail(Reason::FairnessTrap(i), count.get());
        }
        if !trapped(&c) && !rule.judge(calls, &c, limits) {
            return fail(Reason::FairnessRule(i), count.get());
        }
        if run(&original, calls) == r && c != r {
            return fail(Reason::FairnessDiffers(i), count.get());
        }
    }
    // 5. variants of the secret
    for (i, calls) in secret_variants(&secret, &round.fuzz_seed, round.variant_count, limits).iter().enumerate() {
        let c = run(&cand, calls);
        if trapped(&c) {
            if !trapped(&run(&reference, calls)) {
                return fail(Reason::VariantTrap(i), count.get());
            }
            continue;
        }
        if !rule.judge(calls, &c, limits) {
            return fail(Reason::VariantRule(i), count.get());
        }
    }
    // 6. sweep
    let mut bytes = b.secret.to_vec();
    for &position in b.sweep_positions {
        let keep = bytes[position as usize];
        for value in 0..=255u8 {
            bytes[position as usize] = value;
            let Some(calls) = decode(&bytes) else { continue };
            let c = run(&cand, &calls);
            if trapped(&c) {
                if !trapped(&run(&reference, &calls)) {
                    return fail(Reason::SweepTrap { position, value }, count.get());
                }
                continue;
            }
            if !rule.judge(&calls, &c, limits) {
                return fail(Reason::SweepRule { position, value }, count.get());
            }
        }
        bytes[position as usize] = keep;
    }
    Report { verdict: Verdict::Pass, reason: None, runs: count.get() }
}

/// Proof 0: the original is really buggy on the secret (no trap, the rule says violation), gives its public tests'
/// results, and the reference fix passes the full check.
pub fn proof0_report(b: &RuleBounty, round: &Round, limits: &Limits) -> Report {
    if let Some(why) = setup_problem(b, limits) {
        return fail(Reason::Setup(why), 0);
    }
    let secret = decode(b.secret).expect("checked");
    let (Ok(rule), Ok(original)) = (Loaded::rule(b.rule, limits), Loaded::program(b.original, limits)) else {
        return fail(Reason::Setup("the rule or the original does not load".into()), 0);
    };
    let t = original.run(&secret, limits);
    if trapped(&t) {
        return fail(Reason::OriginalTrapsOnSecret, 1);
    }
    if rule.judge(&secret, &t, limits) {
        return fail(Reason::OriginalNotBuggy, 1);
    }
    for (i, test) in b.public_tests.iter().enumerate() {
        let ok = decode(&test.sequence).map(|c| encode_transcript(&original.run(&c, limits)) == test.expected).unwrap_or(false);
        if !ok {
            return fail(Reason::OriginalFailsPublicTest(i), 2 + i as u32);
        }
    }
    let fix = check_report(b.reference_fix, b, round, limits);
    match fix.verdict {
        Verdict::Pass => Report { verdict: Verdict::Pass, reason: None, runs: fix.runs + 1 + b.public_tests.len() as u32 },
        Verdict::Fail => fail(Reason::ReferenceFixFails(Box::new(fix.reason.unwrap_or(Reason::Setup("unknown".into())))), fix.runs),
    }
}

// ---------------------------------------------------------------- what gets hashed

/// The private record the vendor commits to (after the salt): the domain tag, the secret's length (u32 little endian),
/// the secret sequence, the reference fix's sha256, the number of sweep positions and each position (u16).
pub fn secret_record(secret: &[u8], reference_fix_hash: &[u8; 32], sweep_positions: &[u16]) -> Vec<u8> {
    let mut out = RECORD_DOMAIN.to_vec();
    out.extend_from_slice(&(secret.len() as u32).to_le_bytes());
    out.extend_from_slice(secret);
    out.extend_from_slice(reference_fix_hash);
    out.push(sweep_positions.len().min(255) as u8);
    for p in sweep_positions {
        out.extend_from_slice(&p.to_le_bytes());
    }
    out
}

/// The public corpus the journal's corpus hash covers: the domain tag, the rule module's sha256, then each public test
/// (sequence length u32, sequence, transcript length u32, transcript). Binding the rule here keeps it fixed for every
/// proof of the bounty, with the journal layout unchanged.
pub fn corpus_bytes(tests: &[Test], rule_hash: &[u8; 32]) -> Vec<u8> {
    let mut out = CORPUS_DOMAIN.to_vec();
    out.extend_from_slice(rule_hash);
    for t in tests {
        out.extend_from_slice(&(t.sequence.len() as u32).to_le_bytes());
        out.extend_from_slice(&t.sequence);
        out.extend_from_slice(&(t.expected.len() as u32).to_le_bytes());
        out.extend_from_slice(&t.expected);
    }
    out
}

// ---------------------------------------------------------------- text files

fn hex(s: &str) -> Result<Vec<u8>, String> {
    if s == "-" {
        return Ok(Vec::new());
    }
    kintsugi_check::text::parse_hex(s)
}

/// Public tests: one per line, "<sequence as hex> <transcript as hex>" (- for empty); # starts a comment.
pub fn parse_tests(text: &str) -> Result<Vec<Test>, String> {
    let mut out = Vec::new();
    for line in text.lines().map(|l| l.split('#').next().unwrap_or("").trim()).filter(|l| !l.is_empty()) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() != 2 {
            return Err(format!("a public test line has {} fields, not 2", parts.len()));
        }
        out.push(Test { sequence: hex(parts[0])?, expected: hex(parts[1])? });
    }
    Ok(out)
}

/// The secret file: one line "<sequence as hex> [sweep=<p>,<p>]".
pub fn parse_secret(text: &str) -> Result<(Vec<u8>, Vec<u16>), String> {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).collect();
    let [line] = lines.as_slice() else { return Err("the secret file must hold one line: <sequence as hex> [sweep=<p>,<p>]".into()) };
    let parts: Vec<&str> = line.split_whitespace().collect();
    let seq = hex(parts[0])?;
    let mut sweep = Vec::new();
    if let Some(list) = parts.get(1) {
        let list = list.strip_prefix("sweep=").ok_or("the second field must be sweep=<p>,<p>")?;
        for p in list.split(',').filter(|p| !p.is_empty()) {
            sweep.push(p.parse::<u16>().map_err(|_| "a sweep position is not a whole number")?);
        }
    }
    Ok((seq, sweep))
}

/// The shapes the zkVM host sends into the rule guest. The journal is the crash checker's `Journal`, unchanged.
#[cfg(feature = "zk")]
pub mod zk {
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize, Clone, Debug)]
    pub struct RuleGuestInput {
        pub original: Vec<u8>,
        pub rule: Vec<u8>,
        /// Public tests as (sequence, transcript), both encoded.
        pub public_tests: Vec<(Vec<u8>, Vec<u8>)>,
        /// Private: the secret sequence, the reference fix, the sweep positions and the salt.
        pub secret: Vec<u8>,
        pub reference_fix: Vec<u8>,
        pub sweep_positions: Vec<u16>,
        pub salt: [u8; 32],
        pub candidate: Vec<u8>,
        pub fuzz_seed: [u8; 32],
        pub fuzz_count: u32,
        pub variant_count: u32,
        pub submission_id: [u8; 32],
        /// `kintsugi_check::zk::MODE_CHECK` or `MODE_PROOF0`.
        pub mode: u8,
    }
}
