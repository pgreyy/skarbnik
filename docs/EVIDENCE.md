# Evidence

One section per spike: the question, the commands, the raw output (or the path to it), the verdict, and the fallback used if it
failed. Failures stay in this file. Times are wall clock on the development machine (Ubuntu 26.04.1 under WSL2, x86_64,
16 cores, 10 GiB RAM for WSL) unless stated otherwise. Raw output is in `docs/evidence/<spike>/`, with local paths replaced
by `<repo>` and `~`.

## S7: An agent that works only through a function call key

Question: can a researcher agent commit and reveal using a key that cannot move its owner's money? Pass (blueprint): the
agent's patch gets PASS and the key cannot transfer funds. Fallback used: **a scripted agent with a canned patch, labelled as
scripted** (the model-driven agent needs a NEAR AI Cloud account and key from the owner, not available).

**Verdict: key part PASS (2026-10-24); the agent's PASS verdict is in progress** (its proof runs after the S4 proof).

Script: `./scripts/s7_agent.sh setup|bounty|limits|prove|finish`. Owner account: `kintsugi-res2-prnvm.testnet`.

| Step | Transaction | Result |
| --- | --- | --- |
| owner adds the agent's function call key (receiver `bounty.kintsugi-djloo.testnet`, methods `commit, reveal`, allowance 0.25 NEAR) | `9dBx1aZpN8teuKA6b5ib7Jhq77kZX1ezNjpptyUodBSs` | public key `ed25519:2aPWxz2Yy7ZSD73pnxPRE24cbobYXF9MTvmDeJqy7U8y` |
| owner deposits 0.05 NEAR credit with its full key | `BAh9RnZVXXYFMNBheheCkzatP5Dt8yN63skQmWBLrskL` | credit 0.05 NEAR |
| vendor creates bounty 3 | `8bth7Nc6v3cTVrzxA3GtYEVUajFqRkKxfcJkpQBmAZrj` | ok |
| agent checks its canned patch on the 17 public tests with the native checker (no secret input) | (local) | 17 passed, 0 failed |
| agent commits, signed with the agent key only | `5rsexZzfttnJKwEGcS5a3TRvB3vMx6xUhT1jEpXhp3ki` | fee 0.01 NEAR from credit (0.05 to 0.04) |
| agent reveals, signed with the agent key only | `DFqQtJ2qREnAkB7tbRbNV8n1ZBv91cwZPbphyPcbv9Lz` | ok |

What the agent key must not do (`docs/evidence/S7/steps/s7_limit_*.txt`, `docs/evidence/S7/chain_refusal_*.txt`):

| Attempt with the agent key | Refused by | Message |
| --- | --- | --- |
| `withdraw_credit` with 1 yoctoNEAR attached | near-cli-rs, before sending | "Having a deposit with a function call action is not allowed with a function call access key." |
| `commit` with 0.01 NEAR attached | near-cli-rs, before sending | same as above |
| `expire` (not an allowed method) | near-cli-rs; and the chain when sent directly over RPC | CLI: "Transaction method name <expire> isn't allowed by the access key."; RPC: `InvalidTxError` / `InvalidAccessKeyError` / `MethodNameMismatch` |
| send 0.01 NEAR to another account | near-cli-rs; and the chain when sent directly over RPC | CLI: "Transaction requires a full permission access key."; RPC: `InvalidTxError` / `InvalidAccessKeyError` / `RequiresFullAccess` |

The two direct RPC attempts were signed with the agent key, saved without sending, then sent to the RPC node, which refused
them before execution (no transaction id, no gas).

## S4/S5: OutLayer as verifier 1 (Level 1)

**Verdict: in progress (2026-10-24).** The contract side and the verifier program are built and tested on this machine. No
OutLayer job has run yet.

What exists:

- `contract/src/lib.rs`: `set_outlayer` (owner sets the OutLayer contract, the verifier program's https URL and sha256, the
  build target and limits), `request_outlayer_check` (anyone; this contract sends `request_execution` to OutLayer with the
  pinned program and the receipt), `on_outlayer_result` (private callback). The callback records OutLayer's attestation only
  if the answer says `ok` and its image id, submission id, receipt sha256, journal sha256 and verdict all equal this
  contract's record; a second verifier is still needed to finalize. `get_submission_id` gives the id the journal must carry:
  sha256("kintsugi-submission-v1" || contract account || bounty id || index || sha256(patch)). The OutLayer settings use their
  own storage key, so the deployed state layout is unchanged.
