#!/usr/bin/env bash
# Testnet steps around the model-driven agent (agent/kintsugi_agent.py). Testnet only. Output: docs/evidence/agent/.
# Phases:
#   setup    make the agent's account (faucet), deposit credit, set agent limits (max fee, fixed payout), and add a
#            key limited to commit and reveal on the contract; writes agent/config.local.toml (ignored by git)
#   bounty   a new test bounty for the agent's real run (vendor account, K = 2, 0.1 NEAR, reveal window 1 h, verdict
#            window 4 h, expiry 1 day), opened with the demo's Groth16 Proof 0
#   prove    the vendor proves the agent's revealed patch against the secret input (about 55 min for a PASS, then
#            about 17 min succinct and 3 min Groth16; runs alone, memory watched)
#   submit   sends the Groth16 proof (submit_groth16) and reads the outcome and the payout
# Usage, from the repo root: ./scripts/agent_testnet.sh <phase>
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/agent; mkdir -p "$OUTDIR/steps" target/agent-test
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
SEC=1000000000; HOST=./target/release/kintsugi-host; W=target/agent-test
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
note() { echo "$*" | tee -a "$OUTDIR/summary.txt"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
proof_args() { python3 -I -c 'import base64,json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"seal":base64.b64encode(bytes.fromhex(d["seal"])).decode(),"journal":base64.b64encode(bytes.fromhex(d["journal"])).decode()})[1:-1])' "$1"; }

case "${1:-}" in
setup)
  if [ -z "${AGENT:-}" ]; then
    AGENT="kintsugi-agent-$(python3 -c 'import secrets;print(secrets.token_hex(3))').testnet"
    run_near agent_create_account create-account "$AGENT" account create-account sponsor-by-faucet-service "$AGENT" \
      autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
    save AGENT "$AGENT"; sleep 3
  fi
  note "agent account $AGENT, balance $(balance "$AGENT") yoctoNEAR"
  CREDS="$(sed -n 's/^credentials_home_dir = "\(.*\)"$/\1/p' "$HOME/.config/near-cli/config.toml")/testnet"
  if [ -z "${AGENT_PUBLIC_KEY:-}" ]; then
    call agent_deposit_credit "$AGENT" deposit_credit '{"account_id":null}' "0.05 NEAR" "30 Tgas"
    call agent_set_limits "$AGENT" set_agent_limits "{\"max_fee_per_commit\":\"20000000000000000000000\",\"fixed_payout\":\"$AGENT\"}" "1 yoctoNEAR" "30 Tgas"
    # The limited key goes to near-cli's keychain folder for the account; the full access key stays in its own file.
    cp -p "$CREDS/$AGENT.json" "$W/main-key-before"
    before=$(ls "$CREDS/$AGENT/" 2>/dev/null | sort || true)
    run_near agent_add_limited_key add-key "$AGENT" account add-key "$AGENT" grant-function-call-access \
      --allowance '0.25 NEAR' --contract-account-id "$CONTRACT" --function-names 'commit, reveal' \
      autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send
    if ! cmp -s "$CREDS/$AGENT.json" "$W/main-key-before"; then
      mkdir -p "$CREDS/$AGENT"; mv "$CREDS/$AGENT.json" "$CREDS/$AGENT/limited-key.json"; cp -p "$W/main-key-before" "$CREDS/$AGENT.json"
    fi
    rm -f "$W/main-key-before"
    after=$(ls "$CREDS/$AGENT/" | sort); newf=$(comm -13 <(echo "$before") <(echo "$after") | head -1); [ -n "$newf" ] || newf=limited-key.json
    chmod 600 "$CREDS/$AGENT/$newf"
    save AGENT_PUBLIC_KEY "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["public_key"])' "$CREDS/$AGENT/$newf")"
    echo "$CREDS/$AGENT/$newf" > "$W/limited_key_path"; chmod 600 "$W/limited_key_path"
    source "$RUN"
  fi
  # The local config: the repository's config with this account and its limited key file filled in.
  python3 -I - "$AGENT" "$(cat "$W/limited_key_path" | sed "s#^$HOME#~#")" <<'PY'
import re, sys
s = open("agent/config.toml").read()
s = s.replace('"your-agent.testnet"', f'"{sys.argv[1]}"')
s = re.sub(r'limited_key_file = "[^"]*"', f'limited_key_file = "{sys.argv[2]}"', s)
open("agent/config.local.toml", "w").write(s)
PY
  note "agent $AGENT: credit $(view get_credit "{\"account_id\":\"$AGENT\"}"), limits $(view get_agent_limits "{\"account_id\":\"$AGENT\"}"), limited key ${AGENT_PUBLIC_KEY:0:20}..."
  ;;
