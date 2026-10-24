# Security

What protects a bounty, what we attacked on purpose, and what is still trusted. Plain language first, then the detail.
Every claim names the code and the test, command or transaction that shows it. Full outputs are in
[EVIDENCE.md](EVIDENCE.md).

## 1. Guards

Each guard: what it stops, where it lives, and what shows it works.

### The checker (what a patch must survive)

| Guard | What it stops | Code | Shown by |
| --- | --- | --- | --- |
| Module validation: at most 2,048 bytes, no imports, the expected exports, at most 2 memory pages, no start function, no floats | Patches that call out to the host, oversized or malformed modules | `harness/checker/src/exec.rs` (`Loaded::load`) | cheats `imports_host`, `wrong_export`, `too_large`, `invalid_truncated`, `memory_declared` all FAIL (EVIDENCE, S1) |
| The secret crash input must not crash and must finish within fuel | Patches that do not fix the crash, or that loop forever | `harness/checker/src/lib.rs` (`check_report`), `exec.rs` (fuel 50,000 per input) | `original`, `wrong_fix`, `loop_forever` FAIL (S1) |
| All public tests must give the original's answers | Patches that reject everything, return a constant, or break the format | `lib.rs` | `reject_all`, `constant`, `early_return_prefix`, `disable_lists` FAIL (S1) |
| Fairness: inputs drawn from a seed fixed only at reveal must give the original's answers | Patches that only memorize the public tests or change behaviour elsewhere | `lib.rs`, `harness/checker/src/gen.rs` | `memorize_tests`, `subtle_change`, `overbroad_fix` FAIL; with the step off they PASS (S1); 200 seed sweep (S1) |
| Crash variants: near copies of the secret must not crash where the original crashes | Patches that special-case the exact secret bytes; partial fixes used as probes | `lib.rs`, `gen.rs` | `special_case_exploit` FAIL (S1); arena probes always FAIL with this step on (S8) |
| A fresh interpreter instance per input, with fresh memory, globals and state | A patch remembering one input (for example the secret) to behave differently later | `exec.rs` (`Loaded::run`) | 20 of 20 corpus verdicts identical before and after the allocator change, natively and in the zkVM (S2b) |
| The published result is PASS or FAIL only, never a reason | Learning more than one bit per verdict | `harness/checker/src/zk.rs` (`Journal`) | arena: at most one bit per attempt (S8) |
| Proof 0 refuses a secret longer than any module may receive (added in S13) | An "unfixable" bounty: an over-long secret made every patch fail | `lib.rs` (`proof0_report`) | `cargo test -p kintsugi-check` test `s13_overlong_exploit_is_refused_by_proof0`; S13 attack 1 (EVIDENCE, S13) |
| Proof 0 with a reference fix: the vendor's own fix must pass the full check (added in S13) | A bounty no patch could ever pass | `lib.rs` (`proof0_with_reference`), `harness/check-guest/src/main.rs` (Proof 0 mode) | tests `s13_proof0_with_reference_fix_*`; S13 Proof 0, VALID and PASS on the reference fix (EVIDENCE, S13) |

### The proof (what a receipt binds)

| Guard | What it stops | Code | Shown by |
| --- | --- | --- | --- |
| The receipt is checked against the checker program's image id | A receipt from another program | `host/src/main.rs` (`verify`), `scripts/verifier_check.sh` | verifying with another image id fails (EVIDENCE, S4 native verifier tests) |
| Changing the journal or one bit of the proof breaks verification | Forged or edited receipts | RISC Zero verification | `kintsugi-host tamper ... journal` and `... seal`, then `verify`: both INVALID, exit 1 (S1 zkVM part) |
| The journal binds the candidate hash, the original hash, sha256(salt || secret), the public tests' hash, the seed, the counts and the submission id | Reusing a receipt for another patch, bounty, secret, test set or seed | `zk.rs`, `harness/check-guest/src/main.rs` | the Level 0 check compares all of them with the chain (S4, 11 of 11 checks) |
| The submission id is sha256 of the contract account, bounty id, index and patch hash | Replaying a receipt on another bounty or attempt | `contract/src/lib.rs` (`submission_id`) | S4 Level 0 check; S13 attack 4 |
| A Proof 0 journal carries an id only Proof 0 mode can produce (added in S13) | Passing off a normal check as a Proof 0 | `harness/check-guest/src/main.rs` | S13 Proof 0 receipt (`docs/evidence/S13/verify_proof0.txt`) |

### The contract (who may do what, and when)

