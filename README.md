# Kintsugi (working name)

Fix a bug you are not allowed to see. A vendor keeps the input that crashes its program secret. Researchers, including AI
agents, submit a patched WebAssembly module. The vendor checks each patch against the secret inside a RISC Zero zero
knowledge virtual machine; the proof says only PASS or FAIL. A NEAR contract holds the bounty and pays by rule, and pays the
researcher by default if the vendor stays silent.

On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.

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
| Bounty contract on NEAR testnet: commit, reveal, verdict, two different verifiers, payout; silent vendor timeout; expiry refund | works | `cargo test -p kintsugi-contract --offline` (119 tests); `scripts/s3_testnet.sh`, `scripts/s3b_testnet.sh` (EVIDENCE, S3, S3b) |
| Attempt fees paid from prepaid credit; fees of decided attempts go to the verifiers (Level 0) or the protocol fee pool (Level 2), fees of undecided attempts are refunded when a bounty closes, fees of commits never revealed go to the pool | works on testnet | `scripts/s3b_testnet.sh` (EVIDENCE, S3b) |
| An agent key that can only `commit` and `reveal` cannot reach its owner's wallet. If the owner sets `set_agent_limits` (with the full access key and 1 yoctoNEAR, which the agent key cannot attach), the agent key cannot spend more than the chosen fee on one attempt, and its winnings can only go to the chosen payout account. It can still spend all the deposited credit over many attempts, and without limits set it can spend all of it on one attempt | works on testnet (scripted agent, no language model yet) | `scripts/s7_agent.sh` (phases setup, bounty, limits) (EVIDENCE, S7); `scripts/hardening_testnet.sh limits` and unit tests `audit_s6_*` (EVIDENCE, hardening) |
| A probe agent learns at most one bit per verdict, capped by the attempt budget K | works (native verdicts, no proofs for the arena) | `scripts/s8_arena.sh`, `scripts/s8_chain.sh` (EVIDENCE, S8) |
| End to end on testnet with a real proof: commit and reveal, proof bound to the on-chain seed and submission id, verdict, two verifiers check the receipt against the chain and attest, researcher paid | works at Level 0 (two registered verifier accounts) | `scripts/s4_testnet.sh` (EVIDENCE, S4/S5) |
| A bounty opens only after the vendor's own reference fix passes the full check (Proof 0) and two verifiers attest it; an over-long secret is refused; junk commits cannot hold the attempt slots after the reveal window; replayed, foreign or contradicted receipts are refused and the researcher is paid by timeout | works on testnet (10 of 11 attacks blocked; sub-accounts filling the slots is an accepted risk, the leak stays at most K bits) | `scripts/s13_attacks.sh <phase>` (EVIDENCE, S13; docs/SECURITY.md) |
| Anyone can rebuild the checker and get the same image id: it is built inside RISC Zero's guest builder Docker image, so the id does not depend on the folder or the user | works: the demo bounty 4 on `kintsugi-s13-tlryo.testnet` holds the reproducible id and the rebuild prints MATCH (shown on one laptop; two folders and two home folders give the same id) | `./scripts/check_image_id.sh kintsugi-s13-tlryo.testnet 4` (EVIDENCE, "Demo bounty" and "Image id") |
| A receipt shrinks to a 2,057 byte Groth16 proof (the kind a contract could check itself) on the laptop CPU, and it verifies against the checker's image id | works on the laptop (187.91 s, about 7 GiB of memory); the contract does not check it yet (design note in docs/ARCHITECTURE.md) | `kintsugi-host compress <succinct receipt> <out> groth16`, then `kintsugi-host verify <out>` (EVIDENCE, S6) |
| A NEAR contract checks a RISC Zero Groth16 proof itself with NEAR's alt_bn128 host functions: it accepts the real proof and rejects a flipped bit, a changed journal and a wrong image id | works on testnet as a separate spike contract (34.569 Tgas per call); not connected to the bounty contract or its payouts yet | `scripts/s6b_testnet.sh` and `cargo test -p kintsugi-groth16-spike` (EVIDENCE, S6b) |
| Level 2 bounties: the bounty contract opens and decides a bounty from Groth16 proofs it checks itself, with no verifier signatures; a proof must belong to that bounty and attempt, and replayed, changed, late or repeated proofs are refused | works on testnet (`kintsugi-l2-cihdp.testnet`: one PASS paid, one FAIL spent, nine attacks refused; 35 to 36 Tgas per proof); Level 0 bounties work as before; each bounty shows its level | `scripts/s6c_testnet.sh` and `cargo test -p kintsugi-contract --offline` (EVIDENCE, S6c) |
| Fees of commits that are never revealed go to a protocol fee pool, never back to the vendor, so a vendor cannot block its own bounty for free | works on testnet: in the self-block test the vendor side lost 0.045 NEAR in fees and the pool gained exactly 0.045 NEAR; the pool stays locked in the contract as a storage reserve, with no withdraw method (owner's decision, docs/SECURITY.md) | `scripts/s6c_testnet.sh selfblock2`, `get_protocol_pool` (EVIDENCE, S6c) |
| A live Level 2 bounty whose secret crashing input is not in the repository and whose commitment uses a private salt. It proves the secret stays private; it uses the public demo bug, so anyone can submit the public `fixed.wasm`, and if the vendor stays silent the timeout rule can pay out without any proof | works on testnet: bounty 12 on `kintsugi-l2-cihdp.testnet`, opened by its own Proof 0; `check_image_id.sh` prints MATCH | `scripts/s18_live_bounty.sh` (EVIDENCE, S18) |
| A site that shows every bounty of the testnet contract live (state, level, attempts used of the cap, next fee, deadlines, image id, slots), the recorded probe agent runs, and the steps to verify a result; a machine readable feed and a plain text quickstart for agents | works locally (not hosted yet) | `web/`, `scripts/gen_feed.py`, `scripts/gen_site_recorded.py`; Try it, step 7 |
| On the site, with a testnet wallet (MyNearWallet): connect, see and use credit (deposit_credit, withdraw_credit), and send an attempt (commit, then reveal, then wait for the vendor's proof); each payment has a confirm step and is approved in the wallet; the page holds no key | the contract calls and the page's commit fingerprint work on testnet with a throwaway account; the wallet approval window itself was not run by a script | `scripts/web_testnet.sh` (EVIDENCE, "Site: wallet, credit and attempts") |
| OutLayer (TEE) as one of the two verifiers | not confirmed on testnet yet: OutLayer accepts our jobs but none has been answered (8 of 8 timed out, by link and as an OutLayer project), while OutLayer's own cached test program answers; the contract recorded nothing, as designed | EVIDENCE, S4/S5 and "OutLayer (Level 1) on testnet" |

## Try it

All commands run from the repository root on Linux x86_64. Versions: [docs/VERSIONS.md](docs/VERSIONS.md).

**The demo bounty** is bounty 7 on `kintsugi-l2-cihdp.testnet` (NEAR testnet): a Level 2 bounty, decided only by
Groth16 proofs the contract checks itself, open until 2026-11-24 00:19 UTC (EVIDENCE, "Official demo"). It is a
DEMO: its secret's commitment uses the public fixed demo salt (`--demo-salt`), which makes the secret's fingerprint
guessable when the secret is short or predictable. A real vendor uses the default, a private random salt per bounty
(`kintsugi-host prove ... --bounty <name>`). Older bounties (S4, S7, S13, demo bounty 4) are kept as history.

1. Build everything: `./scripts/build_all.sh` (needs Docker with the buildx plugin: the checker is built inside RISC Zero's
   guest builder image). See it finish with the sizes of the host binary and the contract wasm.
2. Run the checker tests: `cargo test -p kintsugi-check --offline`. See 6 and 13 tests pass (docs/evidence/S13/unit_tests.txt).
3. Print the verdict table for the cheating patches:
   `target/debug/kintsugi-check table --manifest data/attacks/manifest.txt --seed 6b696e74737567692053312064656d6f207365656420412e2e2e2e2e2e2e2e21`.
   See the honest fix PASS and the cheats FAIL (`data/attacks/` holds inert test patches).
4. Run the contract tests: `cargo test -p kintsugi-contract --offline`. See 119 tests pass (docs/evidence/hardening/contract_unit_tests.txt).
5. Count the zkVM cycles of one check without proving it:
   `./target/release/kintsugi-host execute data/demo/fixed.wasm --fuzz-count 16 --variants 32 --profile --demo-salt`. See the verdict
   PASS and the cycles per phase.
6. Rebuild the checker and compare its image id with a bounty on the contract:
   `./scripts/check_image_id.sh <contract account> <bounty id>`. Without arguments it prints the rebuilt id, which for the
   current checker is `dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc`. Try it on the demo bounty:
   `./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 7`. See MATCH (open until 2026-11-24). Bounties made before the
   reproducible build (S4, S7, S13) show DIFFERENT (docs/SECURITY.md, known limits).

7. Open the site: `python3 -m http.server 8000 --directory web`, then open http://localhost:8000 in a browser. See the
   intro, then the live bounties read from `kintsugi-l2-cihdp.testnet` (internet needed). "Connect wallet" signs in
   with a MyNearWallet testnet account. To refresh the agent feed:
   `python3 -I scripts/gen_feed.py`; to rebuild the recorded data from the evidence files:
   `python3 -I scripts/gen_site_recorded.py`.

## How NEAR fits in

- A Rust contract (near-sdk 5.29.1) holds each bounty, counts attempts (K), applies the deadlines by block time, and pays
  by rule: on a Level 2 bounty only after a Groth16 proof that the contract checks itself with NEAR's alt_bn128 host
  functions; on a Level 0 bounty after two different registered verifiers confirm a verdict; on either, after a timeout.
  `contract/src/lib.rs`, `contract/src/groth16.rs`
- Function call keys let an agent commit and reveal without access to its owner's wallet; attempt fees come from credit held
  in the contract. `scripts/s7_agent.sh`
- OutLayer (TEE) as one verifier is built into the contract (`request_outlayer_check`, `on_outlayer_result` in
  `contract/src/lib.rs`): the contract sends the job itself and accepts only an answer whose echoed values match its own
  record. That trusts the OutLayer contract and its operator, and the contract says so. It has not yet produced an answer on
  testnet (see the table above).

Track hints used: function call keys, agent security.

## Roadmap

Built today (each part has its proof in the table above):

- A checker that runs a fix against the hidden crash input, the public tests and extra seeded inputs inside RISC Zero,
  and gives PASS or FAIL with a receipt anyone can verify.
- A NEAR contract on testnet that takes commits and reveals, collects the vendor's verdict and two verifiers'
  attestations, and pays by rule, including by default when the vendor stays silent.
- Guards against the attacks listed in [docs/SECURITY.md](docs/SECURITY.md).
- A reproducible build of the checker, so anyone can rebuild it and compare its image id with the one a bounty names.
- The contract checking the proof itself (Level 2), so no verifier has to be trusted for the verdict when the bounty's
  image id is the published checker (on the owner's allowlist).
- A site (`web/`): live bounties, the recorded probe arena, how to verify, a feed and a quickstart for agents; with a
  testnet wallet: credit (deposit and withdraw) and sending attempts; a read only agent check page.

Planned next:

- OutLayer as one of the verifiers, once its testnet answers our jobs.
- An agent driven by a language model in place of the scripted one.
- Faster proving on a GPU.
- On the site (planned, not built):
  - create a bounty;
  - a proof ledger;
  - set agent limits from the page (set_agent_limits; today only by command line).
- A live bounty on a new original module with its own bug (bounty 12 reuses the public demo bug).
- After the audit: a "crash proven only" mode, for a vendor who can prove the crash but has no fix yet.

## Limits

- One verdict tells a researcher at most one bit about the secret; the vendor chooses the budget K.
- RISC Zero states its zero knowledge property is not formally proven.
- The vendor sees each patch before paying. If it stays silent, the bounty is split equally among every revealed
  attempt still waiting for a verdict. In the worst case an honest fix gets only 1/K of the bounty (the vendor's own
  accounts fill the other slots with junk), and a copy of a revealed fix gets an equal share. This is still better than
  the old rule, under which the honest researcher could get nothing (docs/AUDIT.md, finding 3 and hardening S7).
- Live bounty 12 keeps its secret private but uses the public demo bug: anyone can submit the public `fixed.wasm`, and a
  silent vendor's timeout can pay without any proof. A new original module with its own bug is a possible later
  improvement.
- The contract went through AI review passes; their findings led to seven fixes (six in the first round, one after the
  final review). The report, with the unfixed findings stated as known limits, is [docs/AUDIT.md](docs/AUDIT.md).
- Narrow scope: crash bugs in a small module that compiles to WebAssembly.
- Proving is slow on a laptop CPU (see above). Testnet only. No external security audit.
