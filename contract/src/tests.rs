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
/// Attempt fee for the first commit (0.01 NEAR) and the step added per later commit (0.005 NEAR).
const FEE: u128 = 10_000_000_000_000_000_000_000;
const STEP: u128 = 5_000_000_000_000_000_000_000;
/// Hash of the bounty's Proof 0 journal (the Proof 0 receipt hash is H2) and the reveal window.
const P0J: &str = "4444444444444444444444444444444444444444444444444444444444444444";
const RW: u64 = 120 * SEC;

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

/// Credit each test researcher starts with.
fn start_credit() -> NearToken {
    NearToken::from_near(1)
}

/// A fresh contract with two registered verifiers, one open bounty (id 0) created at T0, and
/// 1 NEAR of credit for the researcher accounts used in the tests.
fn setup() -> Contract {
    call(owner(), T0 - 10);
    let mut c = Contract::new(owner());
    c.register_verifier(v1(), "verifier 1".into());
    c.register_verifier(v2(), "verifier 2".into());
    for a in [researcher(), acc("r0.testnet"), acc("r1.testnet"), acc("r2.testnet"), acc("r3.testnet"), v1()] {
        at(a, T0 - 5, start_credit());
        c.deposit_credit(None);
    }
    at(vendor(), T0, bounty_amount());
    let id = c.create_bounty(H1.into(), H2.into(), H3.into(), H1.into(), H2.into(), 3, 1024, U64(GAP), U64(W), U64(A), U64(E), U128(FEE), U128(STEP), H3.into(), P0J.into(), U64(RW), 16, 32, None);
    assert_eq!(id.0, 0);
    // Proof 0: two different verifiers attest it, which opens the bounty.
    call(v1(), T0);
    assert_eq!(c.attest_proof0(U64(0), P0J.into(), H2.into()), "recorded");
    call(v2(), T0);
    assert_eq!(c.attest_proof0(U64(0), P0J.into(), H2.into()), "opened");
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
    assert_eq!(transfers(), vec![(payout(), bounty_amount().as_yoctonear() + FEE)]);
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
    assert_eq!(transfers(), vec![(payout(), bounty_amount().as_yoctonear() + FEE)]);
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
    assert_eq!(transfers(), vec![(payout(), bounty_amount().as_yoctonear() + FEE)]);
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
    // Revealed early (a reveal must leave a full verdict window before expiry); nobody claims its timeout.
    commit_and_reveal(&mut c, T0 + 100 * SEC);
    call(vendor(), T0 + E + 1);
    c.expire(U64(0));
}

#[test]
fn expire_after_payout_moves_unrevealed_fee_to_pool() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    // A second commit that is never revealed: its fee (FEE + STEP) goes to the protocol fee pool at expiry.
    call(acc("r0.testnet"), T0 + 2 * SEC);
    c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(researcher(), T0 + SEC + GAP + W + 1);
    c.claim_timeout(U64(0), idx);
    call(acc("stranger.testnet"), T0 + E + 1);
    c.expire(U64(0));
    // The winner's own fee was refunded with the payout; the unrevealed fee is paid to nobody.
    assert_eq!(transfers(), vec![]);
    assert_eq!(c.get_protocol_pool().0, FEE + STEP);
    let b = c.get_bounty(U64(0)).unwrap();
    assert_eq!((b.state, b.fees_collected.0, b.fees_swept), (BountyState::Paid, 0, false));
    assert_eq!(c.get_submission(U64(0), 1).unwrap().outcome, Outcome::Released);
}

#[test]
#[should_panic(expected = "nothing to do")]
fn second_expire_after_sweep_rejected() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(acc("r0.testnet"), T0 + 2 * SEC);
    c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(researcher(), T0 + SEC + GAP + W + 1);
    c.claim_timeout(U64(0), idx);
    call(acc("stranger.testnet"), T0 + E + 1);
    c.expire(U64(0));
    c.expire(U64(0));
}

#[test]
#[should_panic(expected = "bounty is closed")]
fn timeout_after_payout_rejected() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(researcher(), T0 + SEC + GAP + W + 1);
    c.claim_timeout(U64(0), idx);
    c.claim_timeout(U64(0), idx);
}

