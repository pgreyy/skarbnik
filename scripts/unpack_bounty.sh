#!/usr/bin/env bash
# A private bounty on a new original module (data/unpack/, a packed byte decoder): its secret crashing input and the
# vendor's reference fix are NOT in the repository; they live in ~/.kintsugi-salts/unpack/ (folder mode 700, files
# mode 600) and are never printed. The commitment uses a private random salt (`kintsugi-host --bounty unpack`).
# Phases, in order (one proving job at a time; Groth16 memory watched):
#   check     native checks: the secret crashes the original, the original passes its public tests, the reference
#             fix passes the full check (secret, public tests, fairness inputs, variants) for several seeds
#   proof0    Proof 0 of the reference fix against the secret, compressed to succinct and to Groth16
#   create    the vendor creates the Level 2 bounty (K = 3) and opens it with the Groth16 Proof 0
#   prove N   the vendor proves revealed attempt N against the secret (Groth16), memory watched
#   submit N  sends that proof (submit_groth16) and reads the outcome
#   timeout N after the attempt's verdict deadline: claim_timeout by the agent's account (silent vendor rule)
# Usage, from the repo root: ./scripts/unpack_bounty.sh <phase>. Testnet only. Output: docs/evidence/agent/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/agent; mkdir -p "$OUTDIR/steps" target/unpack
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
SEC=1000000000; HOST=./target/release/kintsugi-host; W=target/unpack
VDIR="$HOME/.kintsugi-salts/unpack"; SECRET="$VDIR/exploit.hex"; FIX="$VDIR/fixed.wasm"
ORIG=data/unpack/original.wasm; TESTS=data/unpack/public_tests.txt
[ -f "$SECRET" ] && [ "$(stat -c %a "$SECRET")" = 600 ] && [ "$(stat -c %a "$VDIR")" = 700 ] \
  || { echo "the private secret is missing or readable by others"; exit 1; }
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
note() { echo "$*" | tee -a "$OUTDIR/summary.txt"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
# Copy a log into the evidence folder with the home folder shortened to ~ and no secret bytes.
keep() { sed -E 's#/home/[^/ "]+#~#g' "$1" | grep -v -i -F "$(tr -d ' \n' < "$SECRET")" > "$OUTDIR/$(basename "$1")" || true; }
proof_args() { python3 -I -c 'import base64,json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"seal":base64.b64encode(bytes.fromhex(d["seal"])).decode(),"journal":base64.b64encode(bytes.fromhex(d["journal"])).decode()})[1:-1])' "$1"; }
# PO2: segment size as a power of two (default 19, as measured before; 18 needs less memory per segment)
P=(--bounty unpack --exploit "$SECRET" --original "$ORIG" --tests "$TESTS" --fuzz-count 16 --variants 32 --po2 "${PO2:-19}")
# Stop when a measured step did not finish (scripts/s2_measure.sh writes "result: stopped ..." when a guard stops it).
finished() { grep -q '^result: finished' "$1" && ! grep -q '^exit=[1-9]' "$1" || { echo "stopped: $(grep '^result' "$1")"; exit 1; }; }
groth16() { # groth16 <name>: succinct receipt -> Groth16 receipt -> contract arguments, memory watched
  rm -f "$W/mem_$1.log"*; (KILL_BELOW_MIB="${GUARD_MIB:-500}" scripts/watch_mem.sh "$W/mem_groth16_$1.log" & echo $! > "$W/watch.pid")
  MIN_AVAIL_MIB="${GUARD_MIB:-500}" MAX_SECONDS=1800 scripts/s2_measure.sh "$W/groth16_$1.log" -- $HOST compress \
    "$W/$1_succinct.bin" "$W/$1_groth16.bin" groth16 || true
  kill "$(cat "$W/watch.pid")" 2>/dev/null || true
  keep "$W/groth16_$1.log"; cp "$W/mem_groth16_$1.log.peaks" "$OUTDIR/" 2>/dev/null || true
  $HOST verify "$W/$1_groth16.bin" > "$W/verify_$1.txt"; keep "$W/verify_$1.txt"
  grep -q '^VALID' "$W/verify_$1.txt" || { echo "the $1 Groth16 receipt does not verify"; exit 1; }
  $HOST groth16-args "$W/$1_groth16.bin" "$W/$1_args.json"
}

case "${1:-}" in
check)
  { for i in 1 2 3 4 5 6; do S=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
      echo "seed $S"; ./target/debug/kintsugi-check proof0 --original "$ORIG" --tests "$TESTS" --exploit "$SECRET" \
        --reference-fix "$FIX" --seed "$S" --fuzz-count 64 --variants 64
      ./target/debug/kintsugi-check check --candidate "$FIX" --original "$ORIG" --tests "$TESTS" --exploit "$SECRET" \
        --seed "$S" --fuzz-count 64 --variants 64 --explain
      ./target/debug/kintsugi-check check --candidate "$ORIG" --original "$ORIG" --tests "$TESTS" --exploit "$SECRET" \
        --seed "$S" --fuzz-count 64 --variants 64 --explain || true
    done; } > "$W/native_check.txt" 2>&1
  keep "$W/native_check.txt"; cat "$OUTDIR/native_check.txt"
  ;;
