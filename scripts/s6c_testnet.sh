#!/usr/bin/env bash
# Spike S6c on NEAR testnet: the bounty contract with a Level 2 path (Groth16 proofs checked by the contract itself),
# deployed to a NEW throwaway faucet account. Not the S13 contract and not the S6b spike. Testnet only.
# Phases, in order:
#   setup     create the account, deploy, register three verifiers (for the Level 0 check), give researchers credit
#   level0    a Level 0 bounty still opens with two verifier attestations of Proof 0 (the old path keeps working)
#   bounty_a  Level 2 bounty A: create, open with the Groth16 Proof 0 (the demo's, image id dd6c5f42...), then
#             attempt A0 (the honest fix, researcher 1) and attempt A1 (reject_all.wasm, researcher 2): commit, reveal;
#             the vendor's post_verdict on a Level 2 bounty must be refused
#   prove_a1  prove A1 (expected FAIL), compress to succinct, then to Groth16 (memory watched), extract the values
#   prove_a0  the same for A0 (expected PASS)
#   attacks   the attack list (another attempt, FAIL as PASS, flipped bit, changed journal, wrong image id, another
#             bounty, second submission, after expiry), the real FAIL and PASS decisions, timeout and fee rules
#   redeploy  deploy the protocol fee pool version (no state change: the pool is its own storage entry)
#   selfblock the vendor blocks its own Level 2 bounty: a second account it funds takes all K slots with commits it
#             never reveals; an honest commit is ignored; the never-revealed fees go to the pool, not back to the vendor
# Usage, from the repo root: ./scripts/s6c_testnet.sh <phase>. State: docs/evidence/S6c/run.env.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/S6c; mkdir -p "$OUTDIR/steps" target/s6c
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
export OUT="$OUTDIR" CONTRACT="${S6C_CONTRACT:-none}"
source scripts/s3_lib.sh
# After s3_lib.sh, whose default vendor name (vendor.<contract>) this file replaces with the S3b vendor account.
source docs/evidence/S3b/accounts.env
SEC=1000000000
HOST=./target/release/kintsugi-host
W=target/near/kintsugi_contract/kintsugi_contract.wasm
P0_ARGS=target/s6b/args.json                       # Groth16 Proof 0 of the demo bounty (kintsugi-host groth16-args)
P0_SUCCINCT=target/demo/proof0_succinct.bin         # the same Proof 0, succinct, for the Level 0 verifiers
P0_JOURNAL=fb7939dca90136238fdc24bc38f077c11c4adae332cd0392611a12797f423ec5
P0_RECEIPT=$(sha256sum "$P0_SUCCINCT" | cut -d' ' -f1)
IMAGE=dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
OTHER_IMAGE=043ec633f68431f51b99cacd6a460560647a15916cdd0cb58762b61f9ede7f8d
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
note() { echo "$*" | tee -a "$OUTDIR/summary.txt"; }
fp_for() { python3 - "$1" "$2" "$3" <<'PY'
import hashlib, sys
patch = open(sys.argv[1], 'rb').read(); payout = sys.argv[2].encode(); nonce = bytes.fromhex(sys.argv[3])
print(hashlib.sha256(b"kintsugi-commit-v1" + len(patch).to_bytes(4, "little") + patch + len(payout).to_bytes(4, "little") + payout + nonce).hexdigest())
PY
}
nonce() { python3 -c 'import secrets; print(secrets.token_hex(32))'; }
# create <step> <level> <image id> <verdict window s> <expiry s> <reveal window s>; prints the bounty id
create() {
  local id; id=$(json_field "$(view get_next_bounty_id '{}')" "")
  call "$1" "$VENDOR" create_bounty "{\"original_hash\":\"$(sha data/demo/original.wasm)\",\"corpus_hash\":\"736d160dceba2ce955097aa39072a365f38abe59b7ffec61524dcfd021a1e61b\",\"image_id\":\"$3\",\"exploit_commitment\":\"9a1be994ab379a76d3f154df1fbde561695377a989c8db432dd1092a09966387\",\"proof0_receipt_hash\":\"$P0_RECEIPT\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( $4 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( $5 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha data/demo/fixed.wasm)\",\"proof0_journal_hash\":\"$P0_JOURNAL\",\"reveal_window_ns\":\"$(( $6 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":$2}" "0.1 NEAR" >&2
  [ "$(view get_bounty "{\"bounty_id\":\"$id\"}")" != "null" ] || { echo "create_bounty failed" >&2; exit 1; }
  echo "$id"
}
commit_reveal() { # commit_reveal <prefix> <bounty> <account> <patch file>; prints index
  local n f idx; n=$(nonce); f=$(fp_for "$4" "$3" "$n")
  idx=$(json_field "$(view get_bounty "{\"bounty_id\":\"$2\"}")" commits)
  call "${1}_commit" "$3" commit "{\"bounty_id\":\"$2\",\"fingerprint\":\"$f\",\"payout\":\"$3\"}" >&2
  sleep 4
  call "${1}_reveal" "$3" reveal "{\"bounty_id\":\"$2\",\"index\":$idx,\"patch\":\"$(base64 -w0 "$4")\",\"nonce\":\"$n\"}" >&2
  echo "$idx"
}
wait_past() { local t="$1"; while [ "$(curl -4 -s --max-time 60 "$RPC" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"t","method":"block","params":{"finality":"final"}}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["header"]["timestamp_nanosec"])')" -le "$t" ]; do sleep 5; done; }
# proof_args <args.json> <variant>: the seal and journal (base64) of a Groth16 receipt, as given or changed:
#   real | flipped (lowest bit of the last seal byte) | fuzz (journal fuzz_count + 1) | as_pass (journal verdict set to PASS)
proof_args() { python3 -I - "$1" "$2" <<'PY'
import base64, json, sys
d = json.load(open(sys.argv[1])); v = sys.argv[2]
seal = bytearray.fromhex(d["seal"]); journal = bytearray.fromhex(d["journal"])
if v == "flipped": seal[255] ^= 1
elif v == "fuzz": journal[160 * 4] += 1
elif v == "as_pass": journal[194 * 4] = 1
print(json.dumps({"seal": base64.b64encode(seal).decode(), "journal": base64.b64encode(journal).decode()})[1:-1])
PY
}
submit() { # submit <step> <bounty> <index> <args.json> <variant> [expect_fail]
  local a; a="{\"bounty_id\":\"$2\",\"index\":$3,$(proof_args "$4" "$5")}"
  if [ "${6:-}" = expect_fail ]; then call_expect_fail "$1" "$RES2" submit_groth16 "$a"; else call "$1" "$RES2" submit_groth16 "$a" "0 NEAR" "300 Tgas"; fi
}
open_l2() { call "$1" "$RES2" open_with_groth16 "{\"bounty_id\":\"$2\",$(proof_args "$P0_ARGS" real)}" "0 NEAR" "300 Tgas"; }
outcome() { json_field "$(view get_submission "{\"bounty_id\":\"$1\",\"index\":$2}")" outcome; }
prove() { # prove <name> <patch> <seed> <submission id>
  MAX_SECONDS=10800 scripts/s2_measure.sh "target/s6c/prove_$1.log" -- $HOST prove "$2" --fuzz-count 16 --variants 32 --po2 19 \
    --seed "$3" --submission-id "$4" --out "target/s6c/$1.bin"
  MAX_SECONDS=3600 scripts/s2_measure.sh "target/s6c/compress_$1.log" -- $HOST compress "target/s6c/$1.bin" "target/s6c/$1_succinct.bin" succinct
  rm -f "target/s6c/mem_$1.log"*; (target/s6/watch_mem.sh "target/s6c/mem_$1.log" & echo $! > "target/s6c/watch_$1.pid")
  MIN_AVAIL_MIB=700 MAX_SECONDS=3600 scripts/s2_measure.sh "target/s6c/groth16_$1.log" -- $HOST compress "target/s6c/$1_succinct.bin" "target/s6c/$1_groth16.bin" groth16 || true
  kill "$(cat "target/s6c/watch_$1.pid")" 2>/dev/null || true
  $HOST verify "target/s6c/$1_groth16.bin" > "target/s6c/verify_$1.txt"
  grep -q '^VALID' "target/s6c/verify_$1.txt" || { echo "the $1 Groth16 receipt does not verify"; exit 1; }
  $HOST groth16-args "target/s6c/$1_groth16.bin" "target/s6c/$1_args.json"
}

case "${1:-}" in
setup)
  if [ "$CONTRACT" = none ]; then
    acct="kintsugi-l2-$(python3 -c 'import secrets, string; print("".join(secrets.choice(string.ascii_lowercase) for _ in range(5)))').testnet"
    run_near create_s6c_account create-account faucet account create-account sponsor-by-faucet-service "$acct" \
      autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
    save S6C_CONTRACT "$acct"; export CONTRACT="$acct"
  fi
  { echo "wasm_bytes=$(stat -c %s "$W")"; echo "wasm_sha256=$(sha "$W")"; } | tee "$OUTDIR/contract_wasm.txt"
  run_near deploy deploy+new "$CONTRACT" contract deploy "$CONTRACT" use-file "$W" with-init-call new \
    json-args "{\"owner\":\"$CONTRACT\"}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
  for v in "$VER1" "$VER2" "$VER3"; do call "register_${v%%.*}" "$CONTRACT" register_verifier "{\"account_id\":\"$v\",\"label\":\"S6c test verifier run by the project\"}"; done
  call credit_r1 "$RES1" deposit_credit '{}' "0.2 NEAR"; call credit_r2 "$RES2" deposit_credit '{}' "0.2 NEAR"
  ;;
level0)
  L0=$(create l0_create 0 "$IMAGE" 7200 86400 900); save BOUNTY_L0 "$L0"
  for v in "$VER1" "$VER2"; do
    scripts/verifier_check.sh proof0 "$CONTRACT" "$L0" "$P0_SUCCINCT" > "$OUTDIR/steps/l0_proof0_check_${v%%.*}.txt"
    call "l0_attest_proof0_${v%%.*}" "$v" attest_proof0 "{\"bounty_id\":\"$L0\",\"journal_hash\":\"$P0_JOURNAL\",\"receipt_hash\":\"$P0_RECEIPT\"}"
  done
  note "Level 0 bounty $L0: level $(json_field "$(view get_bounty "{\"bounty_id\":\"$L0\"}")" level), opened $(json_field "$(view get_bounty "{\"bounty_id\":\"$L0\"}")" opened)"
  ;;
