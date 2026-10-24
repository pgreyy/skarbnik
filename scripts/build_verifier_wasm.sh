#!/usr/bin/env bash
# Builds the OutLayer verifier program (verifier/outlayer, package farbox-verifier) for wasm32-wasip1, with
# local paths remapped and symbol names stripped, then scans the file for anything that should not be
# published. Prints the size, SHA-256 and scan result. Run from the repo root: ./scripts/build_verifier_wasm.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
REG="$(cd "$HOME/.cargo/registry/src" && pwd)"
export CARGO_TARGET_DIR="target/verifier-wasm"
export RUSTFLAGS="--remap-path-prefix=$REG=/cargo/registry --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$HOME/.rustup=/rustup --remap-path-prefix=$REPO=/src -C strip=symbols"
cargo build --release -p farbox-verifier --target wasm32-wasip1
WASM="$CARGO_TARGET_DIR/wasm32-wasip1/release/farbox-verifier.wasm"
OUT="target/verifier-publish"
mkdir -p "$OUT"
cp "$WASM" "$OUT/farbox-verifier.wasm"
( cd "$OUT" && sha256sum farbox-verifier.wasm > farbox-verifier.wasm.sha256 )
echo "file: $OUT/farbox-verifier.wasm ($(stat -c %s "$OUT/farbox-verifier.wasm") bytes)"
cat "$OUT/farbox-verifier.wasm.sha256"
echo "== scan (strings, case-insensitive): any line below is a finding"
# Extra words to look for (other names that must not appear) can be listed one per line in a private
# file outside the repository's tracked files: notes/tools/scan_extra_patterns.txt
PATTERN="/home/|\b$(id -un)\b|pgreyy|kintsugi|djloo|secret_key|private_key|ed25519:[1-9A-HJ-NP-Za-km-z]{40,}|BEGIN [A-Z ]*PRIVATE|@gmail|@users\.noreply|\.near-credentials"
if [ -s notes/tools/scan_extra_patterns.txt ]; then
  PATTERN="$PATTERN|$(grep -v '^\s*$' notes/tools/scan_extra_patterns.txt | paste -sd'|')"
fi
strings -n 4 "$OUT/farbox-verifier.wasm" | grep -i -n -E "$PATTERN" || echo "(no findings)"
echo "== other paths still in the file (for review)"
strings -n 4 "$OUT/farbox-verifier.wasm" | grep -o -E '/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)+' | cut -d/ -f1-3 | sort | uniq -c | sort -rn | head -12
