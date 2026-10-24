//! Kintsugi bounty contract (spike S3). It holds a vendor's bounty money and pays it out by fixed rules.
//!
//! Life of a bounty, in plain words:
//! 1. `create_bounty`: the vendor attaches the bounty and posts fingerprints (hashes) of the original
//!    program, the public tests, the proof program (image id), the secret exploit (commitment) and the
//!    vendor's first proof receipt, plus the time windows for this bounty.
//! 2. `commit`: a researcher posts a fingerprint of their patch (sha256 over the patch bytes, the payout
//!    account and a random nonce). Only the first K commits of a bounty count; later ones are ignored.
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
//! OutLayer as one verifier (spike S5, Level 1): the owner sets the OutLayer contract account and the exact
//! verifier program (URL and sha256) with `set_outlayer`, and registers that OutLayer account as a verifier.
//! Anyone may call `request_outlayer_check` with the receipt; this contract itself sends the job to OutLayer,
//! and only the callback of that request (`on_outlayer_result`, private) can add OutLayer's attestation. The
//! callback carries only the program's JSON answer (no signature, no program hash), so it is accepted only if
//! every echoed value matches what this contract holds. This trusts the OutLayer contract and its operator.
//!
//! Level 2 (spike S6c): a bounty created with `level: 2` takes no verifier attestations at all. It opens when anyone
//! submits a Groth16 proof of its Proof 0 (`open_with_groth16`), and each revealed attempt is decided when anyone
//! submits a Groth16 proof of that attempt (`submit_groth16`). The contract checks the proof itself with NEAR's
//! alt_bn128 host functions (module `groth16`), then checks that every field of the proof's journal belongs to THIS
//! bounty and THIS attempt (original, exploit commitment, tests, counts, the seed recorded at reveal, the revealed
//! patch hash and the submission id), and reads the verdict from the journal: PASS pays, FAIL spends the attempt.
//! A proof must arrive before the bounty expires and within the verdict window after the reveal; without one, the
//! researcher is paid by `claim_timeout` as for Level 0. Attempt fees of a Level 2 bounty go to the vendor at
//! expiry. Every bounty records `fuzz_count` and `variant_count`, the check's size, which a proof must match.

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
/// Domain tag of the submission id a Proof 0 journal carries: sha256(PROOF0_DOMAIN || reference fix hash), as in
/// harness/checker/src/zk.rs.
pub const PROOF0_DOMAIN: &[u8] = b"kintsugi-proof0-v1";
/// Bounty levels: 0 = verdicts need two verifier attestations; 2 = verdicts come only from a Groth16 proof.
pub const LEVEL_0: u8 = 0;
pub const LEVEL_2: u8 = 2;
/// Gas sent with the OutLayer request (it reserves its own callback gas from this) and kept for ours.
const OUTLAYER_REQUEST_GAS: Gas = Gas::from_tgas(150);
const OUTLAYER_CALLBACK_GAS: Gas = Gas::from_tgas(30);

/// Where OutLayer runs and which exact program it must run.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutLayerConfig {
    /// The OutLayer contract, for example `outlayer.testnet`. Must also be a registered verifier.
    pub account_id: AccountId,
    /// https URL of the verifier wasm and its sha256 (64 hex); OutLayer's worker refuses other bytes.
    pub wasm_url: String,
    pub wasm_sha256: String,
    /// For example `wasm32-wasip1`.
    pub build_target: String,
    pub max_instructions: U64,
    pub max_memory_mb: u32,
    pub max_execution_seconds: U64,
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

fn pool_balance() -> u128 {
    env::storage_read(POOL_KEY).map(|b| u128::from_le_bytes(b.try_into().unwrap_or([0; 16]))).unwrap_or(0)
}