bounty_a)
  BA=$(create a_create 2 "$IMAGE" 43200 172800 3600); save BOUNTY_A "$BA"
  open_l2 a_open_groth16 "$BA"
  note "bounty A $BA: level $(json_field "$(view get_bounty "{\"bounty_id\":\"$BA\"}")" level), opened $(json_field "$(view get_bounty "{\"bounty_id\":\"$BA\"}")" opened)"
  call_expect_fail a_attest_proof0_refused "$VER1" attest_proof0 "{\"bounty_id\":\"$BA\",\"journal_hash\":\"$P0_JOURNAL\",\"receipt_hash\":\"$P0_RECEIPT\"}"
  I0=$(commit_reveal a0 "$BA" "$RES1" data/demo/fixed.wasm); save INDEX_A0 "$I0"
  I1=$(commit_reveal a1 "$BA" "$RES2" data/attacks/reject_all.wasm); save INDEX_A1 "$I1"
  for i in "$I0" "$I1"; do
    save "SEED_A$i" "$(json_field "$(view get_submission "{\"bounty_id\":\"$BA\",\"index\":$i}")" seed)"
    save "SID_A$i" "$(json_field "$(view get_submission_id "{\"bounty_id\":\"$BA\",\"index\":$i}")" "")"
  done
  call_expect_fail a_post_verdict_refused "$VENDOR" post_verdict "{\"bounty_id\":\"$BA\",\"index\":$I0,\"verdict\":\"PASS\",\"journal_hash\":\"$P0_JOURNAL\",\"receipt_hash\":\"$P0_RECEIPT\"}"
  ;;
