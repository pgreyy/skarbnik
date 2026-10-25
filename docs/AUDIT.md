# Contract audit (round 1 and a second review of the fixes)

Audited commit: `bab84c5f4482801e0a08f5dca2f24947cfabe688` (frozen 2026-10-25 00:44 UTC; no code changed until every
finding was in). Three independent reviewers, each briefed on one angle (money flow; proof checking; griefing, economics
and NEAR-specific traps), were given the code and the design documents only: not the project's own attack table or
conclusions. Every reported finding was then reproduced by the project with a failing unit test on a copy of the contract
or with a testnet transaction, or marked unconfirmed. Six fixes followed, one commit each with regression tests; a fourth
reviewer then checked only the changed code. NEAR testnet only. The reviewers' full reports are private working material;
this file holds everything that bears on the code.

## Scope

In scope: `contract/src/lib.rs` (the bounty contract: Level 0 and Level 2 paths, fees, credit, the protocol fee pool,
timeouts and expiry), `contract/src/groth16.rs` and `groth16_vk.rs` (the Groth16 check and its constants),
`contract/src/tests.rs` and `tests_level2.rs`, and the journal layout the contract depends on (`harness/checker/src/zk.rs`,
`harness/check-guest/src/main.rs`).

Out of scope: the web page, the proving harness and the checker's logic (except the journal layout), the scripts, OutLayer's
service, RISC Zero's prover and its trusted setup, NEAR itself, and the operation of the vendor's prover.

## Fixes (commits on top of the audited commit)

| Fix | Commit | What changed |
| --- | --- | --- |
| 1 | `dfd04c3` | A commit must leave time for the reveal window and the verdict window before expiry, a reveal a full verdict window; a Level 2 proof is no longer refused after expiry (the window bounds it); windows capped at 30 days, expiry at 366 days and at least the sum of the gap and the three windows |
| 2 | `c8c7566` | The payout account cannot be a registered verifier, the vendor or the contract; a registered verifier cannot commit |
| 3 | `3377348`, `a968fa5` | The earliest reveal has priority: a PASS or a timeout for an attempt is refused while an attempt revealed earlier is still undecided (`a968fa5` corrects a test that did not compile in `3377348`) |
| 4 | `5cb277c` | Level 2 fees of decided attempts go to the protocol fee pool at expiry, never to the vendor; when a bounty closes, the fees of other revealed, undecided attempts are refunded as credit |
| 5 | `affaa5a` | Owner allowlist of checker image ids (`allow_image_id`, `get_allowed_image_ids`); `get_bounty` shows `image_id_allowed` |
| 6 | `8762144` | From the second review: same-block reveals tie-break by index; a reveal gap of zero is refused; a stored allowlist that does not decode fails closed (an empty list still allows any id); stale comments corrected |

None of the fixes changes the contract's stored layout or the checker's image id; the fixed contract was redeployed in place
on `kintsugi-l2-cihdp.testnet` (first `Gr63BrfkdxGDcnvQGBrtrpu4rtRsF1ZYVorsCqFk4Qjq`, wasm `2e798b70...f9d7`, and the
allowlist set to the reproducible id with `BLQoFNQ7Vz3Le4TruAgU4YkeKDtexYquQSTcZALpRvWM`; fix 6 deployed afterwards with `7EL7CrM2iGs6cbBXa9QXCDLcSDFPNeRxz9Rb9U75nSLK`, wasm `e4e2b923...59ed`). The live demo bounty 7 is untouched. Unit tests after the fixes: 94 passed
(`docs/evidence/audit1/contract_unit_tests.txt`).

## Findings

Severity is the reviewers' rating (the highest where they overlapped). "Shown by" names the reproduction (a unit test in
`contract/src/tests*.rs` after the fix; the pre-fix reproductions are described in the text) or the testnet transaction.

