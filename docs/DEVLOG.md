# Development log

One dated entry per work block: what was done, the exact commands, the results, what failed, what is next.

## 2026-10-23 to 24: S2 proving cost, S1 inside the zkVM (S1 PASS, S2 measured), S3b fees (in progress)

- Pushed S0, S1 and S3 to the private repository after an audit of the full history (no keys, paths, emails or
  attribution; repository still private).
- New zkVM guest `harness/check-guest` runs the same checker (`kintsugi-check`, feature `zk`) and commits a journal:
  candidate hash, original hash, exploit commitment sha256(salt || exploit), corpus hash, seed, counts, submission id and
  PASS or FAIL. Host commands `execute`, `prove`, `verify`, `tamper` (host/src/main.rs).
- Cycle counts without proving (`kintsugi-host execute`): 7,845,739 / 14,306,190 / 22,788,162 user cycles for 16 / 64 / 128
  fairness inputs (19 / 35 / 56 segments of 2^20 cycles).
- **Failure: the first proof did not fit in memory.** `prove ... --fuzz-count 16` with RISC Zero's default segment size
  (2^20 cycles) took the r0vm prover to 8,600 MiB resident memory (sampled), with only 423 to 884 MiB left available and
  3 GiB of swap in use. It was stopped by us after 180 s to protect other services on the machine. `/usr/bin/time` showed
  only 13 MB because it does not see the r0vm process; memory is now read from r0vm's own peak (VmHWM) by
  `scripts/s2_measure.sh`, which also stops r0vm if it passes 6 GiB or available memory falls under 1.5 GiB.
- Fix being tried: smaller segments with `--po2 19` (43 segments at 16 inputs) and `--po2 18` (104 segments).
- 16 inputs at `--po2 19`: proved in 5,124.96 s (85 min), r0vm peak 4,718 MiB, composite receipt 11,516,294 bytes,
  verdict PASS. Verified in a separate process (1.63 s, exit 0). Changing the verdict in the journal, or one bit of the seal,
  makes verification fail (exit 1). This finishes S1's zkVM part.
- Our mistake: we edited `scripts/s2_measure.sh` while it was running the 16 input proof; bash reads scripts as it goes, so
  the script's final lines (exit code, wall time, final memory peak) were lost. The proof itself and the host output are
  fine. Rule for ourselves: never edit a script that is running.
- 64 inputs started at 23:56 UTC with a 3 hour cap and finished: 7,993.49 s (133 min), 77 segments, r0vm peak 4,730 MiB,
  composite receipt 20,642,762 bytes, verdict PASS, verified in a separate process in 2.86 s.
- 128 inputs started at 02:10 UTC with a 4 hour cap and finished: 12,664.94 s (211 min), 123 segments, r0vm peak
  4,748 MiB, composite receipt 32,926,822 bytes, verdict PASS, verified in a separate process in 4.75 s.
- S2 verdict: FAIL against "under about 15 minutes". Executor breakdown: about 60,000 to 67,000 cycles per module run,
  almost all spent creating a fresh interpreter per input. Proposals in docs/EVIDENCE.md (reuse the loaded module per
  input; 16 fairness inputs and 8 variants; W of at least about 4.3 hours at K = 3 on this machine).

## 2026-10-23: S1 harness and S3 contract (both PASS)

- S0 committed as `2962c48` ("S0: workspace, hello contract on testnet, hello proof").
- S1 (harness outside the zkVM, cheating patches) and S3 (bounty contract on testnet) built in parallel. Heavy builds are
  serialized with `flock target/.heavy-build.lock`, so only one cargo build runs at a time. No RISC Zero proving in this block.

### S1 (native checker): PASS, with one finding

- Built `harness/checker/` (crate `kintsugi-check`, wasmi 2.0.0): validate, crash input, public tests, 64 seeded fairness
  inputs and 32 seeded variants of the crash input; verdict PASS or FAIL only. CLI commands `check`, `proof0`, `run`, `table`.
- Demo program `data/demo/original.rs` (a record parser with an off by one length check that traps), honest fix
  `data/demo/fixed.rs`, 18 cheating patches in `data/attacks/` (inert test data), built to wasm with
  `harness/checker/build_modules.sh` (plain rustc, no downloads; 556 byte modules).
- `cargo test -p kintsugi-check --offline`: 16 passed. Table: honest fix PASS, 19 of 20 as expected.
- Finding: `memory_grow` PASSes. Its memory request is refused by its own declared maximum, so it never gets extra memory;
  the expectation was wrong. Kept in the table.
- What failed on the way: the first parser build was 3,282 bytes because of Rust's bounds check panic code (replaced by a
  small trap helper); an offline build needed one online index lookup first; one test was wrong about which step catches
  `memorize_tests` and was corrected to match the checker.
- Not done: the zkVM part of S1 (receipt, journal, tampered receipt check). Limits (2,048 bytes, 50,000 fuel, 64 fairness
  inputs, 32 variants) are first choices to revisit in S2.
- Committed as `d150da2`.

### S3 (bounty contract on testnet): PASS

- Replaced the hello world contract with the smallest bounty contract (create, register verifier, commit, reveal, verdict,
  attest with two different verifiers, timeout, expire). 30 unit tests pass. near-sdk's `unit-testing` feature pulls in
  aws-lc-sys; it built with gcc, no cmake needed.
- Deployed to `kintsugi-djloo.testnet` with `#[init(ignore_state)]` (the account still held the hello world state). Wasm
  228,358 bytes; its code locks about 2.3 NEAR of storage on the account.
- Testnet: happy path paid 0.5 NEAR on the second verifier's attestation; silent vendor path paid 0.5 NEAR by
  `claim_timeout`; expiry refunded the vendor 0.5 NEAR; early and late calls were refused on chain. 500 and 1,000 TGas
  were accepted on one call. Block time median 0.591 s; finality 2 blocks, about 1.16 s.
- What failed on the way: run 1 stopped because near-cli-rs prints no transaction id for a refused call (now sent over RPC);
  run 2 ran the vendor out of testnet NEAR (topped up 1 NEAR). Details in docs/EVIDENCE.md.
- Left out for now: Proof 0 attestations, attempt fees and credit (so the K commit slots can be filled with junk commits),
  a reveal deadline, vendor storage deposits.

### Next

- S2: proving time and memory for the harness inside the zkVM (this also completes S1's zkVM part).
- Add attempt fees or credit to the contract before any demo, so commit slots cannot be filled for free.

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
