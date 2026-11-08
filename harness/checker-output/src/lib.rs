//! The output checker: decides PASS or FAIL for a patch to a program that gives a wrong answer (no crash) on a secret
//! input. The vendor's secret is a pair, the input and the value the program should return, and the vendor also
//! keeps a hidden reference fix. All three are bound by one commitment (see `secret_record`).
//!
//! The steps, in order (the first one that fails decides the verdict):
//! 1. Validate: the candidate module loads under the limits in `Limits` (the same as the crash checker).
//! 2. Secret: on the secret input it returns exactly the expected value.
//! 3. Public tests: on each public test input it returns exactly the expected value.
//! 4. Fairness: on `fuzz_count` fresh inputs from the public seed it agrees with the reference fix.
//! 5. Variants: on `variant_count` copies of the secret input with one or two bytes changed it agrees with the
//!    reference fix. This stops a patch that only recognises the exact secret bytes.
//!
//! Proof 0 shows the bounty is genuine and fixable: the original returns something else than the expected value on
//! the secret, passes the public tests, and the reference fix passes the full check.
//!
//! It reuses the crash checker's interpreter, limits, generators and agreement rule (harness/checker) and changes
//! none of them. Pure functions of their byte inputs, so the same code runs natively and in the zkVM guest.

use kintsugi_check::{agrees, gen, Limits, LoadError, Loaded, Outcome, Round, TestCase, Verdict};

/// Domain tag at the start of the secret record, so a record of this mode can never be read as a crash secret.
pub const RECORD_DOMAIN: &[u8] = b"skarbnik-output-v1";

/// What the vendor fixes when a bounty of this mode opens.
pub struct OutputBounty<'a> {
    /// The original (buggy) module, public.
    pub original: &'a [u8],
    /// The secret input, private.
    pub secret_input: &'a [u8],
    /// The value a correct program returns on the secret input, private.
    pub expected: i32,
    /// The vendor's reference fix, private. Fairness inputs and variants are compared with it.
    pub reference_fix: &'a [u8],
    /// The public tests.
    pub public_tests: &'a [TestCase],
}

/// Which step decided a FAIL. Internal only: a published result carries the verdict alone.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reason {
    CandidateInvalid(LoadError),
    ReferenceFixInvalid(LoadError),
    OriginalInvalid(LoadError),
    SecretWrong { expected: i32, actual: Outcome },
    PublicTestMismatch { index: usize, expected: i32, actual: Outcome },
    FairnessMismatch { index: usize, reference: Outcome, candidate: Outcome },
    VariantMismatch { index: usize, reference: Outcome, candidate: Outcome },
    // Proof 0:
    SecretTooLong { len: usize, max: usize },
    OriginalAlreadyRight,
    OriginalFailsPublicTest { index: usize, expected: i32, actual: Outcome },
    ReferenceFixFails(Box<Reason>),
}

impl Reason {
    /// Short name of the step that failed, for tables.
    pub fn step(&self) -> &'static str {
        match self {
            Reason::CandidateInvalid(_) => "1 validate",
            Reason::ReferenceFixInvalid(_) => "setup: reference fix invalid",
            Reason::OriginalInvalid(_) => "setup: original invalid",
            Reason::SecretWrong { .. } => "2 secret",
            Reason::PublicTestMismatch { .. } => "3 public tests",
            Reason::FairnessMismatch { .. } => "4 fairness",
            Reason::VariantMismatch { .. } => "5 variants",
            Reason::SecretTooLong { .. } => "proof0: secret too long",
            Reason::OriginalAlreadyRight => "proof0: original already right",
            Reason::OriginalFailsPublicTest { .. } => "proof0: public tests",
            Reason::ReferenceFixFails(_) => "proof0: reference fix fails",
        }
    }
}

/// The verdict plus internal detail.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Report {
    pub verdict: Verdict,
    pub reason: Option<Reason>,
    /// Module runs done (candidate and reference fix together).
    pub runs: u32,
}

fn fail(reason: Reason, runs: u32) -> Report {
    Report { verdict: Verdict::Fail, reason: Some(reason), runs }
}

/// The bytes the vendor commits to, after the salt: the domain tag, the secret input's length (u32 little endian), the
/// secret input, the expected value (i32 little endian) and the reference fix's sha256. Hashed as
/// sha256(salt || record), this takes the place of the crash mode's sha256(salt || secret) in the journal, so one
/// commitment binds the secret, the expected value and the reference fix every proof of the bounty must use.
pub fn secret_record(secret_input: &[u8], expected: i32, reference_fix_hash: &[u8; 32]) -> Vec<u8> {
    let mut out = RECORD_DOMAIN.to_vec();
    out.extend_from_slice(&(secret_input.len() as u32).to_le_bytes());
    out.extend_from_slice(secret_input);
    out.extend_from_slice(&expected.to_le_bytes());
    out.extend_from_slice(reference_fix_hash);
    out
}

/// The verdict only. This is what the zkVM guest commits.
pub fn check(candidate: &[u8], bounty: &OutputBounty, round: &Round, limits: &Limits) -> Verdict {
    check_report(candidate, bounty, round, limits).verdict
}