| # | Severity | Finding | Found by | Status | Fix | Shown by |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | critical | A junk reveal just before expiry was paid the whole bounty by timeout on a Level 2 bounty: `submit_groth16` refused every proof after expiry, while commits, reveals and `claim_timeout` did not care about expiry and `expire` was blocked by the pending submission. Anyone with one attempt fee could drain any Level 2 bounty, including the live demo. | A, B, C | fixed | `dfd04c3` | reproduced before the fix with two unit tests on a scratch copy (the vendor's proof refused "bounty has expired"; the thief's `claim_timeout` paid); after the fix `audit_f1_*` (5 tests); on testnet a commit too close to expiry refused (rerun) |
| 2 | critical | The vendor (or anyone) could copy a revealed passing patch into a second account and be paid first; a copier could also time out first against a slow researcher. No rule gave the first reveal priority. | C (A overlaps) | fixed | `3377348`, `a968fa5` | reproduced before the fix (`repro_c2_*`: the second account was paid, the honest first reveal stayed Open); after the fix `audit_c2_*` (5 tests); on testnet the later reveal's timeout refused while the first was undecided (rerun) |
| 3 | high | The vendor's second account could reveal junk first and, with the vendor silent, time the bounty out to itself, keeping the bounty, every honest fee and the revealed fixes. | A | partly fixed, residual stated as a known limit | fix 3 (ordering) and fix 4 (fees) | reproduced before the fix (`repro_a_f2_*`); now the vendor no longer gains fees (fix 4) and a later honest reveal is refunded; a junk reveal that comes FIRST can still be timed out to the vendor's account (S7 in the hardening list) |
| 4 | high | Windows had no cap; with `attest_window_ns = u64::MAX` the deadline saturated and never passed, so after a posted verdict the researcher's timeout was impossible forever and the bounty stayed locked. | A, C | fixed | `dfd04c3` | reproduced before the fix (`repro_a_f3_*`: "deadline has not passed" at the end of time); after the fix `audit_f3_*` |
| 5 | high | Naming a registered verifier as payout blocked that verifier from attesting (the self-attestation guard); a verifier committing with another verifier as payout blocked two, so no verdict could become final and the timeout paid. | C | fixed | `c8c7566` | reproduced before the fix (`repro_c_h2_*`); after the fix `audit_h2_*` (3 tests); on testnet refused (rerun) |
| 6 | high | The vendor chose any image id; nothing pinned the published checker, so a Level 2 verdict was exactly as trustworthy as the vendor's program, and a fake checker could farm attempt fees. | B, C | fixed (owner allowlist) | `affaa5a` | `audit_f5_*` (4 tests); allowlist set on `kintsugi-l2-cihdp.testnet` (tx `BLQoFNQ7Vz3Le4TruAgU4YkeKDtexYquQSTcZALpRvWM`) |
| 7 | high | Level 2 attempt fees of revealed attempts went to the vendor at expiry: a vendor profited from failed attempts (fee farming with an unfixable or fake bounty), and honest losers' fees were swept although they were never judged. | A, B, C | fixed | `5cb277c` | `audit_f4_*` (2 tests); on testnet: a FAILed attempt's fee to the pool at expiry, the undecided attempt's fee refunded (rerun) |
| 8 | high | A payout to a payout account that does not exist fails silently: the state says Paid, the transfer receipt fails, the NEAR stays in the contract with no record and no way out. | C, A | confirmed, not fixed (known limit; S4 pull payments) | none | testnet: bounty 8 on `kintsugi-l2-cihdp.testnet`, tx `AKU4pVTmS3uwmLcGyHAXTekiBELoV5GRMqJeSPMq1BVk` (receipt to `ghost-kintsugi-audit-zqx.testnet`: `AccountDoesNotExist`, contract balance unchanged) |
| 9 | high | A commit-only agent key can spend its owner's whole credit on one attacker-set attempt fee and send any winnings to any payout account; the README said the key "cannot move its owner's money". | C | confirmed, not fixed (known limit; S6 spending limits); docs corrected | none | `repro_c_h4_*` before the fix (credit 1 NEAR to 0 in one call) |
| 10 | medium | The vendor chooses the Proof 0 seed (and the salt), so Proof 0 shows the reference fix passes for one seed only. | B | confirmed, not fixed (known limit; S8) | none | by reading (`guest/main.rs`, `open_with_groth16`) |
| 11 | medium | RISC Zero's verifier constants are fixed and unversioned; a prover upgrade would strand open Level 2 bounties into paying every attempt by timeout. | B | confirmed, not fixed (known limit; S9) | none | by reading (`groth16_vk.rs`) |
| 12 | medium | Storage is not accounted: the contract's own balance is the hidden reserve for storage, and it can be ground down (tiny credit deposits, short-lived bounties). | A, C | confirmed, not fixed (known limit; S5) | none | reconciliation of the live contract (3.08 NEAR of 11.22 staked for storage) |
| 13 | medium | A failed OutLayer request refunds the caller's deposit to the contract, not the caller. | A, C | confirmed by reading, not fixed (Level 1 is off) | none | not run (OutLayer does not answer) |
| 14 | medium | No `remove_verifier`; verifiers are paid the fee sweep for no work; the contract account's full access key is the real owner; slot griefing is cheaper than the accepted-risk arithmetic when `fee_step` is 0. | A, C | confirmed, not fixed (known limits; S10, S12, S14) | none | by reading |
| 16 | medium | Second review: the earliest-reveal rule compared reveal times with a strict "earlier than", so two reveals in one block tied and neither blocked the other; with a reveal gap of zero (allowed) a copier who sees a reveal before inclusion could land commit and reveal in one transaction and reproduce finding 2. | second review | fixed | `8762144` | `audit_r2_*` (3 tests); this fix was written after the second review and was not itself independently reviewed |
| 15 | low | A commit too close to expiry could never be revealed and lost its fee for certain; the vendor cannot cancel an unopened bounty; copycat bounties from the public Proof 0; no chain tag in the submission id. | A, B, C | the first is fixed by fix 1; the rest noted (S11, S13) | `dfd04c3` | `audit_f1_commit_that_cannot_be_decided_before_expiry_is_refused` |

