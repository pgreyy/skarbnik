#!/usr/bin/env bash
# OutLayer testnet diagnosis: sends one request_execution with the given JSON
# arguments from the testnet research account, and records the full CLI output
# under docs/evidence/OL-diag/<name>.txt, with signatures, long key-like strings and home paths removed
# (the same filter as filter_private in scripts/s3_lib.sh). Testnet only.
set -u
name="$1"; args="$2"; deposit="${3:-0.1 NEAR}"
out="docs/evidence/OL-diag/$name.txt"
mkdir -p docs/evidence/OL-diag
{ date -u +%FT%TZ
  echo "\$ near contract call-function as-transaction outlayer.testnet request_execution json-args '$args' prepaid-gas '300.0 Tgas' attached-deposit '$deposit' sign-as kintsugi-res2-prnvm.testnet network-config testnet sign-with-legacy-keychain send"
  s=$(date +%s)
  timeout 400 near contract call-function as-transaction outlayer.testnet request_execution json-args "$args" \
    prepaid-gas '300.0 Tgas' attached-deposit "$deposit" sign-as kintsugi-res2-prnvm.testnet network-config testnet sign-with-legacy-keychain send 2>&1
  echo "exit=$? wall_s=$(( $(date +%s)-s ))"
} | grep -v -i -E 'private|secret|seed.?phrase|mnemonic|signature' \
  | grep -v -E '[1-9A-HJ-NP-Za-km-z]{80,}' \
  | sed -E -e 's/\x1b\[[0-9;]*m//g' -e 's#/home/[^/ "]+#~#g' > "$out"
grep -E 'Transaction ID|EVENT_JSON|Refunded|promise failed|return value|^"|exit=|Error' "$out" | cut -c1-600
