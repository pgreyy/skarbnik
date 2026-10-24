//! zkVM guest that checks one candidate patch. It reads the bounty (original module, secret crash
//! input, salt, public tests) and the candidate from the host, runs the same checker as the native
//! tool, and commits a journal with hashes, the seed, the counts and PASS or FAIL. The secret crash
//! input and the salt never leave the guest; only sha256(salt || exploit) is published.
//! With `profile` set in the input it also prints where its cycles went (to standard output, not
//! the journal).

use kintsugi_check::zk::{
    corpus_bytes, exploit_commitment_bytes, test_cases, GuestInput, Journal, VERDICT_FAIL, VERDICT_PASS,
};
use kintsugi_check::exec::profile;
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
    let c_start = env::cycle_count();
    let input: GuestInput = env::read();
    if input.profile {
        profile::set_clock(env::cycle_count);
    }
    let c_read = env::cycle_count();

    let tests = test_cases(&input.public_tests);
    let bounty = Bounty { original: &input.original, exploit: &input.exploit, public_tests: &tests };
    let round = Round {
        fuzz_seed: input.fuzz_seed,
        fuzz_count: input.fuzz_count,
        variant_count: input.variant_count,
    };
    let verdict = check(&input.candidate, &bounty, &round, &Limits::default());
    let c_check = env::cycle_count();

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
    let c_hash = env::cycle_count();
    env::commit(&journal);
    let c_end = env::cycle_count();
    if input.profile {
        let (load, setup, run) = profile::totals();
        let check_total = c_check - c_read;
        println!(
            "profile cycles: read_input={} module_load={} instance_setup={} run_patch={} checker_other={} hashing={} commit={} total={}",
            c_read - c_start,
            load,
            setup,
            run,
            check_total.saturating_sub(load + setup + run),
            c_hash - c_check,
            c_end - c_hash,
            c_end - c_start
        );
    }
}
