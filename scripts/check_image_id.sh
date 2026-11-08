#!/usr/bin/env bash
# One command to check the checkers: rebuilds both checker guests reproducibly (inside RISC Zero's guest builder Docker
# image, see harness/build.rs), the crash checker (harness/check-guest) and the output checker for wrong answers and
# memory safety bugs (harness/output-guest), prints their image ids and compares each with its published id. If a
# contract and a bounty id are given, it also compares the bounty's image id on NEAR testnet (read over RPC) with the
# rebuilt id of the same checker.
# Prints MATCH and exits 0 when every comparison matches; prints DIFFERENT and exits 1 otherwise.
# Usage, from the repository root:  ./scripts/check_image_id.sh [<contract account> <bounty id>]
# Needs: Docker with the buildx plugin, the Rust toolchain, cargo-risczero 3.0.6, python3, curl (for the bounty check).
set -euo pipefail
cd "$(dirname "$0")/.."
PUBLISHED=dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
PUBLISHED_OUTPUT=005d8dc7e6fa2b936d960f6c81af51b5cb3699d319b5d4b71403dd64b051c089
RPC="${RPC:-https://test.rpc.fastnear.com}"
cargo build --release -p kintsugi-harness
methods=$(ls -t target/release/build/kintsugi-harness-*/out/methods.rs | head -1)
built=$(python3 -I scripts/image_ids.py "$methods" | sed -n 's/^CHECK_GUEST_ID //p')
built_output=$(python3 -I scripts/image_ids.py "$methods" | sed -n 's/^OUTPUT_GUEST_ID //p')
echo "rebuilt crash checker image id:    $built"
echo "published crash checker image id:  $PUBLISHED"
echo "rebuilt output checker image id:   $built_output"
echo "published output checker image id: $PUBLISHED_OUTPUT"
ok=1; [ "$built" = "$PUBLISHED" ] || ok=0; [ "$built_output" = "$PUBLISHED_OUTPUT" ] || ok=0
if [ $# -ge 2 ]; then
  onchain=$(curl -s --max-time 60 "$RPC" -H 'Content-Type: application/json' -d "$(python3 -I -c '
import base64, json, sys
print(json.dumps({"jsonrpc": "2.0", "id": "c", "method": "query", "params": {"request_type": "call_function", "finality": "final",
  "account_id": sys.argv[1], "method_name": "get_bounty", "args_base64": base64.b64encode(json.dumps({"bounty_id": sys.argv[2]}).encode()).decode()}}))' "$1" "$2")" \
    | python3 -I -c 'import json,sys; r=json.load(sys.stdin); b=json.loads(bytes(r["result"]["result"]).decode()) if "result" in r and "result" in r["result"] else None; print(b["image_id"] if b else "")')
  echo "image id of bounty $2 on $1: ${onchain:-not found}"
  [ "$built" = "$onchain" ] || [ "$built_output" = "$onchain" ] || ok=0
fi
if [ "$ok" = 1 ]; then echo "MATCH"; else echo "DIFFERENT"; exit 1; fi
