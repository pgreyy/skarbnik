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
| The checker is built reproducibly (inside RISC Zero's guest builder image, fixed folder and toolchain), so anyone can rebuild it and get the same image id (added 2026-10-24) | A vendor naming an image id that does not come from the published checker source | `harness/build.rs`, `scripts/check_image_id.sh` | the same id from two folders and two home folders, and no laptop path inside the guest (EVIDENCE, "Image id"); demo bounty 4 on `kintsugi-s13-tlryo.testnet` holds the reproducible id and `./scripts/check_image_id.sh kintsugi-s13-tlryo.testnet 4` prints MATCH (EVIDENCE, "Demo bounty") |
| Changing the journal or one bit of the proof breaks verification | Forged or edited receipts | RISC Zero verification | `skarbnik-host tamper ... journal` and `... seal`, then `verify`: both INVALID, exit 1 (S1 zkVM part) |
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
| Deadlines by block time: a late verdict is refused; with no final verdict the researcher can claim the timeout (a liveness rule, not a verdict: it does not show the fix is correct) | A vendor that stays silent, or answers too late | `post_verdict`, `claim_timeout` | S3 testnet: early timeout refused, late verdict refused, timeout paid |
| Expiry refunds an unpaid bounty only when no revealed submission is still waiting | A vendor taking back money owed to a researcher | `expire` | unit test `expire_waits_for_revealed_submission` |
| At most K counted commits per bounty; later ones are ignored and cost nothing | Unlimited attempts, and so unlimited leakage | `commit` | S8 testnet: fourth commit ignored ("max_commits reached") |
| Attempt fees, rising per attempt, paid from prepaid credit; fees of decided attempts go to the verifiers (Level 0) or the protocol fee pool (Level 2, since audit fix 4), fees of commits never revealed to the protocol fee pool | Free flooding of attempts | `commit`, `deposit_credit`, `expire` | S3b testnet |
| Withdrawing credit needs 1 yoctoNEAR attached | An agent's function call key draining the credit | `withdraw_credit` | S7: refused for the agent key |
| OutLayer's answer is accepted only as the callback of the contract's own request, and only if every echoed value matches | A forged OutLayer answer | `request_outlayer_check`, `on_outlayer_result` | 9 unit tests; S5 on chain ("Method on_outlayer_result is private") |
| A bounty opens only after two different verifiers attest its Proof 0 (added in S13) | Attempts on a bounty that may be unfixable | `attest_proof0`, `commit` | unit tests `s13_commit_before_proof0_rejected` and others; S13 attacks 1, 6 and 7 on testnet |
| A reveal window; anyone can free the slot of a commit never revealed (added in S13) | Junk commits holding all K slots forever | `reveal`, `release_unrevealed` | unit test `s13_unrevealed_junk_commits_can_be_released`; S13 attack 2 on testnet |
| The winner's own attempt fee is refunded with the payout (added in S13) | Penalizing the honest winner | `record_attestation`, `claim_timeout` | unit test `s13_winner_fee_refunded_on_pass`; S13 attack 11 on testnet (+0.51 NEAR = bounty + own fee) |
| Level 2 bounties: the contract checks a Groth16 proof itself (`groth16::verify`, NEAR's alt_bn128 host functions); no verifier signatures; every Level 0 call refuses a Level 2 bounty and the Level 2 calls refuse a Level 0 bounty; `get_bounty` shows the level (added in S6c) | Trusting verifiers for the verdict | `open_with_groth16`, `submit_groth16`, `contract/src/groth16.rs` | unit tests `tests_level2.rs`; S6c on testnet (EVIDENCE, S6c) |
| A Level 2 proof's journal must belong to this bounty and this attempt: submission id (contract, bounty, index, patch hash), the seed recorded at reveal, the revealed patch hash, the bounty's original, exploit commitment, tests and check size; the verdict is read from the journal, never given by the caller (added in S6c) | Replaying a proof from another bounty or attempt; calling a FAIL a PASS | `submit_groth16`, `check_bounty_fields` | S6c attacks (EVIDENCE, S6c) |
| Every new bounty records `fuzz_count` and `variant_count`; a proof must match them (Level 2: on chain; Level 0: `scripts/verifier_check.sh`) (added in S6c) | A vendor proving a weaker check than the bounty promises | `create_bounty`, `check_bounty_fields`, `verifier_check.sh` | unit test `level2_proof0_refused_with_other_counts`; S6c Level 0 check 12 of 12 |
| The vendor tools use a private random salt per bounty for the secret's commitment unless `--demo-salt` is given; they refuse a salt file other users can read and never print the salt (added 2026-10-25) | Guessing the secret from its commitment | `host/src/main.rs` (`salt_for`) | `docs/evidence/salt/salt_selftest.txt` |
| Fees of commits never revealed go to the protocol fee pool by one rule (`release_to_pool`), at `release_unrevealed` or, if still unreleased, at `expire` before any fee is paid out; no code path pays such a fee to the vendor, a researcher or a verifier (added in S6c) | A vendor blocking its own bounty with junk commits for free (it would otherwise get the fees back) | `release_to_pool`, `release_unrevealed`, `expire` | unit tests `release_unrevealed_moves_the_fee_to_the_pool_and_pays_nobody`, `level2_unrevealed_fee_goes_to_the_pool_not_the_vendor`; S6c self-block test |
| Every commit must leave time for the reveal window and the verdict window before expiry, and every reveal a full verdict window; a Level 2 proof is no longer refused after expiry (the window alone bounds it) (audit round 1, fix 1) | A junk reveal just before expiry paid by timeout because the vendor's proof was refused after expiry (audit finding F1, critical) | `commit`, `reveal`, `submit_groth16` | unit tests `audit_f1_*` |
| Windows are capped: reveal, verdict and attestation windows at most 30 days, expiry at most 366 days and at least the sum of the gap and the three windows (audit round 1, fix 1) | A vendor choosing a window so long that a deadline never comes, freezing a researcher's timeout and the refund forever (audit finding, high) | `create_bounty`, `MAX_WINDOW_NS`, `MAX_EXPIRY_NS` | unit tests `audit_f3_*` |
| The payout account cannot be a registered verifier, the vendor or the contract; a registered verifier cannot commit (audit round 1, fix 2) | Blocking a verifier by naming it as payout (the "cannot attest its own submission" rule turned into a weapon), so no verdict could become final and the timeout paid the researcher | `commit` | unit tests `audit_h2_*` |
| The earliest reveal has priority: a PASS (posted verdict or Groth16 proof) or a timeout for an attempt is refused while an attempt revealed earlier is still undecided (audit round 1, fix 3) | The vendor, or anyone, copying a revealed passing patch into a second account and getting paid for it first; a copier timing out first against a slow researcher | `earlier_reveal_undecided`, `post_verdict`, `submit_groth16`, `claim_timeout` | unit tests `audit_c2_*` |
| Level 2 fees of decided attempts go to the protocol fee pool at expiry, never to the vendor; when a bounty closes, the fees of other revealed attempts still undecided are refunded as credit (audit round 1, fix 4) | A vendor earning the fees of attempts it failed (fee farming with an unfixable or fake bounty); honest losers' fees swept to the vendor or the verifiers although they were never judged | `expire`, `refund_undecided_revealed` | unit tests `audit_f4_*`; S6c rerun on testnet |
| The owner keeps an allowlist of checker image ids; once it holds an id, `create_bounty` refuses every other id, and `get_bounty` shows `image_id_allowed` (audit round 1, fix 5) | A vendor naming its own program as the checker: a Level 2 verdict was only as good as the vendor's program, and a fake checker could farm attempt fees | `allow_image_id`, `get_allowed_image_ids`, `create_bounty` | unit tests `audit_f5_*`; set on `kintsugi-l2-cihdp.testnet` to the reproducible id |
| Reveals in the same block tie on time and the lower index counts as earlier; a reveal gap of zero is refused, so a commit never shares a block with its reveal; a stored allowlist that does not decode fails closed (audit round 2, fix 6) | A copy of a revealed patch landing in the same block as the original and jumping the queue (the round 1 critical through a tie) | `earlier_reveal_undecided`, `create_bounty`, `allowed_image_ids` | unit tests `audit_r2_*` |
| A silent vendor's timeout (a liveness rule, not a verdict) is split equally among every revealed attempt still undecided, each paid its share and its own attempt fee; the remainder of the division goes to the attempt that was claimed (audit hardening S7) | A vendor's own junk revealed first taking the whole bounty back by timeout while an honest fix waits (audit finding 3, residual) | `claim_timeout` | unit tests `audit_s7_*`; testnet `scripts/hardening_testnet.sh split` |
| Each account may set limits on its own commits with `set_agent_limits` (needs exactly 1 yoctoNEAR): a largest attempt fee per commit and a fixed payout account; `commit` refuses a fee above the limit or another payout (audit hardening S6) | An agent's commit-only key (or whoever steals it) spending the credit on one attacker-set fee, or sending winnings elsewhere (audit finding 9) | `set_agent_limits`, `get_agent_limits`, `commit` | unit tests `audit_s6_*`; testnet `scripts/hardening_testnet.sh limits` |
| A Level 2 proof's cheap binding checks (submission id, seed, candidate, bounty fields; for Proof 0 the journal hash, reference fix and verdict) run before the pairing check (audit hardening S3) | An honest mistake or a replayed proof burning the whole proof check; unclear errors | `submit_groth16`, `open_with_groth16` | unit tests `s1_*`, `s2_*`, `level2_changed_journal_refused`; testnet `s3_proof_of_another_bounty` |
| The journal parser refuses every malformed journal (wrong length, a byte word above 255, a verdict other than 0 or 1) and a seal that is not 256 bytes; a Proof 0 journal is refused as an attempt and an attempt journal as Proof 0; one changed byte of the control root fails the check (audit hardening S2) | Malformed or mixed-up proofs | `groth16::parse_journal`, `groth16::verify` | unit tests `s2_*` in `contract/src/tests_level2_attempts.rs` |

### The site (web/)

| Guard | What it stops | Shown by |
| --- | --- | --- |
| Wallets through NEAR Connect (on testnet: Meteor, Intear, Ledger, MyNearWallet until 31 October 2026, Nightly, Ethereum Wallets and NEAR CLI), each wallet's script loaded from its official address, refused unless its sha256 matches the pin in the wallet list, and run in a sandboxed frame; sign in asks for no contract key; every transaction is approved in the wallet | The page signing for the visitor; wallet code changing under the site | `web/vendor/wallets/manifest.json` (pins), `web/js/wallet.js` (`pinScripts`); `docs/evidence/web/pinned_wallets.txt` (a changed byte is refused); `docs/evidence/web/` (NEAR CLI run through the page) |
| A confirm step before every payment (deposit, withdraw, commit), showing the amount with its unit; a commit's confirm shows the fee, slots left of the cap and "Each attempt returns one yes or no." | Paying by accident | `web/js/account-ui.js` |
| Before a commit the page reads the chain again and stops, without sending, what the contract would refuse: bounty closed, cap full, not enough credit, a fee above the account's own limit, a payout the limits do not allow, a payout that is the vendor, a verifier or the contract, or one that does not exist | Lost fees and lost payouts (review finding 8) | `web/js/account-ui.js` (`review`) |
| Operator panel stop button, shown only to the connected owner of the account: one wallet approved call, `set_agent_limits` with a max fee of 0 (1 yoctoNEAR attached, so a limited agent key cannot undo it); every later commit by that account is refused, since every attempt fee is above 0 (`create_bounty` requires it) | A runaway or stolen agent key spending the account's credit | `docs/evidence/web/steps/operator_stop_set_limits.txt` (tx `7xhHyQEn76dztS4MHLQRPW3zod6wfMxLmFAGt6bop1NG`), `operator_stop_commit_refused.txt` (tx `CKSC5CiimdJqdLHTvzxYfYhFbhdmq7WY5B8YiaSxrVrm`, refused: "the attempt fee is above this account's max_fee_per_commit") |
| The page shows a result only from the chain: after a reveal it says "Waiting for the vendor's proof"; the PASS stamp only for an attempt whose outcome on chain is Passed | A faked result | `web/js/account-ui.js` (`attemptPanel`) |

### The model-driven agent (agent/)

| Guard | What it stops | Shown by |
| --- | --- | --- |
| The agent refuses to send unless its key is a function call key for this contract limited to `commit` and `reveal` (read with `view_access_key`) | Running the agent with a full access key | `./scripts/agent_dry_run_test.sh`, case 7 (docs/evidence/agent/dry_run_tests.txt) |
| Before a commit: `scripts/agent_preflight.sh`, the config's `max_fee_yocto`, the account's on-chain limits (a live run refuses when none are set) and its fixed payout; at most `max_attempts` commits per run | Overspending, or paying another account | same script, case 6; the contract also enforces the on-chain limits |
| The public code is used only if the module's sha256 equals the bounty's `original_hash` and the public tests give its `corpus_hash` | A feed or site that serves other code than the bounty's | `dry_run_reference_fix.log` ("public code: ... = original_hash ... = corpus_hash") |
| The model's answer is refused if it uses `include!`, `include_str!`, `include_bytes!`, `env!`, `option_env!`, `extern crate`, `mod x;` or `#[path]`, and it is built with an environment holding no API key | An answer (for example after a prompt injection in the public code) that pulls a local file or the key into the patch, which is published on chain at reveal | case 5 |
| The API key comes only from an environment variable or a file outside the repository, and is never printed or logged | Leaking the key into logs, evidence files or git | case 2: the key is in no log or file of the run |

### Keys

| Guard | What it stops | Shown by |
| --- | --- | --- |
| An AI agent works through a function call key limited to `commit` and `reveal` on the bounty contract | The agent (or whoever steals its key) reaching its owner's wallet | S7: transfer refused (`RequiresFullAccess`), other method refused (`MethodNameMismatch`), deposits refused |
| The owner sets `set_agent_limits` with the account's full access key (1 yoctoNEAR, which a function call key cannot attach) | The agent key spending more than the chosen fee per attempt, or naming another payout account | unit tests `audit_s6_*`; testnet `scripts/hardening_testnet.sh limits` (a call with no deposit refused: "Requires attached deposit of exactly 1 yoctoNEAR") |
| The agent checks a bounty before committing (`scripts/agent_preflight.sh`, wired into `scripts/s7_agent.sh`): payout account exists, image id on a non-empty allowlist, windows, fees and K within its limits (audit hardening S16) | Committing to a bounty with a fake checker, a missing payout account, too short windows or a large fee | `docs/evidence/hardening/preflight.txt` |

## 2. Attacks we tried

| Date | Commit | Attack | Command | Result |
| --- | --- | --- | --- | --- |
| 2026-10-23 | `d150da2` | 18 cheating patches (reject all, constant, special-case the secret, loop forever, memory tricks, early return, disable a feature, memorize tests, wrong fix, subtle change, overbroad fix, wrong export, imports, too large, truncated) | `target/debug/skarbnik-check table --manifest data/attacks/manifest.txt --seed <hex>` | **blocked**: all FAIL except `memory_grow`, **accepted risk**: its oversized memory request is refused by its own limit, it gets no memory and behaves exactly like the honest fix |
| 2026-10-23 | `d150da2` | Same cheats over 200 seeds, 128 fairness inputs | seed sweep (`docs/evidence/S1/seed_sweep.txt`) | **blocked** on every seed; the honest fix passed on every seed |
| 2026-10-24 | `2b41cad` | Change the verdict in a receipt's journal; flip one bit of the proof | `skarbnik-host tamper <in> <out> journal`, `... seal`, then `skarbnik-host verify <out>` | **blocked**: INVALID, exit 1 |
| 2026-10-23 | `f24e01d` | Claim the timeout early; post a verdict after its window; expire early | `scripts/s3_testnet.sh` | **blocked** on chain ("deadline has not passed", "verdict window has closed", "bounty has not expired") |
| 2026-10-24 | `2b4c761` | Commit without credit; expire twice | `scripts/s3b_testnet.sh` | **blocked** on chain ("not enough credit", "nothing to do") |
| 2026-10-24 | `f169bbb` | A stranger calls the private OutLayer callback; the owner registers the vendor as a verifier | `call_expect_fail` in `scripts/s3_lib.sh` | **blocked** on chain ("Method on_outlayer_result is private", "a vendor account cannot be a verifier") |
| 2026-10-24 | `dbe874c` | An agent's function call key sends NEAR, attaches a deposit, calls another method | `scripts/s7_agent.sh limits` | **blocked** (CLI before sending; chain: `RequiresFullAccess`, `MethodNameMismatch`) |
| 2026-10-24 | `1e7976f` | A probe agent tries to learn the secret; a fourth probe beyond K | `scripts/s8_arena.sh`, `scripts/s8_chain.sh` | **accepted risk**: one bit per attempt, 3 bits with K = 3 (the vendor chooses K); with the variant check on, 0 bits; the fourth commit **blocked** (ignored) |
| 2026-10-24 | `500469c` | (3) Sub-accounts of one researcher fill the K = 3 slots of a bounty | `scripts/s13_attacks.sh misc` | **accepted risk**: allowed, each paying the rising fee (0.01, 0.015, 0.02 NEAR); a fourth commit was ignored and not charged; K is per bounty, so the leak stays at most K bits; blocking one reveal window costs 0.045 NEAR, the next 0.09 NEAR, and so on (section 3) |
| 2026-10-24 | `500469c` | (1) An unfixable bounty: a 300 byte secret (over the 256 byte limit) | `scripts/s13_attacks.sh open` | **not blocked before S13 (guard added)**, now **blocked**: Proof 0 refuses it; a commit before two Proof 0 attestations is refused on chain (EVIDENCE, S13) |
| 2026-10-24 | `500469c` | (2) Junk commits that are never revealed hold all K slots | `scripts/s13_attacks.sh misc` | **not blocked before S13 (guard added)**, now **blocked**: early release refused; after the reveal window the slot was freed and a new commit fitted (EVIDENCE, S13) |
| 2026-10-24 | `500469c` | (4) The vendor replays another submission's PASS receipt | `scripts/s13_attacks.sh bounty_b` | **blocked**: the verifier check fails on submission id and seed; no attestation; the researcher was paid by timeout (EVIDENCE, S13) |
| 2026-10-24 | `500469c` | (5) A verifier attests PASS while the vendor posted FAIL | `scripts/s13_attacks.sh attack_a` | **blocked** on chain ("attestation does not match the posted verdict") (EVIDENCE, S13) |
| 2026-10-24 | `500469c` | (6) An unregistered account attests Proof 0 | `scripts/s13_attacks.sh misc` | **blocked** on chain ("caller is not a registered verifier") (EVIDENCE, S13) |
| 2026-10-24 | `500469c` | (7) The same verifier attests Proof 0 twice | `scripts/s13_attacks.sh misc` | **blocked**: the bounty stays closed with one attestation (EVIDENCE, S13) |
| 2026-10-24 | `500469c` | (8) Timeout or expire too early, or again after payout | `scripts/s13_attacks.sh bounty_b, attack_a` | **blocked** on chain ("bounty has not expired", "deadline has not passed", "bounty is closed", "nothing to do") (EVIDENCE, S13) |
| 2026-10-24 | `500469c` | (9) A receipt made by another checker program | `scripts/s13_attacks.sh bounty_b` | **blocked**: does not verify with the bounty's image id (EVIDENCE, S13) |
| 2026-10-24 | `500469c` | (10) A reveal that does not match its commit | `scripts/s13_attacks.sh misc` | **blocked** on chain ("fingerprint does not match") (EVIDENCE, S13) |
| 2026-10-24 | `500469c` | (11) The vendor posts FAIL for a fix whose real receipt says PASS | `scripts/s13_attacks.sh attack_a` | **blocked**: both verifiers refuse (journal verdict differs); after the window the researcher was paid by timeout, +0.51 NEAR (bounty and own fee) (EVIDENCE, S13) |

| 2026-10-25 | `95915f2` | (S6c) A valid PASS proof submitted for another attempt of the same bounty | `scripts/s6c_testnet.sh attacks` | **blocked** on chain: "the journal belongs to another bounty or attempt (submission id)" (EVIDENCE, S6c) |
| 2026-10-25 | `95915f2` | (S6c) A valid PASS proof submitted for an attempt on another bounty (same patch) | `scripts/s6c_testnet.sh attacks` | **blocked** on chain: "the journal belongs to another bounty or attempt (submission id)" |
| 2026-10-25 | `95915f2` | (S6c) A FAIL proof's journal edited to say PASS | `scripts/s6c_testnet.sh attacks` | **blocked** on chain: "the Groth16 proof does not verify ..." |
| 2026-10-25 | `95915f2` | (S6c) One flipped bit in the seal | `scripts/s6c_testnet.sh attacks` | **blocked** on chain: "AltBn128 invalid input: invalid g1" |
| 2026-10-25 | `95915f2` | (S6c) A changed journal (fuzz_count) | `scripts/s6c_testnet.sh attacks` | **blocked** on chain: the proof does not verify |
| 2026-10-25 | `95915f2` | (S6c) A bounty naming another image id, opened with the real Proof 0 | `scripts/s6c_testnet.sh attacks` | **blocked** on chain: the proof does not verify |
| 2026-10-25 | `95915f2` | (S6c) The same proof submitted twice (FAIL, then PASS after payout) | `scripts/s6c_testnet.sh attacks` | **blocked** on chain: "verdict already final", "bounty is closed" |
| 2026-10-25 | `95915f2` | (S6c) A proof submitted after the bounty expired | `scripts/s6c_testnet.sh attacks` | **blocked** on chain: "bounty has expired" |
| 2026-10-25 | `95915f2` | (S6c) The vendor blocks its own Level 2 bounty through a second account that takes all K slots and never reveals | `scripts/s6c_testnet.sh selfblock2` | **not blocked before S6c (guard added)**: the honest commit is still ignored for the reveal window, but the vendor side lost 0.045 NEAR in fees plus 0.000830 NEAR in gas and the pool gained exactly 0.045 NEAR; before, a Level 2 vendor would have got those fees back at expiry |

## 3. Known limits

- A machine without Docker can embed guest files built elsewhere (`KINTSUGI_PREBUILT_GUESTS`, for the GPU test). It
  trusts those files: their image id is computed from their bytes and must equal the reproducible build's id before
  any proof made with them is compared or used (`idcheck` step in the private GPU guide). Not used for any bounty.
- All bounties created so far (S4, S7 and S13, ids `3edbc2e6...` and `043ec633...`) use image ids from
  plain builds, which embed the build folder and the user's home folder. Nobody can rebuild those ids from the source;
  their receipts still verify against those ids. Only bounties created with the reproducible id (`dd6c5f42...` for the
  current checker) can be checked with `./scripts/check_image_id.sh`: the first is the demo bounty 4 on
  `kintsugi-s13-tlryo.testnet` (created 2026-10-24 19:53 UTC, tx `EozokvC2Y6UZHMXpkHzajUdJwwdop86GhzZp2wGHitf5`, Proof 0
  attested by two verifiers, expires 2026-11-23 19:53 UTC, after 30 days). Its MATCH was shown on one laptop only.
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
  - Level 2 (works on testnet, spike S6c): a bounty created with level 2 is opened and decided only by Groth16 proofs
    that the bounty contract checks itself (`kintsugi-l2-cihdp.testnet`, 35 to 36 Tgas per proof, EVIDENCE S6c). No
    verifier is trusted for those verdicts. The S13 contract and the demo bounty are Level 0.
- At Level 0 the contract does not check a receipt; a dishonest majority of verifiers could attest a false verdict.
- One verdict leaks at most one bit about the secret; K is the leak budget, chosen by the vendor. K is per bounty and
  counts every committer together, so sub-accounts cannot raise the total leak above K bits: a slot is freed only by
  `release_unrevealed`, and only for a commit that was never revealed, so at most K submissions per bounty are ever
  revealed and get a verdict. A vendor who reuses the same secret in several bounties gives a separate budget of K per
  bounty.
- Anyone, with as many accounts as they like, can hold all K slots with junk commits for one reveal window. With the
  test settings (K = 3, `attempt_fee` 0.01 NEAR, `fee_step` 0.005 NEAR) the first window costs 0.01 + 0.015 + 0.02 =
  0.045 NEAR; the fees are kept (since S6c in the protocol fee pool), and because `commits` never goes down, window w (from 0) costs
  0.045 + 0.045 w NEAR, so W windows in a row cost 0.0225 W (W + 1) NEAR (10 windows: 2.475 NEAR). After each window
  anyone can free the slots and commit. **Accepted risk**: the cost of blocking grows with every window, the leak stays
  at most K bits, and the vendor sets K, both fees and the reveal window.
- RISC Zero states its zero knowledge property is not formally proven.
- What Level 2 still trusts:
  - the BN254 curve: NEAR's own NEP-488 says recent research puts BN254 below 100-bit security, and RISC Zero's
    security model rates its Groth16 step 99+ bits and not quantum safe (dev.risczero.com, security model);
  - RISC Zero's Groth16 trusted setup and the verifying key made from it. Confirmed from primary sources: RISC Zero ran
    the ceremony with the open-source tools p0tion and DefinitelySetup, coordinated with the PSE team, on top of the
    Hermez Powers of Tau with 2^23 powers (dev.risczero.com, trusted setup ceremony); that Powers of Tau file was
    prepared with 54 contributions and a random beacon (snarkjs README); RISC Zero lists the "Integrity of Groth16
    Trusted Setup Ceremony" as an assumption of this step (security model); the transcript can be checked with
    `snarkjs zkey verify` (trusted setup page); the STARK-to-SNARK circuit was audited by Hexens (rz-security audits
    list). Not confirmed from a primary source: the number of phase 2 participants (238 according to L2BEAT), the exact
    condition under which the setup stays safe, and any audit of the ceremony itself. If the setup's secret were known
    to someone, they could make Groth16 proofs of false claims; against this contract that means a fake PASS for any
    revealed attempt (all journal fields are public), a fake FAIL that spends an honest attempt, and a fake Proof 0
    that opens a bounty. It would not reveal the secret crash input, move money outside the contract's rules, or
    affect Level 0 bounties;
  - two fixed constants written into the contract: RISC Zero's control root (`a54dc85a...`), which says which
    recursion programs are allowed, and its BN254 control id (`c07a6514...`). They come from risc0-zkvm 3.0.6's
    defaults (`contract/src/groth16_vk.rs`, also in `verifier/groth16-near/src/vk.rs`); a different RISC Zero version
    may need new values;
  - the vendor, for keeping the secret, choosing the reference fix and making each proof: a vendor who never submits a
    proof cannot stop the timeout from paying the researcher.
- What Level 2 does not trust: any verifier account, OutLayer, or the vendor's word on a verdict; the verdict is the
  journal's, and the journal must match this bounty and this attempt.
- Protocol fee pool: since S6c, the attempt fees of commits that are never revealed (released, or still unrevealed at
  expiry) are kept in the contract as a pool, shown by `get_protocol_pool`. There is no function to take NEAR out of
  it: its destination is deliberately left open, to be decided after the audit. If the pool ever pays Skarbnik (the
  project), the project would gain from junk commits that block bounties, a conflict of interest that the decision
  must address. Fees of decided attempts go to the verifiers (Level 0) or the pool (Level 2) at expiry; fees of attempts
  still undecided when a bounty closes are refunded as credit (audit round 1).
- Found during S6c: the Level 0 verifier check did not compare the journal's `fuzz_count` and `variant_count` with
  anything, so a vendor could prove a smaller check than the bounty implies and still be attested. Bounties created by
  the S6c contract record both, and `scripts/verifier_check.sh` checks them; bounties on older contracts (S4, S7, S13,
  the demo bounty) do not record them, so for those the gap remains.
- A Proof 0 journal does not depend on the bounty (its id is sha256 of "kintsugi-proof0-v1" and the reference fix
  hash), so one Proof 0 opens every bounty with the same original, secret commitment, tests, check size and reference
  fix. S6c relied on this to reuse the demo's Groth16 Proof 0.
- The demo bounties use a public fixed salt (`--demo-salt`; `DEMO_SALT` in `host/src/main.rs`) for the secret's
  commitment, sha256(salt || secret). With a public salt the commitment is a plain fingerprint of the secret, which
  anyone can match by guessing when the secret is short or predictable. The vendor tools' default is a private random
  salt per bounty (`skarbnik-host ... --bounty <name>`: 32 bytes from /dev/urandom in
  a private folder outside the repo, file mode 600, reused for every proof of that bounty, never printed or committed);
  a real vendor must use it.
- Proof 0 needs a reference fix: the vendor must already hold a fix that passes every check of the bounty, and it
  proves that fix in Proof 0. A vendor who has found a crash but has no fix at all is not supported yet. The reference
  fix stays private (only its sha256 is public) and may be crude; it cannot simply recognise the exact secret bytes,
  because the variants step (copies of the secret with one or two bytes changed) would then fail.
- The vendor sees each patch before paying. If the vendor stays silent, the timeout is split equally among every revealed
  attempt still undecided (audit hardening S7). The timeout is a liveness rule, not a verdict: it stops a vendor holding
  payment hostage by going silent, it does not show that a fix is correct, and timeout payouts are labelled "paid by
  timeout", apart from proof-checked payouts. This has two costs, both stated plainly: a vendor that reveals m junk
  attempts from its own accounts before or after an honest fix keeps m/(m+1) of the bounty (m is at most K - 1, and K
  is at most 16), and someone who copies a revealed fix into a second account now gets an equal share when the vendor
  is silent (before S7 the copy got nothing, audit fix 3). The split also pays an attempt whose own verdict window is
  still open, or for which a FAIL is posted but not yet confirmed: once the earliest reveal times out, the vendor has lost
  the chance to decide the others (unit tests `review_s7_*`). A vendor that answers is not affected: a PASS pays only the
  earliest passing reveal.
- Worst case of the timeout split, kept by the owner's decision (2026-10-25): under a silent vendor an honest fix may get
  as little as 1/K of the bounty (the vendor's own accounts reveal junk in the other K - 1 slots and take the rest, their
  fees refunded), and anyone who copies a revealed fix shares equally. This is still better than the old rule, under which
  a vendor's junk revealed first took the whole bounty and the honest researcher got nothing (unit test
  `review_s7_puppets_revealed_after_the_honest_fix_share_a_silent_vendors_timeout`: K = 3, the honest payout gets a third).
- Live bounty 12 (S18) shows the secrecy rule: the secret input never goes to agents or the public (it is not in the
  repository and its commitment uses a private salt), and the vendor chose where proving ran (its own laptop). It does not prove that the bug is unknown: it uses the public demo bug (the original
  module and its fix are `data/demo/original.wasm` and `data/demo/fixed.wasm`), so anyone can submit the public
  `fixed.wasm`. If the vendor stays silent, the timeout rule can pay out without any proof at all. A new original module
  with its own bug is a possible later improvement.
- Payouts are detached transfers. A payout account that does not exist makes the transfer fail after the state says
  Paid; the NEAR stays in the contract with no record and no way out (audit finding 8, shown on testnet). Pull payments
  (S4) are the fix and are deliberately not built in this round (owner's decision, 2026-10-25). The mitigation is
  `scripts/agent_preflight.sh`, which refuses a payout account that does not exist; a researcher who does not run it
  can still lose a payout this way.
- An agent's commit-only key cannot reach the wallet. With `set_agent_limits` set, it cannot spend more than
  `max_fee_per_commit` on one attempt and its winnings go only to the fixed payout account (audit hardening S6). It can
  still spend the whole credit over many attempts, one limited fee at a time, and without limits set the old finding 9
  applies unchanged. Keep agent credit small.
- Storage is not charged to anyone: the contract's own balance covers the storage stake, and it can be ground down by
  tiny deposits or short-lived bounties (audit finding 12). On testnet the faucet balance covers it.
- Verifiers cannot be removed and are paid the fee sweep for no work; the contract account's full access key is the
  real owner of all funds; slot griefing is cheaper than the arithmetic above when `fee_step` is 0 (audit finding 14).
- Owner powers, stated in full: the owner (`get_owner`) registers verifiers, sets the Level 1 OutLayer settings, and adds
  checker image ids to the allowlist (`allow_image_id`). Once the list holds an id, `create_bounty` refuses every other
  id, so the owner decides which checker programs bounties may use; there is no call to remove an id. Bounties created
  before an id was listed keep their id and show `image_id_allowed: false`. The contract account's full access key can
  also replace the code; removing or escrowing that key is planned as the last step before submission (S14), not done.
- The protocol fee pool (fees of commits never revealed, and Level 2 fees of decided attempts) stays locked in the
  contract as a reserve for storage. No method withdraws it, by design (owner's decision, 2026-10-25): it pays no one,
  so no one profits from junk or missed reveals. `get_protocol_pool` shows its size.
- The site keeps an attempt's record (bounty, index, payout, nonce, patch) in the browser's local storage for this site and
  offers it as a file. It holds no key and cannot move money, but without it the attempt cannot be revealed, and an
  attempt not revealed in time loses its fee. Clearing the browser's site data before revealing loses it.
- The site's wallet code is third party: NEAR Connect and the wallets' own scripts (exact versions and sha256 in
  docs/VERSIONS.md). The page's own code holds no key, but Intear Wallet's script keeps a wallet session key in the
  browser's storage for this site (it cannot spend on chain; owner's decision, 2026-10-25). Intear's script has no
  versioned address, so the copy is pinned by sha256 and must be refreshed by hand if Intear changes it; the same holds
  for NEAR Mobile, Trezu and Ethereum Wallets. MyNearWallet is listed until 31 October 2026 23:59:59 UTC (the day it
  closes) and drops out by itself after that. Only NEAR CLI was clicked through to a transaction; the other wallets were
  only loaded (docs/EVIDENCE.md, "Site: more wallets"). Meteor's and Nightly's scripts can talk to their browser
  extensions, Meteor's and MyNearWallet's can open their wallet sites. Licences of the vendored files: THIRD_PARTY_NOTICES.
- Agent limits are stored per account under a raw storage key with no storage deposit, like the rest of the contract
  (audit finding 12).
- The AI review passes (docs/AUDIT.md) list every finding, its status and the suggested hardening.
- Arena verdicts (S8) come from the native checker, not proofs. Timing and other side channels are not measured.
- Proving is slow on a laptop CPU (16 fairness inputs: 47 to 48 minutes, plus 15 to 16 minutes to compress).
- Narrow scope: crash bugs in a small module that compiles to WebAssembly; the fairness generator knows only the demo format.
- Testnet only. No external security audit.

## 4. Changelog (newest first)

- 2026-10-26: more wallets: all of NEAR Connect's list, pinned (GitHub scripts to a commit, every script by sha256);
  on testnet Meteor, Intear, Ledger, MyNearWallet (until 31 October), Nightly, Ethereum Wallets and NEAR CLI are shown.
  A changed byte is still refused (`docs/evidence/web/wallets_2026-10-26.txt`, pin check run 2).

- 2026-10-26: site restyle; the operator panel gains a stop button (max fee 0 through the wallet), tested on testnet with
  the NEAR CLI wallet: stop `7xhHyQEn76dztS4MHLQRPW3zod6wfMxLmFAGt6bop1NG`, then a commit by the account's limited key refused
  `CKSC5CiimdJqdLHTvzxYfYhFbhdmq7WY5B8YiaSxrVrm`, limits restored `B5E9qKGaFdK8HLmFcUkELkz4Wr4ojeJvpQPe2m3k6UZR`.

- 2026-10-25: the model-driven agent (agent/) with its guards: limited key check, fee and attempt limits, public code
  checked against the bounty's hashes, no file or environment reading in a model's answer, the API key kept out of logs.
  Tested in dry run (`./scripts/agent_dry_run_test.sh`, 9 of 9).

- 2026-10-25: the wallet scripts of Intear and NEAR CLI are no longer stored in the repository. The site loads each from
  its official address and refuses it unless its sha256 matches the pin in `web/vendor/wallets/manifest.json`; a test
  that changes one byte in transit is refused (`docs/evidence/web/pinned_wallets.txt`).

- 2026-10-25: MyNearWallet removed from the site's wallets (retired on 31 October 2026); THIRD_PARTY_NOTICES added.

- 2026-10-25 (site, branch ui-preview): wallet connection, credit panel and sending attempts; guards for the site.

- 2026-10-25 (owner's decisions on the hardening round): the S7 split kept, its worst case stated; bounty 12's limits
  stated; Groth16 memory guard 500 MiB with a reminder to close editor windows (`scripts/watch_mem.sh`).

- 2026-10-25 (audit hardening): S7 timeout split among revealed undecided attempts; S6 agent limits
  (`set_agent_limits`); S3 cheap binding checks before the pairing check; S2 parser and mode-confusion tests; S1 real
  attempt proofs as unit test vectors; S16 `scripts/agent_preflight.sh`; owner powers, the locked pool and S4 stated as
  known limits; S18 live bounty 12 with a secret outside the repository; `refund_undecided_revealed` no longer counts
  refunded attempts as pending (final review).

- 2026-10-25 (audit fix 6, from the second review): tie-break by index for reveals in one block; reveal gap above zero;
  allowlist fails closed; stale doc comments corrected.
- 2026-10-25 (audit fix 5): owner allowlist of checker image ids; `image_id_allowed` in the bounty view.
- 2026-10-25 (audit fix 4): Level 2 decided fees to the pool, never the vendor; undecided revealed attempts refunded at closure.
- 2026-10-25 (audit fix 3): the earliest reveal has priority for a PASS and for a timeout.
- 2026-10-25 (audit fix 2): payout cannot be a verifier, the vendor or the contract; verifiers cannot commit.
- 2026-10-25 (audit fix 1): commit and reveal must leave time for a decision before expiry; a Level 2 proof is no longer
  refused after expiry; windows capped at 30 days and expiry at 366 days (docs/AUDIT.md once written).
- 2026-10-25 `3043452`: private random salt per bounty by default (`--bounty`), the public demo salt only with
  `--demo-salt`; known limits for the demo salt and for the reference fix requirement.
- 2026-10-25 `95915f2`: S6c Level 2 path in the bounty contract (Groth16 proofs, journal binding, level marking,
  check size), protocol fee pool for never-revealed fees, nine Level 2 attacks and the self-block test; trusted setup
  line corrected to confirmed facts; Level 0 check size gap found and closed for new bounties.
- 2026-10-24 `bb4defb`: S6b Groth16 check on a spike contract (not the bounty contract); known limits for
  BN254, the trusted setup and the two fixed constants.
- 2026-10-24 `582b2d8`: demo bounty 4 with the reproducible image id; `check_image_id.sh` prints MATCH.
- 2026-10-24 `582b2d8`: prebuilt guest mode and `cuda-prove-only` build option; known limit for the prebuilt mode.
- 2026-10-24 `0409a3c`: reproducible checker build made official; new guard row; known limit for older bounties'
  image ids.
- 2026-10-24 `500469c`: OutLayer second try: verifier published on FastFS as project
  `kintsugi-ol-hfoez.testnet/farbox-verifier` with OutLayer's tool; still no answer (requests 5618 to 5620). No guard changed.
- 2026-10-24 `500469c`: OutLayer Level 1 diagnosis: no guard changed; the known limit now says what was found
  (testnet answers cached programs only; ours never answered). Measured verifier needs: 878,730,118 instructions, 3.4 MB.
- 2026-10-24 `500469c`: S13 attack pass on testnet: attacks 1, 2, 4 to 11 blocked; attack 3 accepted risk.
- 2026-10-24 `500469c`: S13 guards in code: Proof 0 refuses an over-long secret and needs a reference fix; bounties
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
