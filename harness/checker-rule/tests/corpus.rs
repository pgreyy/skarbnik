//! The rule checker corpus: for each demo (data/ab/<demo>/, data/attacks/ab/<demo>/manifest.txt) every module gives
//! its expected verdict on three seeds and Proof 0 passes; the special case cheats fail on the secret's variants and
//! sweep alone (no fairness inputs); the record and the corpus bind every part; a sequence survives encode and decode.
use std::path::PathBuf;

use kintsugi_check::{Round, Verdict};
use kintsugi_check_rule::*;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn read(p: &str) -> Vec<u8> {
    std::fs::read(root().join(p)).unwrap_or_else(|e| panic!("{p}: {e}"))
}
fn text(p: &str) -> String {
    String::from_utf8(read(p)).unwrap()
}
fn round(seed: u8, fuzz: u32) -> Round {
    Round { fuzz_seed: [seed; 32], fuzz_count: fuzz, variant_count: 64 }
}

fn demo(name: &str) {
    let limits = Limits::default();
    let (original, rule) = (read(&format!("data/ab/{name}/original.wasm")), read(&format!("data/ab/{name}/rule.wasm")));
    let tests = parse_tests(&text(&format!("data/ab/{name}/public_tests.txt"))).unwrap();
    let (secret, sweep) = parse_secret(&text(&format!("data/attacks/ab/{name}/demo_secret.txt"))).unwrap();
    let manifest = text(&format!("data/attacks/ab/{name}/manifest.txt"));
    let rows: Vec<(String, String)> = manifest
        .lines()
        .map(|l| l.split('#').next().unwrap().trim())
        .filter(|l| !l.is_empty())
        .map(|l| {
            let mut p = l.split_whitespace();
            (p.next().unwrap().to_string(), p.next().unwrap().to_string())
        })
        .collect();
    let reference = read(&format!("data/attacks/ab/{name}/{}", rows.iter().find(|r| r.1 == "PASS").unwrap().0));
    let b = RuleBounty { original: &original, rule: &rule, public_tests: &tests, secret: &secret, reference_fix: &reference, sweep_positions: &sweep };
    for seed in [0u8, 7, 201] {
        assert_eq!(proof0_report(&b, &round(seed, 64), &limits).verdict, Verdict::Pass, "{name} proof 0, seed {seed}");
        for (path, want) in &rows {
            let got = check_report(&read(&format!("data/attacks/ab/{name}/{path}")), &b, &round(seed, 64), &limits);
            assert_eq!(got.verdict.as_str(), want, "{name} {path}, seed {seed}: {:?}", got.reason);
        }
    }
    for (path, _) in rows.iter().filter(|r| r.0.starts_with("cheat_special") || r.0.starts_with("cheat_users") || r.0.starts_with("cheat_payload")) {
        let got = check_report(&read(&format!("data/attacks/ab/{name}/{path}")), &b, &round(0, 0), &limits);
        assert!(matches!(got.reason, Some(Reason::VariantRule(_)) | Some(Reason::SweepRule { .. })), "{name} {path} without fairness: {:?}", got.reason);
    }
}

#[test]
fn xss_corpus() {
    demo("xss");
}
#[test]
fn path_corpus() {
    demo("path");
}
#[test]
fn idor_corpus() {
    demo("idor");
}
#[test]
fn authz_corpus() {
    demo("authz");
}

#[test]
fn sequences_records_and_corpora() {
    let calls = vec![Call { op: 0, args: vec![2] }, Call { op: 3, args: vec![] }, Call { op: 1, args: b"abc".to_vec() }];
    assert_eq!(decode(&encode(&calls)).unwrap(), calls);
    assert!(decode(&[0, 5, 1]).is_none(), "a call cut short");
    let a = secret_record(b"\x00\x01\x02", &[1; 32], &[2]);
    assert_ne!(a, secret_record(b"\x00\x01\x03", &[1; 32], &[2]));
    assert_ne!(a, secret_record(b"\x00\x01\x02", &[2; 32], &[2]));
    assert_ne!(a, secret_record(b"\x00\x01\x02", &[1; 32], &[]));
    let t = vec![Test { sequence: vec![0, 0], expected: vec![0, 0, 0, 0, 0, 0, 0] }];
    assert_ne!(corpus_bytes(&t, &[1; 32]), corpus_bytes(&t, &[2; 32]), "the rule's hash is bound into the corpus");
    assert!(corpus_bytes(&t, &[1; 32]).starts_with(CORPUS_DOMAIN));
}