Categories where the reviewers looked and found nothing: the Groth16 verification itself (claim digest, public inputs,
point negation, byte order), the journal parser (every malformed shape refused before the expensive check), the field
binding of attempts (all nine fields), replay across bounties, attempts, contracts, levels and Proof 0 versus attempt,
Level 0 versus Level 2 call confusion, rounding, double payouts, and the credit and fee bookkeeping inside the contract.

## Unfixed findings, stated as known limits

- Finding 3 (residual): since S7 (hardening round, below) a silent vendor's timeout is split equally among every revealed
  attempt still undecided, so a vendor's junk revealed first no longer takes the whole bounty: with one honest fix
  pending it keeps half. What remains, stated plainly: a vendor that reveals m junk attempts from its own accounts keeps
  m/(m+1) (m is at most K - 1, K at most 16), and its fees come back with the shares, so the cost to it is only gas.
  S7 also gives a copy of a revealed fix an equal share when the vendor is silent (before S7 a later copy got nothing,
  fix 3). Both apply only to a silent vendor; a PASS still pays only the earliest passing reveal.
- Finding 8: payouts are detached transfers; a payout account that does not exist loses the payout into the contract.
  S4 (pull payments) is the fix and is deliberately not built in this round (owner's decision, 2026-10-25).
  `scripts/agent_preflight.sh` (S16) refuses a payout account that does not exist; a researcher who skips it can still
  lose a payout this way.
- Finding 9: since S6 an account can set `set_agent_limits` (1 yoctoNEAR, which a function call key cannot attach): a
  largest fee per commit and a fixed payout. With limits set, the agent key cannot spend more than the limit on one
  attempt nor send winnings elsewhere; it can still spend the whole credit over many attempts. Without limits set, the
  finding applies unchanged.
- Findings 10 and 11: the Proof 0 seed is the vendor's choice; the RISC Zero constants are unversioned.
- Finding 12: no storage accounting; the contract's faucet balance covers storage today.
- Finding 13: the OutLayer deposit refund (Level 1 is not in use).
- Finding 14: verifier set management, the owner key, cheap slot griefing with `fee_step = 0`.

## Where the protocol fee pool's fees should go (decided 2026-10-25: option A, locked)

Owner's decision: the pool stays locked in the contract as a declared reserve for storage. There is no method that
withdraws it and none is planned; it pays no one, so no one (the project included) profits from junk commits or missed
reveals. `get_protocol_pool` shows its size (0.09 NEAR on `kintsugi-l2-cihdp.testnet` before and after the hardening
redeploy, `docs/evidence/hardening/summary.txt`). The reviewers' views that led to the decision:

All three reviewers reject paying the pool to the project or owner (conflict of interest: the project would earn from
griefing and from agents that miss a reveal window), to the vendor (free self-blocking) and to the verifiers (no work,
and none at Level 2). They differ on the positive answer:

- A: keep it locked as a declared storage reserve, or burn it; publish the invariant (`get_free_balance`).
- B: pay each bounty's junk fees to that bounty's revealed attempts pro rata at `expire` (the people the junk hurt), else
  burn; make it pull based if recipients could be many.
- C: pay them to that bounty's winner (per-bounty accounting, one u128 per bounty), else leave locked; only after findings
  1 and 5 are fixed, which they now are.

## Owner powers

The owner account (`get_owner`) can register verifiers (`register_verifier`), set the Level 1 OutLayer settings
(`set_outlayer`) and add checker image ids to the allowlist (`allow_image_id`). The allowlist stays on (owner's decision,
2026-10-25): once it holds an id, `create_bounty` refuses every other id, so the owner decides which checker programs
bounties may use; an id cannot be removed, and bounties created before an id was listed show `image_id_allowed: false`.
The contract account's full access key can replace the code; removing or escrowing it (S14) is planned as the last step
before submission and is not done. Nothing else is owner-only; in particular the owner cannot move bounties, credit or
the pool.

## The skeptical judge (reviewers' views)

The first attacks all three expect: "the vendor picks the program, so your zero knowledge verdict is 'trust the vendor's
wasm'" (now answered by the allowlist and `check_image_id.sh ... MATCH`); "your timeout pays junk" (fix 1, with tests
named after the attack); "show the vendor cannot walk away with the fix" (fix 3; the residual of finding 3 must be stated);
"your demo secret is public" (true for the demo bounty 7; S18 answers it: bounty 12's secret and salt are not public); "who proves, and how fast" (66 minutes per proof on a laptop against the window and K; S19); "Groth16 trusted
setup, BN254 under 100 bits, unversioned constants" (documented with primary sources; S9). What already holds: the
contract's 35 Tgas on-chain verification with NEAR's alt_bn128 host functions, the function call key for the agent, the
commit and reveal with the payout bound before reveal, and the reproducible checker build.

## Suggested hardening (not applied; sorted by value over effort)

From the three reviewers' lists, merged where they overlap; "source" names the reviewer (A money flow, B proof checking,
C griefing and economics). Value and effort are the reviewers' ratings; where they differed, the higher value and the
larger effort are kept. "Judges" marks items that would help the project stand out to a skeptical judge.