- `verifier/outlayer/` (`farbox-verifier`): reads `{receipt_b64, image_id, submission_id, receipt_sha256}` from stdin,
  checks the receipt hash, verifies the receipt with RISC Zero's verify-only code, checks the journal's submission id, and
  prints one JSON answer (largest seen: 505 bytes, under OutLayer's 900 byte limit).
- `kintsugi-host`: `compress` (receipt to succinct or Groth16), `--submission-id`, and a `cuda` feature for a GPU machine.

Tests:

- `cargo test -p kintsugi-contract --offline`: 48 passed (9 new OutLayer tests: answer counts as one verifier and a second
  verifier finalizes; repeat counts once; wrong image id, submission id, receipt hash or verdict rejected; not ok, null or
  failed promise rejected; callback private; the request goes to the OutLayer account with the pinned program and input;
  OutLayer must be a registered verifier; only the owner sets OutLayer). One test first failed: calling the callback
  directly in a unit test skips near-sdk's `#[private]` entry check, so the method now also checks the caller itself.
- Native verifier on the 16 input receipt (`docs/evidence/S4/verifier_native_tests.txt`): correct values give `ok: true`,
  PASS; a wrong image id, a wrong receipt hash, a changed journal, and a wrong submission id each give `ok: false`. About
  1.2 s per check.

Wasm for OutLayer (`./scripts/build_verifier_wasm.sh`, wasm32-wasip1, paths remapped, symbols stripped):
1,134,249 bytes, SHA-256 `e60647ec50f76f591a6994963f1394d408f516947f2fe927e389daf2166346a8`. The strings scan found no home
paths, user names, project names or keys (`docs/evidence/S4/verifier_wasm_build_scan.txt`). Not run as wasm yet: no WASI
runtime is installed here.

Compression to one succinct proof (laptop CPU, alone, 2 hour cap):

```bash
MAX_SECONDS=7200 scripts/s2_measure.sh target/s4-logs/compress_succinct_f16.log -- ./target/release/kintsugi-host compress target/s2/receipt_f16_alloc.bin target/s2/receipt_f16_succinct.bin succinct
./target/release/kintsugi-host verify target/s2/receipt_f16_succinct.bin
./target/release/farbox-verifier < succinct_input.json
```

| Measure | Value |
| --- | --- |
| Input | composite receipt of the 16 input proof, 7,180,838 bytes |
| Compress time | 944.27 s (15.7 min) |
| Prover peak memory | 1,484 MiB (r0vm VmHWM) |
| Output | succinct receipt, 224,786 bytes |
| Verify in a separate process | 0.027 s, VALID, verdict PASS |
| Native verifier on it | `ok: true`, PASS, 0.03 s, 4,188 KB peak; its JSON input is 299,987 bytes |

Outputs: `docs/evidence/S4/compress_succinct_f16.txt`, `docs/evidence/S4/verify_succinct.txt`,
`docs/evidence/S4/verifier_native_succinct.txt`. So one check costs 46.9 min of proving plus 15.7 min of compression on this
laptop. The succinct receipt fits NEAR's 1.5 MiB transaction size; its 299,987 byte input to OutLayer is above OutLayer's
free 32 KB, which costs 0.00001 NEAR per extra byte, held while pending and returned (about 2.7 testnet NEAR).

Published (owner's go, 2026-10-24): public repository https://github.com/pgreyy/farbox-verifier with three files only
(`README.md`, `farbox-verifier.wasm`, `farbox-verifier.wasm.sha256`) and release v0.1.0. Before upload the file was scanned
for /home, /Users, /root, the user name, pgreyy, email addresses, the project's working name and other listed names, long
hex or base58 strings, tokens and key text: no names, paths, emails, tokens or keys; the only long hex is the public Rust
1.99.1 commit id in standard library paths, and the rest are digit tables and decimal constants
(`docs/evidence/S4/verifier_publish_scan.txt`). After upload, both
`https://github.com/pgreyy/farbox-verifier/releases/download/v0.1.0/farbox-verifier.wasm` (HTTP 200, 1 redirect) and
`https://raw.githubusercontent.com/pgreyy/farbox-verifier/main/farbox-verifier.wasm` (HTTP 200) downloaded a file with
SHA-256 `e60647ec50f76f591a6994963f1394d408f516947f2fe927e389daf2166346a8`, the same as before upload.

Still open: one testnet run through OutLayer.

## S3b: Attempt fees and credit, on a dedicated contract account

Question: does a commit pay a rising attempt fee from prepaid credit, is a commit without credit refused, do the fees reach
the verifiers at expiry, and can unspent credit be withdrawn (but not by a key that cannot attach 1 yoctoNEAR)?

**Verdict: PASS (2026-10-24).** Full run output: `docs/evidence/S3b/` (`summary.txt`, `transactions.tsv`, `steps/`).

Contract changes (`contract/src/lib.rs`): `deposit_credit` (attach NEAR, optionally for another account), `withdraw_credit`
(needs exactly 1 yoctoNEAR attached, which a function call key cannot attach), `get_credit`; `create_bounty` takes
`attempt_fee` (must be above zero) and `fee_step`; the n-th counted commit (n from 0) costs `attempt_fee + n * fee_step`,
taken from the committer's credit; a commit beyond K is ignored and costs nothing; `expire` (after expiry) refunds an unpaid
bounty and sends the collected fees to the registered verifiers in equal shares, the remainder to the first; a second
`expire` with nothing left to do is refused.

Unit tests: `cargo test -p kintsugi-contract --offline`: 39 passed, 0 failed.

Wasm: 243,866 bytes, SHA-256 `4aa8d8614b4b9e914d981ca72ea298e2fb73cca9796a380a01fb04d34a64c7a2`, the same as the code on
`bounty.kintsugi-djloo.testnet` (RPC `view_code`).

Accounts (testnet only): contract `bounty.kintsugi-djloo.testnet`, created with 3 NEAR from `kintsugi-djloo.testnet`
(`8BT7rhwtAc2cbe5cgMfocrxDc81SB9C6JJuzAnxPA6mM`), deployed with init (`72VTiMGEbBp1Hdk3AQHxgj5YznUsmqsBAb5uvHZQR32a`).
Test accounts from the testnet faucet, 10 testnet NEAR each: `kintsugi-vendor-prnvm.testnet`, `kintsugi-res1-prnvm.testnet`,
`kintsugi-res2-prnvm.testnet`, `kintsugi-ver1-prnvm.testnet`, `kintsugi-ver2-prnvm.testnet`, `kintsugi-ver3-prnvm.testnet`.

Commands, from the repository root:

```bash
cd contract && cargo near build non-reproducible-wasm && cd ..
./scripts/s3b_setup.sh
./scripts/s3b_testnet.sh
```

Fee 0.01 NEAR, step 0.005 NEAR (explorer: `https://explorer.testnet.near.org/transactions/<hash>`):

| Step | Transaction | Result |
| --- | --- | --- |
| register 3 verifiers | `8hoiajVKe6GYXNuRxm77yq7xait8MKJwW2pf6bBiqeMx`, `3GWZ3JLMpBfonwAuKMwdnoYKR39w3cj3PF1us61cFDX6`, `3jK6iQQQK8xhpC1gLyRb7HpmnZKTebYRAsQv7d2hufT2` | ok |
| researchers 1 and 2 deposit 0.1 NEAR credit | `BthTa3YsgwqMaasY1Cfw8FbMLVFAqXUbPbvTuNoJsn3W`, `Foqzj6zNCk8aaGasq7r2SXGDjDnEcFiR16aemGiVWD9e` | credit 0.1 NEAR each |
| bounty A created (0.5 NEAR) | `5aqPDbkryiLCGerajXMxpgmSyueRv5g9AtuDhD39EcU4` | ok |
| researcher 1 commits | `W8AVDvxSFr9rjGUVjLKU2DkGr7289NHyaQ1GhNNkYmh` | fee 0.01 NEAR, credit 0.09 NEAR left |
| researcher 2 commits | `HvErQztKDeAqezBKKADP8ZJA3GcWh7XHWCFmRnxJh5p3` | fee 0.015 NEAR, credit 0.085 NEAR left |
| verifier 3 commits with no credit | `8E7u8BMebiY4SUMiWHgYGHM83UYjDzDbVc87EGyobo9y` | refused: "not enough credit for the attempt fee: call deposit_credit first" |
| reveal, PASS, attest v1, attest v2 | `9HRPtPMWw9ikraFoNVGd6sJyYR8cBzMB7pAKdmQx1e4K`, `Bq35JYq9qzYHHhzcRfLJhmhvze3oSkknyGsDD79eJxzo`, `4JjzCpYCQjppcQHhQ9MEv9jj5trUunpgumAqvMtrmjEb`, `CMKG5ihUMBRsbHQG5Vj2kuaZnaaRrRk2qCdq3bZFUf4M` | researcher 1 balance +0.5 NEAR exactly |
| bounty B created, no commits | `2VLLaPpRiWg4ghVDRJNxpbv1aLURKZdMATphhXytzYng` | ok |
| researcher 2 withdraws its credit (1 yoctoNEAR attached) | `4DBFH8ZCbgtQEh984N8H369tsvUBPrDJeT3ddVj41aGe` | credit 0 |
| expire bounty B | `C3hsfHVfhSQ9xWVhQBgjWpgXA3qG6F1noFNBMPhs5gbP` | vendor +0.5 NEAR exactly |
| expire bounty A (already paid) | `EAomjDsQ41Z1Wt5XZLAZ6Abu6pGQv1nRFbeq4o9HGJew` | the 0.025 NEAR of fees to the verifiers: 8,333,333,333,333,333,333,334 / 8,333,333,333,333,333,333,333 / 8,333,333,333,333,333,333,333 yoctoNEAR |
| expire bounty A again | `FLSQZWSQYjcf6QPGk2RDs5NyMPV5xFKJe9sfdEMfFE8Q` | refused: "nothing to do: bounty already closed and fees already swept" |

Failures on the way: `scripts/s3b_setup.sh` stopped once with exit 141 after deploying: the random suffix pipe
(`tr ... | head -c 5`) ended with a broken pipe under `set -o pipefail`. Replaced by a Python one-liner and re-run with
`SKIP_DEPLOY=1`. Not tested yet: an AI agent's function call key spending credit (that is spike S7).

The S3 contract on `kintsugi-djloo.testnet` (no fees) is left as it was; its S3 evidence above still describes it.

## S2b: Cutting the proving cost

Question: where do the guest's cycles go, and can the cost drop while every input still gets a fresh instance (fresh memory,
globals and state)?

**Verdict: PASS (2026-10-24).** The work a proof must cover dropped by 42 to 46% with identical verdicts, and a real laptop
proof at 16 inputs and 32 variants took 46.9 minutes instead of 85.4 (45% less). Still above the blueprint's 15 minutes.

Confirming proof, same settings as the S2 baseline (16 fairness inputs, 32 variants, segment size 2^19, CPU only):

```bash
MAX_SECONDS=7200 scripts/s2_measure.sh target/s2b-logs/prove_f16_alloc.log -- ./target/release/kintsugi-host prove data/demo/fixed.wasm --fuzz-count 16 --variants 32 --po2 19 --out target/s2/receipt_f16_alloc.bin
./target/release/kintsugi-host verify target/s2/receipt_f16_alloc.bin
```

| | S2 baseline (default allocator) | S2b (freeing allocator) |
| --- | --- | --- |
| Prove time | 5,124.96 s (85.4 min) | **2,814.45 s (46.9 min)** |
| Segments at 2^19 | 43 | 27 |
| Total cycles | 22,282,240 | 13,664,256 |
| User cycles | 7,845,739 | 8,587,922 |
| Prover peak memory (r0vm VmHWM) | 4,718 MiB | 4,724 MiB |
| Receipt (composite) | 11,516,294 bytes | 7,180,838 bytes |
| Verify in a separate process | 1.63 s, VALID | 0.92 s, VALID |
| Journal verdict | PASS | PASS |

Outputs: `docs/evidence/S2b/prove_f16_alloc.txt`, `docs/evidence/S2b/verify_f16_alloc.txt`.

What we found:

- The checker already parsed, validated and compiled each module once per check (`Loaded::load`); every input then got a
  new wasmi store and instance. That stays: fresh memory, globals and state for every input.
- A cycle profile (`kintsugi-host execute ... --profile`, guest cycle counter around each phase, printed by the guest and
  never put in the journal) shows that 74 to 77% of the guest's cycles are interpreter setup per input. Each instance's
  memory is 2 pages (128 KiB), and wasmi fills all of it with zeros when the instance is created.
- The work a proof must cover ("padded cycles", the sum of 2^po2 over segments) was 2.6 times the guest's own cycle count.
  The guest used RISC Zero's default allocator, which never frees, so every new instance landed on memory pages the prover had
  not loaded yet in that segment, and loading pages costs cycles.
- Change: the guest now uses RISC Zero's freeing allocator (`risc0-zkvm` feature `heap-embedded-alloc`,
  `harness/check-guest/Cargo.toml`). A new instance reuses the memory the last one freed, already loaded by the prover; wasmi
  still zero-fills it, so nothing carries over between inputs.

