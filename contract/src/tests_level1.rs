//! Unit tests for Level 1: a bounty that opens and settles through OutLayer running the pinned verifier program. They
//! use the same real journals as the Level 2 tests (bound to kintsugi-l2-cihdp.testnet, bounty 1) and stand in for
//! OutLayer's answer, which the contract only ever receives as the result of its own request.
use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::testing_env;

#[allow(dead_code)]
#[path = "groth16_test_vectors.rs"]
mod v;
#[allow(dead_code)]
#[path = "groth16_attempt_vectors.rs"]
mod va;

const SEC: u64 = 1_000_000_000;
const T0: u64 = 1_000 * SEC;
const NONCE: &str = "abababababababababababababababababababababababababababababababab";
const FIXED: &[u8] = include_bytes!("../../data/demo/fixed.wasm");
const REJECT_ALL: &[u8] = include_bytes!("../../data/attacks/reject_all.wasm");
const PROGRAM_SHA: &str = "e60647ec50f76f591a6994963f1394d408f516947f2fe927e389daf2166346a8";
const RECEIPT_SHA: &str = "8c316bd514edb018d5f06f61f1408c76464b3c767c667623f60d33744446cbbf";
const FEE: u128 = 10_000_000_000_000_000_000_000;

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
/// The contract itself, as when NEAR runs its own callback.
fn as_callback(ts: u64) {
    call(va::CONTRACT, ts);
}
fn config() -> OutLayerConfig {
    OutLayerConfig {
        account_id: acc("outlayer.testnet"),
        wasm_url: format!("https://raw.githubusercontent.com/pgreyy/skarbnik/0000000000000000000000000000000000000000/verifier/farbox-verifier.wasm"),
        wasm_sha256: PROGRAM_SHA.into(),
        build_target: "wasm32-wasip1".into(),
        max_instructions: U64(2_000_000_000),
        max_memory_mb: 64,
        max_execution_seconds: U64(20),
        min_deposit: U128(NearToken::from_millinear(2800).as_yoctonear()),
    }
}
fn deposit() -> NearToken {
    NearToken::from_near(3)
}
fn create(c: &mut Contract, level: u8) -> U64 {
    at("vendor.testnet", T0, NearToken::from_near(1), [0; 32]);
    c.create_bounty(
        v::ORIGINAL.into(), v::CORPUS.into(), v::IMAGE_ID.into(), v::EXPLOIT.into(), "00".repeat(32), 3, 1024,
        U64(2 * SEC), U64(600 * SEC), U64(300 * SEC), U64(3600 * SEC), U128(FEE), U128(0),
        v::REFERENCE_FIX.into(), v::JOURNAL_SHA256.into(), U64(120 * SEC), 16, 32, Some(level), None,
    )
}
/// OutLayer's answer as the pinned verifier program prints it.
fn answer(ok: bool, verdict: &str, sid: &str, journal: &Base64VecU8, receipt: &str) -> Result<Option<Value>, PromiseError> {
    Ok(Some(json!({
        "ok": ok, "verdict": if ok { json!(verdict) } else { Value::Null }, "image_id": v::IMAGE_ID, "submission_id": sid,
        "receipt_sha256": receipt, "journal_sha256": to_hex(&env::sha256_array(&journal.0)), "error": Value::Null,
    })))
}
fn proof0_sid() -> String {
    to_hex(&proof0_id(&hex32(v::REFERENCE_FIX)))
}

