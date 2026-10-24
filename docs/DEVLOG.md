# Development log

One dated entry per work block: what was done, the exact commands, the results, what failed, what is next.

## 2026-10-24 to 25: S6c Level 2 in the bounty contract (PASS), protocol fee pool, self-block test

- Owner's design choices: Level 2 bounties take only Groth16 proofs; their revealed attempts' fees go to the vendor;
  every bounty records `fuzz_count` and `variant_count` (also checked by the Level 0 verifier script now); the demo's
  Groth16 Proof 0 reused.
- `contract/src/groth16.rs` (proof check and journal reader), `open_with_groth16`, `submit_groth16`, level gates on the
  Level 0 calls; 71 contract tests pass. Deployed to the new account `kintsugi-l2-cihdp.testnet`.
- Proofs on the laptop, alone: A1 (FAIL) 345 s + 90 s + 129 s; A0 (PASS) 3,150 s + 1,017 s + 149 s; Groth16 container
  peaks 7,325 and 6,832 MiB.
- On testnet: Level 2 bounty opened by its Groth16 Proof 0; FAIL spent, PASS paid (+0.11 NEAR); nine attacks refused;
  Level 0 bounty still opens with two attestations. 35 to 36 Tgas per proof.
- Protocol fee pool (owner's rule): one function `release_to_pool`, a view `get_protocol_pool`, no withdraw; redeployed
  in place. Self-block test: vendor side lost 0.045 NEAR fees + 0.000830 NEAR gas, pool gained exactly 0.045 NEAR.
- Mistakes: my first self-block run gave the second account too little NEAR for near-cli's cost check (no junk commit
  was sent; kept in the evidence); my expectation that bounty C's fee would reach the vendor was wrong (the timeout
  refunds it).
- Found: the Level 0 verifier check did not compare the check size; closed for new bounties.

## 2026-10-24: S6b spike: a NEAR contract checks the Groth16 proof (PASS)

- New `kintsugi-host groth16-args` writes the seal, image id, journal and RISC Zero's two fixed constants from a Groth16
  receipt; `scripts/gen_groth16_vk.py` turns RISC Zero's verifying key into NEAR's byte layout.
- New spike contract `verifier/groth16-near` (`verify_groth16`), following RISC Zero's verifier; claim digest formula
  checked against RISC Zero's (equal); `cargo test -p kintsugi-groth16-spike`: 3 passed.
- On testnet, `kintsugi-g16-bkexe.testnet`: the real receipt accepted (tx `Drcc1yqp...ZSEa`); a flipped seal bit
  (call fails, "invalid g1"), a changed journal (false) and a wrong image id (false) rejected. 34.569 Tgas per call,
  about 7% above the 32.4 TGas estimate.
