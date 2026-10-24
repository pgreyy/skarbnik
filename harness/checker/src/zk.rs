//! Shapes shared by the zkVM host and guest: what the host sends into the guest (`GuestInput`) and
//! the public journal the guest commits (`Journal`). Also the exact byte layouts that get hashed, so the
//! host and the guest (and later the contract) hash the same bytes. Only built with the "zk" feature.

use serde::{Deserialize, Serialize};

use crate::TestCase;

/// Journal value for a PASS verdict.
pub const VERDICT_PASS: u8 = 1;
/// Journal value for a FAIL verdict.
pub const VERDICT_FAIL: u8 = 0;

/// Everything the guest needs for one check. `exploit` and `salt` are private: they never appear
/// in the journal, only their commitment does.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GuestInput {
    pub original: Vec<u8>,
    pub exploit: Vec<u8>,
    pub salt: [u8; 32],
    /// Public tests as (input, expected return value).
    pub public_tests: Vec<(Vec<u8>, i32)>,
    pub candidate: Vec<u8>,
    pub fuzz_seed: [u8; 32],
    pub fuzz_count: u32,
    pub variant_count: u32,
    pub submission_id: [u8; 32],
    /// When true the guest prints a cycle profile (load, setup, run, hashing, rest) to its standard
    /// output. It changes nothing in the journal. Used for measuring only.
    pub profile: bool,
}

/// The public output of one check. Fixed fields only; the verdict is PASS or FAIL, never a reason.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Journal {
    pub candidate_hash: [u8; 32],
    pub original_hash: [u8; 32],
    /// sha256(salt || exploit): the same value in every proof for one bounty.
    pub exploit_commitment: [u8; 32],
    /// sha256 of `corpus_bytes(public_tests)`.
    pub corpus_hash: [u8; 32],
    pub fuzz_seed: [u8; 32],
    pub fuzz_count: u32,
    pub variant_count: u32,
    pub submission_id: [u8; 32],
    /// `VERDICT_PASS` or `VERDICT_FAIL`.
    pub verdict: u8,
}

/// Bytes hashed for the exploit commitment: the 32 byte salt, then the exploit.
pub fn exploit_commitment_bytes(salt: &[u8; 32], exploit: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(32 + exploit.len());
    out.extend_from_slice(salt);
    out.extend_from_slice(exploit);
    out
}

/// Bytes hashed for the corpus hash: for each test in order, its input length (u32 little endian),
/// the input bytes, then the expected value (i32 little endian).
pub fn corpus_bytes(tests: &[(Vec<u8>, i32)]) -> Vec<u8> {
    let mut out = Vec::new();
    for (input, expected) in tests {
        out.extend_from_slice(&(input.len() as u32).to_le_bytes());
        out.extend_from_slice(input);
        out.extend_from_slice(&expected.to_le_bytes());
    }
    out
}

/// Turns the public test pairs into the checker's test cases.
pub fn test_cases(tests: &[(Vec<u8>, i32)]) -> Vec<TestCase> {
    tests
        .iter()
        .map(|(input, expected)| TestCase { input: input.clone(), expected: *expected })
        .collect()
}