/// The verdict with the internal reason.
pub fn check_report(candidate: &[u8], bounty: &OutputBounty, round: &Round, limits: &Limits) -> Report {
    let runs = std::cell::Cell::new(0u32);
    let reference = match Loaded::load(bounty.reference_fix, limits) {
        Ok(m) => m,
        Err(e) => return fail(Reason::ReferenceFixInvalid(e), 0),
    };
    // Step 1: validate.
    let cand = match Loaded::load(candidate, limits) {
        Ok(m) => m,
        Err(e) => return fail(Reason::CandidateInvalid(e), 0),
    };
    let run_c = |input: &[u8]| {
        runs.set(runs.get() + 1);
        cand.run(input).outcome
    };
    let run_r = |input: &[u8]| {
        runs.set(runs.get() + 1);
        reference.run(input).outcome
    };
    // Step 2: the secret input gives exactly the expected value.
    let got = run_c(bounty.secret_input);
    if got != Outcome::Returned(bounty.expected) {
        return fail(Reason::SecretWrong { expected: bounty.expected, actual: got }, runs.get());
    }
    // Step 3: public tests.
    for (index, t) in bounty.public_tests.iter().enumerate() {
        let got = run_c(&t.input);
        if got != Outcome::Returned(t.expected) {
            return fail(Reason::PublicTestMismatch { index, expected: t.expected, actual: got }, runs.get());
        }
    }
    // Steps 4 and 5: agree with the reference fix on fresh inputs and on near copies of the secret.
    for (index, input) in gen::fairness_inputs(&round.fuzz_seed, round.fuzz_count, limits.max_input_len).iter().enumerate() {
        let (r, c) = (run_r(input), run_c(input));
        if !agrees(&r, &c) {
            return fail(Reason::FairnessMismatch { index, reference: r, candidate: c }, runs.get());
        }
    }
    for (index, input) in gen::exploit_variants(bounty.secret_input, &round.fuzz_seed, round.variant_count).iter().enumerate() {
        let (r, c) = (run_r(input), run_c(input));
        if !agrees(&r, &c) {
            return fail(Reason::VariantMismatch { index, reference: r, candidate: c }, runs.get());
        }
    }
    Report { verdict: Verdict::Pass, reason: None, runs: runs.get() }
}

/// Proof 0: the original returns something else than the expected value on the secret (it is really wrong there),
/// passes its own public tests, and the reference fix passes the full check.
pub fn proof0_report(bounty: &OutputBounty, round: &Round, limits: &Limits) -> Report {
    if bounty.secret_input.len() > limits.max_input_len {
        return fail(Reason::SecretTooLong { len: bounty.secret_input.len(), max: limits.max_input_len }, 0);
    }
    let original = match Loaded::load(bounty.original, limits) {
        Ok(m) => m,
        Err(e) => return fail(Reason::OriginalInvalid(e), 0),
    };
    let mut runs = 1u32;
    if original.run(bounty.secret_input).outcome == Outcome::Returned(bounty.expected) {
        return fail(Reason::OriginalAlreadyRight, runs);
    }
    for (index, t) in bounty.public_tests.iter().enumerate() {
        runs += 1;
        let got = original.run(&t.input).outcome;
        if got != Outcome::Returned(t.expected) {
            return fail(Reason::OriginalFailsPublicTest { index, expected: t.expected, actual: got }, runs);
        }
    }
    let fix = check_report(bounty.reference_fix, bounty, round, limits);
    match fix.verdict {
        Verdict::Pass => Report { verdict: Verdict::Pass, reason: None, runs: runs + fix.runs },
        Verdict::Fail => {
            let why = fix.reason.unwrap_or(Reason::CandidateInvalid(LoadError::DoesNotParse("unknown".into())));
            fail(Reason::ReferenceFixFails(Box::new(why)), runs + fix.runs)
        }
    }
}

/// The shapes the zkVM host sends into the output guest. The journal is the crash checker's `Journal`, unchanged.
#[cfg(feature = "zk")]
pub mod zk {
    use serde::{Deserialize, Serialize};

    /// Everything the output guest needs for one check. `secret_input`, `expected`, `reference_fix` and `salt` are
    /// private: only sha256(salt || secret_record(...)) appears in the journal, as its exploit commitment.
    #[derive(Serialize, Deserialize, Clone, Debug)]
    pub struct OutputGuestInput {
        pub original: Vec<u8>,
        pub secret_input: Vec<u8>,
        pub expected: i32,
        pub reference_fix: Vec<u8>,
        pub salt: [u8; 32],
        /// Public tests as (input, expected return value).
        pub public_tests: Vec<(Vec<u8>, i32)>,
        pub candidate: Vec<u8>,
        pub fuzz_seed: [u8; 32],
        pub fuzz_count: u32,
        pub variant_count: u32,
        pub submission_id: [u8; 32],
        /// `kintsugi_check::zk::MODE_CHECK` or `MODE_PROOF0`.
        pub mode: u8,
    }
}