| Guard | What it stops | Code | Shown by |
| --- | --- | --- | --- |
| Commit then reveal: the fingerprint binds the patch, the payout account and a nonce | Copying a patch from the chain; changing the patch or payout after commit | `contract/src/lib.rs` (`commit_fingerprint`, `reveal`) | unit tests `wrong_patch_rejected`, `wrong_nonce_rejected`, `fingerprint_binds_payout_account`, `only_committer_reveals` |
| The fairness seed is recorded at reveal, after the patch is fixed | Tailoring a patch to the fairness inputs | `reveal` | S4: the journal seed equals the seed recorded at reveal |
| A verdict is final only with matching attestations from two different registered verifiers; a repeat counts once | One verifier deciding alone | `record_attestation` | unit test `same_verifier_twice_counts_once`; S3 testnet ("duplicate") |
| The vendor can never be a verifier, and a researcher cannot attest its own submission | Self-confirmation | `register_verifier`, `record_attestation` | unit tests; S5 on chain ("a vendor account cannot be a verifier") |
| Deadlines by block time: a late verdict is refused; with no final verdict the researcher can claim the timeout | A vendor that stays silent, or answers too late | `post_verdict`, `claim_timeout` | S3 testnet: early timeout refused, late verdict refused, timeout paid |
| Expiry refunds an unpaid bounty only when no revealed submission is still waiting | A vendor taking back money owed to a researcher | `expire` | unit test `expire_waits_for_revealed_submission` |
| At most K counted commits per bounty; later ones are ignored and cost nothing | Unlimited attempts, and so unlimited leakage | `commit` | S8 testnet: fourth commit ignored ("max_commits reached") |
| Attempt fees, rising per attempt, paid from prepaid credit; fees go to the verifiers | Free flooding of attempts | `commit`, `deposit_credit`, `expire` | S3b testnet |
| Withdrawing credit needs 1 yoctoNEAR attached | An agent's function call key draining the credit | `withdraw_credit` | S7: refused for the agent key |
| OutLayer's answer is accepted only as the callback of the contract's own request, and only if every echoed value matches | A forged OutLayer answer | `request_outlayer_check`, `on_outlayer_result` | 9 unit tests; S5 on chain ("Method on_outlayer_result is private") |
| A bounty opens only after two different verifiers attest its Proof 0 (added in S13) | Attempts on a bounty that may be unfixable | `attest_proof0`, `commit` | unit tests `s13_commit_before_proof0_rejected` and others; S13 attacks 1, 6 and 7 on testnet |
| A reveal window; anyone can free the slot of a commit never revealed (added in S13) | Junk commits holding all K slots forever | `reveal`, `release_unrevealed` | unit test `s13_unrevealed_junk_commits_can_be_released`; S13 attack 2 on testnet |
| The winner's own attempt fee is refunded with the payout (added in S13) | Penalizing the honest winner | `record_attestation`, `claim_timeout` | unit test `s13_winner_fee_refunded_on_pass`; S13 attack 11 on testnet (+0.51 NEAR = bounty + own fee) |

### Keys

| Guard | What it stops | Shown by |
| --- | --- | --- |
| An AI agent works through a function call key limited to `commit` and `reveal` on the bounty contract | The agent (or whoever steals its key) moving its owner's money | S7: transfer refused (`RequiresFullAccess`), other method refused (`MethodNameMismatch`), deposits refused |

## 2. Attacks we tried