| # | Suggestion | Value | Effort | Stored layout | Image id | Source | Judges |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | Native tests for the Level 2 attempt path: a real testnet attempt seal and journal as a second test vector, with the mock's account set to the deployed contract, so `submit_groth16` PASS and FAIL run in `cargo test`. Today they run only on testnet. | high | medium | no | no | B5 | |
| S2 | Negative tests for the parser and mode confusion: journals of 779, 781 and 0 bytes, a byte word of 256, verdict word 2, a 255 byte seal, a Proof 0 journal fed to `submit_groth16`, an attempt journal fed to `open_with_groth16`, the control root patched by one byte. | medium | small | no | no | B6 | |
| S3 | Reorder `submit_groth16`: all cheap binding checks before the 30 Tgas pairing check, so an honest mistake fails cheaply with a clear message. | medium | small | no | no | B4 | |
| S4 | Pull payments: on PASS or timeout record what is owed to the payout account and let it withdraw (1 yoctoNEAR), instead of a detached transfer that can fail silently (a payout account that does not exist, or a balance eaten by storage). Also fixes the OutLayer deposit refund. | high | medium | raw-key map (no struct change) or a new map in the contract | no | A9, C4 | yes |
| S5 | Track obligations: a `total_owed` counter (open bounties, credits, fees, pool, owed payouts) and a `get_free_balance` view; require balance >= owed + storage stake after every state change; charge a storage deposit per bounty and per revealed submission so the contract's own balance is not the hidden reserve. | high | medium | one u128 (or raw key); storage deposits may need per-bounty fields | no | A7, A8, C5 | yes |
| S6 | Agent spending limits: a per-depositor `max_fee_per_commit` and an optional fixed payout account, set only with 1 yoctoNEAR (so a commit-only key cannot change them); `commit` refuses a fee above the limit. Closes the "a commit-only key can spend the whole credit on an attacker's bounty" finding. | high | small to medium | raw-key maps (no struct change) | no | A13, C6 | yes |
| S7 | Silent-vendor timeout paid to all revealed undecided submissions in equal shares (instead of the earliest deadline only), so a vendor's own early junk reveal costs it at least half the bounty when an honest fix is pending. | high | medium | no (payout semantics change) | no | A6 | |
| S8 | Proof 0 seed not chosen by the vendor: the contract records the block's random seed at creation and requires the Proof 0 journal to carry it; Proof 0 is then made after creation and `proof0_journal_hash` is no longer needed. | medium | medium | yes (one field, or reuse `proof0_journal_hash`) | no | B7 | |
| S9 | Record the RISC Zero verifier parameter set (control root, BN254 control id, verifying key hash) per bounty, with an owner method to add a second set, so a RISC Zero upgrade does not strand open bounties. | medium | medium | yes (one field) or raw key | no | B8 | |
| S10 | Owner `remove_verifier`; pay the fee sweep only to verifiers that attested on that bounty (data already in `Submission.attestations`), or to the pool when none did. | medium | small | no | no | A12, C9 | |
| S11 | Vendor-only `cancel_bounty` while the bounty is not yet open and has no commits (refund). | medium | small | no | no | A11, C13 | |
| S12 | Make slot griefing cost real: `fee_step` at least a fraction of `attempt_fee`, `attempt_fee` at least a minimum; or a higher fee for a commit never revealed than for a revealed one. | medium | small | no | no | C10 | |
| S13 | A chain tag ("testnet" or "mainnet", an owner setting) inside `submission_id` and the Proof 0 id, so a proof can never cross networks. | low | small | no | no (the id is a guest input) | B9 | |
| S14 | Document and operate: remove or escrow the contract account's full access key (a timelock or DAO); state the owner's powers in SECURITY. | high for trust | small (operational) | no | no | A14, C16 | yes |
| S15 | Simplify the audited surface: remove the Level 1 OutLayer entry points until OutLayer answers on testnet (two methods, one money path and one config key fewer). | low | medium | no | no | A15 | |
| S16 | Docs and agent script: say that a Level 2 verdict is only as good as the bounty's image id, that `check_image_id.sh` must print MATCH before committing (now also `image_id_allowed` in `get_bounty`), and that the five windows, the fees and K must be read before committing; make the agent script check them. | medium | small | no | no | B10, C17 | yes |
| S17 | Tests the reviewers found missing and this round did not add: a Level 2 FAIL sweep to the pool in `cargo test` (needs S1), `fee_step = 0`, expire with no verifiers, a storage growth estimate per bounty, and a check that `transfers()` is empty whenever the state does not change. | medium | small to medium | no | no | A16, C15 | |
| S18 | A live bounty with a private salt and a secret that is not in the repository, so the "fix a bug you are not allowed to see" story is a live instance, not a demonstration. | high | small (one vendor run) | no | no | B judge 3 | yes |
| S19 | Size the Level 2 verdict window to K times the measured proving time, with the arithmetic in the docs; or run the vendor side on a GPU. | medium | small (docs) | no | no | B5, A8, C M1 | |

