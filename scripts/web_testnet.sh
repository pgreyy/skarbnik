#!/usr/bin/env bash
# Testnet run for the site's wallet features, with a throwaway account made by the faucet (its key stays in the
# near-cli keychain outside the repository and is never printed). It sends the same calls the page builds, with the
# commit fingerprint computed by the page's own code (scripts/web_fingerprint.mjs). The wallet's approval window itself
# needs a person and is not part of this run. Phases, in order:
#   account   create the throwaway account kintsugi-web-<random>.testnet through the faucet
#   bounty    the vendor creates a small Level 2 test bounty with K = 1, opened with the demo Proof 0
#   credit    deposit_credit 0.05 NEAR
#   attempt   commit (index 0), a second commit (cap full: null, nothing taken), reveal
#   refusals  withdraw_credit of the rest (1 yoctoNEAR), then a commit with no credit (refused)
#   close     after the verdict window, claim_timeout closes the test bounty
#   userbounty a second test bounty (K = 3, 3 days) for the owner to try the wallet flow by hand
#   clibounty  a third test bounty (K = 2, 1 day) for the scripted run of the page with the NEAR CLI wallet
#   agentkey   a limited key (commit and reveal only) on this contract: refused payout, withdrawal, limits; commit and reveal
# Usage, from the repo root: ./scripts/web_testnet.sh <phase>. Testnet only. Output: docs/evidence/web/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/web; mkdir -p "$OUTDIR/steps" target/web-test
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
SEC=1000000000
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
note() { echo "$*" | tee -a "$OUTDIR/summary.txt"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
proof_args() { python3 -I -c 'import base64,json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"seal":base64.b64encode(bytes.fromhex(d["seal"])).decode(),"journal":base64.b64encode(bytes.fromhex(d["journal"])).decode()})[1:-1])' "$1"; }
now_ns() { curl -4 -s --max-time 60 "$RPC" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"t","method":"block","params":{"finality":"final"}}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["header"]["timestamp_nanosec"])'; }
fail_line() { grep -oE '"failure": "[^"]*"' "$OUTDIR/steps/$1.txt" | head -1 | grep -oE "panicked: [^'\"]*" || echo "(see $OUTDIR/steps/$1.txt)"; }
# The return value of a successful call, from the RPC transaction status.
ret() { curl -4 -s --max-time 60 "$RPC" -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":\"t\",\"method\":\"tx\",\"params\":{\"tx_hash\":\"$1\",\"sender_account_id\":\"$2\",\"wait_until\":\"FINAL\"}}" \
  | python3 -c 'import base64,json,sys; s=json.load(sys.stdin)["result"]["status"]; print(base64.b64decode(s["SuccessValue"]).decode() if "SuccessValue" in s else json.dumps(s))'; }
txof() { awk -F'\t' -v s="$1" '$1==s{print $4}' "$OUTDIR/transactions.tsv" | tail -1; }

case "${1:-}" in
account)
  [ -n "${WEB:-}" ] && { echo "already made: $WEB"; exit 0; }
  WEB="kintsugi-web-$(python3 -c 'import secrets;print(secrets.token_hex(3))').testnet"
  run_near web_create_account create-account "$WEB" account create-account sponsor-by-faucet-service "$WEB" \
    autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
  save WEB "$WEB"; sleep 3; note "throwaway account $WEB, balance $(balance "$WEB") yoctoNEAR"
  ;;