Cycles, executor only (`docs/evidence/S2b/before_profile.txt`, `docs/evidence/S2b/after_profile.txt`):

| Fairness / variants | Padded cycles before | after | change | Segments (2^20) before | after | User cycles before | after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 16 / 32 | 20,185,088 | 11,010,048 | -45% | 20 | 11 | 7,891,548 | 8,639,064 |
| 64 / 32 | 36,700,160 | 19,922,944 | -46% | 35 | 19 | 14,384,576 | 15,754,945 |
| 128 / 32 | 58,720,256 | 31,457,280 | -46% | 56 | 30 | 22,909,934 | 25,071,218 |
| 16 / 8 | 12,582,912 | 7,340,032 | -42% | 12 | 7 | 4,989,582 | 5,454,000 |

| Phase (16 / 32) | Before | Share | After | Share |
| --- | --- | --- | --- | --- |
| reading the input | 207,950 | 3% | 212,650 | 2% |
| module load (parse, validate, compile, trial instance) | 541,848 | 7% | 611,522 | 7% |
| interpreter setup per input (fresh store, instance, 128 KiB memory, input) | 6,037,023 | 77% | 6,415,038 | 74% |
| running the patch | 928,955 | 12% | 939,633 | 11% |
| the rest of the checker (input generation, comparisons) | 139,794 | 2% | 407,663 | 5% |
| hashing for the journal | 6,122 | 0% | 10,122 | 0% |
| writing the journal | 19,280 | 0% | 22,068 | 0% |
| total (guest cycle counter) | 7,880,972 | | 8,618,696 | |