/// The testnet state of bounty 1 rebuilt at Level 1: OutLayer set, dummy bounty 0, bounty 1 opened through OutLayer
/// with the real Proof 0 journal, attempt 0 (fixed.wasm, res1) and attempt 1 (reject_all.wasm, res2) revealed with
/// the recorded seeds.
fn level1_bounty_1() -> Contract {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    call(va::CONTRACT, T0 - 5);
    c.set_outlayer(config());
    for _ in 0..2 {
        create(&mut c, LEVEL_1);
    }
    at("vendor.testnet", T0 + SEC, deposit(), [0; 32]);
    let _ = c.open_with_outlayer(U64(va::BOUNTY), "cmVjZWlwdA==".into(), RECEIPT_SHA.into(), bytes(v::JOURNAL));
    as_callback(T0 + SEC + 1);
    assert_eq!(c.on_outlayer_open(U64(va::BOUNTY), answer(true, "PASS", &proof0_sid(), &bytes(v::JOURNAL), RECEIPT_SHA)), "opened");
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

fn sid(c: &Contract, index: u32) -> String {
    c.get_submission_id(U64(va::BOUNTY), index).unwrap()
}
/// Asks a check of `index` as the vendor at `ts` with the journal given.
fn ask(c: &mut Contract, index: u32, journal: &str, ts: u64) {
    at("vendor.testnet", ts, deposit(), [0; 32]);
    let _ = c.check_with_outlayer(U64(va::BOUNTY), index, "cmVjZWlwdA==".into(), RECEIPT_SHA.into(), bytes(journal));
}
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
fn calls() -> Vec<(AccountId, String, String, u128)> {
    get_created_receipts()
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
        .collect()
}

#[test]
fn l1_valid_pass_is_paid_like_level_2() {
    let mut c = level1_bounty_1();
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 20 * SEC);
    as_callback(T0 + 25 * SEC);
    let r = c.on_outlayer_check(U64(va::BOUNTY), 0, answer(true, "PASS", &sid(&c, 0), &bytes(va::JOURNAL_A0), RECEIPT_SHA));
    assert_eq!(r, "final_pass");
    assert_eq!(transfers(), vec![(acc("res1.testnet"), NearToken::from_near(1).as_yoctonear() + FEE)]);
    let b = c.get_bounty(U64(va::BOUNTY)).unwrap();
    assert_eq!((b.state, b.winner, b.pending, b.level), (BountyState::Paid, Some(0), 0, LEVEL_1));
    assert!(c.get_outlayer_check(U64(va::BOUNTY), Some(0)).is_none());
}

#[test]
fn l1_fail_spends_the_attempt() {
    let mut c = level1_bounty_1();
    ask(&mut c, 1, va::JOURNAL_A1, T0 + 20 * SEC);
    as_callback(T0 + 25 * SEC);
    let r = c.on_outlayer_check(U64(va::BOUNTY), 1, answer(true, "FAIL", &sid(&c, 1), &bytes(va::JOURNAL_A1), RECEIPT_SHA));
    assert_eq!(r, "final_fail");
    assert!(transfers().is_empty());
    assert_eq!(c.get_submission(U64(va::BOUNTY), 1).unwrap().outcome, Outcome::Failed);
    assert_eq!(c.get_bounty(U64(va::BOUNTY)).unwrap().state, BountyState::Open);
}

#[test]
#[should_panic(expected = "the journal belongs to another bounty or attempt (submission id)")]
fn l1_the_same_journal_is_refused_on_another_bounty() {
    let mut c = level1_bounty_1();
    // Bounty 0 at Level 1 with the same attempt (same patch, payout and seed): only the submission id differs.
    at("vendor.testnet", T0 + SEC, deposit(), [0; 32]);
    let _ = c.open_with_outlayer(U64(0), "cmVjZWlwdA==".into(), RECEIPT_SHA.into(), bytes(v::JOURNAL));
    as_callback(T0 + SEC + 1);
    c.on_outlayer_open(U64(0), answer(true, "PASS", &proof0_sid(), &bytes(v::JOURNAL), RECEIPT_SHA));
    at("res1.testnet", T0 + 5 * SEC, NearToken::from_yoctonear(0), [0; 32]);
    let fp = to_hex(&commit_fingerprint(FIXED, &acc("res1.testnet"), &hex32(NONCE)));
    c.commit(U64(0), fp, acc("res1.testnet")).unwrap();
    at("res1.testnet", T0 + 15 * SEC, NearToken::from_yoctonear(0), hex32(va::SEED_A0));
    c.reveal(U64(0), 0, Base64VecU8(FIXED.to_vec()), NONCE.into());
    at("vendor.testnet", T0 + 20 * SEC, deposit(), [0; 32]);
    let _ = c.check_with_outlayer(U64(0), 0, "cmVjZWlwdA==".into(), RECEIPT_SHA.into(), bytes(va::JOURNAL_A0));
}

#[test]
#[should_panic(expected = "the journal belongs to another bounty or attempt (submission id)")]
fn l1_the_journal_of_attempt_1_is_refused_for_attempt_0() {
    let mut c = level1_bounty_1();
    ask(&mut c, 0, va::JOURNAL_A1, T0 + 20 * SEC);
}

#[test]
#[should_panic(expected = "the journal is not this bounty's Proof 0 journal")]
fn l1_an_attempt_journal_is_refused_as_proof0() {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    call(va::CONTRACT, T0 - 5);
    c.set_outlayer(config());
    create(&mut c, LEVEL_1);
    at("vendor.testnet", T0 + SEC, deposit(), [0; 32]);
    let _ = c.open_with_outlayer(U64(0), "cmVjZWlwdA==".into(), RECEIPT_SHA.into(), bytes(va::JOURNAL_A0));
}

