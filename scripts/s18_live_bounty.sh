#!/usr/bin/env bash
# Audit hardening S18: one live Level 2 bounty whose secret crashing input is NOT in the repository and whose commitment
# uses a private random salt. The vendor's secret lives in ~/.kintsugi-vendor/s18/ (folder mode 700, files mode 600) and
# is never printed; the salt is made by `skarbnik-host --bounty s18` in ~/.kintsugi-salts/. Phases, in order:
#   prove   Proof 0 of the reference fix (data/demo/fixed.wasm) against the private secret on this laptop's CPU, then
#           compress it to a succinct receipt, then runs the groth16 phase; one job at a time
#   groth16 compress the succinct receipt to a Groth16 proof (Docker), memory watched, and write the contract arguments
#   create  the vendor creates the Level 2 bounty on kintsugi-l2-cihdp.testnet with the journal's values, opens it with
#           the Groth16 Proof 0, and scripts/check_image_id.sh must print MATCH
# Usage, from the repo root: ./scripts/s18_live_bounty.sh <phase>. Testnet only. Output: docs/evidence/S18/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/S18; mkdir -p "$OUTDIR/steps" target/s18
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
SEC=1000000000
HOST=./target/release/skarbnik-host
VDIR="$HOME/.kintsugi-vendor/s18"
SECRET="$VDIR/exploit.hex"
[ -f "$SECRET" ] && [ "$(stat -c %a "$SECRET")" = 600 ] && [ "$(stat -c %a "$VDIR")" = 700 ] \
  || { echo "the private secret is missing or readable by others"; exit 1; }
source "$VDIR/proof0_seed.env"   # SEED: the Proof 0 fairness seed (public once Proof 0 is published)
sha() { sha256sum "$1" | cut -d' ' -f1; }
note() { echo "$*" | tee -a "$OUTDIR/summary.txt"; }
# Copy a log into the evidence folder with the home folder shortened to ~ and no secret bytes.
keep() { sed -E 's#/home/[^/ "]+#~#g' "$1" | grep -v -i -F "$(tr -d ' \n' < "$SECRET")" > "$OUTDIR/$(basename "$1")" || true; }

case "${1:-}" in
prove)
  free -h | tee "$OUTDIR/free_before.txt"
  MAX_SECONDS=10800 scripts/s2_measure.sh target/s18/prove_proof0.log -- $HOST prove data/demo/fixed.wasm --proof0 \
    --exploit "$SECRET" --bounty s18 --fuzz-count 16 --variants 32 --po2 19 --seed "$SEED" --out target/s18/proof0.bin
  keep target/s18/prove_proof0.log
  MAX_SECONDS=3600 scripts/s2_measure.sh target/s18/compress_proof0.log -- $HOST compress target/s18/proof0.bin \
    target/s18/proof0_succinct.bin succinct
  keep target/s18/compress_proof0.log
  "$0" groth16
  ;;
groth16)
  # Separate phase so it can be rerun alone: the first two tries were stopped by the memory guard (available memory
  # 576 and 566 MiB; the guard was 700 MiB then, the third try ran with 300). GUARD_MIB sets the guard; the default is
  # 500 MiB (owner's setting). scripts/watch_mem.sh prints a reminder to close editor windows first.
  rm -f target/s18/mem_groth16.log*; (KILL_BELOW_MIB="${GUARD_MIB:-500}" scripts/watch_mem.sh target/s18/mem_groth16.log & echo $! > target/s18/watch.pid)
  MIN_AVAIL_MIB="${GUARD_MIB:-500}" MAX_SECONDS=1800 scripts/s2_measure.sh target/s18/groth16_proof0.log -- $HOST compress \
    target/s18/proof0_succinct.bin target/s18/proof0_groth16.bin groth16 || true
  kill "$(cat target/s18/watch.pid)" 2>/dev/null || true
  keep target/s18/groth16_proof0.log; cp target/s18/mem_groth16.log.peaks "$OUTDIR/" 2>/dev/null || true
  $HOST verify target/s18/proof0_groth16.bin > target/s18/verify_proof0.txt; keep target/s18/verify_proof0.txt
  grep -q '^VALID' target/s18/verify_proof0.txt || { echo "Proof 0 does not verify"; exit 1; }
  grep -q '^journal.verdict: PASS' target/s18/verify_proof0.txt || { echo "Proof 0 verdict is not PASS"; exit 1; }
  $HOST groth16-args target/s18/proof0_groth16.bin target/s18/proof0_args.json
  note "S18 Proof 0: $(grep -E '^wall_seconds|^r0vm_peak' target/s18/prove_proof0.log | tr '\n' ' ')"
  note "S18 succinct: $(grep -E '^wall_seconds|^r0vm_peak' target/s18/compress_proof0.log | tr '\n' ' ')"
  note "S18 Groth16: $(grep -E '^wall_seconds' target/s18/groth16_proof0.log | tr '\n' ' ') container peak $(cat target/s18/mem_groth16.log.peaks 2>/dev/null)"
  ;;
