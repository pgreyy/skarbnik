//! Runs a WASI preview 1 wasm file the way OutLayer's worker does (wasmtime with fuel
//! metering, input on stdin) and prints the fuel used, the peak linear memory, the
//! wall time and the program's stdout. Usage: fuel-meter <file.wasm> <input.json> [fuel]
use std::time::Instant;
use wasmtime::{Config, Engine, Linker, Module, ResourceLimiter, Store};
use wasmtime_wasi::{pipe::MemoryInputPipe, pipe::MemoryOutputPipe, preview1, preview1::WasiP1Ctx, WasiCtxBuilder};

struct Data {
    wasi: WasiP1Ctx,
    peak: usize,
}

impl ResourceLimiter for Data {
    fn memory_growing(&mut self, _current: usize, desired: usize, _max: Option<usize>) -> anyhow::Result<bool> {
        self.peak = self.peak.max(desired);
        Ok(true)
    }
    fn table_growing(&mut self, _current: usize, _desired: usize, _max: Option<usize>) -> anyhow::Result<bool> {
        Ok(true)
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    anyhow::ensure!(args.len() >= 3, "usage: fuel-meter <file.wasm> <input.json> [fuel]");
    let wasm = std::fs::read(&args[1])?;
    let input = std::fs::read(&args[2])?;
    let budget: u64 = args.get(3).map(|s| s.parse()).transpose()?.unwrap_or(500_000_000_000);

    let mut config = Config::new();
    config.async_support(true);
    config.consume_fuel(true);
    let engine = Engine::new(&config)?;
    let t0 = Instant::now();
    let module = Module::from_binary(&engine, &wasm)?;
    let compile_ms = t0.elapsed().as_millis();

    let mut linker = Linker::new(&engine);
    preview1::add_to_linker_async(&mut linker, |d: &mut Data| &mut d.wasi)?;
    let stdout = MemoryOutputPipe::new(1 << 20);
    let mut b = WasiCtxBuilder::new();
    b.stdin(MemoryInputPipe::new(input)).stdout(stdout.clone());
    let mut store = Store::new(&engine, Data { wasi: b.build_p1(), peak: 0 });
    store.limiter(|d| d);
    store.set_fuel(budget)?;

    let t1 = Instant::now();
    let instance = linker.instantiate_async(&mut store, &module).await?;
    let start = instance.get_typed_func::<(), ()>(&mut store, "_start")?;
    let result = start.call_async(&mut store, ()).await;
    let run_ms = t1.elapsed().as_millis();
    let fuel = budget - store.get_fuel().unwrap_or(0);

    println!("result={}", match &result { Ok(()) => "ok".to_string(), Err(e) => format!("error: {e}") });
    println!("fuel_used={fuel}");
    println!("peak_memory_bytes={} (~{} MiB)", store.data().peak, store.data().peak / (1 << 20));
    println!("compile_ms={compile_ms} run_ms={run_ms}");
    println!("stdout={}", String::from_utf8_lossy(&stdout.contents()));
    Ok(())
}
