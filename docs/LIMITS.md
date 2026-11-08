# Known limits

Every known limit in one list, one line each. The detail, with the code, the tests and the decisions behind each one,
is in [SECURITY.md, section 3](SECURITY.md#3-known-limits); the review findings are in [AUDIT.md](AUDIT.md). Who can do
what: [THREAT_MODEL.md](THREAT_MODEL.md). The site shows the short version: https://skarbnik.xyz/#/evidence/limits

## The five that matter most

1. **Testnet only.** No mainnet contract exists; every transaction is on NEAR testnet with test NEAR, and every bounty
   so far was set up and run by the Skarbnik team, not by outside customers.
2. **Small programs only.** Crash bugs in small WebAssembly modules, patches up to 2,048 bytes; a bounty needs a working
   reference fix before it opens.
3. **Level 1 depends on OutLayer.** The contract trusts OutLayer and its operator and does not check the proof itself;
   OutLayer must be up and able to download the pinned verifier file from GitHub (or still hold it in its cache), or no
   check arrives and the timeout rule applies.
4. **A timeout pays whatever was revealed.** The contract does not look at the fix, so a timeout payment is not a pass;
   under a silent vendor an honest fix may get as little as 1/K of the reward.
5. **What is not shown yet.** An external audit (the contract had AI review passes only), outside customers, a wallet
   other than NEAR CLI signing a transaction, OutLayer downloading the pinned file afresh when the contract asks, and
   sealed hardware for OutLayer's workers (never claimed).

<details>
<summary>More limits</summary>

## Scope

- Testnet only, test NEAR, no token. No external security audit; the contract was reviewed in AI review passes.
- Crash, wrong output and memory safety bugs in a small module that compiles to WebAssembly (patches up to 2,048
  bytes), against defined public tests and a secret input. The fairness input generator knows only the demo format.
- Wrong output and memory safety bugs are judged by answers: the right answer on the secret input, and the same
  answers as the vendor's hidden reference fix on random inputs, near copies of the secret and up to 4 private sweep
  positions. The checker does not detect memory corruption in general: a fix that corrupts memory where no answer
  changes would pass. A fix must also behave exactly like the vendor's reference fix on those inputs (for example
  refuse an overlong name rather than cut it), so the vendor must state the required behaviour in the public code.
- The spike checker `77c2e2d1…` (no sweep) stays on the allowlist, because an id cannot be removed. It is retired:
  only test bounties 42 and 43 used it, and the site, the feed, the agent servers and the vendor tool accept only the
  crash checker and the output checker `005d8dc7…`.
- A bounty needs a reference fix: Proof 0 must pass before it opens, so a vendor with a crash but no fix cannot post
  one.
- PASS means this checker passed against the secret and the public tests, not that the patch is secure against
  everything.

## Trust

- The testnet contract's account keeps a full access key, so its owner can replace the code under live bounties. This
  is deliberate: it's an experimental testnet contract that will keep changing. The mainnet contract (skarbnik.near)
  is planned without an upgrade key the owner controls alone (key removed, or upgrades behind a multisig or DAO with a
  delay). Anyone can check that the code has not changed silently: `view_account` on `kintsugi-l2-cihdp.testnet` gives
  the live code hash, which must equal the last deploy listed in docs/EVIDENCE.md, "Contract code and every deploy".
- The owner decides which checker image ids bounties may use; an id cannot be removed from the allowlist.
- Level 2 trusts the BN254 curve (below 100-bit security by recent estimates, not quantum safe), RISC Zero's Groth16
  trusted setup, and two RISC Zero constants fixed in the contract for version 3.0.6.
- RISC Zero states its zero knowledge property is not formally proven.
- Level 0 trusts its verifiers, and on testnet all of them are run by the project.
- Level 1 trusts OutLayer, its operator and its signing keys: the contract settles on OutLayer's answer without checking
  the proof itself, and the answer does not prove which program ran. It depends on OutLayer downloading the pinned
  verifier file from GitHub
  (https://raw.githubusercontent.com/pgreyy/skarbnik/4e6a1f634bba37189edf288a857520d3ac3b5399/verifier/outlayer/farbox-verifier.wasm,
  sha256 `e60647ec50f76f591a6994963f1394d408f516947f2fe927e389daf2166346a8`) or holding it in its cache; when it cannot,
  no check arrives and the timeout rule applies. The owner sets that program for every Level 1 bounty and can change it.
  Each check costs about 0.011 NEAR and holds 2.8 NEAR while OutLayer works (returned). Run on testnet on
  bounties 36 to 39 (36 by a script; 37, 38 and 39 through the vendor tool).

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
- A payout to an account that does not exist is lost; the site and `scripts/agent_preflight.sh` refuse such an
  account.
- The protocol fee pool (fees of commits never revealed, and Level 1 and Level 2 fees of decided attempts) has no way out, by
  design.
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
- The wallet code is third party, pinned by sha256; only NEAR CLI was clicked through to a transaction. Intear's
  script
  keeps a wallet session key in the browser (it cannot spend on chain).

## Evidence

- Arena verdicts come from the native checker, not proofs; timing and other side channels are not measured.
- Older bounties (before the reproducible checker) use image ids nobody can rebuild; only bounties with the
  reproducible
  id `dd6c5f42...` can be checked with `./scripts/check_image_id.sh`.

</details>
