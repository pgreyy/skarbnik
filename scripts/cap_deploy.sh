#!/usr/bin/env bash
# The per-account cap deploy, step by step as docs/evidence/account_cap/PLAN.md says (the owner's yes, with conditions:
# bounty 24 settled, bounty 15 closed, no proof in flight on 14 and 18 to 24). Phases, in order:
#   claim B I   claim_timeout on bounty B attempt I (after its deadline; anyone may send it; it pays by the timeout rule)
#   build       builds the contract wasm (cargo near build non-reproducible-wasm) and records its sha256
#   before      saves get_bounty of 7, 12, 14, 15 and 18 to 24, get_protocol_pool and get_allowed_image_ids
#   deploy      deploys the new wasm in place without an init call, signed by the contract account
#   after       saves the same views and compares them byte for byte, after dropping the one new field
#               (max_commits_per_account) from get_bounty; prints ROLL BACK if anything else differs
#   rollback    redeploys the previous wasm (the hardening build, kept in target/cap-deploy/old.wasm)
#   captest     a throwaway Level 2 bounty with max_commits_per_account 1, opened with the demo's Groth16 Proof 0: one
#               account's first commit accepted, its second refused with the cap message, another account's accepted
# Usage, from the repo root: ./scripts/cap_deploy.sh <phase>. Testnet only. Output: docs/evidence/account_cap/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/account_cap; mkdir -p "$OUTDIR/steps" target/cap-deploy
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
W=target/cap-deploy; SEC=1000000000
IDS="7 12 14 15 18 19 20 21 22 23 24"
sha() { sha256sum "$1" | cut -d' ' -f1; }
note() { echo "$(date -u +%FT%TZ) $*" | tee -a "$OUTDIR/deploy_summary.txt"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
snapshot() { # snapshot <tag>: the views the deploy must not change
  for b in $IDS; do view get_bounty "{\"bounty_id\":\"$b\"}" > "$OUTDIR/$1_bounty$b.json"; done
  view get_protocol_pool '{}' > "$OUTDIR/$1_pool.json"; view get_allowed_image_ids '{}' > "$OUTDIR/$1_allowlist.json"
}
case "${1:-}" in
claim)
  B="${2:?bounty}"; I="${3:?index}"
  call "cap_claim_timeout_b${B}_$I" "$VER3" claim_timeout "{\"bounty_id\":\"$B\",\"index\":$I}"
  sleep 3; note "claim_timeout on bounty $B attempt $I: bounty state $(json_field "$(view get_bounty "{\"bounty_id\":\"$B\"}")" state)"
  ;;
build)
  (cd contract && cargo near build non-reproducible-wasm 2>&1 | tail -3)
  cp target/near/kintsugi_contract/kintsugi_contract.wasm "$W/new.wasm"
  note "built $(stat -c %s "$W/new.wasm") bytes, wasm sha256 $(sha "$W/new.wasm")"
  ;;
before)
  # the deployed code, kept for a rollback: view_code returns it base64
  curl -4 -s --max-time 120 "$RPC" -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":\"c\",\"method\":\"query\",\"params\":{\"request_type\":\"view_code\",\"finality\":\"final\",\"account_id\":\"$CONTRACT\"}}" \
    | python3 -c 'import base64,json,sys; open(sys.argv[1],"wb").write(base64.b64decode(json.load(sys.stdin)["result"]["code_base64"]))' "$W/old.wasm"
  note "deployed code before: wasm sha256 $(sha "$W/old.wasm") (kept for a rollback)"
  snapshot before; note "views saved before the deploy: bounties $IDS, pool, allowlist"
  ;;
deploy)
  [ -f "$W/new.wasm" ] && [ -f "$W/old.wasm" ] || { echo "run build and before first"; exit 1; }
  run_near cap_deploy deploy "$CONTRACT" contract deploy "$CONTRACT" use-file "$W/new.wasm" without-init-call \
    network-config testnet sign-with-legacy-keychain send
  note "deployed: wasm sha256 $(sha "$W/new.wasm"), tx $(sed -n "s/.*Transaction ID: \([1-9A-HJ-NP-Za-km-z]*\).*/\1/p" "$OUTDIR/steps/cap_deploy.txt" | head -1)"
  ;;
after)
  sleep 3; snapshot after; bad=0
  for b in $IDS; do
    python3 -c 'import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2])); b.pop("max_commits_per_account", None)
