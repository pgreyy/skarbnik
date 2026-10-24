#!/usr/bin/env bash
# Spike S7 fallback on NEAR testnet: a SCRIPTED researcher agent (canned patch, no language model) that works only
# through a function call key. The key belongs to the owner's account, may call only `commit` and `reveal` on the
# bounty contract, and spends credit the owner deposited inside the contract. Phases, in order:
#   setup    owner adds the agent key (allowance 0.25 NEAR, methods commit and reveal) and deposits credit
#   bounty   the vendor creates a bounty; the agent reads it, checks its canned patch on the public tests with the
#            native checker (no secret input), commits and reveals with the agent key
#   limits   the agent key tries what it must not do: send NEAR, withdraw credit, attach a deposit, call another
#            method; every attempt must be refused
#   prove    the vendor proves the agent's submission (laptop CPU, capped) and compresses it
#   finish   the vendor posts the verdict and two Level 0 verifiers attest; the owner's payout account is paid
# The model-driven agent (NEAR AI Cloud) needs an account and API key from the owner; not done.
# Usage, from the repo root: ./scripts/s7_agent.sh <phase>. Testnet only. State: docs/evidence/S7/run.env.
set -euo pipefail
cd "$(dirname "$0")/.."
export OUT=docs/evidence/S7 CONTRACT=bounty.kintsugi-djloo.testnet
source scripts/s3_lib.sh
source docs/evidence/S3b/accounts.env
mkdir -p "$OUT/steps" target/s7-logs target/s7
RUN="$OUT/run.env"; touch "$RUN"; source "$RUN"
# The agent key file's local path is kept out of the repository (target/ is ignored).
KEYENV=target/s7/agent_key.env; [ -f "$KEYENV" ] && source "$KEYENV"
OWNER=$RES2                                   # the agent's owner (a faucet test account)
CREDS="$HOME/.kintsugi-secrets/near-credentials/testnet"
SEC=1000000000
HOST=./target/release/kintsugi-host
CHECK=./target/debug/kintsugi-check
PATCH_FILE=data/demo/fixed.wasm               # the canned patch
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }

# Call as the agent: sign with the agent key file only. Usage: agent_call <step> <method> <json> [deposit]
agent_call() {
  run_near "$1" "$2" "agent key of $OWNER" contract call-function as-transaction "$CONTRACT" "$2" json-args "$3" \
    prepaid-gas '100 Tgas' attached-deposit "${4:-0 NEAR}" sign-as "$OWNER" network-config testnet \
    sign-with-access-key-file "$AGENT_KEY_FILE" send
}

case "${1:-}" in
setup)
  cp -p "$CREDS/$OWNER.json" "$CREDS/$OWNER.json.before-agent-key"
  before=$(ls "$CREDS/$OWNER/" 2>/dev/null | sort)
  run_near s7_add_agent_key add-key "$OWNER" account add-key "$OWNER" grant-function-call-access \
    --allowance '0.25 NEAR' --contract-account-id "$CONTRACT" --function-names 'commit, reveal' \
    autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send
  if ! cmp -s "$CREDS/$OWNER.json" "$CREDS/$OWNER.json.before-agent-key"; then
    new_main="$CREDS/$OWNER/agent-key-from-main-file.json"; mkdir -p "$CREDS/$OWNER"
    mv "$CREDS/$OWNER.json" "$new_main"; mv "$CREDS/$OWNER.json.before-agent-key" "$CREDS/$OWNER.json"
    echo "the owner key file had been replaced; restored it and kept the new key file separately"
  else rm "$CREDS/$OWNER.json.before-agent-key"; fi
  after=$(ls "$CREDS/$OWNER/" | sort)
  newf=$(comm -13 <(echo "$before") <(echo "$after") | head -1)
  [ -n "$newf" ] || newf=agent-key-from-main-file.json
  chmod 600 "$CREDS/$OWNER/$newf"
  PUB=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["public_key"])' "$CREDS/$OWNER/$newf")
  echo "AGENT_KEY_FILE=$CREDS/$OWNER/$newf" > "$KEYENV"; chmod 600 "$KEYENV"; save AGENT_PUBLIC_KEY "$PUB"
  call s7_owner_deposit_credit "$OWNER" deposit_credit '{}' "0.05 NEAR"
  echo "agent public key: $PUB"
  ;;
