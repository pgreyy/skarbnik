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
//! 6. `claim_timeout`: anyone may call it once the deadline has passed with no final verdict; it pays the
//!    researcher. `expire`: anyone may call it after the bounty's expiry if nothing was paid; it refunds
//!    the vendor.
//!
//! The contract never sees the secret exploit and never checks a patch itself. It only checks who
//! called, with which values, and when. Times are block timestamps in nanoseconds.
//! Verifiers are registered accounts (by the owner); an attestation is a call to `attest` signed by that
//! verifier account's own access key, so NEAR's transaction signature check is the signature check.
//! Every state change writes a NEP-297 style `EVENT_JSON:` log line.

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::{Value, json};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise, env, near, require};

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

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Bounties,
    Submissions,
    Verifiers,
    Vendors,
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
    /// Set up the contract. `ignore_state` lets this replace the S0 hello world state that is already
    /// stored on the account. `private` means only the contract account itself can call it (the deploy
    /// transaction is signed by that account), so nobody else can reset the state later.
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
    ) -> U64 {
        let vendor = env::predecessor_account_id();
        let amount = env::attached_deposit();
        require!(amount >= MIN_BOUNTY, "attach at least 0.1 NEAR as the bounty");
        require!(!self.verifiers.contains_key(&vendor), "a registered verifier cannot be a vendor");
        require!((1..=MAX_COMMITS_CAP).contains(&max_commits), "max_commits must be 1 to 16");
        require!((1..=MAX_PATCH_BYTES_CAP).contains(&max_patch_bytes), "max_patch_bytes must be 1 to 4096");
        require!(verdict_window_ns.0 > 0 && attest_window_ns.0 > 0 && expiry_ns.0 > 0, "windows must be above zero");
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
    /// Returns the submission index, or null when the bounty already has its K commits (the commit is
    /// ignored and nothing is stored).
    pub fn commit(&mut self, bounty_id: U64, fingerprint: String, payout: AccountId) -> Option<u32> {
        let now = env::block_timestamp();
        let committer = env::predecessor_account_id();
        let fp = parse_hash("fingerprint", &fingerprint);
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(now < bounty.expires_at_ns, "bounty has expired");
        require!(committer != bounty.vendor, "the vendor cannot commit to its own bounty");
        if bounty.commits >= bounty.max_commits {
            emit("commit_ignored", json!({ "bounty_id": bounty_id, "committer": committer, "reason": "max_commits reached" }));
            return None;
        }
        let index = bounty.commits;
        bounty.commits += 1;
        emit(
            "committed",
            json!({ "bounty_id": bounty_id, "index": index, "committer": committer, "payout": payout, "fingerprint": to_hex(&fp) }),
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

    // ---------- verifiers ----------

    /// A registered verifier confirms the posted verdict, journal hash and receipt hash. The verdict
    /// becomes final with matching attestations from two different registered verifiers; a repeat
    /// attestation by the same verifier counts once. Returns "recorded", "duplicate", "final_pass" or
    /// "final_fail".
    pub fn attest(&mut self, bounty_id: U64, index: u32, verdict: Verdict, journal_hash: String, receipt_hash: String) -> String {
        let now = env::block_timestamp();
        let verifier = env::predecessor_account_id();
        require!(self.verifiers.contains_key(&verifier), "caller is not a registered verifier");
        let journal = parse_hash("journal_hash", &journal_hash);
        let receipt = parse_hash("receipt_hash", &receipt_hash);
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(verifier != bounty.vendor, "the vendor cannot attest");
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
                Promise::new(sub.payout.clone()).transfer(bounty.amount).detach();
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
        Promise::new(sub.payout.clone()).transfer(bounty.amount).detach();
    }

    /// Anyone. After the bounty's expiry, if nothing was paid and no revealed submission is still
    /// waiting for its verdict or timeout, refunds the bounty to the vendor.
    pub fn expire(&mut self, bounty_id: U64) {
        let now = env::block_timestamp();
        let bounty = self.bounties.get_mut(&bounty_id.0).unwrap_or_else(|| env::panic_str("no such bounty"));
        require!(bounty.state == BountyState::Open, "bounty is closed");
        require!(now >= bounty.expires_at_ns, "bounty has not expired");
        require!(bounty.pending == 0, "a revealed submission is still unresolved");
        bounty.state = BountyState::Refunded;
        emit(
            "refunded",
            json!({ "bounty_id": bounty_id, "to": bounty.vendor, "amount": U128(bounty.amount.as_yoctonear()), "caller": env::predecessor_account_id() }),
        );
        Promise::new(bounty.vendor.clone()).transfer(bounty.amount).detach();
    }

    // ---------- views (free, change nothing) ----------

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_next_bounty_id(&self) -> U64 {
        U64(self.next_bounty_id)
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