The guest's own cycle count rose 9% (the allocator's bookkeeping), but the padded cycles fell 42 to 46%.

Verdicts before and after, for the full S1 corpus (seed as in S1, 16 fairness inputs, 32 variants), native table and inside
the zkVM (`docs/evidence/S2b/`):

| Module | Expected | Native before | Native after | zkVM before | zkVM after | Same? | zkVM user cycles before | after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fixed.wasm` | PASS | PASS | PASS | PASS | PASS | yes | 7,845,739 | 8,587,922 |
| `original.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 845,382 | 958,886 |
| `constant.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 646,313 | 757,453 |
| `disable_lists.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,177,282 | 1,318,433 |
| `early_return_prefix.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,438,823 | 1,592,912 |
| `imports_host.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 746,270 | 851,703 |
| `invalid_truncated.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 474,284 | 566,795 |
| `loop_forever.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 3,104,820 | 3,219,124 |
| `memorize_tests.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,979,140 | 2,218,585 |
| `memory_declared.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 730,340 | 833,414 |
| `memory_grow.wasm` | FAIL | PASS | PASS | PASS | PASS | yes | 7,864,242 | 8,609,977 |
| `memory_grow_nomax.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 854,505 | 967,897 |
| `memory_grow_use.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 859,735 | 973,314 |
| `overbroad_fix.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 2,266,206 | 2,512,489 |
| `reject_all.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 641,604 | 752,451 |
| `special_case_exploit.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 4,230,768 | 4,659,546 |
| `subtle_change.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 3,582,169 | 3,925,710 |
| `too_large.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,134,058 | 1,202,194 |
| `wrong_export.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 731,751 | 835,093 |
| `wrong_fix.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 849,393 | 962,985 |

20 of 20 modules give the same verdict natively and in the zkVM, before and after.

Native checker tests after the change: `cargo test -p kintsugi-check --offline`: 16 passed.

Not changed: the 128 KiB zero fill per input remains the largest cost. Halving it would need modules that declare 1 memory
page instead of 2, which changes the demo program and corpus; not done.

## S2: How slow and heavy is proving?

Question: time to prove, peak memory, receipt size, cycle count and verification time for the checker inside RISC Zero at
16, 64 and 128 fairness inputs (32 crash variants each, honest patch `data/demo/fixed.wasm`). `RISC0_DEV_MODE=0` on every
run. Proving is local (`r0vm` 3.0.6, CPU only, 16 cores, about 10 GiB RAM for WSL). Outputs in `docs/evidence/S2/`.

**Verdict: FAIL against the blueprint's pass condition (under about 15 minutes per proof), measured 2026-10-24.** All three
proofs completed and verified, but the fastest (16 inputs) took 85 minutes. Fallback taken: record the real numbers, use
smaller segments for memory, and propose smaller limits and a cheaper per-run cost (below). The verdict window W must be set
from these numbers.

### Cycles (executor only, no proof)

```bash
./target/release/kintsugi-host execute data/demo/fixed.wasm --fuzz-count <N> --variants 32
```

| Fairness inputs | User cycles | Segments at 2^20 | Execute time | Verdict |
| --- | --- | --- | --- | --- |
| 16 | 7,845,739 | 19 | 1.92 s | PASS |
| 64 | 14,306,190 | 35 | 3.27 s | PASS |
| 128 | 22,788,162 | 56 | 4.99 s | PASS |

The cheat `special_case_exploit` at 64 inputs: 10,741,914 user cycles, FAIL. Output: `docs/evidence/S2/execute.txt`.
At 16 inputs, a segment limit of 2^19 gives 43 segments and 2^18 gives 104 (`docs/evidence/S2/execute_po2.txt`).

### Proofs

| Fairness inputs | Segment size | Result | Prove time | Prover peak memory | Receipt | Verify |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | 2^20 (default) | **stopped by us after 180 s**: r0vm reached 8,600 MiB resident, 423 to 884 MiB left available, 3 GiB swap in use | - | at least 8,600 MiB | - | - |
| 16 | 2^19 | **proved**, journal verdict PASS | 5,124.96 s (85.4 min) | 4,718 MiB (r0vm VmHWM, read 25 min into the run) | composite, 11,516,294 bytes (seal 11,506,616 bytes, journal 780 bytes); 43 segments, 22,282,240 total cycles | 1.63 s in a separate process |
| 64 | 2^19 | **proved** within its 3 hour cap, journal verdict PASS | 7,993.49 s (133.2 min) | 4,730 MiB (r0vm VmHWM, sampled every 5 s; lowest available 3,382 MiB) | composite, 20,642,762 bytes (seal 20,626,760 bytes, journal 780 bytes); 77 segments, 40,370,176 total cycles | 2.86 s in a separate process (VALID) |
| 128 | 2^19 | **proved** within its 4 hour cap, journal verdict PASS | 12,664.94 s (211.1 min) | 4,748 MiB (r0vm VmHWM, sampled every 5 s; lowest available 3,200 MiB) | composite, 32,926,822 bytes (seal 32,902,264 bytes, journal 780 bytes); 123 segments, 64,028,672 total cycles | 4.75 s in a separate process (VALID) |

Commands:

```bash
scripts/s2_measure.sh target/s2-logs/prove_f16_po19.log -- ./target/release/kintsugi-host prove data/demo/fixed.wasm --fuzz-count 16 --variants 32 --po2 19 --out target/s2/receipt_f16.bin
./target/release/kintsugi-host verify target/s2/receipt_f16.bin
MAX_SECONDS=10800 RUST_LOG=info scripts/s2_measure.sh target/s2-logs/prove_f64_po19.log -- ./target/release/kintsugi-host prove data/demo/fixed.wasm --fuzz-count 64 --variants 32 --po2 19 --out target/s2/receipt_f64.bin
./target/release/kintsugi-host verify target/s2/receipt_f64.bin
MAX_SECONDS=14400 scripts/s2_measure.sh target/s2-logs/prove_f128_po19.log -- ./target/release/kintsugi-host prove data/demo/fixed.wasm --fuzz-count 128 --variants 32 --po2 19 --out target/s2/receipt_f128.bin
./target/release/kintsugi-host verify target/s2/receipt_f128.bin
```

### Where the cycles go (executor, `docs/evidence/S2/execute_breakdown.txt`)

| Run | User cycles |
| --- | --- |
| no fairness inputs, no variants (validate, crash input, 17 public tests) | 1,818,418 |
| 16 fairness inputs, no variants | 3,969,905 |
| no fairness inputs, 32 variants | 5,694,449 |
| 16 fairness inputs, 8 variants | 4,959,939 |

- Each fairness input costs about 134,000 user cycles and each variant about 121,000 (each runs the original and the
  candidate). One module run costs about 60,000 to 67,000 cycles, while the module itself uses at most about 2,100 fuel: almost
  all the cost is setting up a fresh wasmi instance for every input.
- Measured proving speed on this machine, from the three proofs: 230, 198 and 198 seconds per million total cycles.

### What this means, and the proposal

- **15 minutes is out of reach on this CPU with the current harness.** Even the base run (no fairness inputs, no variants)
  is 1.8 million user cycles. No proof with fewer inputs was run, so no time for one is claimed.
- **Proposal 1 (biggest effect, code change):** stop creating a fresh interpreter for every input. Load and validate each
  module once and reset only its memory between runs. To be measured with `execute` first.
- **Proposal 2 (smaller limits, from blueprint section 7):** 16 fairness inputs and 8 variants (4,959,939 user cycles,
  measured above, about 63% of the 16/32 run). Proving time for it is not measured.
- **Proposal 3:** the verdict window W must be at least K times the slowest proof plus a margin. With the measured 85 minutes
  at 16 inputs and K = 3, W is at least about 4.3 hours on this machine.
- **Proposal 4:** a faster prover machine (more cores or an NVIDIA GPU) would change these numbers; not measured.
- Receipts here are composite (one proof per segment): 11.5 to 32.9 MB, too big to store on chain (about 1 NEAR per 100 KB).
  A succinct receipt (compressed into one proof) or Groth16 is needed before the contract can use it; not measured yet.

Notes, kept on purpose:

- The 16 input proof took 85 minutes: more than the blueprint's "under about 15 minutes" pass condition at the smallest
  setting.
- `scripts/s2_measure.sh` was edited by us while it ran this proof (to add a time limit), which broke the script's last
  lines: the exit code, wall time and final peak memory lines were not written. The host's own output (prove time, sizes,
  journal) is complete. The memory figure above is the r0vm peak (VmHWM) read by our status sampler 25 minutes into the run.
- `/usr/bin/time` cannot measure the prover's memory here: it reported 13 MB for the stopped 2^20 run because r0vm is a
  separate process it does not see.

## S1 (zkVM part): the checker inside RISC Zero, and tampered receipts

**Verdict: PASS (2026-10-24).** This finishes S1 together with the native results below.

- The zkVM guest `harness/check-guest` (image id `d3f158571bbb5af7d57751350f8f5fc3baa6e5ce155199c8186849e92ff628a3`) runs
  the same checker and commits only the journal; the crash input and salt stay inside. Inside the zkVM the honest fix gives
  PASS and the cheat `special_case_exploit` gives FAIL (executor, `docs/evidence/S2/execute.txt`).
- Journal of the 16 input proof: verdict PASS, candidate hash `42edaaf5...fdc97`, original hash `fce3c7f2...45fd8`,
  exploit commitment sha256(salt || exploit) `9a1be994...66387`, corpus hash `736d160d...a1e61b`, the S1 seed, counts 16 and
  32. Full values: `docs/evidence/S2/prove_f16_po19.txt`.
- Separate process checks (`docs/evidence/S2/verify_tamper_f16.txt`):

| Receipt file | Command | Result | Exit |
| --- | --- | --- | --- |
| the real receipt | `kintsugi-host verify target/s2/receipt_f16.bin` | VALID, verdict PASS, 1.628 s | 0 |
| verdict in the journal changed PASS to FAIL (`kintsugi-host tamper ... journal`) | `kintsugi-host verify target/s2/receipt_f16_tampered_journal.bin` | INVALID: claim digest does not match the expected digest | 1 |
| one bit flipped in the seal (`kintsugi-host tamper ... seal`) | `kintsugi-host verify target/s2/receipt_f16_tampered_seal.bin` | INVALID: verification indicates proof is invalid | 1 |

## S3: Does the full bounty lifecycle work on NEAR testnet?

Question: does the smallest bounty contract work on testnet, including the silent vendor timeout by a plain call? Also: does
testnet accept more than 300 TGas on one call, and what are block time and finality?

**Verdict: PASS (2026-10-23).** Full write-up, every command and raw output: `docs/evidence/S3/RESULTS.md`
(all transactions in `docs/evidence/S3/transactions.tsv`, gas in `docs/evidence/S3/gas.tsv`).

Contract (`contract/src/lib.rs`): `create_bounty`, `register_verifier` (owner only), `commit`, `reveal`, `post_verdict`,
`attest`, `claim_timeout`, `expire`, plus views. Verifiers are registered accounts; an attestation is an `attest` call signed
by that account's own key. A verdict is final only with matching attestations from two different registered verifiers; a
second attestation from the same verifier counts once. A vendor can never be a verifier and the reverse. Windows use block
time. `expire` waits while a revealed submission still waits for its verdict or timeout, so a vendor cannot take back a
timeout payout by letting the bounty expire. Left out for now: Proof 0 attestations, attempt fees and credit, a reveal
deadline, vendor storage deposits; all posted hashes are labelled placeholders.

Unit tests: `cargo test -p kintsugi-contract --offline`: 30 passed, 0 failed (re-run 2026-10-23 for this file).

Wasm: `target/near/kintsugi_contract/kintsugi_contract.wasm`, 228,358 bytes, SHA-256
`cac3684a6719d631eb48626e13fe1ae430a6409f512b095950766a91d62d7bb7`. The code on `kintsugi-djloo.testnet` has the same
SHA-256 (checked with the RPC `view_code` query). This replaced the S0 hello world contract on that account.

Testnet runs: `./scripts/s3_deploy.sh`, then `./scripts/s3_testnet.sh` (explorer: `https://explorer.testnet.near.org/transactions/<hash>`).

