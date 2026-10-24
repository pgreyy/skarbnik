//! Verifier program for OutLayer (spike S4). It reads one JSON object from standard input:
//!
//!   { "receipt_b64": "<bincode Receipt, base64>", "image_id": "<64 hex>",
//!     "submission_id": "<64 hex>", "receipt_sha256": "<64 hex>" }
//!
//! It checks that sha256 of the receipt bytes equals `receipt_sha256` (the hash the contract holds),
//! verifies the receipt against `image_id` with RISC Zero's verify-only code, decodes the journal and
//! checks its submission id. It prints one JSON line (well under OutLayer's 900 byte limit):
//!
//!   { "ok": true|false, "verdict": "PASS"|"FAIL"|null, "image_id": ..., "submission_id": ...,
//!     "receipt_sha256": ..., "journal_sha256": ..., "error": null|"<short reason>" }
//!
//! `ok` is true only if every check passed. The contract compares the echoed values with its own.

use std::io::Read;

use base64::Engine as _;
use kintsugi_check::text::to_hex;
use kintsugi_check::zk::{Journal, VERDICT_FAIL, VERDICT_PASS};
use risc0_zkvm::sha::{Digest, Impl, Sha256};
use risc0_zkvm::Receipt;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct Request {
    receipt_b64: String,
    image_id: String,
    submission_id: String,
    receipt_sha256: String,
}

#[derive(Serialize, Default)]
struct Answer {
    ok: bool,
    verdict: Option<&'static str>,
    image_id: String,
    submission_id: String,
    receipt_sha256: String,
    journal_sha256: Option<String>,
    error: Option<String>,
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(Impl::hash_bytes(bytes).as_bytes());
    out
}

fn hex32(field: &str, s: &str) -> Result<[u8; 32], String> {
    let bytes = kintsugi_check::text::parse_hex(s).map_err(|e| format!("{field}: {e}"))?;
    bytes.try_into().map_err(|_| format!("{field}: must be 32 bytes"))
}

fn check(req: &Request, answer: &mut Answer) -> Result<(), String> {
    let image_id = hex32("image_id", &req.image_id)?;
    let submission_id = hex32("submission_id", &req.submission_id)?;
    let want_receipt_hash = hex32("receipt_sha256", &req.receipt_sha256)?;
    let receipt_bytes = base64::engine::general_purpose::STANDARD
        .decode(req.receipt_b64.trim())
        .map_err(|e| format!("receipt_b64: {e}"))?;
    if sha256(&receipt_bytes) != want_receipt_hash {
        return Err("receipt bytes do not match receipt_sha256".to_string());
    }
    let receipt: Receipt = bincode::deserialize(&receipt_bytes).map_err(|e| format!("receipt does not decode: {e}"))?;
    receipt.verify(Digest::from(image_id)).map_err(|e| format!("receipt is invalid: {e}"))?;
    answer.journal_sha256 = Some(to_hex(&sha256(&receipt.journal.bytes)));
    let journal: Journal = receipt.journal.decode().map_err(|e| format!("journal does not decode: {e}"))?;
    if journal.submission_id != submission_id {
        return Err("journal submission_id differs".to_string());
    }
    answer.verdict = match journal.verdict {
        VERDICT_PASS => Some("PASS"),
        VERDICT_FAIL => Some("FAIL"),
        _ => return Err("journal verdict is not PASS or FAIL".to_string()),
    };
    Ok(())
}

fn main() {
    let mut raw = String::new();
    let mut answer = Answer::default();
    let result = std::io::stdin()
        .read_to_string(&mut raw)
        .map_err(|e| format!("stdin: {e}"))
        .and_then(|_| serde_json::from_str::<Request>(&raw).map_err(|e| format!("input is not the expected JSON: {e}")))
        .and_then(|req| {
            answer.image_id = req.image_id.to_lowercase();
            answer.submission_id = req.submission_id.to_lowercase();
            answer.receipt_sha256 = req.receipt_sha256.to_lowercase();
            check(&req, &mut answer)
        });
    match result {
        Ok(()) => answer.ok = true,
        Err(e) => {
            answer.ok = false;
            answer.verdict = None;
            let mut e = e;
            e.truncate(200);
            answer.error = Some(e);
        }
    }
    println!("{}", serde_json::to_string(&answer).expect("answer serializes"));
}
