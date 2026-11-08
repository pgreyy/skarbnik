//! The output checker corpus (data/attacks/output/manifest.txt): every module gives its expected verdict on three
//! seeds, with the public demo secret and data/feecalc/fixed.wasm as the reference fix; Proof 0 passes; the variants
//! alone catch the patch that special cases the secret, and the fairness inputs catch the others.
use std::path::PathBuf;

use kintsugi_check::{text, Limits, Round, Verdict};
use kintsugi_check_output::{check_report, proof0_report, OutputBounty, Reason};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn read(p: &str) -> Vec<u8> {
    std::fs::read(root().join(p)).unwrap_or_else(|e| panic!("{p}: {e}"))
}
fn round(seed: u8, fuzz: u32) -> Round {
    Round { fuzz_seed: [seed; 32], fuzz_count: fuzz, variant_count: 64 }
}

#[test]
fn corpus_gives_the_expected_verdicts() {
    let original = read("data/feecalc/original.wasm");
    let fix = read("data/feecalc/fixed.wasm");
    let tests = text::parse_tests(&String::from_utf8(read("data/feecalc/public_tests.txt")).unwrap()).unwrap();
    let secret = text::parse_tests(&String::from_utf8(read("data/attacks/output/demo_secret.txt")).unwrap()).unwrap().remove(0);
    let bounty = OutputBounty { original: &original, secret_input: &secret.input, expected: secret.expected, reference_fix: &fix, public_tests: &tests };
    let manifest = String::from_utf8(read("data/attacks/output/manifest.txt")).unwrap();
    for seed in [0u8, 7, 201] {
        assert_eq!(proof0_report(&bounty, &round(seed, 64), &Limits::default()).verdict, Verdict::Pass, "proof 0, seed {seed}");
        for line in manifest.lines().map(|l| l.split('#').next().unwrap().trim()).filter(|l| !l.is_empty()) {
            let mut parts = line.split_whitespace();
            let (path, want) = (parts.next().unwrap(), parts.next().unwrap());
            let module = read(&format!("data/attacks/output/{path}"));
            let got = check_report(&module, &bounty, &round(seed, 64), &Limits::default());
            assert_eq!(got.verdict.as_str(), want, "{path}, seed {seed}: {:?}", got.reason);
        }
    }
    // the variants alone catch the patch that special cases the secret
    let cheat = read("data/attacks/output/special_case_secret.wasm");
    let r = check_report(&cheat, &bounty, &round(0, 0), &Limits::default());
    assert!(matches!(r.reason, Some(Reason::VariantMismatch { .. })), "{:?}", r.reason);
    // the original is wrong on the secret, so Proof 0 with the original as its own fix fails
    let unfixed = OutputBounty { reference_fix: &original, ..bounty };
    assert_eq!(proof0_report(&unfixed, &round(0, 64), &Limits::default()).verdict, Verdict::Fail);
}

#[test]
fn the_record_binds_the_secret_the_expected_value_and_the_fix() {
    let a = kintsugi_check_output::secret_record(b"abc", 38, &[1; 32]);
    assert_ne!(a, kintsugi_check_output::secret_record(b"abd", 38, &[1; 32]));
    assert_ne!(a, kintsugi_check_output::secret_record(b"abc", 37, &[1; 32]));
    assert_ne!(a, kintsugi_check_output::secret_record(b"abc", 38, &[2; 32]));
    assert!(a.starts_with(kintsugi_check_output::RECORD_DOMAIN));
}