| Path | Step | Transaction | Result |
| --- | --- | --- | --- |
| Setup | deploy and init | `BxNA4Zdhs8ZRZFeYumic1hy5atkdztjb8yqs1FN5TWwA` | ok |
| Happy (bounty 0) | register verifier1, verifier2 | `91S33R933hGcaqcoGCLDgbpYaozzpWeeLcCFi8G2Gvas`, `6GDPogFokryubXgQ3uE5cLoh9UvJtHr51UYsseVeWpEU` | ok |
| Happy | create, commit, reveal | `Fq8ZFjcbhMjhe3gMWzM3xWqUZaCYC7wxsepHyn44w4Ts`, `SRaBr14w6JorNFyUswzLBkw1AHDw6aTPiHHhFwntB6j`, `HAjzWVZMpVyQUaswbRqiZsvb3qpQ5RJ7TmFYCdWRnUBq` | ok |
| Happy | vendor posts PASS | `EHJHxPdeMMaJ36g1xAQXo6v4oQsd4Pb3HAzP6YH8w6gU` | ok |
| Happy | verifier1 attests | `Yge6hA8fu1Q4CYaRsjMVxvdcNVHfZXEvqcrnmbdEjY7` | "recorded" |
| Happy | verifier1 attests again | `7kf5g3BuvMZS5NnoVtdra6LcdpDZLvMnetwXYUe57Ncy` | "duplicate", counted once |
| Happy | verifier2 attests | `9xSP37uDCWffiKrFJu5aBUEuXYZkVbnU8raKXvMVaj4t` | "final_pass", payout account +0.5 NEAR |
| Silent vendor (bounty 2) | create, commit, reveal | `GiKdntx5Z7vENY4aBHHsSz3Z33aYQ9UjGCxzuxgZ3o3y`, `AyVT9GrXmdezBZDwUv3PVYBTUhHg1myriSokvYh6dYEf`, `4R2RPPtZeWUt9VkiNdeVHa95ibqFFYZuroW4KZVNvnqx` | ok |
| Silent vendor | early `claim_timeout` | `AvdNdUt4pgkmi35JtHW4ECv9iugYqpqWCq4pbzXnBnah` | refused: "deadline has not passed" |
| Silent vendor | late verdict | `5adj3H7kzwFVtUXFZdv5QBLmi4wHs8DhUjtsYvjgR81B` | refused: "verdict window has closed" |
| Silent vendor | `claim_timeout` | `5aqYBwqVs7Z4jkGMYd71bKeQveskXoGN1qMnETC1L8kD` | paid, payout account +0.5 NEAR |
| Expiry (bounty 3) | create | `C5GxEFeEuB54QX22MsmTSM1ziNEuV7bWZrimvd67wtFe` | ok |
| Expiry | early `expire` | `4hWsEev7nEo9jQYUHfhEd39z8ixbyqjPzKCrkNq6ucoj` | refused: "bounty has not expired" |
| Expiry | `expire` | `Do3TNA8D5d6i2iy6jGk9kWVCWPJUemukMv1pxnAeqNRn` | vendor refunded +0.5 NEAR |

