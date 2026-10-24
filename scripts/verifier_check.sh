#!/usr/bin/env bash
# What an honest Level 0 verifier runs before it attests: verifies a receipt file with the checker's image id
# and compares every journal field with the contract's records. Exit 0 only if every check passes.
# Usage, from the repo root:
#   scripts/verifier_check.sh submission <contract> <bounty id> <index> <receipt file>
#   scripts/verifier_check.sh proof0     <contract> <bounty id> <receipt file>
# Testnet RPC only; reads, never signs.
set -uo pipefail
cd "$(dirname "$0")/.."
export OUT=target/verifier-check CONTRACT="$2"
source scripts/s3_lib.sh
HOST=./target/release/kintsugi-host
kind="$1"; bounty="$3"
if [ "$kind" = submission ]; then index="$4"; receipt="$5"; else index=""; receipt="$4"; fi
V=$($HOST verify "$receipt" 2>&1)
B=$(view get_bounty "{\"bounty_id\":\"$bounty\"}")
if [ "$kind" = submission ]; then
  SUB=$(view get_submission "{\"bounty_id\":\"$bounty\",\"index\":$index}")
  SID=$(view get_submission_id "{\"bounty_id\":\"$bounty\",\"index\":$index}")
else SUB='{}'; SID='null'; fi
python3 -I - "$kind" "$B" "$SUB" "$SID" "$(sha256sum "$receipt" | cut -c1-64)" "$V" <<'PY'
import hashlib, json, sys
kind, b, sub, sid, rh, v = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3]), json.loads(sys.argv[4]), sys.argv[5], sys.argv[6]
j = dict(l.split(": ", 1) for l in v.splitlines() if ": " in l)
c = {
    "receipt verifies with the checker's image id (VALID)": "VALID" in v.splitlines(),
    "image id = bounty image id": j.get("image id") == b["image_id"],
    "journal exploit commitment = bounty commitment": j.get("journal.exploit_commitment") == b["exploit_commitment"],
    "journal corpus hash = bounty corpus hash": j.get("journal.corpus_hash") == b["corpus_hash"],
    "journal original hash = bounty original hash": j.get("journal.original_hash") == b["original_hash"],
}
# Bounties created by the S6c contract record the size of the check; older contracts do not have these fields.
if "fuzz_count" in b:
    c["journal fuzz_count = bounty fuzz_count"] = j.get("journal.fuzz_count") == str(b["fuzz_count"])
    c["journal variant_count = bounty variant_count"] = j.get("journal.variant_count") == str(b["variant_count"])
if kind == "submission":
    c.update({
        "journal submission id = contract submission id": j.get("journal.submission_id") == sid,
        "journal seed = seed recorded at reveal": j.get("journal.fuzz_seed") == sub.get("seed"),
        "journal candidate hash = revealed patch hash": j.get("journal.candidate_hash") == sub.get("patch_hash"),
        "receipt sha256 = posted receipt hash": rh == sub.get("receipt_hash"),
        "journal sha256 = posted journal hash": j.get("journal sha256") == sub.get("journal_hash"),
        "journal verdict = posted verdict": j.get("journal.verdict") == sub.get("verdict"),
    })
else:
    want_sid = hashlib.sha256(b"kintsugi-proof0-v1" + bytes.fromhex(b["reference_fix_hash"])).hexdigest()
    c.update({
        "journal submission id = Proof 0 id of the reference fix": j.get("journal.submission_id") == want_sid,
        "journal candidate hash = reference fix hash": j.get("journal.candidate_hash") == b["reference_fix_hash"],
        "receipt sha256 = bounty Proof 0 receipt hash": rh == b["proof0_receipt_hash"],
        "journal sha256 = bounty Proof 0 journal hash": j.get("journal sha256") == b["proof0_journal_hash"],
        "journal verdict = PASS": j.get("journal.verdict") == "PASS",
    })
for k, ok in c.items():
    print(("OK   " if ok else "FAIL ") + k)
print("ATTEST" if all(c.values()) else "REFUSE")
sys.exit(0 if all(c.values()) else 1)
PY
