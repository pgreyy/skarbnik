//! The Kintsugi checker (spike S1): decides PASS or FAIL for a researcher's patched WebAssembly
//! module without revealing the secret crash input.
//!
//! The steps, in order (the first one that fails decides the verdict):
//! 1. Validate: the candidate module loads under the limits in `exec::Limits`.
//! 2. Exploit: on the secret crash input it must return normally (no crash, no running out of fuel).
//! 3. Public tests: on each public test input it must return exactly the expected value.
//! 4. Fairness: on `fuzz_count` fresh inputs made from a public seed, it must agree with the
//!    original program (same value; and where the original crashes, it must not crash).
//! 5. Variants: on `variant_count` copies of the secret input with one or two bytes changed, it
//!    must agree with the original in the same way. This stops a patch that only recognises the
//!    exact secret bytes.
//!
//! The verdict type is only PASS or FAIL. `Report` also carries an internal reason and counters
//! for our own testing; a published result must only carry the verdict.
//!
//! Everything here is a pure function of its byte inputs: no files, no network, no clock, no
//! randomness except the seeded generator. That is so the same code can later run inside the
//! RISC Zero guest and give the same answer.

pub mod exec;
pub mod gen;
pub mod text;
#[cfg(feature = "zk")]
pub mod zk;

pub use exec::{Limits, LoadError, Loaded, Outcome, RunResult};

/// The only thing a published result says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Pass,
    Fail,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::Pass => "PASS",
            Verdict::Fail => "FAIL",
        }
    }
}

/// One public test: an input and the value the original program returns for it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TestCase {
    pub input: Vec<u8>,
    pub expected: i32,
}

/// What the vendor fixes when a bounty opens.
pub struct Bounty<'a> {
    /// The original (buggy) module, public.
    pub original: &'a [u8],
    /// The secret crash input, private.
    pub exploit: &'a [u8],
    /// The public tests.
    pub public_tests: &'a [TestCase],
}

/// What is fixed per checked submission.
#[derive(Clone, Debug)]
pub struct Round {
    /// Public seed (on NEAR it comes from the chain at reveal time).
    pub fuzz_seed: [u8; 32],
    /// How many fresh fairness inputs to check.
    pub fuzz_count: u32,
    /// How many variants of the secret input to check (0 turns step 5 off).
    pub variant_count: u32,
}

/// Which step decided a FAIL. Internal only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reason {
    OriginalInvalid(LoadError),
    CandidateInvalid(LoadError),
    ExploitStillFails(Outcome),
    PublicTestMismatch { index: usize, expected: i32, actual: Outcome },
    FairnessMismatch { index: usize, input: Vec<u8>, original: Outcome, candidate: Outcome },
    VariantMismatch { index: usize, original: Outcome, candidate: Outcome },
    // Proof 0 (checks on the original module itself):
    OriginalDoesNotCrash(Outcome),
    OriginalOnlyRanOutOfFuel,
    OriginalFailsPublicTest { index: usize, expected: i32, actual: Outcome },
    /// The secret input is longer than any module may be given, so every candidate would "crash" on it.
    ExploitTooLong { len: usize, max: usize },
    /// The vendor's reference fix does not pass the full check, so the bounty may be unfixable.
    ReferenceFixFails(Box<Reason>),
}

impl Reason {
    /// Short name of the step that failed, for tables.
    pub fn step(&self) -> &'static str {
        match self {
            Reason::OriginalInvalid(_) => "setup: original invalid",
            Reason::CandidateInvalid(_) => "1 validate",
            Reason::ExploitStillFails(_) => "2 exploit",
            Reason::PublicTestMismatch { .. } => "3 public tests",
            Reason::FairnessMismatch { .. } => "4 fairness",
            Reason::VariantMismatch { .. } => "5 variants",
            Reason::OriginalDoesNotCrash(_) => "proof0: no crash",
            Reason::OriginalOnlyRanOutOfFuel => "proof0: only out of fuel",
            Reason::OriginalFailsPublicTest { .. } => "proof0: public tests",
            Reason::ExploitTooLong { .. } => "proof0: exploit too long",
            Reason::ReferenceFixFails(_) => "proof0: reference fix fails",
        }
    }
}

/// Counters from one check, for our measurements (S2 uses them).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    /// Module runs done (candidate and original together).
    pub runs: u32,
    /// Most fuel one candidate run used.
    pub max_fuel_candidate: u64,
    /// Most fuel one original run used.
    pub max_fuel_original: u64,
    /// Fairness inputs on which the original itself crashed.
    pub fairness_original_traps: u32,
    /// Fairness inputs on which the original returned an error code (below 0).
    pub fairness_original_errors: u32,
    /// Variants of the secret input on which the original still crashed.
    pub variants_original_traps: u32,
}

/// The verdict plus internal detail.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Report {
    pub verdict: Verdict,
    pub reason: Option<Reason>,
    pub stats: Stats,
}

/// The fairness rule: where the original returns a value, the candidate must return the same
/// value; where the original crashes, the candidate must return something (anything).
pub fn agrees(original: &Outcome, candidate: &Outcome) -> bool {
    match original {
        Outcome::Returned(v) => candidate == &Outcome::Returned(*v),
        Outcome::Trapped { .. } => !candidate.is_trap(),
    }
}

/// The verdict only. This is what the zkVM guest will commit.
pub fn check(candidate: &[u8], bounty: &Bounty, round: &Round, limits: &Limits) -> Verdict {
    check_report(candidate, bounty, round, limits).verdict
}

fn fail(reason: Reason, stats: Stats) -> Report {
    Report { verdict: Verdict::Fail, reason: Some(reason), stats }
}