#[test]
fn expire_refunds_vendor_and_moves_unrevealed_fee_to_pool() {
    let mut c = setup();
    call(researcher(), T0 + SEC);
    c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(acc("stranger.testnet"), T0 + E);
    c.expire(U64(0));
    // The vendor gets the bounty back; the never-revealed fee goes to the pool, not to the vendor or the verifiers.
    assert_eq!(transfers(), vec![(vendor(), bounty_amount().as_yoctonear())]);
    assert_eq!(c.get_protocol_pool().0, FEE);
    assert_eq!(c.get_bounty(U64(0)).unwrap().state, BountyState::Refunded);
}

#[test]
fn release_unrevealed_moves_the_fee_to_the_pool_and_pays_nobody() {
    let mut c = setup();
    call(researcher(), T0 + SEC);
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    assert_eq!(c.get_protocol_pool().0, 0);
    call(acc("stranger.testnet"), T0 + SEC + RW + 1);
    c.release_unrevealed(U64(0), idx);
    assert_eq!(transfers(), vec![]);
    assert_eq!(c.get_protocol_pool().0, FEE);
    assert_eq!(c.get_bounty(U64(0)).unwrap().fees_collected.0, 0);
    // At expiry nothing more moves: the fee is in the pool once, and nobody is paid it.
    call(acc("stranger.testnet"), T0 + E);
    c.expire(U64(0));
    assert_eq!(transfers(), vec![(vendor(), bounty_amount().as_yoctonear())]);
    assert_eq!(c.get_protocol_pool().0, FEE);
}

#[test]
fn revealed_failed_attempt_fee_still_goes_to_the_verifiers() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(vendor(), T0 + SEC + GAP + 1);
    c.post_verdict(U64(0), idx, Verdict::Fail, H1.into(), H2.into());
    call(v1(), T0 + SEC + GAP + 2);
    c.attest(U64(0), idx, Verdict::Fail, H1.into(), H2.into());
    call(v2(), T0 + SEC + GAP + 3);
    c.attest(U64(0), idx, Verdict::Fail, H1.into(), H2.into());
    call(acc("stranger.testnet"), T0 + E);
    c.expire(U64(0));
    let mut t = transfers();
    t.sort();
    let mut want = vec![(vendor(), bounty_amount().as_yoctonear()), (v1(), FEE / 2), (v2(), FEE / 2)];
    want.sort();
    assert_eq!(t, want);
    assert_eq!(c.get_protocol_pool().0, 0);
}

#[test]
fn fee_rises_with_each_attempt_and_comes_from_credit() {
    let mut c = setup();
    let mut total = 0u128;
    for i in 0..3u32 {
        let who = acc(&format!("r{i}.testnet"));
        let fee = FEE + STEP * i as u128;
        assert_eq!(c.get_bounty(U64(0)).unwrap().next_fee.0, fee);
        call(who.clone(), T0 + SEC);
        c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
        assert_eq!(c.get_credit(who).0, start_credit().as_yoctonear() - fee);
        total += fee;
    }
    assert_eq!(c.get_bounty(U64(0)).unwrap().fees_collected.0, total);
}

#[test]
#[should_panic(expected = "not enough credit")]
fn commit_without_credit_rejected() {
    let mut c = setup();
    call(acc("nocredit.testnet"), T0 + SEC);
    c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout());
}

