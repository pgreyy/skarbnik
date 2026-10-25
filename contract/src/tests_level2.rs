//! Unit tests for the Level 2 path (Groth16 proofs checked by the contract), run natively with near-sdk's mocked
//! blockchain and its real alt_bn128 host functions, using the real Groth16 receipt of the demo Proof 0. The
//! attempt proofs are bound to the deployed contract's account; they are tested in tests_level2_attempts.rs.
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

#[path = "groth16_test_vectors.rs"]
mod v;

const SEC: u64 = 1_000_000_000;
const T0: u64 = 1_000 * SEC;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn at(caller: &str, ts: u64, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("kintsugi.testnet"))
        .predecessor_account_id(acc(caller))
        .signer_account_id(acc(caller))
        .block_timestamp(ts)
        .attached_deposit(deposit)
        .build());
}
fn bytes(hex: &str) -> Base64VecU8 {
    Base64VecU8((0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect())
}
/// A contract with one bounty (id 0) holding the demo bounty's values, at the given level, image id and counts.
fn with_bounty(level: u8, image_id: &str, fuzz: u32, variants: u32) -> Contract {
    at("kintsugi.testnet", T0 - 10, NearToken::from_yoctonear(0));
    let mut c = Contract::new(acc("kintsugi.testnet"));
    c.register_verifier(acc("verifier1.testnet"), "v1".into());
    c.register_verifier(acc("verifier2.testnet"), "v2".into());
    at("vendor.testnet", T0, NearToken::from_near(1));
    c.create_bounty(
        v::ORIGINAL.into(), v::CORPUS.into(), image_id.into(), v::EXPLOIT.into(), "00".repeat(32), 3, 1024, U64(2 * SEC),
        U64(600 * SEC), U64(300 * SEC), U64(3600 * SEC), U128(10_000_000_000_000_000_000_000), U128(0),
        v::REFERENCE_FIX.into(), v::JOURNAL_SHA256.into(), U64(120 * SEC), fuzz, variants, Some(level),
    );
    c
}

#[test]
fn level2_bounty_is_marked_and_starts_closed() {
    let c = with_bounty(LEVEL_2, v::IMAGE_ID, 16, 32);
    let b = c.get_bounty(U64(0)).unwrap();
    assert_eq!((b.level, b.opened, b.fuzz_count, b.variant_count), (2, false, 16, 32));
}

#[test]
fn level2_opens_with_the_real_proof0() {
    let mut c = with_bounty(LEVEL_2, v::IMAGE_ID, 16, 32);
    at("anyone.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    assert_eq!(c.open_with_groth16(U64(0), bytes(v::SEAL), bytes(v::JOURNAL)), "opened");
    assert!(c.get_bounty(U64(0)).unwrap().opened);
}

#[test]
#[should_panic(expected = "the Groth16 proof does not verify")]
fn level2_proof0_refused_under_another_image_id() {
    let mut c = with_bounty(LEVEL_2, v::OTHER_IMAGE_ID, 16, 32);
    at("anyone.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    c.open_with_groth16(U64(0), bytes(v::SEAL), bytes(v::JOURNAL));
}

#[test]
#[should_panic(expected = "the journal's check size is not this bounty's")]
fn level2_proof0_refused_with_other_counts() {
    let mut c = with_bounty(LEVEL_2, v::IMAGE_ID, 64, 32);
    at("anyone.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    c.open_with_groth16(U64(0), bytes(v::SEAL), bytes(v::JOURNAL));
}

#[test]
#[should_panic(expected = "the journal's check size is not this bounty's")] // S3: the cheap field check comes first
fn level2_changed_journal_refused() {
    let mut c = with_bounty(LEVEL_2, v::IMAGE_ID, 16, 32);
    let mut j = bytes(v::JOURNAL);
    j.0[160 * 4] = 17; // fuzz_count 16 -> 17: still a valid layout, but not what was proved
    at("anyone.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    c.open_with_groth16(U64(0), bytes(v::SEAL), j);
}

#[test]
#[should_panic(expected = "this is a Level 2 bounty")]
fn level2_refuses_verifier_attestation_of_proof0() {
    let mut c = with_bounty(LEVEL_2, v::IMAGE_ID, 16, 32);
    at("verifier1.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    c.attest_proof0(U64(0), v::JOURNAL_SHA256.into(), "00".repeat(32));
}

#[test]
#[should_panic(expected = "this is a Level 0 bounty")]
fn level0_refuses_groth16_opening() {
    let mut c = with_bounty(LEVEL_0, v::IMAGE_ID, 16, 32);
    at("anyone.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    c.open_with_groth16(U64(0), bytes(v::SEAL), bytes(v::JOURNAL));
}

#[test]
#[should_panic(expected = "bounty has expired")]
fn level2_open_refused_after_expiry() {
    let mut c = with_bounty(LEVEL_2, v::IMAGE_ID, 16, 32);
    at("anyone.testnet", T0 + 3601 * SEC, NearToken::from_yoctonear(0));
    c.open_with_groth16(U64(0), bytes(v::SEAL), bytes(v::JOURNAL));
}

#[test]
fn journal_layout_matches_the_real_proof0() {
    let j = groth16::parse_journal(&bytes(v::JOURNAL).0);
    assert_eq!(to_hex(&j.candidate_hash), v::REFERENCE_FIX);
    assert_eq!(to_hex(&j.original_hash), v::ORIGINAL);
    assert_eq!(to_hex(&j.exploit_commitment), v::EXPLOIT);
    assert_eq!(to_hex(&j.corpus_hash), v::CORPUS);
    assert_eq!((j.fuzz_count, j.variant_count, j.verdict), (16, 32, 1));
    assert_eq!(j.submission_id, proof0_id(&parse_hash("ref", v::REFERENCE_FIX)));
}

#[test]
fn level2_unrevealed_fee_goes_to_the_pool_not_the_vendor() {
    let mut c = with_bounty(LEVEL_2, v::IMAGE_ID, 16, 32);
    at("anyone.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    c.open_with_groth16(U64(0), bytes(v::SEAL), bytes(v::JOURNAL));
    at("sybil.testnet", T0 + 2 * SEC, NearToken::from_near(1));
    c.deposit_credit(None);
    at("sybil.testnet", T0 + 3 * SEC, NearToken::from_yoctonear(0));
    c.commit(U64(0), "aa".repeat(32), acc("sybil.testnet")).unwrap();
    at("anyone.testnet", T0 + 3601 * SEC, NearToken::from_yoctonear(0));
    c.expire(U64(0));
    let fee = 10_000_000_000_000_000_000_000u128;
    assert_eq!(c.get_protocol_pool().0, fee);
    // Only the bounty itself goes back to the vendor; the fee does not.
    let to_vendor: u128 = near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .filter(|r| r.receiver_id == acc("vendor.testnet"))
        .flat_map(|r| r.actions)
        .filter_map(|a| match a {
            near_sdk::mock::MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
            _ => None,
        })
        .sum();
    assert_eq!(to_vendor, NearToken::from_near(1).as_yoctonear());
}

// Audit round 1, fix 1 (review finding F1): a junk reveal just before expiry can no longer be paid by timeout.
#[test]
#[should_panic(expected = "too close to expiry: a commit")]
fn audit_f1_level2_last_minute_commit_is_refused() {
    let mut c = with_bounty(LEVEL_2, v::IMAGE_ID, 16, 32); // expiry T0 + 3600 s, reveal window 120 s, verdict window 600 s
    at("anyone.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    c.open_with_groth16(U64(0), bytes(v::SEAL), bytes(v::JOURNAL));
    at("thief.testnet", T0 + 2 * SEC, NearToken::from_near(1));
    c.deposit_credit(None);
    at("thief.testnet", T0 + 3590 * SEC, NearToken::from_yoctonear(0));
    c.commit(U64(0), "aa".repeat(32), acc("thief.testnet"));
}

// Audit round 1, fix 5 (review finding: the vendor chose the checker program): the owner's allowlist of image ids.
#[test]
fn audit_f5_allowlist_pins_the_checker() {
    let mut c = with_bounty(LEVEL_2, v::IMAGE_ID, 16, 32); // created while the list is empty: any id is accepted
    assert!(c.get_bounty(U64(0)).unwrap().image_id_allowed);
    at("kintsugi.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    assert_eq!(c.allow_image_id(v::IMAGE_ID.into()), vec![v::IMAGE_ID.to_string()]);
    assert_eq!(c.get_allowed_image_ids(), vec![v::IMAGE_ID.to_string()]);
    // The allowed id still creates bounties.
    at("vendor.testnet", T0 + 2 * SEC, NearToken::from_near(1));
    c.create_bounty(
        v::ORIGINAL.into(), v::CORPUS.into(), v::IMAGE_ID.into(), v::EXPLOIT.into(), "00".repeat(32), 3, 1024, U64(2 * SEC),
        U64(600 * SEC), U64(300 * SEC), U64(3600 * SEC), U128(10_000_000_000_000_000_000_000), U128(0),
        v::REFERENCE_FIX.into(), v::JOURNAL_SHA256.into(), U64(120 * SEC), 16, 32, Some(LEVEL_2),
    );
    assert!(c.get_bounty(U64(1)).unwrap().image_id_allowed);
}

#[test]
#[should_panic(expected = "image_id is not an allowed checker")]
fn audit_f5_unlisted_image_id_is_refused_once_the_list_is_set() {
    let mut c = with_bounty(LEVEL_2, v::IMAGE_ID, 16, 32);
    at("kintsugi.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    c.allow_image_id(v::IMAGE_ID.into());
    at("vendor.testnet", T0 + 2 * SEC, NearToken::from_near(1));
    c.create_bounty(
        v::ORIGINAL.into(), v::CORPUS.into(), "ab".repeat(32), v::EXPLOIT.into(), "00".repeat(32), 3, 1024, U64(2 * SEC),
        U64(600 * SEC), U64(300 * SEC), U64(3600 * SEC), U128(10_000_000_000_000_000_000_000), U128(0),
        v::REFERENCE_FIX.into(), v::JOURNAL_SHA256.into(), U64(120 * SEC), 16, 32, Some(LEVEL_2),
    );
}

#[test]
#[should_panic(expected = "only the owner can allow an image id")]
fn audit_f5_only_the_owner_allows_image_ids() {
    let mut c = with_bounty(LEVEL_2, v::IMAGE_ID, 16, 32);
    at("vendor.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    c.allow_image_id(v::OTHER_IMAGE_ID.into());
}

#[test]
fn audit_f5_an_existing_bounty_with_an_unlisted_id_is_shown_as_not_allowed() {
    let mut c = with_bounty(LEVEL_2, v::OTHER_IMAGE_ID, 16, 32); // created before the list existed
    at("kintsugi.testnet", T0 + SEC, NearToken::from_yoctonear(0));
    c.allow_image_id(v::IMAGE_ID.into());
    assert!(!c.get_bounty(U64(0)).unwrap().image_id_allowed);
}