bounty)
  ID=$(json_field "$(view get_next_bounty_id '{}')" "")
  J=$($HOST verify target/s2/receipt_f16_alloc.bin)
  IMAGE=$(sed -n 's/^image id: //p' <<<"$J"); EXPLOIT=$(sed -n 's/^journal.exploit_commitment: //p' <<<"$J")
  CORPUS=$(sed -n 's/^journal.corpus_hash: //p' <<<"$J")
  PROOF0=$(python3 -c 'import hashlib; print(hashlib.sha256(b"kintsugi S7 placeholder: proof 0 receipt (Proof 0 not built yet)").hexdigest())')
  call s7_create_bounty "$VENDOR" create_bounty "{\"original_hash\":\"$(sha data/demo/original.wasm)\",\"corpus_hash\":\"$CORPUS\",\"image_id\":\"$IMAGE\",\"exploit_commitment\":\"$EXPLOIT\",\"proof0_receipt_hash\":\"$PROOF0\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 6 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3 * 3600 * SEC ))\",\"expiry_ns\":\"$(( 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\"}" "0.5 NEAR"
  B=$(view get_bounty "{\"bounty_id\":\"$ID\"}"); [ "$B" != "null" ] || { echo "create_bounty failed"; exit 1; }
  # The agent: read the bounty, check the canned patch on the public tests only (it never sees the secret input).
  echo "agent read bounty $ID: next fee $(json_field "$B" next_fee) yoctoNEAR, credit $(json_field "$(view get_credit "{\"account_id\":\"$OWNER\"}")" "")"
  pass=0; fail=0
  while read -r input expected _comment; do
    { [ -z "$input" ] || [ "${input:0:1}" = "#" ]; } && continue
    [ "$input" = "-" ] && input=""
    got=$($CHECK run --module "$PATCH_FILE" --input "$input" | awk '{print $1" "$2}')
    if [ "$got" = "returned $expected" ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
  done < <(grep -v '^\s*$' data/demo/public_tests.txt)
  echo "agent public test check of its canned patch: $pass passed, $fail failed" | tee -a "$OUT/summary.txt"
  [ "$fail" = 0 ] || { echo "agent would not submit a patch that fails public tests"; exit 1; }
  read -r PATCH NONCE FP < <(python3 - "$PATCH_FILE" "$OWNER" <<'PY'
import base64, hashlib, secrets, sys
patch = open(sys.argv[1], 'rb').read(); payout = sys.argv[2].encode(); nonce = secrets.token_bytes(32)
buf = b"kintsugi-commit-v1" + len(patch).to_bytes(4, "little") + patch + len(payout).to_bytes(4, "little") + payout + nonce
print(base64.b64encode(patch).decode(), nonce.hex(), hashlib.sha256(buf).hexdigest())
PY
)
  IDX=$(json_field "$B" commits)
  agent_call s7_agent_commit commit "{\"bounty_id\":\"$ID\",\"fingerprint\":\"$FP\",\"payout\":\"$OWNER\"}"
  sleep 4
  agent_call s7_agent_reveal reveal "{\"bounty_id\":\"$ID\",\"index\":$IDX,\"patch\":\"$PATCH\",\"nonce\":\"$NONCE\"}"
  SUB=$(view get_submission "{\"bounty_id\":\"$ID\",\"index\":$IDX}")
  [ "$(json_field "$SUB" patch_hash)" = "$(sha "$PATCH_FILE")" ] || { echo "reveal did not land"; exit 1; }
  save BOUNTY "$ID"; save INDEX "$IDX"; save SEED "$(json_field "$SUB" seed)"
  save SID "$(json_field "$(view get_submission_id "{\"bounty_id\":\"$ID\",\"index\":$IDX}")" "")"
  echo "credit after the agent's commit: $(json_field "$(view get_credit "{\"account_id\":\"$OWNER\"}")" "")" | tee -a "$OUT/summary.txt"
  ;;
limits)
  agent_call s7_limit_send_near_via_contract withdraw_credit '{"amount":"1"}' "1 yoctoNEAR" || true
  agent_call s7_limit_attach_deposit commit "{\"bounty_id\":\"$BOUNTY\",\"fingerprint\":\"$(printf 'e%.0s' $(seq 64))\",\"payout\":\"$OWNER\"}" "0.01 NEAR" || true
  agent_call s7_limit_other_method expire "{\"bounty_id\":\"$BOUNTY\"}" || true
  run_near s7_limit_transfer send-near "agent key of $OWNER" tokens "$OWNER" send-near "$RES1" '0.01 NEAR' \
    network-config testnet sign-with-access-key-file "$AGENT_KEY_FILE" send || true
  for s in s7_limit_send_near_via_contract s7_limit_attach_deposit s7_limit_other_method s7_limit_transfer; do
    printf '%s: ' "$s"; grep -m1 -i -E 'error|denied|not allowed|InvalidAccessKey|NotEnough|MethodName|ReceiverMismatch|DepositWithFunctionCall|requires' "$OUT/steps/$s.txt" | cut -c1-220 || echo "(no error line found, see $OUT/steps/$s.txt)"
  done | tee -a "$OUT/summary.txt"
  ;;