Test accounts (sub-accounts of `kintsugi-djloo.testnet`, testnet NEAR only): vendor, researcher, verifier1, verifier2, payout.

Gas per call (total over the transaction and its receipts, read from RPC):

| Call | TGas |
| --- | --- |
| deploy and init | 18.58 |
| create_bounty | 2.58 |
| commit | 2.49 |
| reveal | 2.61 |
| post_verdict | 2.42 |
| attest | 2.57 (3.43 for the final one that pays) |
| claim_timeout | 3.20 |
| expire | 2.95 |
| a refused call | about 1.8 to 2.0 |

The "Gas burned" figure near-cli-rs prints (about 0.31 TGas) leaves out the contract's execution and is not used here.

More than 300 TGas on one call: 500 TGas accepted (`n6ptdLi4pbhxdmb2oEk8DFTBrqaw1ibudibcYds6dNQ`), 1,000 TGas accepted
(`EthQyLec4q8KQ9gfL9bEqWx47i4vu4fmWNrHyPF5Lo5a`, re-checked by RPC: prepaid 1000.0 TGas, status success). 1,001 TGas was
refused by near-cli-rs before sending, so the chain's own answer to that was not tested. Testnet runtime config (protocol
version 88) sets both limits to 1,000 TGas. Mainnet not checked.

