//! Unit tests for the bounty rules. They run the contract natively with near-sdk's mocked blockchain
//! (`VMContextBuilder`), moving the block timestamp to open and close the windows.
//! Run from the contract folder: cargo test

use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::mock::MockAction;
use near_sdk::testing_env;

const SEC: u64 = 1_000_000_000;
const T0: u64 = 1_000 * SEC;
const GAP: u64 = 2 * SEC;
const W: u64 = 60 * SEC;
const A: u64 = 30 * SEC;
const E: u64 = 600 * SEC;
const H1: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const H2: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const H3: &str = "3333333333333333333333333333333333333333333333333333333333333333";
const NONCE: &str = "abababababababababababababababababababababababababababababababab";
const PATCH: &[u8] = b"\0asm\x01\0\0\0 fake patch bytes";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn owner() -> AccountId {
    acc("kintsugi.testnet")
}
fn vendor() -> AccountId {
    acc("vendor.testnet")
}
fn researcher() -> AccountId {
    acc("researcher.testnet")
}
fn payout() -> AccountId {
    acc("payout.testnet")
}
fn v1() -> AccountId {
    acc("verifier1.testnet")
}
fn v2() -> AccountId {
    acc("verifier2.testnet")
}

fn bounty_amount() -> NearToken {
    NearToken::from_near(2)
}

/// Set the caller, block time and attached deposit for the next call.
fn at(caller: AccountId, ts: u64, deposit: NearToken) {
    let ctx = VMContextBuilder::new()
        .current_account_id(owner())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller)
        .block_timestamp(ts)
        .random_seed([7u8; 32])
        .attached_deposit(deposit)
        .build();
    testing_env!(ctx);
}

fn call(caller: AccountId, ts: u64) {
    at(caller, ts, NearToken::from_yoctonear(0));
}

fn nonce_bytes() -> [u8; 32] {
    parse_hash("nonce", NONCE)
}

fn fingerprint_hex(patch: &[u8], pay: &AccountId) -> String {
    to_hex(&commit_fingerprint(patch, pay, &nonce_bytes()))
}

/// A fresh contract with two registered verifiers and one open bounty (id 0) created at T0.
fn setup() -> Contract {
    call(owner(), T0 - 10);
    let mut c = Contract::new(owner());
    c.register_verifier(v1(), "verifier 1".into());
    c.register_verifier(v2(), "verifier 2".into());
    at(vendor(), T0, bounty_amount());
    let id = c.create_bounty(H1.into(), H2.into(), H3.into(), H1.into(), H2.into(), 3, 1024, U64(GAP), U64(W), U64(A), U64(E));
    assert_eq!(id.0, 0);
    c
}

/// Commit at `t` and reveal at `t + GAP`; returns the submission index.
fn commit_and_reveal(c: &mut Contract, t: u64) -> u32 {
    call(researcher(), t);
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(researcher(), t + GAP);
    c.reveal(U64(0), idx, Base64VecU8(PATCH.to_vec()), NONCE.into());
    idx
}

/// All transfers created by the last call, as (receiver, yoctoNEAR).
fn transfers() -> Vec<(AccountId, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.clone();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::Transfer { deposit, .. } => Some((to.clone(), deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}

#[test]
fn happy_path_two_verifiers_pay_researcher() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    let s = c.get_submission(U64(0), idx).unwrap();
    assert_eq!(s.seed.as_deref(), Some(to_hex(&[7u8; 32]).as_str()));
    assert_eq!(s.patch_hash.unwrap(), to_hex(&env::sha256_array(PATCH)));

    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Pass, H1.into(), H2.into());

    call(v1(), T0 + 11 * SEC);
    assert_eq!(c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into()), "recorded");
    assert!(transfers().is_empty());

    call(v2(), T0 + 12 * SEC);
    assert_eq!(c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into()), "final_pass");
    assert_eq!(transfers(), vec![(payout(), bounty_amount().as_yoctonear())]);
    assert!(get_logs().iter().any(|l| l.starts_with("EVENT_JSON:") && l.contains("\"event\":\"paid\"")));

    let b = c.get_bounty(U64(0)).unwrap();
    assert_eq!(b.state, BountyState::Paid);
    assert_eq!(b.winner, Some(idx));
    assert_eq!(c.get_submission(U64(0), idx).unwrap().outcome, Outcome::Passed);
}

