//! zkVM guest of the rule checker (spike A and B: bugs judged by a public rule). It reads the bounty (the original
//! program, the public rule module, the public tests as call sequences with their transcripts, the secret call sequence,
//! the reference fix, the sweep positions, the salt) and the candidate from the host, runs the same rule checker as the
//! native tool, and commits the crash checker's journal unchanged. The secret, the reference fix, the sweep positions
//! and the salt never leave the guest: the journal's exploit commitment is sha256(salt || secret_record(secret,
//! sha256(reference fix), sweep positions)). The rule's sha256 is bound into the corpus hash with the public tests, so
//! the rule cannot change between proofs either. In Proof 0 mode the candidate must be the reference fix; the guest
//! sets the submission id to sha256("kintsugi-proof0-v1" || fix hash) itself, as the crash checker does.

use kintsugi_check::zk::{exploit_commitment_bytes, proof0_submission_bytes, Journal, MODE_CHECK, MODE_PROOF0, VERDICT_FAIL, VERDICT_PASS};
use kintsugi_check::{Round, Verdict};
use kintsugi_check_rule::zk::RuleGuestInput;
use kintsugi_check_rule::{check, corpus_bytes, proof0_report, secret_record, Limits, RuleBounty, Test};
use risc0_zkvm::guest::env;
use risc0_zkvm::sha::{Impl, Sha256};

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let digest = Impl::hash_bytes(bytes);
    let mut out = [0u8; 32];
    out.copy_from_slice(digest.as_bytes());
    out
}

fn main() {
    let input: RuleGuestInput = env::read();
    let tests: Vec<Test> = input.public_tests.iter().map(|(s, e)| Test { sequence: s.clone(), expected: e.clone() }).collect();
    let bounty = RuleBounty {
        original: &input.original,
        rule: &input.rule,
        public_tests: &tests,
        secret: &input.secret,
        reference_fix: &input.reference_fix,
        sweep_positions: &input.sweep_positions,
    };
    let round = Round { fuzz_seed: input.fuzz_seed, fuzz_count: input.fuzz_count, variant_count: input.variant_count };
    let limits = Limits::default();
    let candidate_hash = sha256(&input.candidate);
    let reference_fix_hash = sha256(&input.reference_fix);
    let proof0_id = sha256(&proof0_submission_bytes(&candidate_hash));
    let (verdict, submission_id) = match input.mode {
        MODE_PROOF0 => {
            assert!(candidate_hash == reference_fix_hash, "in Proof 0 the candidate must be the reference fix");
            (proof0_report(&bounty, &round, &limits).verdict, proof0_id)
        }
        MODE_CHECK => {
            assert!(input.submission_id != proof0_id, "submission id is reserved for Proof 0");
            (check(&input.candidate, &bounty, &round, &limits), input.submission_id)
        }
        _ => panic!("unknown mode"),
    };
    let record = secret_record(&input.secret, &reference_fix_hash, &input.sweep_positions);
    let journal = Journal {
        candidate_hash,
        original_hash: sha256(&input.original),
        exploit_commitment: sha256(&exploit_commitment_bytes(&input.salt, &record)),
        corpus_hash: sha256(&corpus_bytes(&tests, &sha256(&input.rule))),
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
