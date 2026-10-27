#!/usr/bin/env bash
# Testnet steps for the agent access pieces (AGENTS.md and tools/skarbnik-mcp). Testnet only.
# Output: docs/evidence/agent_access/. Phases:
#   bounty   a test bounty for both tests, created by the vendor account and opened with the demo's Groth16 Proof 0:
#            demo program, K = 4, at most 1 slot per account, 0.1 NEAR, fees 0.01 + 0.005 per attempt, reveal gap 60 s,
#            reveal window 2 h, verdict window 4 h, expiry 3 days
#   show     the bounty and every attempt on it, read from the chain
# Usage, from the repo root: ./scripts/agent_access_test.sh <phase>
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/agent_access; mkdir -p "$OUTDIR/steps"
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
SEC=1000000000
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
note() { echo "$(date -u +%FT%TZ) $*" | tee -a "$OUTDIR/summary.txt"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }

case "${1:-}" in
bounty)
  [ -n "${TBOUNTY:-}" ] && { echo "already made: bounty $TBOUNTY"; exit 0; }
  D=docs/evidence/receipts/demo_proof0_args.json; [ -f "$D" ] || { echo "missing $D"; exit 1; }
  P=$(python3 -c 'import base64,json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({k: base64.b64encode(bytes.fromhex(d[k])).decode() for k in ("seal","journal")})[1:-1])' "$D")
  B7=$(view get_bounty '{"bounty_id":"7"}'); T=$(view get_next_bounty_id '{}' | tr -d '"')
  f() { json_field "$B7" "$1"; }
  call access_create "$VENDOR" create_bounty "{\"original_hash\":\"$(f original_hash)\",\"corpus_hash\":\"$(f corpus_hash)\",\"image_id\":\"$(f image_id)\",\"exploit_commitment\":\"$(f exploit_commitment)\",\"proof0_receipt_hash\":\"$(f proof0_receipt_hash)\",\"max_commits\":4,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 60 * SEC ))\",\"verdict_window_ns\":\"$(( 4 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( 3 * 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(f reference_fix_hash)\",\"proof0_journal_hash\":\"$(f proof0_journal_hash)\",\"reveal_window_ns\":\"$(( 2 * 3600 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2,\"max_commits_per_account\":1}" "0.1 NEAR"
  call access_open "$VENDOR" open_with_groth16 "{\"bounty_id\":\"$T\",$P}" "0 NEAR" "300 Tgas"
  save TBOUNTY "$T"
  B=$(view get_bounty "{\"bounty_id\":\"$T\"}")
  note "test bounty $T: opened $(json_field "$B" opened), K $(json_field "$B" max_commits), cap per account $(json_field "$B" max_commits_per_account), next fee $(json_field "$B" next_fee)"
  ;;
show)
  B=$(view get_bounty "{\"bounty_id\":\"$TBOUNTY\"}")
  echo "bounty $TBOUNTY: state $(json_field "$B" state), commits $(json_field "$B" commits), active $(json_field "$B" active), pending $(json_field "$B" pending)"
  for ((i = 0; i < $(json_field "$B" commits); i++)); do
    S=$(view get_submission "{\"bounty_id\":\"$TBOUNTY\",\"index\":$i}")
    echo "  #$i committer $(json_field "$S" committer) outcome $(json_field "$S" outcome) revealed_at_ns $(json_field "$S" revealed_at_ns)"
  done
  ;;
*) sed -n '2,8p' "$0"; exit 1 ;;
esac