- Not done: no change to the bounty contract or payouts. A flipped-bit unit test is not possible natively (the host
  error aborts near-sdk's mocked environment).

## 2026-10-24: S6 feasibility: Groth16 compression on the laptop (PASS), Level 2 design note

- RISC Zero's CPU Groth16 path needs x86 and Docker; it states no memory figure (README, Dockerfile, local-proving page,
  issue #1749 checked). Pulled `risczero/risc0-groth16-prover:v2025-04-03.1` (2.40 GB, 1,858.6 s, about 1.3 MB/s).
- `kintsugi-host compress target/demo/proof0_succinct.bin target/s6/proof0_groth16.bin groth16`, alone, under
  `scripts/s2_measure.sh` and a container memory sampler: 187.91 s, 2,057 bytes, container peak 7,061 MiB, laptop
  available memory down to 801 MiB. `kintsugi-host verify`: VALID against `dd6c5f42...`.
- Design note in docs/ARCHITECTURE.md: NEAR's three BN254 host functions are enough on paper; host-charge arithmetic
  about 32.4 TGas per proof (not measured); what stays trusted. No contract change.
- `kintsugi-host tamper` does not support Groth16 receipts; no tampered Groth16 receipt tested.

## 2026-10-24: Demo bounty with the reproducible image id (MATCH); prebuilt guests and cuda-prove-only

- Proof 0 with the reproducible build: 4,312.55 s at peak 4,724 MiB, compressed in 1,388.17 s, VALID under
  `dd6c5f42...`.
- `./scripts/demo_bounty.sh create`, `open`, `check`: bounty 4 on `kintsugi-s13-tlryo.testnet` (tx
  `EozokvC2Y6UZHMXpkHzajUdJwwdop86GhzZp2wGHitf5`), Proof 0 attested by two verifiers, expires after 30 days;
  `./scripts/check_image_id.sh kintsugi-s13-tlryo.testnet 4` prints MATCH.
- `harness/build.rs` gains a prebuilt mode (`KINTSUGI_PREBUILT_GUESTS`) and `scripts/export_guests.sh` copies the guest
  files, for a GPU machine without Docker: tested on the laptop, same ids, no guest compiled, 26.72 s.
- `host/Cargo.toml` gains `cuda-prove-only`, for GPU proving only (no GPU Groth16 part); not built here (needs CUDA).
- README gains a short Roadmap section (`9af0b12`).
- Next: owner's call.

## 2026-10-24: Image id mismatch explained; reproducible checker build made official

- Plain guest builds embed the source folder and the user's home folder: the same commit `1439e37` gave `3edbc2e6...`
  at the repo root, `e4f79e00...` in another folder, `4b1947dd...` with another home folder (`dfd48a5e...` on the pod).
- RISC Zero's reproducible build (`cargo risczero build`, Docker image `r0.1.97.0`; buildx v0.38.1 installed in the
  home folder on the owner's go) gave `24c33bc5...` for `1439e37` in every folder and home tried. The default image
  `r0.1.88.0` could not build this code (needs Rust 1.90). Docker downloads ran at about 1.5 to 2.0 MB/s.
- `harness/build.rs` now builds the guests that way: the current checker's id is `dd6c5f42...` (S13's plain id was
  `043ec633...`). New `scripts/check_image_id.sh` rebuilds and compares with a bounty: for S13 bounty 0 it says
  DIFFERENT, as expected. New bounties need a new Proof 0 with this build (not done).
- Mistakes: moving only `CARGO_HOME` was not a valid "other user" test (risc0-build removes `CARGO...` variables);
  the first alt-home reproducible run failed because Docker could not find buildx with `HOME` moved (fixed with
  `DOCKER_CONFIG`). The task took about one hour (17:13 to 18:12 UTC), most of it waiting for Docker downloads.

## 2026-10-24: GPU proof, final attempt (proof in 22.65 s, image id differs, stopped)

- All build dependencies installed in one step; built `kintsugi-host` with a pod-only feature `cuda-prove-only` (the
  circuits' cuda features, without RISC Zero's GPU Groth16 part that needs `circom-witnesscalc`): 57.10 s.
- 16 input proof on the NVIDIA L40S: 22.65 s (laptop baseline 2,814.45 s), 26 segments, PASS, peak GPU memory 9,291 MiB.
- Image id `dfd48a5e...` instead of `3edbc2e6...`, so the run stopped under the owner's rule (no verify, no compression).
  Likely cause, not verified: the guest was compiled on the pod and embeds build paths. Total use of the pod: about
  25.5 minutes (16:45:12 to 17:10:42 UTC).
- Cost (owner, from RunPod): the pod ran about 30 minutes in total; balance $10.00 to $9.52, about $0.48. Pod terminated.
- Next, if the owner wants a like for like number: a reproducible guest build (`cargo risczero build`) on both machines.

## 2026-10-24: GPU proof on a rented RunPod pod (FAIL, no proof)

- Owner rented a RunPod pod (NVIDIA L40S, 46 GB, CUDA 12.8). Setup over ssh from the laptop: check, rust, rzup and the
  code archive of `1439e37` all passed in 607 s.
- `cargo build --release -p kintsugi-host --features cuda` failed three times in `circom-witnesscalc` (pulled in by
  RISC Zero's GPU Groth16 prover): twice "Could not find `protoc`" (my script's second try repeated an unchanged setup:
  fixed, a retry now needs a changed setup), then, with `protobuf-compiler` installed on the owner's go, "Unable to find
  libclang". Stopped for good under the owner's rule; no GPU number exists. About 19 minutes of use (16:45 to 17:04 UTC).
- Next: a future rental adds `libclang-dev` and `clang` before building (in the private guide, not run).

## 2026-10-24: S13 attack pass on testnet (PASS)

- Phases run with `./scripts/s13_attacks.sh <phase>`: setup, proof0, open, commit_a, prove_a, misc, bounty_b, attack_a.
- Proof A: 3,031.98 s at peak 4,725 MiB, compressed in 1,048.19 s, VALID, PASS, bound to the on-chain submission id.
- Attacks 1, 2, 4 to 11 blocked on chain or by the verifier check; attack 3 (sub-accounts fill K) is an accepted risk:
  blocking one reveal window costs 0.045 NEAR with the test fees and more each window, and the leak stays at most K bits.
