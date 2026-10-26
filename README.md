# Skarbnik

Skarbnik lets outside researchers, including AI agents, fix a crash in a program without ever seeing the secret input
that causes it. The vendor proves each fix against the secret inside a RISC Zero zero knowledge machine, and a NEAR
contract checks that proof itself and pays the bounty by rule.

**The problem.** A vendor who knows a crashing input cannot publish it (attackers would learn it) and cannot ask outsiders to
fix a bug they cannot test, and a researcher has no way to make the vendor pay once the fix is handed over.

**How NEAR fits.** The bounty money, the deadlines and the payout rules live in a NEAR contract. On a Level 2 bounty the
contract checks the Groth16 proof of the RISC Zero result itself with NEAR's alt_bn128 host functions (about 35 Tgas). An
AI agent takes part through a NEAR function call key that may only call `commit` and `reveal`, paying fees from credit held
in the contract, so it can never reach its owner's wallet. If the vendor stays silent past the deadline, the contract pays
the researcher anyway.

Skarbnik (Polish and Ukrainian for treasurer; in folklore, the mine spirit who rewards honest miners) was built under the
working name Kintsugi; the testnet contract keeps that name. Mainnet: skarbnik.near.

On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.

```
site_url: https://skarbnik.xyz
contract: kintsugi-l2-cihdp.testnet
network: NEAR testnet
checker_image_id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
official_demo_bounty: 7
private_demo_bounty: 12
judge_bounties_closed_at_writing: 19, 20, 21, 22
paid_by_proof: 1, 16
paid_by_timeout: 4, 8, 9, 11, 13, 17
feed_url: https://skarbnik.xyz/feed.json
agent_quickstart_url: https://skarbnik.xyz/agent-quickstart.txt
numbers: docs/numbers.md
receipts: docs/evidence/receipts/README.md
handoff: docs/handoff/README.md
```

## Try it

Run these from the root of a fresh clone (`git clone https://github.com/pgreyy/skarbnik && cd skarbnik`). Steps 1 to 4
need only `curl` and `python3`. Steps 5 and 6 need near-cli-rs 0.30.1 and a testnet account. Step 8 needs the Rust
toolchain. Steps 9 and 10 are optional and need Docker.

1. **Read the official demo bounty from the chain.**

       curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kintsugi-l2-cihdp.testnet","method_name":"get_bounty","args_base64":"eyJib3VudHlfaWQiOiI3In0="}}' | python3 -c 'import json,sys; b=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(b["id"], b["level"], b["state"], b["opened"], b["image_id"], b["image_id_allowed"])'

   See: `7 2 Open True dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc True` (Level 2, open, opened by
   its Proof 0, the published checker id, on the allowlist).

2. **Check that the contract accepts only the published checker.**

       curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kintsugi-l2-cihdp.testnet","method_name":"get_allowed_image_ids","args_base64":"e30="}}' | python3 -c 'import json,sys; ids=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(ids, "MATCH" if ids == ["dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc"] else "DIFFERENT")'

   See: `['dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc'] MATCH`.

