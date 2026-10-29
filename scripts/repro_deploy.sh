#!/usr/bin/env bash
# Redeploys the same contract source as a reproducible build, step by step, with the same safety steps as the
# per-account cap deploy (scripts/cap_deploy.sh). Phases, in order:
#   build      `cargo near build reproducible-wasm` in contract/ (Docker image pinned in contract/Cargo.toml, from the
#              committed source at HEAD); records the commit, the wasm's size and sha256
#   before     keeps the deployed code for a rollback (view_code), and saves get_bounty of every bounty, get_protocol_pool,
#              get_allowed_image_ids and get_owner
#   deploy     deploys the new wasm in place without an init call, signed by the contract account
#   after      saves the same views and compares them byte for byte: they must be identical; prints ROLL BACK otherwise;
#              reads the new code hash and contract_source_metadata
#   rollback   redeploys the previous wasm (target/repro-deploy/old.wasm)
# Usage, from the repo root: ./scripts/repro_deploy.sh <phase>. Testnet only. Output: docs/evidence/repro_deploy/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/repro_deploy; mkdir -p "$OUTDIR/steps" target/repro-deploy
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh
W=target/repro-deploy
sha() { sha256sum "$1" | cut -d' ' -f1; }
note() { echo "$(date -u +%FT%TZ) $*" | tee -a "$OUTDIR/deploy_summary.txt"; }
snapshot() { # snapshot <tag>: every view the deploy must not change
  local n; n=$(view get_next_bounty_id '{}' | tr -d '"')
  for ((b = 0; b < n; b++)); do view get_bounty "{\"bounty_id\":\"$b\"}" > "$OUTDIR/$1_bounty$b.json"; done
  view get_protocol_pool '{}' > "$OUTDIR/$1_pool.json"; view get_allowed_image_ids '{}' > "$OUTDIR/$1_allowlist.json"
  view get_owner '{}' > "$OUTDIR/$1_owner.json"; echo "$n" > "$OUTDIR/$1_count.txt"
}
code_hash() { curl -4 -s --max-time 60 "$RPC" -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":\"c\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$CONTRACT\"}}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["code_hash"])'; }
case "${1:-}" in
build)
  [ -z "$(git status --porcelain -- contract Cargo.toml Cargo.lock)" ] || { echo "commit contract/, Cargo.toml and Cargo.lock first"; exit 1; }
  ( cd contract && /usr/bin/time -f "wall_seconds=%e" cargo near build reproducible-wasm ) > "$OUTDIR/build.log" 2>&1
  tail -1 "$OUTDIR/build.log"
  cp target/near/kintsugi_contract/kintsugi_contract.wasm "$W/new.wasm"
  note "reproducible build of commit $(git rev-parse HEAD): command \`cd contract && cargo near build reproducible-wasm\`, $(stat -c %s "$W/new.wasm") bytes, wasm sha256 $(sha "$W/new.wasm")"
  ;;
before)
  curl -4 -s --max-time 120 "$RPC" -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":\"c\",\"method\":\"query\",\"params\":{\"request_type\":\"view_code\",\"finality\":\"final\",\"account_id\":\"$CONTRACT\"}}" \
    | python3 -c 'import base64,json,sys; open(sys.argv[1],"wb").write(base64.b64decode(json.load(sys.stdin)["result"]["code_base64"]))' "$W/old.wasm"
  note "deployed code before: wasm sha256 $(sha "$W/old.wasm"), code hash $(code_hash) (kept for a rollback)"
  snapshot before; note "views saved before the deploy: $(cat "$OUTDIR/before_count.txt") bounties, pool, allowlist, owner"
  ;;
deploy)
  [ -f "$W/new.wasm" ] && [ -f "$W/old.wasm" ] || { echo "run build and before first"; exit 1; }
  run_near repro_deploy deploy "$CONTRACT" contract deploy "$CONTRACT" use-file "$W/new.wasm" without-init-call \
    network-config testnet sign-with-legacy-keychain send
  note "deployed: wasm sha256 $(sha "$W/new.wasm"), tx $(sed -n "s/.*Transaction ID: \([1-9A-HJ-NP-Za-km-z]*\).*/\1/p" "$OUTDIR/steps/repro_deploy.txt" | head -1)"
  ;;
after)
  sleep 3; snapshot after; bad=0
  for f in "$OUTDIR"/before_*; do g="$OUTDIR/after_${f##*/before_}"; cmp -s "$f" "$g" && echo "${f##*/before_}: the same" || { echo "${f##*/before_}: DIFFERENT"; bad=1; }; done > "$OUTDIR/deploy_comparison.txt"
  echo "$(grep -c ': the same' "$OUTDIR/deploy_comparison.txt") views the same, $(grep -c DIFFERENT "$OUTDIR/deploy_comparison.txt") different" | tee -a "$OUTDIR/deploy_comparison.txt"
  grep -q DIFFERENT "$OUTDIR/deploy_comparison.txt" && { note "comparison FAILED: ROLL BACK"; exit 1; }
  view contract_source_metadata '{}' > "$OUTDIR/contract_source_metadata.json"
  note "comparison passed: every saved view byte for byte the same; code hash now $(code_hash); contract_source_metadata saved"
  ;;
rollback)
  run_near repro_rollback deploy "$CONTRACT" contract deploy "$CONTRACT" use-file "$W/old.wasm" without-init-call \
    network-config testnet sign-with-legacy-keychain send
  note "rolled back to wasm sha256 $(sha "$W/old.wasm")"
  ;;
*) sed -n '2,13p' "$0"; exit 1 ;;
esac