bounty)
  T=$(json_field "$(view get_next_bounty_id '{}')" "")
  P0_ARGS=target/s6b/args.json; P0_RECEIPT=$(sha target/demo/proof0_succinct.bin)
  # K = 1, reveal window 120 s, verdict window 180 s, expiry 900 s
  call web_bounty_create "$VENDOR" create_bounty "{\"original_hash\":\"$(sha data/demo/original.wasm)\",\"corpus_hash\":\"736d160dceba2ce955097aa39072a365f38abe59b7ffec61524dcfd021a1e61b\",\"image_id\":\"dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc\",\"exploit_commitment\":\"9a1be994ab379a76d3f154df1fbde561695377a989c8db432dd1092a09966387\",\"proof0_receipt_hash\":\"$P0_RECEIPT\",\"max_commits\":1,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 180 * SEC ))\",\"attest_window_ns\":\"$(( 60 * SEC ))\",\"expiry_ns\":\"$(( 900 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha data/demo/fixed.wasm)\",\"proof0_journal_hash\":\"fb7939dca90136238fdc24bc38f077c11c4adae332cd0392611a12797f423ec5\",\"reveal_window_ns\":\"$(( 120 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2}" "0.1 NEAR"
  call web_bounty_open "$RES2" open_with_groth16 "{\"bounty_id\":\"$T\",$(proof_args "$P0_ARGS")}" "0 NEAR" "300 Tgas"
  save TBOUNTY "$T"; note "test bounty $T: $(view get_bounty "{\"bounty_id\":\"$T\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ("level","opened","max_commits","next_fee")})')"
  ;;
userbounty)
  # A test bounty for the owner to try the wallet flow by hand: K = 3, 0.1 NEAR, reveal window 1 h, verdict window 4 h,
  # attestation window 1 h, expiry 3 days. Same vendor account and calls as the bounty phase.
  [ -n "${UBOUNTY:-}" ] && { echo "already made: bounty $UBOUNTY"; exit 0; }
  T=$(json_field "$(view get_next_bounty_id '{}')" "")
  P0_ARGS=target/s6b/args.json; P0_RECEIPT=$(sha target/demo/proof0_succinct.bin)
  call user_bounty_create "$VENDOR" create_bounty "{\"original_hash\":\"$(sha data/demo/original.wasm)\",\"corpus_hash\":\"736d160dceba2ce955097aa39072a365f38abe59b7ffec61524dcfd021a1e61b\",\"image_id\":\"dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc\",\"exploit_commitment\":\"9a1be994ab379a76d3f154df1fbde561695377a989c8db432dd1092a09966387\",\"proof0_receipt_hash\":\"$P0_RECEIPT\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 4 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( 3 * 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha data/demo/fixed.wasm)\",\"proof0_journal_hash\":\"fb7939dca90136238fdc24bc38f077c11c4adae332cd0392611a12797f423ec5\",\"reveal_window_ns\":\"$(( 3600 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2}" "0.1 NEAR"
  call user_bounty_open "$RES2" open_with_groth16 "{\"bounty_id\":\"$T\",$(proof_args "$P0_ARGS")}" "0 NEAR" "300 Tgas"
  save UBOUNTY "$T"; note "test bounty $T for trying the wallet flow by hand: $(view get_bounty "{\"bounty_id\":\"$T\"}" | python3 -c 'import json,sys,datetime; d=json.load(sys.stdin); print("level", d["level"], "opened", d["opened"], "K", d["max_commits"], "expires", datetime.datetime.fromtimestamp(int(d["expires_at_ns"])/1e9, datetime.UTC).strftime("%Y-%m-%d %H:%M UTC"))')"
  ;;
