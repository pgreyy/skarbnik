# Stored receipts

Two real Level 2 submissions to `kintsugi-l2-cihdp.testnet`, saved exactly as they were sent: each file is the
`submit_groth16` argument object (bounty id, attempt index, Groth16 seal and journal, base64), read back from the chain
with the FastNEAR transaction index. Both carry the same proof: the PASS proof of bounty 1, attempt 0 (the honest fix
`data/demo/fixed.wasm`), made on the laptop in spike S6c. Its hex form is `docs/evidence/S6c/a0_args.json`, and the
unit tests use the same bytes (`contract/src/groth16_attempt_vectors.rs`, `SEAL_A0`, `JOURNAL_A0`).

## 1. A valid receipt: `valid_pass_bounty1_attempt0.json`

What it is: the proof that bounty 1's attempt 0 passed, bound to that bounty, that attempt, its revealed patch and the
seed recorded at reveal, under the checker image id `dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc`.

Real run: transaction `CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY` (accepted, bounty 1 paid, 36.392 Tgas;
`docs/evidence/S6c/gas_level2.txt`).

Check it today, offline, on a copy of bounty 1 rebuilt in the contract's unit test (same account, ids and seeds):

    cargo test -p kintsugi-contract --offline s1_real_attempt_proofs_fail_then_pass

Expected: `test tests_level2_attempts::s1_real_attempt_proofs_fail_then_pass ... ok` (the contract accepts the proof and
pays). Sending the file to the chain again is refused with "bounty is closed", because bounty 1 is already paid
(checked 2026-10-25: transaction `B5P2njJbm56sYPzHRJgACQWdUKWd7dPLGgMsgfdbCkDo`, `steps/resubmit_valid_pass_bounty1_attempt0.txt`):

    near contract call-function as-transaction kintsugi-l2-cihdp.testnet submit_groth16 file-args docs/evidence/receipts/valid_pass_bounty1_attempt0.json prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as <your testnet account> network-config testnet sign-with-legacy-keychain send

## 2. A wrong-bounty receipt: `wrong_bounty_11_attempt0.json`

What it is: the same valid proof, sent for bounty 11, attempt 0. The proof is real, but it belongs to another bounty, so
the contract must refuse it.

Real run: transaction `8fYiFjirrv8N2XKdxzWJA7y8d9izXUwPJ5d5r4NKMahM`, refused: "the journal belongs to another bounty
or attempt (submission id)", 2.35 Tgas, refused before the pairing check
(`docs/evidence/hardening/steps/s3_proof_of_another_bounty.txt`).

Check it today, offline:

    cargo test -p kintsugi-contract --offline s1_the_same_proof_is_refused_on_another_bounty

Expected: `test tests_level2_attempts::s1_the_same_proof_is_refused_on_another_bounty - should panic ... ok` (refused
with the submission id message). Sending the file to the chain again is refused with "bounty is closed", because
bounty 11 is closed now (checked 2026-10-25: transaction `5tQCugrfkRPHSeo3NdVY2DRYrdA7GQZpyQdF3WSCu1z9`,
`steps/resubmit_wrong_bounty_11_attempt0.txt`):

    near contract call-function as-transaction kintsugi-l2-cihdp.testnet submit_groth16 file-args docs/evidence/receipts/wrong_bounty_11_attempt0.json prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as <your testnet account> network-config testnet sign-with-legacy-keychain send
