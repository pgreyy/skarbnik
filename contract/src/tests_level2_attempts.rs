//! Unit tests for Level 2 attempts with real Groth16 proofs (audit hardening S1), plus negative tests for the journal
//! parser and for mixing up Proof 0 and attempt proofs (S2). The attempt proofs are bound to the contract account
//! kintsugi-l2-cihdp.testnet and its bounty 1, so the mocked chain is set up as that account, with a dummy bounty 0
//! first and the seeds the contract recorded at reveal on testnet.
use super::*;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::testing_env;

#[path = "groth16_test_vectors.rs"]
mod v;
#[path = "groth16_attempt_vectors.rs"]
mod va;

const SEC: u64 = 1_000_000_000;
const T0: u64 = 1_000 * SEC;
const NONCE: &str = "abababababababababababababababababababababababababababababababab";
const FIXED: &[u8] = include_bytes!("../../data/demo/fixed.wasm");
const REJECT_ALL: &[u8] = include_bytes!("../../data/attacks/reject_all.wasm");

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn hex32(h: &str) -> [u8; 32] {
    parse_hash("hex", h)
}
fn bytes(hex: &str) -> Base64VecU8 {
    Base64VecU8((0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect())
}
fn at(caller: &str, ts: u64, deposit: NearToken, seed: [u8; 32]) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc(va::CONTRACT))
        .predecessor_account_id(acc(caller))
        .signer_account_id(acc(caller))
        .block_timestamp(ts)
        .attached_deposit(deposit)
        .random_seed(seed)
        .build());
}
fn call(caller: &str, ts: u64) {
    at(caller, ts, NearToken::from_yoctonear(0), [0; 32]);
}

/// The testnet state of bounty 1 rebuilt: dummy bounty 0, bounty 1 with the demo values opened with the real Proof 0,
/// attempt 0 (fixed.wasm, paid to res1) and attempt 1 (reject_all.wasm, paid to res2) revealed with the recorded seeds.
fn testnet_bounty_1() -> Contract {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    for _ in 0..2 {
        at("vendor.testnet", T0, NearToken::from_near(1), [0; 32]);
        c.create_bounty(
            v::ORIGINAL.into(), v::CORPUS.into(), v::IMAGE_ID.into(), v::EXPLOIT.into(), "00".repeat(32), 3, 1024,
            U64(2 * SEC), U64(600 * SEC), U64(300 * SEC), U64(3600 * SEC), U128(10_000_000_000_000_000_000_000), U128(0),
            v::REFERENCE_FIX.into(), v::JOURNAL_SHA256.into(), U64(120 * SEC), 16, 32, Some(LEVEL_2), None,
        );
    }
    call("anyone.testnet", T0 + SEC);
    assert_eq!(c.open_with_groth16(U64(va::BOUNTY), bytes(v::SEAL), bytes(v::JOURNAL)), "opened");
    for (who, patch, t, seed) in [("res1.testnet", FIXED, 2, va::SEED_A0), ("res2.testnet", REJECT_ALL, 3, va::SEED_A1)] {
        at(who, T0 + t * SEC, NearToken::from_near(1), [0; 32]);
        c.deposit_credit(None);
        call(who, T0 + t * SEC + 1);
        let fp = to_hex(&commit_fingerprint(patch, &acc(who), &hex32(NONCE)));
        c.commit(U64(va::BOUNTY), fp, acc(who)).unwrap();
        at(who, T0 + 10 * SEC + t, NearToken::from_yoctonear(0), hex32(seed));
        c.reveal(U64(va::BOUNTY), (t - 2) as u32, Base64VecU8(patch.to_vec()), NONCE.into());
    }
    c
}