/// The verdict with the internal reason and counters.
pub fn check_report(candidate: &[u8], bounty: &Bounty, round: &Round, limits: &Limits) -> Report {
    let mut stats = Stats::default();
    let original = match Loaded::load(bounty.original, limits) {
        Ok(m) => m,
        Err(e) => return fail(Reason::OriginalInvalid(e), stats),
    };

    // Step 1: validate.
    let cand = match Loaded::load(candidate, limits) {
        Ok(m) => m,
        Err(e) => return fail(Reason::CandidateInvalid(e), stats),
    };

    let run_cand = |input: &[u8], stats: &mut Stats| {
        let r = cand.run(input);
        stats.runs += 1;
        stats.max_fuel_candidate = stats.max_fuel_candidate.max(r.fuel_used);
        r.outcome
    };
    let run_orig = |input: &[u8], stats: &mut Stats| {
        let r = original.run(input);
        stats.runs += 1;
        stats.max_fuel_original = stats.max_fuel_original.max(r.fuel_used);
        r.outcome
    };

    // Step 2: the secret crash input must no longer crash or hang.
    let got = run_cand(bounty.exploit, &mut stats);
    if got.is_trap() {
        return fail(Reason::ExploitStillFails(got), stats);
    }

    // Step 3: public tests.
    for (index, t) in bounty.public_tests.iter().enumerate() {
        let got = run_cand(&t.input, &mut stats);
        if got != Outcome::Returned(t.expected) {
            return fail(Reason::PublicTestMismatch { index, expected: t.expected, actual: got }, stats);
        }
    }

    // Step 4: fairness check on fresh seeded inputs.
    let fresh = gen::fairness_inputs(&round.fuzz_seed, round.fuzz_count, limits.max_input_len);
    for (index, input) in fresh.iter().enumerate() {
        let o = run_orig(input, &mut stats);
        match &o {
            Outcome::Trapped { .. } => stats.fairness_original_traps += 1,
            Outcome::Returned(v) if *v < 0 => stats.fairness_original_errors += 1,
            _ => {}
        }
        let c = run_cand(input, &mut stats);
        if !agrees(&o, &c) {
            let input = input.clone();
            return fail(Reason::FairnessMismatch { index, input, original: o, candidate: c }, stats);
        }
    }

    // Step 5: variants of the secret crash input.
    let variants = gen::exploit_variants(bounty.exploit, &round.fuzz_seed, round.variant_count);
    for (index, input) in variants.iter().enumerate() {
        let o = run_orig(input, &mut stats);
        if o.is_trap() {
            stats.variants_original_traps += 1;
        }
        let c = run_cand(input, &mut stats);
        if !agrees(&o, &c) {
            return fail(Reason::VariantMismatch { index, original: o, candidate: c }, stats);
        }
    }

    Report { verdict: Verdict::Pass, reason: None, stats }
}

/// Proof 0: before a bounty opens, the original must really crash on the secret input (a real
/// trap, not just running out of fuel) and must pass its own public tests. PASS means the bounty
/// is genuine.
pub fn proof0_report(bounty: &Bounty, limits: &Limits) -> Report {
    let mut stats = Stats::default();
    // An over-long secret input is refused for every module before it runs, which would look like a crash
    // for every patch: such a bounty could never be fixed.
    if bounty.exploit.len() > limits.max_input_len {
        return fail(Reason::ExploitTooLong { len: bounty.exploit.len(), max: limits.max_input_len }, stats);
    }
    let original = match Loaded::load(bounty.original, limits) {
        Ok(m) => m,
        Err(e) => return fail(Reason::OriginalInvalid(e), stats),
    };
    let run = |input: &[u8], stats: &mut Stats| {
        let r = original.run(input);
        stats.runs += 1;
        stats.max_fuel_original = stats.max_fuel_original.max(r.fuel_used);
        r.outcome
    };
    match run(bounty.exploit, &mut stats) {
        Outcome::Trapped { out_of_fuel: false, .. } => {}
        Outcome::Trapped { out_of_fuel: true, .. } => {
            return fail(Reason::OriginalOnlyRanOutOfFuel, stats)
        }
        other => return fail(Reason::OriginalDoesNotCrash(other), stats),
    }
    for (index, t) in bounty.public_tests.iter().enumerate() {
        let got = run(&t.input, &mut stats);
        if got != Outcome::Returned(t.expected) {
            return fail(
                Reason::OriginalFailsPublicTest { index, expected: t.expected, actual: got },
                stats,
            );
        }
    }
    Report { verdict: Verdict::Pass, reason: None, stats }
}

/// Proof 0 with a reference fix (guard against unfixable bounties): the original must really crash on the
/// secret and pass the public tests, and the vendor's own reference fix must pass the full check (secret,
/// public tests, fairness inputs, variants). This shows that a fix exists before researchers spend attempts.
pub fn proof0_with_reference(bounty: &Bounty, round: &Round, limits: &Limits, reference_fix: &[u8]) -> Report {
    let first = proof0_report(bounty, limits);
    if first.verdict == Verdict::Fail {
        return first;
    }
    let fix = check_report(reference_fix, bounty, round, limits);
    let mut stats = first.stats.clone();
    stats.runs += fix.stats.runs;
    stats.max_fuel_candidate = fix.stats.max_fuel_candidate;
    match fix.verdict {
        Verdict::Pass => Report { verdict: Verdict::Pass, reason: None, stats },
        Verdict::Fail => {
            let why = fix.reason.unwrap_or(Reason::CandidateInvalid(LoadError::DoesNotParse("unknown".into())));
            fail(Reason::ReferenceFixFails(Box::new(why)), stats)
        }
    }
}
