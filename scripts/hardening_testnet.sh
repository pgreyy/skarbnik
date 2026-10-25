#!/usr/bin/env bash
# Audit hardening round on NEAR testnet: redeploys the contract in place on kintsugi-l2-cihdp.testnet (stored layout
# unchanged, no init call) and checks the new rules on a throwaway Level 2 bounty. The live demo bounty 7 is only read.
# Phases, in order:
#   deploy     redeploy the built wasm; bounty 7, the pool and the allowlist must be unchanged
#   limits     S6: set_agent_limits needs 1 yoctoNEAR; a fee above max_fee_per_commit and a payout other than the fixed
#              one are refused; a commit inside the limits is accepted; the limits are cleared again
#   split      S7: two revealed attempts, the vendor silent; claim_timeout pays each half the bounty and its fee
#              S3: before that, a proof bound to another bounty is refused before the pairing check (gas burned)
#   preflight  S16: scripts/agent_preflight.sh passes for bounty 7 and refuses a payout account that does not exist
# Usage, from the repo root: ./scripts/hardening_testnet.sh <phase>. Testnet only. Output: docs/evidence/hardening/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/hardening; mkdir -p "$OUTDIR/steps"
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
SEC=1000000000
W=target/near/kintsugi_contract/kintsugi_contract.wasm
P0_ARGS=target/s6b/args.json; P0_SUCCINCT=target/demo/proof0_succinct.bin
P0_JOURNAL=fb7939dca90136238fdc24bc38f077c11c4adae332cd0392611a12797f423ec5; P0_RECEIPT=$(sha256sum "$P0_SUCCINCT" | cut -d' ' -f1)
IMAGE=dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
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
# A throwaway Level 2 bounty with the demo values, opened with the demo Proof 0. Usage: new_bounty <step> <verdict s> <expiry s>
new_bounty() {
  local id; id=$(json_field "$(view get_next_bounty_id '{}')" "")
  call "$1_create" "$VENDOR" create_bounty "{\"original_hash\":\"$(sha data/demo/original.wasm)\",\"corpus_hash\":\"736d160dceba2ce955097aa39072a365f38abe59b7ffec61524dcfd021a1e61b\",\"image_id\":\"$IMAGE\",\"exploit_commitment\":\"9a1be994ab379a76d3f154df1fbde561695377a989c8db432dd1092a09966387\",\"proof0_receipt_hash\":\"$P0_RECEIPT\",\"max_commits\":4,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( $2 * SEC ))\",\"attest_window_ns\":\"$(( 60 * SEC ))\",\"expiry_ns\":\"$(( $3 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha data/demo/fixed.wasm)\",\"proof0_journal_hash\":\"$P0_JOURNAL\",\"reveal_window_ns\":\"$(( 60 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2}" "0.1 NEAR" >&2
  call "$1_open_groth16" "$RES2" open_with_groth16 "{\"bounty_id\":\"$id\",$(proof_args "$P0_ARGS")}" "0 NEAR" "300 Tgas" >&2
  [ "$(json_field "$(view get_bounty "{\"bounty_id\":\"$id\"}")" opened)" = True ] || { echo "bounty $id did not open" >&2; exit 1; }
  echo "$id"
}
fail_line() { grep -oE '"failure": "[^"]*"' "$OUTDIR/steps/$1.txt" | head -1 | cut -c1-200 || echo "(no failure line, see $OUTDIR/steps/$1.txt)"; }

case "${1:-}" in
deploy)
  view get_bounty '{"bounty_id":"7"}' > "$OUTDIR/bounty7_before.json"
  P0=$(json_field "$(view get_protocol_pool '{}')" ""); AL=$(view get_allowed_image_ids '{}')
  { echo "wasm_bytes=$(stat -c %s "$W")"; echo "wasm_sha256=$(sha "$W")"; } | tee "$OUTDIR/contract_wasm.txt"
  run_near redeploy deploy "$CONTRACT" contract deploy "$CONTRACT" use-file "$W" without-init-call \
    network-config testnet sign-with-legacy-keychain send
  sleep 3
  view get_bounty '{"bounty_id":"7"}' > "$OUTDIR/bounty7_after.json"
  cmp -s "$OUTDIR/bounty7_before.json" "$OUTDIR/bounty7_after.json" && note "bounty 7 unchanged by the redeploy" || { note "bounty 7 CHANGED"; exit 1; }
  [ "$(json_field "$(view get_protocol_pool '{}')" "")" = "$P0" ] && note "pool unchanged: $P0 yoctoNEAR" || { note "pool CHANGED"; exit 1; }
  [ "$(view get_allowed_image_ids '{}')" = "$AL" ] && note "allowlist unchanged: $AL" || { note "allowlist CHANGED"; exit 1; }
  note "agent limits view answers on the new code: $(view get_agent_limits "{\"account_id\":\"$RES1\"}")"
  ;;