fn transfers() -> Vec<(AccountId, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.clone();
            r.actions.into_iter().filter_map(move |a| match a {
                near_sdk::mock::MockAction::Transfer { deposit, .. } => Some((to.clone(), deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}

#[test]
fn s1_the_recorded_seeds_and_submission_ids_match_the_proofs() {
    let c = testnet_bounty_1();
    for (i, j) in [(0u32, va::JOURNAL_A0), (1, va::JOURNAL_A1)] {
        let s = c.get_submission(U64(va::BOUNTY), i).unwrap();
        let jr = groth16::parse_journal(&bytes(j).0);
        assert_eq!(s.seed.unwrap(), to_hex(&jr.fuzz_seed));
        assert_eq!(jr.submission_id, submission_id(&acc(va::CONTRACT), va::BOUNTY, i, &hex32(&s.patch_hash.unwrap())));
    }
}

#[test]
fn s1_real_attempt_proofs_fail_then_pass() {
    let mut c = testnet_bounty_1();
    // Attempt 1 was revealed later, so attempt 0 is the earlier undecided one; a FAIL is allowed out of order.
    call("anyone.testnet", T0 + 20 * SEC);
    assert_eq!(c.submit_groth16(U64(va::BOUNTY), 1, bytes(va::SEAL_A1), bytes(va::JOURNAL_A1)), "final_fail");
    assert!(transfers().is_empty());
    call("anyone.testnet", T0 + 21 * SEC);
    assert_eq!(c.submit_groth16(U64(va::BOUNTY), 0, bytes(va::SEAL_A0), bytes(va::JOURNAL_A0)), "final_pass");
    let fee = 10_000_000_000_000_000_000_000u128;
    assert_eq!(transfers(), vec![(acc("res1.testnet"), NearToken::from_near(1).as_yoctonear() + fee)]);
    let b = c.get_bounty(U64(va::BOUNTY)).unwrap();
    assert_eq!((b.state, b.winner, b.pending), (BountyState::Paid, Some(0), 0));
}

#[test]
#[should_panic(expected = "the journal belongs to another bounty or attempt (submission id)")]
fn s1_the_proof_of_attempt_1_is_refused_for_attempt_0() {
    let mut c = testnet_bounty_1();
    call("anyone.testnet", T0 + 20 * SEC);
    c.submit_groth16(U64(va::BOUNTY), 0, bytes(va::SEAL_A1), bytes(va::JOURNAL_A1));
}

#[test]
#[should_panic(expected = "the journal belongs to another bounty or attempt (submission id)")]
fn s1_the_same_proof_is_refused_on_another_bounty() {
    let mut c = testnet_bounty_1();
    // Rebuild the same attempt on bounty 0 (same patch, payout and seed): only the submission id differs.
    call("anyone.testnet", T0 + SEC);
    c.open_with_groth16(U64(0), bytes(v::SEAL), bytes(v::JOURNAL));
    at("res1.testnet", T0 + 5 * SEC, NearToken::from_yoctonear(0), [0; 32]);
    let fp = to_hex(&commit_fingerprint(FIXED, &acc("res1.testnet"), &hex32(NONCE)));
    c.commit(U64(0), fp, acc("res1.testnet")).unwrap();
    at("res1.testnet", T0 + 15 * SEC, NearToken::from_yoctonear(0), hex32(va::SEED_A0));
    c.reveal(U64(0), 0, Base64VecU8(FIXED.to_vec()), NONCE.into());
    call("anyone.testnet", T0 + 20 * SEC);
    c.submit_groth16(U64(0), 0, bytes(va::SEAL_A0), bytes(va::JOURNAL_A0));
}

#[test]
#[should_panic(expected = "the Groth16 proof does not verify")]
fn s1_a_damaged_seal_with_a_correct_journal_is_refused_by_the_pairing_check() {
    let mut c = testnet_bounty_1();
    // Point A copied over point C: still valid curve points (a byte flipped at random is usually off the curve, which the
    // host function refuses with an error of its own), but not a proof.
    let mut seal = bytes(va::SEAL_A0);
    let a: Vec<u8> = seal.0[0..64].to_vec();
    seal.0[192..256].copy_from_slice(&a);
    call("anyone.testnet", T0 + 20 * SEC);
    c.submit_groth16(U64(va::BOUNTY), 0, seal, bytes(va::JOURNAL_A0));
}

// S2: mode confusion between Proof 0 and attempt proofs.
#[test]
#[should_panic(expected = "the journal belongs to another bounty or attempt (submission id)")]
fn s2_a_proof0_journal_is_refused_as_an_attempt() {
    let mut c = testnet_bounty_1();
    call("anyone.testnet", T0 + 20 * SEC);
    c.submit_groth16(U64(va::BOUNTY), 0, bytes(v::SEAL), bytes(v::JOURNAL));
}

#[test]
#[should_panic(expected = "the journal is not this bounty's Proof 0 journal")]
fn s2_an_attempt_journal_is_refused_as_proof0() {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    at("vendor.testnet", T0, NearToken::from_near(1), [0; 32]);
    c.create_bounty(
        v::ORIGINAL.into(), v::CORPUS.into(), v::IMAGE_ID.into(), v::EXPLOIT.into(), "00".repeat(32), 3, 1024,
        U64(2 * SEC), U64(600 * SEC), U64(300 * SEC), U64(3600 * SEC), U128(10_000_000_000_000_000_000_000), U128(0),
        v::REFERENCE_FIX.into(), v::JOURNAL_SHA256.into(), U64(120 * SEC), 16, 32, Some(LEVEL_2), None,
    );
    call("anyone.testnet", T0 + SEC);
    c.open_with_groth16(U64(0), bytes(va::SEAL_A0), bytes(va::JOURNAL_A0));
}

// S2: the parser refuses every malformed journal before any proof check.
fn journal_with(f: impl FnOnce(&mut Vec<u8>)) -> Base64VecU8 {
    let mut j = bytes(va::JOURNAL_A0);
    f(&mut j.0);
    j
}

#[test]
#[should_panic(expected = "expected 780 bytes")]
fn s2_journal_of_779_bytes_is_refused() {
    let mut c = testnet_bounty_1();
    call("anyone.testnet", T0 + 20 * SEC);
    c.submit_groth16(U64(va::BOUNTY), 0, bytes(va::SEAL_A0), journal_with(|j| { j.pop(); }));
}

#[test]
#[should_panic(expected = "expected 780 bytes")]
fn s2_journal_of_781_bytes_is_refused() {
    let mut c = testnet_bounty_1();
    call("anyone.testnet", T0 + 20 * SEC);
    c.submit_groth16(U64(va::BOUNTY), 0, bytes(va::SEAL_A0), journal_with(|j| j.push(0)));
}

#[test]
#[should_panic(expected = "expected 780 bytes")]
fn s2_empty_journal_is_refused() {
    let mut c = testnet_bounty_1();
    call("anyone.testnet", T0 + 20 * SEC);
    c.submit_groth16(U64(va::BOUNTY), 0, bytes(va::SEAL_A0), Base64VecU8(vec![]));
}

#[test]
#[should_panic(expected = "a byte word above 255")]
fn s2_byte_word_of_256_is_refused() {
    let mut c = testnet_bounty_1();
    call("anyone.testnet", T0 + 20 * SEC);
    c.submit_groth16(U64(va::BOUNTY), 0, bytes(va::SEAL_A0), journal_with(|j| j[4 * 5..4 * 6].copy_from_slice(&256u32.to_le_bytes())));
}

#[test]
#[should_panic(expected = "journal verdict is neither PASS nor FAIL")]
fn s2_verdict_word_2_is_refused() {
    let mut c = testnet_bounty_1();
    call("anyone.testnet", T0 + 20 * SEC);
    c.submit_groth16(U64(va::BOUNTY), 0, bytes(va::SEAL_A0), journal_with(|j| j[4 * 194] = 2));
}

#[test]
#[should_panic(expected = "the Groth16 seal must be 256 bytes")]
fn s2_seal_of_255_bytes_is_refused() {
    let mut c = testnet_bounty_1();
    let mut seal = bytes(va::SEAL_A0);
    seal.0.pop();
    call("anyone.testnet", T0 + 20 * SEC);
    c.submit_groth16(U64(va::BOUNTY), 0, seal, bytes(va::JOURNAL_A0));
}

#[test]
fn s2_one_changed_byte_of_the_control_root_fails_the_pairing_check() {
    call("anyone.testnet", T0);
    let (seal, journal, image) = (bytes(va::SEAL_A0).0, bytes(va::JOURNAL_A0).0, hex32(v::IMAGE_ID));
    assert!(groth16::verify(&seal, &image, &journal));
    let mut root = groth16::vk::CONTROL_ROOT;
    root[0] ^= 1;
    assert!(!groth16::verify_with_root(&seal, &image, &journal, &root));
}
