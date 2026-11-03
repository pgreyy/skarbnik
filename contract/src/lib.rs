//! Kintsugi bounty contract (spike S3). It holds a vendor's bounty money and pays it out by fixed rules.
//!
//! Life of a bounty, in plain words:
//! 1. `create_bounty`: the vendor attaches the bounty and posts fingerprints (hashes) of the original
//!    program, the public tests, the proof program (image id), the secret exploit (commitment) and the
//!    vendor's first proof receipt, plus the time windows for this bounty.
//! 2. `commit`: a researcher posts a fingerprint of their patch (sha256 over the patch bytes, the payout
//!    account and a random nonce). Only the first K commits of a bounty count; later ones are ignored.
//!    A bounty created with `max_commits_per_account` also refuses a commit from an account that already holds that
//!    many of its slots (committed and not released); bounties created without it have no such limit.
//! 3. `reveal`: after a short gap, the researcher posts the patch and the nonce. The contract checks the
//!    fingerprint and the size, and records the block's random seed and the reveal time.
//! 4. `post_verdict`: the vendor posts PASS or FAIL with the journal hash and receipt hash of its proof,
//!    within the verdict window after the reveal.
//! 5. `attest`: registered verifiers confirm the same verdict, journal hash and receipt hash. The verdict
//!    is final only with attestations from two different registered verifiers. A final PASS pays the
//!    researcher's payout account and closes the bounty; a final FAIL spends that attempt.
//! Guards added in spike S13 (attack pass):
//! - Proof 0 before any attempt: a new bounty is created closed. It opens for commits only after two
//!   different registered verifiers attest its Proof 0 (`attest_proof0`): a proof that the original really
//!   crashes on the committed secret AND that the vendor's reference fix (whose sha256 is fixed at creation)
//!   passes the full check. This stops a bounty whose secret no patch can ever fix.
//! - Junk commits: each commit must be revealed within `reveal_window_ns`. After that, anyone may call
//!   `release_unrevealed` to free its slot. K counts slots in use; the fee of a released commit is kept.
//! - The winning researcher's own attempt fee is refunded with the payout.
//! 6. `claim_timeout`: anyone may call it once the deadline has passed with no final verdict; it pays the
//!    researcher. `expire`: anyone may call it after the bounty's expiry; if nothing was paid it refunds
//!    the vendor, and it sends the bounty's collected attempt fees to the registered verifiers.
//!
//! Attempt fees: every counted commit costs a fee, taken from the committer's credit inside this
//! contract. Credit is added with `deposit_credit` (attach NEAR, from a normal key). An AI agent's
//! function call key cannot attach NEAR, so it can only spend credit here, never the wallet behind it.
//! `withdraw_credit` needs 1 yoctoNEAR attached, which a function call key cannot do, so an agent key
//! cannot take the credit out either. The fee for a bounty's n-th commit (n from 0) is
//! `attempt_fee + n * fee_step`, both set by the vendor.
//!
//! The contract never sees the secret exploit and never checks a patch itself. It only checks who
//! called, with which values, and when. Times are block timestamps in nanoseconds.
//! Verifiers are registered accounts (by the owner); an attestation is a call to `attest` signed by that
//! verifier account's own access key, so NEAR's transaction signature check is the signature check.
//! Every state change writes a NEP-297 style `EVENT_JSON:` log line.
//!
//! Level 1: a bounty created with `level: 1` opens and settles through OutLayer. Anyone (normally the vendor's watch)
//! sends the RISC Zero receipt and its journal with `open_with_outlayer` (Proof 0) or `check_with_outlayer` (an
//! attempt), attaching OutLayer's fee and deposit. The contract first runs the same journal checks as Level 2 (the
//! bounty's fields, and for an attempt the submission id, the seed recorded at reveal and the revealed patch), then
//! asks OutLayer to run the verifier program the owner pinned (`set_outlayer`: an https URL and its sha256) on the
//! receipt. Only the callback of that request counts: the contract accepts the answer if it says ok and echoes the
//! image id, the submission id, the receipt hash and the sha256 of the journal it checked. PASS pays and FAIL spends the
//! attempt exactly as at Level 2; no answer, an error or a mismatch records nothing, and the timeout rule still applies.
//! One check per attempt can wait at a time. This trusts OutLayer to run the pinned program; the contract does not check
//! the proof itself.
//!
//! Level 2 (spike S6c): a bounty created with `level: 2` takes no verifier attestations at all. It opens when anyone
//! submits a Groth16 proof of its Proof 0 (`open_with_groth16`), and each revealed attempt is decided when anyone
//! submits a Groth16 proof of that attempt (`submit_groth16`). The contract checks the proof itself with NEAR's
//! alt_bn128 host functions (module `groth16`), then checks that every field of the proof's journal belongs to THIS
//! bounty and THIS attempt (original, exploit commitment, tests, counts, the seed recorded at reveal, the revealed
//! patch hash and the submission id), and reads the verdict from the journal: PASS pays, FAIL spends the attempt.
//! A proof must arrive within the verdict window after the reveal (every reveal leaves a full window before expiry);
//! without one, the
//! researcher is paid by `claim_timeout` as for Level 0. Attempt fees of a Level 2 bounty's decided attempts go to
//! the protocol fee pool at expiry (never to the vendor); fees of attempts still undecided when a bounty closes are
//! refunded as credit. Every bounty records `fuzz_count` and `variant_count`, the check's size, which a proof must match.

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::{Value, json};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, env, near, require};

mod groth16;

/// Name and version written into every event log line.
const EVENT_STANDARD: &str = "kintsugi";
const EVENT_VERSION: &str = "1.0.0";
/// Domain tag at the start of every commit fingerprint, so the hash cannot be confused with another one.
pub const COMMIT_DOMAIN: &[u8] = b"kintsugi-commit-v1";
/// Upper limits a vendor may choose per bounty (they bound storage the contract pays for).
pub const MAX_PATCH_BYTES_CAP: u32 = 4096;
pub const MAX_COMMITS_CAP: u32 = 16;
/// Smallest bounty accepted, so empty bounties cannot fill storage for free.
pub const MIN_BOUNTY: NearToken = NearToken::from_millinear(100);
/// Longest reveal, verdict or attestation window (30 days) and longest life of a bounty (366 days). Without caps a
/// vendor could choose a window so long that a deadline never comes (audit round 1).
pub const MAX_WINDOW_NS: u64 = 30 * 24 * 3600 * 1_000_000_000;
pub const MAX_EXPIRY_NS: u64 = 366 * 24 * 3600 * 1_000_000_000;
/// Number of different registered verifiers whose matching attestations make a verdict final.
pub const ATTESTATIONS_TO_FINALIZE: usize = 2;
/// Domain tag of the submission id that the proof's journal must carry.
pub const SUBMISSION_DOMAIN: &[u8] = b"kintsugi-submission-v1";
/// Storage key of the OutLayer settings. Kept outside the main state so adding them does not change
/// the layout of contract state that is already deployed.
const OUTLAYER_KEY: &[u8] = b"OUTLAYER";
/// Raw storage key of the protocol fee pool (a u128 in yoctoNEAR, little-endian): the attempt fees of commits that were
/// never revealed. Kept outside the contract's state struct so the stored layout does not change. There is no way to
/// take NEAR out of the pool yet; its destination is deliberately left open (docs/SECURITY.md).
const POOL_KEY: &[u8] = b"PROTOCOL_POOL";
/// Raw storage key of the owner's allowlist of checker image ids (borsh `Vec<[u8; 32]>`). While it is empty any image id is
/// accepted (the state before audit round 1); once it holds an id, `create_bounty` refuses every other id, so a Level 2
/// verdict can only come from a published checker (audit finding: the vendor chose the program).
const ALLOWED_IMAGE_IDS_KEY: &[u8] = b"ALLOWED_IMAGE_IDS";
/// Raw storage key prefix of an account's agent limits (audit hardening S6): the prefix, then the account id; the value is
/// borsh `AgentLimits`. Raw keys keep the stored contract layout unchanged.
const AGENT_LIMITS_PREFIX: &[u8] = b"AGENT_LIMITS:";
/// Raw storage key prefixes of the per-account cap (Task 5): `ACCOUNT_CAP:` + bounty id (u64 LE) holds a bounty's
/// `max_commits_per_account` (borsh u32), set only at creation; `ACCOUNT_SLOTS:` + bounty id (u64 LE) + account id holds how
/// many of that bounty's slots the account holds now (borsh u32; committed and not released). Only bounties created with a
/// cap have these entries, so every older bounty works exactly as before. Raw keys keep the stored layout unchanged.
const ACCOUNT_CAP_PREFIX: &[u8] = b"ACCOUNT_CAP:";
const ACCOUNT_SLOTS_PREFIX: &[u8] = b"ACCOUNT_SLOTS:";
/// Domain tag of the submission id a Proof 0 journal carries: sha256(PROOF0_DOMAIN || reference fix hash), as in
/// harness/checker/src/zk.rs.
pub const PROOF0_DOMAIN: &[u8] = b"kintsugi-proof0-v1";
/// Bounty levels: 0 = verdicts need two verifier attestations; 1 = verdicts come from OutLayer running the pinned
/// verifier program on the receipt; 2 = verdicts come only from a Groth16 proof the contract checks itself.
pub const LEVEL_0: u8 = 0;
pub const LEVEL_1: u8 = 1;
pub const LEVEL_2: u8 = 2;
/// Raw storage key prefix of a Level 1 check waiting for OutLayer: the prefix, then bounty id (u64 LE) and the attempt
/// index (u32 LE; `PROOF0_INDEX` for Proof 0). The value is borsh `OutLayerCheck`. Raw keys keep the stored layout of
/// bounties and submissions unchanged.
const OUTLAYER_CHECK_PREFIX: &[u8] = b"OUTLAYER_CHECK:";
/// The index a Proof 0 check is stored under.
pub const PROOF0_INDEX: u32 = u32::MAX;
/// A waiting check older than this may be replaced (OutLayer cancels a request after 10 minutes).
pub const OUTLAYER_STALE_NS: u64 = 20 * 60 * 1_000_000_000;
/// Gas sent with the OutLayer request (it reserves its own callback gas from this) and kept for ours.
const OUTLAYER_REQUEST_GAS: Gas = Gas::from_tgas(150);
const OUTLAYER_CALLBACK_GAS: Gas = Gas::from_tgas(30);

/// Where OutLayer runs and which exact program it must run.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutLayerConfig {
    /// The OutLayer contract, for example `outlayer.testnet`.
    pub account_id: AccountId,
    /// https URL of the verifier wasm and its sha256 (64 hex); OutLayer's worker refuses other bytes. Callers cannot
    /// name another program: every request carries these two values.
    pub wasm_url: String,
    pub wasm_sha256: String,
    /// For example `wasm32-wasip1`.
    pub build_target: String,
    pub max_instructions: U64,
    pub max_memory_mb: u32,
    pub max_execution_seconds: U64,
    /// The least a caller must attach: OutLayer's fee plus the deposit it holds for a receipt-sized input (returned
    /// to the caller when the job ends). Below it OutLayer would refuse the request at the door.
    pub min_deposit: U128,
}