#[test]
fn l1_a_tampered_receipt_answer_records_nothing() {
    let mut c = level1_bounty_1();
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 20 * SEC);
    as_callback(T0 + 25 * SEC);
    // The program found the receipt invalid: ok false.
    let r = c.on_outlayer_check(U64(va::BOUNTY), 0, answer(false, "PASS", &sid(&c, 0), &bytes(va::JOURNAL_A0), RECEIPT_SHA));
    assert_eq!(r, "rejected: answer is not ok");
    let s = c.get_submission(U64(va::BOUNTY), 0).unwrap();
    assert_eq!((s.outcome, s.verdict), (Outcome::Open, None));
    assert!(transfers().is_empty());
    assert!(c.get_outlayer_check(U64(va::BOUNTY), Some(0)).is_none());
}

#[test]
fn l1_an_answer_that_echoes_other_values_records_nothing() {
    let other = "11".repeat(32);
    for (k, want) in [("receipt_sha256", "rejected: receipt_sha256 differs"), ("journal_sha256", "rejected: journal_sha256 differs"),
        ("image_id", "rejected: image_id differs"), ("submission_id", "rejected: submission_id differs"), ("verdict", "rejected: verdict differs from the journal's")]
    {
        let mut c = level1_bounty_1();
        ask(&mut c, 0, va::JOURNAL_A0, T0 + 20 * SEC);
        let mut a = answer(true, "PASS", &sid(&c, 0), &bytes(va::JOURNAL_A0), RECEIPT_SHA).unwrap().unwrap();
        a[k] = if k == "verdict" { json!("FAIL") } else { json!(other) };
        as_callback(T0 + 25 * SEC);
        assert_eq!(c.on_outlayer_check(U64(va::BOUNTY), 0, Ok(Some(a))), want);
        assert_eq!(c.get_submission(U64(va::BOUNTY), 0).unwrap().outcome, Outcome::Open);
    }
}

#[test]
fn l1_the_request_carries_only_the_pinned_program_and_refunds_the_asker() {
    let mut c = level1_bounty_1();
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 20 * SEC);
    let calls = calls();
    let (to, method, args, dep) = &calls[0];
    assert_eq!((to, method.as_str(), *dep), (&acc("outlayer.testnet"), "request_execution", deposit().as_yoctonear()));
    let v: Value = near_sdk::serde_json::from_str(args).unwrap();
    assert_eq!(v["source"]["WasmUrl"]["hash"], json!(PROGRAM_SHA));
    assert_eq!(v["source"]["WasmUrl"]["url"], json!(config().wasm_url));
    assert_eq!(v["payer_account_id"], json!("vendor.testnet"));
    let input: Value = near_sdk::serde_json::from_str(v["input_data"].as_str().unwrap()).unwrap();
    assert_eq!(input["image_id"], json!(v::IMAGE_ID));
    assert_eq!(input["submission_id"], json!(sid(&c, 0)));
    assert_eq!(input["receipt_sha256"], json!(RECEIPT_SHA));
    assert!(calls.iter().any(|(_, m, _, _)| m == "on_outlayer_check"));
}

#[test]
#[should_panic(expected = "wasm_url must be https")]
fn l1_a_program_not_on_https_is_refused() {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    c.set_outlayer(OutLayerConfig { wasm_url: "http://example.invalid/v.wasm".into(), ..config() });
}

#[test]
#[should_panic(expected = "wasm_sha256 must be 64 hex characters")]
fn l1_a_program_without_a_full_hash_is_refused() {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    c.set_outlayer(OutLayerConfig { wasm_sha256: "abcd".into(), ..config() });
}

#[test]
#[should_panic(expected = "only the owner can set OutLayer")]
fn l1_only_the_owner_pins_the_program() {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    call("stranger.testnet", T0);
    c.set_outlayer(config());
}

#[test]
#[should_panic(expected = "on_outlayer_check is private")]
fn l1_a_callback_from_anyone_else_is_refused() {
    let mut c = level1_bounty_1();
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 20 * SEC);
    call("mallory.testnet", T0 + 25 * SEC);
    let a = answer(true, "PASS", &sid(&c, 0), &bytes(va::JOURNAL_A0), RECEIPT_SHA);
    c.on_outlayer_check(U64(va::BOUNTY), 0, a);
}

