#!/usr/bin/env bash
# Judge bounties: Level 2 bounties a judge can open from their own account with a real proof checked on chain.
# Each one has the same hashes as private bounty 17 (program data/unpack/, secret commitment, public tests, reference fix,
# Proof 0 journal), the smallest reward (0.1 NEAR), a 24 hour verdict window and an expiry after 30 November 2026. They
# are created closed. `open_with_groth16` with bounty 17's stored Groth16 Proof 0 (docs/evidence/receipts/) opens one:
# the contract checks the proof itself. Each bounty can be opened once; after that the same call is refused.
# Phases:
#   create     the vendor creates the five bounties (ids saved in docs/evidence/judge/run.env)
#   argfiles   writes docs/evidence/receipts/judge_open_<id>.json (the exact open_with_groth16 arguments) and
#              judge_refuse_<id>.json (the refusal case below) for each one
#   opentest   a new throwaway account (not the vendor) opens the first judge bounty
#   refusal    a proof the contract must refuse at the proof check itself: bounty 17's Proof 0 journal (so every cheap
#              check passes) with the seal of another real Groth16 proof (the demo's Proof 0), sent to a closed one
#   status     which judge bounties are still closed
# Usage, from the repo root: ./scripts/judge_bounties.sh <phase>. Testnet only. Output: docs/evidence/judge/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/judge; mkdir -p "$OUTDIR/steps"
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
SEC=1000000000; P0=docs/evidence/receipts/bounty17_proof0_args.json; DEMO_P0=docs/evidence/receipts/demo_proof0_args.json
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
note() { echo "$(date -u +%FT%TZ) $*" | tee -a "$OUTDIR/summary.txt"; }
field() { python3 -c 'import json,sys; print(json.loads(sys.argv[1])[sys.argv[2]])' "$1" "$2"; }
# seal and journal (base64) from a groth16-args file; with a second file, the seal comes from that one instead
args() { python3 -I -c 'import base64,json,sys
d=json.load(open(sys.argv[1])); s=json.load(open(sys.argv[2])) if len(sys.argv) > 2 else d
print(json.dumps({"seal":base64.b64encode(bytes.fromhex(s["seal"])).decode(),"journal":base64.b64encode(bytes.fromhex(d["journal"])).decode()})[1:-1])' "$@"; }
gas() { curl -4 -s --max-time 60 "$RPC" -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":\"g\",\"method\":\"tx\",\"params\":{\"tx_hash\":\"$1\",\"sender_account_id\":\"$2\",\"wait_until\":\"FINAL\"}}" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; t=r["transaction_outcome"]["outcome"]["gas_burnt"]+sum(o["outcome"]["gas_burnt"] for o in r["receipts_outcome"]); print(f"{t/1e12:.3f} Tgas")'; }
[ -f "$P0" ] || { echo "missing $P0 (bounty 17's Groth16 Proof 0 arguments)"; exit 1; }

case "${1:-}" in
create)
  [ -n "${JUDGE_IDS:-}" ] && { echo "already made: $JUDGE_IDS"; exit 0; }
  B=$(view get_bounty '{"bounty_id":"17"}'); ids=""
  # Expiry: 40 days from now (after 30 November 2026 when created on 26 October), within the 366 day cap.
  for i in 1 2 3 4 5; do
    T=$(view get_next_bounty_id '{}' | tr -d '"')
    call "judge_create_$i" "$VENDOR" create_bounty "{\"original_hash\":\"$(field "$B" original_hash)\",\"corpus_hash\":\"$(field "$B" corpus_hash)\",\"image_id\":\"$(field "$B" image_id)\",\"exploit_commitment\":\"$(field "$B" exploit_commitment)\",\"proof0_receipt_hash\":\"$(field "$B" proof0_receipt_hash)\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 60 * SEC ))\",\"verdict_window_ns\":\"$(( 24 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( 40 * 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(field "$B" reference_fix_hash)\",\"proof0_journal_hash\":\"$(field "$B" proof0_journal_hash)\",\"reveal_window_ns\":\"$(( 3600 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2}" "0.1 NEAR"
    ids="$ids $T"; sleep 2
  done
  save JUDGE_IDS "\"${ids# }\""
  note "judge bounties created:$ids"
  ;;
argfiles)
  for T in $JUDGE_IDS; do echo "{\"bounty_id\":\"$T\",$(args "$P0")}" > "docs/evidence/receipts/judge_open_$T.json"
    echo "{\"bounty_id\":\"$T\",$(args "$P0" "$DEMO_P0")}" > "docs/evidence/receipts/judge_refuse_$T.json"; done
  note "argument files written for:$JUDGE_IDS"
  ;;
opentest)
  T=${JUDGE_IDS%% *}
  if [ -z "${JUDGE_TESTER:-}" ]; then
    JUDGE_TESTER="skarbnik-judge-$(python3 -c 'import secrets;print(secrets.token_hex(3))').testnet"
    run_near judge_tester_account create-account "$JUDGE_TESTER" account create-account sponsor-by-faucet-service "$JUDGE_TESTER" \
      autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
    save JUDGE_TESTER "$JUDGE_TESTER"; sleep 3
  fi
  view get_bounty "{\"bounty_id\":\"$T\"}" > "$OUTDIR/judge_${T}_before.json"
  call "judge_open_$T" "$JUDGE_TESTER" open_with_groth16 "{\"bounty_id\":\"$T\",$(args "$P0")}" "0 NEAR" "300 Tgas"
  sleep 3; view get_bounty "{\"bounty_id\":\"$T\"}" > "$OUTDIR/judge_${T}_after.json"
  H=$(awk -F'\t' -v s="judge_open_$T" '$1==s {print $4}' "$OUTDIR/transactions.tsv" | tail -1)
  note "bounty $T opened by $JUDGE_TESTER (not the vendor): opened $(field "$(cat "$OUTDIR/judge_${T}_after.json")" opened), tx $H, gas $(gas "$H" "$JUDGE_TESTER")"
  call_expect_fail "judge_open_again_$T" "$JUDGE_TESTER" open_with_groth16 "{\"bounty_id\":\"$T\",$(args "$P0")}"
  ;;
refusal)
  T=$(echo "$JUDGE_IDS" | awk '{print $NF}')
  call_expect_fail "judge_refusal_other_seal_$T" "$JUDGE_TESTER" open_with_groth16 "{\"bounty_id\":\"$T\",$(args "$P0" "$DEMO_P0")}"
  H=$(awk -F'\t' -v s="judge_refusal_other_seal_$T" '$1==s {print $4}' "$OUTDIR/transactions.tsv" | tail -1)
  note "refusal on bounty $T: tx $H, gas $(gas "$H" "$JUDGE_TESTER"), opened stays $(field "$(view get_bounty "{\"bounty_id\":\"$T\"}")" opened)"
  ;;
status)
  for T in $JUDGE_IDS; do echo "bounty $T: opened $(field "$(view get_bounty "{\"bounty_id\":\"$T\"}")" opened)"; done
  ;;
*) echo "usage: $0 create|argfiles|opentest|refusal|status"; exit 2 ;;
esac