### Overclaims the reviewers found (corrected in this round unless noted)

- README "no verifier has to be trusted for the verdict" and SECURITY "does not trust the vendor's word on a verdict": true only if the bounty's image id is a published checker. Now: the allowlist (fix 5) and `image_id_allowed`; the docs say so.
- "Stops a bounty whose secret no patch can ever fix": true for the vendor's chosen Proof 0 seed only (S8 open).
- "Pays the researcher by default if the vendor stays silent": before fix 1 this also paid junk revealed in the last hour; before fix 3 a vendor's second account could pre-empt it. The residual (a vendor's junk revealed FIRST, S7) is stated as a known limit.
- "An agent key that can only commit and reveal cannot move its owner's money": true for the wallet, false for the credit (S6 open); the docs now say so.
- README test counts and ARCHITECTURE "Level 2, not built": stale; corrected.
- "A vendor cannot block its own bounty for free": for unrevealed junk, true (the pool); for revealed junk at Level 2 the fees went to the vendor before fix 4.

## Second review of the changed code

A fourth reviewer read only the diff of the five fixes and the current contract files. Verdict: all five fixes are
implemented where they claim and close the stated problems; fee accounting is sound (each fee leaves a bounty exactly once,
refunds are zeroed before credit is added, no path pays a refunded or closed submission again); the time boundaries are
consistent at the expiry instant. One medium finding (finding 16 above: the tie in the earliest-reveal rule) became fix 6.
Low and informational points: `register_verifier` can recreate finding 5 if the owner registers an account that already
has an open submission (operational: register verifiers before bounties exist); the self-attestation guard in
`record_attestation` is now a second layer without its own test; the allowlist cannot shrink and applies at creation only;
refunded submissions stay `Open` and counted in `pending` (harmless, misleading in the view); the Level 2 `fees_swept`
event carries the text "protocol fee pool" where an account id used to be; the three Level 2 paths touched by fixes 1, 3
and 4 cannot be exercised natively (no attempt proof vector in the unit tests) and rest on the testnet rerun below. The
reviewer also wrote down a consequence of fix 3: a griefer who reveals junk early forces the vendor to decide it (two
attestations at Level 0, one proof at Level 2) before any later PASS is paid, and if the vendor does not, the junk is paid
by timeout, as a silent vendor is treated today; the honest researcher can only wait, never lose, and no deadlock exists
because windows are capped.

