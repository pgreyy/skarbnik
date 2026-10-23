#!/usr/bin/env bash
# Spike S3: deploys the bounty contract wasm to the testnet contract account and runs its `new` init
# (which replaces the old S0 hello world state), then creates the four S3 test sub-accounts plus a
# payout account, funded from the contract account. Testnet only. Run from the repo root after
# `cd contract && cargo near build non-reproducible-wasm`:  ./scripts/s3_deploy.sh
# Set SKIP_DEPLOY=1 to only create missing accounts. Running the init again wipes the contract state.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/s3_lib.sh

WASM=target/near/kintsugi_contract/kintsugi_contract.wasm
mkdir -p "$OUT"

if [ "${SKIP_DEPLOY:-0}" != "1" ]; then
  { echo "wasm_bytes=$(stat -c %s "$WASM")"; echo "wasm_sha256=$(sha256sum "$WASM" | cut -d' ' -f1)"; } | tee "$OUT/wasm.txt"
  run_near deploy deploy+new "$CONTRACT" contract deploy "$CONTRACT" use-file "$WASM" \
    with-init-call new json-args "{\"owner\":\"$CONTRACT\"}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config testnet sign-with-legacy-keychain send
fi

# Account name and starting balance. The vendor funds three 0.5 NEAR bounties.
for pair in "$VENDOR:2" "$RESEARCHER:0.5" "$VERIFIER1:0.5" "$VERIFIER2:0.5" "$PAYOUT:0.1"; do
  acct="${pair%%:*}"; amount="${pair##*:}"
  if [ "$(balance "$acct")" != "missing" ]; then
    echo "== $acct already exists"; continue
  fi
  run_near "create_${acct%%.*}" create-account "$CONTRACT" account create-account fund-myself "$acct" "$amount NEAR" \
    autogenerate-new-keypair save-to-legacy-keychain sign-as "$CONTRACT" network-config testnet sign-with-legacy-keychain send
done
