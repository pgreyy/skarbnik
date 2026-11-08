#!/usr/bin/env bash
# Builds the memory safety demo (data/memsafe) in every instrumentation variant, for the original and the fix, into
# target/memsafe/: <variant>-original.wasm and <variant>-fixed.wasm, then a wasm-opt -Oz copy of each (<name>.opt.wasm);
# then the published demo modules (data/memsafe/original.wasm and fixed.wasm, the plain heap builds) and the corpus
# modules in data/attacks/memsafe/.
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
# The published demo modules are the plain heap builds (the output checker needs no instrumentation), and the corpus.
cp "$OUT/plain-heap-original.wasm" data/memsafe/original.wasm
cp "$OUT/plain-heap-fixed.wasm" data/memsafe/fixed.wasm
A=data/attacks/memsafe
for prog in partial_fix_20 truncate_fix special_case_secret; do
  "$CC" "${BASE[@]}" -I data/memsafe -o "$A/$prog.wasm" "$A/$prog.c"
done
"$CC" "${BASE[@]}" -DSTACK_BUF -o "$A/stack_fix.wasm" data/memsafe/fixed.c
"$CC" "${BASE[@]}" -DRT_FORTIFY -o "$A/fortify_original.wasm" data/memsafe/original.c
wc -c "$OUT"/*.wasm data/memsafe/*.wasm "$A"/*.wasm