prove)
  MAX_SECONDS=10800 scripts/s2_measure.sh target/s7-logs/prove_s7.log -- $HOST prove "$PATCH_FILE" \
    --fuzz-count 16 --variants 32 --po2 19 --seed "$SEED" --submission-id "$SID" --out target/s7/receipt.bin
  MAX_SECONDS=3600 scripts/s2_measure.sh target/s7-logs/compress_s7.log -- $HOST compress target/s7/receipt.bin \
    target/s7/receipt_succinct.bin succinct
  $HOST verify target/s7/receipt_succinct.bin | tee target/s7-logs/verify_s7.txt
  grep -q '^VALID' target/s7-logs/verify_s7.txt || { echo "receipt does not verify"; exit 1; }
  save JOURNAL_SHA256 "$(sed -n 's/^journal sha256: //p' target/s7-logs/verify_s7.txt)"
  save RECEIPT_SHA256 "$(sha target/s7/receipt_succinct.bin)"
  save VERDICT "$(sed -n 's/^journal.verdict: //p' target/s7-logs/verify_s7.txt)"
  ;;
finish)
  V="\"bounty_id\":\"$BOUNTY\",\"index\":$INDEX,\"verdict\":\"$VERDICT\",\"journal_hash\":\"$JOURNAL_SHA256\",\"receipt_hash\":\"$RECEIPT_SHA256\""
  call s7_post_verdict "$VENDOR" post_verdict "{$V}"
  B0=$(balance "$OWNER")
  call s7_attest_v1 "$VER1" attest "{$V}"
  call s7_attest_v2 "$VER2" attest "{$V}"
  sleep 5
  echo "owner (payout) balance change after the attestations: $(python3 -c 'import sys; print(int(sys.argv[2])-int(sys.argv[1]))' "$B0" "$(balance "$OWNER")") yoctoNEAR" | tee -a "$OUT/summary.txt"
  echo "submission: $(view get_submission "{\"bounty_id\":\"$BOUNTY\",\"index\":$INDEX}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ("outcome","attestations","verdict")})')" | tee -a "$OUT/summary.txt"
  ;;
*) echo "usage: $0 setup|bounty|limits|prove|finish"; exit 2 ;;
esac