/// A Level 1 check waiting for OutLayer's answer. The journal was checked against the bounty (and attempt) when the
/// check was asked; the answer must echo its sha256 and the receipt hash.
#[near(serializers = [borsh])]
pub struct OutLayerCheck {
    asker: AccountId,
    deposit: u128,
    journal_hash: [u8; 32],
    receipt_hash: [u8; 32],
    verdict: Verdict,
    requested_at_ns: u64,
}

/// A waiting Level 1 check, as `get_outlayer_check` returns it.
#[near(serializers = [json])]
pub struct OutLayerCheckView {
    pub asker: AccountId,
    pub deposit: U128,
    pub journal_hash: String,
    pub receipt_hash: String,
    pub verdict: Verdict,
    pub requested_at_ns: U64,
}

fn outlayer_check_key(bounty_id: u64, index: u32) -> Vec<u8> {
    let mut k = OUTLAYER_CHECK_PREFIX.to_vec();
    k.extend_from_slice(&bounty_id.to_le_bytes());
    k.extend_from_slice(&index.to_le_bytes());
    k
}

fn outlayer_check(bounty_id: u64, index: u32) -> Option<OutLayerCheck> {
    env::storage_read(&outlayer_check_key(bounty_id, index)).map(|b| near_sdk::borsh::from_slice(&b).expect("stored check decodes"))
}

/// The submission id a proof's journal must carry:
/// sha256( "kintsugi-submission-v1" || len(contract account) as u32 LE || contract account || bounty id as
/// u64 LE || index as u32 LE || sha256(patch) ).
pub fn submission_id(contract: &AccountId, bounty_id: u64, index: u32, patch_hash: &[u8; 32]) -> [u8; 32] {
    let c = contract.as_str().as_bytes();
    let mut buf = Vec::with_capacity(SUBMISSION_DOMAIN.len() + 4 + c.len() + 12 + 32);
    buf.extend_from_slice(SUBMISSION_DOMAIN);
    buf.extend_from_slice(&(c.len() as u32).to_le_bytes());
    buf.extend_from_slice(c);
    buf.extend_from_slice(&bounty_id.to_le_bytes());
    buf.extend_from_slice(&index.to_le_bytes());
    buf.extend_from_slice(patch_hash);
    env::sha256_array(&buf)
}

/// The submission id a Proof 0 journal carries: sha256(PROOF0_DOMAIN || reference fix hash).
pub fn proof0_id(reference_fix_hash: &[u8; 32]) -> [u8; 32] {
    let mut b = PROOF0_DOMAIN.to_vec();
    b.extend_from_slice(reference_fix_hash);
    env::sha256_array(&b)
}

fn allowed_image_ids() -> Vec<[u8; 32]> {
    // A stored list that does not decode is a fault, not permission: fail closed (audit round 2).
    env::storage_read(ALLOWED_IMAGE_IDS_KEY)
        .map(|b| near_sdk::borsh::from_slice::<Vec<[u8; 32]>>(&b).unwrap_or_else(|_| env::panic_str("the image id allowlist does not decode")))
        .unwrap_or_default()
}

fn image_id_allowed(image_id: &[u8; 32]) -> bool {
    let list = allowed_image_ids();
    list.is_empty() || list.contains(image_id)
}

/// Limits an account sets on its own commits, so that a key that may only call `commit` and `reveal` (a function call
/// key given to an agent) cannot spend more per attempt than the owner chose, nor send winnings anywhere else.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct AgentLimits {
    /// The largest attempt fee one commit may take from this account's credit (yoctoNEAR); none means no limit.
    pub max_fee_per_commit: Option<U128>,
    /// When set, every commit by this account must name this payout account.
    pub fixed_payout: Option<AccountId>,
}

fn agent_limits_key(account: &AccountId) -> Vec<u8> {
    [AGENT_LIMITS_PREFIX, account.as_str().as_bytes()].concat()
}

fn agent_limits(account: &AccountId) -> AgentLimits {
    env::storage_read(&agent_limits_key(account))
        .map(|b| near_sdk::borsh::from_slice::<AgentLimits>(&b).unwrap_or_else(|_| env::panic_str("the agent limits do not decode")))
        .unwrap_or_default()
}

fn account_cap_key(bounty_id: u64) -> Vec<u8> {
    [ACCOUNT_CAP_PREFIX, &bounty_id.to_le_bytes()].concat()
}

/// A bounty's cap on the slots one account may hold (none for bounties created without one, and for every older bounty).
fn account_cap(bounty_id: u64) -> Option<u32> {
    env::storage_read(&account_cap_key(bounty_id))
        .map(|b| near_sdk::borsh::from_slice::<u32>(&b).unwrap_or_else(|_| env::panic_str("the account cap does not decode")))
}

fn account_slots_key(bounty_id: u64, account: &AccountId) -> Vec<u8> {
    [ACCOUNT_SLOTS_PREFIX, &bounty_id.to_le_bytes(), account.as_str().as_bytes()].concat()
}

/// How many slots of a capped bounty `account` holds now (committed and not released).
fn account_slots(bounty_id: u64, account: &AccountId) -> u32 {
    env::storage_read(&account_slots_key(bounty_id, account))
        .map(|b| near_sdk::borsh::from_slice::<u32>(&b).unwrap_or_else(|_| env::panic_str("the account slot count does not decode")))
        .unwrap_or(0)
}

fn set_account_slots(bounty_id: u64, account: &AccountId, n: u32) {
    if n == 0 {
        env::storage_remove(&account_slots_key(bounty_id, account));
    } else {
        env::storage_write(&account_slots_key(bounty_id, account), &near_sdk::borsh::to_vec(&n).unwrap());
    }
}

fn pool_balance() -> u128 {
    env::storage_read(POOL_KEY).map(|b| u128::from_le_bytes(b.try_into().unwrap_or([0; 16]))).unwrap_or(0)
}

/// The one rule for the fee of a commit that was never revealed: the commit is released (its slot freed), and its fee
/// leaves the bounty's collected fees for the protocol fee pool, so it is never paid to the vendor, a researcher or a
/// verifier. Used by `release_unrevealed` and, for commits still unreleased at the end, by `expire`.
fn release_to_pool(bounty_id: U64, index: u32, bounty: &mut Bounty, sub: &mut Submission) {
    sub.outcome = Outcome::Released;
    bounty.active = bounty.active.saturating_sub(1);
    if account_cap(bounty_id.0).is_some() {
        // A released commit frees its account's share of the cap too (Task 5).
        set_account_slots(bounty_id.0, &sub.committer, account_slots(bounty_id.0, &sub.committer).saturating_sub(1));
    }
    bounty.fees_collected = bounty.fees_collected.saturating_sub(sub.fee);
    let pool = add_to_pool(sub.fee);
    emit("fee_to_pool", json!({ "bounty_id": bounty_id, "index": index, "fee": U128(sub.fee.as_yoctonear()), "pool": U128(pool) }));
}

/// Audit round 1, fix 3: the earliest reveal has priority. True if some other submission of the bounty was revealed
/// before `revealed_at` and is still undecided (outcome Open). A PASS or a timeout for a later reveal must wait until
/// every earlier reveal is decided or timed out, so copying a revealed patch into a second account cannot jump the queue.
fn earlier_reveal_undecided(subs: &LookupMap<(u64, u32), Submission>, bounty_id: u64, commits: u32, index: u32, revealed_at: u64) -> bool {
    (0..commits).filter(|k| *k != index).any(|k| {
        subs.get(&(bounty_id, k))
            // Reveals in the same block tie on time; the lower index (the earlier commit) then counts as earlier, so
            // the order is total and a copy revealed in the same block as the original never jumps ahead (audit round 2).
            .is_some_and(|o| o.outcome == Outcome::Open && o.revealed_at_ns.is_some_and(|t| t < revealed_at || (t == revealed_at && k < index)))
    })
}

/// Adds `amount` to the protocol fee pool (see `POOL_KEY`).
fn add_to_pool(amount: NearToken) -> u128 {
    let pool = pool_balance().saturating_add(amount.as_yoctonear());
    env::storage_write(POOL_KEY, &pool.to_le_bytes());
    pool
}

/// Audit round 1, fix 4: when a bounty closes on a PASS for `winner`, every other revealed attempt that is
/// still undecided gets its attempt fee back as credit: it was never judged, so its fee is neither kept nor swept.
/// It stays `Open` in the view (no final outcome exists for it) but no longer counts in `pending`.
fn refund_undecided_revealed(
    subs: &mut LookupMap<(u64, u32), Submission>,
    credits: &mut LookupMap<AccountId, NearToken>,
    bounty_id: u64,
    bounty: &mut Bounty,
    winner: u32,
) {
    for k in 0..bounty.commits {
        if k == winner {
            continue;
        }
        if let Some(o) = subs.get_mut(&(bounty_id, k)) {
            if o.outcome == Outcome::Open && o.revealed_at_ns.is_some() {
                // No longer waiting for a verdict: the bounty is closed (final review of the hardening round).
                bounty.pending = bounty.pending.saturating_sub(1);
            }
            if o.outcome == Outcome::Open && o.revealed_at_ns.is_some() && o.fee.as_yoctonear() > 0 {
                let fee = o.fee;
                o.fee = NearToken::from_yoctonear(0);
                bounty.fees_collected = bounty.fees_collected.saturating_sub(fee);
                let had = credits.get(&o.committer).copied().unwrap_or(NearToken::from_yoctonear(0));
                credits.insert(o.committer.clone(), had.saturating_add(fee));
                emit("fee_refunded", json!({ "bounty_id": U64(bounty_id), "index": k, "to": o.committer, "fee": U128(fee.as_yoctonear()), "reason": "undecided when the bounty closed" }));
            }
        }
    }
}

/// The journal fields that are the same for every proof of one bounty. Level 1 and Level 2 share this and the two
/// functions below, so their binding checks cannot drift apart.
fn bounty_fields_problem(bounty: &Bounty, j: &groth16::Journal) -> Option<&'static str> {
    if j.original_hash != bounty.original_hash {
        return Some("the journal's original is not this bounty's");
    }
    if j.exploit_commitment != bounty.exploit_commitment {
        return Some("the journal's exploit commitment is not this bounty's");
    }
    if j.corpus_hash != bounty.corpus_hash {
        return Some("the journal's tests are not this bounty's");
    }
    if j.fuzz_count != bounty.fuzz_count || j.variant_count != bounty.variant_count {
        return Some("the journal's check size is not this bounty's");
    }
    None
}

