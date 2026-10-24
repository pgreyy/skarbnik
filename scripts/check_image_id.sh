#!/usr/bin/env bash
# Rebuilds the patch checker guest reproducibly (inside RISC Zero's guest builder Docker image, see harness/build.rs),
# prints its image id, and, if a contract and bounty id are given, compares it with the image id that bounty has on
# NEAR testnet. Exit 0 = the ids match (or no bounty given), 1 = they differ.
# Usage, from the repository root:  ./scripts/check_image_id.sh [<contract account> <bounty id>]
# Needs: Docker with the buildx plugin, the Rust toolchain, cargo-risczero 3.0.6, near-cli-rs for the comparison.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release -p kintsugi-harness
methods=$(ls -t target/release/build/kintsugi-harness-*/out/methods.rs | head -1)
built=$(python3 -I scripts/image_ids.py "$methods" | sed -n 's/^CHECK_GUEST_ID //p')
echo "rebuilt checker image id: $built"
[ $# -ge 2 ] || exit 0
onchain=$(near contract call-function as-read-only "$1" get_bounty json-args "{\"bounty_id\":\"$2\"}" network-config testnet now 2>&1 \
  | sed -n 's/.*"image_id": "\([0-9a-f]\{64\}\)".*/\1/p' | head -1)
echo "image id of bounty $2 on $1: ${onchain:-not found}"
if [ "$built" = "$onchain" ]; then echo "MATCH"; else echo "DIFFERENT"; exit 1; fi