limits)
  T=$(new_bounty lim 1200 2400); save LIMITS_BOUNTY "$T"; note "== S6 on bounty $T"
  call_expect_fail s6_set_limits_without_one_yocto "$RES1" set_agent_limits "{\"max_fee_per_commit\":\"5000000000000000000000\",\"fixed_payout\":\"$RES1\"}"
  note "set_agent_limits with 0 deposit (what a function call key can send): $(fail_line s6_set_limits_without_one_yocto)"
  call s6_set_limits "$RES1" set_agent_limits "{\"max_fee_per_commit\":\"5000000000000000000000\",\"fixed_payout\":\"$RES1\"}" "1 yoctoNEAR"
  note "limits of $RES1: $(view get_agent_limits "{\"account_id\":\"$RES1\"}")"
  call_expect_fail s6_fee_above_limit "$RES1" commit "{\"bounty_id\":\"$T\",\"fingerprint\":\"$(fp_for data/demo/fixed.wasm "$RES1" "$(nonce)")\",\"payout\":\"$RES1\"}"
  note "commit with fee 0.01 NEAR above the 0.005 NEAR limit: $(fail_line s6_fee_above_limit)"
  call s6_raise_limit "$RES1" set_agent_limits "{\"max_fee_per_commit\":\"10000000000000000000000\",\"fixed_payout\":\"$RES1\"}" "1 yoctoNEAR"
  call_expect_fail s6_other_payout "$RES1" commit "{\"bounty_id\":\"$T\",\"fingerprint\":\"$(fp_for data/demo/fixed.wasm "$RES2" "$(nonce)")\",\"payout\":\"$RES2\"}"
  note "commit naming $RES2 as payout: $(fail_line s6_other_payout)"
  C0=$(json_field "$(view get_credit "{\"account_id\":\"$RES1\"}")" "")
  call s6_commit_within_limits "$RES1" commit "{\"bounty_id\":\"$T\",\"fingerprint\":\"$(fp_for data/demo/fixed.wasm "$RES1" "$(nonce)")\",\"payout\":\"$RES1\"}"
  note "commit within the limits accepted: credit $C0 -> $(json_field "$(view get_credit "{\"account_id\":\"$RES1\"}")" "") yoctoNEAR, commits $(json_field "$(view get_bounty "{\"bounty_id\":\"$T\"}")" commits)"
  call s6_clear_limits "$RES1" set_agent_limits '{"max_fee_per_commit":null,"fixed_payout":null}' "1 yoctoNEAR"
  note "limits cleared: $(view get_agent_limits "{\"account_id\":\"$RES1\"}")"
  ;;
split)
  # verdict window 180 s; expiry 900 s (>= 60 s reveal + 180 s verdict after each commit)
  S=$(new_bounty split 180 900); save SPLIT_BOUNTY "$S"; note "== S7 and S3 on bounty $S"
  R=$(commit_reveal s7_r "$S" "$RES1" data/demo/fixed.wasm)
  J=$(commit_reveal s7_j "$S" "$RES2" data/attacks/reject_all.wasm)
  # S3: the real PASS proof of bounty 1 attempt 0 is bound to another bounty; refused at the submission id check.
  call_expect_fail s3_proof_of_another_bounty "$RES2" submit_groth16 "{\"bounty_id\":\"$S\",\"index\":$R,$(proof_args target/s6c/a0_args.json)}"
  note "S3: proof of bounty 1 attempt 0 sent for bounty $S attempt $R: $(fail_line s3_proof_of_another_bounty)"
  DL=$(json_field "$(view get_submission "{\"bounty_id\":\"$S\",\"index\":$R}")" revealed_at_ns)
  wait_past $(( DL + 180 * SEC ))
  B1=$(balance "$RES1"); B2=$(balance "$RES2")
  call s7_claim_timeout "$VER3" claim_timeout "{\"bounty_id\":\"$S\",\"index\":$R}"
  sleep 6
  note "S7: after claim_timeout of index $R: $RES1 +$(python3 -c "print($(balance "$RES1")-$B1)") yoctoNEAR (expected 0.05 + 0.01 fee), $RES2 +$(python3 -c "print($(balance "$RES2")-$B2)") yoctoNEAR (expected 0.05 + 0.015 fee)"
  for i in "$R" "$J"; do note "submission $i: $(view get_submission "{\"bounty_id\":\"$S\",\"index\":$i}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["outcome"], d["payout"])')"; done
  note "bounty $S: $(view get_bounty "{\"bounty_id\":\"$S\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ("state","winner","pending","fees_collected")})')"
  ;;
preflight)
  { echo "\$ ./scripts/agent_preflight.sh $CONTRACT 7 $RES1 $RES1"; ./scripts/agent_preflight.sh "$CONTRACT" 7 "$RES1" "$RES1" || true
    echo "\$ ./scripts/agent_preflight.sh $CONTRACT 7 ghost-kintsugi-audit-zqx.testnet"; ./scripts/agent_preflight.sh "$CONTRACT" 7 ghost-kintsugi-audit-zqx.testnet || true
    echo "\$ MAX_FEE=1 ./scripts/agent_preflight.sh $CONTRACT 7 $RES1"; MAX_FEE=1 ./scripts/agent_preflight.sh "$CONTRACT" 7 "$RES1" || true
  } 2>&1 | tee "$OUTDIR/preflight.txt"
  ;;
*) echo "usage: $0 deploy|limits|split|preflight"; exit 2 ;;
esac
