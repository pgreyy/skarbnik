#!/usr/bin/env bash
# A private Level 2 bounty on one program in data/<MODULE>/ (for example data/smooth/): its secret crashing input and the
# vendor's reference fix are NOT in the repository; they live in ~/.kintsugi-salts/<MODULE>/ (folder mode 700, files
# mode 600: exploit.hex, fixed.wasm) and are never printed. The secret's commitment uses a private random salt
# (`skarbnik-host --bounty <MODULE>`). The same steps as scripts/unpack_bounty.sh, for any module.
# Phases, in order (one proving job at a time; Groth16 memory watched):
#   check       native checks: the secret crashes the original, the reference fix passes the full check, for six seeds
#   proof0      Proof 0 of the reference fix against the secret, compressed to succinct and to Groth16 (this machine)
#   create      the vendor creates the Level 2 bounty and opens it with the Groth16 Proof 0
#   attempt N   reads revealed attempt N from the chain: its patch, seed and submission id (target/<MODULE>/attempt_N.env)
#   prove N     the vendor proves attempt N on this machine: prove, succinct, Groth16
#   groth16 N   Groth16 on this machine from a succinct receipt made elsewhere (target/<MODULE>/uN_succinct.bin, for
#               example fetched from the GPU pod by notes/tools/gpu_remote.sh), then verify and the contract arguments
#   submit N    sends that proof (submit_groth16) and reads the outcome
#   timeout N   after the attempt's verdict deadline: claim_timeout by the agent's account (silent vendor rule)
# Settings for create (environment): REWARD (default "0.1 NEAR"), K (3), VERDICT_H (24), REVEAL_GAP_S (1200),
# REVEAL_WINDOW_S (7200), EXPIRY_H (96). PO2 (19) for proving.
# Usage, from the repo root: MODULE=<name> ./scripts/private_bounty.sh <phase>. Testnet only. Output: docs/evidence/<MODULE>/.
set -euo pipefail
cd "$(dirname "$0")/.."
MODULE="${MODULE:?set MODULE to a folder name in data/, for example MODULE=smooth}"
OUTDIR="docs/evidence/$MODULE"; mkdir -p "$OUTDIR/steps" "target/$MODULE"
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
AGENT=$(sed -n 's/^AGENT=//p' docs/evidence/agent/run.env)
SEC=1000000000; HOST=./target/release/skarbnik-host; CHECK=./target/debug/skarbnik-check; W="target/$MODULE"
VDIR="$HOME/.kintsugi-salts/$MODULE"; SECRET="$VDIR/exploit.hex"; FIX="$VDIR/fixed.wasm"
ORIG="data/$MODULE/original.wasm"; TESTS="data/$MODULE/public_tests.txt"
[ -f "$SECRET" ] && [ "$(stat -c %a "$SECRET")" = 600 ] && [ "$(stat -c %a "$VDIR")" = 700 ] \
  || { echo "the private secret is missing or readable by others"; exit 1; }
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
note() { echo "$(date -u +%FT%TZ) $*" | tee -a "$OUTDIR/summary.txt"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
# Copy a log into the evidence folder with the home folder shortened to ~ and no secret bytes.
keep() { sed -E 's#/home/[^/ "]+#~#g' "$1" | grep -v -i -F "$(tr -d ' \n' < "$SECRET")" > "$OUTDIR/$(basename "$1")" || true; }
proof_args() { python3 -I -c 'import base64,json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"seal":base64.b64encode(bytes.fromhex(d["seal"])).decode(),"journal":base64.b64encode(bytes.fromhex(d["journal"])).decode()})[1:-1])' "$1"; }
P=(--bounty "$MODULE" --exploit "$SECRET" --original "$ORIG" --tests "$TESTS" --fuzz-count 16 --variants 32 --po2 "${PO2:-19}")
# Time limits for each measured step (scripts/s2_measure.sh). Generous on purpose: a limit only guards against a hang.
# Measured so far: prove up to 6,531 s (102 segments), succinct up to 1,497 s for 26 segments; a 102 segment receipt
# needed more than 3,600 s (docs/evidence/agent/compress_u0.log).
PROVE_MAX_S=21600; SUCCINCT_MAX_S=21600; GROTH16_MAX_S=3600
finished() { grep -q '^result: finished' "$1" && ! grep -q '^exit=[1-9]' "$1" || { echo "stopped: $(grep '^result' "$1")"; exit 1; }; }
groth16() { # groth16 <name>: succinct receipt -> Groth16 receipt -> contract arguments, memory watched
  rm -f "$W/mem_$1.log"*; (KILL_BELOW_MIB="${GUARD_MIB:-500}" scripts/watch_mem.sh "$W/mem_groth16_$1.log" & echo $! > "$W/watch.pid")
  MIN_AVAIL_MIB="${GUARD_MIB:-500}" MAX_SECONDS=$GROTH16_MAX_S scripts/s2_measure.sh "$W/groth16_$1.log" -- $HOST compress \
    "$W/$1_succinct.bin" "$W/$1_groth16.bin" groth16 || true
  kill "$(cat "$W/watch.pid")" 2>/dev/null || true
  keep "$W/groth16_$1.log"; cp "$W/mem_groth16_$1.log.peaks" "$OUTDIR/" 2>/dev/null || true
  $HOST verify "$W/$1_groth16.bin" > "$W/verify_$1.txt"; keep "$W/verify_$1.txt"
  grep -q '^VALID' "$W/verify_$1.txt" || { echo "the $1 Groth16 receipt does not verify"; exit 1; }
  $HOST groth16-args "$W/$1_groth16.bin" "$W/$1_args.json"
}
# The journal of a proof must carry this bounty's secret commitment (a wrong or new salt would give another one).
commitment_ok() { local want; want=$(json_field "$(view get_bounty "{\"bounty_id\":\"$NBOUNTY\"}")" exploit_commitment)
  grep -q "^journal.exploit_commitment: $want$" "$1" || { echo "the proof's secret commitment is not the bounty's: not submitting"; exit 1; }; }

case "${1:-}" in
check)
  { for i in 1 2 3 4 5 6; do S=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
      echo "seed $S"; $CHECK proof0 --original "$ORIG" --tests "$TESTS" --exploit "$SECRET" \
        --reference-fix "$FIX" --seed "$S" --fuzz-count 64 --variants 64
      $CHECK check --candidate "$FIX" --original "$ORIG" --tests "$TESTS" --exploit "$SECRET" \
        --seed "$S" --fuzz-count 64 --variants 64 --explain
      $CHECK check --candidate "$ORIG" --original "$ORIG" --tests "$TESTS" --exploit "$SECRET" \
        --seed "$S" --fuzz-count 64 --variants 64 --explain || true
    done; } > "$W/native_check.txt" 2>&1
  keep "$W/native_check.txt"; cat "$OUTDIR/native_check.txt"
  ;;
proof0)
  if [ ! -f "$VDIR/proof0_seed.env" ]; then (umask 077; echo "SEED=$(python3 -c 'import secrets;print(secrets.token_hex(32))')" > "$VDIR/proof0_seed.env"); fi
  source "$VDIR/proof0_seed.env"
  free -h | tee "$OUTDIR/free_before_proof0.txt"
  MAX_SECONDS=$PROVE_MAX_S scripts/s2_measure.sh "$W/prove_proof0.log" -- $HOST prove "$FIX" --proof0 "${P[@]}" --seed "$SEED" \
    --out "$W/p0.bin"
  keep "$W/prove_proof0.log"; finished "$W/prove_proof0.log"
  MAX_SECONDS=$SUCCINCT_MAX_S scripts/s2_measure.sh "$W/compress_proof0.log" -- $HOST compress "$W/p0.bin" "$W/p0_succinct.bin" succinct
  keep "$W/compress_proof0.log"; finished "$W/compress_proof0.log"
  groth16 p0
  grep -q '^journal.verdict: PASS' "$W/verify_p0.txt" || { echo "Proof 0 verdict is not PASS"; exit 1; }
  note "$MODULE Proof 0 (this machine): $(grep -hE '^wall_seconds|^r0vm_peak' "$W/prove_proof0.log" "$W/compress_proof0.log" "$W/groth16_p0.log" | tr '\n' ' ')"
  ;;