| Date | Commit | Attack | Command | Result |
| --- | --- | --- | --- | --- |
| 2026-10-23 | `d150da2` | 18 cheating patches (reject all, constant, special-case the secret, loop forever, memory tricks, early return, disable a feature, memorize tests, wrong fix, subtle change, overbroad fix, wrong export, imports, too large, truncated) | `target/debug/kintsugi-check table --manifest data/attacks/manifest.txt --seed <hex>` | **blocked**: all FAIL except `memory_grow`, **accepted risk**: its oversized memory request is refused by its own limit, it gets no memory and behaves exactly like the honest fix |
| 2026-10-23 | `d150da2` | Same cheats over 200 seeds, 128 fairness inputs | seed sweep (`docs/evidence/S1/seed_sweep.txt`) | **blocked** on every seed; the honest fix passed on every seed |
| 2026-10-24 | `2b41cad` | Change the verdict in a receipt's journal; flip one bit of the proof | `kintsugi-host tamper <in> <out> journal`, `... seal`, then `kintsugi-host verify <out>` | **blocked**: INVALID, exit 1 |
| 2026-10-23 | `f24e01d` | Claim the timeout early; post a verdict after its window; expire early | `scripts/s3_testnet.sh` | **blocked** on chain ("deadline has not passed", "verdict window has closed", "bounty has not expired") |
| 2026-10-24 | `2b4c761` | Commit without credit; expire twice | `scripts/s3b_testnet.sh` | **blocked** on chain ("not enough credit", "nothing to do") |
| 2026-10-24 | `f169bbb` | A stranger calls the private OutLayer callback; the owner registers the vendor as a verifier | `call_expect_fail` in `scripts/s3_lib.sh` | **blocked** on chain ("Method on_outlayer_result is private", "a vendor account cannot be a verifier") |
| 2026-10-24 | `dbe874c` | An agent's function call key sends NEAR, attaches a deposit, calls another method | `scripts/s7_agent.sh limits` | **blocked** (CLI before sending; chain: `RequiresFullAccess`, `MethodNameMismatch`) |
| 2026-10-24 | `1e7976f` | A probe agent tries to learn the secret; a fourth probe beyond K | `scripts/s8_arena.sh`, `scripts/s8_chain.sh` | **accepted risk**: one bit per attempt, 3 bits with K = 3 (the vendor chooses K); with the variant check on, 0 bits; the fourth commit **blocked** (ignored) |
| 2026-10-24 | pending | (3) Sub-accounts of one researcher fill the K = 3 slots of a bounty | `scripts/s13_attacks.sh misc` | **accepted risk**: allowed, each paying the rising fee (0.01, 0.015, 0.02 NEAR); a fourth commit was ignored and not charged; K is per bounty, so the leak stays at most K bits; blocking one reveal window costs 0.045 NEAR, the next 0.09 NEAR, and so on (section 3) |
| 2026-10-24 | pending | (1) An unfixable bounty: a 300 byte secret (over the 256 byte limit) | `scripts/s13_attacks.sh open` | **not blocked before S13 (guard added)**, now **blocked**: Proof 0 refuses it; a commit before two Proof 0 attestations is refused on chain (EVIDENCE, S13) |
| 2026-10-24 | pending | (2) Junk commits that are never revealed hold all K slots | `scripts/s13_attacks.sh misc` | **not blocked before S13 (guard added)**, now **blocked**: early release refused; after the reveal window the slot was freed and a new commit fitted (EVIDENCE, S13) |
| 2026-10-24 | pending | (4) The vendor replays another submission's PASS receipt | `scripts/s13_attacks.sh bounty_b` | **blocked**: the verifier check fails on submission id and seed; no attestation; the researcher was paid by timeout (EVIDENCE, S13) |
| 2026-10-24 | pending | (5) A verifier attests PASS while the vendor posted FAIL | `scripts/s13_attacks.sh attack_a` | **blocked** on chain ("attestation does not match the posted verdict") (EVIDENCE, S13) |
| 2026-10-24 | pending | (6) An unregistered account attests Proof 0 | `scripts/s13_attacks.sh misc` | **blocked** on chain ("caller is not a registered verifier") (EVIDENCE, S13) |
| 2026-10-24 | pending | (7) The same verifier attests Proof 0 twice | `scripts/s13_attacks.sh misc` | **blocked**: the bounty stays closed with one attestation (EVIDENCE, S13) |
| 2026-10-24 | pending | (8) Timeout or expire too early, or again after payout | `scripts/s13_attacks.sh bounty_b, attack_a` | **blocked** on chain ("bounty has not expired", "deadline has not passed", "bounty is closed", "nothing to do") (EVIDENCE, S13) |
| 2026-10-24 | pending | (9) A receipt made by another checker program | `scripts/s13_attacks.sh bounty_b` | **blocked**: does not verify with the bounty's image id (EVIDENCE, S13) |
| 2026-10-24 | pending | (10) A reveal that does not match its commit | `scripts/s13_attacks.sh misc` | **blocked** on chain ("fingerprint does not match") (EVIDENCE, S13) |
| 2026-10-24 | pending | (11) The vendor posts FAIL for a fix whose real receipt says PASS | `scripts/s13_attacks.sh attack_a` | **blocked**: both verifiers refuse (journal verdict differs); after the window the researcher was paid by timeout, +0.51 NEAR (bounty and own fee) (EVIDENCE, S13) |

## 3. Known limits