#[test]
fn deposit_credit_for_another_account() {
    let mut c = setup();
    at(acc("owner-of-agent.testnet"), T0, NearToken::from_millinear(50));
    c.deposit_credit(Some(acc("agent.testnet")));
    assert_eq!(c.get_credit(acc("agent.testnet")).0, NearToken::from_millinear(50).as_yoctonear());
    assert_eq!(c.get_credit(acc("owner-of-agent.testnet")).0, 0);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn withdraw_needs_one_yocto() {
    let mut c = setup();
    call(researcher(), T0);
    c.withdraw_credit(U128(1));
}

#[test]
fn withdraw_returns_unspent_credit() {
    let mut c = setup();
    at(researcher(), T0, NearToken::from_yoctonear(1));
    let left = c.withdraw_credit(U128(NearToken::from_millinear(400).as_yoctonear()));
    assert_eq!(left.0, NearToken::from_millinear(600).as_yoctonear());
    assert_eq!(transfers(), vec![(researcher(), NearToken::from_millinear(400).as_yoctonear())]);
}

#[test]
#[should_panic(expected = "attempt_fee must be above zero")]
fn zero_fee_bounty_rejected() {
    let mut c = setup();
    at(acc("vendor2.testnet"), T0, bounty_amount());
    c.create_bounty(H1.into(), H2.into(), H3.into(), H1.into(), H2.into(), 3, 1024, U64(GAP), U64(W), U64(A), U64(E), U128(0), U128(0), H3.into(), P0J.into(), U64(RW), 16, 32, None);
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
    c.create_bounty(H1.into(), H2.into(), H3.into(), H1.into(), H2.into(), 3, 1024, U64(GAP), U64(W), U64(A), U64(E), U128(FEE), U128(STEP), H3.into(), P0J.into(), U64(RW), 16, 32, None);
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
    // An ignored commit takes no fee.
    assert_eq!(c.get_credit(acc("r3.testnet")).0, start_credit().as_yoctonear());
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
    assert_eq!(transfers(), vec![(payout(), bounty_amount().as_yoctonear() + FEE + STEP)]);
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
    c.create_bounty(H1.into(), H2.into(), H3.into(), H1.into(), H2.into(), 3, 1024, U64(GAP), U64(W), U64(A), U64(E), U128(FEE), U128(STEP), H3.into(), P0J.into(), U64(RW), 16, 32, None);
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

// ---------- OutLayer as verifier 1 (S5) ----------

fn outlayer() -> AccountId {
    acc("outlayer.testnet")
}

fn outlayer_config() -> OutLayerConfig {
    OutLayerConfig {
        account_id: outlayer(),
        wasm_url: "https://example.invalid/kintsugi-outlayer-verifier.wasm".into(),
        wasm_sha256: H3.into(),
        build_target: "wasm32-wasip1".into(),
        max_instructions: U64(10_000_000_000),
        max_memory_mb: 256,
        max_execution_seconds: U64(60),
    }
}

/// Bounty 0 with a revealed submission and a posted PASS (journal H1, receipt H2), OutLayer set and
/// registered as a verifier. Returns the contract and the submission index.
fn setup_outlayer() -> (Contract, u32) {
    let mut c = setup();
    call(owner(), T0 + SEC);
    c.set_outlayer(outlayer_config());
    c.register_verifier(outlayer(), "verifier 1: OutLayer job, trusts outlayer.testnet and its operator".into());
    let idx = commit_and_reveal(&mut c, T0 + 2 * SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    (c, idx)
}

fn answer(c: &Contract, idx: u32) -> Value {
    json!({
        "ok": true,
        "verdict": "PASS",
        "image_id": H3,
        "submission_id": c.get_submission_id(U64(0), idx).unwrap(),
        "receipt_sha256": H2,
        "journal_sha256": H1,
        "error": null,
    })
}

#[test]
fn outlayer_answer_counts_as_one_verifier() {
    let (mut c, idx) = setup_outlayer();
    call(owner(), T0 + 11 * SEC);
    let a = answer(&c, idx);
    assert_eq!(c.on_outlayer_result(U64(0), idx, Ok(Some(a))), "recorded");
    assert_eq!(c.get_submission(U64(0), idx).unwrap().attestations, vec![outlayer()]);
    call(v1(), T0 + 12 * SEC);
    assert_eq!(c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into()), "final_pass");
    assert_eq!(transfers(), vec![(payout(), bounty_amount().as_yoctonear() + FEE)]);
}

#[test]
fn outlayer_answer_twice_counts_once() {
    let (mut c, idx) = setup_outlayer();
    call(owner(), T0 + 11 * SEC);
    let a = answer(&c, idx);
    c.on_outlayer_result(U64(0), idx, Ok(Some(a.clone())));
    assert_eq!(c.on_outlayer_result(U64(0), idx, Ok(Some(a))), "duplicate");
    assert_eq!(c.get_submission(U64(0), idx).unwrap().outcome, Outcome::Open);
}

#[test]
fn outlayer_answer_with_other_image_id_rejected() {
    let (mut c, idx) = setup_outlayer();
    call(owner(), T0 + 11 * SEC);
    let mut a = answer(&c, idx);
    a["image_id"] = json!(H1);
    assert_eq!(c.on_outlayer_result(U64(0), idx, Ok(Some(a))), "rejected: image_id differs");
    assert!(c.get_submission(U64(0), idx).unwrap().attestations.is_empty());
}

#[test]
fn outlayer_answer_with_other_submission_or_receipt_rejected() {
    let (mut c, idx) = setup_outlayer();
    call(owner(), T0 + 11 * SEC);
    let mut a = answer(&c, idx);
    a["submission_id"] = json!(H1);
    assert_eq!(c.on_outlayer_result(U64(0), idx, Ok(Some(a))), "rejected: submission_id differs");
    let mut a = answer(&c, idx);
    a["receipt_sha256"] = json!(H3);
    assert_eq!(c.on_outlayer_result(U64(0), idx, Ok(Some(a))), "rejected: receipt_sha256 differs");
    let mut a = answer(&c, idx);
    a["verdict"] = json!("FAIL");
    assert_eq!(c.on_outlayer_result(U64(0), idx, Ok(Some(a))), "rejected: verdict differs from the posted verdict");
    assert!(c.get_submission(U64(0), idx).unwrap().attestations.is_empty());
}

#[test]
fn outlayer_not_ok_or_failed_records_nothing() {
    let (mut c, idx) = setup_outlayer();
    call(owner(), T0 + 11 * SEC);
    let mut a = answer(&c, idx);
    a["ok"] = json!(false);
    assert_eq!(c.on_outlayer_result(U64(0), idx, Ok(Some(a))), "rejected: answer is not ok");
    assert_eq!(c.on_outlayer_result(U64(0), idx, Ok(None)), "rejected: no answer from OutLayer");
    assert_eq!(c.on_outlayer_result(U64(0), idx, Err(PromiseError::Failed)), "rejected: no answer from OutLayer");
    assert!(c.get_submission(U64(0), idx).unwrap().attestations.is_empty());
}

#[test]
#[should_panic(expected = "is private")]
fn outlayer_callback_is_private() {
    let (mut c, idx) = setup_outlayer();
    call(acc("stranger.testnet"), T0 + 11 * SEC);
    let a = answer(&c, idx);
    c.on_outlayer_result(U64(0), idx, Ok(Some(a)));
}

#[test]
fn request_sends_job_to_outlayer_with_pinned_program() {
    let (mut c, idx) = setup_outlayer();
    at(acc("anyone.testnet"), T0 + 11 * SEC, NearToken::from_millinear(500));
    let _ = c.request_outlayer_check(U64(0), idx, "cmVjZWlwdA==".into());
    let calls: Vec<(AccountId, String, String, u128)> = get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.clone();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } => Some((
                    to.clone(),
                    String::from_utf8(method_name).unwrap(),
                    String::from_utf8(args).unwrap(),
                    attached_deposit.as_yoctonear(),
                )),
                _ => None,
            })
        })
        .collect();
    let (to, method, args, deposit) = &calls[0];
    assert_eq!(to, &outlayer());
    assert_eq!(method, "request_execution");
    assert_eq!(*deposit, NearToken::from_millinear(500).as_yoctonear());
    let v: Value = near_sdk::serde_json::from_str(args).unwrap();
    assert_eq!(v["source"]["WasmUrl"]["hash"], json!(H3));
    assert_eq!(v["response_format"], json!("Json"));
    let input: Value = near_sdk::serde_json::from_str(v["input_data"].as_str().unwrap()).unwrap();
    assert_eq!(input["image_id"], json!(H3));
    assert_eq!(input["receipt_sha256"], json!(H2));
    assert_eq!(input["submission_id"], json!(c.get_submission_id(U64(0), idx).unwrap()));
    assert!(calls.iter().any(|(_, m, _, _)| m == "on_outlayer_result"));
}