/// The checks that make a journal this bounty's Proof 0: the bounty's fields, the journal sha256 fixed at creation, the
/// reference fix as candidate, the Proof 0 id and PASS.
fn proof0_journal_problem(bounty: &Bounty, journal: &[u8], j: &groth16::Journal) -> Option<&'static str> {
    if let Some(e) = bounty_fields_problem(bounty, j) {
        return Some(e);
    }
    if env::sha256_array(journal) != bounty.proof0_journal_hash {
        return Some("the journal is not this bounty's Proof 0 journal");
    }
    if j.candidate_hash != bounty.reference_fix_hash {
        return Some("the journal's candidate is not this bounty's reference fix");
    }
    if j.submission_id != proof0_id(&bounty.reference_fix_hash) {
        return Some("the journal is not a Proof 0 journal");
    }
    if j.verdict != 1 {
        return Some("the Proof 0 verdict is not PASS");
    }
    None
}

/// The checks that tie a journal to THIS revealed attempt: the submission id (contract, bounty, index, patch hash), the
/// seed recorded at reveal, the revealed patch as candidate, and the bounty's fields.
fn attempt_journal_problem(bounty_id: u64, index: u32, bounty: &Bounty, sub: &Submission, j: &groth16::Journal) -> Option<&'static str> {
    let Some(patch_hash) = sub.patch_hash else { return Some("submission not revealed") };
    if j.submission_id != submission_id(&env::current_account_id(), bounty_id, index, &patch_hash) {
        return Some("the journal belongs to another bounty or attempt (submission id)");
    }
    if Some(j.fuzz_seed) != sub.seed {
        return Some("the journal's seed is not the seed recorded at reveal");
    }
    if j.candidate_hash != patch_hash {
        return Some("the journal's candidate is not the revealed patch");
    }
    bounty_fields_problem(bounty, j)
}

/// The message a method gives when a bounty of another level reaches it.
fn wrong_level(level: u8) -> &'static str {
    match level {
        LEVEL_0 => "this is a Level 0 bounty: verdicts need two verifier attestations",
        LEVEL_1 => "this is a Level 1 bounty: it opens and settles only through the OutLayer check",
        _ => "this is a Level 2 bounty: verdicts come only from a Groth16 proof",
    }
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Bounties,
    Submissions,
    Verifiers,
    Vendors,
    Credits,
}

/// Where a bounty stands. `Paid` covers both a final PASS and a timeout payout.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BountyState {
    Open,
    Paid,
    Refunded,
}

/// The only two verdicts that are ever published.
#[near(serializers = [borsh, json])]
#[serde(rename_all = "UPPERCASE")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Verdict {
    Pass,
    Fail,
}

/// Where one submission stands.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    /// Committed or revealed, no final verdict yet.
    Open,
    /// Final PASS: the payout account was paid.
    Passed,
    /// Final FAIL: the attempt is spent, nothing paid.
    Failed,
    /// Deadline passed without a final verdict: the payout account was paid.
    TimedOut,
    /// Not revealed within the reveal window; its slot was freed by `release_unrevealed`.
    Released,
}

#[near(serializers = [borsh])]
pub struct Bounty {
    vendor: AccountId,
    amount: NearToken,
    original_hash: [u8; 32],
    corpus_hash: [u8; 32],
    image_id: [u8; 32],
    exploit_commitment: [u8; 32],
    proof0_receipt_hash: [u8; 32],
    max_commits: u32,
    max_patch_bytes: u32,
    reveal_gap_ns: u64,
    verdict_window_ns: u64,
    attest_window_ns: u64,
    created_at_ns: u64,
    expires_at_ns: u64,
    state: BountyState,
    commits: u32,
    /// Revealed submissions with no final verdict and no timeout yet. `expire` waits for these.
    pending: u32,
    winner: Option<u32>,
    /// Fee for the first counted commit.
    attempt_fee: NearToken,
    /// Added to the fee for each later commit.
    fee_step: NearToken,
    /// Attempt fees of decided attempts, held by the contract until `expire` sends them to the verifiers (Level 0) or the
    /// protocol fee pool (Level 2); fees of undecided attempts are refunded when the bounty closes.
    fees_collected: NearToken,
    fees_swept: bool,
    /// sha256 of the vendor's reference fix, fixed at creation; Proof 0 must show it passes.
    reference_fix_hash: [u8; 32],
    /// Hashes of the Proof 0 journal and receipt that verifiers attest before the bounty opens.
    proof0_journal_hash: [u8; 32],
    proof0_attestations: Vec<AccountId>,
    /// True once two different registered verifiers attested Proof 0. Commits need it.
    opened: bool,
    /// A commit must be revealed within this many nanoseconds, or its slot can be released.
    reveal_window_ns: u64,
    /// Slots in use (committed and not released). K (max_commits) applies to this.
    active: u32,
    /// 0: verdicts need two verifier attestations; 2: verdicts come only from a Groth16 proof checked here.
    level: u8,
    /// The size of the check every proof for this bounty must have (fairness inputs, crash variants).
    fuzz_count: u32,
    variant_count: u32,
}

#[near(serializers = [borsh])]
pub struct PostedVerdict {
    verdict: Verdict,
    journal_hash: [u8; 32],
    receipt_hash: [u8; 32],
    posted_at_ns: u64,
}

#[near(serializers = [borsh])]
pub struct Submission {
    committer: AccountId,
    payout: AccountId,
    fingerprint: [u8; 32],
    committed_at_ns: u64,
    patch: Option<Vec<u8>>,
    patch_hash: Option<[u8; 32]>,
    revealed_at_ns: Option<u64>,
    seed: Option<[u8; 32]>,
    verdict: Option<PostedVerdict>,
    attestations: Vec<AccountId>,
    outcome: Outcome,
    /// The attempt fee this commit paid (refunded to the payout account if this submission is paid).
    fee: NearToken,
}

#[near(serializers = [borsh])]
pub struct VerifierInfo {
    label: String,
    registered_at_ns: u64,
}

/// JSON view of a bounty (hashes as lowercase hex, amounts in yoctoNEAR, times in nanoseconds).
#[near(serializers = [json])]
pub struct BountyView {
    pub id: U64,
    pub vendor: AccountId,
    pub amount: U128,
    pub original_hash: String,
    pub corpus_hash: String,
    pub image_id: String,
    pub exploit_commitment: String,
    pub proof0_receipt_hash: String,
    pub max_commits: u32,
    pub max_patch_bytes: u32,
    pub reveal_gap_ns: U64,
    pub verdict_window_ns: U64,
    pub attest_window_ns: U64,
    pub created_at_ns: U64,
    pub expires_at_ns: U64,
    pub state: BountyState,
    pub commits: u32,
    pub pending: u32,
    pub winner: Option<u32>,
    pub attempt_fee: U128,
    pub fee_step: U128,
    pub fees_collected: U128,
    pub fees_swept: bool,
    /// The fee the next counted commit will cost.
    pub next_fee: U128,
    pub reference_fix_hash: String,
    pub proof0_journal_hash: String,
    pub proof0_attestations: Vec<AccountId>,
    pub opened: bool,
    pub reveal_window_ns: U64,
    pub active: u32,
    /// 0: verdicts need two verifier attestations; 2: verdicts come only from a Groth16 proof checked by this contract.
    pub level: u8,
    pub fuzz_count: u32,
    pub variant_count: u32,
    /// True if the bounty's image id is on the owner's allowlist of published checkers (or the list is empty).
    pub image_id_allowed: bool,
    /// The most slots one account may hold at a time (committed and not released); none for bounties without a cap.
    pub max_commits_per_account: Option<u32>,
}

/// JSON view of a submission.
#[near(serializers = [json])]
pub struct SubmissionView {
    pub bounty_id: U64,
    pub index: u32,
    pub committer: AccountId,
    pub payout: AccountId,
    pub fingerprint: String,
    pub committed_at_ns: U64,
    pub patch: Option<Base64VecU8>,
    pub patch_hash: Option<String>,
    pub revealed_at_ns: Option<U64>,
    pub seed: Option<String>,
    pub verdict: Option<Verdict>,
    pub journal_hash: Option<String>,
    pub receipt_hash: Option<String>,
    pub verdict_posted_at_ns: Option<U64>,
    pub attestations: Vec<AccountId>,
    pub outcome: Outcome,
    /// After this time (if the outcome is still Open) anyone may call `claim_timeout`.
    pub deadline_ns: Option<U64>,
    /// The attempt fee this commit paid, in yoctoNEAR.
    pub fee: U128,
}

#[near(serializers = [json])]
pub struct VerifierView {
    pub account_id: AccountId,
    pub label: String,
    pub registered_at_ns: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    next_bounty_id: u64,
    bounties: LookupMap<u64, Bounty>,
    submissions: LookupMap<(u64, u32), Submission>,
    verifiers: IterableMap<AccountId, VerifierInfo>,
    /// Every account that ever created a bounty. These can never be registered as verifiers.
    vendors: LookupSet<AccountId>,
    /// Prepaid credit per account, spent on attempt fees.
    credits: LookupMap<AccountId, NearToken>,
}

/// The commit fingerprint. Byte layout (all lengths little endian u32):
/// sha256( "kintsugi-commit-v1" || len(patch) || patch || len(payout) || payout as UTF-8 || nonce (32 bytes) )
pub fn commit_fingerprint(patch: &[u8], payout: &AccountId, nonce: &[u8; 32]) -> [u8; 32] {
    let payout = payout.as_str().as_bytes();
    let mut buf = Vec::with_capacity(COMMIT_DOMAIN.len() + 8 + patch.len() + payout.len() + 32);
    buf.extend_from_slice(COMMIT_DOMAIN);
    buf.extend_from_slice(&(patch.len() as u32).to_le_bytes());
    buf.extend_from_slice(patch);
    buf.extend_from_slice(&(payout.len() as u32).to_le_bytes());
    buf.extend_from_slice(payout);
    buf.extend_from_slice(nonce);
    env::sha256_array(&buf)
}

fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 15) as usize] as char);
    }
    s
}

/// Parse a 32 byte value written as 64 hex characters, or stop the call with a clear message.
fn parse_hash(field: &str, hex: &str) -> [u8; 32] {
    let raw = hex.as_bytes();
    if raw.len() != 64 {
        env::panic_str(&format!("{field} must be 64 hex characters"));
    }
    let nibble = |c: u8| -> u8 {
        match c {
            b'0'..=b'9' => c - b'0',
            b'a'..=b'f' => c - b'a' + 10,
            b'A'..=b'F' => c - b'A' + 10,
            _ => env::panic_str(&format!("{field} must be 64 hex characters")),
        }
    };
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = (nibble(raw[2 * i]) << 4) | nibble(raw[2 * i + 1]);
    }
    out
}

fn emit(event: &str, data: Value) {
    let line = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{line}"));
}

fn verdict_str(v: Verdict) -> &'static str {
    match v {
        Verdict::Pass => "PASS",
        Verdict::Fail => "FAIL",
    }
}

impl Bounty {
    /// Fee for the next counted commit: `attempt_fee + commits * fee_step`.
    fn next_fee(&self) -> NearToken {
        let step = self.fee_step.as_yoctonear().saturating_mul(self.commits as u128);
        NearToken::from_yoctonear(self.attempt_fee.as_yoctonear().saturating_add(step))
    }
}

