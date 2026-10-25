#!/usr/bin/env bash
# Checks the pinned wallet scripts in a real (headless) browser: serves web/ locally, opens Connect wallet in a fresh
# browser profile for each case, and prints what loaded. Cases: NEAR CLI as served, Intear as served, and NEAR CLI with
# one byte changed in transit (must be refused). Needs Node 22+ and a Chromium; set CHROME to its path.
# Usage, from the repo root: CHROME=/path/to/chrome ./scripts/wallet-vendor/pin_check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
: "${CHROME:?set CHROME to a Chromium or headless shell binary}"
W=target/pin-check; rm -rf "$W"; mkdir -p "$W"
python3 -m http.server 8765 --directory web > "$W/http.log" 2>&1 & S=$!
sleep 1
run() {
  local P=$((9400 + RANDOM % 100))
  "$CHROME" --no-sandbox --headless --remote-debugging-port=$P --user-data-dir="$PWD/$W/profile-$1" --window-size=1280,900 about:blank > "$W/browser-$1.log" 2>&1 & local B=$!
  echo "== case: $1"
  node scripts/wallet-vendor/pin_check.mjs $P http://127.0.0.1:8765/ "$2" "${3:-}" 2>&1 | grep -v -E '^(frame text|buttons|targets):'
  kill $B; wait $B 2>/dev/null
}
run nearcli "NEAR CLI"
run intear "Intear Wallet"
run tampered "NEAR CLI" tamper
kill $S
