#!/usr/bin/env bash
# Builds the memory safety demo (data/memsafe) in every instrumentation variant, for the original and the fix, into
# target/memsafe/: <variant>-original.wasm and <variant>-fixed.wasm, then a wasm-opt -Oz copy of each (<name>.opt.wasm).
# No C library, no imports: each variant turns an out of bounds write into a WebAssembly trap (see rt.h).
# Needs clang with the wasm32 target (wasi-sdk 34) and wasm-opt (binaryen 133): set WASI_SDK and BINARYEN to their
# folders. Usage, from the repository root:  WASI_SDK=... BINARYEN=... data/memsafe/build.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
CC="$WASI_SDK/bin/clang"
OPT="$BINARYEN/bin/wasm-opt"
OUT=target/memsafe
mkdir -p "$OUT"
BASE=(--target=wasm32 -Oz -nostdlib -ffreestanding -mbulk-memory -Wl,--no-entry -Wl,--strip-all -Wl,--gc-sections
      -Wl,--initial-memory=131072 -Wl,--max-memory=131072 -Wl,-z,stack-size=8192)
declare -A V=(
  [plain-heap]=""
  [plain-stack]="-DSTACK_BUF"
  [guard-heap]="-DRT_GUARD"
  [ssp-stack]="-DSTACK_BUF -fstack-protector-all"
  [fortify-heap]="-DRT_FORTIFY"
  [fortify-stack]="-DRT_FORTIFY -DSTACK_BUF"
  [bounds-heap]="-fsanitize=bounds -fsanitize-trap=bounds"
  [bounds-stack]="-DSTACK_BUF -fsanitize=bounds -fsanitize-trap=bounds"
)
for v in $(printf '%s\n' "${!V[@]}" | sort); do
  for prog in original fixed; do
    # shellcheck disable=SC2086
    "$CC" "${BASE[@]}" ${V[$v]} -o "$OUT/$v-$prog.wasm" "data/memsafe/$prog.c"
    "$OPT" -Oz --enable-bulk-memory --enable-sign-ext --enable-mutable-globals "$OUT/$v-$prog.wasm" -o "$OUT/$v-$prog.opt.wasm"
  done
done
wc -c "$OUT"/*.wasm
