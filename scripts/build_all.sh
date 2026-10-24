#!/usr/bin/env bash
# Builds everything in one command: the proof harness and host (which also compiles the zkVM guests, reproducibly,
# inside RISC Zero's guest builder Docker image: needs Docker with buildx), then the NEAR contract for the chain with
# cargo-near. Run from anywhere: ./scripts/build_all.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/2 harness, guest and host (cargo build --release)"
cargo build --release

echo "== 2/2 contract wasm (cargo near build non-reproducible-wasm)"
(cd contract && cargo near build non-reproducible-wasm)

echo "== done"
stat -c '%s bytes  %n' target/release/kintsugi-host target/near/kintsugi_contract/kintsugi_contract.wasm
sha256sum target/near/kintsugi_contract/kintsugi_contract.wasm