- Attack 11: the vendor's false FAIL was refused by both verifiers, and the researcher was paid by timeout (+0.51 NEAR).
- Order choice (owner): bounty A's receipt was used for attack 11, not kept for an OutLayer contract test.
- Files: docs/SECURITY.md (new), README claim row, ARCHITECTURE (image id `043ec633...`), EVIDENCE section S13.
- Next: OutLayer retry when FastFS serves our file; audit only when the owner says so.

## 2026-10-24: OutLayer second try (FastFS project) and S13 Proof 0

- Proof 0 for S13 (`./scripts/s13_attacks.sh proof0`): 4,984 s at peak 4,732 MiB, compressed in 1,274 s at peak
  1,487 MiB, VALID, verdict PASS; new image id `043ec633...7f8d`.
- With the owner's go: installed `outlayer-cli` 0.2.1, logged in with a throwaway faucet account, uploaded our verifier
  to FastFS and deployed it as an OutLayer project. Direct jobs on the real S4 receipt (`./scripts/ol_job.sh`): link,
  FastFS link and project name all got no answer (requests 5618 to 5620); OutLayer's probe answered in 14 s. The FastFS
  gateway answered HTTP 502 for every file during the test, so the FastFS result is not conclusive. No proof was spent
  on the contract path and no contract change was made. Testnet cost: 0.0136 NEAR (throwaway account) plus 0.003 NEAR
  kept by OutLayer.
- Mistake: my S13 script loaded two settings files in the wrong order and picked a vendor account that does not exist;
  the first `open` run stopped at `create_bounty` before any transaction, the order is fixed in `scripts/s13_attacks.sh`.
- S13 `open` and `commit_a` phases ran; proof A is running.
- Next: retry the project job when FastFS serves our file; S13 attack phases after proof A.

## 2026-10-24: OutLayer (Level 1) diagnosis on testnet (one hour cap)

- Ran OutLayer's documented call (Project source, 10 M instructions, 128 MB, 60 s, 0.1 NEAR) against their public test
  project `connectors.outlayer.testnet/connector-probe`: answered in 13 s. So testnet workers work.
- Changed one thing at a time with `./scripts/ol_diag.sh` (requests 5610 to 5615 plus a control): the probe file by link
  (FastFS, wasip1 or wasip2) is answered, because OutLayer has it cached; our verifier from raw GitHub or jsDelivr, and a
  file from OutLayer's own GitHub repo, are never answered. Worker counters on OutLayer's public worker list do not move
  for those jobs, and do move for the control.
- Measured our verifier with wasmtime 28.0.1 fuel metering (`verifier/fuel-meter`, new): 878,730,118 instructions, 3.4 MB,
  71 ms on the real receipt. Limits and deposit were not the cause.
- Result: the cause is inside OutLayer (a job whose program must be downloaded first never reaches a worker). Level 1 stays
  "not confirmed on testnet"; Level 0 remains the working path. A ready-to-send question for OutLayer is drafted for the
  owner; nothing was sent. Details: EVIDENCE, "OutLayer (Level 1) on testnet".
- Mistake: my first worker counter readout had a quoting error, so the counters during e6 were read again right after.
- Next: S13 testnet phases.

## 2026-10-24: S4 end to end on testnet (OutLayer did not answer)

- Real proof for bounty 2 with the on-chain seed and submission id: 2,876 s, compressed to 224,786 bytes in 921 s; the
  vendor posted PASS with its journal and receipt hashes.
- `request_outlayer_check` reached OutLayer (request 5607) but the yield timed out after 201 blocks (119 s): "Execution
  promise failed". A tiny direct job to `outlayer.testnet` with the same program timed out the same way. Two failures, so
  moved on; the cause is unconfirmed. Our callback recorded nothing, as designed.
- S5 refusals on chain: private callback called by a stranger, vendor registered as verifier.
- Fallback Level 0: two verifier accounts checked the real receipt against the chain (11 checks pass) and attested;
  bounty 2 finalized PASS and researcher 1 was paid 0.5 NEAR.

## 2026-10-24: S8 arena (PASS)

- Arena module with 4,096 crashing values; the vendor's secret is which one is committed. Scripted probe agent, K = 3,
  binary search: 3 bits learned, never above the budget; secret revealed after the game, commitment and log consistent.
