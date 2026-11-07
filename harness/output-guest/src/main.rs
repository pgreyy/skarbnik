//! zkVM guest of the output checker (wrong output bugs). It reads the bounty (original module, secret input, the
//! expected value, the vendor's reference fix, salt, public tests) and the candidate from the host, runs the same output
//! checker as the native tool, and commits the crash checker's journal unchanged. The secret input, the expected value,
//! the reference fix and the salt never leave the guest: the journal's exploit commitment is
//! sha256(salt || secret_record(secret input, expected value, sha256(reference fix))), so one commitment binds all
//! three for every proof of the bounty. In Proof 0 mode the candidate must be the reference fix itself: the guest checks
//! that the original is really wrong on the secret and passes the tests, and that the reference fix passes the full
//! check, and sets the submission id to sha256("kintsugi-proof0-v1" || fix hash) itself, as the crash checker does.

use kintsugi_check::zk::{
    corpus_bytes, exploit_commitment_bytes, proof0_submission_bytes, test_cases, Journal, MODE_CHECK, MODE_PROOF0,
    VERDICT_FAIL, VERDICT_PASS,
};
use kintsugi_check::{Limits, Round, Verdict};
use kintsugi_check_output::zk::OutputGuestInput;
use kintsugi_check_output::{check, proof0_report, secret_record, OutputBounty};
use risc0_zkvm::guest::env;
use risc0_zkvm::sha::{Impl, Sha256};

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let digest = Impl::hash_bytes(bytes);
    let mut out = [0u8; 32];
    out.copy_from_slice(digest.as_bytes());
    out
}

fn main() {
    let input: OutputGuestInput = env::read();
    let tests = test_cases(&input.public_tests);
    let bounty = OutputBounty {
        original: &input.original,
        secret_input: &input.secret_input,
        expected: input.expected,
        reference_fix: &input.reference_fix,
        public_tests: &tests,
    };
    let round = Round { fuzz_seed: input.fuzz_seed, fuzz_count: input.fuzz_count, variant_count: input.variant_count };
    let candidate_hash = sha256(&input.candidate);
    let reference_fix_hash = sha256(&input.reference_fix);
    let proof0_id = sha256(&proof0_submission_bytes(&candidate_hash));
    let (verdict, submission_id) = match input.mode {
        MODE_PROOF0 => {
            // Proof 0 is about the reference fix the commitment binds, so the candidate must be that fix.
            assert!(candidate_hash == reference_fix_hash, "in Proof 0 the candidate must be the reference fix");
            (proof0_report(&bounty, &round, &Limits::default()).verdict, proof0_id)
        }
        MODE_CHECK => {
            // A normal check may never carry the id reserved for Proof 0, so a check cannot pose as one.
            assert!(input.submission_id != proof0_id, "submission id is reserved for Proof 0");
            (check(&input.candidate, &bounty, &round, &Limits::default()), input.submission_id)
        }
        _ => panic!("unknown mode"),
    };
    let record = secret_record(&input.secret_input, input.expected, &reference_fix_hash);
    let journal = Journal {
        candidate_hash,
        original_hash: sha256(&input.original),
        exploit_commitment: sha256(&exploit_commitment_bytes(&input.salt, &record)),
        corpus_hash: sha256(&corpus_bytes(&input.public_tests)),
        fuzz_seed: input.fuzz_seed,
        fuzz_count: input.fuzz_count,
        variant_count: input.variant_count,
        submission_id,
        verdict: match verdict {
            Verdict::Pass => VERDICT_PASS,
            Verdict::Fail => VERDICT_FAIL,
        },
    };
    env::commit(&journal);
}
