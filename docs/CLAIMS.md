# Claims: what is shown, what is built, what is not

Each claim names the file and the command that show it. Full results, failures included: [EVIDENCE.md](EVIDENCE.md).
The short version is in the [README](../README.md); every claim with its status is also in [JUDGE_GUIDE.md](../JUDGE_GUIDE.md).

## What is shown, and what is not

**Demonstrated on testnet** (each with its evidence):

- **An AI agent fixed a private bug it could not see and was paid by proof: bounty 24.** A private bounty on a new
  program (`data/smooth/`; the bug, a division by zero, is not named in its source; the secret input and the reference
  fix never left the vendor). An agent on NEAR AI Cloud fixed it from the public code and committed and revealed with a
  key limited to those two calls. The vendor proved the attempt on a rented GPU (29.82 s to prove, 21.71 s to shrink),
  wrapped it to Groth16 on a separate Docker machine (337.73 s), and the contract checked the proof itself and paid:
  tx [`9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR`](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR)
  (docs/EVIDENCE.md, "Bounty 24").
- The honest comparison: bounty 16 was the first proof-paid agent fix, on the public demo bug (tx
  `5NH9rhRMdLxRtKBtjxAsqQwFWejtu2tU9oNf69G2yUq9`). Bounty 17 was the same kind of private task as 24 and the agent's fix
  equalled the vendor's reference fix, but the laptop proof was too slow for the 4 hour window, so it was paid by
  timeout, not by proof (claim `BLcWs7dpWFaiDn5BmRzr4QVCVRn4zXn4LLUgpRx3e2mh`). Moving proving to a GPU is what changed
  between 17 and 24.
- The contract opens and decides bounties from Groth16 proofs it checks itself: one PASS paid and one FAIL spent on
  bounty 1 (txs `CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY`, `6B9ocDasU1BZU28fshj6D72DkA8VCmar1ePNp9m3vtca`), nine
  attacks refused (docs/EVIDENCE.md, S6c).
- A judge can open a judge bounty with a real proof from any account, and a proof with the wrong seal is refused at the
  pairing check itself ([TRY_IT.md](TRY_IT.md), steps 5 and 6; bounty 18, tx `GhjkpLgkcwUbnWA743FezQEx8WLLXxCtvA7vT9eCfWdb`; bounty 22, tx
  `5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj`).
- The attempt cap held against a probe agent: 3 of 12 probe commits counted on bounty 23 ([TRY_IT.md](TRY_IT.md), step 7).
- Anyone can rebuild the checker and match the image id on chain (TRY_IT.md, step 9: MATCH from a fresh clone).

**Operational risks:**

- The vendor must prove each revealed attempt inside the verdict window. On the laptop CPU one proof with compression
  takes 1.5 to 4 hours (docs/numbers.md); bounty 17 missed its window. On a rented GPU bounty 24's attempt took under a
  minute, but the secret then sits in that machine's memory for the run (wiped afterwards), and the Groth16 wrap needs
  a separate x86 machine with Docker and about 7 GiB of memory.
- The vendor must stay online; if it goes silent, the timeout rule pays whatever was revealed.
- The contract account still has a full access key, so its code can still be replaced (planned to be removed last).

**Still needs hardening** (docs/AUDIT.md, findings and suggested hardening):

- A payout to an account that does not exist is lost (finding 8; bounty 8 shows it, the Ledger marks it).
- No storage accounting (finding 12); the vendor chooses the Proof 0 seed (finding 10); the verifier constants are
  unversioned (finding 11).
- One person can use many accounts; the per-account cap (deployed 2026-10-26) limits one account, not one person.

**Narrow claims:**

- PASS means the patch passed this checker against the secret and the public tests; it does not prove the patch is
  secure against everything.
- One verdict tells a researcher at most one bit about the secret; the vendor chooses the budget K.
- Bounty 7 and the other demo bounties use a public demo input; bounty 12 keeps its secret private but uses the public
  demo bug.


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
| Gas per on-chain verification | 35.2 to 36.4 Tgas per accepted proof; 34.856 Tgas for a proof refused at the pairing check | `docs/evidence/S6c/gas_level2.txt`, TRY_IT.md step 6 |

