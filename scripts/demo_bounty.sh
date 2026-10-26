#!/usr/bin/env bash
# The official demo bounty: a bounty on the S13 contract whose image id is the checker's REPRODUCIBLE image id, so
# anyone can rebuild the checker (./scripts/check_image_id.sh) and get the same id the contract holds. Testnet only.
# Phases, in order:
#   create  read the Proof 0 receipt made with the reproducible build (target/demo/, see docs/EVIDENCE.md, demo bounty),
#           create the bounty with its image id and hashes (expires after 30 days, so judges can check it)
#   open    two verifiers check that Proof 0 against the chain (scripts/verifier_check.sh proof0) and attest it
#   check   ./scripts/check_image_id.sh <contract> <bounty>: rebuild and compare, expect MATCH
# Usage, from the repo root: ./scripts/demo_bounty.sh <phase>. State: docs/evidence/demo/run.env.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/demo; mkdir -p "$OUTDIR/steps"
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
S13_CONTRACT=$(sed -n 's/^S13_CONTRACT=//p' docs/evidence/S13/run.env)
export OUT="$OUTDIR" CONTRACT="$S13_CONTRACT"
source scripts/s3_lib.sh
# After s3_lib.sh, whose default vendor name (vendor.<contract>) this file replaces with the S3b vendor account.
source docs/evidence/S3b/accounts.env
SEC=1000000000
HOST=./target/release/skarbnik-host
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
note() { echo "$*" | tee -a "$OUTDIR/summary.txt"; }

case "${1:-}" in
create)
  V=$($HOST verify target/demo/proof0_succinct.bin); echo "$V" > "$OUTDIR/verify_proof0.txt"
  grep -q '^VALID' <<<"$V" || { echo "the demo Proof 0 receipt does not verify"; exit 1; }
  IMAGE=$(sed -n 's/^image id: //p' <<<"$V"); P0_JOURNAL=$(sed -n 's/^journal sha256: //p' <<<"$V")
  P0_RECEIPT=$(sha target/demo/proof0_succinct.bin)
  EXPLOIT=$(sed -n 's/^journal.exploit_commitment: //p' <<<"$V"); CORPUS=$(sed -n 's/^journal.corpus_hash: //p' <<<"$V")
  save IMAGE "$IMAGE"; save P0_JOURNAL "$P0_JOURNAL"; save P0_RECEIPT "$P0_RECEIPT"
  id=$(json_field "$(view get_next_bounty_id '{}')" "")
  call demo_create "$VENDOR" create_bounty "{\"original_hash\":\"$(sha data/demo/original.wasm)\",\"corpus_hash\":\"$CORPUS\",\"image_id\":\"$IMAGE\",\"exploit_commitment\":\"$EXPLOIT\",\"proof0_receipt_hash\":\"$P0_RECEIPT\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 4 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3 * 3600 * SEC ))\",\"expiry_ns\":\"$(( 30 * 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha data/demo/fixed.wasm)\",\"proof0_journal_hash\":\"$P0_JOURNAL\",\"reveal_window_ns\":\"$(( 3600 * SEC ))\"}" "0.5 NEAR"
  [ "$(view get_bounty "{\"bounty_id\":\"$id\"}")" != "null" ] || { echo "create_bounty failed"; exit 1; }
  save DEMO_BOUNTY "$id"; note "demo bounty $id on $CONTRACT, image id $IMAGE"
  ;;
open)
  for v in "$VER1" "$VER2"; do
    if scripts/verifier_check.sh proof0 "$CONTRACT" "$DEMO_BOUNTY" target/demo/proof0_succinct.bin > "$OUTDIR/steps/proof0_check_${v%%.*}.txt"; then
      call "demo_attest_proof0_${v%%.*}" "$v" attest_proof0 "{\"bounty_id\":\"$DEMO_BOUNTY\",\"journal_hash\":\"$P0_JOURNAL\",\"receipt_hash\":\"$P0_RECEIPT\"}"
    else note "verifier ${v%%.*} refused the demo Proof 0"; exit 1; fi
  done
  note "demo bounty $DEMO_BOUNTY opened: $(json_field "$(view get_bounty "{\"bounty_id\":\"$DEMO_BOUNTY\"}")" opened)"
  ;;
check)
  { echo "\$ ./scripts/check_image_id.sh $CONTRACT $DEMO_BOUNTY"; ./scripts/check_image_id.sh "$CONTRACT" "$DEMO_BOUNTY" 2>&1 | grep -vE '^\s+(Compiling|Finished)'; } \
    | sed -E 's#/home/[^/ "]+#~#g' | tee "$OUTDIR/check_image_id.txt"
  grep -q '^MATCH' "$OUTDIR/check_image_id.txt"
  ;;
*) echo "usage: $0 create|open|check"; exit 2 ;;
esac
