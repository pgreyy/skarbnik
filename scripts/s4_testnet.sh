#!/usr/bin/env bash
# Spike S4/S5 end to end on NEAR testnet, with a real proof and OutLayer as verifier 1. Phases, run in order:
#   deploy   update the contract code on bounty.kintsugi-djloo.testnet (no init: state is kept) and register
#            outlayer.testnet as a verifier
#   bounty   create a bounty with the real image id, exploit commitment, corpus and original hashes; researcher 1
#            commits and reveals data/demo/fixed.wasm; saves the on-chain seed and submission id
#   prove    prove the check with that seed and submission id (laptop CPU, capped), then compress to one
#            succinct receipt
#   verdict  the vendor posts PASS with sha256(journal) and sha256(receipt)
#   outlayer set the OutLayer config (needs WASM_URL), request the OutLayer check with the receipt, wait for the
#            callback; then verifier 2 attests, which finalizes and pays
# Usage, from the repo root: ./scripts/s4_testnet.sh <phase>. Testnet only. State between phases: docs/evidence/S4/run.env.
set -euo pipefail
cd "$(dirname "$0")/.."
export OUT=docs/evidence/S4 CONTRACT=bounty.kintsugi-djloo.testnet
source scripts/s3_lib.sh
source docs/evidence/S3b/accounts.env
mkdir -p "$OUT/steps" target/s4-logs target/s4
RUN="$OUT/run.env"; touch "$RUN"; source "$RUN"
OUTLAYER=outlayer.testnet
SEC=1000000000
HOST=./target/release/kintsugi-host
WASM=target/near/kintsugi_contract/kintsugi_contract.wasm
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }

case "${1:-}" in
deploy)
  { echo "wasm_bytes=$(stat -c %s "$WASM")"; echo "wasm_sha256=$(sha "$WASM")"; } | tee "$OUT/contract_wasm.txt"
  run_near deploy_code deploy "$CONTRACT" contract deploy "$CONTRACT" use-file "$WASM" without-init-call \
    network-config testnet sign-with-legacy-keychain send
  grep -q "\"$OUTLAYER\"" <<<"$(view get_verifiers '{}')" || \
    call register_outlayer "$CONTRACT" register_verifier "{\"account_id\":\"$OUTLAYER\",\"label\":\"verifier 1: OutLayer job, trusts outlayer.testnet and its operator\"}"
  ;;
