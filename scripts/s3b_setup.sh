#!/usr/bin/env bash
# Spike S3b setup on NEAR testnet: creates the contract sub-account bounty.kintsugi-djloo.testnet
# (funded with 3 NEAR from kintsugi-djloo.testnet), deploys the bounty contract with attempt fees and
# credit there, and creates the test accounts (vendor, two researchers, three verifiers) from the
# testnet faucet. Account ids are written to docs/evidence/S3b/accounts.env; keys stay in the
# near-cli-rs legacy keychain and are never printed. Testnet only.
# Run from the repo root after `cd contract && cargo near build non-reproducible-wasm`:  ./scripts/s3b_setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export OUT=docs/evidence/S3b CONTRACT=bounty.kintsugi-djloo.testnet
source scripts/s3_lib.sh
PARENT=kintsugi-djloo.testnet
WASM=target/near/kintsugi_contract/kintsugi_contract.wasm
ACCOUNTS="$OUT/accounts.env"
mkdir -p "$OUT"

if [ "$(balance "$CONTRACT")" = "missing" ]; then
  run_near create_contract_account create-account "$PARENT" account create-account fund-myself "$CONTRACT" '3 NEAR' \
    autogenerate-new-keypair save-to-legacy-keychain sign-as "$PARENT" network-config testnet sign-with-legacy-keychain send
fi

if [ "${SKIP_DEPLOY:-0}" != "1" ]; then
  { echo "wasm_bytes=$(stat -c %s "$WASM")"; echo "wasm_sha256=$(sha256sum "$WASM" | cut -d' ' -f1)"; } | tee "$OUT/wasm.txt"
  run_near deploy deploy+new "$CONTRACT" contract deploy "$CONTRACT" use-file "$WASM" \
    with-init-call new json-args "{\"owner\":\"$CONTRACT\"}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config testnet sign-with-legacy-keychain send
fi

# Faucet accounts: top-level testnet accounts with a random suffix, created once and reused.
if [ ! -f "$ACCOUNTS" ]; then
  suffix=$(python3 -c 'import secrets, string; print("".join(secrets.choice(string.ascii_lowercase) for _ in range(5)))')
  : > "$ACCOUNTS"
  for role in vendor res1 res2 ver1 ver2 ver3; do
    acct="kintsugi-$role-$suffix.testnet"
    run_near "faucet_$role" create-account faucet account create-account sponsor-by-faucet-service "$acct" \
      autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
    echo "${role^^}=$acct" >> "$ACCOUNTS"
    sleep 5
  done
fi
cat "$ACCOUNTS"
while IFS='=' read -r _ acct; do echo "$acct balance_yocto=$(balance "$acct")"; done < "$ACCOUNTS" | tee "$OUT/balances_start.txt"