create)
  V=target/s18/verify_proof0.txt
  field() { sed -n "s/^journal.$1: //p" "$V"; }
  P0_JOURNAL=$(sed -n 's/^journal sha256: //p' "$V"); P0_RECEIPT=$(sha target/s18/proof0_succinct.bin)
  [ "$(field original_hash)" = "$(sha data/demo/original.wasm)" ] && [ "$(field candidate_hash)" = "$(sha data/demo/fixed.wasm)" ] \
    || { echo "journal does not match the original and the reference fix"; exit 1; }
  ID=$(view get_next_bounty_id '{}' | tr -d '"')
  # K = 3, reveal window 1 h, verdict window 4 h, attestation window 1 h, expiry 30 days, as the demo bounty 7
  call s18_create "$VENDOR" create_bounty "{\"original_hash\":\"$(field original_hash)\",\"corpus_hash\":\"$(field corpus_hash)\",\"image_id\":\"$(sed -n 's/^image id: //p' "$V")\",\"exploit_commitment\":\"$(field exploit_commitment)\",\"proof0_receipt_hash\":\"$P0_RECEIPT\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 4 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( 30 * 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha data/demo/fixed.wasm)\",\"proof0_journal_hash\":\"$P0_JOURNAL\",\"reveal_window_ns\":\"$(( 3600 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2}" "0.5 NEAR"
  ARGS=$(python3 -I -c 'import base64,json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"seal":base64.b64encode(bytes.fromhex(d["seal"])).decode(),"journal":base64.b64encode(bytes.fromhex(d["journal"])).decode()})[1:-1])' target/s18/proof0_args.json)
  call s18_open_groth16 "$RES2" open_with_groth16 "{\"bounty_id\":\"$ID\",$ARGS}" "0 NEAR" "300 Tgas"
  view get_bounty "{\"bounty_id\":\"$ID\"}" > "$OUTDIR/bounty.json"
  note "S18 bounty $ID: $(python3 -c 'import json,sys,datetime; d=json.load(open(sys.argv[1])); print("level", d["level"], "opened", d["opened"], "image_id_allowed", d["image_id_allowed"], "exploit_commitment", d["exploit_commitment"][:16] + "...", "expires", datetime.datetime.fromtimestamp(int(d["expires_at_ns"])/1e9, datetime.UTC).strftime("%Y-%m-%d %H:%M UTC"))' "$OUTDIR/bounty.json")"
  { echo "\$ ./scripts/check_image_id.sh $CONTRACT $ID"; ./scripts/check_image_id.sh "$CONTRACT" "$ID" 2>&1 | grep -vE '^\s+(Compiling|Finished)'; } | sed -E 's#/home/[^/ "]+#~#g' | tee "$OUTDIR/check_image_id.txt"
  grep -q '^MATCH' "$OUTDIR/check_image_id.txt"
  ;;
*) echo "usage: $0 prove|groth16|create"; exit 2 ;;
esac