bounty)
  # Real values from the S2b 16 input receipt's journal (same guest, same demo files).
  J=$($HOST verify target/s2/receipt_f16_alloc.bin)
  IMAGE=$(sed -n 's/^image id: //p' <<<"$J"); EXPLOIT=$(sed -n 's/^journal.exploit_commitment: //p' <<<"$J")
  CORPUS=$(sed -n 's/^journal.corpus_hash: //p' <<<"$J"); ORIG=$(sha data/demo/original.wasm)
  PROOF0=$(python3 -c 'import hashlib; print(hashlib.sha256(b"kintsugi S4 placeholder: proof 0 receipt (Proof 0 not built yet)").hexdigest())')
  ID=$(json_field "$(view get_next_bounty_id '{}')" "")
  call s4_create_bounty "$VENDOR" create_bounty "{\"original_hash\":\"$ORIG\",\"corpus_hash\":\"$CORPUS\",\"image_id\":\"$IMAGE\",\"exploit_commitment\":\"$EXPLOIT\",\"proof0_receipt_hash\":\"$PROOF0\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 4 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3 * 3600 * SEC ))\",\"expiry_ns\":\"$(( 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\"}" "0.5 NEAR"
  [ "$(view get_bounty "{\"bounty_id\":\"$ID\"}")" != "null" ] || { echo "create_bounty failed"; exit 1; }
  read -r PATCH NONCE FP < <(python3 - data/demo/fixed.wasm "$RES1" <<'PY'
import base64, hashlib, secrets, sys
patch = open(sys.argv[1], 'rb').read(); payout = sys.argv[2].encode(); nonce = secrets.token_bytes(32)
buf = b"kintsugi-commit-v1" + len(patch).to_bytes(4, "little") + patch + len(payout).to_bytes(4, "little") + payout + nonce
print(base64.b64encode(patch).decode(), nonce.hex(), hashlib.sha256(buf).hexdigest())
PY
)
  IDX=$(json_field "$(view get_bounty "{\"bounty_id\":\"$ID\"}")" commits)
  [ "$(json_field "$(view get_credit "{\"account_id\":\"$RES1\"}")" "")" -ge 10000000000000000000000 ] || call s4_credit_r1 "$RES1" deposit_credit '{}' "0.05 NEAR"
  call s4_commit "$RES1" commit "{\"bounty_id\":\"$ID\",\"fingerprint\":\"$FP\",\"payout\":\"$RES1\"}"
  sleep 4
  call s4_reveal "$RES1" reveal "{\"bounty_id\":\"$ID\",\"index\":$IDX,\"patch\":\"$PATCH\",\"nonce\":\"$NONCE\"}"
  SUB=$(view get_submission "{\"bounty_id\":\"$ID\",\"index\":$IDX}")
  SEED=$(json_field "$SUB" seed); SID=$(json_field "$(view get_submission_id "{\"bounty_id\":\"$ID\",\"index\":$IDX}")" "")
  [ "$(json_field "$SUB" patch_hash)" = "$(sha data/demo/fixed.wasm)" ] || { echo "revealed patch hash differs from data/demo/fixed.wasm"; exit 1; }
  save BOUNTY "$ID"; save INDEX "$IDX"; save IMAGE "$IMAGE"; save SEED "$SEED"; save SID "$SID"
  echo "bounty $ID index $IDX seed $SEED submission_id $SID"
  ;;
prove)
  MAX_SECONDS=7200 scripts/s2_measure.sh target/s4-logs/prove_s4.log -- $HOST prove data/demo/fixed.wasm --demo-salt \
    --fuzz-count 16 --variants 32 --po2 19 --seed "$SEED" --submission-id "$SID" --out target/s4/receipt.bin
  MAX_SECONDS=7200 scripts/s2_measure.sh target/s4-logs/compress_s4.log -- $HOST compress target/s4/receipt.bin \
    target/s4/receipt_succinct.bin succinct
  $HOST verify target/s4/receipt_succinct.bin | tee target/s4-logs/verify_s4.txt
  grep -q '^VALID' target/s4-logs/verify_s4.txt || { echo "succinct receipt does not verify"; exit 1; }
  save JOURNAL_SHA256 "$(sed -n 's/^journal sha256: //p' target/s4-logs/verify_s4.txt)"
  save RECEIPT_SHA256 "$(sha target/s4/receipt_succinct.bin)"
  grep -E '^(JOURNAL|RECEIPT)_SHA256=' "$RUN"
  ;;
verdict)
  call s4_post_verdict "$VENDOR" post_verdict "{\"bounty_id\":\"$BOUNTY\",\"index\":$INDEX,\"verdict\":\"PASS\",\"journal_hash\":\"$JOURNAL_SHA256\",\"receipt_hash\":\"$RECEIPT_SHA256\"}"
  ;;
outlayer)
  : "${WASM_URL:?set WASM_URL to the public https URL of farbox-verifier.wasm}"
  : "${WASM_SHA256:?set WASM_SHA256}"
  call s4_set_outlayer "$CONTRACT" set_outlayer "{\"config\":{\"account_id\":\"$OUTLAYER\",\"wasm_url\":\"$WASM_URL\",\"wasm_sha256\":\"$WASM_SHA256\",\"build_target\":\"wasm32-wasip1\",\"max_instructions\":\"100000000000\",\"max_memory_mb\":256,\"max_execution_seconds\":\"60\"}}"
  B64=$(base64 -w0 target/s4/receipt_succinct.bin)
  echo "{\"bounty_id\":\"$BOUNTY\",\"index\":$INDEX,\"receipt_b64\":\"$B64\"}" > target/s4/request_args.json
  echo "request args bytes: $(stat -c %s target/s4/request_args.json)" | tee -a "$OUT/summary.txt"
  run_near s4_request_outlayer request_outlayer_check "$RES2" contract call-function as-transaction "$CONTRACT" \
    request_outlayer_check file-args target/s4/request_args.json prepaid-gas '300 Tgas' attached-deposit '3.2 NEAR' \
    sign-as "$RES2" network-config testnet sign-with-legacy-keychain send
  echo "attestations after the OutLayer callback: $(json_field "$(view get_submission "{\"bounty_id\":\"$BOUNTY\",\"index\":$INDEX}")" attestations)" | tee -a "$OUT/summary.txt"
  ;;
attest2)
  call s4_attest_v2 "$VER2" attest "{\"bounty_id\":\"$BOUNTY\",\"index\":$INDEX,\"verdict\":\"PASS\",\"journal_hash\":\"$JOURNAL_SHA256\",\"receipt_hash\":\"$RECEIPT_SHA256\"}"
  echo "submission after verifier 2: $(view get_submission "{\"bounty_id\":\"$BOUNTY\",\"index\":$INDEX}" | cut -c1-400)" | tee -a "$OUT/summary.txt"
  ;;
*) echo "usage: $0 deploy|bounty|prove|verdict|outlayer|attest2"; exit 2 ;;
esac
