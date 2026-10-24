#!/usr/bin/env bash
# Spike S8 on NEAR testnet: the attempt budget K is enforced by the contract. Creates an arena bounty with
# max_commits = 3 (the arena's commitment and public hashes, see docs/evidence/S8/arena_run.txt), then a probe
# player commits four probe fingerprints. The first three are counted (fees rise each time); the fourth must be
# ignored, cost nothing, and log commit_ignored. Testnet only. Run from the repo root after ./scripts/s8_arena.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
export OUT=docs/evidence/S8 CONTRACT=bounty.kintsugi-djloo.testnet
source scripts/s3_lib.sh
source docs/evidence/S3b/accounts.env
SEC=1000000000
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
COMMITMENT=$(sed -n 's/.*exploit commitment sha256(salt || exploit): \([0-9a-f]\{64\}\);.*/\1/p' "$OUT/arena_run.txt")
TESTS=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' data/arena/public_tests.txt)
IMAGE=$(python3 -c 'import hashlib; print(hashlib.sha256(b"kintsugi S8 placeholder: arena verdicts come from the native checker, no proofs").hexdigest())')
ID=$(json_field "$(view get_next_bounty_id '{}')" "")
call s8_create_arena_bounty "$VENDOR" create_bounty "{\"original_hash\":\"$(sha data/arena/original.wasm)\",\"corpus_hash\":\"$TESTS\",\"image_id\":\"$IMAGE\",\"exploit_commitment\":\"$COMMITMENT\",\"proof0_receipt_hash\":\"$IMAGE\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( 7200 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\"}" "0.5 NEAR"
echo "arena bounty $ID: $(view get_bounty "{\"bounty_id\":\"$ID\"}" | cut -c1-200)"
C0=$(json_field "$(view get_credit "{\"account_id\":\"$RES1\"}")" "")
for a in 1 2 3 4; do
  f=target/arena/probes/probe_$a.wasm; [ -f "$f" ] || f=target/arena/probes/probe_3.wasm   # the 4th reuses a probe file
  fp=$(python3 - "$f" "$RES1" <<'PY'
import hashlib, secrets, sys
patch = open(sys.argv[1], 'rb').read(); payout = sys.argv[2].encode(); nonce = secrets.token_bytes(32)
print(hashlib.sha256(b"kintsugi-commit-v1" + len(patch).to_bytes(4, "little") + patch + len(payout).to_bytes(4, "little") + payout + nonce).hexdigest())
PY
)
  call "s8_commit_probe_$a" "$RES1" commit "{\"bounty_id\":\"$ID\",\"fingerprint\":\"$fp\",\"payout\":\"$RES1\"}"
  echo "after probe commit $a: commits=$(json_field "$(view get_bounty "{\"bounty_id\":\"$ID\"}")" commits), credit=$(json_field "$(view get_credit "{\"account_id\":\"$RES1\"}")" "")" | tee -a "$OUT/chain_summary.txt"
done
grep -h -o -E '"event":"commit_ignored"[^}]*' "$OUT/steps/s8_commit_probe_4.txt" | head -1 | tee -a "$OUT/chain_summary.txt" || true
echo "credit before: $C0; fees taken: $(python3 -c "print($C0 - $(json_field "$(view get_credit "{\"account_id\":\"$RES1\"}")" ""))")" | tee -a "$OUT/chain_summary.txt"
