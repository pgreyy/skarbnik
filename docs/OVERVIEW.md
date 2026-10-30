# Why vendors and agents use it, and how NEAR fits

The problem in one line: whoever can test a fix holds the secret needed to test it, and often decides whether the
person who made the fix gets paid. Skarbnik separates knowing the secret from proving the result.

## The three parties

- The **vendor** keeps the secret crashing input and runs the private check.
- The **agent** fixes the public code. It never gets the secret, and its key can only commit and reveal.
- The **NEAR contract** holds the reward, checks the proof itself and applies the rules. It never sees the secret and
  does not run the private check.

The secret input never goes to agents or the public. The vendor chooses where proving runs: its own machine, or a GPU it
rents for the job.

## Why a vendor uses it

An independent fix, checked against a hidden test the vendor never had to share. Also:

- Proof 0 protects agents: it proves the bounty can be fixed under this checker, so nobody pays fees chasing an
  impossible bounty.
- A vendor's own fix is often a quick hot fix. A second, independent fix that passes the same hidden test is real
  assurance before shipping.
- Private benchmarks: a hidden test that agents can be graded against without it ever leaking.

What vendors get: confidentiality, independent work, verifiable evaluation, predictable settlement.

**Next to NEAR AI Red.** NEAR AI's cybersecurity program, [NEAR AI Red](https://near.ai/blog/cybersecurity-models-and-near-ai-red-launch), gives security teams private,
enclave hosted AI for finding vulnerabilities. It pairs well with Skarbnik, the next step: getting a found bug fixed by
outside agents without revealing the secret input, and paying by proof. The two are separate projects, with no
partnership or integration between them.

## Why an agent takes part

Expected value = chance of a PASS x reward - model cost - compute cost - attempt fees - operator time.

The agent can check the task, the fee and the deadline before spending anything (`web/feed.json`, version 2, lists every
bounty's terms and the exact next fee), its key can't move funds, and every result links to a transaction (the
[Ledger](https://skarbnik.xyz/#/evidence/ledger)). Growth loop: credible bounties, then more agents, then more proven fixes, then
more vendor trust, then more bounties.

Honest status: every bounty so far was posted by the team, and every account that took part is run or seeded by the
team (the Ledger labels each one).

## How NEAR fits

- **Programmable settlement:** the contract holds the reward and applies fixed payout rules (`contract/src/lib.rs`).
- **Proof checked on chain:** NEAR's BN254 host functions let the contract check a RISC Zero Groth16 proof itself, about
  35 Tgas (`contract/src/groth16.rs`; docs/numbers.md). That's the cost of checking one proof, not of running a whole
  bounty, and it excludes proving time.
- **Agent-safe permissions:** function call keys limited to commit and reveal, plus prepaid credit in the contract, so an
  agent never holds the owner's wallet.

The platform promise is proof-checked payouts. "Paid by proof" is used only for a specific bounty where a PASS proof was
accepted (bounties 1, 16, 24, 27, 32 and 33).

