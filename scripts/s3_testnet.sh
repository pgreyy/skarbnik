#!/usr/bin/env bash
# Spike S3 on NEAR testnet. Runs, against the deployed bounty contract:
#   1. happy path: register two verifiers, create a bounty, commit, reveal, post PASS, attest by
#      verifier 1 twice (the second counts once), attest by verifier 2, check the payout arrived;
#   2. silent vendor path: create, commit, reveal, no verdict, an early timeout claim (must fail),
#      a late verdict (must fail), then claim_timeout pays the researcher's payout account;
#   3. expiry path: create, an early expire (must fail), wait, expire refunds the vendor;
#   4. one call with more than 300 TGas attached (500, 1000 and 1001 TGas);
#   5. block time over 100+ consecutive blocks, finality lag, and send-to-FINAL wall time.
# Testnet only. Hashes posted are labelled placeholders (S3 has no real proofs; S1 and S2 make them).
# Run from the repo root after ./scripts/s3_deploy.sh:  ./scripts/s3_testnet.sh
# PHASES picks parts, default "happy silent expire gas measure gasreport", e.g. PHASES="silent" ./scripts/s3_testnet.sh
# Output: docs/evidence/S3/ (steps/*.txt, transactions.tsv, gas.tsv, *.json, run.log).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/s3_lib.sh
mkdir -p "$OUT/steps" target/s3-logs
MEASURE="python3 -I scripts/s3_measure.py"

placeholder() { python3 -c 'import hashlib,sys; print(hashlib.sha256(("kintsugi S3 placeholder: "+sys.argv[1]).encode()).hexdigest())' "$1"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
now_ns() { curl -4 -s --max-time 60 "$RPC" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"t","method":"block","params":{"finality":"final"}}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["header"]["timestamp_nanosec"])'; }
# Wait until the final block timestamp is past $1 (nanoseconds).
wait_past() { local target="$1"; while [ "$(now_ns)" -le "$target" ]; do sleep 3; done; }
# Wait until an account balance differs from $2 (max 60 s); prints the new balance.
wait_balance_change() { local acct="$1" old="$2" b i; for i in $(seq 1 20); do b=$(balance "$acct"); [ "$b" != "$old" ] && break; sleep 3; done; echo "$b"; }
yocto_diff() { python3 -c 'import sys; print(int(sys.argv[2])-int(sys.argv[1]))' "$1" "$2"; }

ORIG=$(placeholder "original module"); CORPUS=$(placeholder "public test corpus"); IMAGE=$(placeholder "harness image id")
EXPLOIT=$(placeholder "exploit commitment"); PROOF0=$(placeholder "proof 0 receipt")
SEC=1000000000
BOUNTY="0.5 NEAR"; BOUNTY_YOCTO=500000000000000000000000

# Make one patch, nonce and fingerprint (layout as in contract/src/lib.rs commit_fingerprint).
# Prints: base64 patch, nonce hex, fingerprint hex.
make_patch() {
  python3 - "$1" "$PAYOUT" <<'PY'
import base64, hashlib, secrets, sys
patch = ("kintsugi S3 placeholder patch, not a real module: " + sys.argv[1]).encode()
payout = sys.argv[2].encode()
nonce = secrets.token_bytes(32)
buf = b"kintsugi-commit-v1" + len(patch).to_bytes(4, "little") + patch + len(payout).to_bytes(4, "little") + payout + nonce
print(base64.b64encode(patch).decode(), nonce.hex(), hashlib.sha256(buf).hexdigest())
PY
}