- **Verification levels and what each trusts.**
  - Level 0 (works on testnet): the contract trusts its registered verifier accounts to check each receipt before attesting
    (`scripts/verifier_check.sh`). **On testnet all three verifier accounts are run by us**, including the third; a real
    deployment needs verifiers run by independent parties.
  - Level 1 (built, not working on testnet yet): one verifier is an OutLayer job. The contract then trusts the OutLayer
    contract, its owner and every key on its operator account, which includes keys that do not need an enclave; who holds them
    is not known. On testnet OutLayer answers jobs whose program file it already has cached, but none of our jobs (its
    program must be downloaded first) has been answered: 9 of 9 such jobs (8 of them ours) timed out, by link from two hosts and as an OutLayer project on
    FastFS, while OutLayer's own cached test program answered in 10 to 14 s (EVIDENCE, "OutLayer (Level 1) on testnet").
    The cause is inside OutLayer; the FastFS gateway was also down during the project test.
  - Level 2 (not built): the contract would check the proof itself; no outside party trusted for the verdict.
- At Level 0 the contract does not check a receipt; a dishonest majority of verifiers could attest a false verdict.
- One verdict leaks at most one bit about the secret; K is the leak budget, chosen by the vendor. K is per bounty and
  counts every committer together, so sub-accounts cannot raise the total leak above K bits: a slot is freed only by
  `release_unrevealed`, and only for a commit that was never revealed, so at most K submissions per bounty are ever
  revealed and get a verdict. A vendor who reuses the same secret in several bounties gives a separate budget of K per
  bounty.
- Anyone, with as many accounts as they like, can hold all K slots with junk commits for one reveal window. With the
  test settings (K = 3, `attempt_fee` 0.01 NEAR, `fee_step` 0.005 NEAR) the first window costs 0.01 + 0.015 + 0.02 =
  0.045 NEAR; the fees are kept (swept to the verifiers), and because `commits` never goes down, window w (from 0) costs
  0.045 + 0.045 w NEAR, so W windows in a row cost 0.0225 W (W + 1) NEAR (10 windows: 2.475 NEAR). After each window
  anyone can free the slots and commit. **Accepted risk**: the cost of blocking grows with every window, the leak stays
  at most K bits, and the vendor sets K, both fees and the reveal window.
- RISC Zero states its zero knowledge property is not formally proven. Its Groth16 step is not quantum safe and rests on a
  trusted setup; NEAR's own NEP-488 rates the BN254 curve below 100-bit security (only relevant once Level 2 exists).
- The vendor sees each patch before paying; the timeout path protects the researcher.
- Arena verdicts (S8) come from the native checker, not proofs. Timing and other side channels are not measured.
- Proving is slow on a laptop CPU (16 fairness inputs: 47 to 48 minutes, plus 15 to 16 minutes to compress).
- Narrow scope: crash bugs in a small module that compiles to WebAssembly; the fairness generator knows only the demo format.
- Testnet only. No security audit.

## 4. Changelog (newest first)

- 2026-10-24 (pending commit): OutLayer second try: verifier published on FastFS as project
  `kintsugi-ol-hfoez.testnet/farbox-verifier` with OutLayer's tool; still no answer (requests 5618 to 5620). No guard changed.
- 2026-10-24 (pending commit): OutLayer Level 1 diagnosis: no guard changed; the known limit now says what was found
  (testnet answers cached programs only; ours never answered). Measured verifier needs: 878,730,118 instructions, 3.4 MB.
- 2026-10-24 (pending commit): S13 attack pass on testnet: attacks 1, 2, 4 to 11 blocked; attack 3 accepted risk.
- 2026-10-24 (pending commit): S13 guards in code: Proof 0 refuses an over-long secret and needs a reference fix; bounties
  open only after two Proof 0 attestations; reveal window and `release_unrevealed`; winner's fee refunded.
- 2026-10-24 `f169bbb`: OutLayer callback refusals on chain (private callback, vendor as verifier).
- 2026-10-24 `6c24c1d`: OutLayer answer accepted only as the callback of the contract's own request, with every echoed value
  matching.
- 2026-10-24 `dbe874c`: agent function call key limited to `commit` and `reveal`, refusals recorded.
- 2026-10-24 `1e7976f`: arena: K caps the leak; fourth commit ignored on chain.
- 2026-10-24 `2b4c761`: attempt fees from credit, rising per attempt; `withdraw_credit` needs 1 yoctoNEAR; fees to verifiers.
- 2026-10-24 `8aead8c`: fresh interpreter per input kept; verdicts identical after the allocator change.
- 2026-10-24 `2b41cad`: receipts bind the journal; tampered journal or seal fails verification.
- 2026-10-23 `f24e01d`: contract: two different verifiers, vendor never a verifier, block-time deadlines, timeout, expiry.
- 2026-10-23 `d150da2`: checker: validation, crash input, public tests, seeded fairness, crash variants; cheat corpus.