The same kind of proof on the laptop and on a rented GPU (bounty 24, `data/smooth/`; the agent's fix is the reference fix
byte for byte, so both proofs check the same patch under the same checker image id):

| Step | Laptop CPU (i7-1360P, `--po2 18`) | 1x NVIDIA L40S on RunPod (`--po2 19`) | Source |
| --- | --- | --- | --- |
| Prove | 8,679.49 s (141 segments), peak 2,418 MiB | **29.82 s** (33 segments), peak GPU memory 9,275 MiB | `docs/evidence/smooth/prove_proof0.log`; `docs/evidence/smooth/gpu/prove_u0.log` |
| Compress to succinct | 5,591.59 s | **21.71 s** | `docs/evidence/smooth/compress_proof0.log`; `docs/evidence/smooth/gpu/compress_succinct.log` |
| Groth16 wrap (Docker, x86) | 252.93 s, container peak 6,201 MiB | not on the pod (no Docker there): 337.73 s on a 4 core VPS with 7.8 GiB, container peak 6.82 GiB | `docs/evidence/smooth/groth16_p0.log`; `docs/evidence/smooth/vps/groth16.log` |
| Cost | electricity and time | $0.60 of GPU rental for the pod session | docs/numbers.md |

## What is built

Each claim names the file and the command that show it. Full results, failures included: [docs/EVIDENCE.md](EVIDENCE.md).

