# Kintsugi (working name)

Fix a bug you are not allowed to see. A vendor keeps the input that crashes its program secret. Researchers, including AI
agents, submit a patched WebAssembly module. The vendor checks each patch against the secret inside a RISC Zero zero
knowledge virtual machine; the proof says only PASS or FAIL. A NEAR contract holds the bounty and pays by rule, and pays the
researcher by default if the vendor stays silent.

Security: what protects a bounty, the attacks we tried and the known limits are in [docs/SECURITY.md](docs/SECURITY.md).

Status: a hackathon build on NEAR testnet. Everything below says what works today, with the file and command that show it.
Full results, including failures, are in [docs/EVIDENCE.md](docs/EVIDENCE.md); the work log is
[docs/DEVLOG.md](docs/DEVLOG.md).

## What works today

| Claim | Status | Shown by |
| --- | --- | --- |
| The checker gives PASS to an honest patch and FAIL to cheating patches (reject everything, special-case the crash, loop forever, memorize the tests, and others) | works, 19 of 20 as expected; the one difference (`memory_grow`) is explained | `cargo test -p kintsugi-check --offline`; `target/debug/kintsugi-check table --manifest data/attacks/manifest.txt --seed <hex>` (EVIDENCE, S1) |
| The same check runs inside RISC Zero and produces a receipt; a changed receipt fails verification in a separate process | works | `kintsugi-host prove ...`, `kintsugi-host verify <receipt>`, `kintsugi-host tamper ...` (EVIDENCE, S1 zkVM part) |
| Proving cost on a laptop CPU, measured | 16 fairness inputs: 46.9 min; receipt compressed to one 224,786 byte proof in 15.7 min | EVIDENCE, S2, S2b, S4 |
| Bounty contract on NEAR testnet: commit, reveal, verdict, two different verifiers, payout; silent vendor timeout; expiry refund | works | `cargo test -p kintsugi-contract --offline` (48 tests); `scripts/s3_testnet.sh`, `scripts/s3b_testnet.sh` (EVIDENCE, S3, S3b) |
| Attempt fees paid from prepaid credit; fees go to the verifiers | works on testnet | `scripts/s3b_testnet.sh` (EVIDENCE, S3b) |
| An agent key that can only `commit` and `reveal` cannot move its owner's money | works on testnet (scripted agent, no language model yet) | `scripts/s7_agent.sh` (phases setup, bounty, limits) (EVIDENCE, S7) |
| A probe agent learns at most one bit per verdict, capped by the attempt budget K | works (native verdicts, no proofs for the arena) | `scripts/s8_arena.sh`, `scripts/s8_chain.sh` (EVIDENCE, S8) |
| End to end on testnet with a real proof: commit and reveal, proof bound to the on-chain seed and submission id, verdict, two verifiers check the receipt against the chain and attest, researcher paid | works at Level 0 (two registered verifier accounts) | `scripts/s4_testnet.sh` (EVIDENCE, S4/S5) |
| A bounty opens only after the vendor's own reference fix passes the full check (Proof 0) and two verifiers attest it; an over-long secret is refused; junk commits cannot hold the attempt slots after the reveal window; replayed, foreign or contradicted receipts are refused and the researcher is paid by timeout | works on testnet (10 of 11 attacks blocked; sub-accounts filling the slots is an accepted risk, the leak stays at most K bits) | `scripts/s13_attacks.sh <phase>` (EVIDENCE, S13; docs/SECURITY.md) |
| Anyone can rebuild the checker and get the same image id: it is built inside RISC Zero's guest builder Docker image, so the id does not depend on the folder or the user | works on one laptop (two folders and two home folders give the same id); no bounty on chain uses this id yet | `./scripts/check_image_id.sh` (EVIDENCE, "Image id") |
| OutLayer (TEE) as one of the two verifiers | not confirmed on testnet yet: OutLayer accepts our jobs but none has been answered (8 of 8 timed out, by link and as an OutLayer project), while OutLayer's own cached test program answers; the contract recorded nothing, as designed | EVIDENCE, S4/S5 and "OutLayer (Level 1) on testnet" |

## Try it

All commands run from the repository root on Linux x86_64. Versions: [docs/VERSIONS.md](docs/VERSIONS.md).

1. Build everything: `./scripts/build_all.sh` (needs Docker with the buildx plugin: the checker is built inside RISC Zero's
   guest builder image). See it finish with the sizes of the host binary and the contract wasm.
2. Run the checker tests: `cargo test -p kintsugi-check --offline`. See 6 and 13 tests pass (docs/evidence/S13/unit_tests.txt).
3. Print the verdict table for the cheating patches:
   `target/debug/kintsugi-check table --manifest data/attacks/manifest.txt --seed 6b696e74737567692053312064656d6f207365656420412e2e2e2e2e2e2e2e21`.
   See the honest fix PASS and the cheats FAIL (`data/attacks/` holds inert test patches).
4. Run the contract tests: `cargo test -p kintsugi-contract --offline`. See 59 tests pass (docs/evidence/S13/unit_tests.txt).
5. Count the zkVM cycles of one check without proving it:
   `./target/release/kintsugi-host execute data/demo/fixed.wasm --fuzz-count 16 --variants 32 --profile`. See the verdict
   PASS and the cycles per phase.
6. Rebuild the checker and compare its image id with a bounty on the contract:
   `./scripts/check_image_id.sh <contract account> <bounty id>`. Without arguments it prints the rebuilt id, which for the
   current checker is `dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc`. The bounties on testnet so far
   were made with older, non-reproducible builds, so they show DIFFERENT (docs/SECURITY.md, known limits).

## How NEAR fits in

- A Rust contract (near-sdk 5.29.1) holds each bounty, counts attempts (K), applies the deadlines by block time, and pays
  only after two different registered verifiers confirm a verdict, or after a timeout. `contract/src/lib.rs`
- Function call keys let an agent commit and reveal without access to its owner's wallet; attempt fees come from credit held
  in the contract. `scripts/s7_agent.sh`
- OutLayer (TEE) as one verifier is built into the contract (`request_outlayer_check`, `on_outlayer_result` in
  `contract/src/lib.rs`): the contract sends the job itself and accepts only an answer whose echoed values match its own
  record. That trusts the OutLayer contract and its operator, and the contract says so. It has not yet produced an answer on
  testnet (see the table above).

Track hints used: function call keys, agent security.

## Limits

- One verdict tells a researcher at most one bit about the secret; the vendor chooses the budget K.
- RISC Zero states its zero knowledge property is not formally proven.
- The vendor sees each patch before paying; the timeout path protects the researcher.
- Narrow scope: crash bugs in a small module that compiles to WebAssembly.
- Proving is slow on a laptop CPU (see above). Testnet only. No security audit.
