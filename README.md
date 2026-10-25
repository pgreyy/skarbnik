# Kintsugi (working name)

Fix what you can't see. Get paid when the proof says so.

```
contract: kintsugi-l2-cihdp.testnet
network: NEAR testnet
checker_image_id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
official_demo_bounty: 7
private_demo_bounty: 12
test_bounties: 14, 15
site: web/index.html
feed: web/feed.json
agent_quickstart: web/agent-quickstart.txt
numbers: docs/numbers.md
stored_receipts: docs/evidence/receipts/README.md
```

A vendor keeps secret the input that crashes its program. Researchers and AI agents send a patched WebAssembly module.
The vendor checks each patch against the secret inside RISC Zero's zero knowledge virtual machine; the proof says only
PASS or FAIL. A NEAR contract holds the bounty and pays by rule. On a Level 2 bounty the contract checks the Groth16
proof of the RISC Zero result itself. If the vendor stays silent past the deadline, the researcher is paid by default.

On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.

## Judge quick check

Run from the root of a clone of this repository (Linux or macOS with `curl` and `python3`; steps 4 to 6 need the Rust
toolchain; step 7 also needs Docker). Steps 1 to 6 take a few minutes.

1. Read the live demo bounty from the chain:

       curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kintsugi-l2-cihdp.testnet","method_name":"get_bounty","args_base64":"eyJib3VudHlfaWQiOiIxMiJ9"}}' | python3 -c 'import json,sys; b=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(b["id"], b["level"], b["opened"], b["image_id"], b["image_id_allowed"])'

   See: `12 2 True dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc True` (bounty 12, Level 2, opened by
   its own Proof 0, the published checker, on the allowlist).
2. Open the accepted proof on the explorer:
   https://testnet.nearblocks.io/txns/CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY
   See: a successful `submit_groth16` call to `kintsugi-l2-cihdp.testnet`: a real PASS proof the contract checked itself
   and paid (36.392 Tgas).
3. Open the proof for the wrong bounty on the explorer:
   https://testnet.nearblocks.io/txns/8fYiFjirrv8N2XKdxzWJA7y8d9izXUwPJ5d5r4NKMahM
   See: a failed `submit_groth16` call: "the journal belongs to another bounty or attempt (submission id)".
4. Replay both stored receipts offline (docs/evidence/receipts/README.md):

       cargo test -p kintsugi-contract s1_

   See: `test result: ok. 5 passed`, including `s1_real_attempt_proofs_fail_then_pass ... ok` and
   `s1_the_same_proof_is_refused_on_another_bounty - should panic ... ok`.
5. Run every contract test:

       cargo test -p kintsugi-contract

   See: `test result: ok. 119 passed; 0 failed`.
6. Open the site:

       python3 -m http.server 8000 --directory web

   Then open http://localhost:8000/#/bounties/12 (internet needed). See: "Bounty 12", the state OPEN, "Checked by
   Level 2" and "Private secret input", read live from the contract. The list at http://localhost:8000/#/bounties shows
   every bounty; test bounties 14 and 15 carry a "Test bounty" tag.
7. Rebuild the checker and compare its image id (the longest step; needs Docker with buildx and RISC Zero's toolchain,
   docs/VERSIONS.md; the first run also downloads RISC Zero's guest builder image
   `risczero/risc0-guest-builder:r0.1.97.0`, 7.46 GB):

       ./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 12

   See, after the build:

       rebuilt checker image id:   dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
       published checker image id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
       image id of bounty 12 on kintsugi-l2-cihdp.testnet: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
       MATCH

   (5 min 12 s in a fresh clone with an empty cargo cache and the builder image already present;
   docs/evidence/judge/clean_clone.txt).

## What is built

Each claim names the file and the command that show it. Full results, failures included: [docs/EVIDENCE.md](docs/EVIDENCE.md).

