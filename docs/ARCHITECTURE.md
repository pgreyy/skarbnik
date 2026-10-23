# Architecture (what exists today)

This file describes only what is in the repository now. It grows as parts are built.

## Today (spike S0)

| Folder | What is there | Status |
| --- | --- | --- |
| `contract/` | The bounty contract: create, register verifier, commit, reveal, verdict, attest (two different verifiers), timeout, expire; unit tests in `contract/src/tests.rs` | S3, deployed on `kintsugi-djloo.testnet` |
| `scripts/` | `build_all.sh` (builds everything); `s3_deploy.sh`, `s3_testnet.sh`, `s3_lib.sh`, `s3_measure.py` (testnet runs and measurements) | S0, S3 |
| `harness/` | Build crate that compiles the zkVM guest in `harness/guest/` and exposes its program and image id | Hello world guest only |
| `harness/guest/` | A zkVM guest program that reads a name and publishes "hello, <name>" | Hello world only |
| `harness/checker/` | Native patch checker (`kintsugi-check`): runs a candidate wasm patch on the crash input, the public tests, seeded fairness inputs and seeded crash variants; verdict PASS or FAIL | S1, runs outside the zkVM |
| `host/` | A program that proves one run of the guest on this machine and verifies the receipt | Hello world only |
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

- `kintsugi-check` reads the demo files and prints a verdict; its core is pure functions (bytes in, verdict out) so it can
  later move into the zkVM guest. It is not inside the zkVM yet.

- The contract never sees the secret or checks a patch; it checks who called, with which values, and when. Verifiers are
  registered accounts that call `attest`.

Nothing yet connects the proof to the contract: posted hashes are placeholders until the harness runs in the zkVM.