## Testnet rerun of the fixed attacks

Script `scripts/audit1_testnet.sh` (and `audit1b_testnet.sh`, see the note) on the redeployed contract
`kintsugi-l2-cihdp.testnet`, bounty 9: Level 2, opened with the reused Groth16 Proof 0 (tx
`BYxHMjZG4A19AB9tKQjMifVdWNimHf6AhHt48cHn6stj`), K = 4, reveal window 240 s, verdict window 1,200 s, expiry 2,400 s.
Raw output: `docs/evidence/audit1/rerun_run.txt`, `steps/`, `transactions.tsv`.

| Check | Transaction | Result |
| --- | --- | --- |
| fix 2: a commit naming a registered verifier as payout | `E7hEJfRcvS5Kzyoatkb43KcLqk33vTsRzeXaXQyPxTyg` | refused: "the payout account cannot be a registered verifier, the vendor or this contract" |
| the honest fix R revealed first (index 0), junk J second (index 1) | `HGNkEKSyQ24TerT5KUMwgJYjiKDjzNLZjiCQDRA9vXp2`, `6k58gVqXBPnX4K5G9M9LfjHGPZfsCxCxERzKsCAs8aRC` | accepted |
| a real FAIL proof for J, made on the laptop (prove 508.75 s, 3 segments; succinct 119.59 s; Groth16 181.64 s, container peak 7,019 MiB) | `7AbUjtucJ7e5Mex3pQtwyCXEV6VG1oxD6Q3HRfKSrmXs` | accepted, J Failed: a FAIL is not held back by the ordering rule |
| fix 1: a commit less than reveal window + verdict window before expiry | `5bBwtSrE1gfULKLKcBgvLZA2rEjSz9Mv8d5NtzTkwPU3` | refused: "too close to expiry: a commit must leave time for the reveal window and the verdict window" |
| fix 3: timeout of the later junk reveal K (index 3) while R is undecided | `CbKbvza1haqTm1uBtCfuA8RevdGMHzgrBE9Jtz9cxsxM` | refused: "an attempt revealed earlier is still undecided: decide it or time it out first" |
| fix 3: timeout of the first reveal R | `82M2gLJ5qzs6MB7ArPwPNrcTwDVzUNvCE9wSWA7NJQD3` | paid: researcher 1 +0.11 NEAR (0.1 bounty + own 0.01 fee) |
| fix 4: K's fee refunded as credit when the bounty closed | (same transaction) | researcher 2's credit +0.025 NEAR (K was the fourth commit: 0.01 + 3 x 0.005) |
| fix 4: at expiry the decided (FAILed) fee goes to the pool, nothing to the vendor | `E2vgNWQJccjApwuLxys5XZSKxiQHAymyZ7V3mRMKNCvD` | pool +0.035 NEAR = J's 0.015 + the 0.02 fee of an unrevealed commit (below); vendor balance change 0 |

