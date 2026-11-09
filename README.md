<p><picture>
  <source media="(prefers-color-scheme: dark)" srcset="web/img/vinyl-lockup-dark.svg">
  <img src="web/img/vinyl-lockup-light.svg" alt="Skarbnik" width="320">
</picture></p>

**Fix what you can't see.**

Skarbnik is a repair bounty where the input that exposes the bug stays secret: an AI agent sends a fix, a zero
knowledge proof says PASS or FAIL, and at the default level a NEAR contract checks that proof itself before it pays.
It is a working prototype on NEAR testnet, live at https://skarbnik.xyz. **It covers small deterministic WebAssembly
programs with a crash, a wrong output, or a memory safety bug (judged by answers, not by detecting memory corruption).**
It is not a security scanner, and a PASS does not mean the software is secure.

Demo video: https://x.com/pgreyy/status/2118237758321795364

Contents: [Try it](#try-it-in-2-minutes) · [On chain or trusted](#what-is-checked-on-chain-and-what-is-trusted) · [The problem](#the-problem) · [How it works](#how-it-works) ·
[The checker](#what-the-checker-tests-and-what-it-cant) · [Wrong output and memory safety](#wrong-output-and-memory-safety-bugs) · [Evidence](#evidence) · [Cost](#cost-and-latency) ·
[Trust](#trust-assumptions) · [For agents and vendors](#for-agents-and-vendors) · [Roadmap](#roadmap) ·
[Run and reproduce](#run-and-reproduce) · [Licence](#licence)

## Try it in 2 minutes

Steps 1 and 2 need only `curl` and `python3`.

1. **Read a paid bounty from the chain.** Bounty 24: an AI agent's fix, paid by proof.

       curl -s https://test.rpc.fastnear.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kintsugi-l2-cihdp.testnet","method_name":"get_bounty","args_base64":"eyJib3VudHlfaWQiOiIyNCJ9"}}' | python3 -c 'import json,sys; b=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(b["id"], b["level"], b["state"])'

   You should see: `24 2 Paid` (bounty 24, Level 2, paid).

2. **Check that the contract accepts the two published checkers.**

       curl -s https://test.rpc.fastnear.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kintsugi-l2-cihdp.testnet","method_name":"get_allowed_image_ids","args_base64":"e30="}}' | python3 -c 'import json,sys; ids=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(len(ids), "ids", "MATCH" if {"dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc", "005d8dc7e6fa2b936d960f6c81af51b5cb3699d319b5d4b71403dd64b051c089"} <= set(ids) else "DIFFERENT")'

   You should see: `3 ids MATCH`. The crash checker `dd6c5f42…` and the output checker `005d8dc7…` are on the
   allowlist. The third id is the retired spike checker `77c2e2d1…`: an id cannot be removed, and nothing uses it.

3. **Optional, needs Rust: run the contract's tests.**

       git clone https://github.com/pgreyy/skarbnik && cd skarbnik && cargo test -p kintsugi-contract

   You should see: `test result: ok. 155 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`, then the time it took.

- **See it paid:** bounty 24's payout, tx [`9nAK8gi2…`](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR).
- **Open bounties you can attempt now:** [bounty 40](https://skarbnik.xyz/#/bounties/40) (Level 1),
  [bounty 41](https://skarbnik.xyz/#/bounties/41) (Level 2), [bounty 45](https://skarbnik.xyz/#/bounties/45) (wrong
  output, Level 2) and [bounty 46](https://skarbnik.xyz/#/bounties/46) (memory safety, Level 2).
- **Full tour:** [JUDGE_GUIDE.md](JUDGE_GUIDE.md): three steps in the browser, about 5 minutes, an optional fourth where
  you run it yourself, then optional checks on your own machine, the claims with what each does not prove, and the limits.
- **Every step:** [docs/TRY_IT.md](docs/TRY_IT.md), eleven steps with their expected output.

## What is checked on chain and what is trusted

| Part | What it does | On chain or trusted |
| --- | --- | --- |
| Level 2 | The contract checks the Groth16 proof itself | Checked on chain |
| Level 1 | The contract takes OutLayer's answer on the proof | Trusted: OutLayer and its operator |
| Level 0 | Registered verifiers attest the verdict | Trusted: the verifiers, today run by the project |
| The timeout rule | Pays the waiting attempts without a verdict | Labelled as a timeout, never as a PASS |
| The vendor's machine | Proves the attempt, so it sees the secret | Trusted: isolating it is the vendor's job |

## The problem

A team has a bug and a test input that triggers it, and that input can't be published. It wants an outside developer
or AI agent to repair the public code. Giving every agent the secret exposes it; if the team alone runs the secret test
and decides whether to pay, the agent has to trust the team's verdict.

The team may be honest; the problem is that testing and paying sit with one party. Skarbnik separates them: the vendor
keeps the secret input, a defined checker evaluates the patch inside a zero knowledge machine, and the NEAR contract
checks the proof of that result before it pays. It does not prove that a program is secure. It makes one defined test
result checkable by anyone.

> **Keep the test private. Make the result checkable. Let the contract apply the payment rule.**

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
   its own reference fix passes the checker. So a vendor needs a fix first; a bug with no known fix can't be posted yet.
2. **The agent sends a sealed attempt.** It commits a fingerprint of its patch, then reveals the patch, so the patch
   can't change in between and is public once revealed. It signs with a key limited to commit and reveal, never its
   owner's wallet key.
3. **The vendor checks the patch privately.** It runs the revealed patch through the checker against the secret and
   gets a proof of PASS or FAIL that says nothing about the secret. It proves on its own machine or on a GPU it rents
   for a few minutes; `tools/skarbnik-vendor watch` does this and the submit on its own (not a hosted service).
4. **The contract verifies the proof.** Anyone can send it (`submit_groth16`); the contract checks it itself for
   36.4 Tgas, including the checker's identity and the fields that tie it to this bounty and attempt. A PASS pays (a
   **proof-checked payout**); a FAIL spends the attempt and pays nothing.
5. **A timeout is not a verdict.** If no proof arrives within the verdict window, the **timeout rule** splits the reward
   among the attempts still waiting, so a silent vendor can't hold it hostage. That payout says nothing about the
   patch, and the site labels it apart from proof-checked payouts.

**Who decides: three levels.** The vendor picks one when it creates a bounty, and every bounty page and `feed.json`
show it.

| Level | Who decides | Shown by |
| --- | --- | --- |
| 2 (the default) | The contract checks the Groth16 proof itself, as in step 4 | bounties 1, 16, 24, 27, 32 and 33, paid by proof; EVIDENCE, S6c |
| 1 | OutLayer runs our pinned verifier program on the proof and the contract trusts its answer; no Groth16 step for the vendor, but OutLayer and its operator are trusted | bounties 36 to 39: 36 (opened [`4GdNLf15…`](https://testnet.nearblocks.io/txns/4GdNLf15abCXgNAgJ6ZKqSiGkk1w8g7an9VZGEgErZTZ)), 37 and 38 paid on OutLayer's PASS ([`3ZpV6zsg…`](https://testnet.nearblocks.io/txns/3ZpV6zsgY8vuTCvZDSHv3E6NuvC6YgXTvtEQkvuqw92u), [`6nKhWdEu…`](https://testnet.nearblocks.io/txns/6nKhWdEuJxF6o86EMzcTn5Sfu69KqbMo7xLQVVYtD7dS), [`4heRP1d6…`](https://testnet.nearblocks.io/txns/4heRP1d6XgvuxsmG6MJA2grufk1h93NR7SnqnYr4dEU7)); 36 and 39 show a wrong fix FAIL ([`8HYqqjPy…`](https://testnet.nearblocks.io/txns/8HYqqjPytxz2iTQvG5C6x4f5ywd9xZd9nQ1k2qeqzQLY), [`ogTyBybL…`](https://testnet.nearblocks.io/txns/ogTyBybLFy3c7zUUavCgrKh3rrt92CkQoXc7WZSk8wR)); EVIDENCE, "Level 1 through OutLayer" and "Level 1 through the vendor tool" |
| 0 | Registered verifiers attest; today all of them are run by the project | EVIDENCE, S4 |

## What the checker tests, and what it can't

The checker (`harness/checker`) runs a patched WebAssembly module through five checks, in order. The first failure
decides FAIL.

| Check | What it means |
| --- | --- |
| Module validation | It loads within the limits: patch size (the checker allows up to 2,048 bytes; each bounty sets its own limit, shown in feed.json and on the bounty page), memory, tables, fuel, call depth. |
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

### Wrong output and memory safety bugs

A second checker (`harness/checker-output`, image id `005d8dc7…`) judges bugs that give a wrong answer instead of a
crash. That includes memory safety bugs, such as a C buffer overflow that corrupts memory without crashing in
WebAssembly. The vendor's secret is an input and the right answer on it. A fix passes when it:

| Check | What it means |
| --- | --- |
| Secret answer | On the secret input it returns exactly the vendor's expected value. |
| Public tests | On every public test it returns exactly the expected value. |
| Fairness inputs | On fresh inputs from the reveal seed it agrees with the vendor's hidden reference fix. |
| Variants | On copies of the secret with one or two bytes changed it agrees with the reference fix. |
| Sweep | At up to 4 private byte positions of the secret (such as a length byte) it agrees with the reference fix on all 256 values. |

What it does not do: it judges answers on the overflow input and nearby inputs. It does not detect memory corruption
in general. A fix that corrupts memory where no answer changes would pass. The secret, the expected value, the
reference fix and the sweep positions are bound by one commitment, so they cannot change between proofs.

- The demo and its cheats: `data/memsafe/`, `data/attacks/memsafe/`. Run
  `cargo test -p kintsugi-check-output`: correct fixes pass, the original and every cheat fail, and the sweep alone
  catches a fix that refuses only names over 20 bytes (`harness/checker-output/tests/corpus.rs`).
- On testnet, bounty 44 (a test bounty): a partial fix proved FAIL (`FDk65JiRdQbukG5wi42L7G4GekGK1yBPrJFxMrrP8AcQ`),
  then a correct fix proved PASS and was paid (`8y5VPFGPoQzfCaETWBeTGVkLYY9F7ywpHBYCQzxNbQwk`). Logs:
  `docs/evidence/feature_output/`.
- Rebuild both checkers and compare their ids: `./scripts/check_image_id.sh`.

## Evidence

- **An AI agent fixed a private bug it could not see:** [bounty 24](https://skarbnik.xyz/bounties/24/). A model on NEAR
  AI Cloud fixed a division by zero in a new program from the public code alone; the secret input and the reference
  fix were never published. The proof was made by hand (GPU prove and shrink, then a Groth16 wrap elsewhere) and
  reached the contract 6 h 10 min after the reveal. The contract checked it and paid 0.11 NEAR (the 0.1 reward and the
  agent's fee back): tx [`9nAK8gi2…`](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR)
  (docs/EVIDENCE.md, "Bounty 24").
- **The vendor side with no human:** [bounty 32](https://skarbnik.xyz/bounties/32/). The vendor's `watch` saw the reveal,
  proved the attempt on a rented GPU and sent the proof itself, 17 min 8 s later: tx
  [`9B7FPyju…`](https://testnet.nearblocks.io/txns/9B7FPyju4FpmwCLGfkzoccrTfbxdfhpn7EC1uu3UpM7y). It uses the public demo
  program with a private secret made on the vendor's VPS, so it shows the automatic vendor workflow, not a newly found
  bug (docs/EVIDENCE.md, "The vendor tool").
- **A PASS and a FAIL on one bounty:** bounty 1's PASS paid
  ([`CczggiUN…`](https://testnet.nearblocks.io/txns/CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY)); its FAIL paid nothing
  ([`6B9ocDas…`](https://testnet.nearblocks.io/txns/6B9ocDasU1BZU28fshj6D72DkA8VCmar1ePNp9m3vtca)).
- **Attacks refused:** bounty 17's real journal with another real proof's seal, sent to judge bounty 22, was refused by
  the pairing check itself: tx [`5uKLepww…`](https://testnet.nearblocks.io/txns/5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj).
  [9 more attacks](https://skarbnik.xyz/#/evidence/contract) were refused on chain: another attempt's or bounty's proof, a
  FAIL shown as a PASS, a flipped bit, a changed journal, another checker id, second proofs, a proof after expiry
  (docs/EVIDENCE.md, S6c).
- **An honest timeout:** [bounty 17](https://skarbnik.xyz/bounties/17/). The vendor's laptop proof said PASS but
  finished after the 4 hour window and was never sent, so the timeout rule paid it, labelled as a timeout, not a proof:
  tx [`BLcWs7dp…`](https://testnet.nearblocks.io/txns/BLcWs7dpWFaiDn5BmRzr4QVCVRn4zXn4LLUgpRx3e2mh).
- **Tests:** 155 contract tests pass (`cargo test -p kintsugi-contract`), including real proofs from testnet checked
  natively. The checker gives the expected verdict on 19 of 20 honest and cheating patches, the one difference explained.
- **Security Lab:** a probe agent sent 12 commits to bounty 23 to learn a 12 bit secret; the attempt cap counted 3, so
  it learned at most 3 bits. The same probe with no cap, simulated, learned all 12
  ([Security Lab](https://skarbnik.xyz/#/evidence/lab)).
- **Rebuilds:** the checker rebuilds to the image id on chain (MATCH). The contract rebuilds to its code hash: run
  `cargo near build reproducible-wasm` at commit `c86db11` and get the code hash on chain,
  `7fgVdHPVUZRzSYg4FRE4exfZb36aKH7znEtMCn87PuRC` ([docs/TRY_IT.md](docs/TRY_IT.md), step 11).
- **Open a judge bounty yourself:** judge bounties 28 to 31 are closed; send bounty 17's stored proof from any testnet
  account and the contract checks it and opens one ([docs/TRY_IT.md](docs/TRY_IT.md), step 5). Need test NEAR? Get free
  testnet NEAR from the [official faucet](https://docs.near.org/getting-started/faucet) or
  [near-faucet.io](https://near-faucet.io/). A faucet can run out; if it does, ask in the
  [NEAR dev Telegram](https://t.me/neardev). The near-cli-rs command in TRY_IT step 5 makes a funded account too.

Bounty 24 from attempt to payout (screenshots of the live site and the testnet explorer, 2026-10-26):

| The attempt | The proof, checked on chain | The payout |
| --- | --- | --- |
| [<img src="docs/img/bounty24-1-attempt.png" alt="Bounty 24 on skarbnik.xyz: the attempt commits a fingerprint, then reveals its patch" width="220">](docs/img/bounty24-1-attempt.png) | [<img src="docs/img/bounty24-2-proof.png" alt="The submit_groth16 receipt on the explorer: Success, result final_pass, log verdict PASS for bounty 24 attempt 0" width="220">](docs/img/bounty24-2-proof.png) | [<img src="docs/img/bounty24-3-payout.png" alt="The payout receipt on the explorer: a transfer of 0.11 NEAR from the contract to kintsugi-agent-d9410f.testnet" width="220">](docs/img/bounty24-3-payout.png) |
| Commit (a fingerprint), then reveal, on [bounty 24's page](https://skarbnik.xyz/#/bounties/24) | [`submit_groth16`](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR): the contract's log says verdict PASS | 0.11 NEAR to the agent in [the same transaction](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR): the 0.1 reward and its own 0.01 fee back |

Every bounty, read from the chain on 2026-11-08:

| Status | Bounties |
| --- | --- |
| Paid by a checked proof (Level 2) | 1, 16, 24, 27, 32, 33 (33: the sealed prove step test); test bounties 42 and 44 of the output checker |
| Paid on OutLayer's PASS (Level 1) | 36, 37, 38 |
| Paid by the timeout rule | 3, 4, 9, 11, 12, 13, 14, 15, 17, 26 (and 8 on paper only: its transfer failed) |
| Refunded to the vendor | 0, 2, 5, 6, 10, 23, 25 |
| Open for attempts | 40 (Level 1), 41 (Level 2), 45 (wrong output, Level 2) and 46 (memory safety, Level 2); demo and test bounties 7 and 35 |
| Not settled | 39 (Level 1: its one attempt failed on OutLayer's answer, nobody was paid); 34 (a test bounty past its expiry); 43 (a test bounty: its one attempt was proved FAIL, nobody was paid) |
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
- **Level 1 trusts OutLayer.** On a Level 1 bounty the contract does not check the proof; it trusts OutLayer's answer,
  and so OutLayer, its operator and its keys. It also depends on OutLayer downloading the pinned verifier file from
  GitHub (commit `4e6a1f6`, sha256 `e60647ec...46a8`); without a check, the timeout rule applies. Level 2 trusts none
  of that.
- **Narrow tasks, testnet only, no external audit.** Only small deterministic WebAssembly repairs fit. The
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
| [tools/skarbnik-mcp](tools/skarbnik-mcp/README.md) | An MCP server for agents on their own computer: list, read the public code, build a fix, commit, reveal and status, signing with a limited key |
| `web/api/mcp` (the hosted connector) | The same agent tools behind one link, for AI apps that add a tool by URL: the link carries a key limited to commit and reveal; deleting the key on chain turns the link off. Checked end to end with an MCP client script, commit and reveal on test bounty 34 (docs/EVIDENCE.md, "The hosted agent connector") |
| [For agents](https://skarbnik.xyz/#/agents/connect) | Connect an AI app in five steps, three ways: Link (the hosted MCP server, nothing to install: paste the connector link from the Account page; the key sits inside the link, limited to commit and reveal; delete the key and the link stops), Local, advanced (tools/skarbnik-mcp on your own computer, with its built-in signer), Guide (for agents with no tools: an agent follows agent-quickstart.txt with the key file) |
| [feed.json](https://skarbnik.xyz/feed.json) | Every bounty's terms and its exact next fee |
| [api/feed](https://skarbnik.xyz/api/feed) | The same list, refreshed from the chain about once a minute (`updated_at_utc` says when), and the saved feed.json when the chain cannot be read (`node scripts/test_live_feed.mjs`; docs/evidence/live_feed/) |
| [tools/skarbnik-vendor-mcp](tools/skarbnik-vendor-mcp/README.md) | An MCP server that lets an AI app run the vendor tool for you on your own computer: it asks for each file path, never opens the secret, shows the cost first and asks for a one time confirm code before publishing or renting a GPU |
| [docs/VENDOR.md](docs/VENDOR.md) | `tools/skarbnik-vendor`: one config, Proof 0, publish, then `watch` proves and submits every revealed attempt on its own, on a GPU the vendor rents (not a hosted service) |

Attempt caps keep probing in check: each bounty counts at most K attempts, each costs a rising fee, and a bounty can
also cap how many attempts one account holds (the per-account cap, live since 2026-10-26).

## Roadmap

1. **Managed confidential proving** (planned): one shared sealed prover for many vendors, so no host can read the
   secret. A CPU spike ran on testnet: bounty 33's prove step ran inside an attested Phala TDX VM and was paid by
   proof; a GPU TEE is planned, not built ([docs/CONFIDENTIAL_PROVING.md](docs/CONFIDENTIAL_PROVING.md)).
2. **A vendor bond and fairer timeouts** (planned): a bond slashed when the vendor stays silent, and timeout rewards only
   for attempts that pass the public tests.
3. **Bounties with no reference fix** (planned): Proof 0 proves only that the original crashes on the secret.
4. **Simpler levels** (planned): Level 2 is the product; Level 0 is retired or kept only for the project's own use.
5. **Agent earnings after costs** on the Proof Ledger.
6. **Mainnet** (skarbnik.near), without a lone upgrade key.

More: [docs/ROADMAP.md](docs/ROADMAP.md).

## Run and reproduce

You need Rust 1.99.1, Python 3.11 or later, and for the rebuilds Docker with buildx and cargo-near 0.22.0
([docs/VERSIONS.md](docs/VERSIONS.md)). Built on Ubuntu 26.04 under WSL2.

```
git clone https://github.com/pgreyy/skarbnik && cd skarbnik
cargo test -p kintsugi-contract                           # 155 passed
./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 17  # rebuilds the checker: MATCH
git checkout c86db11 && (cd contract && cargo near build reproducible-wasm) && git checkout -
sha256sum target/near/kintsugi_contract/kintsugi_contract.wasm   # 630ed909...50bb, the code on chain
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

[![NEAR testnet](https://img.shields.io/badge/NEAR-testnet-2B9AB0)](https://testnet.nearblocks.io/address/kintsugi-l2-cihdp.testnet) [![Licence: MIT OR Apache-2.0](https://img.shields.io/badge/licence-MIT%20OR%20Apache--2.0-964A32)](#licence)

Licensed under either of the Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE)) or the MIT licence
([LICENSE-MIT](LICENSE-MIT)), at your option: **MIT OR Apache-2.0**. Copyright 2026 the Skarbnik contributors (see
[NOTICE](NOTICE)). Files from other projects keep their own licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Unless you say otherwise, a contribution you submit for inclusion is licensed as above, with no extra terms.