#[test]
#[should_panic(expected = "on_outlayer_open is private")]
fn l1_an_open_callback_from_anyone_else_is_refused() {
    let mut c = level1_bounty_1();
    call("mallory.testnet", T0 + 25 * SEC);
    c.on_outlayer_open(U64(0), answer(true, "PASS", &proof0_sid(), &bytes(v::JOURNAL), RECEIPT_SHA));
}

#[test]
fn l1_an_answer_with_no_check_waiting_records_nothing() {
    let mut c = level1_bounty_1();
    as_callback(T0 + 25 * SEC);
    let r = c.on_outlayer_check(U64(va::BOUNTY), 0, answer(true, "PASS", &sid(&c, 0), &bytes(va::JOURNAL_A0), RECEIPT_SHA));
    assert_eq!(r, "rejected: no check is waiting");
    assert_eq!(c.get_submission(U64(va::BOUNTY), 0).unwrap().outcome, Outcome::Open);
}

#[test]
#[should_panic(expected = "a check of this attempt is already waiting for OutLayer")]
fn l1_a_second_request_while_one_waits_is_refused() {
    let mut c = level1_bounty_1();
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 20 * SEC);
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 21 * SEC);
}

#[test]
fn l1_a_waiting_check_is_visible_with_its_asker() {
    let mut c = level1_bounty_1();
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 20 * SEC);
    let w = c.get_outlayer_check(U64(va::BOUNTY), Some(0)).unwrap();
    assert_eq!((w.asker, w.deposit.0, w.verdict, w.requested_at_ns.0), (acc("vendor.testnet"), deposit().as_yoctonear(), Verdict::Pass, T0 + 20 * SEC));
    assert_eq!(w.journal_hash, to_hex(&env::sha256_array(&bytes(va::JOURNAL_A0).0)));
}

#[test]
fn l1_a_refused_request_returns_the_deposit_to_the_asker() {
    let mut c = level1_bounty_1();
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 20 * SEC);
    as_callback(T0 + 21 * SEC);
    let r = c.on_outlayer_check(U64(va::BOUNTY), 0, Err(PromiseError::Failed));
    assert_eq!(r, "rejected: OutLayer refused the request; the deposit was returned to the asker");
    assert_eq!(transfers(), vec![(acc("vendor.testnet"), deposit().as_yoctonear())]);
    assert!(c.get_outlayer_check(U64(va::BOUNTY), Some(0)).is_none());
}

#[test]
fn l1_no_answer_records_nothing_and_the_timeout_rule_still_pays() {
    let mut c = level1_bounty_1();
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 20 * SEC);
    as_callback(T0 + 30 * SEC);
    // OutLayer ran the job and it failed or timed out: it refunded the asker itself and the answer is empty.
    assert_eq!(c.on_outlayer_check(U64(va::BOUNTY), 0, Ok(None)), "rejected: no answer from OutLayer");
    assert!(transfers().is_empty());
    // After both verdict windows, attempt 0 (revealed first) is timed out with attempt 1: the bounty is split.
    call("anyone.testnet", T0 + 700 * SEC);
    c.claim_timeout(U64(va::BOUNTY), 0);
    let b = c.get_bounty(U64(va::BOUNTY)).unwrap();
    assert_eq!(b.state, BountyState::Paid);
    assert_eq!(c.get_submission(U64(va::BOUNTY), 0).unwrap().outcome, Outcome::TimedOut);
}

#[test]
fn l1_an_answer_after_a_timeout_claim_records_nothing() {
    let mut c = level1_bounty_1();
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 600 * SEC);
    call("anyone.testnet", T0 + 700 * SEC);
    c.claim_timeout(U64(va::BOUNTY), 0);
    as_callback(T0 + 701 * SEC);
    let r = c.on_outlayer_check(U64(va::BOUNTY), 0, answer(true, "PASS", &sid(&c, 0), &bytes(va::JOURNAL_A0), RECEIPT_SHA));
    assert_eq!(r, "rejected: the bounty or the attempt was decided while OutLayer worked");
}

#[test]
#[should_panic(expected = "verdict window has closed")]
fn l1_a_check_after_the_verdict_window_is_refused() {
    let mut c = level1_bounty_1();
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 700 * SEC);
}

#[test]
#[should_panic(expected = "attach at least min_deposit")]
fn l1_a_request_below_the_minimum_deposit_is_refused() {
    let mut c = level1_bounty_1();
    at("vendor.testnet", T0 + 20 * SEC, NearToken::from_millinear(100), [0; 32]);
    let _ = c.check_with_outlayer(U64(va::BOUNTY), 0, "cmVjZWlwdA==".into(), RECEIPT_SHA.into(), bytes(va::JOURNAL_A0));
}