clibounty)
  # A test bounty for the scripted NEAR CLI wallet run of the page (K = 2, 0.1 NEAR, reveal window 1 h, verdict window
  # 4 h, expiry 1 day). Same vendor account and calls as the bounty phase.
  [ -n "${CBOUNTY:-}" ] && { echo "already made: bounty $CBOUNTY"; exit 0; }
  T=$(json_field "$(view get_next_bounty_id '{}')" "")
  P0_ARGS=target/s6b/args.json; P0_RECEIPT=$(sha target/demo/proof0_succinct.bin)
  call cli_bounty_create "$VENDOR" create_bounty "{\"original_hash\":\"$(sha data/demo/original.wasm)\",\"corpus_hash\":\"736d160dceba2ce955097aa39072a365f38abe59b7ffec61524dcfd021a1e61b\",\"image_id\":\"dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc\",\"exploit_commitment\":\"9a1be994ab379a76d3f154df1fbde561695377a989c8db432dd1092a09966387\",\"proof0_receipt_hash\":\"$P0_RECEIPT\",\"max_commits\":2,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 4 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha data/demo/fixed.wasm)\",\"proof0_journal_hash\":\"fb7939dca90136238fdc24bc38f077c11c4adae332cd0392611a12797f423ec5\",\"reveal_window_ns\":\"$(( 3600 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2}" "0.1 NEAR"
  call cli_bounty_open "$RES2" open_with_groth16 "{\"bounty_id\":\"$T\",$(proof_args "$P0_ARGS")}" "0 NEAR" "300 Tgas"
  save CBOUNTY "$T"; note "test bounty $T for the NEAR CLI wallet run of the page: $(view get_bounty "{\"bounty_id\":\"$T\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("opened", d["opened"], "K", d["max_commits"])')"
  ;;
agentkey)
  # A limited key on this contract (commit and reveal only), tested with the throwaway account: the owner (full key) sets
  # agent limits; the limited key is refused another payout, a withdrawal and a limits change, then commits and reveals
  # on test bounty CBOUNTY. The key file stays in near-cli's keychain folder; its path is kept in target/ (not in git).
  CREDS="$(sed -n 's/^credentials_home_dir = "\(.*\)"$/\1/p' "$HOME/.config/near-cli/config.toml")/testnet"
  KEYENV=target/web-test/agent_key.env
  if [ ! -f "$KEYENV" ]; then
    cp -p "$CREDS/$WEB.json" "$CREDS/$WEB.json.before-agent-key"
    before=$(ls "$CREDS/$WEB/" 2>/dev/null | sort)
    run_near agentkey_add_limited_key add-key "$WEB" account add-key "$WEB" grant-function-call-access \
      --allowance '0.25 NEAR' --contract-account-id "$CONTRACT" --function-names 'commit, reveal' \
      autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send
    if ! cmp -s "$CREDS/$WEB.json" "$CREDS/$WEB.json.before-agent-key"; then
      mkdir -p "$CREDS/$WEB"; mv "$CREDS/$WEB.json" "$CREDS/$WEB/agent-key-from-main-file.json"; mv "$CREDS/$WEB.json.before-agent-key" "$CREDS/$WEB.json"
    else rm "$CREDS/$WEB.json.before-agent-key"; fi
    after=$(ls "$CREDS/$WEB/" | sort); newf=$(comm -13 <(echo "$before") <(echo "$after") | head -1); [ -n "$newf" ] || newf=agent-key-from-main-file.json
    chmod 600 "$CREDS/$WEB/$newf"; echo "AGENT_KEY_FILE=$CREDS/$WEB/$newf" > "$KEYENV"; chmod 600 "$KEYENV"
    save AGENT_PUBLIC_KEY "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["public_key"])' "$CREDS/$WEB/$newf")"
  fi
  source "$KEYENV"
  # Sign with the limited key into a file, then send over RPC, so a refusal still has a transaction id.
  limited() { local step="$1" method="$2" args="$3" dep="${4:-0 NEAR}" signed="target/web-test/signed_$1.json"; rm -f "$signed"
    near contract call-function as-transaction "$CONTRACT" "$method" json-args "$args" prepaid-gas '100 Tgas' attached-deposit "$dep" \
      sign-as "$WEB" network-config testnet sign-with-access-key-file "$AGENT_KEY_FILE" save-to-file "$signed" > "target/web-test/sign_$1.log" 2>&1 || true
    if [ -s "$signed" ]; then run_near_py "$step" "$method" "limited key of $WEB" "$signed" "$args"; rm -f "$signed"
    else { echo "\$ near contract call-function as-transaction $CONTRACT $method json-args '$args' attached-deposit '$dep' sign-as $WEB network-config testnet sign-with-access-key-file <limited key file> save-to-file <file>"; filter_private < "target/web-test/sign_$1.log"; } > "$OUTDIR/steps/$step.txt"
      printf '%s\t%s\t%s\t-\t-\t-\tnot signed\t-\n' "$step" "$method" "limited key of $WEB" >> "$OUTDIR/transactions.tsv"
      echo "== $step: not signed: $(grep -i -m1 -E 'error|deposit|not allowed|function call' "target/web-test/sign_$1.log" | cut -c1-200)"; fi; }
  call agentkey_owner_deposit "$WEB" deposit_credit '{"account_id":null}' "0.03 NEAR" "30 Tgas"
  call agentkey_owner_set_limits "$WEB" set_agent_limits "{\"max_fee_per_commit\":\"20000000000000000000000\",\"fixed_payout\":\"$WEB\"}" "1 yoctoNEAR" "30 Tgas"
  note "limits of $WEB: $(view get_agent_limits "{\"account_id\":\"$WEB\"}")"
  PATCH=data/attacks/reject_all.wasm; N=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
  limited agentkey_commit_other_payout commit "{\"bounty_id\":\"$CBOUNTY\",\"fingerprint\":\"$(node scripts/web_fingerprint.mjs "$PATCH" "$RES2" "$N")\",\"payout\":\"$RES2\"}"
  limited agentkey_withdraw_with_deposit withdraw_credit '{"amount":"1"}' "1 yoctoNEAR"
  limited agentkey_withdraw_without_deposit withdraw_credit '{"amount":"1"}'
  limited agentkey_set_limits set_agent_limits '{"max_fee_per_commit":null,"fixed_payout":null}' "1 yoctoNEAR"
  C0=$(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" "")
  limited agentkey_commit commit "{\"bounty_id\":\"$CBOUNTY\",\"fingerprint\":\"$(node scripts/web_fingerprint.mjs "$PATCH" "$WEB" "$N")\",\"payout\":\"$WEB\"}"
  sleep 4
  IDX=$(json_field "$(view get_bounty "{\"bounty_id\":\"$CBOUNTY\"}")" commits); IDX=$((IDX - 1))
  limited agentkey_reveal reveal "{\"bounty_id\":\"$CBOUNTY\",\"index\":$IDX,\"patch\":\"$(base64 -w0 "$PATCH")\",\"nonce\":\"$N\"}"
  S=$(view get_submission "{\"bounty_id\":\"$CBOUNTY\",\"index\":$IDX}")
  note "limited key: commit index $IDX, credit $C0 -> $(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" ""), committer $(json_field "$S" committer), revealed $([ "$(json_field "$S" revealed_at_ns)" != None ] && echo yes || echo no)"
  call agentkey_owner_clear_limits "$WEB" set_agent_limits '{"max_fee_per_commit":null,"fixed_payout":null}' "1 yoctoNEAR" "30 Tgas"
  C=$(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" "")
  [ "$C" != 0 ] && call agentkey_owner_withdraw "$WEB" withdraw_credit "{\"amount\":\"$C\"}" "1 yoctoNEAR" "30 Tgas"
  note "after cleanup: credit $(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" ""), limits $(view get_agent_limits "{\"account_id\":\"$WEB\"}")"
  ;;
credit)
  C0=$(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" "")
  call web_deposit_credit "$WEB" deposit_credit '{"account_id":null}' "0.05 NEAR" "30 Tgas"
  note "deposit_credit 0.05 NEAR: credit $C0 -> $(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" "") yoctoNEAR"
  ;;
