#!/usr/bin/env bash
# Copies the guest files that the reproducible build wrote (hello_guest.bin, check_guest.bin, built inside RISC Zero's
# guest builder Docker image by harness/build.rs) into one folder, for a machine that cannot run Docker; there,
# `KINTSUGI_PREBUILT_GUESTS=<that folder> cargo build ...` embeds them as they are (harness/build.rs, prebuilt mode).
# Prints each file's SHA-256 and the image ids from this machine's build.
# Usage, from the repository root:  ./scripts/export_guests.sh [<out folder>]   (default target/prebuilt-guests)
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-target/prebuilt-guests}"
cargo build --release -p kintsugi-harness
mkdir -p "$out"
for g in hello_guest check_guest; do
  cp "target/riscv-guest/kintsugi-harness/$g/riscv32im-risc0-zkvm-elf/docker/$g.bin" "$out/$g.bin"
done
(cd "$out" && sha256sum hello_guest.bin check_guest.bin)
python3 -I scripts/image_ids.py "$(ls -t target/release/build/kintsugi-harness-*/out/methods.rs | head -1)"