prove_a1) prove a1 data/attacks/reject_all.wasm "$SEED_A1" "$SID_A1" ;;
prove_a0) prove a0 data/demo/fixed.wasm "$SEED_A0" "$SID_A0" ;;
attacks)
  A0J=target/s6c/a0_args.json; A1J=target/s6c/a1_args.json
  # Each refused call is broadcast and recorded with its error (call_expect_fail).
  submit atk_other_attempt "$BOUNTY_A" "$INDEX_A1" "$A0J" real expect_fail        # A0's PASS proof for attempt A1
  submit atk_fail_as_pass "$BOUNTY_A" "$INDEX_A1" "$A1J" as_pass expect_fail      # A1's FAIL journal edited to PASS
  submit atk_flipped_seal_bit "$BOUNTY_A" "$INDEX_A0" "$A0J" flipped expect_fail  # one bit of A0's seal
  submit atk_changed_journal "$BOUNTY_A" "$INDEX_A0" "$A0J" fuzz expect_fail      # A0's journal, fuzz_count + 1
  BD=$(create d_create 2 "$OTHER_IMAGE" 3600 86400 900); save BOUNTY_D "$BD"   # a bounty naming another image id
  call_expect_fail atk_wrong_image_id "$RES2" open_with_groth16 "{\"bounty_id\":\"$BD\",$(proof_args "$P0_ARGS" real)}"
  submit a1_fail "$BOUNTY_A" "$INDEX_A1" "$A1J" real                               # the real FAIL: attempt spent
  note "A1 outcome after its FAIL proof: $(outcome "$BOUNTY_A" "$INDEX_A1")"
  submit atk_fail_second_submission "$BOUNTY_A" "$INDEX_A1" "$A1J" real expect_fail
  BB=$(create b_create 2 "$IMAGE" 3600 86400 900); save BOUNTY_B "$BB"
  open_l2 b_open_groth16 "$BB"
  IB=$(commit_reveal b0 "$BB" "$RES1" data/demo/fixed.wasm); save INDEX_B0 "$IB"
  submit atk_other_bounty "$BB" "$IB" "$A0J" real expect_fail                       # A0's proof for B's attempt
  B0=$(balance "$RES1")
  submit a0_pass "$BOUNTY_A" "$INDEX_A0" "$A0J" real; sleep 6                       # the real PASS: researcher paid
  note "A0 outcome after its PASS proof: $(outcome "$BOUNTY_A" "$INDEX_A0"); bounty A state $(json_field "$(view get_bounty "{\"bounty_id\":\"$BOUNTY_A\"}")" state); researcher 1 balance change $(python3 -c "print($(balance "$RES1")-$B0)") yoctoNEAR (0.1 NEAR bounty + own 0.01 NEAR fee expected)"
  submit atk_second_submission "$BOUNTY_A" "$INDEX_A0" "$A0J" real expect_fail
  BC=$(create c_create 2 "$IMAGE" 20 75 30); save BOUNTY_C "$BC"                   # expires 75 s after creation
  open_l2 c_open_groth16 "$BC"
  IC=$(commit_reveal c0 "$BC" "$RES1" data/demo/fixed.wasm); save INDEX_C0 "$IC"
  wait_past "$(json_field "$(view get_bounty "{\"bounty_id\":\"$BC\"}")" expires_at_ns)"
  submit atk_after_expiry "$BC" "$IC" "$A0J" real expect_fail
  call c_claim_timeout "$RES2" claim_timeout "{\"bounty_id\":\"$BC\",\"index\":$IC}"   # no proof came: researcher paid
  V0=$(balance "$VENDOR")
  call c_expire "$RES2" expire "{\"bounty_id\":\"$BC\"}"; sleep 6
  note "bounty C after timeout and expire: $(view get_bounty "{\"bounty_id\":\"$BC\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ("state","level","fees_collected","fees_swept")})'); vendor balance change $(python3 -c "print($(balance "$VENDOR")-$V0)") yoctoNEAR (C's fee 0.01 NEAR expected; Level 2 fees go to the vendor)"
  ;;
redeploy)
  { echo "wasm_bytes=$(stat -c %s "$W")"; echo "wasm_sha256=$(sha "$W")"; } | tee "$OUTDIR/contract_wasm_pool.txt"
  run_near redeploy_pool deploy "$CONTRACT" contract deploy "$CONTRACT" use-file "$W" without-init-call \
    network-config testnet sign-with-legacy-keychain send
  note "after redeploy: bounty A state $(json_field "$(view get_bounty "{\"bounty_id\":\"$BOUNTY_A\"}")" state), pool $(json_field "$(view get_protocol_pool '{}')" "") yoctoNEAR"
  ;;
