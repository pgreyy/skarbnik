# Known limits

Every known limit in one list, one line each. The detail, with the code, the tests and the decisions behind each one,
is in [SECURITY.md, section 3](SECURITY.md#3-known-limits); the review findings are in [AUDIT.md](AUDIT.md). Who can do
what: [THREAT_MODEL.md](THREAT_MODEL.md). The site shows the same list: https://skarbnik.xyz/#/evidence/limits

## Scope

- Testnet only, test NEAR, no token. No external security audit; the contract was reviewed in AI review passes.
- Crash bugs in a small module that compiles to WebAssembly (patches up to 2,048 bytes), against defined public
  tests and a secret input. The fairness input generator knows only the demo format.
- A bounty needs a reference fix: Proof 0 must pass before it opens, so a vendor with a crash but no fix cannot post one.
- PASS means this checker passed against the secret and the public tests, not that the patch is secure against
  everything.

## Trust

- The contract account still has a full access key, so its code can still be replaced (to be removed last).
- The owner decides which checker image ids bounties may use; an id cannot be removed from the allowlist.
- Level 2 trusts the BN254 curve (below 100-bit security by recent estimates, not quantum safe), RISC Zero's Groth16
  trusted setup, and two RISC Zero constants fixed in the contract for version 3.0.6.
- RISC Zero states its zero knowledge property is not formally proven.
- Level 0 trusts its verifiers, and on testnet all of them are run by the project. Level 1 (OutLayer) never answered.

## The vendor and the secret

- The secret sits wherever the vendor proves: its own machine, a rented GPU's memory for the run, or the project's VPS
  for the bounties it proves.
- The vendor sees every patch before it proves.
- Proving is slow on a laptop CPU (hours per attempt with compression); bounty 17 timed out for that reason.
- Demo bounties use a public salt, so their commitment is a plain fingerprint of a public input. Bounty 12 keeps its
  secret private but uses the public demo bug.
- The agents of bounties 17 and 24 ran on the same machine and as the same user as the vendor's private folder; their
  code never reads it, but nothing technical stopped them.

## Payouts

- The timeout pays without looking at the fix. A silent vendor's reward is split equally among every revealed attempt
  still waiting; in the worst case an honest fix gets 1/K, and a copied fix gets an equal share.
- A payout to an account that does not exist is lost; the site and `scripts/agent_preflight.sh` refuse such an account.
- The protocol fee pool (fees of commits never revealed, and Level 2 fees of decided attempts) has no way out, by design.
- Storage is not charged to anyone; the contract's own balance covers it.

## Attempts and accounts

- One verdict tells at most one bit about the secret; K, chosen by the vendor, is the budget per bounty. A secret
  reused in several bounties gets a budget per bounty.
- One person can use many accounts; the per-account cap limits one account, not one person.
- Anyone can hold all K slots with junk commits for one reveal window; each further window costs more.
- An agent key with limits set can still spend its whole credit one limited fee at a time.

## The site

- An attempt's record (needed to reveal) lives in the browser's storage and is offered as a file; clearing site data
  before revealing loses it.
- The wallet code is third party, pinned by sha256; only NEAR CLI was clicked through to a transaction. Intear's script
  keeps a wallet session key in the browser (it cannot spend on chain).

## Evidence

- Arena verdicts come from the native checker, not proofs; timing and other side channels are not measured.
- Older bounties (before the reproducible checker) use image ids nobody can rebuild; only bounties with the reproducible
  id `dd6c5f42...` can be checked with `./scripts/check_image_id.sh`.