Block time and finality (`scripts/s3_measure.py`, RPC):

| Measure | Result |
| --- | --- |
| Block time, 121 consecutive blocks (274457951 to 274458071, none skipped) | mean 0.579 s, median 0.591 s, range 0.18 to 1.18 s |
| Finality lag | the latest block names a final block exactly 2 blocks back, about 1.16 s on average (0.82 to 1.35 s, 20 samples) |
| Send to FINAL, 10 transactions | median 3.63 s (3.55 to 3.77), including about 0.57 s network round trip from this machine |
| Send to executed (not yet final) | median 1.66 s |

Failures on the way (kept on purpose):

1. Run 1 stopped after the bounty 1 reveal: near-cli-rs prints no transaction id for a call the contract refuses, and the
   script stopped there. Fix: expected refusals are sent over RPC so they get an id. Bounty 1 was closed later by a second
   on-chain timeout (`CxasRTaCcLej6pUCNGG42FmBzVTnj9PshgG3EtADQ4fc`).
2. Run 2 did not create the expiry bounty: the vendor had 0.499 NEAR left. Fix: a 1 NEAR top-up
   (`CL44USsbM9hQWeuTPx8FuDQeA5vnH5rU42MFauYQtB3y`) and a stop if a bounty is not created. Run 3 completed it.

## S1: Does the harness give the right verdicts? (native run, outside the zkVM)

Question: does the checker give PASS to an honest patch and FAIL to every cheating patch, publishing only PASS or FAIL?

**Verdict: PASS for the native checker (2026-10-23), with one mismatch explained below.** The zkVM part (receipt, and
tampered receipts failing in a separate process) passed on 2026-10-24; see "S1 (zkVM part)" above.

Full write-up, all commands and raw outputs: `docs/evidence/S1/RESULTS.md`.

What the checker does (`harness/checker/`, wasmi 2.0.0 interpreter, each input in a fresh instance, 50,000 fuel per input,
2 memory pages, call depth 64):

1. Validate: at most 2,048 bytes, no imports, the `parse` export, at most 2 memory pages, no start function, no floats.
2. The secret crash input (`data/demo/exploit.hex`, demo data only) must not trap or run out of fuel.
3. All 17 public tests (`data/demo/public_tests.txt`) must return the listed value.
4. Fairness: 64 inputs from the seed must give the same output as the original.
5. Variants: 32 seeded one or two byte changes of the crash input; where the original traps the candidate must not, where
   the original returns a value the candidate must return the same.

Commands (from the repository root):

```bash
cargo test -p kintsugi-check --offline
target/debug/kintsugi-check table --manifest data/attacks/manifest.txt --seed 6b696e74737567692053312064656d6f207365656420412e2e2e2e2e2e2e2e21
```

Results: `cargo test`: 16 passed, 0 failed (6 unit, 10 integration). Table (seed above, 64 fairness inputs, 32 variants):

| Patch | Expected | Actual | Caught at |
| --- | --- | --- | --- |
| `data/demo/fixed.wasm` (honest fix) | PASS | PASS | - |
| `data/demo/original.wasm` (unpatched) | FAIL | FAIL | 2 crash input: trap |
| `reject_all` | FAIL | FAIL | 3 public tests |
| `constant` | FAIL | FAIL | 3 public tests |
| `special_case_exploit` | FAIL | FAIL | 5 variants |
| `loop_forever` | FAIL | FAIL | 2 crash input: out of fuel |
| `memory_grow` | FAIL | **PASS** | mismatch, see below |
| `memory_grow_use` | FAIL | FAIL | 2 crash input: out of bounds |
| `memory_grow_nomax` | FAIL | FAIL | 2 crash input: growth limited |
| `memory_declared` | FAIL | FAIL | 1 validate: memory too large |
| `early_return_prefix` | FAIL | FAIL | 3 public tests |
| `disable_lists` | FAIL | FAIL | 3 public tests |
| `memorize_tests` | FAIL | FAIL | 4 fairness |
| `wrong_fix` | FAIL | FAIL | 2 crash input: trap |
| `subtle_change` | FAIL | FAIL | 4 fairness |
| `overbroad_fix` | FAIL | FAIL | 4 fairness |
| `wrong_export` | FAIL | FAIL | 1 validate |
| `imports_host` | FAIL | FAIL | 1 validate |
| `too_large` | FAIL | FAIL | 1 validate |
| `invalid_truncated` | FAIL | FAIL | 1 validate |

19 of 20 match. Re-run on 2026-10-23 for this file with the same command: same 19 of 20.

- **The mismatch, `memory_grow`:** on the crash input it asks for 64 more memory pages and ignores the answer. Its own declared
  maximum is 2 pages, so WebAssembly refuses the request (returns -1) without a trap, and the module then behaves like the
  honest fix. It never gets or uses extra memory. The expectation was wrong, not the checker; the variants that really use the
  memory fail. Kept in the table on purpose. A test pins this behaviour.
- **Decision (2026-10-23): `memory_grow` stays PASS.** A memory request that the module's own declared limit refuses gives
  the module nothing: no extra memory, no different output. The checker judges what a patch does, and this patch does exactly
  what the honest fix does on every input checked. Patches that really obtain or touch extra memory still FAIL
  (`memory_grow_use`, `memory_grow_nomax`, `memory_declared`).
- **The seeded steps matter:** with fairness and variants turned off (`--fuzz-count 0 --variants 0`), `special_case_exploit`,
  `memorize_tests`, `subtle_change` and `overbroad_fix` all PASS (15 of 20 match). Output: `docs/evidence/S1/table_seeded_steps_off.txt`.
- **Seed sweep:** 200 seeds with 128 fairness inputs: every fairness and variant cheat failed on every seed and the honest fix
  passed on all 200; the latest first mismatch was fairness input #41. Output: `docs/evidence/S1/seed_sweep.txt`.