create)
  [ -n "${NBOUNTY:-}" ] && { echo "already made: bounty $NBOUNTY"; exit 0; }
  V="$W/verify_p0.txt"; field() { sed -n "s/^journal.$1: //p" "$V"; }
  [ "$(field original_hash)" = "$(sha "$ORIG")" ] && [ "$(field candidate_hash)" = "$(sha "$FIX")" ] \
    || { echo "journal does not match the original and the reference fix"; exit 1; }
  T=$(json_field "$(view get_next_bounty_id '{}')" "")
  call "${MODULE}_bounty_create" "$VENDOR" create_bounty "{\"original_hash\":\"$(field original_hash)\",\"corpus_hash\":\"$(field corpus_hash)\",\"image_id\":\"$(sed -n 's/^image id: //p' "$V")\",\"exploit_commitment\":\"$(field exploit_commitment)\",\"proof0_receipt_hash\":\"$(sha "$W/p0_succinct.bin")\",\"max_commits\":${K:-3},\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( ${REVEAL_GAP_S:-1200} * SEC ))\",\"verdict_window_ns\":\"$(( ${VERDICT_H:-24} * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( ${EXPIRY_H:-96} * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha "$FIX")\",\"proof0_journal_hash\":\"$(sed -n 's/^journal sha256: //p' "$V")\",\"reveal_window_ns\":\"$(( ${REVEAL_WINDOW_S:-7200} * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2}" "${REWARD:-0.1 NEAR}"
  call "${MODULE}_bounty_open" "$VENDOR" open_with_groth16 "{\"bounty_id\":\"$T\",$(proof_args "$W/p0_args.json")}" "0 NEAR" "300 Tgas"
  save NBOUNTY "$T"
  note "private bounty $T on data/$MODULE: $(view get_bounty "{\"bounty_id\":\"$T\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("opened", d["opened"], "K", d["max_commits"], "verdict window h", int(d["verdict_window_ns"])/3.6e12, "image_id_allowed", d["image_id_allowed"], "next fee", d["next_fee"])')"
  ;;
attempt)
  IDX="${2:?usage: attempt <attempt index>}"
  S=$(view get_submission "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX}")
  python3 -I -c 'import base64,json,sys; open(sys.argv[2],"wb").write(base64.b64decode(json.loads(sys.argv[1])["patch"]))' "$S" "$W/patch_$IDX.wasm"
  SEED=$(json_field "$S" seed); SID=$(json_field "$(view get_submission_id "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX}")" "")
  printf 'PATCH=%s\nSEED=%s\nSID=%s\nNBOUNTY=%s\n' "$W/patch_$IDX.wasm" "$SEED" "$SID" "$NBOUNTY" > "$W/attempt_$IDX.env"
  note "attempt $IDX of bounty $NBOUNTY read from the chain: patch sha256 $(sha "$W/patch_$IDX.wasm"), seed $SEED, submission id $SID"
  ;;