sys.exit(0 if json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True) else 1)' "$OUTDIR/before_bounty$b.json" "$OUTDIR/after_bounty$b.json" \
      && echo "bounty $b: the same (apart from max_commits_per_account: $(json_field "$(cat "$OUTDIR/after_bounty$b.json")" max_commits_per_account))" || { echo "bounty $b: DIFFERENT"; bad=1; }
  done | tee "$OUTDIR/deploy_comparison.txt"
  grep -q DIFFERENT "$OUTDIR/deploy_comparison.txt" && bad=1
  for v in pool allowlist; do cmp -s "$OUTDIR/before_$v.json" "$OUTDIR/after_$v.json" && echo "$v: the same, byte for byte" || { echo "$v: DIFFERENT"; bad=1; }; done | tee -a "$OUTDIR/deploy_comparison.txt"
  grep -q DIFFERENT "$OUTDIR/deploy_comparison.txt" && { note "comparison FAILED: ROLL BACK"; exit 1; }
  note "comparison passed: every saved view unchanged except the new max_commits_per_account field (null on every old bounty)"
  ;;
rollback)
  run_near cap_rollback deploy "$CONTRACT" contract deploy "$CONTRACT" use-file "$W/old.wasm" without-init-call \
    network-config testnet sign-with-legacy-keychain send
  note "rolled back to wasm sha256 $(sha "$W/old.wasm")"
  ;;
captest)
  D=docs/evidence/receipts/demo_proof0_args.json; [ -f "$D" ] || { echo "missing $D"; exit 1; }
  P=$(python3 -c 'import base64,json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({k: base64.b64encode(bytes.fromhex(d[k])).decode() for k in ("seal","journal")})[1:-1])' "$D")
  B7=$(view get_bounty '{"bounty_id":"7"}'); T=$(view get_next_bounty_id '{}' | tr -d '"')
  f() { json_field "$B7" "$1"; }
  call cap_test_create "$VENDOR" create_bounty "{\"original_hash\":\"$(f original_hash)\",\"corpus_hash\":\"$(f corpus_hash)\",\"image_id\":\"$(f image_id)\",\"exploit_commitment\":\"$(f exploit_commitment)\",\"proof0_receipt_hash\":\"$(f proof0_receipt_hash)\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 60 * SEC ))\",\"verdict_window_ns\":\"$(( 4 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( 2 * 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(f reference_fix_hash)\",\"proof0_journal_hash\":\"$(f proof0_journal_hash)\",\"reveal_window_ns\":\"$(( 3600 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2,\"max_commits_per_account\":1}" "0.1 NEAR"
  call cap_test_open "$VENDOR" open_with_groth16 "{\"bounty_id\":\"$T\",$P}" "0 NEAR" "300 Tgas"
  note "cap test bounty $T: max_commits_per_account $(json_field "$(view get_bounty "{\"bounty_id\":\"$T\"}")" max_commits_per_account), opened $(json_field "$(view get_bounty "{\"bounty_id\":\"$T\"}")" opened)"
  fp() { python3 -c 'import secrets;print(secrets.token_hex(32))'; }
  for who in RES1 RES2; do call "cap_test_credit_$who" "${!who}" deposit_credit '{"account_id":null}' "0.03 NEAR" "30 Tgas"; done
  for who in RES1 RES1 RES2; do
    acct="${!who}"
    call "cap_test_commit_${who}_$(date +%s)" "$acct" commit "{\"bounty_id\":\"$T\",\"fingerprint\":\"$(fp)\",\"payout\":\"$acct\"}" || true
    sleep 2
  done
  note "cap test bounty $T after three commits (RES1, RES1 again, RES2): commits $(json_field "$(view get_bounty "{\"bounty_id\":\"$T\"}")" commits); RES1 holds $(view get_account_slots "{\"bounty_id\":\"$T\",\"account_id\":\"$RES1\"}") slot(s), RES2 holds $(view get_account_slots "{\"bounty_id\":\"$T\",\"account_id\":\"$RES2\"}")"
  grep -h -E "Smart contract panicked|already holds" "$OUTDIR"/steps/cap_test_commit_RES1_* | sed 's/^/  /' | tee -a "$OUTDIR/deploy_summary.txt"
  ;;
*) sed -n '2,15p' "$0"; exit 1 ;;
esac
