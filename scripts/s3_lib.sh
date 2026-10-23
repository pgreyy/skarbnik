#!/usr/bin/env bash
# Shared helpers for the S3 testnet scripts (sourced, not run directly): account names, a filter that
# drops private material from saved output, and a wrapper that runs one near-cli-rs command, saves its
# filtered output and appends the transaction hash and gas burned to a table.

CONTRACT="${CONTRACT:-kintsugi-djloo.testnet}"
VENDOR="vendor.$CONTRACT"
RESEARCHER="researcher.$CONTRACT"
PAYOUT="payout.$CONTRACT"
VERIFIER1="verifier1.$CONTRACT"
VERIFIER2="verifier2.$CONTRACT"
RPC="${RPC:-https://test.rpc.fastnear.com}"
EXPLORER="https://explorer.testnet.near.org/transactions"
OUT="${OUT:-docs/evidence/S3}"
TXT="$OUT/transactions.tsv"

# Remove anything private before output is saved: lines naming private keys, secret keys or seed
# phrases, signature lines, and any line holding a base58 string of 80+ characters (private keys and
# signatures are that long; transaction hashes and public keys are about 44).
filter_private() {
  grep -v -i -E 'private|secret|seed.?phrase|mnemonic|signature' \
    | grep -v -E '[1-9A-HJ-NP-Za-km-z]{80,}' \
    | sed -E 's/\x1b\[[0-9;]*m//g'
  return 0
}

# Run one near-cli-rs command. Usage: run_near <step name> <method or action> <signer> <near args...>
# Saves filtered output to $OUT/steps/<step>.txt, prints it, and appends a row to $TXT:
# step, method, signer, tx hash, gas burned (CLI), fee (CLI), exit code, wall seconds.
run_near() {
  local step="$1" method="$2" signer="$3"; shift 3
  mkdir -p "$OUT/steps"
  local f="$OUT/steps/$step.txt" t0 t1 rc
  t0=$(date +%s.%N)
  set +e
  { echo "\$ near $*"; echo "utc_start=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)"; near "$@" 2>&1; echo "exit=$?"; } | filter_private > "$f"
  rc=$(grep -E '^exit=' "$f" | tail -1 | cut -d= -f2)
  set -e
  t1=$(date +%s.%N)
  echo "wall_seconds=$(python3 -c "print(round($t1-$t0,2))")" >> "$f"
  local hash gas fee
  hash=$(grep -oE 'Transaction ID: [1-9A-HJ-NP-Za-km-z]+' "$f" | head -1 | awk '{print $3}' || true)
  gas=$(grep -oE 'Gas burned: [0-9.]+ [A-Za-z]+' "$f" | head -1 | cut -d' ' -f3- || true)
  fee=$(grep -oE 'Transaction fee: [0-9.]+ NEAR' "$f" | head -1 | cut -d' ' -f3 || true)
  # A failed call prints no transaction id; s3_measure.py sendtx prints it as "tx_hash".
  [ -n "$hash" ] || hash=$(grep -oE '"tx_hash": "[1-9A-HJ-NP-Za-km-z]+"' "$f" | head -1 | cut -d'"' -f4 || true)
  [ -f "$TXT" ] || printf 'step\tmethod\tsigner\ttx_hash\tgas_burned_cli\tfee_near\texit\twall_s\n' > "$TXT"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$step" "$method" "$signer" "${hash:--}" "${gas:--}" "${fee:--}" "$rc" \
    "$(tail -1 "$f" | cut -d= -f2)" >> "$TXT"
  echo "== $step ($method by $signer): exit=$rc tx=${hash:--} gas=${gas:--}"
  sleep 1.5   # let the signer's access key nonce settle before its next transaction
  return 0
}

# Call a contract method as a transaction. Usage: call <step> <signer> <method> <json> [deposit] [gas]
call() {
  local step="$1" signer="$2" method="$3" args="$4" deposit="${5:-0 NEAR}" gas="${6:-100 Tgas}"
  run_near "$step" "$method" "$signer" contract call-function as-transaction "$CONTRACT" "$method" \
    json-args "$args" prepaid-gas "$gas" attached-deposit "$deposit" sign-as "$signer" \
    network-config testnet sign-with-legacy-keychain send
}

# A call that is expected to be refused by the contract. near-cli-rs prints no transaction id for a
# failed call, so sign with near-cli-rs (save-to-file, not sent) and send it over RPC, which returns
# the id and the failure. Usage: call_expect_fail <step> <signer> <method> <json>
call_expect_fail() {
  local step="$1" signer="$2" method="$3" args="$4" signed="target/s3-logs/signed_$1.json"
  mkdir -p target/s3-logs; rm -f "$signed"
  near contract call-function as-transaction "$CONTRACT" "$method" json-args "$args" prepaid-gas '100 Tgas' \
    attached-deposit '0 NEAR' sign-as "$signer" network-config testnet sign-with-legacy-keychain save-to-file "$signed" \
    > /dev/null 2>&1
  run_near_py "$step" "$method" "$signer" "$signed" "$args"
  rm -f "$signed"
}

run_near_py() {
  local step="$1" method="$2" signer="$3" signed="$4" args="$5" f="$OUT/steps/$1.txt" rc
  mkdir -p "$OUT/steps"
  { echo "\$ near contract call-function as-transaction $CONTRACT $method json-args '$args' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as $signer network-config testnet sign-with-legacy-keychain save-to-file <file>"
    echo "\$ python3 -I scripts/s3_measure.py sendtx <file> FINAL"
    echo "utc_start=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)"
    python3 -I scripts/s3_measure.py sendtx "$signed" FINAL; } | filter_private > "$f"
  local hash status
  hash=$(grep -oE '"tx_hash": "[1-9A-HJ-NP-Za-km-z]+"' "$f" | head -1 | cut -d'"' -f4 || true)
  status=$(grep -oE '"outcome": "[a-z]+"' "$f" | head -1 | cut -d'"' -f4 || true)
  [ -f "$TXT" ] || printf 'step\tmethod\tsigner\ttx_hash\tgas_burned_cli\tfee_near\texit\twall_s\n' > "$TXT"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$step" "$method" "$signer" "${hash:--}" "-" "-" "rpc:${status:--}" "-" >> "$TXT"
  echo "== $step ($method by $signer, expected to fail): outcome=${status:--} tx=${hash:--}"
  grep -oE '"failure": "[^"]*"' "$f" || true
  sleep 1.5
  return 0
}

# Read-only view call; prints the JSON result. Usage: view <method> <json>
view() {
  curl -4 -s --max-time 60 "$RPC" -H 'Content-Type: application/json' -d "$(python3 -c '
import base64, json, sys
print(json.dumps({"jsonrpc":"2.0","id":"v","method":"query","params":{"request_type":"call_function",
 "finality":"final","account_id":sys.argv[1],"method_name":sys.argv[2],
 "args_base64":base64.b64encode(sys.argv[3].encode()).decode()}}))' "$CONTRACT" "$1" "$2")" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); print(bytes(r["result"]["result"]).decode() if "result" in r else json.dumps(r))'
}

# Native balance in yoctoNEAR at final finality. Usage: balance <account>
balance() {
  curl -4 -s --max-time 60 "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":\"b\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" \
    | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r["result"]["amount"] if "result" in r else "missing")'
}
