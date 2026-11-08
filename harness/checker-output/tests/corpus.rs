//! The output checker corpus, for both demos. Fee calculator (data/attacks/output/manifest.txt): every module gives its
//! expected verdict on three seeds, with the public demo secret and data/feecalc/fixed.wasm as the reference fix; the
//! variants alone catch the patch that special cases the secret. Memory safety (data/attacks/memsafe/manifest.txt): the
//! same, with its public demo secret (sweep=0) and data/memsafe/fixed.wasm; the sweep alone catches the fix that refuses
//! only names over 20 bytes. Proof 0 passes for both; the record binds every private part.
use std::path::PathBuf;

use kintsugi_check::{text, Limits, Round, TestCase, Verdict};
use kintsugi_check_output::{check_report, parse_secret, proof0_report, secret_record, OutputBounty, Reason, Secret, RECORD_DOMAIN};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn read(p: &str) -> Vec<u8> {
    std::fs::read(root().join(p)).unwrap_or_else(|e| panic!("{p}: {e}"))
}
fn round(seed: u8, fuzz: u32, variants: u32) -> Round {
    Round { fuzz_seed: [seed; 32], fuzz_count: fuzz, variant_count: variants }
}

struct Demo {
    original: Vec<u8>,
    fix: Vec<u8>,
    tests: Vec<TestCase>,
    secret: Secret,
    manifest: &'static str,
}

impl Demo {
    fn load(program: &str, corpus: &'static str) -> Demo {
        Demo {
            original: read(&format!("data/{program}/original.wasm")),
            fix: read(&format!("data/{program}/fixed.wasm")),
            tests: text::parse_tests(&String::from_utf8(read(&format!("data/{program}/public_tests.txt"))).unwrap()).unwrap(),
            secret: parse_secret(&String::from_utf8(read(&format!("data/attacks/{corpus}/demo_secret.txt"))).unwrap()).unwrap(),
            manifest: corpus,
        }
    }
    fn bounty(&self) -> OutputBounty<'_> {
        OutputBounty {
            original: &self.original,
            secret_input: &self.secret.input,
            expected: self.secret.expected,
            reference_fix: &self.fix,
            public_tests: &self.tests,
            sweep_positions: &self.secret.sweep,
        }
    }
    fn run_manifest(&self) {
        let manifest = String::from_utf8(read(&format!("data/attacks/{}/manifest.txt", self.manifest))).unwrap();
        for seed in [0u8, 7, 201] {
            assert_eq!(proof0_report(&self.bounty(), &round(seed, 64, 64), &Limits::default()).verdict, Verdict::Pass, "proof 0, seed {seed}");
            for line in manifest.lines().map(|l| l.split('#').next().unwrap().trim()).filter(|l| !l.is_empty()) {
                let mut parts = line.split_whitespace();
                let (path, want) = (parts.next().unwrap(), parts.next().unwrap());
                let module = read(&format!("data/attacks/{}/{path}", self.manifest));
                let got = check_report(&module, &self.bounty(), &round(seed, 64, 64), &Limits::default());
                assert_eq!(got.verdict.as_str(), want, "{} {path}, seed {seed}: {:?}", self.manifest, got.reason);
            }
        }
    }
}

#[test]
fn feecalc_corpus_gives_the_expected_verdicts() {
    let d = Demo::load("feecalc", "output");
    d.run_manifest();
    // the variants alone catch the patch that special cases the secret
    let cheat = read("data/attacks/output/special_case_secret.wasm");
    let r = check_report(&cheat, &d.bounty(), &round(0, 0, 64), &Limits::default());
    assert!(matches!(r.reason, Some(Reason::VariantMismatch { .. })), "{:?}", r.reason);
    // the original is wrong on the secret, so Proof 0 with the original as its own fix fails
    let unfixed = OutputBounty { reference_fix: &d.original, ..d.bounty() };
    assert_eq!(proof0_report(&unfixed, &round(0, 64, 64), &Limits::default()).verdict, Verdict::Fail);
    // a sweep of the last amount keeps every verdict of the corpus
    let mut swept = Demo::load("feecalc", "output");
    swept.secret.sweep = vec![7];
    swept.run_manifest();
}

#[test]
fn memsafe_corpus_gives_the_expected_verdicts() {
    let d = Demo::load("memsafe", "memsafe");
    assert_eq!(d.secret.sweep, vec![0]);
    d.run_manifest();
    // with no random inputs and no variants, the sweep alone catches the fix that refuses only names over 20 bytes
    let partial = read("data/attacks/memsafe/partial_fix_20.wasm");
    let r = check_report(&partial, &d.bounty(), &round(0, 0, 0), &Limits::default());
    assert!(matches!(r.reason, Some(Reason::SweepMismatch { position: 0, value: 17..=20, .. })), "{:?}", r.reason);
    // without the sweep, that partial fix gets through on at least one of these seeds: the sweep is what stops it
    let mut no_sweep = Demo::load("memsafe", "memsafe");
    no_sweep.secret.sweep.clear();
    let passes = [0u8, 7, 201].iter().filter(|s| check_report(&partial, &no_sweep.bounty(), &round(**s, 64, 64), &Limits::default()).verdict == Verdict::Pass).count();
    assert!(passes > 0, "the partial fix failed on every seed without the sweep");
}

#[test]
fn secret_files_and_sweep_positions_are_checked() {
    assert_eq!(parse_secret("0102 5").unwrap().sweep, Vec::<u16>::new());
    assert_eq!(parse_secret("# note\n0102 5 sweep=1,0\n").unwrap().sweep, vec![1, 0]);
    assert!(parse_secret("0102 5 sweep=2").is_err(), "a position past the end");
    assert!(parse_secret("0102 5 sweep=1,1").is_err(), "a position twice");
    assert!(parse_secret("0102030405 5 sweep=0,1,2,3,4").is_err(), "more than 4 positions");
    assert!(parse_secret("0102 5\n0304 6").is_err(), "two lines");
}

#[test]
fn the_record_binds_the_secret_the_expected_value_the_fix_and_the_sweep() {
    let a = secret_record(b"abc", 38, &[1; 32], &[0]);
    assert_ne!(a, secret_record(b"abd", 38, &[1; 32], &[0]));
    assert_ne!(a, secret_record(b"abc", 37, &[1; 32], &[0]));
    assert_ne!(a, secret_record(b"abc", 38, &[2; 32], &[0]));
    assert_ne!(a, secret_record(b"abc", 38, &[1; 32], &[1]));
    assert_ne!(a, secret_record(b"abc", 38, &[1; 32], &[]));
    assert!(a.starts_with(RECORD_DOMAIN));
}
