# Development log

One dated entry per work block: what was done, the exact commands, the results, what failed, what is next.

## 2026-10-23: S0 setup (PASS)

### Done

- Repository layout created: `contract/`, `harness/` (with `harness/guest/`), `host/`, `web/`, `data/`, `docs/`, and a Rust
  workspace at the root (`Cargo.toml`).
- Hello world NEAR contract (`contract/src/lib.rs`), hello world zkVM guest (`harness/guest/src/main.rs`) and host
  (`host/src/main.rs`). The RISC Zero parts follow the `cargo risczero new` template at tag v3.0.6; the contract settings
  follow the `cargo near new` template from cargo-near 0.22.0.
- `docs/VERSIONS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/EVIDENCE.md` started.

### Problem: the first workspace build looked hung

- Command: `cargo build --release` (repository root).
- What happened: the log stopped at `Downloaded secp256k1-sys v0.8.2` and showed no new line for about 31 minutes. It was
  stopped after 1,896 s (`wall_seconds=1896.50`, exit 143 = stopped by signal 15).
- Cause, measured:
  - IPv6 to the crate download server does not connect at all:
    `curl -6 https://static.crates.io/...` failed in 0.58 s ("Could not connect to server").
  - IPv4 works but is very slow: `curl -4` received 746,671 bytes of a 2,508,613 byte crate in 40 s, about 18 KB/s.
  - While `cargo fetch` ran, `ss -tinp` showed its two connections to 140.248.134.137:443 receiving about 18 KB/s each
    (bytes_received rose from 268,600 to 1,704,969 in 75 s on one connection). So cargo was downloading, slowly, not hung.
    A large crate takes many minutes at this speed and cargo prints nothing until each file is complete.
- Fixes tried:
  1. Settings for this shell only: `CARGO_HTTP_MULTIPLEXING=false CARGO_HTTP_TIMEOUT=60 CARGO_NET_RETRY=10`.
  2. Also `CARGO_NET_GIT_FETCH_WITH_CLI=true`.
  - Attempts 1 to 3 were stopped by our own stall watchdog after 210 s each. That watchdog was wrong: it measured CPU time,
    then file read counters, and neither shows a slow network download. Our mistake, not a cargo failure.
  - Attempt 4 runs with all four settings and no automatic stop; progress is measured as bytes received on cargo's sockets
    (`ss -tinp`) once a minute. About 1 MB per minute received at the first checks.
- Lesson written into the project rules: measure download progress by socket bytes, not CPU or log lines.
- Attempt 4 was stopped on purpose after about 6 minutes (5.5 MB received). The remaining downloads included `aws-lc-sys`, a
  large C crypto library that needs `cmake` (not installed). It came in only through RISC Zero's default `bonsai` feature, the
  client for a remote proving service. We do not want that path at all: whoever proves sees the private input, and the
  vendor's secret must stay on the vendor's machine. `host/Cargo.toml` now uses
  `risc0-zkvm = { version = "=3.0.6", default-features = false, features = ["client"] }`, which proves through the local
  `r0vm`. Attempt 5 started with that change.
- Attempt 5 finished downloading (about 9.5 MB received in 10 minutes) and compiled 218 crates, then failed (exit 101,
  652 s) on a deliberate check in near-sdk 5.29.1: `compile_error!` "Use `cargo near build` instead of `cargo build` to
  compile your contract". A NEAR contract cannot be built natively with plain `cargo build`.
- Fix: the root `Cargo.toml` sets `default-members = ["harness", "host"]`, and `scripts/build_all.sh` is the one command
  that builds everything (`cargo build --release`, then `cargo near build non-reproducible-wasm` in `contract/`).

### S0 checks (details and outputs in docs/EVIDENCE.md)

- (a) `./scripts/build_all.sh`: PASS, exit 0, 25.03 s with crates cached (first run 456.13 s including downloads).
- (b) Contract deployed to `kintsugi-djloo.testnet` (tx `6nNNsGGHEVBbAJmAyU8TGEd7tfC8fEnYSxx3uoG5SVJj`), greeting read, set
  (tx `4xrdsVRocd8iEWmULFRAAHPgnPkZRZb9iDgcVm4kJby6`) and read back: PASS.
- (c) `RISC0_DEV_MODE=0 ./target/release/kintsugi-host kintsugi`: proof generated in 5.03 s and verified in 0.030 s: PASS.

### Next

- S1: the real harness (wasmi inside the guest, PASS or FAIL journal, fairness check, attack corpus).
