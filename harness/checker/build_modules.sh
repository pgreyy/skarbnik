#!/usr/bin/env bash
# Builds the spike S1 WebAssembly modules from their Rust sources with plain rustc (no cargo, no
# downloads): the demo original and honest fix in data/demo/, and the cheating patches in
# data/attacks/. Also writes the one deliberately broken module (the original cut short) and
# prints the size and sha256 of every module. Run from the repository root:
#   bash harness/checker/build_modules.sh
set -euo pipefail

FLAGS=(--edition 2021 --target wasm32-unknown-unknown --crate-type cdylib
  -C opt-level=z -C panic=abort -C strip=symbols -C codegen-units=1 -C target-cpu=mvp
  -C link-arg=-zstack-size=8192)
# Two pages (128 KiB) of memory, the checker's limit.
MEM2=(-C link-arg=--initial-memory=131072 -C link-arg=--max-memory=131072)
# Sixteen pages (1 MiB), only for the memory_declared cheat.
MEM16=(-C link-arg=--initial-memory=1048576 -C link-arg=--max-memory=1048576)
# Two pages to start with and no declared maximum, only for the memory_grow_nomax cheat.
MEM2_NOMAX=(-C link-arg=--initial-memory=131072)

build() { # build <source.rs> <memory flags...>
  local src=$1; shift
  rustc "${FLAGS[@]}" "$@" -o "${src%.rs}.wasm" "$src"
}

for src in data/demo/*.rs data/attacks/*.rs; do
  case "$src" in
    data/attacks/memory_declared.rs) build "$src" "${MEM16[@]}" ;;
    data/attacks/memory_grow_nomax.rs) build "$src" "${MEM2_NOMAX[@]}" ;;
    *) build "$src" "${MEM2[@]}" ;;
  esac
done

# Cheat "invalid module": the first 100 bytes of the original, which no longer parse.
head -c 100 data/demo/original.wasm > data/attacks/invalid_truncated.wasm

for f in data/demo/*.wasm data/attacks/*.wasm; do
  printf '%6d bytes  %s  %s\n' "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -c1-64)" "$f"
done