proof0)
  if [ ! -f "$VDIR/proof0_seed.env" ]; then (umask 077; echo "SEED=$(python3 -c 'import secrets;print(secrets.token_hex(32))')" > "$VDIR/proof0_seed.env"); fi
  source "$VDIR/proof0_seed.env"
  free -h | tee "$OUTDIR/free_before_proof0_unpack.txt"
  MAX_SECONDS=10800 scripts/s2_measure.sh "$W/prove_proof0_unpack.log" -- $HOST prove "$FIX" --proof0 "${P[@]}" --seed "$SEED" \
    --out "$W/p0.bin"
  keep "$W/prove_proof0_unpack.log"; finished "$W/prove_proof0_unpack.log"
  MAX_SECONDS=3600 scripts/s2_measure.sh "$W/compress_proof0_unpack.log" -- $HOST compress "$W/p0.bin" "$W/p0_succinct.bin" succinct
  keep "$W/compress_proof0_unpack.log"; finished "$W/compress_proof0_unpack.log"
  groth16 p0
  grep -q '^journal.verdict: PASS' "$W/verify_p0.txt" || { echo "Proof 0 verdict is not PASS"; exit 1; }
  note "unpack Proof 0: $(grep -E '^wall_seconds|^r0vm_peak' "$W/prove_proof0_unpack.log" | tr '\n' ' ')"
  ;;
create)
  [ -n "${NBOUNTY:-}" ] && { echo "already made: bounty $NBOUNTY"; exit 0; }
  V="$W/verify_p0.txt"; field() { sed -n "s/^journal.$1: //p" "$V"; }
  [ "$(field original_hash)" = "$(sha "$ORIG")" ] && [ "$(field candidate_hash)" = "$(sha "$FIX")" ] \
    || { echo "journal does not match the original and the reference fix"; exit 1; }
  T=$(json_field "$(view get_next_bounty_id '{}')" "")
  call unpack_bounty_create "$VENDOR" create_bounty "{\"original_hash\":\"$(field original_hash)\",\"corpus_hash\":\"$(field corpus_hash)\",\"image_id\":\"$(sed -n 's/^image id: //p' "$V")\",\"exploit_commitment\":\"$(field exploit_commitment)\",\"proof0_receipt_hash\":\"$(sha "$W/p0_succinct.bin")\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 4 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( 2 * 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha "$FIX")\",\"proof0_journal_hash\":\"$(sed -n 's/^journal sha256: //p' "$V")\",\"reveal_window_ns\":\"$(( 3600 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2}" "0.1 NEAR"
  call unpack_bounty_open "$VENDOR" open_with_groth16 "{\"bounty_id\":\"$T\",$(proof_args "$W/p0_args.json")}" "0 NEAR" "300 Tgas"
  save NBOUNTY "$T"
  note "private bounty $T on the new module data/unpack: $(view get_bounty "{\"bounty_id\":\"$T\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("opened", d["opened"], "K", d["max_commits"], "image_id_allowed", d["image_id_allowed"], "next fee", d["next_fee"])')"
  ;;
prove)
  IDX="${2:?usage: prove <attempt index>}"
  S=$(view get_submission "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX}")
  python3 -I -c 'import base64,json,sys; open(sys.argv[2],"wb").write(base64.b64decode(json.loads(sys.argv[1])["patch"]))' "$S" "$W/patch_$IDX.wasm"
  SEED=$(json_field "$S" seed); SID=$(json_field "$(view get_submission_id "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX}")" "")
  note "proving bounty $NBOUNTY attempt $IDX: patch sha256 $(sha "$W/patch_$IDX.wasm") (read from the chain), seed $SEED"
  MAX_SECONDS=10800 scripts/s2_measure.sh "$W/prove_u$IDX.log" -- $HOST prove "$W/patch_$IDX.wasm" "${P[@]}" --seed "$SEED" \
    --submission-id "$SID" --out "$W/u$IDX.bin"
  keep "$W/prove_u$IDX.log"; finished "$W/prove_u$IDX.log"
  MAX_SECONDS=3600 scripts/s2_measure.sh "$W/compress_u$IDX.log" -- $HOST compress "$W/u$IDX.bin" "$W/u${IDX}_succinct.bin" succinct
  keep "$W/compress_u$IDX.log"; finished "$W/compress_u$IDX.log"
  groth16 "u$IDX"
  note "proof for bounty $NBOUNTY attempt $IDX: $(grep -E '^journal.verdict' "$W/verify_u$IDX.txt")"
  ;;
submit)
  IDX="${2:?usage: submit <attempt index>}"
  call "unpack_submit_groth16_$IDX" "$VENDOR" submit_groth16 "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX,$(proof_args "$W/u${IDX}_args.json")}" "0 NEAR" "300 Tgas"
  sleep 3
  S=$(view get_submission "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX}")
  note "bounty $NBOUNTY attempt $IDX: verdict $(json_field "$S" verdict), outcome $(json_field "$S" outcome); bounty state $(json_field "$(view get_bounty "{\"bounty_id\":\"$NBOUNTY\"}")" state)"
  ;;
timeout)
  # The silent vendor rule: after the attempt's verdict deadline anyone may call claim_timeout, which pays the revealed
  # attempt(s) still waiting. Called here by the agent's account with its full access key (its limited key may only
  # commit and reveal).
  IDX="${2:?usage: timeout <attempt index>}"
  B0=$(balance "$AGENT")
  call "unpack_claim_timeout_$IDX" "$AGENT" claim_timeout "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX}" "0 NEAR" "100 Tgas"
  sleep 3
  S=$(view get_submission "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX}")
  note "bounty $NBOUNTY attempt $IDX: claim_timeout; outcome $(json_field "$S" outcome); bounty state $(json_field "$(view get_bounty "{\"bounty_id\":\"$NBOUNTY\"}")" state); agent balance $B0 -> $(balance "$AGENT") yoctoNEAR"
  ;;
*) echo "usage: $0 check|proof0|create|prove <index>|submit <index>|timeout <index>"; exit 2 ;;
esac