prove)
  IDX="${2:?usage: prove <attempt index>}"
  "$0" attempt "$IDX"; source "$W/attempt_$IDX.env"
  note "proving bounty $NBOUNTY attempt $IDX on this machine (PO2=${PO2:-19})"
  MAX_SECONDS=$PROVE_MAX_S scripts/s2_measure.sh "$W/prove_u$IDX.log" -- $HOST prove "$PATCH" "${P[@]}" --seed "$SEED" \
    --submission-id "$SID" --out "$W/u$IDX.bin"
  keep "$W/prove_u$IDX.log"; finished "$W/prove_u$IDX.log"
  MAX_SECONDS=$SUCCINCT_MAX_S scripts/s2_measure.sh "$W/compress_u$IDX.log" -- $HOST compress "$W/u$IDX.bin" "$W/u${IDX}_succinct.bin" succinct
  keep "$W/compress_u$IDX.log"; finished "$W/compress_u$IDX.log"
  groth16 "u$IDX"; commitment_ok "$W/verify_u$IDX.txt"
  note "proof for bounty $NBOUNTY attempt $IDX: $(grep -E '^journal.verdict' "$W/verify_u$IDX.txt")"
  ;;
groth16)
  IDX="${2:?usage: groth16 <attempt index>}"
  [ -f "$W/u${IDX}_succinct.bin" ] || { echo "no $W/u${IDX}_succinct.bin (fetch it from the GPU pod first)"; exit 1; }
  $HOST verify "$W/u${IDX}_succinct.bin" > "$W/verify_u${IDX}_succinct.txt"; keep "$W/verify_u${IDX}_succinct.txt"
  grep -q '^VALID' "$W/verify_u${IDX}_succinct.txt" || { echo "the succinct receipt does not verify"; exit 1; }
  commitment_ok "$W/verify_u${IDX}_succinct.txt"
  groth16 "u$IDX"
  note "Groth16 on this machine for bounty $NBOUNTY attempt $IDX: $(grep -hE '^wall_seconds' "$W/groth16_u$IDX.log" | tr '\n' ' ')$(grep -E '^journal.verdict' "$W/verify_u$IDX.txt")"
  ;;
submit)
  IDX="${2:?usage: submit <attempt index>}"
  commitment_ok "$W/verify_u$IDX.txt"
  B0=$(balance "$AGENT")
  call "${MODULE}_submit_groth16_$IDX" "$VENDOR" submit_groth16 "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX,$(proof_args "$W/u${IDX}_args.json")}" "0 NEAR" "300 Tgas"
  sleep 3
  S=$(view get_submission "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX}")
  note "bounty $NBOUNTY attempt $IDX: verdict $(json_field "$S" verdict), outcome $(json_field "$S" outcome); bounty state $(json_field "$(view get_bounty "{\"bounty_id\":\"$NBOUNTY\"}")" state); agent balance $B0 -> $(balance "$AGENT") yoctoNEAR"
  ;;
timeout)
  IDX="${2:?usage: timeout <attempt index>}"
  B0=$(balance "$AGENT")
  call "${MODULE}_claim_timeout_$IDX" "$AGENT" claim_timeout "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX}" "0 NEAR" "100 Tgas"
  sleep 3
  S=$(view get_submission "{\"bounty_id\":\"$NBOUNTY\",\"index\":$IDX}")
  note "bounty $NBOUNTY attempt $IDX: claim_timeout; outcome $(json_field "$S" outcome); bounty state $(json_field "$(view get_bounty "{\"bounty_id\":\"$NBOUNTY\"}")" state); agent balance $B0 -> $(balance "$AGENT") yoctoNEAR"
  ;;
*) echo "usage: MODULE=<name> $0 check|proof0|create|attempt <index>|prove <index>|groth16 <index>|submit <index>|timeout <index>"; exit 2 ;;
esac
