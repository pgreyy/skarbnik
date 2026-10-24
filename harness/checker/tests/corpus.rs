// Tests for spike S1: runs the checker on the honest patch and on every cheating patch in
// data/attacks/ (listed with its expected verdict in data/attacks/manifest.txt), plus Proof 0,
// determinism and the role of each check. Run: cargo test -p kintsugi-check

use kintsugi_check::{
    check, check_report, gen, proof0_report, text, Bounty, Limits, Loaded, Outcome, Reason,
    Round, TestCase, Verdict,
};
use std::path::PathBuf;

fn data(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data").join(rel)
}

fn bytes(rel: &str) -> Vec<u8> {
    std::fs::read(data(rel)).unwrap_or_else(|e| panic!("read {rel}: {e}"))
}

struct Fixture {
    original: Vec<u8>,
    exploit: Vec<u8>,
    tests: Vec<TestCase>,
}

impl Fixture {
    fn new() -> Fixture {
        let exploit_hex = String::from_utf8(bytes("demo/exploit.hex")).unwrap();
        let tests_txt = String::from_utf8(bytes("demo/public_tests.txt")).unwrap();
        Fixture {
            original: bytes("demo/original.wasm"),
            exploit: text::parse_hex(&exploit_hex).unwrap(),
            tests: text::parse_tests(&tests_txt).unwrap(),
        }
    }
    fn bounty(&self) -> Bounty<'_> {
        Bounty { original: &self.original, exploit: &self.exploit, public_tests: &self.tests }
    }
}

fn round(seed_byte: u8) -> Round {
    Round { fuzz_seed: [seed_byte; 32], fuzz_count: 64, variant_count: 32 }
}

/// (path relative to data/, expected verdict) for every manifest line.
fn manifest() -> Vec<(String, Verdict)> {
    let txt = String::from_utf8(bytes("attacks/manifest.txt")).unwrap();
    txt.lines()
        .filter_map(|l| {
            let l = l.split('#').next().unwrap().trim();
            let mut p = l.split_whitespace();
            let (file, exp) = (p.next()?, p.next()?);
            let v = if exp == "PASS" { Verdict::Pass } else { Verdict::Fail };
            Some((format!("attacks/{file}"), v))
        })
        .collect()
}

/// Cheats that turned out to PASS, kept visible instead of removed. See
/// docs/evidence/S1/RESULTS.md: memory_grow asks for more memory, but its own declared maximum
/// makes the request return -1 (normal WebAssembly behaviour, not a crash), so it never gets or
/// uses the memory and behaves exactly like the honest fix.
const KNOWN_FINDINGS: &[&str] = &["attacks/memory_grow.wasm"];

#[test]
fn manifest_has_honest_patch_and_at_least_eight_cheats() {
    let m = manifest();
    assert_eq!(m.iter().filter(|(_, v)| *v == Verdict::Pass).count(), 1);
    assert!(m.iter().filter(|(_, v)| *v == Verdict::Fail).count() >= 8);
}