| Claim | Status | Shown by |
| --- | --- | --- |
| Level 2: the bounty contract opens and decides a bounty from Groth16 proofs it checks itself with NEAR's alt_bn128 host functions, with no verifier signatures; a proof must belong to that bounty and attempt; replayed, changed, late or repeated proofs are refused | works on testnet: one PASS paid, one FAIL spent, nine attacks refused; 35 to 36.4 Tgas per accepted proof | `scripts/s6c_testnet.sh`, `cargo test -p kintsugi-contract` (EVIDENCE, S6c; docs/numbers.md) |
| Level 0: two different registered verifiers check a receipt against the chain and attest; commit, reveal, verdict, payout, silent vendor timeout, expiry refund | works on testnet | `scripts/s4_testnet.sh`, `scripts/s3_testnet.sh`, `scripts/s3b_testnet.sh` (EVIDENCE, S3, S3b, S4) |
| The checker gives PASS to an honest patch and FAIL to cheating patches (reject everything, special-case the crash, loop forever, memorize the tests, and others) | works, 19 of 20 as expected; the one difference (`memory_grow`) is explained | `cargo test -p kintsugi-check`; `target/debug/kintsugi-check table --manifest data/attacks/manifest.txt --seed <hex>` (EVIDENCE, S1) |
| A bounty opens only after the vendor's own reference fix passes the full check (Proof 0) | works on testnet (Level 0: two verifiers attest; Level 2: the contract checks Proof 0 itself) | `scripts/s13_attacks.sh`, `scripts/s18_live_bounty.sh` (EVIDENCE, S13, S18) |
| Anyone can rebuild the checker and get the published image id | works: `MATCH` for bounty 12 | `./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 12` (docs/evidence/judge/check_image_id.txt) |
| A live Level 2 bounty whose secret input is not in the repository, with a private salt | works on testnet: bounty 12 | `scripts/s18_live_bounty.sh` (EVIDENCE, S18) |
| Attempt fees are taken from credit deposited in the contract first; unspent credit can be withdrawn with a wallet approval (1 yoctoNEAR) | works on testnet | `scripts/web_testnet.sh` (EVIDENCE, "Site: wallet, credit and attempts") |
| An agent's limited key (commit and reveal only) cannot withdraw or change limits; with `set_agent_limits` it cannot spend more than the chosen fee per attempt or send winnings elsewhere; it can still spend the whole credit over many attempts | works on testnet on this contract | `./scripts/web_testnet.sh agentkey`, unit tests `audit_s6_*` (EVIDENCE, "Site: wallet, credit and attempts") |
| A site: live bounties, bounty pages, the recorded probe arena, how to verify, an Account page per account, a page for agents, `feed.json` and `agent-quickstart.txt` | works locally, not hosted | `web/`, `scripts/gen_feed.py`, `scripts/gen_site_recorded.py` (quick check, step 6) |
| Wallet connect on the site through NEAR Connect: Intear Wallet and NEAR CLI; MyNearWallet only until it is retired on 31 October 2026. Credit (deposit and withdraw) and attempts (commit, reveal) from the page | NEAR CLI clicked through on testnet (deposit, commit, reveal, withdraw); Intear and MyNearWallet only loaded | `scripts/web_testnet.sh` and EVIDENCE, "Site: wallet, credit and attempts" |
| A probe agent learns at most one bit per verdict, capped by the attempt budget K | works (native verdicts, no proofs for the arena) | `scripts/s8_arena.sh`, `scripts/s8_chain.sh` (EVIDENCE, S8) |
| Fees of commits never revealed go to a protocol fee pool, never back to the vendor; the pool stays locked as a storage reserve with no withdraw method | works on testnet | `scripts/s6c_testnet.sh selfblock2`, `get_protocol_pool` (EVIDENCE, S6c) |
| Proving cost on a laptop CPU, measured | 345 s to 4,984 s per proof, depending on the patch and the run | docs/numbers.md |

## What is not built

- Level 1 (a hosted checker service, OutLayer). The contract has entry points for it, but OutLayer never answered our
  jobs on testnet (8 of 8 timed out), so no Level 1 verdict exists (EVIDENCE, "OutLayer (Level 1) on testnet").
- On the site: creating a bounty, a proof ledger, setting agent limits from the page.
- An agent driven by a language model (the agent runs are scripted).

## Known limits

- One verdict tells a researcher at most one bit about the secret; the vendor chooses the budget K.
- RISC Zero states its zero knowledge property is not formally proven.
- The vendor sees each patch before paying. If it stays silent, the bounty is split equally among every revealed
  attempt still waiting. In the worst case an honest fix gets only 1/K of the bounty (the vendor's own accounts fill the
  other slots with junk), and a copy of a revealed fix gets an equal share. This is still better than the old rule,
  under which the honest researcher could get nothing (docs/AUDIT.md, finding 3 and hardening S7).
- Bounty 12 keeps its secret private but uses the public demo bug: anyone can submit the public `fixed.wasm`, and a
  silent vendor's timeout can pay without any proof. Bounty 7 and the other demo bounties use the public demo input.
- A payout to an account that does not exist is lost (docs/AUDIT.md, finding 8); the site and
  `scripts/agent_preflight.sh` refuse such an account before sending.
- Intear Wallet's script keeps a wallet session key in the browser (it cannot spend on chain); the page's own code holds
  no key (docs/SECURITY.md).
- The contract went through AI review passes; their findings led to seven fixes. The report, with the unfixed findings
  stated as known limits, is [docs/AUDIT.md](docs/AUDIT.md). Guards and limits: [docs/SECURITY.md](docs/SECURITY.md).
- Narrow scope: crash bugs in a small module that compiles to WebAssembly. Proving is slow on a laptop CPU.
- Testnet only, test NEAR, no token. No external security audit.

## Roadmap

- OutLayer as a Level 1 verifier, once its testnet answers.
- An agent driven by a language model in place of the scripted one.
- Faster proving on a GPU (one rented GPU run was not like for like, see docs/numbers.md).
- On the site: create a bounty, a proof ledger, set agent limits from the page.
- A live bounty on a new original module with its own bug.
- A "crash proven only" mode, for a vendor who can prove the crash but has no fix yet.

## More

- How it fits together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Exact tool versions: [docs/VERSIONS.md](docs/VERSIONS.md).
- Work log: [docs/DEVLOG.md](docs/DEVLOG.md). Decisions: [docs/DECISIONS.md](docs/DECISIONS.md).
- NEAR parts: a Rust contract (near-sdk 5.29.1, `contract/src/lib.rs`, `contract/src/groth16.rs`); function call keys for
  agents; credit held in the contract.