/// The one rule for the fee of a commit that was never revealed: the commit is released (its slot freed), and its fee
/// leaves the bounty's collected fees for the protocol fee pool, so it is never paid to the vendor, a researcher or a
/// verifier. Used by `release_unrevealed` and, for commits still unreleased at the end, by `expire`.
fn release_to_pool(bounty_id: U64, index: u32, bounty: &mut Bounty, sub: &mut Submission) {
    sub.outcome = Outcome::Released;
    bounty.active = bounty.active.saturating_sub(1);
    bounty.fees_collected = bounty.fees_collected.saturating_sub(sub.fee);
    let pool = pool_balance().saturating_add(sub.fee.as_yoctonear());
    env::storage_write(POOL_KEY, &pool.to_le_bytes());
    emit("fee_to_pool", json!({ "bounty_id": bounty_id, "index": index, "fee": U128(sub.fee.as_yoctonear()), "pool": U128(pool) }));
}

/// The journal fields that are the same for every proof of one bounty.
fn check_bounty_fields(bounty: &Bounty, j: &groth16::Journal) {
    require!(j.original_hash == bounty.original_hash, "the journal's original is not this bounty's");
    require!(j.exploit_commitment == bounty.exploit_commitment, "the journal's exploit commitment is not this bounty's");
    require!(j.corpus_hash == bounty.corpus_hash, "the journal's tests are not this bounty's");
    require!(j.fuzz_count == bounty.fuzz_count && j.variant_count == bounty.variant_count, "the journal's check size is not this bounty's");
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
    /// Attempt fees taken so far, held by the contract until `expire` sends them to the verifiers.
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
    ) -> U64 {
        let vendor = env::predecessor_account_id();
        let amount = env::attached_deposit();
        require!(amount >= MIN_BOUNTY, "attach at least 0.1 NEAR as the bounty");
        require!(!self.verifiers.contains_key(&vendor), "a registered verifier cannot be a vendor");
        require!((1..=MAX_COMMITS_CAP).contains(&max_commits), "max_commits must be 1 to 16");
        require!((1..=MAX_PATCH_BYTES_CAP).contains(&max_patch_bytes), "max_patch_bytes must be 1 to 4096");
        require!(verdict_window_ns.0 > 0 && attest_window_ns.0 > 0 && expiry_ns.0 > 0, "windows must be above zero");
        require!(attempt_fee.0 > 0, "attempt_fee must be above zero");
        require!(reveal_window_ns.0 > reveal_gap_ns.0, "reveal_window_ns must be longer than reveal_gap_ns");
        let level = level.unwrap_or(LEVEL_0);
        require!(level == LEVEL_0 || level == LEVEL_2, "level must be 0 or 2");
        require!(fuzz_count > 0 && variant_count > 0, "fuzz_count and variant_count must be above zero");
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
            }),
        );
        self.vendors.insert(vendor);
        self.bounties.insert(id, bounty);
        U64(id)
    }

    /// Vendor only. Posts PASS or FAIL for one revealed submission, within the verdict window.
    pub fn post_verdict(&mut self, bounty_id: U64, index: u32, verdict: Verdict, journal_hash: String, receipt_hash: String) {
        let now = env::block_timestamp();
        let bounty = self.bounties.get(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(env::predecessor_account_id() == bounty.vendor, "only the vendor can post a verdict");
        require!(bounty.level == LEVEL_0, "this is a Level 2 bounty: verdicts come only from a Groth16 proof");
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
        require!(committer != bounty.vendor, "the vendor cannot commit to its own bounty");
        require!(bounty.opened, "bounty is not open: Proof 0 needs two verifier attestations");
        if bounty.active >= bounty.max_commits {
            emit("commit_ignored", json!({ "bounty_id": bounty_id, "committer": committer, "reason": "max_commits reached" }));
            return None;
        }
        let fee = bounty.next_fee();
        let credit = self.credits.get(&committer).copied().unwrap_or(NearToken::from_yoctonear(0));
        require!(credit >= fee, "not enough credit for the attempt fee: call deposit_credit first");
        self.credits.insert(committer.clone(), credit.saturating_sub(fee));
        bounty.fees_collected = bounty.fees_collected.saturating_add(fee);
        let index = bounty.commits;
        bounty.commits += 1;
        bounty.active += 1;
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
        require!(bounty.level == LEVEL_0, "this is a Level 2 bounty: it opens only with a Groth16 proof");
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

    // ---------- OutLayer (verifier 1) ----------

    /// Owner only. Sets the OutLayer contract and the exact verifier program it must run.
    pub fn set_outlayer(&mut self, config: OutLayerConfig) {
        require!(env::predecessor_account_id() == self.owner, "only the owner can set OutLayer");
        parse_hash("wasm_sha256", &config.wasm_sha256);
        require!(config.wasm_url.starts_with("https://"), "wasm_url must be https");
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

    /// Anyone. Sends the posted verdict's receipt (bincode, base64) to OutLayer to be checked by the pinned
    /// verifier program. Attach NEAR for OutLayer's fee; OutLayer refunds what it does not use to the caller.
    /// The answer comes back to `on_outlayer_result`.
    #[payable]
    pub fn request_outlayer_check(&mut self, bounty_id: U64, index: u32, receipt_b64: String) -> Promise {
        let cfg = self.get_outlayer().unwrap_or_else(|| env::panic_str("OutLayer is not set"));
        require!(self.verifiers.contains_key(&cfg.account_id), "the OutLayer account is not a registered verifier");
        let bounty = self.bounties.get(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(bounty.level == LEVEL_0, "this is a Level 2 bounty: verdicts come only from a Groth16 proof");
        let sub = self.submissions.get(&(bounty_id.0, index)).unwrap_or_else(|| env::panic_str("no such submission"));
        require!(sub.outcome == Outcome::Open, "verdict already final");
        let posted = sub.verdict.as_ref().unwrap_or_else(|| env::panic_str("no verdict posted"));
        let patch_hash = sub.patch_hash.unwrap_or_else(|| env::panic_str("submission not revealed"));
        let sid = submission_id(&env::current_account_id(), bounty_id.0, index, &patch_hash);
        let input = json!({
            "receipt_b64": receipt_b64,
            "image_id": to_hex(&bounty.image_id),
            "submission_id": to_hex(&sid),
            "receipt_sha256": to_hex(&posted.receipt_hash),
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
            "payer_account_id": env::predecessor_account_id(),
        });
        emit("outlayer_requested", json!({ "bounty_id": bounty_id, "index": index, "outlayer": cfg.account_id }));
        Promise::new(cfg.account_id)
            .function_call(
                "request_execution".to_string(),
                args.to_string().into_bytes(),
                env::attached_deposit(),
                OUTLAYER_REQUEST_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(OUTLAYER_CALLBACK_GAS).on_outlayer_result(bounty_id, index))
    }

    /// Private: only this contract can call it, as the callback of its own OutLayer request. Accepts OutLayer's
    /// answer as an attestation only if it says ok and every echoed value matches this contract's record.
    /// Returns what happened; a rejected answer records nothing.
    #[private]
    pub fn on_outlayer_result(
        &mut self,
        bounty_id: U64,
        index: u32,
        #[callback_result] answer: Result<Option<Value>, PromiseError>,
    ) -> String {
        // `#[private]` already enforces this in the on-chain entry point; checked here too so the rule
        // also holds (and is tested) when the method is called directly.
        require!(env::predecessor_account_id() == env::current_account_id(), "on_outlayer_result is private");
        let reject = |why: &str| -> String {
            emit("outlayer_rejected", json!({ "bounty_id": bounty_id, "index": index, "reason": why }));
            format!("rejected: {why}")
        };
        let Ok(Some(a)) = answer else { return reject("no answer from OutLayer") };
        let Some(cfg) = self.get_outlayer() else { return reject("OutLayer is not set") };
        let Some(bounty) = self.bounties.get(&bounty_id.0) else { return reject("no such bounty") };
        let Some(sub) = self.submissions.get(&(bounty_id.0, index)) else { return reject("no such submission") };
        let (Some(posted), Some(patch_hash)) = (sub.verdict.as_ref(), sub.patch_hash) else {
            return reject("no verdict posted");
        };
        let field = |k: &str| a.get(k).and_then(Value::as_str).map(str::to_lowercase);
        if a.get("ok").and_then(Value::as_bool) != Some(true) {
            return reject("answer is not ok");
        }
        let sid = submission_id(&env::current_account_id(), bounty_id.0, index, &patch_hash);
        let checks = [
            ("image_id", to_hex(&bounty.image_id)),
            ("submission_id", to_hex(&sid)),
            ("receipt_sha256", to_hex(&posted.receipt_hash)),
            ("journal_sha256", to_hex(&posted.journal_hash)),
        ];
        for (k, want) in checks {
            if field(k).as_deref() != Some(want.as_str()) {
                return reject(&format!("{k} differs"));
            }
        }
        let verdict = match a.get("verdict").and_then(Value::as_str) {
            Some("PASS") => Verdict::Pass,
            Some("FAIL") => Verdict::Fail,
            _ => return reject("verdict is not PASS or FAIL"),
        };
        if verdict != posted.verdict {
            return reject("verdict differs from the posted verdict");
        }
        let (journal, receipt) = (posted.journal_hash, posted.receipt_hash);
        self.record_attestation(bounty_id, index, cfg.account_id, verdict, journal, receipt)
    }

    /// Shared by `attest` and `on_outlayer_result` (not callable from outside): adds one registered
    /// verifier's attestation if it matches the posted verdict, journal hash and receipt hash, and finalizes
    /// on the second different verifier.
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
        require!(bounty.level == LEVEL_0, "this is a Level 2 bounty: verdicts come only from a Groth16 proof");
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
        require!(bounty.level == LEVEL_2, "this is a Level 0 bounty: it opens with two verifier attestations");
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(now < bounty.expires_at_ns, "bounty has expired");
        require!(!bounty.opened, "bounty is already open");
        let j = groth16::parse_journal(&journal.0);
        require!(groth16::verify(&seal.0, &bounty.image_id, &journal.0), "the Groth16 proof does not verify for this bounty's image id and this journal");
        check_bounty_fields(bounty, &j);
        require!(env::sha256_array(&journal.0) == bounty.proof0_journal_hash, "the journal is not this bounty's Proof 0 journal");
        require!(j.candidate_hash == bounty.reference_fix_hash, "the journal's candidate is not this bounty's reference fix");
        require!(j.submission_id == proof0_id(&bounty.reference_fix_hash), "the journal is not a Proof 0 journal");
        require!(j.verdict == 1, "the Proof 0 verdict is not PASS");
        bounty.opened = true;
        emit("bounty_opened", json!({ "bounty_id": bounty_id, "by": "groth16", "caller": env::predecessor_account_id() }));
        "opened".to_string()
    }

    /// Level 2 bounties only. Anyone: decides a revealed attempt with a Groth16 proof of it, before the bounty expires
    /// and within the verdict window after the reveal. The proof must verify for the bounty's image id, and its
    /// journal must belong to THIS bounty and THIS attempt: the submission id (contract, bounty, index, patch hash),
    /// the seed recorded at reveal, the revealed patch hash, and the bounty's original, exploit commitment, tests and
    /// counts. The verdict is read from the journal: PASS pays the researcher (with the own fee refunded) and closes
    /// the bounty; FAIL spends the attempt.
    pub fn submit_groth16(&mut self, bounty_id: U64, index: u32, seal: Base64VecU8, journal: Base64VecU8) -> String {
        let now = env::block_timestamp();
        let contract = env::current_account_id();
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.level == LEVEL_2, "this is a Level 0 bounty: verdicts need two verifier attestations");
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(now < bounty.expires_at_ns, "bounty has expired");
        require!(bounty.opened, "bounty is not open: Proof 0 has not been proved");
        let sub = self
            .submissions
            .get_mut(&(bounty_id.0, index))
            .unwrap_or_else(|| env::panic_str("no such submission"));
        require!(sub.outcome == Outcome::Open, "verdict already final");
        let revealed = sub.revealed_at_ns.unwrap_or_else(|| env::panic_str("submission not revealed"));
        require!(now <= revealed.saturating_add(bounty.verdict_window_ns), "verdict window has closed");
        let j = groth16::parse_journal(&journal.0);
        require!(groth16::verify(&seal.0, &bounty.image_id, &journal.0), "the Groth16 proof does not verify for this bounty's image id and this journal");
        let patch_hash = sub.patch_hash.unwrap_or_else(|| env::panic_str("submission not revealed"));
        require!(j.submission_id == submission_id(&contract, bounty_id.0, index, &patch_hash), "the journal belongs to another bounty or attempt (submission id)");
        require!(Some(j.fuzz_seed) == sub.seed, "the journal's seed is not the seed recorded at reveal");
        require!(j.candidate_hash == patch_hash, "the journal's candidate is not the revealed patch");
        check_bounty_fields(bounty, &j);
        let verdict = if j.verdict == 1 { Verdict::Pass } else { Verdict::Fail };
        sub.verdict = Some(PostedVerdict {
            verdict,
            journal_hash: env::sha256_array(&journal.0),
            receipt_hash: env::sha256_array(&seal.0),
            posted_at_ns: now,
        });
        bounty.pending -= 1;
        emit("groth16_verified", json!({ "bounty_id": bounty_id, "index": index, "verdict": verdict_str(verdict), "caller": env::predecessor_account_id() }));
        match verdict {
            Verdict::Pass => {
                sub.outcome = Outcome::Passed;
                bounty.state = BountyState::Paid;
                bounty.winner = Some(index);
                emit(
                    "paid",
                    json!({ "bounty_id": bounty_id, "index": index, "reason": "groth16_pass", "to": sub.payout, "amount": U128(bounty.amount.as_yoctonear()) }),
                );
                bounty.fees_collected = bounty.fees_collected.saturating_sub(sub.fee);
                Promise::new(sub.payout.clone()).transfer(bounty.amount.saturating_add(sub.fee)).detach();
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

    /// Anyone. After the deadline of a revealed submission with no final verdict, pays the bounty to that
    /// submission's payout account and closes the bounty.
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
        sub.outcome = Outcome::TimedOut;
        bounty.pending -= 1;
        bounty.state = BountyState::Paid;
        bounty.winner = Some(index);
        emit(
            "paid",
            json!({ "bounty_id": bounty_id, "index": index, "reason": "timeout", "to": sub.payout, "amount": U128(bounty.amount.as_yoctonear()), "caller": env::predecessor_account_id() }),
        );
        bounty.fees_collected = bounty.fees_collected.saturating_sub(sub.fee);
        Promise::new(sub.payout.clone()).transfer(bounty.amount.saturating_add(sub.fee)).detach();
    }

    /// Anyone. After the bounty's expiry: if nothing was paid and no revealed submission is still waiting
    /// for its verdict or timeout, refunds the bounty to the vendor. In the same call (also for a bounty
    /// that was already paid), sends the collected attempt fees to the registered verifiers in equal
    /// shares, the remainder of the division to the first one. Fails if there is nothing left to do.
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
        if !bounty.fees_swept && fees > 0 && bounty.level == LEVEL_2 {
            bounty.fees_swept = true;
            emit("fees_swept", json!({ "bounty_id": bounty_id, "total": U128(fees), "to": bounty.vendor, "caller": caller }));
            Promise::new(bounty.vendor.clone()).transfer(NearToken::from_yoctonear(fees)).detach();
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
    pub fn get_credit(&self, account_id: AccountId) -> U128 {
        U128(self.credits.get(&account_id).map(|c| c.as_yoctonear()).unwrap_or(0))
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_next_bounty_id(&self) -> U64 {
        U64(self.next_bounty_id)
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
        })
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