selfblock)
  SYB="sybil.$VENDOR"
  BS=$(create s_create 2 "$IMAGE" 60 240 60); save BOUNTY_S "$BS"           # K = 3, reveal window 60 s, expires after 240 s
  call s_open_groth16 "$VENDOR" open_with_groth16 "{\"bounty_id\":\"$BS\",$(proof_args "$P0_ARGS" real)}" "0 NEAR" "300 Tgas"
  V0=$(balance "$VENDOR"); P0=$(json_field "$(view get_protocol_pool '{}')" ""); save SB_V0 "$V0"; save SB_P0 "$P0"
  note "self-block start: vendor balance $V0, pool $P0 yoctoNEAR"
  [ "$(balance "$SYB")" != "missing" ] || run_near s_create_sybil create-account "$VENDOR" account create-account fund-myself "$SYB" '0.05 NEAR' \
    autogenerate-new-keypair save-to-legacy-keychain sign-as "$VENDOR" network-config testnet sign-with-legacy-keychain send
  call s_vendor_funds_sybil_credit "$VENDOR" deposit_credit "{\"account_id\":\"$SYB\"}" "0.045 NEAR"   # exactly the three fees
  for i in 0 1 2; do
    call "s_sybil_junk_commit_$i" "$SYB" commit "{\"bounty_id\":\"$BS\",\"fingerprint\":\"$(nonce)\",\"payout\":\"$SYB\"}"
  done
  n=$(nonce); call s_honest_commit_ignored "$RES1" commit "{\"bounty_id\":\"$BS\",\"fingerprint\":\"$(fp_for data/demo/fixed.wasm "$RES1" "$n")\",\"payout\":\"$RES1\"}"
  note "after the honest commit: commits $(json_field "$(view get_bounty "{\"bounty_id\":\"$BS\"}")" commits), active $(json_field "$(view get_bounty "{\"bounty_id\":\"$BS\"}")" active)"
  wait_past $(( $(json_field "$(view get_submission "{\"bounty_id\":\"$BS\",\"index\":0}")" committed_at_ns) + 61 * SEC ))
  call s_release_unrevealed_0 "$RES2" release_unrevealed "{\"bounty_id\":\"$BS\",\"index\":0}"
  note "after release_unrevealed(0): pool $(json_field "$(view get_protocol_pool '{}')" "")"
  wait_past "$(json_field "$(view get_bounty "{\"bounty_id\":\"$BS\"}")" expires_at_ns)"
  call s_expire "$RES2" expire "{\"bounty_id\":\"$BS\"}"; sleep 8
  V1=$(balance "$VENDOR"); P1=$(json_field "$(view get_protocol_pool '{}')" ""); SY=$(balance "$SYB")
  CR=$(json_field "$(view get_credit "{\"account_id\":\"$SYB\"}")" "")
  python3 -I - "$OUTDIR/transactions.tsv" "$VENDOR" "$SYB" "$RPC" "$V0" "$V1" "$P0" "$P1" "$SY" "$CR" <<'PY' | tee "$OUTDIR/selfblock_balances.txt"
import csv, json, sys, urllib.request
tsv, vendor, syb, rpc = sys.argv[1:5]; v0, v1, p0, p1, sy, cr = (int(x) for x in sys.argv[5:11])
def burnt(tx, sender):
    req = {"jsonrpc": "2.0", "id": 1, "method": "EXPERIMENTAL_tx_status", "params": {"tx_hash": tx, "sender_account_id": sender, "wait_until": "FINAL"}}
    d = json.load(urllib.request.urlopen(urllib.request.Request(rpc, json.dumps(req).encode(), {"Content-Type": "application/json"})))["result"]
    return sum(int(o["outcome"]["tokens_burnt"]) for o in [d["transaction_outcome"]] + d["receipts_outcome"])
rows = [r for r in csv.DictReader(open(tsv), delimiter="\t") if r["step"].startswith("s_") and r["step"] not in ("s_create", "s_open_groth16") and r["tx_hash"] not in ("", "-")]
gas_v = sum(burnt(r["tx_hash"], vendor) for r in rows if r["signer"] == vendor)
gas_s = sum(burnt(r["tx_hash"], syb) for r in rows if r["signer"] == syb)
N = 10**24
print(f"vendor balance before the block {v0/N:.6f} NEAR, after {v1/N:.6f} NEAR, change {(v1-v0)/N:+.6f} NEAR")
print(f"  of which: bounty refunded at expiry +0.100000; sybil account funded -0.050000 (still held by sybil: {sy/N:.6f}); credit for the three attempt fees -0.045000; gas of the vendor's own transactions in the block -{gas_v/N:.6f} (tokens burnt, from the RPC)")
print(f"  check: 0.1 - 0.05 - 0.045 - gas = {(10**23 - 5*10**22 - 45*10**21 - gas_v)/N:+.6f} NEAR (difference from the measured change: {((v1-v0) - (10**23 - 5*10**22 - 45*10**21 - gas_v))/N:+.6f}; storage refunds and rounding)")
print(f"  sybil account gas for its three commits: {gas_s/N:.6f} NEAR; its unspent credit left in the contract: {cr/N:.6f} NEAR")
print(f"vendor side in total (vendor + sybil + sybil credit), not counting the refunded bounty: lost attempt fees 0.045000 NEAR + gas {(gas_v+gas_s)/N:.6f} NEAR")
print(f"protocol fee pool before {p0/N:.6f}, after {p1/N:.6f}, gained {(p1-p0)/N:.6f} NEAR (the three attempt fees: 0.01 + 0.015 + 0.02 = 0.045)")
PY
  ;;
selfblock2)
  # Second run of the self-block test (the first one stopped before any junk commit: the second account had too
  # little NEAR for near-cli's cost check). Everything below is measured: vendor balance, the second account's
  # balance and credit, the pool.
  SYB="sybil.$VENDOR"
  BS=$(create s2_create 2 "$IMAGE" 60 240 60); save BOUNTY_S2 "$BS"
  call s2_open_groth16 "$VENDOR" open_with_groth16 "{\"bounty_id\":\"$BS\",$(proof_args "$P0_ARGS" real)}" "0 NEAR" "300 Tgas"
  V0=$(balance "$VENDOR"); S0=$(balance "$SYB"); C0=$(json_field "$(view get_credit "{\"account_id\":\"$SYB\"}")" ""); P0=$(json_field "$(view get_protocol_pool '{}')" "")
  note "self-block run 2 start: vendor $V0, sybil $S0, sybil credit $C0, pool $P0 yoctoNEAR"
  run_near s2_vendor_tops_up_sybil send-near "$VENDOR" tokens "$VENDOR" send-near "$SYB" '0.2 NEAR' network-config testnet sign-with-legacy-keychain send
  for i in 0 1 2; do
    call "s2_sybil_junk_commit_$i" "$SYB" commit "{\"bounty_id\":\"$BS\",\"fingerprint\":\"$(nonce)\",\"payout\":\"$SYB\"}"
  done
  n=$(nonce); call s2_honest_commit_ignored "$RES1" commit "{\"bounty_id\":\"$BS\",\"fingerprint\":\"$(fp_for data/demo/fixed.wasm "$RES1" "$n")\",\"payout\":\"$RES1\"}"
  note "after the honest commit: commits $(json_field "$(view get_bounty "{\"bounty_id\":\"$BS\"}")" commits), active $(json_field "$(view get_bounty "{\"bounty_id\":\"$BS\"}")" active)"
  wait_past $(( $(json_field "$(view get_submission "{\"bounty_id\":\"$BS\",\"index\":0}")" committed_at_ns) + 61 * SEC ))
  call s2_release_unrevealed_0 "$RES2" release_unrevealed "{\"bounty_id\":\"$BS\",\"index\":0}"
  note "after release_unrevealed(0): pool $(json_field "$(view get_protocol_pool '{}')" "")"
  wait_past "$(json_field "$(view get_bounty "{\"bounty_id\":\"$BS\"}")" expires_at_ns)"
  call s2_expire "$RES2" expire "{\"bounty_id\":\"$BS\"}"; sleep 8
  V1=$(balance "$VENDOR"); S1=$(balance "$SYB"); C1=$(json_field "$(view get_credit "{\"account_id\":\"$SYB\"}")" ""); P1=$(json_field "$(view get_protocol_pool '{}')" "")
  python3 -I - "$OUTDIR/transactions.tsv" "$VENDOR" "$SYB" "$RPC" "$V0" "$V1" "$S0" "$S1" "$C0" "$C1" "$P0" "$P1" <<'PY' | tee "$OUTDIR/selfblock2_balances.txt"
import csv, json, sys, urllib.request
tsv, vendor, syb, rpc = sys.argv[1:5]; v0, v1, s0, s1, c0, c1, p0, p1 = (int(x) for x in sys.argv[5:13])
def burnt(tx, sender):
    req = {"jsonrpc": "2.0", "id": 1, "method": "EXPERIMENTAL_tx_status", "params": {"tx_hash": tx, "sender_account_id": sender, "wait_until": "FINAL"}}
    d = json.load(urllib.request.urlopen(urllib.request.Request(rpc, json.dumps(req).encode(), {"Content-Type": "application/json"})))["result"]
    return sum(int(o["outcome"]["tokens_burnt"]) for o in [d["transaction_outcome"]] + d["receipts_outcome"])
rows = [r for r in csv.DictReader(open(tsv), delimiter="\t") if r["step"].startswith("s2_") and r["step"] not in ("s2_create", "s2_open_groth16") and r["tx_hash"] not in ("", "-")]
gas_v = sum(burnt(r["tx_hash"], vendor) for r in rows if r["signer"] == vendor)
gas_s = sum(burnt(r["tx_hash"], syb) for r in rows if r["signer"] == syb)
N = 10**24; refund = 10**23
held0, held1 = v0 + s0 + c0, v1 + s1 + c1
print(f"vendor {v0/N:.6f} -> {v1/N:.6f}; sybil {s0/N:.6f} -> {s1/N:.6f}; sybil credit {c0/N:.6f} -> {c1/N:.6f} NEAR")
print(f"held by the vendor side (vendor + sybil + sybil credit): {held0/N:.6f} -> {held1/N:.6f}, change {(held1-held0)/N:+.6f} NEAR")
print(f"  = bounty refunded at expiry +{refund/N:.6f} - attempt fees {(c0-c1)/N:.6f} (credit spent) - gas {(gas_v+gas_s)/N:.6f} (vendor {gas_v/N:.6f}, sybil {gas_s/N:.6f}; tokens burnt, from the RPC)")
print(f"  check: {(refund - (c0-c1) - gas_v - gas_s)/N:+.6f} computed against {(held1-held0)/N:+.6f} measured, difference {((held1-held0) - (refund - (c0-c1) - gas_v - gas_s))/N:+.6f} NEAR")
print(f"vendor side lost, not counting the bounty it got back: attempt fees {(c0-c1)/N:.6f} + gas {(gas_v+gas_s)/N:.6f} NEAR")
print(f"protocol fee pool {p0/N:.6f} -> {p1/N:.6f}, gained {(p1-p0)/N:.6f} NEAR; equal to the attempt fees the vendor side spent: {p1-p0 == c0-c1}")
PY
  ;;
*) echo "usage: $0 setup|level0|bounty_a|prove_a1|prove_a0|attacks|redeploy|selfblock|selfblock2"; exit 2 ;;
esac