#[test]
fn every_module_gets_its_expected_verdict_on_three_seeds() {
    let fx = Fixture::new();
    let mut wrong = Vec::new();
    for seed in [1u8, 2, 3] {
        for (file, expected) in manifest() {
            let got = check(&bytes(&file), &fx.bounty(), &round(seed), &Limits::default());
            let want = if KNOWN_FINDINGS.contains(&file.as_str()) { Verdict::Pass } else { expected };
            if got != want {
                wrong.push(format!("seed {seed}: {file}: expected {want:?}, got {got:?}"));
            }
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}

#[test]
fn finding_memory_grow_refused_by_its_own_maximum_passes() {
    let fx = Fixture::new();
    let rep = check_report(&bytes("attacks/memory_grow.wasm"), &fx.bounty(), &round(1), &Limits::default());
    assert_eq!(rep.verdict, Verdict::Pass);
    // The two variants that really try to use the memory do fail.
    for f in ["attacks/memory_grow_use.wasm", "attacks/memory_grow_nomax.wasm"] {
        let rep = check_report(&bytes(f), &fx.bounty(), &round(1), &Limits::default());
        assert!(matches!(rep.reason, Some(Reason::ExploitStillFails(_))), "{f}: {rep:?}");
    }
}

#[test]
fn honest_patch_passes_on_twenty_seeds() {
    let fx = Fixture::new();
    let fixed = bytes("demo/fixed.wasm");
    for seed in 0u8..20 {
        let rep = check_report(&fixed, &fx.bounty(), &round(seed), &Limits::default());
        assert_eq!(rep.verdict, Verdict::Pass, "seed {seed}: {rep:?}");
    }
}

#[test]
fn each_cheat_fails_at_the_step_meant_to_catch_it() {
    let fx = Fixture::new();
    let cases = [
        ("demo/original.wasm", "2 exploit"),
        ("attacks/wrong_fix.wasm", "2 exploit"),
        ("attacks/loop_forever.wasm", "2 exploit"),
        ("attacks/memory_grow_use.wasm", "2 exploit"),
        ("attacks/memory_grow_nomax.wasm", "2 exploit"),
        ("attacks/reject_all.wasm", "3 public tests"),
        ("attacks/constant.wasm", "3 public tests"),
        ("attacks/memorize_tests.wasm", "4 fairness"),
        ("attacks/subtle_change.wasm", "4 fairness"),
        ("attacks/overbroad_fix.wasm", "4 fairness"),
        ("attacks/special_case_exploit.wasm", "5 variants"),
        ("attacks/memory_declared.wasm", "1 validate"),
        ("attacks/wrong_export.wasm", "1 validate"),
        ("attacks/imports_host.wasm", "1 validate"),
        ("attacks/too_large.wasm", "1 validate"),
        ("attacks/invalid_truncated.wasm", "1 validate"),
    ];
    for (file, step) in cases {
        let rep = check_report(&bytes(file), &fx.bounty(), &round(1), &Limits::default());
        assert_eq!(rep.verdict, Verdict::Fail, "{file}");
        assert_eq!(rep.reason.as_ref().unwrap().step(), step, "{file}: {rep:?}");
    }
    // The endless loop is stopped by the fuel limit, not by a crash.
    let rep = check_report(&bytes("attacks/loop_forever.wasm"), &fx.bounty(), &round(1), &Limits::default());
    assert!(matches!(
        rep.reason,
        Some(Reason::ExploitStillFails(Outcome::Trapped { out_of_fuel: true, .. }))
    ));
}

#[test]
fn special_case_cheat_passes_if_the_variant_step_is_off() {
    // Shows why step 5 exists: without it, recognising the exact secret bytes is enough.
    let fx = Fixture::new();
    let mut r = round(1);
    r.variant_count = 0;
    let v = check(&bytes("attacks/special_case_exploit.wasm"), &fx.bounty(), &r, &Limits::default());
    assert_eq!(v, Verdict::Pass);
}

#[test]
fn memorized_tests_cheat_passes_only_if_both_seeded_steps_are_off() {
    // Shows why the seeded steps exist: without steps 4 and 5, a lookup table of the public
    // tests is enough. Step 5 alone also catches it, because most variants of the secret input
    // do not crash the original, so the candidate must match the original's answer on them.
    let fx = Fixture::new();
    let m = bytes("attacks/memorize_tests.wasm");
    let mut r = round(1);
    r.fuzz_count = 0;
    r.variant_count = 0;
    assert_eq!(check(&m, &fx.bounty(), &r, &Limits::default()), Verdict::Pass);
    r.variant_count = 32;
    let rep = check_report(&m, &fx.bounty(), &r, &Limits::default());
    assert_eq!(rep.reason.as_ref().map(|x| x.step()), Some("5 variants"), "{rep:?}");
}

#[test]
fn proof0_accepts_the_original_and_rejects_a_module_that_does_not_crash() {
    let fx = Fixture::new();
    assert_eq!(proof0_report(&fx.bounty(), &Limits::default()).verdict, Verdict::Pass);
    let fixed = bytes("demo/fixed.wasm");
    let fake = Bounty { original: &fixed, exploit: &fx.exploit, public_tests: &fx.tests };
    let rep = proof0_report(&fake, &Limits::default());
    assert!(matches!(rep.reason, Some(Reason::OriginalDoesNotCrash(_))), "{rep:?}");
    // A "crash" that is only an endless loop does not count either.
    let looping = bytes("attacks/loop_forever.wasm");
    let fake = Bounty { original: &looping, exploit: &fx.exploit, public_tests: &fx.tests };
    let rep = proof0_report(&fake, &Limits::default());
    assert_eq!(rep.reason, Some(Reason::OriginalOnlyRanOutOfFuel));
}

#[test]
fn same_inputs_give_the_same_report() {
    let fx = Fixture::new();
    for file in ["demo/fixed.wasm", "attacks/subtle_change.wasm", "attacks/special_case_exploit.wasm"] {
        let m = bytes(file);
        let a = check_report(&m, &fx.bounty(), &round(9), &Limits::default());
        let b = check_report(&m, &fx.bounty(), &round(9), &Limits::default());
        assert_eq!(a, b, "{file}");
    }
}

#[test]
fn fairness_inputs_are_mostly_well_formed_for_the_original() {
    let fx = Fixture::new();
    let original = Loaded::load(&fx.original, &Limits::default()).unwrap();
    let inputs = gen::fairness_inputs(&[5u8; 32], 1000, 256);
    let ok = inputs
        .iter()
        .filter(|i| matches!(original.run(i).outcome, Outcome::Returned(v) if v >= 0))
        .count();
    assert!(ok >= 700, "only {ok} of 1000 fairness inputs were accepted by the original");
}

// ---------- S13 attack 1: an unfixable bounty ----------

/// Before the S13 guard, a secret input longer than any module may receive made every run report a trap,
/// so Proof 0 passed and no patch could ever pass. Now Proof 0 refuses it.
#[test]
fn s13_overlong_exploit_is_refused_by_proof0() {
    let f = Fixture::new();
    let long = vec![0x03u8; Limits::default().max_input_len + 44];
    let b = Bounty { original: &f.original, exploit: &long, public_tests: &f.tests };
    let rep = proof0_report(&b, &Limits::default());
    assert_eq!(rep.verdict, Verdict::Fail);
    assert_eq!(rep.reason, Some(Reason::ExploitTooLong { len: long.len(), max: Limits::default().max_input_len }));
    // The attack it stops: with such a secret even the honest fix fails the check.
    assert_eq!(check(&bytes("demo/fixed.wasm"), &b, &round(7), &Limits::default()), Verdict::Fail);
}

#[test]
fn s13_proof0_with_reference_fix_passes_for_the_honest_fix() {
    let f = Fixture::new();
    let rep = kintsugi_check::proof0_with_reference(&f.bounty(), &round(7), &Limits::default(), &bytes("demo/fixed.wasm"));
    assert_eq!(rep.verdict, Verdict::Pass, "{:?}", rep.reason);
}

#[test]
fn s13_proof0_with_reference_fix_refuses_a_fix_that_does_not_fix() {
    let f = Fixture::new();
    let rep = kintsugi_check::proof0_with_reference(&f.bounty(), &round(7), &Limits::default(), &bytes("demo/original.wasm"));
    assert_eq!(rep.verdict, Verdict::Fail);
    assert!(matches!(rep.reason, Some(Reason::ReferenceFixFails(_))));
}