#[test]
#[should_panic(expected = "the OutLayer account is not a registered verifier")]
fn request_needs_outlayer_registered() {
    let mut c = setup();
    call(owner(), T0 + SEC);
    c.set_outlayer(outlayer_config());
    let idx = commit_and_reveal(&mut c, T0 + 2 * SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    call(acc("anyone.testnet"), T0 + 11 * SEC);
    let _ = c.request_outlayer_check(U64(0), idx, "cmVjZWlwdA==".into());
}

#[test]
#[should_panic(expected = "only the owner can set OutLayer")]
fn only_owner_sets_outlayer() {
    let mut c = setup();
    call(acc("stranger.testnet"), T0 + SEC);
    c.set_outlayer(outlayer_config());
}

// ---------- S13 attack pass ----------

/// A second bounty (id 1) from another vendor, created closed (no Proof 0 attestations yet).
fn closed_bounty(c: &mut Contract) -> U64 {
    at(acc("vendor2.testnet"), T0, bounty_amount());
    c.create_bounty(H1.into(), H2.into(), H3.into(), H1.into(), H2.into(), 3, 1024, U64(GAP), U64(W), U64(A), U64(E), U128(FEE), U128(STEP), H3.into(), P0J.into(), U64(RW), 16, 32, None)
}

#[test]
#[should_panic(expected = "bounty is not open")]
fn s13_commit_before_proof0_rejected() {
    let mut c = setup();
    let id = closed_bounty(&mut c);
    call(researcher(), T0 + SEC);
    c.commit(id, fingerprint_hex(PATCH, &payout()), payout());
}

#[test]
#[should_panic(expected = "attestation does not match the bounty's Proof 0")]
fn s13_proof0_attestation_with_other_hashes_rejected() {
    let mut c = setup();
    let id = closed_bounty(&mut c);
    call(v1(), T0 + SEC);
    c.attest_proof0(id, H1.into(), H2.into());
}

#[test]
#[should_panic(expected = "caller is not a registered verifier")]
fn s13_unregistered_account_cannot_attest_proof0() {
    let mut c = setup();
    let id = closed_bounty(&mut c);
    call(acc("stranger.testnet"), T0 + SEC);
    c.attest_proof0(id, P0J.into(), H2.into());
}

#[test]
fn s13_same_verifier_twice_does_not_open_a_bounty() {
    let mut c = setup();
    let id = closed_bounty(&mut c);
    call(v1(), T0 + SEC);
    assert_eq!(c.attest_proof0(id, P0J.into(), H2.into()), "recorded");
    assert_eq!(c.attest_proof0(id, P0J.into(), H2.into()), "duplicate");
    assert!(!c.get_bounty(id).unwrap().opened);
}

#[test]
#[should_panic(expected = "reveal window has closed")]
fn s13_reveal_after_window_rejected() {
    let mut c = setup();
    call(researcher(), T0 + SEC);
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(researcher(), T0 + SEC + RW + 1);
    c.reveal(U64(0), idx, Base64VecU8(PATCH.to_vec()), NONCE.into());
}

#[test]
fn s13_unrevealed_junk_commits_can_be_released() {
    let mut c = setup();
    for i in 0..3u32 {
        call(acc(&format!("r{i}.testnet")), T0 + SEC);
        assert_eq!(c.commit(U64(0), fingerprint_hex(b"junk", &payout()), payout()), Some(i));
    }
    call(acc("r3.testnet"), T0 + SEC);
    assert_eq!(c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()), None, "K slots are full");
    call(acc("stranger.testnet"), T0 + SEC + RW + 1);
    assert_eq!(c.release_unrevealed(U64(0), 0), 2);
    assert_eq!(c.get_submission(U64(0), 0).unwrap().outcome, Outcome::Released);
    call(acc("r3.testnet"), T0 + SEC + RW + 2);
    assert_eq!(c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()), Some(3), "a freed slot can be used");
    assert_eq!(c.get_bounty(U64(0)).unwrap().active, 3);
}