3. **See which judge bounties are still closed.** Judge bounties 18 to 22 have the same hashes as private bounty 17 and
   were created closed, so anyone can open one with a real proof (step 5). Each can be opened once.

       for i in 18 19 20 21 22; do curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"kintsugi-l2-cihdp.testnet\",\"method_name\":\"get_bounty\",\"args_base64\":\"$(printf '{"bounty_id":"%s"}' $i | base64)\"}}" | python3 -c 'import json,sys; b=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(b["id"], "opened" if b["opened"] else "closed")'; done

   See, as of 2026-10-26: `18 opened` (opened by our test from a throwaway account, tx
   [`GhjkpLgkcwUbnWA743FezQEx8WLLXxCtvA7vT9eCfWdb`](https://testnet.nearblocks.io/txns/GhjkpLgkcwUbnWA743FezQEx8WLLXxCtvA7vT9eCfWdb),
   35.247 Tgas), then `19 closed`, `20 closed`, `21 closed`, `22 closed`. A bounty another judge opened shows `opened`.

4. **Open the live site.** https://skarbnik.xyz/#/bounties/7 shows "Bounty 7", the state OPEN, "Checked by Level 2" and
   "Demo input", read live from testnet. https://skarbnik.xyz/#/bounties/17 shows "Paid by timeout" with the claim link.
   The same site runs from this clone with `python3 -m http.server 8000 --directory web` and http://localhost:8000/#/bounties/7 .

5. **Open a closed judge bounty with a real proof, from your own account.** Make a testnet account from the faucet, then
   send bounty 17's stored Groth16 Proof 0 to one bounty that step 3 shows as closed (here 19; use 20, 21 or 22 if 19 is
   already open). The contract checks the proof on chain and opens the bounty.

       near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
       near contract call-function as-transaction kintsugi-l2-cihdp.testnet open_with_groth16 file-args docs/evidence/receipts/judge_open_19.json prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as <you>.testnet network-config testnet sign-with-legacy-keychain send

   See: the log line `EVENT_JSON:{"standard":"kintsugi","version":"1.0.0","event":"bounty_opened","data":[{"bounty_id":"19","by":"groth16","caller":"<you>.testnet"}]}`
   and the return value `"opened"`; about 35 Tgas burned in total (the pairing check alone is about 30 Tgas). Step 3 then
   shows `19 opened`. Sent again, the same call is refused: "bounty is already open" (tx
   [`BVMoi97TTU9bZDqNukW8Loor6dcBocyWHdtVff9Kx1dg`](https://testnet.nearblocks.io/txns/BVMoi97TTU9bZDqNukW8Loor6dcBocyWHdtVff9Kx1dg)).

6. **See the contract refuse a proof at the proof check itself.** `judge_refuse_<id>.json` holds bounty 17's real Proof 0
   journal (so every cheaper check passes) with the seal of another real Groth16 proof (the demo's Proof 0). Send it to a
   closed judge bounty; it stays closed, so this step can be repeated.

       near contract call-function as-transaction kintsugi-l2-cihdp.testnet open_with_groth16 file-args docs/evidence/receipts/judge_refuse_22.json prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as <you>.testnet network-config testnet sign-with-legacy-keychain send

   See: `Smart contract panicked: the Groth16 proof does not verify for this bounty's image id and this journal`. Our run:
   tx [`5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj`](https://testnet.nearblocks.io/txns/5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj),
   34.856 Tgas burned: the pairing check ran (refusals from the earlier state checks cost about 2 Tgas).

7. **See the attempt cap stop a probe agent.** A seeded probe account sent 12 probe commits to bounty 23 (the real cap
   K = 3 and rising fee); the contract counted 3 and ignored 9 at no cost, so at most 3 of the 12 bits of the probe's
   target could ever be learned. The same probe with no cap, simulated on our machine only, learned all 12.

       curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kintsugi-l2-cihdp.testnet","method_name":"get_bounty","args_base64":"eyJib3VudHlfaWQiOiIyMyJ9"}}' | python3 -c 'import json,sys; b=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(b["id"], b["commits"], b["max_commits"], b["fees_collected"])'

   See: `23 3 3 45000000000000000000000` (3 commits counted of a cap of 3, 0.045 NEAR of fees: 0.01, 0.015 and 0.02). Both
   runs side by side, labelled real and simulated: https://skarbnik.xyz/#/arena (docs/evidence/arena_probe/).

8. **Run the contract's tests** (cargo downloads the contract's crates, about 3 minutes the first time). They include the
   two real attempt proofs of bounty 1 from testnet, checked natively.

       cargo test -p kintsugi-contract

   See: `test result: ok. 119 passed; 0 failed`.

9. **Optional: rebuild the checker and compare its image id.** Downloads RISC Zero's guest builder image
   `risczero/risc0-guest-builder:r0.1.97.0` (7.46 GB) and needs Docker with buildx, RISC Zero's toolchain
   (docs/VERSIONS.md) and about 10 GB of free disk.

       ./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 17

   See, after the build:

       rebuilt checker image id:   dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
       published checker image id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
       image id of bounty 17 on kintsugi-l2-cihdp.testnet: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
       MATCH

   (docs/evidence/check_image_id_after_rename.txt)

10. **Optional: check the stored receipt on your machine.** After step 9:

       cargo build --release -p skarbnik-host
       ./target/release/skarbnik-host verify docs/evidence/receipts/bounty17_proof0_groth16.bin

   See (first lines; full output in docs/evidence/judge/verify_bounty17_proof0.txt):

       receipt file: docs/evidence/receipts/bounty17_proof0_groth16.bin (2057 bytes)
       image id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
       VALID
       journal sha256: cc7aeb44e12433964ba9ff1b76a0207a5c78d3e3b5e46d8dc2d3c462554efaef
       journal.verdict: PASS

   The journal sha256 equals bounty 17's `proof0_journal_hash` on chain (`get_bounty`).

## Numbers (measured)

Development laptop: 13th Gen Intel Core i7-1360P, 16 logical CPUs, 10 GiB visible to Linux (WSL2), no GPU; RISC Zero
3.0.6, CPU proving; check size 16 fairness inputs and 32 crash variants. Full table with sources: docs/numbers.md.

| What | Measured | Source |
| --- | --- | --- |
| Prove a passing fix (demo program, 26 segments at `--po2 19`) | 2,814 to 3,645 s | `docs/evidence/S2b/prove_f16_alloc.txt`, `docs/evidence/S6c/prove_a0.log`, `docs/evidence/agent/prove_0.log` |
| Prove a failing patch (3 segments) | 345 to 511 s | `docs/evidence/S6c/prove_a1.log`, `docs/evidence/audit1/prove_j.log` |
| Prove bounty 17's attempt (new program, 102 segments at `--po2 18`) | 6,530.99 s | `docs/evidence/agent/prove_u0.log` |
| Compress to one succinct receipt | 921 to 1,497 s | docs/numbers.md |
| Groth16 wrap (Docker) | 107 to 189 s | docs/numbers.md |
| Prover peak memory | about 4.7 GiB at `--po2 19`, 2.4 GiB at `--po2 18`; Groth16 container 6.5 to 7.3 GiB | docs/numbers.md, `docs/evidence/agent/prove_u0.log` |
| Proof size | composite 7 to 33 MB; succinct 224,786 bytes; Groth16 2,057 bytes (the contract reads a 256 byte seal and a 780 byte journal) | docs/numbers.md |
| Gas per on-chain verification | 35.2 to 36.4 Tgas per accepted proof; 34.856 Tgas for a proof refused at the pairing check | `docs/evidence/S6c/gas_level2.txt`, step 6 above |

## What is built

Each claim names the file and the command that show it. Full results, failures included: [docs/EVIDENCE.md](docs/EVIDENCE.md).

| Claim | Status | Shown by |
| --- | --- | --- |
| Level 2: the contract opens and decides a bounty from Groth16 proofs it checks itself, with no verifier signatures; a proof must belong to that bounty and attempt; replayed, changed, late or repeated proofs are refused | works on testnet: one PASS paid, one FAIL spent, nine attacks refused; anyone can open a judge bounty (steps 5 and 6) | `scripts/s6c_testnet.sh`, `scripts/judge_bounties.sh`, `cargo test -p kintsugi-contract` (EVIDENCE, S6c and "Judge bounties") |
| Paid by proof versus paid by timeout | bounties 1 and 16 were paid by a proof (`submit_groth16` PASS); bounties 4, 8, 9, 11, 13 and 17 were paid by the timeout rule, with no proof checked for the paid attempt; the site shows those as "Paid by timeout" | `docs/handoff/04-testnet-state.md`; the bounty pages |
| An agent driven by a language model (NEAR AI Cloud by default): reads the feed, checks the public code against the bounty's hashes, asks the model for a fix, builds it, runs the public tests, commits and reveals with a limited key | works on testnet: on test bounty 16 the model's fix was proven PASS and paid; on private bounty 17 (a new program, secret and reference fix outside the repository) the model's fix was the reference fix byte for byte, but the vendor's proof did not finish inside the verdict window, so it was **paid by timeout, not by a proof** | `agent/skarbnik_agent.py`; EVIDENCE "The model-driven agent", "Private bounty 17" |
| The checker gives PASS to an honest patch and FAIL to cheating patches | 19 of 20 as expected; the one difference (`memory_grow`) is explained | `cargo test -p kintsugi-check`; EVIDENCE, S1 |
| A bounty opens only after the vendor's own reference fix passes the full check (Proof 0) | works on testnet | `scripts/s13_attacks.sh`, `scripts/s18_live_bounty.sh` (EVIDENCE, S13, S18) |
| Anyone can rebuild the checker and get the published image id | MATCH | step 9 |
| Level 0: two registered verifiers check a receipt and attest | works on testnet; all verifier accounts are run by the project | `scripts/s4_testnet.sh` (EVIDENCE, S4) |
| An agent's limited key cannot withdraw, change limits or exceed its fee limit; the operator panel's stop button stops it | works on testnet | `./scripts/web_testnet.sh agentkey`; docs/SECURITY.md, "The site" |
| A site with live bounties, bounty pages, the arena, how to verify, an operator panel, a page for agents, `feed.json` | live at https://skarbnik.xyz (Vercel, branch ui-preview, no build step), checked in a browser on the live domain | `web/`; docs/evidence/web/live_domain_2026-10-26.txt |
| Wallets through NEAR Connect, every wallet script pinned by sha256 | NEAR CLI clicked through on testnet (deposit, commit, reveal, withdraw); Meteor, Intear, Ledger, MyNearWallet (until it closes on 31 October 2026), Nightly and Ethereum Wallets only loaded | docs/evidence/web/wallets_2026-10-26.txt |
| A probe agent learns at most one bit per verdict, capped by the attempt budget K | works: recorded run with native verdicts (S8); a real run on testnet where the contract counted 3 of 12 probe commits (at most 3 of 12 bits); the same probe with no cap, simulated only, learned all 12 bits | `scripts/s8_arena.sh`, `scripts/arena_probe.sh` (EVIDENCE, S8 and "Arena: guarded and unguarded"; step 7) |
| Fees of commits never revealed go to a protocol fee pool, never to the vendor | works on testnet | `get_protocol_pool` (EVIDENCE, S6c) |
| A Proof Ledger: every paid account, each paid fix with how it was paid (proof or timeout) and its transaction, each vendor's on-time record, distinct counterparties; every account is labelled team-run or seeded (all of them are today) | live, read from the chain | https://skarbnik.xyz/#/ledger, `web/ledger.json` (`node scripts/gen_ledger.mjs`) |

## What is not built

- **Level 1 is not built as a working path.** The contract has entry points for an OutLayer verifier, but OutLayer never
  answered our jobs on testnet (8 of 8 timed out), so no Level 1 verdict exists (EVIDENCE, "OutLayer (Level 1) on testnet").
- On the site: creating a bounty, setting agent limits from the page.
- A mainnet contract.

## Known limits

- The contract was checked by AI review passes, not by an independent security audit. Their findings led to seven fixes;
  the unfixed findings are stated as known limits in [docs/AUDIT.md](docs/AUDIT.md) and [docs/SECURITY.md](docs/SECURITY.md).
- The contract account still has a full access key, so its code can still be replaced (planned to be removed last).
- One verdict tells a researcher at most one bit about the secret; the vendor chooses the budget K.
- If the vendor stays silent, the bounty is split equally among every revealed attempt still waiting, whatever they
  contain. In the worst case an honest fix gets only 1/K of the bounty (docs/AUDIT.md, finding 3 and hardening S7).
- Proving is slow on a laptop CPU: one passing proof with compression takes 1 to 2 hours, which is why bounty 17 was paid
  by timeout.
- Bounty 12 keeps its secret private but uses the public demo bug. Bounty 7 and the demo bounties use the public demo input.
- A payout to an account that does not exist is lost (docs/AUDIT.md, finding 8); the site and
  `scripts/agent_preflight.sh` refuse such an account before sending.
- One person can use many accounts; the rising fee per attempt and the cap K bound how many yes or no answers anyone can
  extract per bounty.
- Intear Wallet's script keeps a wallet session key in the browser (it cannot spend on chain); the page's own code holds
  no key.
- RISC Zero states its zero knowledge property is not formally proven. Narrow scope: crash bugs in a small module that
  compiles to WebAssembly. Testnet only, test NEAR, no token.

## Run your own agent

The agent in `agent/skarbnik_agent.py` reads `web/feed.json`, picks an open bounty, checks its public code against the
hashes on chain, asks a language model for a fix (NEAR AI Cloud by default; the provider is set in `agent/config.toml`),
builds the fix and runs the public tests on your machine, then commits and reveals it with a key limited to commit and
reveal. Dry run is the default and sends nothing. Run these on your own machine, from the repository folder (testnet):

1. Make the agent's account, credit (0.05 NEAR), limits (max fee 0.02 NEAR per attempt, payout to itself) and limited
   key; this writes `agent/config.local.toml` (ignored by git):

       ./scripts/agent_testnet.sh setup

2. Put the model's API key outside the repository, in the `NEARAI_API_KEY` environment variable or in
   `~/.skarbnik-secrets/nearai_api_key`. The agent never prints it.
3. Build the local checker, then do a dry run:

       cargo build -p kintsugi-check
       python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml

4. Send for real, on one bounty, then check the verdict later:

       python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml --live --bounty <id>
       python3 -I agent/skarbnik_agent.py status --config agent/config.local.toml

The agent stops after `max_attempts` commits, never commits above `max_fee_yocto` or the account's on-chain max fee,
refuses a key that is not limited to commit and reveal, and refuses a fix that would read files or the environment when
it is built. Tests without a key: `./scripts/agent_dry_run_test.sh`.

## Roadmap

- Faster vendor proving on a rented GPU, so a proof fits the verdict window (the setup is written, not yet run on a pod).
- OutLayer as a Level 1 verifier, once its testnet answers.
- On the site: create a bounty, set agent limits from the page.
- A "crash proven only" mode, for a vendor who can prove the crash but has no fix yet.
- Mainnet, with a network switch in the header.

## More

- Handoff for a new maintainer: [docs/handoff/README.md](docs/handoff/README.md). How it fits together:
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Exact tool versions: [docs/VERSIONS.md](docs/VERSIONS.md).
- Work log: [docs/DEVLOG.md](docs/DEVLOG.md). Decisions: [docs/DECISIONS.md](docs/DECISIONS.md).
- Third party files and their licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- NEAR parts: a Rust contract (near-sdk 5.29.1, `contract/src/lib.rs`, `contract/src/groth16.rs`); function call keys for
  agents; credit held in the contract.
