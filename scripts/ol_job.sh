#!/usr/bin/env bash
# OutLayer testnet job from an arguments FILE (for large inputs such as a receipt): asks estimate_execution_cost for
# the file's resource limits and input length, then sends request_execution with that file from the testnet research
# account. Records the estimate, the file's sha256 and the CLI output (signatures, long key-like strings and home paths
# removed) under docs/evidence/OL-diag/<name>.txt. Usage: ol_job.sh <name> <args.json> <deposit, e.g. "2.8 NEAR">
set -u
name="$1"; args="$2"; deposit="$3"
out="docs/evidence/OL-diag/$name.txt"
est_args=$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"resource_limits":d["resource_limits"],"input_len":len(d.get("input_data",""))}))' "$args")
{ date -u +%FT%TZ
  echo "args file: $args sha256 $(sha256sum "$args" | cut -c1-64), $(stat -c %s "$args") bytes"
  echo "source: $(python3 -I -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["source"]))' "$args")"
  echo "\$ near contract call-function as-read-only outlayer.testnet estimate_execution_cost json-args '$est_args' network-config testnet now"
  near contract call-function as-read-only outlayer.testnet estimate_execution_cost json-args "$est_args" network-config testnet now 2>&1 | sed -n '/return value/{n;p}'
  echo "\$ near contract call-function as-transaction outlayer.testnet request_execution file-args $args prepaid-gas '300.0 Tgas' attached-deposit '$deposit' sign-as kintsugi-res2-prnvm.testnet network-config testnet sign-with-legacy-keychain send"
  s=$(date +%s)
  timeout 400 near contract call-function as-transaction outlayer.testnet request_execution file-args "$args" \
    prepaid-gas '300.0 Tgas' attached-deposit "$deposit" sign-as kintsugi-res2-prnvm.testnet network-config testnet sign-with-legacy-keychain send 2>&1 \
    | grep -v '"input_data"\|receipt_b64'
  echo "exit=$? wall_s=$(( $(date +%s)-s ))"
} | grep -v -i -E 'private|seed.?phrase|mnemonic|signature' \
  | grep -v -E '[1-9A-HJ-NP-Za-km-z]{80,}' \
  | sed -E -e 's/\x1b\[[0-9;]*m//g' -e 's#/home/[^/ "]+#~#g' -e 's/(request_data":"[^"]{0,400})[^\n]*/\1 ...(cut)/' > "$out"
grep -E 'sha256|^"|Transaction ID|execution_completed|Execution failed|promise failed|return value|exit=' "$out" | cut -c1-400