#[test]
#[should_panic(expected = "reveal window has not closed")]
fn s13_release_before_window_rejected() {
    let mut c = setup();
    call(researcher(), T0 + SEC);
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(acc("stranger.testnet"), T0 + SEC + RW - 1);
    c.release_unrevealed(U64(0), idx);
}

#[test]
#[should_panic(expected = "a revealed submission cannot be released")]
fn s13_revealed_submission_cannot_be_released() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(acc("stranger.testnet"), T0 + SEC + RW + 1);
    c.release_unrevealed(U64(0), idx);
}

#[test]
fn s13_winner_fee_refunded_on_pass() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    call(v1(), T0 + 11 * SEC);
    c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    call(v2(), T0 + 12 * SEC);
    c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    assert_eq!(transfers(), vec![(payout(), bounty_amount().as_yoctonear() + FEE)]);
    assert_eq!(c.get_bounty(U64(0)).unwrap().fees_collected.0, 0);
}

#[test]
#[should_panic(expected = "bounty is closed")]
fn s13_timeout_after_final_pass_rejected() {
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    call(v1(), T0 + 11 * SEC);
    c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    call(v2(), T0 + 12 * SEC);
    c.attest(U64(0), idx, Verdict::Pass, H1.into(), H2.into());
    call(researcher(), T0 + 10 * SEC + A + W + 1);
    c.claim_timeout(U64(0), idx);
}