#[test]
fn silent_vendor_timeout_pays_researcher() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    let deadline = c.get_submission(U64(0), idx).unwrap().deadline_ns.unwrap().0;
    assert_eq!(deadline, T0 + SEC + GAP + W);
    // Anyone may call it, here a stranger.
    call(acc("stranger.testnet"), deadline + 1);
    c.claim_timeout(U64(0), idx);
    assert_eq!(transfers(), vec![(payout(), bounty_amount().as_yoctonear())]);
    assert_eq!(c.get_bounty(U64(0)).unwrap().state, BountyState::Paid);
    assert_eq!(c.get_submission(U64(0), idx).unwrap().outcome, Outcome::TimedOut);
}

#[test]
#[should_panic(expected = "deadline has not passed")]
fn timeout_before_deadline_rejected() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(acc("stranger.testnet"), T0 + SEC + GAP + W);
    c.claim_timeout(U64(0), idx);
}

#[test]
fn verdict_without_two_attestations_times_out() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Fail, H1.into(), H2.into());
    call(v1(), T0 + 11 * SEC);
    c.attest(U64(0), idx, Verdict::Fail, H1.into(), H2.into());
    // Only one attestation by the end of the attestation window: counts as no verdict.
    call(researcher(), T0 + 10 * SEC + A + 1);
    c.claim_timeout(U64(0), idx);
    assert_eq!(transfers(), vec![(payout(), bounty_amount().as_yoctonear())]);
}

#[test]
fn expire_refunds_vendor() {
    let mut c = setup();
    call(acc("stranger.testnet"), T0 + E);
    c.expire(U64(0));
    assert_eq!(transfers(), vec![(vendor(), bounty_amount().as_yoctonear())]);
    assert_eq!(c.get_bounty(U64(0)).unwrap().state, BountyState::Refunded);
}

#[test]
#[should_panic(expected = "bounty has not expired")]
fn expire_too_early_rejected() {
    let mut c = setup();
    call(acc("stranger.testnet"), T0 + E - 1);
    c.expire(U64(0));
}

#[test]
#[should_panic(expected = "a revealed submission is still unresolved")]
fn expire_waits_for_revealed_submission() {
    let mut c = setup();
    commit_and_reveal(&mut c, T0 + E - 10 * SEC);
    call(vendor(), T0 + E + 1);
    c.expire(U64(0));
}

#[test]
#[should_panic(expected = "bounty is closed")]
fn expire_after_payout_rejected() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(researcher(), T0 + SEC + GAP + W + 1);
    c.claim_timeout(U64(0), idx);
    call(vendor(), T0 + E + 1);
    c.expire(U64(0));
}

#[test]
fn same_verifier_twice_counts_once() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    call(v1(), T0 + 11 * SEC);
    assert_eq!(c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into()), "recorded");
    call(v1(), T0 + 12 * SEC);
    assert_eq!(c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into()), "duplicate");
    assert!(transfers().is_empty());
    let s = c.get_submission(U64(0), idx).unwrap();
    assert_eq!(s.attestations, vec![v1()]);
    assert_eq!(s.outcome, Outcome::Open);
    assert_eq!(c.get_bounty(U64(0)).unwrap().state, BountyState::Open);
}

#[test]
#[should_panic(expected = "a vendor account cannot be a verifier")]
fn vendor_cannot_be_verifier() {
    let mut c = setup();
    call(owner(), T0 + SEC);
    c.register_verifier(vendor(), "vendor trying".into());
}

#[test]
#[should_panic(expected = "a registered verifier cannot be a vendor")]
fn verifier_cannot_be_vendor() {
    let mut c = setup();
    at(v1(), T0 + SEC, bounty_amount());
    c.create_bounty(H1.into(), H2.into(), H3.into(), H1.into(), H2.into(), 3, 1024, U64(GAP), U64(W), U64(A), U64(E));
}

#[test]
#[should_panic(expected = "only the owner can register verifiers")]
fn only_owner_registers_verifiers() {
    let mut c = setup();
    call(researcher(), T0 + SEC);
    c.register_verifier(acc("verifier3.testnet"), "self registered".into());
}