bounty)
  [ -n "${ABOUNTY:-}" ] && { echo "already made: bounty $ABOUNTY"; exit 0; }
  T=$(json_field "$(view get_next_bounty_id '{}')" "")
  P0_ARGS=target/s6b/args.json; P0_RECEIPT=$(sha target/demo/proof0_succinct.bin)
  call agent_bounty_create "$VENDOR" create_bounty "{\"original_hash\":\"$(sha data/demo/original.wasm)\",\"corpus_hash\":\"736d160dceba2ce955097aa39072a365f38abe59b7ffec61524dcfd021a1e61b\",\"image_id\":\"dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc\",\"exploit_commitment\":\"9a1be994ab379a76d3f154df1fbde561695377a989c8db432dd1092a09966387\",\"proof0_receipt_hash\":\"$P0_RECEIPT\",\"max_commits\":2,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 4 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha data/demo/fixed.wasm)\",\"proof0_journal_hash\":\"fb7939dca90136238fdc24bc38f077c11c4adae332cd0392611a12797f423ec5\",\"reveal_window_ns\":\"$(( 3600 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2}" "0.1 NEAR"
  call agent_bounty_open "$VENDOR" open_with_groth16 "{\"bounty_id\":\"$T\",$(proof_args "$P0_ARGS")}" "0 NEAR" "300 Tgas"
  save ABOUNTY "$T"; note "test bounty $T for the agent's real run: $(view get_bounty "{\"bounty_id\":\"$T\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("opened", d["opened"], "K", d["max_commits"], "next fee", d["next_fee"])')"
  ;;
prove)
  IDX="${2:?usage: prove <attempt index>}"
  S=$(view get_submission "{\"bounty_id\":\"$ABOUNTY\",\"index\":$IDX}")
  python3 -I -c 'import base64,json,sys; open(sys.argv[2],"wb").write(base64.b64decode(json.loads(sys.argv[1])["patch"]))' "$S" "$W/patch_$IDX.wasm"
  SEED=$(json_field "$S" seed); SID=$(json_field "$(view get_submission_id "{\"bounty_id\":\"$ABOUNTY\",\"index\":$IDX}")" "")
  save "SEED_$IDX" "$SEED"; save "SID_$IDX" "$SID"
  note "proving bounty $ABOUNTY attempt $IDX: patch sha256 $(sha "$W/patch_$IDX.wasm") (read from the chain), seed $SEED"
  MAX_SECONDS=10800 scripts/s2_measure.sh "$OUTDIR/prove_$IDX.log" -- $HOST prove "$W/patch_$IDX.wasm" --demo-salt --fuzz-count 16 --variants 32 --po2 19 \
    --seed "$SEED" --submission-id "$SID" --out "$W/a$IDX.bin"
  MAX_SECONDS=3600 scripts/s2_measure.sh "$OUTDIR/compress_$IDX.log" -- $HOST compress "$W/a$IDX.bin" "$W/a${IDX}_succinct.bin" succinct
  rm -f "$W/mem_$IDX.log"*; (KILL_BELOW_MIB="${GUARD_MIB:-500}" scripts/watch_mem.sh "$OUTDIR/mem_groth16_$IDX.log" & echo $! > "$W/watch.pid")
  MIN_AVAIL_MIB="${GUARD_MIB:-500}" MAX_SECONDS=3600 scripts/s2_measure.sh "$OUTDIR/groth16_$IDX.log" -- $HOST compress "$W/a${IDX}_succinct.bin" "$W/a${IDX}_groth16.bin" groth16 || true
  kill "$(cat "$W/watch.pid")" 2>/dev/null || true
  $HOST verify "$W/a${IDX}_groth16.bin" > "$OUTDIR/verify_$IDX.txt"
  grep -q '^VALID' "$OUTDIR/verify_$IDX.txt" || { echo "the Groth16 receipt does not verify"; exit 1; }
  $HOST groth16-args "$W/a${IDX}_groth16.bin" "$W/a${IDX}_args.json"
  note "proof for attempt $IDX ready: $(head -3 "$OUTDIR/verify_$IDX.txt" | tr '\n' ' ')"
  ;;
submit)
  IDX="${2:?usage: submit <attempt index>}"
  P0=$(balance "$AGENT")
  call "agent_submit_groth16_$IDX" "$VENDOR" submit_groth16 "{\"bounty_id\":\"$ABOUNTY\",\"index\":$IDX,$(proof_args "$W/a${IDX}_args.json")}" "0 NEAR" "300 Tgas"
  sleep 3
  S=$(view get_submission "{\"bounty_id\":\"$ABOUNTY\",\"index\":$IDX}")
  note "bounty $ABOUNTY attempt $IDX: verdict $(json_field "$S" verdict), outcome $(json_field "$S" outcome); bounty state $(json_field "$(view get_bounty "{\"bounty_id\":\"$ABOUNTY\"}")" state); agent balance $P0 -> $(balance "$AGENT") yoctoNEAR"
  ;;
*) echo "usage: $0 setup|bounty|prove <index>|submit <index>"; exit 2 ;;
esac