#[test]
#[should_panic(expected = "Level 1 needs the OutLayer settings")]
fn l1_a_level_1_bounty_needs_the_outlayer_settings() {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    create(&mut c, LEVEL_1);
}

#[test]
#[should_panic(expected = "level must be 0, 1 or 2")]
fn l1_level_3_is_refused() {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    create(&mut c, 3);
}

#[test]
#[should_panic(expected = "this is a Level 1 bounty")]
fn l1_a_groth16_proof_is_refused_on_a_level_1_bounty() {
    let mut c = level1_bounty_1();
    call("anyone.testnet", T0 + 20 * SEC);
    c.submit_groth16(U64(va::BOUNTY), 0, bytes(va::SEAL_A0), bytes(va::JOURNAL_A0));
}

#[test]
#[should_panic(expected = "this is a Level 1 bounty")]
fn l1_a_posted_verdict_is_refused_on_a_level_1_bounty() {
    let mut c = level1_bounty_1();
    call("vendor.testnet", T0 + 20 * SEC);
    c.post_verdict(U64(va::BOUNTY), 0, Verdict::Pass, "11".repeat(32), "22".repeat(32));
}

#[test]
#[should_panic(expected = "this is a Level 2 bounty")]
fn l1_the_outlayer_check_is_refused_on_a_level_2_bounty() {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    call(va::CONTRACT, T0 - 5);
    c.set_outlayer(config());
    create(&mut c, LEVEL_2);
    at("vendor.testnet", T0 + SEC, deposit(), [0; 32]);
    let _ = c.open_with_outlayer(U64(0), "cmVjZWlwdA==".into(), RECEIPT_SHA.into(), bytes(v::JOURNAL));
}

#[test]
#[should_panic(expected = "this is a Level 0 bounty")]
fn l1_the_outlayer_check_is_refused_on_a_level_0_bounty() {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    call(va::CONTRACT, T0 - 5);
    c.set_outlayer(config());
    create(&mut c, LEVEL_0);
    at("vendor.testnet", T0 + SEC, deposit(), [0; 32]);
    let _ = c.open_with_outlayer(U64(0), "cmVjZWlwdA==".into(), RECEIPT_SHA.into(), bytes(v::JOURNAL));
}

#[test]
fn l1_fees_of_decided_attempts_go_to_the_protocol_pool() {
    let mut c = level1_bounty_1();
    ask(&mut c, 1, va::JOURNAL_A1, T0 + 20 * SEC);
    as_callback(T0 + 25 * SEC);
    c.on_outlayer_check(U64(va::BOUNTY), 1, answer(true, "FAIL", &sid(&c, 1), &bytes(va::JOURNAL_A1), RECEIPT_SHA));
    ask(&mut c, 0, va::JOURNAL_A0, T0 + 30 * SEC);
    as_callback(T0 + 35 * SEC);
    c.on_outlayer_check(U64(va::BOUNTY), 0, answer(true, "PASS", &sid(&c, 0), &bytes(va::JOURNAL_A0), RECEIPT_SHA));
    let before = c.get_protocol_pool().0;
    call("anyone.testnet", T0 + 3700 * SEC);
    c.expire(U64(va::BOUNTY));
    // Attempt 1's fee (spent by FAIL) goes to the pool; attempt 0's fee went back to its winner.
    assert_eq!(c.get_protocol_pool().0, before + FEE);
}

#[test]
fn l1_a_bounty_does_not_open_on_an_answer_that_is_not_ok() {
    call(va::CONTRACT, T0 - 10);
    let mut c = Contract::new(acc(va::CONTRACT));
    call(va::CONTRACT, T0 - 5);
    c.set_outlayer(config());
    create(&mut c, LEVEL_1);
    at("vendor.testnet", T0 + SEC, deposit(), [0; 32]);
    let _ = c.open_with_outlayer(U64(0), "cmVjZWlwdA==".into(), RECEIPT_SHA.into(), bytes(v::JOURNAL));
    as_callback(T0 + 2 * SEC);
    let r = c.on_outlayer_open(U64(0), answer(false, "PASS", &proof0_sid(), &bytes(v::JOURNAL), RECEIPT_SHA));
    assert_eq!(r, "rejected: answer is not ok");
    assert!(!c.get_bounty(U64(0)).unwrap().opened);
}
