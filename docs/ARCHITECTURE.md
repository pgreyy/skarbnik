# Architecture (what exists today)

This file describes only what is in the repository now. It grows as parts are built.

## Today

| Folder | What is there | Status |
| --- | --- | --- |
| `contract/` | The bounty contract: create a bounty (with the vendor's reference fix hash and Proof 0 journal hash), open it after two different verifiers attest Proof 0, register verifiers, credit (deposit, withdraw), commit with a rising attempt fee from credit, reveal within a reveal window, free an unrevealed slot after it (`release_unrevealed`), verdict, attest (two different verifiers), OutLayer request and callback, timeout, expire (refund and fee sweep to verifiers); the winner's own fee is refunded; unit tests in `contract/src/tests.rs` | S3b to S13. The S13 version is deployed on `kintsugi-s13-tlryo.testnet`; the S4/S7 version stays on `bounty.kintsugi-djloo.testnet` (bounties 0 to 4 readable as evidence) |
| `scripts/` | `build_all.sh` (builds everything); testnet runs: `s3_*.sh`, `s3b_*.sh`, `s4_testnet.sh`, `s7_agent.sh`, `s8_arena.sh`, `s8_chain.sh`, `s13_attacks.sh`, `ol_diag.sh` (OutLayer test jobs); `verifier_check.sh` (a Level 0 verifier's checks); `check_image_id.sh` (rebuild the checker, compare its image id with a bounty); `export_guests.sh` (copy the reproducible guest files for another machine); `demo_bounty.sh` (the demo bounty with the reproducible id); `build_verifier_wasm.sh` (build and scan the OutLayer program); `s2_measure.sh` (proof memory and time) | S0 to S13 |
| `harness/` | Build crate that compiles the zkVM guests in `harness/guest/` and `harness/check-guest/` reproducibly (inside RISC Zero's guest builder Docker image `r0.1.97.0`) and exposes their programs and image ids; with `KINTSUGI_PREBUILT_GUESTS` set it embeds guest files built elsewhere instead (for a GPU machine without Docker) | S0, S1/S2; reproducible since 2026-10-24 |
| `harness/guest/` | A zkVM guest program that reads a name and publishes "hello, <name>" | S0 hello world |
| `harness/check-guest/` | The zkVM guest that runs the patch checker on one candidate and commits the journal (hashes, seed, counts, submission id, PASS or FAIL); the secret crash input and salt stay inside. A Proof 0 mode checks the vendor's reference fix and refuses an over-long secret | S1/S2, S2b (freeing allocator), S13 (Proof 0 mode) |
| `harness/checker/` | Native patch checker (`kintsugi-check`): runs a candidate wasm patch on the crash input, the public tests, seeded fairness inputs and seeded crash variants; verdict PASS or FAIL; `proof0` with `--reference-fix` | S1, S13; runs natively and inside the zkVM guest |
| `host/` | `kintsugi-host`: `hello`, `execute` (cycles, `--profile` for the phase split), `prove` (receipt file; `--proof0`, `--submission-id`, `--seed`), `verify` (separate process check of a receipt file), `tamper` (changed copy for tests), `compress` (succinct receipt); build features `cuda` and `cuda-prove-only` (GPU proving only, without the GPU Groth16 part) | S0 to S13 |
| `verifier/outlayer/` | `farbox-verifier`: reads a receipt and the values it must match (image id, submission id, receipt sha256) from stdin, verifies it with RISC Zero's verify-only code, prints a short JSON answer; built for wasm32-wasip1 to run on OutLayer; published at github.com/pgreyy/farbox-verifier (v0.1.0) | S4; works locally; not answered on OutLayer testnet (EVIDENCE, "OutLayer (Level 1) on testnet") |
| `verifier/fuel-meter/` | Runs a wasip1 file the way OutLayer's worker does (wasmtime 28 with fuel metering) and prints instructions, peak memory and time | OutLayer diagnosis |
| `web/` | Empty placeholder for the dashboard | Not started |
| `data/demo/` | Demo parser with a hidden crash (`original`), honest fix (`fixed`), demo crash input, public tests | S1 demo data |
| `data/attacks/` | 18 cheating patches, inert test data, with expected verdicts in `manifest.txt` | S1 test data |
| `data/arena/` | Arena module with 4,096 secret values and probe templates for the bit leak test | S8 |
| `docs/` | Versions, evidence, devlog, decisions, security and this file | Kept up to date each work block |

## How the pieces connect today

- `./scripts/build_all.sh` builds everything in one command.
  - Step 1: `cargo build --release` at the root builds `harness` (which compiles the guests inside Docker, so their image
    ids do not depend on the folder or the user), `host` and the checker (the workspace's `default-members`).
  - `./scripts/check_image_id.sh <contract> <bounty>` rebuilds the checker and compares its image id with the bounty's.
  - Step 2: `cargo near build non-reproducible-wasm` inside `contract/` builds the contract for the chain (WebAssembly).
  - The contract is a workspace member but is not built by a plain `cargo build`: near-sdk 5.29.1 stops a native contract
    build with a `compile_error!` and asks for `cargo near build`.
- `kintsugi-check` reads the demo files and prints a verdict; its core is pure functions (bytes in, verdict out). The same
  core runs inside the zkVM through `harness/check-guest` (crate feature `zk` adds the shared input and journal types).
- `kintsugi-host prove` sends the bounty files and the candidate into the guest, proves locally with `r0vm`, and writes a
  receipt file; `compress` shrinks it to one succinct receipt (about 225 KB); `verify` checks a receipt against the
  checker's image id in a separate process.
- On chain (S4, S7, at Level 0): the researcher commits and reveals; the contract fixes the seed and the submission id;
  the vendor proves with them and posts the verdict with the journal and receipt hashes; two different registered
  verifiers each run `scripts/verifier_check.sh` (verify the receipt, compare every journal field with the chain) and
  call `attest`; the contract then pays. The contract itself never sees the secret or checks a receipt.
- Level 1 (built, not working on testnet): `request_outlayer_check` sends the receipt to OutLayer to run
  `farbox-verifier`, and `on_outlayer_result` accepts only an answer whose echoed values match the contract's record.

## Program versions (image ids)

A receipt verifies only against the image id of the guest program that made it. The first four ids below come from plain builds, which depend on the build folder and the user's home folder and cannot be rebuilt by anyone else; the reproducible build gives the same id everywhere (EVIDENCE, "Image id"). A changed guest gets a new image id, and
older receipts keep verifying against their own id. The published `farbox-verifier` takes the image id as input, so one
file serves every version; the S13 guest did not change it (rebuilt file identical to v0.1.0).

| Image id | Program | Receipts made with it |
| --- | --- | --- |
| `2cf67c95daf4745939443d2c3772891a0e0e02d04fb0a5196cc9508e917f31fc` | `harness/guest` (hello world) | S0 (`docs/evidence/S0/`) |
| `d3f158571bbb5af7d57751350f8f5fc3baa6e5ce155199c8186849e92ff628a3` | `harness/check-guest` at `2b41cad` (bump allocator) | S1 zk and S2 proofs (`docs/evidence/S2/`) |
| `3edbc2e6a077e5193d6d63983a97553f98b669868492e2a6965dcff25985569d` | `harness/check-guest` at `8aead8c` (freeing allocator) | S2b, S4 bounty 2, S7 bounty 3 (`docs/evidence/S2b/`, `S4/`, `S7/`) |
| `043ec633f68431f51b99cacd6a460560647a15916cdd0cb58762b61f9ede7f8d` | `harness/check-guest` with the S13 Proof 0 mode, plain build on the laptop | S13 Proof 0 and bounties on `kintsugi-s13-tlryo.testnet` (`docs/evidence/S13/`) |
| `dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc` | the same checker, reproducible build (`harness/build.rs`) | demo bounty 4 on `kintsugi-s13-tlryo.testnet` and its Proof 0 (`docs/evidence/demo/`) |
