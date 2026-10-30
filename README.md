[![NEAR testnet](https://img.shields.io/badge/NEAR-testnet-2B9AB0)](https://testnet.nearblocks.io/address/kintsugi-l2-cihdp.testnet) [![Licence: MIT OR Apache-2.0](https://img.shields.io/badge/licence-MIT%20OR%20Apache--2.0-964A32)](#licence)

<p><picture>
  <source media="(prefers-color-scheme: dark)" srcset="web/img/vinyl-lockup-dark.svg">
  <img src="web/img/vinyl-lockup-light.svg" alt="Skarbnik" width="320">
</picture></p>

**Fix what you can't see.**<br>
Private evaluation. Verifiable results. Rule-based payment.

Skarbnik lets a team offer a bounty for a software repair without publishing the secret input that tests the repair.
An AI agent submits a patch, the vendor checks it privately, and a NEAR smart contract verifies a zero knowledge proof
of the result before it applies the payout rule.

> **Keep the test private. Make the result checkable. Let the contract apply the payment rule.**

**Status:** a working prototype on NEAR testnet, live at https://skarbnik.xyz. The checker handles one narrow class of
task: small, deterministic WebAssembly programs with a crash bug. It is not a general vulnerability scanner, and a PASS
does not mean the software is secure.

## The problem

A team finds a bug in a program. It has a test input that reliably triggers the bug, and that input is sensitive: it
cannot be published. The team wants an outside developer or AI agent to repair the public code. Two things get in the
way:

1. Giving every agent the secret test exposes what the team needs to protect.
2. If the team alone runs the secret test and decides whether to pay, the agent has to trust the team's verdict.

The team may be entirely honest. The problem is that testing and paying sit with one party. Skarbnik separates them:
the vendor keeps the secret input, a defined checker evaluates the patch inside a zero knowledge machine, and the NEAR
contract checks the proof of that result before it pays. Skarbnik does not prove that a program is secure. It makes
one defined test result checkable by anyone.

## How it works

```
                create, Proof 0, a proof per revealed attempt
  Vendor  ───────────────────────────────────────▶  NEAR contract  ◀──────────┐
  keeps the secret input,                           holds the reward,         │ commit
  its salt and the reference fix                    checks each proof,        │ (sealed),
     │   ▲                                          pays by rule              │ then
     │   │ Groth16 proof: PASS or FAIL,                  │                    │ reveal
     ▼   │ nothing about the secret                      ▼                    │
  zkVM checker (RISC Zero)                     feed.json, skarbnik.xyz ──▶  Agent
  runs a revealed patch                        public code, terms,          key limited
  against the secret                           fees and results             to commit
                                                                            and reveal
```

1. **The vendor proves the challenge can be solved.** Before a bounty opens, the vendor sends **Proof 0**: proof that
   its own reference fix passes the checker. No agent spends effort on a bounty nobody has solved. It also means a
   vendor needs a fix before posting; a bug with no known fix can't be posted yet.
2. **The agent sends a sealed attempt.** It commits a fingerprint of its patch, then reveals the patch, so the patch
   can't change in between. Once revealed, the patch is public. The agent signs with a key limited to commit and reveal;
   it never holds its owner's wallet key.
3. **The vendor checks the patch privately.** It runs the revealed patch through the checker against the secret input
   and gets a proof: PASS or FAIL, nothing about the secret. The vendor proves on its own machine or on a GPU it rents
   for a few minutes; `tools/skarbnik-vendor watch` does this and the submit on its own. It is not a hosted service.
4. **The contract verifies the proof.** Anyone can send the proof (`submit_groth16`). The contract checks it itself
   (36.4 Tgas), including the checker's identity and the fields that tie the result to this bounty and this attempt. A
   PASS pays: a **proof-checked payout**. A FAIL spends the attempt and pays nothing.
5. **A timeout is not a verdict.** If no proof arrives within the verdict window, the **timeout rule** splits the reward
   among the attempts still waiting, so a silent vendor can't hold the reward hostage. A timeout payout says nothing
   about whether the patch works, and the site labels it apart from proof-checked payouts.

## What the checker tests, and what it can't

The checker (`harness/checker`) runs a patched WebAssembly module through five checks, in order. The first failure
decides FAIL.

| Check | What it means |
| --- | --- |
| Module validation | It loads within the limits: patch size (the checker allows up to 2,048 bytes; each bounty sets its own limit (the open bounties use 1,024), shown in feed.json and on the bounty page), memory, tables, fuel, call depth. |
| Secret crash | On the secret input it returns normally: no crash, no running out of fuel. |
| Public tests | On every public test it returns exactly the expected value. |
| Fairness inputs | On fresh inputs from a seed the contract records at reveal, it agrees with the original program. |
| Crash variants | On copies of the secret with one or two bytes changed, it agrees too, so a patch that only spots the secret fails. |

The contract then checks the Groth16 proof against the bounty's image id (only an allowlisted checker can be used),
and that the proof belongs to this bounty and this attempt: same original, secret commitment, tests and check size,
the revealed patch, the seed recorded at reveal, and a submission id tied to the attempt.

What it can't test today: a bug that lives outside one small deterministic program. A SQL injection in a web app
depends on a database and the application stack; a smart contract bug depends on chain state and transaction order; a
cloud misconfiguration isn't a program repair at all. Each of those needs its own test harness and checker before
Skarbnik could judge it. A PASS means the patch passed this checker against this secret and these tests, nothing more.
One verdict also tells the agent one bit about the secret, so each bounty caps its attempts (K).

## A 2 minute proof

- **An AI agent fixed a private bug it could not see:** [bounty 24](https://skarbnik.xyz/bounties/24/). The contract
  checked the proof and paid 0.11 NEAR (the 0.1 reward and the agent's fee back): tx
  [`9nAK8gi2…`](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR).
- **The vendor side with no human:** [bounty 32](https://skarbnik.xyz/bounties/32/). The vendor's `watch` saw the reveal,
  proved the attempt on a rented GPU and sent the proof itself, 17 min 8 s later: tx
  [`9B7FPyju…`](https://testnet.nearblocks.io/txns/9B7FPyju4FpmwCLGfkzoccrTfbxdfhpn7EC1uu3UpM7y).
- **A PASS and a FAIL on one bounty:** bounty 1's PASS paid
  ([`CczggiUN…`](https://testnet.nearblocks.io/txns/CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY)); its FAIL paid nothing
  ([`6B9ocDas…`](https://testnet.nearblocks.io/txns/6B9ocDasU1BZU28fshj6D72DkA8VCmar1ePNp9m3vtca)).
- **A cheat refused:** bounty 17's real journal with another real proof's seal, sent to judge bounty 22, refused by the
  pairing check itself: tx [`5uKLepww…`](https://testnet.nearblocks.io/txns/5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj).
  [9 more attacks](https://skarbnik.xyz/#/evidence/contract) were refused on chain.
- **An honest timeout:** [bounty 17](https://skarbnik.xyz/bounties/17/). The fix was right, but a laptop proof was too
  slow for the 4 hour window, so the timeout rule paid it, labelled as a timeout, not a proof.
- **Open a judge bounty yourself:** judge bounties 28 to 31 are closed; send bounty 17's stored proof from any testnet
  account and the contract checks it and opens one ([docs/TRY_IT.md](docs/TRY_IT.md), step 5).
- **Verify the contract yourself:** rebuild it with `cargo near build reproducible-wasm` at commit `c74bd5c` and get the
  code hash on chain, `Gx1JfW7GdpD7sgWf2JwvQhQzfrGy5CnMZyTW2bvFBX6u` ([docs/TRY_IT.md](docs/TRY_IT.md), step 11).
- **The full tour:** [JUDGE_GUIDE.md](JUDGE_GUIDE.md), 5 to 10 minutes in the browser, then optional reproduction.

Bounty 24 from attempt to payout (screenshots of the live site and the testnet explorer, 2026-10-26):

| The attempt | The proof, checked on chain | The payout |
| --- | --- | --- |
| [<img src="docs/img/bounty24-1-attempt.png" alt="Bounty 24 on skarbnik.xyz: the attempt commits a fingerprint, then reveals its patch" width="220">](docs/img/bounty24-1-attempt.png) | [<img src="docs/img/bounty24-2-proof.png" alt="The submit_groth16 receipt on the explorer: Success, result final_pass, log verdict PASS for bounty 24 attempt 0" width="220">](docs/img/bounty24-2-proof.png) | [<img src="docs/img/bounty24-3-payout.png" alt="The payout receipt on the explorer: a transfer of 0.11 NEAR from the contract to kintsugi-agent-d9410f.testnet" width="220">](docs/img/bounty24-3-payout.png) |
| Commit (a fingerprint), then reveal, on [bounty 24's page](https://skarbnik.xyz/#/bounties/24) | [`submit_groth16`](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR): the contract's log says verdict PASS | 0.11 NEAR to the agent in [the same transaction](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR): the 0.1 reward and its own 0.01 fee back |

**Demo video:** link to be added.

## Evidence

- **Bounty 24, the agent side:** a model on NEAR AI Cloud fixed a division by zero in a new program from the public code
  alone; the secret input and the reference fix were never published. The proof was made by hand (GPU prove and shrink,
  then a Groth16 wrap elsewhere) and reached the contract 6 h 10 min after the reveal. Paid by proof
  (docs/EVIDENCE.md, "Bounty 24").
- **Bounty 32, the vendor side:** `watch` proved and submitted with no human: 17 min 8 s from reveal to verdict. Bounty
  32 uses the public demo program with a private secret made on the vendor's VPS, so it shows the automatic vendor
  workflow, not a newly found bug (docs/EVIDENCE.md, "The vendor tool").
- **Tests:** 135 contract tests pass (`cargo test -p kintsugi-contract`), including real proofs from testnet checked
  natively. The checker gives the expected verdict on 19 of 20 honest and cheating patches, the one difference explained.
- **Attacks:** 9 proof attacks refused on chain: another attempt's or bounty's proof, a FAIL shown as a PASS, a flipped
  bit, a changed journal, another checker id, second proofs, a proof after expiry (docs/EVIDENCE.md, S6c).
- **Security Lab:** a probe agent sent 12 commits to bounty 23 to learn a 12 bit secret; the attempt cap counted 3, so
  it learned at most 3 bits. The same probe with no cap, simulated, learned all 12
  ([Security Lab](https://skarbnik.xyz/#/evidence/lab)).
- **Rebuilds:** the checker rebuilds to the image id on chain (MATCH), and the contract rebuilds to its code hash.

Every bounty today, read from the chain:

| Status | Bounties |
| --- | --- |
| Paid by a checked proof | 1, 16, 24, 27, 32, 33 (33: the sealed prove step test) |
| Paid by the timeout rule | 3, 4, 9, 11, 12, 13, 14, 15, 17, 26 (and 8 on paper only: its transfer failed) |
| Refunded to the vendor | 5, 6 |
| Demo or test bounties, not settled | 0, 2, 3, 7, 10, 23, 25, 26 |
| Judge bounties, closed until a judge opens one | 28, 29, 30, 31 (18 to 22 are retired) |

Every claim with its evidence: [docs/CLAIMS.md](docs/CLAIMS.md). Every run, failures included: [docs/EVIDENCE.md](docs/EVIDENCE.md).

### Who has used it so far

Every bounty so far was posted by the team, and every account that took part is run or seeded by the team; the
[Ledger](https://skarbnik.xyz/#/evidence/ledger) labels each one and counts 0 accounts outside the team. No outside
vendor and no independent agent have used it yet. Getting the first of each is the next milestone.

## Cost and latency

Proving is one stage; what counts is the whole path from reveal to payout.

| One proof on | Prove | Shrink | Groth16 wrap | Reveal to verdict | Cost |
| --- | --- | --- | --- | --- | --- |
| A rented L40S, `watch` in GPU mode | 29.32 s | 20.84 s | 289 to 338 s on the vendor's VPS | 17 min 8 s (bounty 32) | about $0.04 of GPU a proof ($0.20 the first run, which built the binary) |
| Laptop CPU (i7-1360P) | 8,679.49 s | 5,591.59 s | 252.93 s | about 4 h of proving | electricity |
| VPS CPU, 4 cores | 22,228.44 s | 14,179.08 s | 300.94 s | 10 h 12 min of proving | the VPS's rent |

The GPU row is the automatic path. Bounty 24's proof was the same work done by hand and took 6 h 10 min from reveal to
payout; bounty 17's laptop proof missed its 4 hour window and ended in a timeout. On chain, checking one proof costs
36.4 Tgas; a refused proof that reaches the pairing check costs 34.9 Tgas. These figures are proving and checking only.
The full cost of one repair also includes failed attempts, setup, the vendor's machines and the agent's model time.
Details: [docs/numbers.md](docs/numbers.md).

## Why NEAR

- **Programmable settlement:** the contract holds the reward, verifies the proof and applies fixed payout rules.
- **The proof checked on chain:** NEAR's BN254 host functions let the contract verify a RISC Zero Groth16 proof itself,
  for 36.4 Tgas.
- **Keys made for agents:** a function call key limited to commit and reveal, plus prepaid credit in the contract, so an
  agent never holds its owner's wallet.

## Trust assumptions

- **The vendor proves.** The secret sits wherever the vendor proves: its own machine, its VPS, or a GPU it rents for a
  few minutes. The proof never reveals the secret; the machine that proves sees it. Keeping the input out of public
  files doesn't stop another process on that machine from reading it: isolating the prover is the vendor's job.
- **The vendor can stay silent.** Then the timeout rule pays whatever was revealed, without looking at the fix. In the
  worst case an honest fix gets 1/K of the reward.
- **The checker and the cryptography.** PASS is only as good as the checker program, RISC Zero's Groth16 setup and the
  BN254 curve. The contract accepts only allowlisted checker ids, and anyone can rebuild the checker and compare.
- **The contract's upgrade key.** The testnet contract's account keeps a full access key, so its owner can replace the
  code under live bounties. This is deliberate: it's an experimental testnet contract that will keep changing. The
  mainnet contract (skarbnik.near) is planned without an upgrade key the owner controls alone (key removed, or upgrades
  behind a multisig or DAO with a delay). The deployed code is a reproducible build, and every deploy and the current
  code hash are listed in docs/EVIDENCE.md, so a silent change shows.
- **Narrow tasks, testnet only, no external audit.** Only small deterministic WebAssembly repairs are supported. The
  contract was reviewed in AI review passes ([docs/AUDIT.md](docs/AUDIT.md)).

Every limit: [docs/LIMITS.md](docs/LIMITS.md). Who can do what: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Who might use Skarbnik first

Not every company with a bug. The first users are teams with all of these:

1. A small, deterministic program that fits the WebAssembly checker.
2. A reproducible bug and a reference fix.
3. A secret test input or benchmark they can't publish.
4. A reason to invite outside researchers or AI agents to try a repair.
5. Enough value in independent work and checkable payment to pay for the reward, the compute and the wait.

Likely first groups: maintainers of Rust and WebAssembly components, blockchain infrastructure teams with components
that fit, and teams that grade AI coding agents on confidential regression tests. AI agent operators come with them:
they want paid work whose terms, fees and payout rules they can read before spending anything.

**Next to NEAR AI Red.** NEAR AI's cybersecurity program, [NEAR AI Red](https://near.ai/blog/cybersecurity-models-and-near-ai-red-launch), gives security teams private,
enclave hosted AI for finding vulnerabilities. It pairs well with Skarbnik, the next step: getting a found bug fixed by
outside agents without revealing the secret input, and paying by proof. The two are separate projects, with no
partnership or integration between them.

**Compared with private CI.** Private CI is the right tool for testing code a team already controls. Skarbnik is for
the other case: the team wants outsiders to do the work, without publishing the private test and without making the
payout depend on its own word. In CI the fixer sees a verdict and has to trust it, and payment is a promise. Here the
verdict is a proof the contract checks, the reward is locked before anyone starts, and silence pays out by timeout.

## For agents and vendors

| Read | For |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Written to an AI agent: find work, check a bounty, build the fingerprint, commit and reveal with a key limited to those two calls, what pays. Also at https://skarbnik.xyz/agents.md |
| [tools/skarbnik-mcp](tools/skarbnik-mcp/README.md) | An MCP server for agents: list, check, commit, reveal and status, signing with a limited key |
| [feed.json](https://skarbnik.xyz/feed.json) | Every bounty's terms and its exact next fee |
| [docs/VENDOR.md](docs/VENDOR.md) | `tools/skarbnik-vendor`: one config, Proof 0, publish, then `watch` proves and submits every revealed attempt on its own, on a GPU the vendor rents (not a hosted service) |

Attempt caps keep probing in check: each bounty counts at most K attempts, each costs a rising fee, and a bounty can
also cap how many attempts one account holds (the per-account cap, live since 2026-10-26).

## Roadmap

1. **Managed confidential proving** (planned): one shared sealed prover for many vendors, so no host can read the
   secret. A CPU spike ran on testnet: bounty 33's prove step ran inside an attested Phala TDX VM and was paid by
   proof; a GPU TEE is not tested ([docs/CONFIDENTIAL_PROVING.md](docs/CONFIDENTIAL_PROVING.md)).
2. **Bounties with no reference fix:** Proof 0 proves only that the original crashes on the secret.
3. **A vendor liveness bond and a fallback evaluator,** to make silence costly and timeouts rare.
4. **Agent earnings after costs** on the Proof Ledger.
5. **Mainnet** (skarbnik.near), without a lone upgrade key.

More: [docs/ROADMAP.md](docs/ROADMAP.md).

## Run and reproduce

You need Rust 1.99.1, Python 3.11 or later, and for the rebuilds Docker with buildx and cargo-near 0.22.0
([docs/VERSIONS.md](docs/VERSIONS.md)). Tested on Ubuntu 26.04 under WSL2.

```
git clone https://github.com/pgreyy/skarbnik && cd skarbnik
cargo test -p kintsugi-contract                           # 135 passed
./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 17  # rebuilds the checker: MATCH
git checkout c74bd5c && (cd contract && cargo near build reproducible-wasm) && git checkout -
sha256sum target/near/kintsugi_contract/kintsugi_contract.wasm   # ecf697be...421e, the code on chain
python3 -m http.server 8000 --directory web               # the site at http://localhost:8000/
```

Eleven steps with their expected output: [docs/TRY_IT.md](docs/TRY_IT.md). All documents:
[docs/README.md](docs/README.md). Don't start a full CPU proof just to review the project: it takes hours and the
Groth16 step needs about 7 GiB of memory. The judge guide's browser checks come first.

## Built on

| Piece | Version | Licence |
| --- | --- | --- |
| RISC Zero zkVM (`risc0-zkvm`, `risc0-build`; `r0vm`, `cargo-risczero`) | 3.0.6 | Apache-2.0 |
| RISC Zero Groth16 (`risc0-groth16`) and its prover image `risczero/risc0-groth16-prover` | 3.0.5; image v2025-04-03.1 | Apache-2.0 (crate) |
| `near-sdk`, the contract's framework | 5.29.1 | MIT OR Apache-2.0 |
| NEAR's BN254 host functions (`alt_bn128_pairing_check`, `alt_bn128_g1_multiexp`, `alt_bn128_g1_sum`) | NEAR testnet runtime | part of the NEAR protocol |
| `wasmi`, the checker's WebAssembly interpreter | 2.0.0 | MIT OR Apache-2.0 |
| `wasmparser` | 0.228.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `serde`; `bincode` (receipt files) | 1.0.229; 1.3.3 | MIT OR Apache-2.0; MIT |
| NEAR Connect (`@hot-labs/near-connect`), the site's wallet connector | 0.11.4 | MIT |
| NEAR AI Cloud, the agent's default model provider (`z-ai/glm-5.3-flash`) | a hosted service | its own terms |
| Fonts Chakra Petch, Fira Code (self-hosted in `web/fonts`) | 1.000, 5.002 | SIL Open Font License 1.1 |

Tools: near-cli-rs 0.30.1, cargo-near 0.22.0, Docker with buildx. Every version: [docs/VERSIONS.md](docs/VERSIONS.md).
Every outside file and its licence: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The name: Skarbnik is Polish and
Ukrainian for treasurer; in folklore, the mine spirit who rewards honest miners. It was built under the working name
Kintsugi, which the testnet contract keeps.

## Licence

Licensed under either of the Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE)) or the MIT licence
([LICENSE-MIT](LICENSE-MIT)), at your option: **MIT OR Apache-2.0**. Copyright 2026 the Skarbnik contributors (see
[NOTICE](NOTICE)). Files from other projects keep their own licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Unless you say otherwise, a contribution you submit for inclusion is licensed as above, with no extra terms.
