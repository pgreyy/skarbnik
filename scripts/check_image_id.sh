#!/usr/bin/env bash
# One command to check the checker: rebuilds the patch checker guest reproducibly (inside RISC Zero's guest builder
# Docker image, see harness/build.rs), prints its image id, and compares it with the published image id. If a contract
# and a bounty id are given, it also compares it with the image id that bounty has on NEAR testnet (read over RPC).
# Prints MATCH and exits 0 when every comparison matches; prints DIFFERENT and exits 1 otherwise.
# Usage, from the repository root:  ./scripts/check_image_id.sh [<contract account> <bounty id>]
# Needs: Docker with the buildx plugin, the Rust toolchain, cargo-risczero 3.0.6, python3, curl (for the bounty check).
set -euo pipefail
cd "$(dirname "$0")/.."
PUBLISHED=dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
RPC="${RPC:-https://rpc.testnet.near.org}"
cargo build --release -p kintsugi-harness
methods=$(ls -t target/release/build/kintsugi-harness-*/out/methods.rs | head -1)
built=$(python3 -I scripts/image_ids.py "$methods" | sed -n 's/^CHECK_GUEST_ID //p')
echo "rebuilt checker image id:   $built"
echo "published checker image id: $PUBLISHED"
ok=1; [ "$built" = "$PUBLISHED" ] || ok=0
if [ $# -ge 2 ]; then
  onchain=$(curl -s --max-time 60 "$RPC" -H 'Content-Type: application/json' -d "$(python3 -I -c '
import base64, json, sys
print(json.dumps({"jsonrpc": "2.0", "id": "c", "method": "query", "params": {"request_type": "call_function", "finality": "final",
  "account_id": sys.argv[1], "method_name": "get_bounty", "args_base64": base64.b64encode(json.dumps({"bounty_id": sys.argv[2]}).encode()).decode()}}))' "$1" "$2")" \
    | python3 -I -c 'import json,sys; r=json.load(sys.stdin); b=json.loads(bytes(r["result"]["result"]).decode()) if "result" in r and "result" in r["result"] else None; print(b["image_id"] if b else "")')
  echo "image id of bounty $2 on $1: ${onchain:-not found}"
  [ "$built" = "$onchain" ] || ok=0
fi
if [ "$ok" = 1 ]; then echo "MATCH"; else echo "DIFFERENT"; exit 1; fi
