//! zkVM guest that checks one candidate patch. It reads the bounty (original module, secret crash
//! input, salt, public tests) and the candidate from the host, runs the same checker as the native
//! tool, and commits a journal with hashes, the seed, the counts and PASS or FAIL. The secret crash
//! input and the salt never leave the guest; only sha256(salt || exploit) is published.
//! With `profile` set in the input it also prints where its cycles went (to standard output, not
//! the journal). In Proof 0 mode the candidate is the vendor's reference fix: the guest checks that the
//! original really crashes on the secret and passes the tests, and that the reference fix passes the full
//! check, and sets the journal's submission id to sha256("kintsugi-proof0-v1" || fix hash) itself.

use kintsugi_check::zk::{
    corpus_bytes, exploit_commitment_bytes, proof0_submission_bytes, test_cases, GuestInput, Journal, MODE_CHECK,
    MODE_PROOF0, VERDICT_FAIL, VERDICT_PASS,
};
use kintsugi_check::exec::profile;
use kintsugi_check::{check, proof0_with_reference, Bounty, Limits, Round, Verdict};
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
    let candidate_hash = sha256(&input.candidate);
    let proof0_id = sha256(&proof0_submission_bytes(&candidate_hash));
    let (verdict, submission_id) = match input.mode {
        MODE_PROOF0 => (proof0_with_reference(&bounty, &round, &Limits::default(), &input.candidate).verdict, proof0_id),
        MODE_CHECK => {
            // A normal check may never carry the id reserved for Proof 0, so a check cannot pose as one.
            assert!(input.submission_id != proof0_id, "submission id is reserved for Proof 0");
            (check(&input.candidate, &bounty, &round, &Limits::default()), input.submission_id)
        }
        _ => panic!("unknown mode"),
    };
    let c_check = env::cycle_count();

    let journal = Journal {
        candidate_hash,
        original_hash: sha256(&input.original),
        exploit_commitment: sha256(&exploit_commitment_bytes(&input.salt, &input.exploit)),
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
