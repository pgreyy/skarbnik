# Architecture (what exists today)

This file describes only what is in the repository now. It grows as parts are built.

## Today

| Folder | What is there | Status |
| --- | --- | --- |
| `contract/` | The bounty contract: create, register verifier, credit (deposit, withdraw), commit with a rising attempt fee from credit, reveal, verdict, attest (two different verifiers), timeout, expire (refund and fee sweep to verifiers); unit tests in `contract/src/tests.rs` | S3b, deployed on `bounty.kintsugi-djloo.testnet` (the S3 version without fees stays on `kintsugi-djloo.testnet`) |
| `scripts/` | `build_all.sh` (builds everything); `s3_deploy.sh`, `s3_testnet.sh`, `s3_lib.sh`, `s3_measure.py`, `s3b_setup.sh`, `s3b_testnet.sh` (testnet runs and measurements); `s2_measure.sh` (proof memory and time) | S0, S2, S3, S3b |
| `harness/` | Build crate that compiles the zkVM guests in `harness/guest/` and `harness/check-guest/` and exposes their programs and image ids | S0, S1/S2 |
| `harness/guest/` | A zkVM guest program that reads a name and publishes "hello, <name>" | S0 hello world |
| `harness/check-guest/` | The zkVM guest that runs the patch checker on one candidate and commits the journal (hashes, seed, counts, PASS or FAIL); the secret crash input and salt stay inside | S1/S2 |
| `harness/checker/` | Native patch checker (`kintsugi-check`): runs a candidate wasm patch on the crash input, the public tests, seeded fairness inputs and seeded crash variants; verdict PASS or FAIL | S1, runs natively and inside the zkVM guest |
| `host/` | `kintsugi-host`: `hello`, `execute` (cycles only), `prove` (receipt file), `verify` (separate process check of a receipt file), `tamper` (changed copy for tests) | S0, S1/S2 |
| `verifier/outlayer/` | `farbox-verifier`: reads a receipt and the values it must match (image id, submission id, receipt sha256) from stdin, verifies it with RISC Zero's verify-only code, prints a short JSON answer; built for wasm32-wasip1 to run on OutLayer | S4, in progress |
| `web/` | Empty placeholder for the dashboard | Not started |
| `data/demo/` | Demo parser with a hidden crash (`original`), honest fix (`fixed`), demo crash input, public tests | S1 demo data |
| `data/attacks/` | 18 cheating patches, inert test data, with expected verdicts in `manifest.txt` | S1 test data |
| `docs/` | Versions, evidence, devlog, decisions and this file | Kept up to date each work block |

## How the pieces connect today

- `./scripts/build_all.sh` builds everything in one command.
  - Step 1: `cargo build --release` at the root builds `harness` (which compiles the guest) and `host` (the workspace's
    `default-members`).
  - Step 2: `cargo near build non-reproducible-wasm` inside `contract/` builds the contract for the chain (WebAssembly).
  - The contract is a workspace member but is not built by a plain `cargo build`: near-sdk 5.29.1 stops a native contract
    build with a `compile_error!` and asks for `cargo near build`.
- `host` proves the guest locally with the installed RISC Zero prover (`r0vm`) and checks the receipt against the guest's image id.

- `kintsugi-check` reads the demo files and prints a verdict; its core is pure functions (bytes in, verdict out). The same
  core runs inside the zkVM through `harness/check-guest` (crate feature `zk` adds the shared input and journal types).
- `kintsugi-host prove` sends the bounty files and the candidate into the guest, proves locally with `r0vm`, and writes a
  receipt file; `kintsugi-host verify` checks such a file against the checker's image id in a separate process.

- The contract never sees the secret or checks a patch; it checks who called, with which values, and when. Verifiers are
  registered accounts that call `attest`.

Nothing yet connects the proof to the contract: posted hashes are placeholders until the harness runs in the zkVM.