Note on the extra commit: while the FAIL proof was running I misread a step's `exit=0` line as the end of the script and
started a second script against the same bounty (`audit1b_testnet.sh`). Its "too close to expiry" commit was accepted
because the cutoff had not yet arrived (tx `2PQDNpAY45XgYuxVUCXBFmjg5hofrr47CFe8bAKWcGs6`, index 2, never revealed), and
its two timeout calls were correctly refused with "deadline has not passed". The first script then continued unharmed;
the extra commit's 0.02 NEAR fee went to the pool at expiry by the never-revealed rule, which is why the pool gained 0.035
and not 0.015. Fix 6 was deployed after this rerun (`7EL7CrM2iGs6cbBXa9QXCDLcSDFPNeRxz9Rb9U75nSLK`), so the rerun tested fixes 1 to 5; fix 6 rests on its unit
tests.

## Hardening round (owner's choices, 2026-10-25)

Applied on top of fix 6, stored layout and checker image id unchanged (new state only under raw storage keys), redeployed
in place on `kintsugi-l2-cihdp.testnet` (tx `9vrrJwCswthVioqgPtrSnc6phWh2KDyzHKuBSuTEPqFz`, wasm `7d936eee...c836`; after
the final review's fix, tx `EEckT3Y7Q5guVoXHYvjozdphDD6U5auWSXUD9c56Xx5W`, wasm `938d5456...d1b7`). Unit tests: 119 passed.
Evidence: EVIDENCE, "Audit hardening round"; raw output `docs/evidence/hardening/`.

| Item | Status | What changed | Shown by |
| --- | --- | --- | --- |
| S7 | applied | a silent vendor's timeout is split equally among every revealed undecided attempt, each paid its share and its own fee; remainder to the claimed index | unit tests `audit_s7_*`, `review_s7_*`; testnet bounty 11, tx `6uem1gWAymCr2VzL3FofpQfVoqZGrzvXA2wERXnvaYpP` |
| S6 | applied | `set_agent_limits` (exactly 1 yoctoNEAR): `max_fee_per_commit` and `fixed_payout` per account, enforced in `commit`; `get_agent_limits` | unit tests `audit_s6_*`; testnet steps `s6_*` |
| S3 | applied | cheap binding checks before the pairing check in `submit_groth16` and `open_with_groth16` | testnet: a proof of another bounty refused for 2.35 Tgas (34.90 Tgas before) |
| S2 | applied | negative tests: journals of 779, 781 and 0 bytes, a byte word of 256, verdict 2, a 255 byte seal, Proof 0 and attempt journals swapped, one changed byte of the control root | unit tests `s2_*` |
| S1 | applied | the two real attempt proofs of the S6c run as unit test vectors (`contract/src/groth16_attempt_vectors.rs`), with the mock set to the deployed account and the recorded seeds | unit tests `s1_*` |
| S16 | applied | `scripts/agent_preflight.sh` (payout account exists, image id on a non-empty allowlist, windows, fees, K), wired into `scripts/s7_agent.sh` | `docs/evidence/hardening/preflight.txt` |
| S18 | done | bounty 12, Level 2, private salt, secret kept outside the repository, opened by its own Proof 0; `check_image_id.sh` MATCH. The original and the fix are the public demo files | EVIDENCE, S18; txs `ByJpYtUh5QJcgeVnYuroFFvMWnCGncRc7bMM5T1dTFQw`, `AwktYGNHGijdv2LWwQYeuc7yFyLoDs41AuJckxUQuPSJ` |
| S4 | not built (owner's decision) | known limit, finding 8; S16 refuses a missing payout account | |
| S14 | not done yet | planned as the last step before submission | |
| Pool | decided: locked (option A) | no withdraw method | section "Where the protocol fee pool's fees should go" |
| Allowlist | kept, documented as an owner power | | section "Owner powers" |

## Final review of the code changed since `bab84c5`

One reviewer read only the diff since the audited commit (fixes 1 to 6 and the hardening round) and the files around it,
without the project's own conclusions. It found no path that pays twice, strands funds, or lets a cheap check replace the
pairing check. Its findings and what was done:

| # | Severity | Finding | Reproduced | Done |
| --- | --- | --- | --- | --- |
| 1 | high | With the S7 split, a silent vendor's puppet accounts that reveal junk (before or after the honest fix) share the timeout: with K slots the honest fix can get as little as 1/K, and the puppets' fees come back, so it costs the vendor only gas | yes: `review_s7_puppets_revealed_after_the_honest_fix_share_a_silent_vendors_timeout` (K = 3, honest payout gets a third) | not changed: it is the consequence of the chosen rule. Before S7 the worst case was worse (a puppet revealed first took the whole bounty). Stated as a known limit; a different split is the owner's decision |
| 2 | medium | A sharer is paid although its own verdict window is still open, or although a FAIL is posted for it (Level 0, one attestation) | yes: `review_s7_a_sharer_with_a_posted_fail_and_an_open_window_is_still_paid` | not changed: excluding those attempts would let a Level 0 vendor post false FAILs to cut honest attempts out, and excluding open windows brings back "junk revealed first takes all". Stated as a known limit |
| 3 | low | After a PASS, other revealed undecided attempts were refunded but stayed counted in `pending` (the second review's open point) | yes: the extra assertion in `audit_f4_pass_refunds_the_fee_of_an_undecided_revealed_attempt` | fixed: `refund_undecided_revealed` no longer counts them as pending; they still show `Open` (there is no final outcome for them, and adding one would change the stored type) |
| 4 | low | `max_fee_per_commit` bounds one commit, not the total | by reading | docs already say the credit can still be spent over many attempts; a test now also checks the credit taken |
| 5 | info | The allowlist allows any id while empty and cannot remove an id | by reading | docs made precise (fixes table, owner powers); the preflight requires a non-empty list |
| 6 | info | A Level 0 sweep leaves `fees_collected` in the view (Level 2 zeroes it); `fees_swept` prevents a second payout | by reading | not changed (older behaviour, no money effect) |