impl Submission {
    /// The time after which a still open, revealed submission can be timed out:
    /// the end of the attestation window if a verdict was posted, else the end of the verdict window.
    fn deadline_ns(&self, bounty: &Bounty) -> Option<u64> {
        let revealed = self.revealed_at_ns?;
        Some(match &self.verdict {
            Some(v) => v.posted_at_ns.saturating_add(bounty.attest_window_ns),
            None => revealed.saturating_add(bounty.verdict_window_ns),
        })
    }
}

#[near]
impl Contract {
    /// Set up the contract. `ignore_state` lets this replace any older state on the account (S3 used it to
    /// replace the S0 hello world state; calling it again wipes all bounties, so later code updates deploy
    /// without an init call). `private` means only the contract account itself can call it (the deploy
    /// transaction is signed by that account), so nobody else can reset the state.
    #[init(ignore_state)]
    #[private]
    pub fn new(owner: AccountId) -> Self {
        emit("init", json!({ "owner": owner }));
        Self {
            owner,
            next_bounty_id: 0,
            bounties: LookupMap::new(StorageKey::Bounties),
            submissions: LookupMap::new(StorageKey::Submissions),
            verifiers: IterableMap::new(StorageKey::Verifiers),
            vendors: LookupSet::new(StorageKey::Vendors),
            credits: LookupMap::new(StorageKey::Credits),
        }
    }

    // ---------- owner ----------

    /// Owner only. Registers a verifier account with a label saying who runs it.
    /// Refuses any account that has created a bounty, so a vendor can never confirm its own verdicts.
    pub fn register_verifier(&mut self, account_id: AccountId, label: String) {
        require!(env::predecessor_account_id() == self.owner, "only the owner can register verifiers");
        require!(!self.vendors.contains(&account_id), "a vendor account cannot be a verifier");
        require!(!self.verifiers.contains_key(&account_id), "verifier already registered");
        require!(!label.is_empty() && label.len() <= 128, "label must be 1 to 128 bytes");
        let now = env::block_timestamp();
        emit("verifier_registered", json!({ "account_id": account_id, "label": label }));
        self.verifiers.insert(account_id, VerifierInfo { label, registered_at_ns: now });
    }

    // ---------- vendor ----------

