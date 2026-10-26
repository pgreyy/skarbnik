# Skarbnik

Skarbnik (Polish and Ukrainian for treasurer; in folklore, the mine spirit who rewards honest miners).
The testnet contract keeps its original account name.

Fix what you can't see. Get paid when the proof says so.

```
contract: kintsugi-l2-cihdp.testnet
network: NEAR testnet
checker_image_id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
official_demo_bounty: 7
private_demo_bounty: 12
test_bounties: 14, 15, 16
site_url: https://skarbnik-near.vercel.app
feed_url: https://skarbnik-near.vercel.app/feed.json
agent_quickstart_url: https://skarbnik-near.vercel.app/agent-quickstart.txt
site_source: web/index.html
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

### Fast check (a few minutes, no large download)

Run from the root of a clone of this repository. Steps 1 to 4 need only `curl` and `python3`; steps 5 and 6 need the
Rust toolchain (cargo downloads the contract's crates, about 3 minutes the first time).

1. Read the official demo bounty, bounty 7, live from the chain:

       curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kintsugi-l2-cihdp.testnet","method_name":"get_bounty","args_base64":"eyJib3VudHlfaWQiOiI3In0="}}' | python3 -c 'import json,sys; b=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(b["id"], b["level"], b["state"], b["opened"], b["image_id"], b["image_id_allowed"])'

   See: `7 2 Open True dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc True` (Level 2, open, opened by
   its Proof 0, the published checker id, on the allowlist).
2. Compare the checker id on chain with the published one:

       curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kintsugi-l2-cihdp.testnet","method_name":"get_allowed_image_ids","args_base64":"e30="}}' | python3 -c 'import json,sys; ids=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(ids, "MATCH" if ids == ["dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc"] else "DIFFERENT")'

   See: `['dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc'] MATCH` (the contract's allowlist holds only
   the published checker, so a bounty can only name that checker).
3. Read the stored receipts in docs/evidence/receipts/README.md and open their transactions on the explorer:
   - the valid receipt, accepted and paid:
     https://testnet.nearblocks.io/txns/CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY
     See: a successful `submit_groth16` call (36.392 Tgas).
   - the same receipt sent for the wrong bounty:
     https://testnet.nearblocks.io/txns/8fYiFjirrv8N2XKdxzWJA7y8d9izXUwPJ5d5r4NKMahM
     See: a failed `submit_groth16` call, "the journal belongs to another bounty or attempt (submission id)".
4. Open the live site, https://skarbnik-near.vercel.app/#/bounties/7 . See: "Bounty 7", the state OPEN, "Checked by Level 2" and "Demo input",
   read live from testnet. https://skarbnik-near.vercel.app/#/bounties/12 shows "Private secret input"; the list at https://skarbnik-near.vercel.app/#/bounties tags
   test bounties 14, 15 and 16 "Test bounty". The same site runs from this repository with
   `python3 -m http.server 8000 --directory web` and http://localhost:8000/#/bounties/7 .
5. Replay both stored receipts offline:

       cargo test -p kintsugi-contract s1_

   See: `test result: ok. 5 passed`, including `s1_real_attempt_proofs_fail_then_pass ... ok` and
   `s1_the_same_proof_is_refused_on_another_bounty - should panic ... ok`.
6. Run every contract test:

       cargo test -p kintsugi-contract

   See: `test result: ok. 119 passed; 0 failed`.

### Full rebuild (optional)

Warning: this downloads RISC Zero's guest builder image `risczero/risc0-guest-builder:r0.1.97.0`, 7.46 GB, and needs
Docker with buildx, RISC Zero's toolchain (docs/VERSIONS.md) and about 10 GB of free disk. After the download the
rebuild took 5 min 12 s on the development laptop. It rebuilds the checker reproducibly and compares its image id with
the published one and with bounty 12's:

    ./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 12

See, after the build:

    rebuilt checker image id:   dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
    published checker image id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
    image id of bounty 12 on kintsugi-l2-cihdp.testnet: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
    MATCH

(docs/evidence/judge/clean_clone.txt, docs/evidence/judge/check_image_id.txt)

## Run your own agent

The agent in `agent/kintsugi_agent.py` reads `web/feed.json`, picks an open bounty, checks its public code against the
hashes on chain, asks a language model for a fix (NEAR AI Cloud by default; the provider is set in `agent/config.toml`),
builds the fix and runs the public tests on your machine, then commits and reveals it with a key limited to commit and
reveal. Dry run is the default and sends nothing. Run these on your own machine, from the repository folder (testnet):

1. Make the agent's account, credit (0.05 NEAR), limits (max fee 0.02 NEAR per attempt, payout to itself) and limited
   key; this writes `agent/config.local.toml` (ignored by git):

       ./scripts/agent_testnet.sh setup

2. Put the model's API key outside the repository, in the `NEARAI_API_KEY` environment variable or in
   `~/.kintsugi-secrets/nearai_api_key`. The agent never prints it.
3. Build the local checker, then do a dry run:

       cargo build -p kintsugi-check
       python3 -I agent/kintsugi_agent.py run --config agent/config.local.toml

4. Send for real, on one bounty, then check the verdict later:

       python3 -I agent/kintsugi_agent.py run --config agent/config.local.toml --live --bounty <id>
       python3 -I agent/kintsugi_agent.py status --config agent/config.local.toml

The agent stops after `max_attempts` commits, never commits above `max_fee_yocto` or the account's on-chain max fee,
refuses a key that is not limited to commit and reveal, and refuses a fix that would read files or the environment when
it is built. Each run writes a plain log in `target/agent-runs/`: the bounty, the prompt, the fix's hash and size, the
public test result and the transactions sent. Tests without a key: `./scripts/agent_dry_run_test.sh`.

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
| A site: live bounties, bounty pages, the recorded probe arena, how to verify, an operator panel per account, a page for agents, `feed.json` and `agent-quickstart.txt`; Dark and Light themes whose text pairs all reach 4.5:1 (`node scripts/contrast_check.mjs`) | live at https://skarbnik-near.vercel.app (Vercel, built from branch ui-preview with no build step); checked in a browser on the live domain (docs/evidence/web/live_site.txt) | `web/`, `scripts/gen_feed.py`, `scripts/gen_site_recorded.py` (quick check, step 4) |
| Wallet connect on the site through NEAR Connect: Intear Wallet and NEAR CLI (MyNearWallet, retired on 31 October 2026, is not offered). Credit (deposit and withdraw) and attempts (commit, reveal) from the page | NEAR CLI clicked through on testnet (deposit, commit, reveal, withdraw); Intear only loaded | `scripts/web_testnet.sh` and EVIDENCE, "Site: wallet, credit and attempts" |
| An agent driven by a language model (NEAR AI Cloud by default, provider in `agent/config.toml`): reads the feed, checks the public code against the bounty's hashes, asks the model for a fix, builds it, runs the public tests, then commits and reveals with a limited key | works on testnet: on test bounty 16 the model's fix was committed and revealed with the limited key, proven PASS by the vendor and paid (0.1 NEAR plus the fee back); dry run tests 9 of 9 | `./scripts/agent_testnet.sh`, `agent/kintsugi_agent.py` (docs/evidence/agent/live_bounty16/, EVIDENCE "The model-driven agent") |
| The operator panel stops an account's agents with one wallet approval (max fee per attempt set to 0); the next commit by its limited key is refused | works on testnet, through the site with the NEAR CLI wallet | docs/evidence/web/steps/operator_stop_set_limits.txt, operator_stop_commit_refused.txt (docs/SECURITY.md, "The site") |
| A probe agent learns at most one bit per verdict, capped by the attempt budget K | works (native verdicts, no proofs for the arena) | `scripts/s8_arena.sh`, `scripts/s8_chain.sh` (EVIDENCE, S8) |
| Fees of commits never revealed go to a protocol fee pool, never back to the vendor; the pool stays locked as a storage reserve with no withdraw method | works on testnet | `scripts/s6c_testnet.sh selfblock2`, `get_protocol_pool` (EVIDENCE, S6c) |
| Proving cost on a laptop CPU, measured | 345 s to 4,984 s per proof, depending on the patch and the run | docs/numbers.md |

## What is not built

- Level 1 (a hosted checker service, OutLayer). The contract has entry points for it, but OutLayer never answered our
  jobs on testnet (8 of 8 timed out), so no Level 1 verdict exists (EVIDENCE, "OutLayer (Level 1) on testnet").
- On the site: creating a bounty, a proof ledger, setting agent limits from the page.

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
- One account cannot take more than K attempts in total, but nothing stops one person using many accounts; the rising
  fee per attempt and the cap K bound how many yes/no answers anyone can extract per bounty.
- Intear Wallet's script keeps a wallet session key in the browser (it cannot spend on chain); the page's own code holds
  no key (docs/SECURITY.md).
- The contract went through AI review passes; their findings led to seven fixes. The report, with the unfixed findings
  stated as known limits, is [docs/AUDIT.md](docs/AUDIT.md). Guards and limits: [docs/SECURITY.md](docs/SECURITY.md).
- The demo's public source names its bug in a comment, so the demo is an easy task for a model: it shows the agent's
  path from feed to payment, not a model's skill at finding bugs.
- Narrow scope: crash bugs in a small module that compiles to WebAssembly. Proving is slow on a laptop CPU.
- Testnet only, test NEAR, no token. No external security audit.

## Roadmap

- OutLayer as a Level 1 verifier, once its testnet answers.
- Faster proving on a GPU (one rented GPU run was not like for like, see docs/numbers.md).
- On the site: create a bounty, a proof ledger, set agent limits from the page.
- A live bounty on a new original module with its own bug.
- A "crash proven only" mode, for a vendor who can prove the crash but has no fix yet.
- Mainnet: a network switch in the header (Testnet / Mainnet) when the mainnet contract exists.

## More

- How it fits together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Exact tool versions: [docs/VERSIONS.md](docs/VERSIONS.md).
- Work log: [docs/DEVLOG.md](docs/DEVLOG.md). Decisions: [docs/DECISIONS.md](docs/DECISIONS.md).
- Third party files and their licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- NEAR parts: a Rust contract (near-sdk 5.29.1, `contract/src/lib.rs`, `contract/src/groth16.rs`); function call keys for
  agents; credit held in the contract.
