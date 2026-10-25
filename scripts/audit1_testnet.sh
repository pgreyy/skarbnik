#!/usr/bin/env bash
# Audit round 1: reruns the attacks the five fixes address on the redeployed S6c contract (kintsugi-l2-cihdp.testnet),
# on one short Level 2 bounty opened with the reused Groth16 Proof 0. Testnet only. Evidence: docs/evidence/audit1/.
#   fix 2: a commit naming a registered verifier as payout is refused
#   fix 3: a timeout for a later reveal is refused while an earlier reveal is undecided; the earlier one is then paid
#   fix 1: a commit too close to expiry is refused
#   fix 4: the fee of the undecided later reveal is refunded as credit; at expiry the FAILed attempt's fee goes to the
#          protocol fee pool, not to the vendor (one real FAIL proof is made on the laptop, about 10 minutes)
# Usage, from the repo root: ./scripts/audit1_testnet.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/audit1; mkdir -p "$OUTDIR/steps" target/audit1
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
SEC=1000000000; HOST=./target/release/kintsugi-host
P0_ARGS=target/s6b/args.json; P0_SUCCINCT=target/demo/proof0_succinct.bin
P0_JOURNAL=fb7939dca90136238fdc24bc38f077c11c4adae332cd0392611a12797f423ec5; P0_RECEIPT=$(sha256sum "$P0_SUCCINCT" | cut -d' ' -f1)
IMAGE=dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
note() { echo "$*" | tee -a "$OUTDIR/summary.txt"; }
nonce() { python3 -c 'import secrets; print(secrets.token_hex(32))'; }
fp_for() { python3 - "$1" "$2" "$3" <<'PY'
import hashlib, sys
patch = open(sys.argv[1], 'rb').read(); payout = sys.argv[2].encode(); nonce = bytes.fromhex(sys.argv[3])
print(hashlib.sha256(b"kintsugi-commit-v1" + len(patch).to_bytes(4, "little") + patch + len(payout).to_bytes(4, "little") + payout + nonce).hexdigest())
PY
}
proof_args() { python3 -I -c 'import base64,json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"seal":base64.b64encode(bytes.fromhex(d["seal"])).decode(),"journal":base64.b64encode(bytes.fromhex(d["journal"])).decode()})[1:-1])' "$1"; }
now_ns() { curl -4 -s --max-time 60 "$RPC" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"t","method":"block","params":{"finality":"final"}}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["header"]["timestamp_nanosec"])'; }
wait_past() { while [ "$(now_ns)" -le "$1" ]; do sleep 5; done; }
commit_reveal() { # commit_reveal <prefix> <bounty> <account> <patch file>; prints index
  local n f idx; n=$(nonce); f=$(fp_for "$4" "$3" "$n")
  idx=$(json_field "$(view get_bounty "{\"bounty_id\":\"$2\"}")" commits)
  call "${1}_commit" "$3" commit "{\"bounty_id\":\"$2\",\"fingerprint\":\"$f\",\"payout\":\"$3\"}" >&2
  sleep 4
  call "${1}_reveal" "$3" reveal "{\"bounty_id\":\"$2\",\"index\":$idx,\"patch\":\"$(base64 -w0 "$4")\",\"nonce\":\"$n\"}" >&2
  echo "$idx"
}
note "== audit1 rerun start $(date -u +%FT%TZ); contract wasm $(sha target/near/kintsugi_contract/kintsugi_contract.wasm)"
X=$(json_field "$(view get_next_bounty_id '{}')" "")
# K = 4, reveal window 240 s, verdict window 1200 s, attestation window 60 s, expiry 2400 s (>= 2 + 240 + 1200 + 60)
call x_create "$VENDOR" create_bounty "{\"original_hash\":\"$(sha data/demo/original.wasm)\",\"corpus_hash\":\"736d160dceba2ce955097aa39072a365f38abe59b7ffec61524dcfd021a1e61b\",\"image_id\":\"$IMAGE\",\"exploit_commitment\":\"9a1be994ab379a76d3f154df1fbde561695377a989c8db432dd1092a09966387\",\"proof0_receipt_hash\":\"$P0_RECEIPT\",\"max_commits\":4,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 1200 * SEC ))\",\"attest_window_ns\":\"$(( 60 * SEC ))\",\"expiry_ns\":\"$(( 2400 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha data/demo/fixed.wasm)\",\"proof0_journal_hash\":\"$P0_JOURNAL\",\"reveal_window_ns\":\"$(( 240 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2}" "0.1 NEAR"
call x_open_groth16 "$RES2" open_with_groth16 "{\"bounty_id\":\"$X\",$(proof_args "$P0_ARGS")}" "0 NEAR" "300 Tgas"
CREATED=$(json_field "$(view get_bounty "{\"bounty_id\":\"$X\"}")" created_at_ns)
# fix 2
call_expect_fail fix2_payout_is_a_verifier "$RES1" commit "{\"bounty_id\":\"$X\",\"fingerprint\":\"$(fp_for data/demo/fixed.wasm "$VER1" "$(nonce)")\",\"payout\":\"$VER1\"}"
# the honest fix first (R), then a junk attempt that will be proved FAIL (J), then a junk attempt left undecided (K)
R=$(commit_reveal x_r "$X" "$RES1" data/demo/fixed.wasm)
J=$(commit_reveal x_j "$X" "$RES2" data/attacks/reject_all.wasm)
SEED_J=$(json_field "$(view get_submission "{\"bounty_id\":\"$X\",\"index\":$J}")" seed); SID_J=$(json_field "$(view get_submission_id "{\"bounty_id\":\"$X\",\"index\":$J}")" "")
# the FAIL proof for J, on the laptop (expected about 6 min prove + 2 min compress + 3 min Groth16)
MAX_SECONDS=3600 scripts/s2_measure.sh target/audit1/prove_j.log -- $HOST prove data/attacks/reject_all.wasm --demo-salt --fuzz-count 16 --variants 32 --po2 19 --seed "$SEED_J" --submission-id "$SID_J" --out target/audit1/j.bin
MAX_SECONDS=1800 scripts/s2_measure.sh target/audit1/compress_j.log -- $HOST compress target/audit1/j.bin target/audit1/j_succinct.bin succinct
rm -f target/audit1/mem_j.log*; (scripts/watch_mem.sh target/audit1/mem_j.log & echo $! > target/audit1/watch_j.pid)
MIN_AVAIL_MIB=500 MAX_SECONDS=1800 scripts/s2_measure.sh target/audit1/groth16_j.log -- $HOST compress target/audit1/j_succinct.bin target/audit1/j_groth16.bin groth16 || true
kill "$(cat target/audit1/watch_j.pid)" 2>/dev/null || true
$HOST verify target/audit1/j_groth16.bin > target/audit1/verify_j.txt; grep -q '^VALID' target/audit1/verify_j.txt
$HOST groth16-args target/audit1/j_groth16.bin target/audit1/j_args.json
K=$(commit_reveal x_k "$X" "$RES2" data/attacks/reject_all.wasm)   # a second junk reveal, never proved
call x_submit_fail_j "$RES2" submit_groth16 "{\"bounty_id\":\"$X\",\"index\":$J,$(proof_args target/audit1/j_args.json)}" "0 NEAR" "300 Tgas"
note "J after its FAIL proof: $(json_field "$(view get_submission "{\"bounty_id\":\"$X\",\"index\":$J}")" outcome) (a FAIL is not held back by the ordering rule)"
# fix 1: a commit too close to expiry (after created + 2400 - 240 - 1200 = created + 960 s)
wait_past $(( CREATED + 965 * SEC ))
call_expect_fail fix1_commit_too_close_to_expiry "$RES1" commit "{\"bounty_id\":\"$X\",\"fingerprint\":\"$(fp_for data/demo/fixed.wasm "$RES1" "$(nonce)")\",\"payout\":\"$RES1\"}"
# fix 3: after every deadline has passed, the later reveal (K) cannot be timed out while R is undecided; R is paid
wait_past $(( $(json_field "$(view get_submission "{\"bounty_id\":\"$X\",\"index\":$K}")" revealed_at_ns) + 1201 * SEC ))
call_expect_fail fix3_timeout_of_later_reveal_refused "$RES2" claim_timeout "{\"bounty_id\":\"$X\",\"index\":$K}"
CR0=$(json_field "$(view get_credit "{\"account_id\":\"$RES2\"}")" ""); B0=$(balance "$RES1")
call fix3_timeout_of_first_reveal "$RES2" claim_timeout "{\"bounty_id\":\"$X\",\"index\":$R}"; sleep 6
CR1=$(json_field "$(view get_credit "{\"account_id\":\"$RES2\"}")" "")
note "R paid by timeout: researcher 1 balance change $(python3 -c "print(($(balance "$RES1")-$B0)/1e24)") NEAR (0.11 expected: bounty + own fee); K's fee refunded as credit to researcher 2: credit change $(python3 -c "print(($CR1-$CR0)/1e24)") NEAR (0.02 expected, the third commit's fee)"
note "bounty $X after the payout: $(view get_bounty "{\"bounty_id\":\"$X\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ("state","winner","fees_collected","fees_swept","pending")})')"
# fix 4: at expiry J's fee (0.015 NEAR) goes to the pool, the vendor gets nothing
wait_past $(( CREATED + 2401 * SEC ))
P0=$(json_field "$(view get_protocol_pool '{}')" ""); V0=$(balance "$VENDOR")
call fix4_expire_fees_to_pool "$RES2" expire "{\"bounty_id\":\"$X\"}"; sleep 6
note "expire: pool change $(python3 -c "print(($(json_field "$(view get_protocol_pool '{}')" "")-$P0)/1e24)") NEAR (0.015 expected: J's fee), vendor balance change $(python3 -c "print(($(balance "$VENDOR")-$V0)/1e24)") NEAR (0 expected)"
note "== audit1 rerun end $(date -u +%FT%TZ)"