#[test]
#[should_panic(expected = "caller is not a registered verifier")]
fn unregistered_attester_rejected() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    call(acc("stranger.testnet"), T0 + 11 * SEC);
    c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
}

#[test]
#[should_panic(expected = "fingerprint does not match")]
fn wrong_patch_rejected() {
    let mut c = setup();
    call(researcher(), T0 + SEC);
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(researcher(), T0 + SEC + GAP);
    c.reveal(U64(0), idx, Base64VecU8(b"a different patch".to_vec()), NONCE.into());
}

#[test]
#[should_panic(expected = "fingerprint does not match")]
fn wrong_nonce_rejected() {
    let mut c = setup();
    call(researcher(), T0 + SEC);
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(researcher(), T0 + SEC + GAP);
    c.reveal(U64(0), idx, Base64VecU8(PATCH.to_vec()), H3.into());
}

#[test]
#[should_panic(expected = "fingerprint does not match")]
fn fingerprint_binds_payout_account() {
    let mut c = setup();
    call(researcher(), T0 + SEC);
    // The fingerprint was made for a different payout account than the one committed.
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &researcher()), payout()).unwrap();
    call(researcher(), T0 + SEC + GAP);
    c.reveal(U64(0), idx, Base64VecU8(PATCH.to_vec()), NONCE.into());
}

#[test]
#[should_panic(expected = "reveal gap has not passed")]
fn reveal_before_gap_rejected() {
    let mut c = setup();
    call(researcher(), T0 + SEC);
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(researcher(), T0 + SEC + GAP - 1);
    c.reveal(U64(0), idx, Base64VecU8(PATCH.to_vec()), NONCE.into());
}

#[test]
#[should_panic(expected = "patch is larger than max_patch_bytes")]
fn oversized_patch_rejected() {
    let mut c = setup();
    let big = vec![0u8; 1025];
    call(researcher(), T0 + SEC);
    let idx = c.commit(U64(0), fingerprint_hex(&big, &payout()), payout()).unwrap();
    call(researcher(), T0 + SEC + GAP);
    c.reveal(U64(0), idx, Base64VecU8(big), NONCE.into());
}

#[test]
#[should_panic(expected = "only the committer can reveal")]
fn only_committer_reveals() {
    let mut c = setup();
    call(researcher(), T0 + SEC);
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(acc("copycat.testnet"), T0 + SEC + GAP);
    c.reveal(U64(0), idx, Base64VecU8(PATCH.to_vec()), NONCE.into());
}

#[test]
#[should_panic(expected = "verdict window has closed")]
fn late_verdict_rejected() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(vendor(), T0 + SEC + GAP + W + 1);
    c.post_verdict(U64(0), idx, Verdict::Fail, H1.into(), H2.into());
}

#[test]
#[should_panic(expected = "only the vendor can post a verdict")]
fn only_vendor_posts_verdict() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(researcher(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
}

#[test]
#[should_panic(expected = "attestation window has closed")]
fn late_attestation_rejected() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    call(v1(), T0 + 10 * SEC + A + 1);
    c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
}

#[test]
#[should_panic(expected = "attestation does not match the posted verdict")]
fn mismatched_attestation_rejected() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    call(v1(), T0 + 11 * SEC);
    // Same verdict, different receipt hash.
    c.attest(U64(0), idx, Verdict::Pass, H1.into(), H3.into());
}

#[test]
fn commits_beyond_k_are_ignored() {
    let mut c = setup();
    for i in 0..3u32 {
        call(acc(&format!("r{i}.testnet")), T0 + SEC);
        assert_eq!(c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()), Some(i));
    }
    call(acc("r3.testnet"), T0 + SEC);
    assert_eq!(c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()), None);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"commit_ignored\"")));
    assert_eq!(c.get_bounty(U64(0)).unwrap().commits, 3);
    assert!(c.get_submission(U64(0), 3).is_none());
}

