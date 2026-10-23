//! zkVM guest that checks one candidate patch. It reads the bounty (original module, secret crash
//! input, salt, public tests) and the candidate from the host, runs the same checker as the native
//! tool, and commits a journal with hashes, the seed, the counts and PASS or FAIL. The secret crash
//! input and the salt never leave the guest; only sha256(salt || exploit) is published.

use kintsugi_check::zk::{
    corpus_bytes, exploit_commitment_bytes, test_cases, GuestInput, Journal, VERDICT_FAIL, VERDICT_PASS,
};
use kintsugi_check::{check, Bounty, Limits, Round, Verdict};
use risc0_zkvm::guest::env;
use risc0_zkvm::sha::{Impl, Sha256};

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let digest = Impl::hash_bytes(bytes);
    let mut out = [0u8; 32];
    out.copy_from_slice(digest.as_bytes());
    out
}

fn main() {
    let input: GuestInput = env::read();

    let tests = test_cases(&input.public_tests);
    let bounty = Bounty { original: &input.original, exploit: &input.exploit, public_tests: &tests };
    let round = Round {
        fuzz_seed: input.fuzz_seed,
        fuzz_count: input.fuzz_count,
        variant_count: input.variant_count,
    };
    let verdict = check(&input.candidate, &bounty, &round, &Limits::default());

    let journal = Journal {
        candidate_hash: sha256(&input.candidate),
        original_hash: sha256(&input.original),
        exploit_commitment: sha256(&exploit_commitment_bytes(&input.salt, &input.exploit)),
        corpus_hash: sha256(&corpus_bytes(&input.public_tests)),
        fuzz_seed: input.fuzz_seed,
        fuzz_count: input.fuzz_count,
        variant_count: input.variant_count,
        submission_id: input.submission_id,
        verdict: match verdict {
            Verdict::Pass => VERDICT_PASS,
            Verdict::Fail => VERDICT_FAIL,
        },
    };
    env::commit(&journal);
}
