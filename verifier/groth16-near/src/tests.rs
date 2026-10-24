// Unit tests for the Groth16 spike, run natively with near-sdk's test environment (real alt_bn128 host functions):
// the real demo Proof 0 Groth16 receipt must be accepted; a changed journal, a wrong image id and a flipped seal bit
// must not be.
use super::*;

#[path = "test_vectors.rs"]
mod v;

fn check(seal: &str, image_id: &str, journal: &str) -> bool {
    Groth16Spike::default().verify_groth16(seal.into(), image_id.into(), journal.into())
}

#[test]
fn real_receipt_is_accepted() {
    assert!(check(v::SEAL, v::IMAGE_ID, v::JOURNAL));
}

#[test]
fn changed_journal_is_rejected() {
    let mut j = v::JOURNAL.to_string();
    let last = if j.ends_with('0') { "1" } else { "0" };
    j.replace_range(j.len() - 1.., last);
    assert!(!check(v::SEAL, v::IMAGE_ID, &j));
}

#[test]
fn wrong_image_id_is_rejected() {
    let wrong = "043ec633f68431f51b99cacd6a460560647a15916cdd0cb58762b61f9ede7f8d"; // S13's plain-build id
    assert!(!check(v::SEAL, wrong, v::JOURNAL));
}

// A flipped seal bit is tested on testnet only (scripts/s6b_testnet.sh): the host function stops the call with
// AltBn128InvalidInput, and an error raised inside near-sdk's mocked host functions aborts the native test process
// instead of unwinding, so it cannot be caught here.