    /// The vendor attaches the bounty amount. Hashes are 64 hex characters each. Window lengths are in
    /// nanoseconds: `reveal_gap_ns` (commit to earliest reveal), `verdict_window_ns` (reveal to latest
    /// verdict), `attest_window_ns` (verdict to latest attestation), `expiry_ns` (creation to expiry).
    /// `attempt_fee` and `fee_step` are in yoctoNEAR: the n-th counted commit (n from 0) costs
    /// `attempt_fee + n * fee_step`, paid from the committer's credit. `attempt_fee` must be above zero.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn create_bounty(
        &mut self,
        original_hash: String,
        corpus_hash: String,
        image_id: String,
        exploit_commitment: String,
        proof0_receipt_hash: String,
        max_commits: u32,
        max_patch_bytes: u32,
        reveal_gap_ns: U64,
        verdict_window_ns: U64,
        attest_window_ns: U64,
        expiry_ns: U64,
        attempt_fee: U128,
        fee_step: U128,
        reference_fix_hash: String,
        proof0_journal_hash: String,
        reveal_window_ns: U64,
        fuzz_count: u32,
        variant_count: u32,
        level: Option<u8>,
        max_commits_per_account: Option<u32>,
    ) -> U64 {
        let vendor = env::predecessor_account_id();
        let amount = env::attached_deposit();
        require!(amount >= MIN_BOUNTY, "attach at least 0.1 NEAR as the bounty");
        require!(!self.verifiers.contains_key(&vendor), "a registered verifier cannot be a vendor");
        require!((1..=MAX_COMMITS_CAP).contains(&max_commits), "max_commits must be 1 to 16");
        require!((1..=MAX_PATCH_BYTES_CAP).contains(&max_patch_bytes), "max_patch_bytes must be 1 to 4096");
        require!(verdict_window_ns.0 > 0 && attest_window_ns.0 > 0 && expiry_ns.0 > 0, "windows must be above zero");
        require!(
            reveal_window_ns.0 <= MAX_WINDOW_NS && verdict_window_ns.0 <= MAX_WINDOW_NS && attest_window_ns.0 <= MAX_WINDOW_NS,
            "a window may be at most 30 days"
        );
        require!(expiry_ns.0 <= MAX_EXPIRY_NS, "expiry_ns may be at most 366 days");
        require!(
            expiry_ns.0 >= reveal_gap_ns.0.saturating_add(reveal_window_ns.0).saturating_add(verdict_window_ns.0).saturating_add(attest_window_ns.0),
            "expiry_ns must cover the reveal gap, the reveal window, the verdict window and the attestation window"
        );
        require!(attempt_fee.0 > 0, "attempt_fee must be above zero");
        require!(reveal_gap_ns.0 > 0, "reveal_gap_ns must be above zero: a commit and its reveal cannot share a block");
        require!(reveal_window_ns.0 > reveal_gap_ns.0, "reveal_window_ns must be longer than reveal_gap_ns");
        let level = level.unwrap_or(LEVEL_0);
        require!(level == LEVEL_0 || level == LEVEL_1 || level == LEVEL_2, "level must be 0, 1 or 2");
        if level == LEVEL_1 {
            require!(self.get_outlayer().is_some(), "Level 1 needs the OutLayer settings: ask the owner to set them (set_outlayer)");
        }
        require!(fuzz_count > 0 && variant_count > 0, "fuzz_count and variant_count must be above zero");
        let image = parse_hash("image_id", &image_id);
        require!(image_id_allowed(&image), "image_id is not an allowed checker: ask the owner to allow it (allow_image_id)");
        if let Some(cap) = max_commits_per_account {
            require!((1..=max_commits).contains(&cap), "max_commits_per_account must be 1 to max_commits");
        }
        let now = env::block_timestamp();
        let bounty = Bounty {
            vendor: vendor.clone(),
            amount,
            original_hash: parse_hash("original_hash", &original_hash),
            corpus_hash: parse_hash("corpus_hash", &corpus_hash),
            image_id: parse_hash("image_id", &image_id),
            exploit_commitment: parse_hash("exploit_commitment", &exploit_commitment),
            proof0_receipt_hash: parse_hash("proof0_receipt_hash", &proof0_receipt_hash),
            max_commits,
            max_patch_bytes,
            reveal_gap_ns: reveal_gap_ns.0,
            verdict_window_ns: verdict_window_ns.0,
            attest_window_ns: attest_window_ns.0,
            created_at_ns: now,
            expires_at_ns: now.saturating_add(expiry_ns.0),
            state: BountyState::Open,
            commits: 0,
            pending: 0,
            winner: None,
            attempt_fee: NearToken::from_yoctonear(attempt_fee.0),
            fee_step: NearToken::from_yoctonear(fee_step.0),
            fees_collected: NearToken::from_yoctonear(0),
            fees_swept: false,
            reference_fix_hash: parse_hash("reference_fix_hash", &reference_fix_hash),
            proof0_journal_hash: parse_hash("proof0_journal_hash", &proof0_journal_hash),
            proof0_attestations: Vec::new(),
            opened: false,
            reveal_window_ns: reveal_window_ns.0,
            active: 0,
            level,
            fuzz_count,
            variant_count,
        };
        let id = self.next_bounty_id;
        self.next_bounty_id += 1;
        emit(
            "bounty_created",
            json!({
                "bounty_id": U64(id),
                "vendor": vendor,
                "amount": U128(amount.as_yoctonear()),
                "image_id": image_id.to_lowercase(),
                "exploit_commitment": exploit_commitment.to_lowercase(),
                "max_commits": max_commits,
                "attempt_fee": attempt_fee,
                "fee_step": fee_step,
                "expires_at_ns": U64(bounty.expires_at_ns),
                "max_commits_per_account": max_commits_per_account,
            }),
        );
        if let Some(cap) = max_commits_per_account {
            env::storage_write(&account_cap_key(id), &near_sdk::borsh::to_vec(&cap).unwrap());
        }
        self.vendors.insert(vendor);
        self.bounties.insert(id, bounty);
        U64(id)
    }

    /// Vendor only. Posts PASS or FAIL for one revealed submission, within the verdict window.
    pub fn post_verdict(&mut self, bounty_id: U64, index: u32, verdict: Verdict, journal_hash: String, receipt_hash: String) {
        let now = env::block_timestamp();
        let bounty = self.bounties.get(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(env::predecessor_account_id() == bounty.vendor, "only the vendor can post a verdict");
        require!(bounty.level == LEVEL_0, wrong_level(bounty.level));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        let verdict_window = bounty.verdict_window_ns;
        let sub = self
            .submissions
            .get_mut(&(bounty_id.0, index))
            .unwrap_or_else(|| env::panic_str("no such submission"));
        let revealed = sub.revealed_at_ns.unwrap_or_else(|| env::panic_str("submission not revealed"));
        require!(sub.verdict.is_none(), "verdict already posted");
        require!(now <= revealed.saturating_add(verdict_window), "verdict window has closed");
        let journal = parse_hash("journal_hash", &journal_hash);
        let receipt = parse_hash("receipt_hash", &receipt_hash);
        let (commits, id) = (bounty.commits, bounty_id.0);
        if verdict == Verdict::Pass {
            require!(!earlier_reveal_undecided(&self.submissions, id, commits, index, revealed), "an attempt revealed earlier is still undecided: decide it or time it out first");
        }
        let sub = self.submissions.get_mut(&(bounty_id.0, index)).unwrap_or_else(|| env::panic_str("no such submission"));
        sub.verdict = Some(PostedVerdict { verdict, journal_hash: journal, receipt_hash: receipt, posted_at_ns: now });
        emit(
            "verdict_posted",
            json!({
                "bounty_id": bounty_id, "index": index, "verdict": verdict_str(verdict),
                "journal_hash": to_hex(&journal), "receipt_hash": to_hex(&receipt),
            }),
        );
    }

    // ---------- researcher ----------

    /// Post a patch fingerprint (see `commit_fingerprint` for the byte layout) and the payout account.
    /// Takes the attempt fee from the committer's credit. Returns the submission index, or null when the
    /// bounty already has its K commits (the commit is ignored, nothing is stored and no fee is taken).
    pub fn commit(&mut self, bounty_id: U64, fingerprint: String, payout: AccountId) -> Option<u32> {
        let now = env::block_timestamp();
        let committer = env::predecessor_account_id();
        let fp = parse_hash("fingerprint", &fingerprint);
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(now < bounty.expires_at_ns, "bounty has expired");
        require!(
            now.saturating_add(bounty.reveal_window_ns).saturating_add(bounty.verdict_window_ns) <= bounty.expires_at_ns,
            "too close to expiry: a commit must leave time for the reveal window and the verdict window"
        );
        require!(committer != bounty.vendor, "the vendor cannot commit to its own bounty");
        require!(!self.verifiers.contains_key(&committer), "a registered verifier cannot commit");
        require!(
            !self.verifiers.contains_key(&payout) && payout != bounty.vendor && payout != env::current_account_id(),
            "the payout account cannot be a registered verifier, the vendor or this contract"
        );
        require!(bounty.opened, "bounty is not open: Proof 0 needs two verifier attestations");
        if bounty.active >= bounty.max_commits {
            emit("commit_ignored", json!({ "bounty_id": bounty_id, "committer": committer, "reason": "max_commits reached" }));
            return None;
        }
        let cap = account_cap(bounty_id.0);
        if let Some(cap) = cap {
            require!(account_slots(bounty_id.0, &committer) < cap, "this account already holds max_commits_per_account slots of this bounty");
        }
        let fee = bounty.next_fee();
        let limits = agent_limits(&committer);
        if let Some(max) = limits.max_fee_per_commit {
            require!(fee.as_yoctonear() <= max.0, "the attempt fee is above this account's max_fee_per_commit");
        }
        if let Some(fixed) = &limits.fixed_payout {
            require!(&payout == fixed, "this account's commits must use its fixed payout account");
        }
        let credit = self.credits.get(&committer).copied().unwrap_or(NearToken::from_yoctonear(0));
        require!(credit >= fee, "not enough credit for the attempt fee: call deposit_credit first");
        self.credits.insert(committer.clone(), credit.saturating_sub(fee));
        bounty.fees_collected = bounty.fees_collected.saturating_add(fee);
        let index = bounty.commits;
        bounty.commits += 1;
        bounty.active += 1;
        if cap.is_some() {
            set_account_slots(bounty_id.0, &committer, account_slots(bounty_id.0, &committer) + 1);
        }
        emit(
            "committed",
            json!({ "bounty_id": bounty_id, "index": index, "committer": committer, "payout": payout, "fingerprint": to_hex(&fp), "fee": U128(fee.as_yoctonear()) }),
        );
        self.submissions.insert(
            (bounty_id.0, index),
            Submission {
                committer,
                payout,
                fingerprint: fp,
                committed_at_ns: now,
                patch: None,
                patch_hash: None,
                revealed_at_ns: None,
                seed: None,
                verdict: None,
                attestations: Vec::new(),
                outcome: Outcome::Open,
                fee,
            },
        );
        Some(index)
    }

    /// The committer posts the patch bytes and the 32 byte nonce (64 hex characters), no earlier than
    /// the reveal gap after the commit. Records the block random seed and the reveal time.
    pub fn reveal(&mut self, bounty_id: U64, index: u32, patch: Base64VecU8, nonce: String) {
        let now = env::block_timestamp();
        let nonce = parse_hash("nonce", &nonce);
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(now < bounty.expires_at_ns, "bounty has expired");
        require!(
            now.saturating_add(bounty.verdict_window_ns) <= bounty.expires_at_ns,
            "too close to expiry: a reveal must leave a full verdict window"
        );
        let sub = self
            .submissions
            .get_mut(&(bounty_id.0, index))
            .unwrap_or_else(|| env::panic_str("no such submission"));
        require!(env::predecessor_account_id() == sub.committer, "only the committer can reveal");
        require!(sub.revealed_at_ns.is_none(), "already revealed");
        require!(sub.outcome == Outcome::Open, "this commit was released");
        require!(now <= sub.committed_at_ns.saturating_add(bounty.reveal_window_ns), "reveal window has closed");
        require!(now >= sub.committed_at_ns.saturating_add(bounty.reveal_gap_ns), "reveal gap has not passed");
        let bytes = patch.0;
        require!(!bytes.is_empty(), "patch is empty");
        require!(bytes.len() <= bounty.max_patch_bytes as usize, "patch is larger than max_patch_bytes");
        require!(commit_fingerprint(&bytes, &sub.payout, &nonce) == sub.fingerprint, "fingerprint does not match");
        let seed = env::random_seed_array();
        let patch_hash = env::sha256_array(&bytes);
        emit(
            "revealed",
            json!({
                "bounty_id": bounty_id, "index": index, "patch_hash": to_hex(&patch_hash),
                "patch_len": bytes.len(), "seed": to_hex(&seed), "revealed_at_ns": U64(now),
            }),
        );
        sub.patch = Some(bytes);
        sub.patch_hash = Some(patch_hash);
        sub.revealed_at_ns = Some(now);
        sub.seed = Some(seed);
        bounty.pending += 1;
    }

    /// Adds the attached NEAR to the credit of `account_id` (default: the caller). Credit is spent only
    /// on attempt fees in this contract.
    #[payable]
    pub fn deposit_credit(&mut self, account_id: Option<AccountId>) -> U128 {
        let amount = env::attached_deposit();
        require!(amount.as_yoctonear() > 0, "attach NEAR to deposit credit");
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        let total = self.credits.get(&account).copied().unwrap_or(NearToken::from_yoctonear(0)).saturating_add(amount);
        self.credits.insert(account.clone(), total);
        emit("credit_deposited", json!({ "account_id": account, "amount": U128(amount.as_yoctonear()), "total": U128(total.as_yoctonear()) }));
        U128(total.as_yoctonear())
    }

    /// Set (or clear, with nulls) the limits on this account's own commits (audit hardening S6). Needs exactly 1 yoctoNEAR,
    /// which a function call key cannot attach, so an agent's commit-only key cannot change them.
    #[payable]
    pub fn set_agent_limits(&mut self, max_fee_per_commit: Option<U128>, fixed_payout: Option<AccountId>) -> AgentLimits {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let limits = AgentLimits { max_fee_per_commit, fixed_payout };
        if limits == AgentLimits::default() {
            env::storage_remove(&agent_limits_key(&account));
        } else {
            env::storage_write(&agent_limits_key(&account), &near_sdk::borsh::to_vec(&limits).unwrap());
        }
        emit("agent_limits_set", json!({ "account_id": account, "max_fee_per_commit": limits.max_fee_per_commit, "fixed_payout": limits.fixed_payout }));
        limits
    }

    /// Sends `amount` of the caller's unspent credit back to the caller. Needs exactly 1 yoctoNEAR
    /// attached, which a function call key cannot attach, so an agent key cannot withdraw.
    #[payable]
    pub fn withdraw_credit(&mut self, amount: U128) -> U128 {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let credit = self.credits.get(&account).copied().unwrap_or(NearToken::from_yoctonear(0));
        let amount = NearToken::from_yoctonear(amount.0);
        require!(amount.as_yoctonear() > 0 && amount <= credit, "amount must be above zero and at most the credit");
        let left = credit.saturating_sub(amount);
        self.credits.insert(account.clone(), left);
        emit("credit_withdrawn", json!({ "account_id": account, "amount": U128(amount.as_yoctonear()), "left": U128(left.as_yoctonear()) }));
        Promise::new(account).transfer(amount).detach();
        U128(left.as_yoctonear())
    }

    /// Anyone, after the reveal window of a commit that was never revealed: frees its slot (K counts slots in
    /// use). The attempt fee is kept. Returns the number of slots now in use.
    pub fn release_unrevealed(&mut self, bounty_id: U64, index: u32) -> u32 {
        let now = env::block_timestamp();
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        let sub = self
            .submissions
            .get_mut(&(bounty_id.0, index))
            .unwrap_or_else(|| env::panic_str("no such submission"));
        require!(sub.outcome == Outcome::Open, "this submission is already final or released");
        require!(sub.revealed_at_ns.is_none(), "a revealed submission cannot be released");
        require!(now > sub.committed_at_ns.saturating_add(bounty.reveal_window_ns), "reveal window has not closed");
        release_to_pool(bounty_id, index, bounty, sub);
        emit("released", json!({ "bounty_id": bounty_id, "index": index, "active": bounty.active, "caller": env::predecessor_account_id() }));
        bounty.active
    }

    // ---------- verifiers ----------

    /// A registered verifier (never the vendor) confirms the bounty's Proof 0: it checked the Proof 0 receipt
    /// (its sha256 is `proof0_receipt_hash`) and journal (`proof0_journal_hash`): mode Proof 0, the candidate is
    /// the reference fix (`reference_fix_hash`), verdict PASS, and the image id, exploit commitment, corpus and
    /// original hashes equal the bounty's. Two different verifiers open the bounty. Returns "recorded",
    /// "duplicate" or "opened".
    pub fn attest_proof0(&mut self, bounty_id: U64, journal_hash: String, receipt_hash: String) -> String {
        let verifier = env::predecessor_account_id();
        require!(self.verifiers.contains_key(&verifier), "caller is not a registered verifier");
        let journal = parse_hash("journal_hash", &journal_hash);
        let receipt = parse_hash("receipt_hash", &receipt_hash);
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(verifier != bounty.vendor, "the vendor cannot attest");
        require!(bounty.level == LEVEL_0, wrong_level(bounty.level));
        require!(!bounty.opened, "bounty is already open");
        require!(
            bounty.proof0_journal_hash == journal && bounty.proof0_receipt_hash == receipt,
            "attestation does not match the bounty's Proof 0"
        );
        if bounty.proof0_attestations.contains(&verifier) {
            emit("proof0_attest_duplicate", json!({ "bounty_id": bounty_id, "verifier": verifier }));
            return "duplicate".to_string();
        }
        bounty.proof0_attestations.push(verifier.clone());
        emit("proof0_attested", json!({ "bounty_id": bounty_id, "verifier": verifier, "count": bounty.proof0_attestations.len() }));
        if bounty.proof0_attestations.len() < ATTESTATIONS_TO_FINALIZE {
            return "recorded".to_string();
        }
        bounty.opened = true;
        emit("bounty_opened", json!({ "bounty_id": bounty_id }));
        "opened".to_string()
    }

    /// A registered verifier confirms the posted verdict, journal hash and receipt hash. The verdict
    /// becomes final with matching attestations from two different registered verifiers; a repeat
    /// attestation by the same verifier counts once. Returns "recorded", "duplicate", "final_pass" or
    /// "final_fail".
    pub fn attest(&mut self, bounty_id: U64, index: u32, verdict: Verdict, journal_hash: String, receipt_hash: String) -> String {
        let verifier = env::predecessor_account_id();
        let journal = parse_hash("journal_hash", &journal_hash);
        let receipt = parse_hash("receipt_hash", &receipt_hash);
        self.record_attestation(bounty_id, index, verifier, verdict, journal, receipt)
    }

    // ---------- Level 1: OutLayer runs the pinned verifier program ----------

    /// Owner only. Sets the OutLayer contract and the exact verifier program every Level 1 request carries (an https
    /// URL and its sha256), the resource limits and the least deposit a caller must attach.
    pub fn set_outlayer(&mut self, config: OutLayerConfig) {
        require!(env::predecessor_account_id() == self.owner, "only the owner can set OutLayer");
        parse_hash("wasm_sha256", &config.wasm_sha256);
        require!(config.wasm_url.starts_with("https://"), "wasm_url must be https");
        require!(!config.build_target.is_empty(), "build_target must be set");
        require!(config.min_deposit.0 > 0, "min_deposit must be above zero");
        emit("outlayer_set", json!({ "config": config }));
        env::storage_write(OUTLAYER_KEY, &near_sdk::borsh::to_vec(&config).expect("config serializes"));
    }

    pub fn get_outlayer(&self) -> Option<OutLayerConfig> {
        env::storage_read(OUTLAYER_KEY).map(|b| near_sdk::borsh::from_slice(&b).expect("stored config decodes"))
    }

    /// The submission id the journal of a proof for this submission must carry (64 hex), once revealed.
    pub fn get_submission_id(&self, bounty_id: U64, index: u32) -> Option<String> {
        let sub = self.submissions.get(&(bounty_id.0, index))?;
        let patch_hash = sub.patch_hash?;
        Some(to_hex(&submission_id(&env::current_account_id(), bounty_id.0, index, &patch_hash)))
    }

    /// The Level 1 check waiting for OutLayer on an attempt (`index`) or on Proof 0 (no index), if any.
    pub fn get_outlayer_check(&self, bounty_id: U64, index: Option<u32>) -> Option<OutLayerCheckView> {
        outlayer_check(bounty_id.0, index.unwrap_or(PROOF0_INDEX)).map(|c| OutLayerCheckView {
            asker: c.asker,
            deposit: U128(c.deposit),
            journal_hash: to_hex(&c.journal_hash),
            receipt_hash: to_hex(&c.receipt_hash),
            verdict: c.verdict,
            requested_at_ns: U64(c.requested_at_ns),
        })
    }

    /// Level 1 bounties only. Anyone, attaching at least `min_deposit`: opens the bounty with its Proof 0. The journal
    /// must pass the same checks as at Level 2 (`open_with_groth16`); then OutLayer runs the pinned verifier program on
    /// the receipt (bincode, base64; `receipt_sha256` is the sha256 of its bytes) and the bounty opens only if its answer
    /// confirms the receipt is valid for the bounty's image id and carries this journal.
    #[payable]
    pub fn open_with_outlayer(&mut self, bounty_id: U64, receipt_b64: String, receipt_sha256: String, journal: Base64VecU8) -> Promise {
        let now = env::block_timestamp();
        let bounty = self.bounties.get(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.level == LEVEL_1, wrong_level(bounty.level));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(now < bounty.expires_at_ns, "bounty has expired");
        require!(!bounty.opened, "bounty is already open");
        let j = groth16::parse_journal(&journal.0);
        if let Some(e) = proof0_journal_problem(bounty, &journal.0, &j) {
            env::panic_str(e);
        }
        let sid = proof0_id(&bounty.reference_fix_hash);
        let image_id = bounty.image_id;
        self.ask_outlayer(bounty_id.0, PROOF0_INDEX, receipt_b64, &receipt_sha256, &journal.0, Verdict::Pass, image_id, sid, now)
            .then(Self::ext(env::current_account_id()).with_static_gas(OUTLAYER_CALLBACK_GAS).on_outlayer_open(bounty_id))
    }

    /// Level 1 bounties only. Anyone, attaching at least `min_deposit` (normally the vendor's watch: an agent's
    /// function call key cannot attach a deposit): decides a revealed attempt, within its verdict window. The journal
    /// must pass the same checks as at Level 2 (`submit_groth16`): THIS bounty, THIS attempt, the seed recorded at reveal,
    /// the revealed patch. Then OutLayer runs the pinned verifier program on the receipt, and the answer settles the
    /// attempt in `on_outlayer_check`. One check per attempt can wait at a time.
    #[payable]
    pub fn check_with_outlayer(&mut self, bounty_id: U64, index: u32, receipt_b64: String, receipt_sha256: String, journal: Base64VecU8) -> Promise {
        let now = env::block_timestamp();
        let bounty = self.bounties.get(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.level == LEVEL_1, wrong_level(bounty.level));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(bounty.opened, "bounty is not open: Proof 0 has not been proved");
        let sub = self.submissions.get(&(bounty_id.0, index)).unwrap_or_else(|| env::panic_str("no such submission"));
        require!(sub.outcome == Outcome::Open, "verdict already final");
        let revealed = sub.revealed_at_ns.unwrap_or_else(|| env::panic_str("submission not revealed"));
        require!(now <= revealed.saturating_add(bounty.verdict_window_ns), "verdict window has closed");
        let j = groth16::parse_journal(&journal.0);
        if j.verdict == 1 {
            require!(!earlier_reveal_undecided(&self.submissions, bounty_id.0, bounty.commits, index, revealed), "an attempt revealed earlier is still undecided: decide it or time it out first");
        }
        if let Some(e) = attempt_journal_problem(bounty_id.0, index, bounty, sub, &j) {
            env::panic_str(e);
        }
        let patch_hash = sub.patch_hash.unwrap_or_else(|| env::panic_str("submission not revealed"));
        let sid = submission_id(&env::current_account_id(), bounty_id.0, index, &patch_hash);
        let verdict = if j.verdict == 1 { Verdict::Pass } else { Verdict::Fail };
        let image_id = bounty.image_id;
        self.ask_outlayer(bounty_id.0, index, receipt_b64, &receipt_sha256, &journal.0, verdict, image_id, sid, now)
            .then(Self::ext(env::current_account_id()).with_static_gas(OUTLAYER_CALLBACK_GAS).on_outlayer_check(bounty_id, index))
    }

    /// Not callable from outside. Records the waiting check (refusing a second one while the first waits) and sends the
    /// job to OutLayer with the pinned program, the caller's whole deposit, and the caller as the account OutLayer
    /// refunds.
    #[allow(clippy::too_many_arguments)]
    fn ask_outlayer(
        &mut self,
        bounty_id: u64,
        index: u32,
        receipt_b64: String,
        receipt_sha256: &str,
        journal: &[u8],
        verdict: Verdict,
        image_id: [u8; 32],
        sid: [u8; 32],
        now: u64,
    ) -> Promise {
        let cfg = self.get_outlayer().unwrap_or_else(|| env::panic_str("OutLayer is not set"));
        let deposit = env::attached_deposit();
        require!(deposit.as_yoctonear() >= cfg.min_deposit.0, "attach at least min_deposit (get_outlayer) for OutLayer's fee and deposit");
        if let Some(waiting) = outlayer_check(bounty_id, index) {
            require!(now >= waiting.requested_at_ns.saturating_add(OUTLAYER_STALE_NS), "a check of this attempt is already waiting for OutLayer");
        }
        let receipt_hash = parse_hash("receipt_sha256", receipt_sha256);
        let asker = env::predecessor_account_id();
        let check = OutLayerCheck {
            asker: asker.clone(),
            deposit: deposit.as_yoctonear(),
            journal_hash: env::sha256_array(journal),
            receipt_hash,
            verdict,
            requested_at_ns: now,
        };
        env::storage_write(&outlayer_check_key(bounty_id, index), &near_sdk::borsh::to_vec(&check).expect("check serializes"));
        let input = json!({
            "receipt_b64": receipt_b64,
            "image_id": to_hex(&image_id),
            "submission_id": to_hex(&sid),
            "receipt_sha256": to_hex(&receipt_hash),
        })
        .to_string();
        let args = json!({
            "source": { "WasmUrl": { "url": cfg.wasm_url, "hash": cfg.wasm_sha256, "build_target": cfg.build_target } },
            "resource_limits": {
                "max_instructions": cfg.max_instructions.0,
                "max_memory_mb": cfg.max_memory_mb,
                "max_execution_seconds": cfg.max_execution_seconds.0,
            },
            "input_data": input,
            "response_format": "Json",
            "payer_account_id": asker,
        });
        let index_view = if index == PROOF0_INDEX { None } else { Some(index) };
        emit("outlayer_requested", json!({ "bounty_id": U64(bounty_id), "index": index_view, "verdict": verdict_str(verdict), "asker": check.asker, "outlayer": cfg.account_id }));
        Promise::new(cfg.account_id).function_call("request_execution".to_string(), args.to_string().into_bytes(), deposit, OUTLAYER_REQUEST_GAS)
    }

    /// Private: only this contract can call it, as the callback of its own OutLayer request. Removes the waiting check
    /// first. If OutLayer refused the request at the door (the call failed), its deposit came back to this contract, so
    /// it is returned to the asker here (audit finding 13). If OutLayer ran the job and it failed or timed out, OutLayer
    /// refunded the asker itself and the answer is empty. Otherwise the answer is accepted only if it says ok and echoes
    /// what the waiting check holds. Never panics after reading the check, so a refusal records nothing but the removal.
    fn take_outlayer_answer(&mut self, bounty_id: U64, index: u32, answer: Result<Option<Value>, PromiseError>, image_id: [u8; 32], sid: [u8; 32]) -> Result<OutLayerCheck, String> {
        let Some(check) = outlayer_check(bounty_id.0, index) else { return Err("no check is waiting".into()) };
        env::storage_remove(&outlayer_check_key(bounty_id.0, index));
        let a = match answer {
            Err(_) => {
                Promise::new(check.asker.clone()).transfer(NearToken::from_yoctonear(check.deposit)).detach();
                return Err("OutLayer refused the request; the deposit was returned to the asker".into());
            }
            Ok(None) => return Err("no answer from OutLayer".into()),
            Ok(Some(a)) => a,
        };
        if a.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err("answer is not ok".into());
        }
        let field = |k: &str| a.get(k).and_then(Value::as_str).map(str::to_lowercase);
        for (k, want) in [
            ("image_id", to_hex(&image_id)),
            ("submission_id", to_hex(&sid)),
            ("receipt_sha256", to_hex(&check.receipt_hash)),
            ("journal_sha256", to_hex(&check.journal_hash)),
        ] {
            if field(k).as_deref() != Some(want.as_str()) {
                return Err(format!("{k} differs"));
            }
        }
        if a.get("verdict").and_then(Value::as_str) != Some(verdict_str(check.verdict)) {
            return Err("verdict differs from the journal's".into());
        }
        Ok(check)
    }

    #[private]
    pub fn on_outlayer_open(&mut self, bounty_id: U64, #[callback_result] answer: Result<Option<Value>, PromiseError>) -> String {
        // `#[private]` already enforces this in the on-chain entry point; checked here too so the rule also holds (and is
        // tested) when the method is called directly.
        require!(env::predecessor_account_id() == env::current_account_id(), "on_outlayer_open is private");
        let reject = |why: &str| -> String {
            emit("outlayer_rejected", json!({ "bounty_id": bounty_id, "index": Value::Null, "reason": why }));
            format!("rejected: {why}")
        };
        let Some(bounty) = self.bounties.get(&bounty_id.0) else { return reject("no such bounty") };
        let (image_id, sid) = (bounty.image_id, proof0_id(&bounty.reference_fix_hash));
        if let Err(e) = self.take_outlayer_answer(bounty_id, PROOF0_INDEX, answer, image_id, sid) {
            return reject(&e);
        }
        let now = env::block_timestamp();
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        if bounty.state != BountyState::Open || bounty.opened || now >= bounty.expires_at_ns {
            return reject("the bounty is closed, expired or already open");
        }
        bounty.opened = true;
        emit("bounty_opened", json!({ "bounty_id": bounty_id, "by": "outlayer", "caller": env::signer_account_id() }));
        "opened".to_string()
    }

    #[private]
    pub fn on_outlayer_check(&mut self, bounty_id: U64, index: u32, #[callback_result] answer: Result<Option<Value>, PromiseError>) -> String {
        require!(env::predecessor_account_id() == env::current_account_id(), "on_outlayer_check is private");
        let reject = |why: &str| -> String {
            emit("outlayer_rejected", json!({ "bounty_id": bounty_id, "index": index, "reason": why }));
            format!("rejected: {why}")
        };
        let Some(bounty) = self.bounties.get(&bounty_id.0) else { return reject("no such bounty") };
        let Some(sub) = self.submissions.get(&(bounty_id.0, index)) else { return reject("no such submission") };
        let Some(patch_hash) = sub.patch_hash else { return reject("submission not revealed") };
        let (image_id, sid) = (bounty.image_id, submission_id(&env::current_account_id(), bounty_id.0, index, &patch_hash));
        let check = match self.take_outlayer_answer(bounty_id, index, answer, image_id, sid) {
            Ok(c) => c,
            Err(e) => return reject(&e),
        };
        // The bounty or the attempt may have changed while OutLayer worked (a timeout claim, another attempt's PASS).
        let bounty = self.bounties.get(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        let sub = self.submissions.get(&(bounty_id.0, index)).unwrap_or_else(|| env::panic_str("no such submission"));
        if bounty.state != BountyState::Open || sub.outcome != Outcome::Open {
            return reject("the bounty or the attempt was decided while OutLayer worked");
        }
        let revealed = sub.revealed_at_ns.unwrap_or(u64::MAX);
        if check.verdict == Verdict::Pass && earlier_reveal_undecided(&self.submissions, bounty_id.0, bounty.commits, index, revealed) {
            return reject("an attempt revealed earlier is still undecided");
        }
        // The check was asked within the verdict window; the answer may arrive just after it.
        self.settle_attempt(bounty_id, index, check.verdict, check.journal_hash, check.receipt_hash, check.requested_at_ns, "outlayer")
    }

    /// Used by `attest` (Level 0, not callable from outside): adds one registered verifier's attestation if it matches
    /// the posted verdict, journal hash and receipt hash, and finalizes on the second different verifier.
    fn record_attestation(
        &mut self,
        bounty_id: U64,
        index: u32,
        verifier: AccountId,
        verdict: Verdict,
        journal: [u8; 32],
        receipt: [u8; 32],
    ) -> String {
        let now = env::block_timestamp();
        require!(self.verifiers.contains_key(&verifier), "caller is not a registered verifier");
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(verifier != bounty.vendor, "the vendor cannot attest");
        require!(bounty.level == LEVEL_0, wrong_level(bounty.level));
        let sub = self
            .submissions
            .get_mut(&(bounty_id.0, index))
            .unwrap_or_else(|| env::panic_str("no such submission"));
        require!(verifier != sub.committer && verifier != sub.payout, "a researcher cannot attest its own submission");
        require!(sub.outcome == Outcome::Open, "verdict already final");
        let posted = sub.verdict.as_ref().unwrap_or_else(|| env::panic_str("no verdict posted"));
        require!(now <= posted.posted_at_ns.saturating_add(bounty.attest_window_ns), "attestation window has closed");
        require!(
            posted.verdict == verdict && posted.journal_hash == journal && posted.receipt_hash == receipt,
            "attestation does not match the posted verdict"
        );
        if sub.attestations.contains(&verifier) {
            emit("attest_duplicate", json!({ "bounty_id": bounty_id, "index": index, "verifier": verifier }));
            return "duplicate".to_string();
        }
        sub.attestations.push(verifier.clone());
        emit(
            "attested",
            json!({ "bounty_id": bounty_id, "index": index, "verifier": verifier, "verdict": verdict_str(verdict), "count": sub.attestations.len() }),
        );
        if sub.attestations.len() < ATTESTATIONS_TO_FINALIZE {
            return "recorded".to_string();
        }
        bounty.pending -= 1;
        match verdict {
            Verdict::Pass => {
                sub.outcome = Outcome::Passed;
                bounty.state = BountyState::Paid;
                bounty.winner = Some(index);
                emit(
                    "paid",
                    json!({ "bounty_id": bounty_id, "index": index, "reason": "final_pass", "to": sub.payout, "amount": U128(bounty.amount.as_yoctonear()) }),
                );
                bounty.fees_collected = bounty.fees_collected.saturating_sub(sub.fee);
                Promise::new(sub.payout.clone()).transfer(bounty.amount.saturating_add(sub.fee)).detach();
                refund_undecided_revealed(&mut self.submissions, &mut self.credits, bounty_id.0, bounty, index);
                "final_pass".to_string()
            }
            Verdict::Fail => {
                sub.outcome = Outcome::Failed;
                emit("attempt_spent", json!({ "bounty_id": bounty_id, "index": index }));
                "final_fail".to_string()
            }
        }
    }

    // ---------- Level 2: anyone submits a Groth16 proof ----------

    /// Level 2 bounties only. Anyone: opens the bounty with a Groth16 proof of its Proof 0. The proof must verify for
    /// the bounty's image id, and its journal must be the bounty's Proof 0 journal (sha256 fixed at creation): the
    /// bounty's original, exploit commitment, tests and counts, the reference fix as candidate, the Proof 0 id, PASS.
    pub fn open_with_groth16(&mut self, bounty_id: U64, seal: Base64VecU8, journal: Base64VecU8) -> String {
        let now = env::block_timestamp();
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.level == LEVEL_2, wrong_level(bounty.level));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(now < bounty.expires_at_ns, "bounty has expired");
        require!(!bounty.opened, "bounty is already open");
        let j = groth16::parse_journal(&journal.0);
        // Cheap binding checks first, the pairing check last (audit hardening S3): a wrong journal fails for a few Tgas
        // with a message that names the field, instead of for the whole proof check.
        if let Some(e) = proof0_journal_problem(bounty, &journal.0, &j) {
            env::panic_str(e);
        }
        require!(groth16::verify(&seal.0, &bounty.image_id, &journal.0), "the Groth16 proof does not verify for this bounty's image id and this journal");
        bounty.opened = true;
        emit("bounty_opened", json!({ "bounty_id": bounty_id, "by": "groth16", "caller": env::predecessor_account_id() }));
        "opened".to_string()
    }

    /// Level 2 bounties only. Anyone: decides a revealed attempt with a Groth16 proof of it, within the verdict window
    /// after the reveal (which always ends before the bounty expires). The proof must verify for the bounty's image id, and its
    /// journal must belong to THIS bounty and THIS attempt: the submission id (contract, bounty, index, patch hash),
    /// the seed recorded at reveal, the revealed patch hash, and the bounty's original, exploit commitment, tests and
    /// counts. The verdict is read from the journal: PASS pays the researcher (with the own fee refunded) and closes
    /// the bounty; FAIL spends the attempt.
    pub fn submit_groth16(&mut self, bounty_id: U64, index: u32, seal: Base64VecU8, journal: Base64VecU8) -> String {
        let now = env::block_timestamp();
        let bounty = self.bounties.get(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.level == LEVEL_2, wrong_level(bounty.level));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        // No expiry check here: a reveal always leaves a full verdict window before expiry, and the window alone bounds
        // the proof. Refusing a proof after expiry while the timeout still paid was audit finding F1.
        require!(bounty.opened, "bounty is not open: Proof 0 has not been proved");
        let sub = self.submissions.get(&(bounty_id.0, index)).unwrap_or_else(|| env::panic_str("no such submission"));
        require!(sub.outcome == Outcome::Open, "verdict already final");
        let revealed = sub.revealed_at_ns.unwrap_or_else(|| env::panic_str("submission not revealed"));
        require!(now <= revealed.saturating_add(bounty.verdict_window_ns), "verdict window has closed");
        let j = groth16::parse_journal(&journal.0);
        if j.verdict == 1 {
            require!(!earlier_reveal_undecided(&self.submissions, bounty_id.0, bounty.commits, index, revealed), "an attempt revealed earlier is still undecided: decide it or time it out first");
        }
        // Cheap binding checks first, the pairing check last (audit hardening S3).
        if let Some(e) = attempt_journal_problem(bounty_id.0, index, bounty, sub, &j) {
            env::panic_str(e);
        }
        require!(groth16::verify(&seal.0, &bounty.image_id, &journal.0), "the Groth16 proof does not verify for this bounty's image id and this journal");
        let verdict = if j.verdict == 1 { Verdict::Pass } else { Verdict::Fail };
        self.settle_attempt(bounty_id, index, verdict, env::sha256_array(&journal.0), env::sha256_array(&seal.0), now, "groth16")
    }

    /// Shared by Level 2 (`submit_groth16`) and Level 1 (`on_outlayer_check`), not callable from outside: records the
    /// verdict of a revealed attempt whose journal was already checked, then PASS pays the researcher (with the own fee
    /// refunded) and closes the bounty, FAIL spends the attempt. `how` names the path in the events ("groth16" or
    /// "outlayer"), so a reader can tell a proof the contract checked from an answer it trusted.
    fn settle_attempt(&mut self, bounty_id: U64, index: u32, verdict: Verdict, journal_hash: [u8; 32], receipt_hash: [u8; 32], now: u64, how: &str) -> String {
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        let sub = self.submissions.get_mut(&(bounty_id.0, index)).unwrap_or_else(|| env::panic_str("no such submission"));
        sub.verdict = Some(PostedVerdict { verdict, journal_hash, receipt_hash, posted_at_ns: now });
        bounty.pending -= 1;
        emit(&format!("{how}_verified"), json!({ "bounty_id": bounty_id, "index": index, "verdict": verdict_str(verdict), "caller": env::predecessor_account_id() }));
        match verdict {
            Verdict::Pass => {
                sub.outcome = Outcome::Passed;
                bounty.state = BountyState::Paid;
                bounty.winner = Some(index);
                emit(
                    "paid",
                    json!({ "bounty_id": bounty_id, "index": index, "reason": format!("{how}_pass"), "to": sub.payout, "amount": U128(bounty.amount.as_yoctonear()) }),
                );
                bounty.fees_collected = bounty.fees_collected.saturating_sub(sub.fee);
                Promise::new(sub.payout.clone()).transfer(bounty.amount.saturating_add(sub.fee)).detach();
                refund_undecided_revealed(&mut self.submissions, &mut self.credits, bounty_id.0, bounty, index);
                "final_pass".to_string()
            }
            Verdict::Fail => {
                sub.outcome = Outcome::Failed;
                emit("attempt_spent", json!({ "bounty_id": bounty_id, "index": index }));
                "final_fail".to_string()
            }
        }
    }

    // ---------- anyone ----------

    /// Anyone. After the deadline of a revealed submission with no final verdict (and no earlier reveal still undecided),
    /// closes the bounty and splits it equally among every revealed submission that is still undecided (audit hardening
    /// S7): each payout account gets its share and its attempt fee back, the remainder of the division goes to `index`.
    pub fn claim_timeout(&mut self, bounty_id: U64, index: u32) {
        let now = env::block_timestamp();
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        let sub = self
            .submissions
            .get_mut(&(bounty_id.0, index))
            .unwrap_or_else(|| env::panic_str("no such submission"));
        require!(sub.outcome == Outcome::Open, "verdict already final");
        let deadline = sub.deadline_ns(bounty).unwrap_or_else(|| env::panic_str("submission not revealed"));
        require!(now > deadline, "deadline has not passed");
        let (commits, revealed) = (bounty.commits, sub.revealed_at_ns.unwrap_or(u64::MAX));
        require!(!earlier_reveal_undecided(&self.submissions, bounty_id.0, commits, index, revealed), "an attempt revealed earlier is still undecided: decide it or time it out first");
        let sharers: Vec<u32> = (0..commits)
            .filter(|k| {
                self.submissions
                    .get(&(bounty_id.0, *k))
                    .is_some_and(|o| o.outcome == Outcome::Open && o.revealed_at_ns.is_some())
            })
            .collect();
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        let amount = bounty.amount.as_yoctonear();
        let n = sharers.len() as u128;
        let share = amount / n;
        bounty.state = BountyState::Paid;
        bounty.winner = Some(index);
        for k in sharers {
            let sub = self.submissions.get_mut(&(bounty_id.0, k)).unwrap_or_else(|| env::panic_str("no such submission"));
            let paid = if k == index { amount - share * (n - 1) } else { share };
            sub.outcome = Outcome::TimedOut;
            bounty.pending -= 1;
            bounty.fees_collected = bounty.fees_collected.saturating_sub(sub.fee);
            emit(
                "paid",
                json!({ "bounty_id": bounty_id, "index": k, "reason": "timeout", "to": sub.payout, "amount": U128(paid), "caller": env::predecessor_account_id() }),
            );
            Promise::new(sub.payout.clone()).transfer(NearToken::from_yoctonear(paid).saturating_add(sub.fee)).detach();
        }
    }

    /// Anyone. After the bounty's expiry: if nothing was paid and no revealed submission is still waiting
    /// for its verdict or timeout, refunds the bounty to the vendor. In the same call (also for a bounty
    /// that was already paid), sends the fees of decided attempts to the registered verifiers in equal shares (Level 0,
    /// the remainder of the division to the first one) or to the protocol fee pool (Levels 1 and 2); commits never revealed go to
    /// the pool first. Fails if there is nothing left to do.
    pub fn expire(&mut self, bounty_id: U64) {
        let now = env::block_timestamp();
        let caller = env::predecessor_account_id();
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(now >= bounty.expires_at_ns, "bounty has not expired");
        let mut acted = false;
        // Commits that were never revealed and never released: the same rule as release_unrevealed, before any fee
        // is paid out below.
        for index in 0..bounty.commits {
            if let Some(sub) = self.submissions.get_mut(&(bounty_id.0, index)) {
                if sub.outcome == Outcome::Open && sub.revealed_at_ns.is_none() {
                    release_to_pool(bounty_id, index, bounty, sub);
                    acted = true;
                }
            }
        }
        if bounty.state == BountyState::Open {
            require!(bounty.pending == 0, "a revealed submission is still unresolved");
            bounty.state = BountyState::Refunded;
            emit(
                "refunded",
                json!({ "bounty_id": bounty_id, "to": bounty.vendor, "amount": U128(bounty.amount.as_yoctonear()), "caller": caller }),
            );
            Promise::new(bounty.vendor.clone()).transfer(bounty.amount).detach();
            acted = true;
        }
        let fees = bounty.fees_collected.as_yoctonear();
        if !bounty.fees_swept && fees > 0 && bounty.level != LEVEL_0 {
            // Levels 1 and 2 have no verifiers to pay, and paying the vendor would reward unfixable or fee-farming
            // bounties (audit round 1, fix 4): the fees of decided attempts go to the protocol fee pool.
            bounty.fees_swept = true;
            bounty.fees_collected = NearToken::from_yoctonear(0);
            let pool = add_to_pool(NearToken::from_yoctonear(fees));
            emit("fees_swept", json!({ "bounty_id": bounty_id, "total": U128(fees), "to": "protocol fee pool", "pool": U128(pool), "caller": caller }));
            acted = true;
        } else if !bounty.fees_swept && fees > 0 && !self.verifiers.is_empty() {
            let verifiers: Vec<AccountId> = self.verifiers.keys().cloned().collect();
            let n = verifiers.len() as u128;
            let share = fees / n;
            let remainder = fees - share * n;
            for (i, v) in verifiers.iter().enumerate() {
                let amount = share + if i == 0 { remainder } else { 0 };
                if amount > 0 {
                    Promise::new(v.clone()).transfer(NearToken::from_yoctonear(amount)).detach();
                }
            }
            bounty.fees_swept = true;
            emit(
                "fees_swept",
                json!({ "bounty_id": bounty_id, "total": U128(fees), "verifiers": verifiers, "share": U128(share), "caller": caller }),
            );
            acted = true;
        }
        require!(acted, "nothing to do: bounty already closed and fees already swept");
    }

    // ---------- views (free, change nothing) ----------

    /// Unspent credit of an account, in yoctoNEAR.
    /// The limits an account set on its own commits (all null when none are set).
    pub fn get_agent_limits(&self, account_id: AccountId) -> AgentLimits {
        agent_limits(&account_id)
    }

    pub fn get_credit(&self, account_id: AccountId) -> U128 {
        U128(self.credits.get(&account_id).map(|c| c.as_yoctonear()).unwrap_or(0))
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_next_bounty_id(&self) -> U64 {
        U64(self.next_bounty_id)
    }

    /// Owner only. Adds a checker image id to the allowlist; from the first id on, `create_bounty` accepts only listed ids.
    pub fn allow_image_id(&mut self, image_id: String) -> Vec<String> {
        require!(env::predecessor_account_id() == self.owner, "only the owner can allow an image id");
        let id = parse_hash("image_id", &image_id);
        let mut list = allowed_image_ids();
        if !list.contains(&id) {
            list.push(id);
            env::storage_write(ALLOWED_IMAGE_IDS_KEY, &near_sdk::borsh::to_vec(&list).expect("borsh"));
            emit("image_id_allowed", json!({ "image_id": to_hex(&id), "count": list.len() }));
        }
        list.iter().map(|h| to_hex(h)).collect()
    }

    /// The owner's allowlist of checker image ids (empty: any id is accepted).
    pub fn get_allowed_image_ids(&self) -> Vec<String> {
        allowed_image_ids().iter().map(|h| to_hex(h)).collect()
    }

    /// The protocol fee pool: attempt fees of commits that were never revealed, in yoctoNEAR. Nothing can take NEAR
    /// out of it yet.
    pub fn get_protocol_pool(&self) -> U128 {
        U128(pool_balance())
    }

    pub fn get_bounty(&self, bounty_id: U64) -> Option<BountyView> {
        self.bounties.get(&bounty_id.0).map(|b| BountyView {
            id: bounty_id,
            vendor: b.vendor.clone(),
            amount: U128(b.amount.as_yoctonear()),
            original_hash: to_hex(&b.original_hash),
            corpus_hash: to_hex(&b.corpus_hash),
            image_id: to_hex(&b.image_id),
            exploit_commitment: to_hex(&b.exploit_commitment),
            proof0_receipt_hash: to_hex(&b.proof0_receipt_hash),
            max_commits: b.max_commits,
            max_patch_bytes: b.max_patch_bytes,
            reveal_gap_ns: U64(b.reveal_gap_ns),
            verdict_window_ns: U64(b.verdict_window_ns),
            attest_window_ns: U64(b.attest_window_ns),
            created_at_ns: U64(b.created_at_ns),
            expires_at_ns: U64(b.expires_at_ns),
            state: b.state,
            commits: b.commits,
            pending: b.pending,
            winner: b.winner,
            attempt_fee: U128(b.attempt_fee.as_yoctonear()),
            fee_step: U128(b.fee_step.as_yoctonear()),
            fees_collected: U128(b.fees_collected.as_yoctonear()),
            fees_swept: b.fees_swept,
            next_fee: U128(b.next_fee().as_yoctonear()),
            reference_fix_hash: to_hex(&b.reference_fix_hash),
            proof0_journal_hash: to_hex(&b.proof0_journal_hash),
            proof0_attestations: b.proof0_attestations.clone(),
            opened: b.opened,
            reveal_window_ns: U64(b.reveal_window_ns),
            active: b.active,
            level: b.level,
            fuzz_count: b.fuzz_count,
            variant_count: b.variant_count,
            image_id_allowed: image_id_allowed(&b.image_id),
            max_commits_per_account: account_cap(bounty_id.0),
        })
    }

    /// How many slots of a bounty with a per-account cap `account_id` holds now (0 for bounties without a cap).
    pub fn get_account_slots(&self, bounty_id: U64, account_id: AccountId) -> u32 {
        account_slots(bounty_id.0, &account_id)
    }

    pub fn get_submission(&self, bounty_id: U64, index: u32) -> Option<SubmissionView> {
        let bounty = self.bounties.get(&bounty_id.0)?;
        let s = self.submissions.get(&(bounty_id.0, index))?;
        Some(SubmissionView {
            bounty_id,
            index,
            committer: s.committer.clone(),
            payout: s.payout.clone(),
            fingerprint: to_hex(&s.fingerprint),
            committed_at_ns: U64(s.committed_at_ns),
            patch: s.patch.clone().map(Base64VecU8),
            patch_hash: s.patch_hash.map(|h| to_hex(&h)),
            revealed_at_ns: s.revealed_at_ns.map(U64),
            seed: s.seed.map(|h| to_hex(&h)),
            verdict: s.verdict.as_ref().map(|v| v.verdict),
            journal_hash: s.verdict.as_ref().map(|v| to_hex(&v.journal_hash)),
            receipt_hash: s.verdict.as_ref().map(|v| to_hex(&v.receipt_hash)),
            verdict_posted_at_ns: s.verdict.as_ref().map(|v| U64(v.posted_at_ns)),
            attestations: s.attestations.clone(),
            outcome: s.outcome,
            fee: U128(s.fee.as_yoctonear()),
            deadline_ns: s.deadline_ns(bounty).map(U64),
        })
    }

    pub fn get_verifiers(&self) -> Vec<VerifierView> {
        self.verifiers
            .iter()
            .map(|(id, v)| VerifierView { account_id: id.clone(), label: v.label.clone(), registered_at_ns: U64(v.registered_at_ns) })
            .collect()
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_level2;
#[cfg(test)]
mod tests_level2_attempts;
#[cfg(test)]
mod tests_level1;