create() {  # create <step> <reveal_gap_s> <verdict_window_s> <attest_window_s> <expiry_s>; prints bounty id
  local id; id=$(json_field "$(view get_next_bounty_id '{}')" "")  # next id is the id this call gets
  call "$1" "$VENDOR" create_bounty "{\"original_hash\":\"$ORIG\",\"corpus_hash\":\"$CORPUS\",\"image_id\":\"$IMAGE\",\"exploit_commitment\":\"$EXPLOIT\",\"proof0_receipt_hash\":\"$PROOF0\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( $2 * SEC ))\",\"verdict_window_ns\":\"$(( $3 * SEC ))\",\"attest_window_ns\":\"$(( $4 * SEC ))\",\"expiry_ns\":\"$(( $5 * SEC ))\"}" "$BOUNTY" >&2
  [ "$(view get_bounty "{\"bounty_id\":\"$id\"}")" != "null" ] || { echo "create_bounty $1 failed, stopping" >&2; exit 1; }
  echo "$id"
}

commit_reveal() {  # commit_reveal <prefix> <bounty id>; sets IDX
  local p="$1" b="$2" patch nonce fp
  read -r patch nonce fp < <(make_patch "$p bounty $b $(date -u +%s%N)")
  IDX=$(json_field "$(view get_bounty "{\"bounty_id\":\"$b\"}")" commits)
  call "${p}_commit" "$RESEARCHER" commit "{\"bounty_id\":\"$b\",\"fingerprint\":\"$fp\",\"payout\":\"$PAYOUT\"}"
  sleep 4   # reveal gap is 2 s of block time
  call "${p}_reveal" "$RESEARCHER" reveal "{\"bounty_id\":\"$b\",\"index\":$IDX,\"patch\":\"$patch\",\"nonce\":\"$nonce\"}"
}

echo "### S3 testnet run $(date -u +%Y-%m-%dT%H:%M:%SZ), contract $CONTRACT"

PHASES="${PHASES:-happy silent expire gas measure gasreport}"
has() { [[ " $PHASES " == *" $1 "* ]]; }
JOURNAL=$(placeholder "journal"); RECEIPT=$(placeholder "receipt")

# ---------- 1. happy path ----------
if has happy; then
VERIFIERS=$(view get_verifiers '{}')
for v in "$VERIFIER1:verifier 1 (S3 test key, run by the project)" "$VERIFIER2:verifier 2 (S3 test key, run by the project)"; do
  acct="${v%%:*}"; label="${v#*:}"
  if ! grep -q "\"$acct\"" <<<"$VERIFIERS"; then
    call "happy_register_${acct%%.*}" "$CONTRACT" register_verifier "{\"account_id\":\"$acct\",\"label\":\"$label\"}"
  fi
done
B1=$(create happy_create_bounty 2 600 600 3600)
echo "happy bounty id $B1"
commit_reveal happy "$B1"
JOURNAL=$(placeholder "journal for bounty $B1"); RECEIPT=$(placeholder "receipt for bounty $B1")
V="\"bounty_id\":\"$B1\",\"index\":$IDX,\"verdict\":\"PASS\",\"journal_hash\":\"$JOURNAL\",\"receipt_hash\":\"$RECEIPT\""
call happy_post_verdict "$VENDOR" post_verdict "{$V}"
PAY0=$(balance "$PAYOUT")
call happy_attest_v1 "$VERIFIER1" attest "{$V}"
call happy_attest_v1_again "$VERIFIER1" attest "{$V}"
call happy_attest_v2 "$VERIFIER2" attest "{$V}"
PAY1=$(wait_balance_change "$PAYOUT" "$PAY0")
echo "happy payout balance change (yoctoNEAR): $(yocto_diff "$PAY0" "$PAY1") expected $BOUNTY_YOCTO" | tee "$OUT/happy_balance.txt"
view get_bounty "{\"bounty_id\":\"$B1\"}" > "$OUT/happy_bounty_view.json"
view get_submission "{\"bounty_id\":\"$B1\",\"index\":$IDX}" > "$OUT/happy_submission_view.json"

fi

# ---------- 2. silent vendor path ----------
if has silent; then
B2=$(create silent_create_bounty 2 20 20 3600)
echo "silent bounty id $B2"
commit_reveal silent "$B2"
call_expect_fail silent_timeout_too_early "$RESEARCHER" claim_timeout "{\"bounty_id\":\"$B2\",\"index\":$IDX}"
DEADLINE=$(json_field "$(view get_submission "{\"bounty_id\":\"$B2\",\"index\":$IDX}")" deadline_ns)
echo "silent deadline_ns $DEADLINE; waiting for the final block time to pass it"
wait_past "$DEADLINE"
call_expect_fail silent_late_verdict "$VENDOR" post_verdict "{\"bounty_id\":\"$B2\",\"index\":$IDX,\"verdict\":\"FAIL\",\"journal_hash\":\"$JOURNAL\",\"receipt_hash\":\"$RECEIPT\"}"
PAY0=$(balance "$PAYOUT")
call silent_claim_timeout "$RESEARCHER" claim_timeout "{\"bounty_id\":\"$B2\",\"index\":$IDX}"
PAY1=$(wait_balance_change "$PAYOUT" "$PAY0")
echo "silent payout balance change (yoctoNEAR): $(yocto_diff "$PAY0" "$PAY1") expected $BOUNTY_YOCTO" | tee "$OUT/silent_balance.txt"
view get_bounty "{\"bounty_id\":\"$B2\"}" > "$OUT/silent_bounty_view.json"
view get_submission "{\"bounty_id\":\"$B2\",\"index\":$IDX}" > "$OUT/silent_submission_view.json"

fi

# ---------- 3. expiry path ----------
if has expire; then
B3=$(create expire_create_bounty 2 20 20 30)
echo "expire bounty id $B3"
call_expect_fail expire_too_early "$RESEARCHER" expire "{\"bounty_id\":\"$B3\"}"
EXP=$(json_field "$(view get_bounty "{\"bounty_id\":\"$B3\"}")" expires_at_ns)
wait_past "$EXP"
VEN0=$(balance "$VENDOR")
call expire_refund "$RESEARCHER" expire "{\"bounty_id\":\"$B3\"}"
VEN1=$(wait_balance_change "$VENDOR" "$VEN0")
echo "expire vendor balance change (yoctoNEAR): $(yocto_diff "$VEN0" "$VEN1") expected $BOUNTY_YOCTO" | tee "$OUT/expire_balance.txt"
view get_bounty "{\"bounty_id\":\"$B3\"}" > "$OUT/expire_bounty_view.json"

fi

# ---------- 4. more than 300 TGas on one call ----------
if has gas; then
for g in 500 1000 1001; do
  call "gas_${g}_tgas" "$CONTRACT" get_next_bounty_id '{}' "0 NEAR" "$g Tgas"
done

fi

# ---------- 5. block time and finality ----------
if has measure; then
$MEASURE rtt 10 | tee "$OUT/rpc_rtt.json"
$MEASURE blocktime 120 "$OUT/blocktime.json" | tee "$OUT/blocktime_summary.json"
$MEASURE finality 20 "$OUT/finality_lag.json" | tee "$OUT/finality_lag_summary.json"
: > "$OUT/send_to_final.jsonl"
for i in 1 2 3 4 5; do
  for wait in FINAL EXECUTED_OPTIMISTIC; do
    f="target/s3-logs/signed_${wait}_$i.json"; rm -f "$f"
    near contract call-function as-transaction "$CONTRACT" get_next_bounty_id json-args '{}' prepaid-gas '10 Tgas' \
      attached-deposit '0 NEAR' sign-as "$CONTRACT" network-config testnet sign-with-legacy-keychain save-to-file "$f" \
      > /dev/null 2>&1
    $MEASURE sendfinal "$f" "$wait" | tee -a "$OUT/send_to_final.jsonl"
    rm -f "$f"; sleep 3
  done
done

fi

# ---------- gas per transaction, from the chain ----------
if has gasreport; then
  $MEASURE gas "$TXT" "$OUT/gas.tsv"
fi
echo "### done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