#[test]
fn final_fail_spends_attempt_and_later_pass_pays() {
    let mut c = setup();
    let first = commit_and_reveal(&mut c, T0 + SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), first, Verdict::Fail, H1.into(), H2.into());
    call(v1(), T0 + 11 * SEC);
    c.attest(U64(0), first, Verdict::Fail, H1.into(), H2.into());
    call(v2(), T0 + 12 * SEC);
    assert_eq!(c.attest(U64(0), first, Verdict::Fail, H1.into(), H2.into()), "final_fail");
    assert!(transfers().is_empty());
    assert_eq!(c.get_submission(U64(0), first).unwrap().outcome, Outcome::Failed);
    assert_eq!(c.get_bounty(U64(0)).unwrap().state, BountyState::Open);
    assert_eq!(c.get_bounty(U64(0)).unwrap().pending, 0);

    let second = commit_and_reveal(&mut c, T0 + 20 * SEC);
    assert_eq!(second, 1);
    call(vendor(), T0 + 30 * SEC);
    c.post_verdict(U64(0), second, Verdict::Pass, H3.into(), H1.into());
    call(v2(), T0 + 31 * SEC);
    c.attest(U64(0), second, Verdict::Pass, H3.into(), H1.into());
    call(v1(), T0 + 32 * SEC);
    assert_eq!(c.attest(U64(0), second, Verdict::Pass, H3.into(), H1.into()), "final_pass");
    assert_eq!(transfers(), vec![(payout(), bounty_amount().as_yoctonear())]);
}

#[test]
#[should_panic(expected = "bounty is closed")]
fn no_second_payout_after_pass() {
    let mut c = setup();
    let a = commit_and_reveal(&mut c, T0 + SEC);
    let b = commit_and_reveal(&mut c, T0 + 2 * SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), a, Verdict::Pass, H1.into(), H2.into());
    call(v1(), T0 + 11 * SEC);
    c.attest(U64(0), a, Verdict::Pass, H1.into(), H2.into());
    call(v2(), T0 + 12 * SEC);
    c.attest(U64(0), a, Verdict::Pass, H1.into(), H2.into());
    // The other submission's timeout must not pay a second time.
    call(researcher(), T0 + 2 * SEC + GAP + W + 1);
    c.claim_timeout(U64(0), b);
}

#[test]
#[should_panic(expected = "a researcher cannot attest its own submission")]
fn researcher_cannot_attest_own_submission() {
    let mut c = setup();
    call(v1(), T0 + SEC);
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(v1(), T0 + SEC + GAP);
    c.reveal(U64(0), idx, Base64VecU8(PATCH.to_vec()), NONCE.into());
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    call(v1(), T0 + 11 * SEC);
    c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
}

#[test]
#[should_panic(expected = "attach at least 0.1 NEAR as the bounty")]
fn tiny_bounty_rejected() {
    let mut c = setup();
    at(acc("vendor2.testnet"), T0, NearToken::from_millinear(99));
    c.create_bounty(H1.into(), H2.into(), H3.into(), H1.into(), H2.into(), 3, 1024, U64(GAP), U64(W), U64(A), U64(E));
}

#[test]
fn init_replaces_hello_world_state() {
    call(owner(), T0);
    // What the S0 hello world left under the state key: a borsh string.
    env::storage_write(b"STATE", &near_sdk::borsh::to_vec(&"hello from kintsugi".to_string()).unwrap());
    let c = Contract::new(owner());
    assert_eq!(c.get_owner(), owner());
    assert_eq!(c.get_next_bounty_id().0, 0);
}

#[test]
fn fingerprint_layout_is_stable() {
    // Pinned value so scripts (scripts/s3_testnet.sh computes it in Python) and the contract agree.
    // Layout: "kintsugi-commit-v1" || u32le(len patch) || patch || u32le(len payout) || payout || nonce.
    call(owner(), T0);
    let fp = commit_fingerprint(b"abc", &acc("payout.testnet"), &[0u8; 32]);
    let mut buf = b"kintsugi-commit-v1".to_vec();
    buf.extend_from_slice(&3u32.to_le_bytes());
    buf.extend_from_slice(b"abc");
    buf.extend_from_slice(&14u32.to_le_bytes());
    buf.extend_from_slice(b"payout.testnet");
    buf.extend_from_slice(&[0u8; 32]);
    assert_eq!(fp, env::sha256_array(&buf));
}