- With the crash-variant check on, every partial-fix probe FAILs, so the agent learns 0 bits.
- On testnet, the fourth probe commit on an arena bounty with `max_commits` 3 was ignored at no cost.
- Verdicts from the native checker, not proofs (labelled). First build failed: the no_std modules needed a panic handler.

## 2026-10-24: S7 scripted agent with a function call key (PASS, scripted fallback)

- Fallback, labelled: scripted agent, canned patch; no language model (needs a NEAR AI Cloud account from the owner).
- The agent key (methods `commit`, `reveal` on the bounty contract) committed and revealed on bounty 3 and paid the fee from
  credit. Every forbidden attempt was refused: by near-cli-rs before sending, and for a method outside the list and for a
  transfer also by the RPC node (`MethodNameMismatch`, `RequiresFullAccess`).
- Caught before commit: the first run wrote the agent key file's local path into `docs/evidence/S7/run.env`. Moved to an
  ignored file; the evidence is clean.
- The agent's submission: proved (2,996 s) and compressed (922 s); verifiers ran `scripts/verifier_check.sh` (11 of 11)
  and attested; outcome Passed, the owner +0.5 NEAR. S7 PASS as the scripted fallback.

## 2026-10-24: S4/S5 OutLayer as verifier 1 (in progress)

- Contract: `set_outlayer`, `request_outlayer_check`, private callback `on_outlayer_result`, `get_submission_id`; 48 unit
  tests pass. One test first failed because calling a callback directly in a unit test skips the `#[private]` entry check;
  the method now checks its caller itself.
- Verifier program `verifier/outlayer` (`farbox-verifier`), native tests correct on the 16 input receipt; wasm32-wasip1 build
  1,134,249 bytes, strings scan clean. Installed the wasm32-wasip1 Rust target (owner approved).
- Host: `compress`, `--submission-id`, `cuda` feature. GPU test plan written (private notes).
- Compressed the 16 input receipt to one succinct proof on the laptop: 944.27 s, r0vm peak 1,484 MiB, 224,786 bytes,
  verified in 0.027 s; the native verifier gives `ok: true` on it.
- Waiting: the owner's go to publish the verifier wasm in a separate public repository.

## 2026-10-24: S2b cutting the proving cost

- Added a cycle profile to the guest (`--profile`): 74 to 77% of the guest's cycles are interpreter setup per input, mostly
  wasmi zero-filling each new instance's 128 KiB memory. The module was already compiled once per check.
- Switched the guest to RISC Zero's freeing allocator (`heap-embedded-alloc`). Padded cycles (the work a proof must cover)
  fell 42 to 46% at 16, 64 and 128 inputs; e.g. 20,185,088 to 11,010,048 at 16 inputs and 32 variants.
- Verdicts unchanged for all 20 corpus modules, native and in the zkVM; checker tests 16 passed.
- Confirming laptop proof at 16 inputs and 32 variants: 2,814.45 s (46.9 min) instead of 5,124.96 s (85.4 min), 27 segments
  instead of 43, receipt 7.2 MB instead of 11.5 MB, verified in a separate process (VALID).

## 2026-10-24: S3b attempt fees and credit (PASS)

- Contract: `deposit_credit`, `withdraw_credit` (1 yoctoNEAR), `get_credit`; rising attempt fee per commit from credit;
  fees sent to the verifiers by `expire`. 39 unit tests pass. Wasm 243,866 bytes.
- Moved to its own account `bounty.kintsugi-djloo.testnet` (3 NEAR from the main account). Six test accounts from the
  testnet faucet. `scripts/s3b_setup.sh`, `scripts/s3b_testnet.sh`.
- Testnet run: fees 0.01 and 0.015 NEAR taken from credit, commit without credit refused, PASS paid 0.5 NEAR, empty bounty
  refunded 0.5 NEAR, 0.025 NEAR of fees split across three verifiers, credit withdrawn, second expire refused.
- Failure on the way: setup stopped with exit 141 (broken pipe in the random suffix line under pipefail); fixed and re-run.
- Found and fixed: the NEAR CLI prints its settings file path, which put a home folder path into one evidence file. All S3b
  evidence was filtered, and `scripts/s3_lib.sh` now replaces home folder paths with `~` before saving.

## 2026-10-23 to 24: S2 proving cost, S1 inside the zkVM (S1 PASS, S2 measured)

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