attempt)
  PATCH=data/attacks/reject_all.wasm
  N1=$(python3 -c 'import secrets;print(secrets.token_hex(32))'); echo "$N1" > target/web-test/nonce1
  FP1=$(node scripts/web_fingerprint.mjs "$PATCH" "$WEB" "$N1")
  C0=$(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" "")
  call web_commit "$WEB" commit "{\"bounty_id\":\"$TBOUNTY\",\"fingerprint\":\"$FP1\",\"payout\":\"$WEB\"}"
  note "commit: returned $(ret "$(txof web_commit)" "$WEB"), credit $C0 -> $(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" "") yoctoNEAR"
  N2=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
  FP2=$(node scripts/web_fingerprint.mjs "$PATCH" "$WEB" "$N2")
  C1=$(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" "")
  call web_commit_cap_full "$WEB" commit "{\"bounty_id\":\"$TBOUNTY\",\"fingerprint\":\"$FP2\",\"payout\":\"$WEB\"}"
  note "second commit (K = 1): returned $(ret "$(txof web_commit_cap_full)" "$WEB"), credit $C1 -> $(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" "") yoctoNEAR"
  sleep 4
  call web_reveal "$WEB" reveal "{\"bounty_id\":\"$TBOUNTY\",\"index\":0,\"patch\":\"$(base64 -w0 "$PATCH")\",\"nonce\":\"$N1\"}"
  S=$(view get_submission "{\"bounty_id\":\"$TBOUNTY\",\"index\":0}")
  note "reveal: patch_hash matches the file: $([ "$(json_field "$S" patch_hash)" = "$(sha "$PATCH")" ] && echo yes || echo NO), outcome $(json_field "$S" outcome), fingerprint matches the page's: $([ "$(json_field "$S" fingerprint)" = "$FP1" ] && echo yes || echo NO)"
  save FP1 "$FP1"
  ;;
refusals)
  C=$(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" "")
  call web_withdraw_credit "$WEB" withdraw_credit "{\"amount\":\"$C\"}" "1 yoctoNEAR" "30 Tgas"
  note "withdraw_credit $C yoctoNEAR with 1 yoctoNEAR: credit now $(json_field "$(view get_credit "{\"account_id\":\"$WEB\"}")" "")"
  call_expect_fail web_commit_no_credit "$WEB" commit "{\"bounty_id\":\"7\",\"fingerprint\":\"$(python3 -c 'import secrets;print(secrets.token_hex(32))')\",\"payout\":\"$WEB\"}"
  note "commit on bounty 7 with no credit: $(fail_line web_commit_no_credit); bounty 7 commits still $(json_field "$(view get_bounty '{"bounty_id":"7"}')" commits)"
  ;;
close)
  S=$(view get_submission "{\"bounty_id\":\"$TBOUNTY\",\"index\":0}"); DL=$(json_field "$S" deadline_ns)
  while [ "$(now_ns)" -le "$DL" ]; do sleep 5; done
  B0=$(balance "$WEB")
  call web_claim_timeout "$VER3" claim_timeout "{\"bounty_id\":\"$TBOUNTY\",\"index\":0}"
  sleep 5
  note "claim_timeout on test bounty $TBOUNTY: state $(json_field "$(view get_bounty "{\"bounty_id\":\"$TBOUNTY\"}")" state), $WEB +$(python3 -c "print($(balance "$WEB")-$B0)") yoctoNEAR"
  ;;
*) echo "usage: $0 account|bounty|credit|attempt|refusals|close|userbounty|clibounty|agentkey"; exit 2 ;;
esac