- **Timings:** a full check of one candidate (210 module runs) takes 0.1 to 2.3 ms; the whole 20-module table runs in under
  0.01 s wall time. Highest fuel used by one input on this seed: 2,100 (limit 50,000), apart from `loop_forever`, which hits the limit.

## S0: Can we build everything?

Question: does the workspace build with one command, does a hello world NEAR contract build and deploy to testnet, and does a
hello world RISC Zero proof get generated and verified locally?

Pass condition (blueprint): hello world contract deploys, hello world proof verifies.

**Verdict: PASS** (2026-10-23), after two failures recorded below.

### (a) Everything builds with one command: PASS

Command, from the repository root:

```bash
./scripts/build_all.sh
```

It runs `cargo build --release` (harness, zkVM guest, host), then `cargo near build non-reproducible-wasm` in `contract/`.

| Run | Result | Wall time | Peak memory | Output |
| --- | --- | --- | --- | --- |
| First run (contract crates downloaded during the run) | Both parts built; the script's last line checked a wrong path and exited 2 | 456.13 s | 752,080 KB | `docs/evidence/S0/a_build_all_first_run.txt` |
| Second run (path fixed, all crates cached) | exit 0 | 25.03 s | 752,464 KB | `docs/evidence/S0/a_build_all_cached_run.txt` |

- Contract wasm: `target/near/kintsugi_contract/kintsugi_contract.wasm`, 85,755 bytes, SHA-256
  `5acf78cf300418ce7cf51119949af734b0e2baca54f6d26162596c887a322d15` (same value in both runs).
- zkVM guest built at `target/riscv-guest/kintsugi-harness/hello_guest`; host binary `target/release/kintsugi-host`.

Failures on the way (kept on purpose):

1. **Plain `cargo build` of the whole workspace fails by design.** near-sdk 5.29.1 stops a native contract build with
   `compile_error!` "Use `cargo near build` instead of `cargo build` to compile your contract" (attempt 5, exit 101, 652 s).
   Output: `docs/evidence/S0/a_attempt5_near_sdk_error.txt`. Fix: `default-members = ["harness", "host"]` in the root
   `Cargo.toml`, and `scripts/build_all.sh` for everything.
2. **Slow network looked like a hang.** Crate downloads ran at about 18 KB/s per connection over IPv4; IPv6 to the crate
   server does not connect. Details and measurements in `docs/DEVLOG.md` (2026-10-23). Cargo was set, for the build shell only,
   to `CARGO_HTTP_MULTIPLEXING=false CARGO_HTTP_TIMEOUT=60 CARGO_NET_RETRY=10 CARGO_NET_GIT_FETCH_WITH_CLI=true`.

### (b) Hello world contract deploys to testnet and runs: PASS

Account: `kintsugi-djloo.testnet` (NEAR testnet; no real money).

```bash
near contract deploy kintsugi-djloo.testnet use-file target/near/kintsugi_contract/kintsugi_contract.wasm without-init-call network-config testnet sign-with-legacy-keychain send
near contract call-function as-read-only kintsugi-djloo.testnet get_greeting json-args '{}' network-config testnet now
near contract call-function as-transaction kintsugi-djloo.testnet set_greeting json-args '{"greeting":"hello from S0"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as kintsugi-djloo.testnet network-config testnet sign-with-legacy-keychain send
near contract call-function as-read-only kintsugi-djloo.testnet get_greeting json-args '{}' network-config testnet now
```

| Step | Result | Transaction | Gas burned | Wall time |
| --- | --- | --- | --- | --- |
| Deploy | "Contract code has been successfully deployed." Code hash on chain `77VBZH68nvpkTCqTsckjAoZu8vTS5jYZ5A44qUCBhpXn` = the wasm's bs58 SHA-256 printed by cargo-near | [`6nNNsGGHEVBbAJmAyU8TGEd7tfC8fEnYSxx3uoG5SVJj`](https://explorer.testnet.near.org/transactions/6nNNsGGHEVBbAJmAyU8TGEd7tfC8fEnYSxx3uoG5SVJj) | 0.878 Tgas | 6.39 s |
| View `get_greeting` | `"hello from kintsugi"` | (view, no transaction) | | 8.13 s |
| Call `set_greeting` | Log: `greeting set by kintsugi-djloo.testnet at block 274454082` | [`4xrdsVRocd8iEWmULFRAAHPgnPkZRZb9iDgcVm4kJby6`](https://explorer.testnet.near.org/transactions/4xrdsVRocd8iEWmULFRAAHPgnPkZRZb9iDgcVm4kJby6) | 0.309 Tgas | 5.75 s |
| View `get_greeting` | `"hello from S0"` | (view, no transaction) | | 2.03 s |

Output: `docs/evidence/S0/b_deploy.txt`, `docs/evidence/S0/b_calls.txt`. On the same day the S3 bounty contract replaced this
hello world contract on the same account, so these calls no longer work today; the transactions above remain on chain. The
wall times include the CLI's own network round
trips; they are not block times (block time is measured in S3).

### (c) Hello world proof is generated and verified locally: PASS

```bash
RISC0_DEV_MODE=0 ./target/release/kintsugi-host kintsugi
```

`RISC0_DEV_MODE=0` is set on purpose: RISC Zero's dev mode makes fake receipts, and this run must not use it. Proving runs on
this machine through the installed `r0vm` 3.0.6; the host is built without the remote proving feature.

| Field | Value |
| --- | --- |
| Journal (public output) | `hello, kintsugi` |
| Image id (guest fingerprint) | `2cf67c95daf4745939443d2c3772891a0e0e02d04fb0a5196cc9508e917f31fc` |
| Total cycles | 32,768 |
| Segments | 1 |
| Prove time | 5.03 s |
| Verify time | 0.030 s |
| Verified | true |
| Whole run | 5.05 s, peak memory 318,004 KB (`/usr/bin/time -f %M`) |

Output: `docs/evidence/S0/c_prove.txt`. This is a tiny program; it says nothing yet about the harness's proving time (S2).