| Claim | Status | Shown by |
| --- | --- | --- |
| Level 2: the contract opens and decides a bounty from Groth16 proofs it checks itself, with no verifier signatures; a proof must belong to that bounty and attempt; replayed, changed, late or repeated proofs are refused | works on testnet: one PASS paid, one FAIL spent, nine attacks refused; anyone can open a judge bounty (TRY_IT.md, steps 5 and 6) | `scripts/s6c_testnet.sh`, `scripts/judge_bounties.sh`, `cargo test -p kintsugi-contract` (EVIDENCE, S6c and "Judge bounties") |
| Proof-checked payouts versus timeout payouts | bounties 1, 16, 24, 27 and 32 were paid by a proof (`submit_groth16` PASS; 27 and 32 by the vendor's `watch` on a rented GPU; bounty 24: a private bounty on a new module, tx `9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR`); bounties 4, 9, 11, 13 and 17 were paid by the timeout rule (a liveness rule, not a verdict), and bounty 8 on paper only (its transfer failed, finding 8), with no proof checked for the paid attempt; the site shows those as "Paid by timeout" | `web/data/recorded.json` (`scripts/gen_site_recorded.py`); the bounty pages |
| An agent driven by a language model (NEAR AI Cloud by default): reads the feed, checks the public code against the bounty's hashes, asks the model for a fix, builds it, runs the public tests, commits and reveals with a limited key | works on testnet: on private bounty 24 (a new program) the model's fix was proven PASS on a rented GPU and paid by proof (tx `9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR`); on test bounty 16 the model's fix was proven PASS and paid; on private bounty 17 (a new program, secret and reference fix outside the repository) the model's fix was the reference fix byte for byte, but the vendor's proof did not finish inside the verdict window, so it was **paid by timeout, not by a proof** | `agent/skarbnik_agent.py`; EVIDENCE "Bounty 24", "The model-driven agent", "Private bounty 17" |
| The checker gives PASS to an honest patch and FAIL to cheating patches | 19 of 20 as expected; the one difference (`memory_grow`) is explained | `cargo test -p kintsugi-check`; EVIDENCE, S1 |
| A bounty opens only after the vendor's own reference fix passes the full check (Proof 0) | works on testnet | `scripts/s13_attacks.sh`, `scripts/s18_live_bounty.sh` (EVIDENCE, S13, S18) |
| Anyone can rebuild the checker and get the published image id | MATCH | TRY_IT.md, step 9 |
| Level 0: two registered verifiers check a receipt and attest | works on testnet; all verifier accounts are run by the project | `scripts/s4_testnet.sh` (EVIDENCE, S4) |
| An agent's limited key cannot withdraw, change limits or exceed its fee limit; the Account page's stop button stops it | works on testnet | `./scripts/web_testnet.sh agentkey`; docs/SECURITY.md, "The site"; the stop button: EVIDENCE, "Site in the final design" |
| Agent setup from the site: the limits form, an agent key made in the browser (shown once, never sent) and added by the wallet as a key limited to commit and reveal | works on testnet with the NEAR CLI wallet: the agent then committed and revealed with that key | EVIDENCE, "Site in the final design"; `docs/evidence/web/partd_transactions.tsv` |
| A site with live bounties, a page for every bounty, how it works, evidence (ledger, checker, contract, security lab, limits), a judge guide, an Account page, a page for agents, `feed.json` | live at https://skarbnik.xyz (Vercel, branch main, no build step), checked in a browser on the live domain | `web/`; docs/evidence/web/live_domain_2026-10-26.txt; the final design: docs/evidence/web/live_domain_panyl_2026-10-26.txt |
| Wallets through NEAR Connect, every wallet script pinned by sha256 | NEAR CLI clicked through on testnet (deposit, commit, reveal, withdraw, agent limits, adding an agent key, stop); Meteor, Intear, Ledger, MyNearWallet (until it closes on 31 October 2026), Nightly and Ethereum Wallets only loaded | docs/evidence/web/wallets_2026-10-26.txt; EVIDENCE, "Site in the final design" |
| A probe agent learns at most one bit per verdict, capped by the attempt budget K | works: recorded run with native verdicts (S8); a real run on testnet where the contract counted 3 of 12 probe commits (at most 3 of 12 bits); the same probe with no cap, simulated only, learned all 12 bits | `scripts/s8_arena.sh`, `scripts/arena_probe.sh` (EVIDENCE, S8 and "Arena: guarded and unguarded"; TRY_IT.md, step 7) |
| Fees of commits never revealed go to a protocol fee pool, never to the vendor | works on testnet | `get_protocol_pool` (EVIDENCE, S6c) |
| A Proof Ledger: every paid account, each paid fix with how it was paid (proof or timeout) and its transaction, each vendor's on-time record, distinct counterparties; every account is labelled team-run or seeded (all of them are today) | live, read from the chain | https://skarbnik.xyz/#/evidence/ledger, `web/ledger.json` (`node scripts/gen_ledger.mjs`) |

## What is not built

- **Level 1 is not built as a working path.** The contract has entry points for an OutLayer verifier, but OutLayer never
  answered our jobs on testnet (8 of 8 timed out), so no Level 1 verdict exists (EVIDENCE, "OutLayer (Level 1) on testnet").
- On the site: creating a bounty.
- A mainnet contract.

## Known limits

- The contract was checked by AI review passes, not by an independent security audit. Their findings led to seven fixes;
  the unfixed findings are stated as known limits in [docs/AUDIT.md](AUDIT.md) and [docs/SECURITY.md](SECURITY.md).
- The contract account still has a full access key, so its code can still be replaced (planned to be removed last).
- One verdict tells a researcher at most one bit about the secret; the vendor chooses the budget K.
- If the vendor stays silent, the bounty is split equally among every revealed attempt still waiting, whatever they
  contain. In the worst case an honest fix gets only 1/K of the bounty (docs/AUDIT.md, finding 3 and hardening S7).
- Proving is slow on a laptop CPU: one passing proof with compression takes 1.5 to 4 hours, which is why bounty 17 was
  paid by timeout. A rented GPU did bounty 24's in under a minute (one run, one machine), with the secret in that
  machine's memory for the run.
- Bounty 12 keeps its secret private but uses the public demo bug. Bounty 7 and the demo bounties use the public demo input.
- A payout to an account that does not exist is lost (docs/AUDIT.md, finding 8); the site and
  `scripts/agent_preflight.sh` refuse such an account before sending.
- One person can use many accounts; the rising fee per attempt and the cap K bound how many yes or no answers anyone can
  extract per bounty.
- Intear Wallet's script keeps a wallet session key in the browser (it cannot spend on chain); the page's own code holds
  no key.
- RISC Zero states its zero knowledge property is not formally proven. Narrow scope: crash bugs in a small module that
  compiles to WebAssembly. Testnet only, test NEAR, no token.