#[test]
fn s13_vendor_fail_without_attestations_times_out_and_pays() {
    // The vendor posts FAIL for a fix that passes; honest verifiers refuse to attest (their own receipt check
    // fails), so the verdict never becomes final and the timeout pays the researcher.
    let mut c = setup();
    let idx = commit_and_reveal(&mut c, T0 + SEC);
    call(vendor(), T0 + 10 * SEC);
    c.post_verdict(U64(0), idx, Verdict::Fail, H1.into(), H2.into());
    call(researcher(), T0 + 10 * SEC + A + 1);
    c.claim_timeout(U64(0), idx);
    assert_eq!(transfers(), vec![(payout(), bounty_amount().as_yoctonear() + FEE)]);
    assert_eq!(c.get_submission(U64(0), idx).unwrap().outcome, Outcome::TimedOut);
}

// Audit round 1, fix 1: windows are capped and every commit and reveal must leave time for a decision before expiry.
#[test]
#[should_panic(expected = "a window may be at most 30 days")]
fn audit_f3_unbounded_attest_window_is_refused() {
    call(owner(), T0 - 10);
    let mut c = Contract::new(owner());
    at(vendor(), T0, bounty_amount());
    c.create_bounty(H1.into(), H2.into(), H3.into(), H1.into(), H2.into(), 3, 1024, U64(GAP), U64(W), U64(u64::MAX), U64(E), U128(FEE), U128(STEP), H3.into(), P0J.into(), U64(RW), 16, 32, None);
}

#[test]
#[should_panic(expected = "expiry_ns must cover")]
fn audit_f3_expiry_shorter_than_the_windows_is_refused() {
    call(owner(), T0 - 10);
    let mut c = Contract::new(owner());
    at(vendor(), T0, bounty_amount());
    c.create_bounty(H1.into(), H2.into(), H3.into(), H1.into(), H2.into(), 3, 1024, U64(GAP), U64(W), U64(A), U64(W), U128(FEE), U128(STEP), H3.into(), P0J.into(), U64(RW), 16, 32, None);
}

#[test]
#[should_panic(expected = "too close to expiry: a commit")]
fn audit_f1_commit_that_cannot_be_decided_before_expiry_is_refused() {
    let mut c = setup();
    call(researcher(), T0 + E - RW - W + 1); // one nanosecond too late for reveal window + verdict window
    c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout());
}

#[test]
#[should_panic(expected = "too close to expiry: a reveal")]
fn audit_f1_reveal_that_leaves_less_than_a_verdict_window_is_refused() {
    let mut c = setup();
    call(researcher(), T0 + E - RW - W); // the last moment a commit is allowed
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(researcher(), T0 + E - W + 1); // inside the reveal window, but less than a verdict window before expiry
    c.reveal(U64(0), idx, Base64VecU8(PATCH.to_vec()), NONCE.into());
}

#[test]
fn audit_f1_every_reveal_leaves_a_full_verdict_window_before_expiry() {
    let mut c = setup();
    call(researcher(), T0 + E - RW - W);
    let idx = c.commit(U64(0), fingerprint_hex(PATCH, &payout()), payout()).unwrap();
    call(researcher(), T0 + E - W); // the last moment a reveal is allowed: its verdict window ends exactly at expiry
    c.reveal(U64(0), idx, Base64VecU8(PATCH.to_vec()), NONCE.into());
    assert_eq!(c.get_submission(U64(0), idx).unwrap().revealed_at_ns, Some(U64(T0 + E - W)));
}
