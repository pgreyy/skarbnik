#!/usr/bin/env bash
# Spike S13, attack pass on NEAR testnet, against the hardened contract on a fresh faucet account.
# Phases (run in order): setup, proof0, open, commit_a, prove_a, attack_a, bounty_b, misc, report.
#   setup     create the contract account (faucet), deploy, register three verifiers, give researchers credit
#   proof0    prove Proof 0 with the vendor's reference fix (data/demo/fixed.wasm), compress it
#   open      bounty A: create (closed), commit before open (must fail), verifiers check Proof 0 and attest, opens
#   commit_a  researcher 1 commits and reveals the honest patch on bounty A
#   prove_a   the vendor proves researcher 1's submission and compresses it
#   attack_a  (11) the vendor posts FAIL for that passing fix; (5) a swapped journal hash; verifiers check and
#             refuse; after the windows the researcher claims the timeout and is paid
#   bounty_b  bounty B: (4) the vendor replays bounty A's receipt on a new submission; (9) a receipt for another
#             program id; verifiers refuse; (8) early and late timeout and expire
#   misc      (2) junk commits fill K, (3) sub-accounts do not add slots, release of unrevealed junk frees a slot;
#             (6) attestation by an unregistered account; (7) the same verifier twice; (10) a reveal that does not
#             match its commit
# Usage, from the repo root: ./scripts/s13_attacks.sh <phase>. Testnet only. State: docs/evidence/S13/run.env.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/S13; mkdir -p "$OUTDIR/steps" target/s13
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
export OUT="$OUTDIR" CONTRACT="${S13_CONTRACT:-none}"
source scripts/s3_lib.sh
# After s3_lib.sh, whose default vendor name (vendor.<contract>) this file replaces with the S3b vendor account.
source docs/evidence/S3b/accounts.env
SEC=1000000000
HOST=./target/release/skarbnik-host
SEED_P0=6b696e74737567692053312064656d6f207365656420412e2e2e2e2e2e2e2e21
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
create() { # create <step> <verdict window s> <attest window s> <expiry s> <reveal window s>; prints id
  local id; id=$(json_field "$(view get_next_bounty_id '{}')" "")
  call "$1" "$VENDOR" create_bounty "{\"original_hash\":\"$(sha data/demo/original.wasm)\",\"corpus_hash\":\"$CORPUS\",\"image_id\":\"$IMAGE\",\"exploit_commitment\":\"$EXPLOIT\",\"proof0_receipt_hash\":\"$P0_RECEIPT\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( $2 * SEC ))\",\"attest_window_ns\":\"$(( $3 * SEC ))\",\"expiry_ns\":\"$(( $4 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(sha data/demo/fixed.wasm)\",\"proof0_journal_hash\":\"$P0_JOURNAL\",\"reveal_window_ns\":\"$(( $5 * SEC ))\"}" "0.5 NEAR" >&2
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
now_ns() { curl -4 -s --max-time 60 "$RPC" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"t","method":"block","params":{"finality":"final"}}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["header"]["timestamp_nanosec"])'; }

case "${1:-}" in
setup)
  if [ "${S13_CONTRACT:-none}" = none ]; then
    suffix=$(python3 -c 'import secrets, string; print("".join(secrets.choice(string.ascii_lowercase) for _ in range(5)))')
    acct="kintsugi-s13-$suffix.testnet"
    run_near create_s13_contract_account create-account faucet account create-account sponsor-by-faucet-service "$acct" \
      autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
    save S13_CONTRACT "$acct"; export CONTRACT="$acct"
  fi
  W=target/near/kintsugi_contract/kintsugi_contract.wasm
  { echo "wasm_bytes=$(stat -c %s "$W")"; echo "wasm_sha256=$(sha "$W")"; } | tee "$OUTDIR/contract_wasm.txt"
  run_near deploy deploy+new "$CONTRACT" contract deploy "$CONTRACT" use-file "$W" with-init-call new \
    json-args "{\"owner\":\"$CONTRACT\"}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
  for v in "$VER1" "$VER2" "$VER3"; do call "register_${v%%.*}" "$CONTRACT" register_verifier "{\"account_id\":\"$v\",\"label\":\"S13 test verifier run by the project\"}"; done
  call credit_r1 "$RES1" deposit_credit '{}' "0.2 NEAR"; call credit_r2 "$RES2" deposit_credit '{}' "0.2 NEAR"
  ;;
proof0)
  MAX_SECONDS=10800 scripts/s2_measure.sh target/s13/prove_proof0.log -- $HOST prove data/demo/fixed.wasm --proof0 --demo-salt \
    --fuzz-count 16 --variants 32 --po2 19 --seed "$SEED_P0" --out target/s13/proof0.bin
  MAX_SECONDS=3600 scripts/s2_measure.sh target/s13/compress_proof0.log -- $HOST compress target/s13/proof0.bin target/s13/proof0_succinct.bin succinct
  V=$($HOST verify target/s13/proof0_succinct.bin); echo "$V" > target/s13/verify_proof0.txt
  grep -q '^VALID' <<<"$V" || { echo "Proof 0 receipt does not verify"; exit 1; }
  save IMAGE "$(sed -n 's/^image id: //p' <<<"$V")"; save P0_JOURNAL "$(sed -n 's/^journal sha256: //p' <<<"$V")"
  save P0_RECEIPT "$(sha target/s13/proof0_succinct.bin)"; save EXPLOIT "$(sed -n 's/^journal.exploit_commitment: //p' <<<"$V")"
  save CORPUS "$(sed -n 's/^journal.corpus_hash: //p' <<<"$V")"
  ;;
open)
  # (1) an unfixable bounty: a 300 byte secret (over the 256 byte input limit) makes every patch fail. Proof 0 with
  # the reference fix now refuses it, so no honest verifier could attest it and such a bounty never opens.
  python3 -c 'print("03" * 300)' > target/s13/overlong_exploit.hex
  { echo '$ target/debug/skarbnik-check proof0 --exploit target/s13/overlong_exploit.hex --reference-fix data/demo/fixed.wasm --seed <S1 seed> --fuzz-count 16 --variants 32'
    ./target/debug/skarbnik-check proof0 --exploit target/s13/overlong_exploit.hex --reference-fix data/demo/fixed.wasm --seed "$SEED_P0" --fuzz-count 16 --variants 32; echo "exit=$?"
    echo '$ target/debug/skarbnik-check proof0 --reference-fix data/demo/fixed.wasm --seed <S1 seed> --fuzz-count 16 --variants 32   (the real secret)'
    ./target/debug/skarbnik-check proof0 --reference-fix data/demo/fixed.wasm --seed "$SEED_P0" --fuzz-count 16 --variants 32; echo "exit=$?"
  } > "$OUTDIR/atk1_unfixable_native.txt" 2>&1 || true
  note "atk1 native Proof 0: $(grep -E '^proof0:|^reason' "$OUTDIR/atk1_unfixable_native.txt" | tr '\n' ' ')"
  BA=$(create a_create 7200 900 21600 900); save BOUNTY_A "$BA"
  n=$(nonce); call_expect_fail atk1_commit_before_open "$RES1" commit "{\"bounty_id\":\"$BA\",\"fingerprint\":\"$(fp_for data/demo/fixed.wasm "$RES1" "$n")\",\"payout\":\"$RES1\"}"
  for v in "$VER1" "$VER2"; do
    if scripts/verifier_check.sh proof0 "$CONTRACT" "$BA" target/s13/proof0_succinct.bin > "$OUTDIR/steps/proof0_check_${v%%.*}.txt"; then
      call "a_attest_proof0_${v%%.*}" "$v" attest_proof0 "{\"bounty_id\":\"$BA\",\"journal_hash\":\"$P0_JOURNAL\",\"receipt_hash\":\"$P0_RECEIPT\"}"
    else note "verifier ${v%%.*} refused Proof 0"; fi
  done
  note "bounty A opened: $(json_field "$(view get_bounty "{\"bounty_id\":\"$BA\"}")" opened)"
  ;;
commit_a)
  IA=$(commit_reveal a_r1 "$BOUNTY_A" "$RES1" data/demo/fixed.wasm); save INDEX_A "$IA"
  SUB=$(view get_submission "{\"bounty_id\":\"$BOUNTY_A\",\"index\":$IA}")
  save SEED_A "$(json_field "$SUB" seed)"; save SID_A "$(json_field "$(view get_submission_id "{\"bounty_id\":\"$BOUNTY_A\",\"index\":$IA}")" "")"
  ;;
prove_a)
  MAX_SECONDS=10800 scripts/s2_measure.sh target/s13/prove_a.log -- $HOST prove data/demo/fixed.wasm --demo-salt --fuzz-count 16 \
    --variants 32 --po2 19 --seed "$SEED_A" --submission-id "$SID_A" --out target/s13/a.bin
  MAX_SECONDS=3600 scripts/s2_measure.sh target/s13/compress_a.log -- $HOST compress target/s13/a.bin target/s13/a_succinct.bin succinct
  V=$($HOST verify target/s13/a_succinct.bin); echo "$V" > target/s13/verify_a.txt
  grep -q '^VALID' <<<"$V" || { echo "receipt A does not verify"; exit 1; }
  save A_JOURNAL "$(sed -n 's/^journal sha256: //p' <<<"$V")"; save A_RECEIPT "$(sha target/s13/a_succinct.bin)"
  ;;
attack_a)
  # (11) vendor posts FAIL for a fix whose real receipt says PASS
  call atk11_vendor_posts_fail "$VENDOR" post_verdict "{\"bounty_id\":\"$BOUNTY_A\",\"index\":$INDEX_A,\"verdict\":\"FAIL\",\"journal_hash\":\"$A_JOURNAL\",\"receipt_hash\":\"$A_RECEIPT\"}"
  for v in "$VER1" "$VER2"; do
    if scripts/verifier_check.sh submission "$CONTRACT" "$BOUNTY_A" "$INDEX_A" target/s13/a_succinct.bin > "$OUTDIR/steps/atk11_check_${v%%.*}.txt"; then note "UNEXPECTED: ${v%%.*} would attest"; else note "atk11: ${v%%.*} refuses ($(grep -c '^FAIL' "$OUTDIR/steps/atk11_check_${v%%.*}.txt") failed checks)"; fi
  done
  # (5) a dishonest verifier tries to attest PASS with the real hashes: the contract requires the posted verdict
  call_expect_fail atk5_attest_pass_against_posted_fail "$VER3" attest "{\"bounty_id\":\"$BOUNTY_A\",\"index\":$INDEX_A,\"verdict\":\"PASS\",\"journal_hash\":\"$A_JOURNAL\",\"receipt_hash\":\"$A_RECEIPT\"}"
  call_expect_fail atk8_timeout_early "$RES1" claim_timeout "{\"bounty_id\":\"$BOUNTY_A\",\"index\":$INDEX_A}"
  P=$(json_field "$(view get_submission "{\"bounty_id\":\"$BOUNTY_A\",\"index\":$INDEX_A}")" verdict_posted_at_ns)
  wait_past $(( P + 900 * SEC ))
  B0=$(balance "$RES1"); call atk11_researcher_claims_timeout "$RES2" claim_timeout "{\"bounty_id\":\"$BOUNTY_A\",\"index\":$INDEX_A}"; sleep 6
  note "atk11: researcher 1 balance change after the timeout: $(python3 -c "print($(balance "$RES1")-$B0)") yoctoNEAR (bounty 0.5 NEAR + own fee 0.01 NEAR expected)"
  call_expect_fail atk8_timeout_late_after_payout "$RES1" claim_timeout "{\"bounty_id\":\"$BOUNTY_A\",\"index\":$INDEX_A}"
  ;;
bounty_b)
  BB=$(create b_create 600 300 1800 300); save BOUNTY_B "$BB"
  for v in "$VER1" "$VER2"; do call "b_attest_proof0_${v%%.*}" "$v" attest_proof0 "{\"bounty_id\":\"$BB\",\"journal_hash\":\"$P0_JOURNAL\",\"receipt_hash\":\"$P0_RECEIPT\"}"; done
  IB=$(commit_reveal b_r2 "$BB" "$RES2" data/demo/fixed.wasm); save INDEX_B "$IB"
  # (4) replay: the vendor posts bounty A's receipt for this new submission
  call atk4_vendor_replays_receipt_a "$VENDOR" post_verdict "{\"bounty_id\":\"$BB\",\"index\":$IB,\"verdict\":\"PASS\",\"journal_hash\":\"$A_JOURNAL\",\"receipt_hash\":\"$A_RECEIPT\"}"
  if scripts/verifier_check.sh submission "$CONTRACT" "$BB" "$IB" target/s13/a_succinct.bin > "$OUTDIR/steps/atk4_check.txt"; then note "UNEXPECTED: replay accepted"; else note "atk4: verifier refuses the replayed receipt ($(grep '^FAIL' "$OUTDIR/steps/atk4_check.txt" | tr '\n' ';'))"; fi
  # (9) a receipt for another program id (the pre-S13 checker guest)
  if scripts/verifier_check.sh submission "$CONTRACT" "$BB" "$IB" target/s4/receipt_succinct.bin > "$OUTDIR/steps/atk9_check.txt"; then note "UNEXPECTED: other program accepted"; else note "atk9: verifier refuses a receipt of another program ($(grep '^FAIL' "$OUTDIR/steps/atk9_check.txt" | head -3 | tr '\n' ';'))"; fi
  call_expect_fail atk8_expire_early "$RES1" expire "{\"bounty_id\":\"$BB\"}"
  P=$(json_field "$(view get_submission "{\"bounty_id\":\"$BB\",\"index\":$IB}")" verdict_posted_at_ns)
  wait_past $(( P + 300 * SEC ))
  call b_claim_timeout "$RES1" claim_timeout "{\"bounty_id\":\"$BB\",\"index\":$IB}"
  wait_past $(( $(json_field "$(view get_bounty "{\"bounty_id\":\"$BB\"}")" expires_at_ns) ))
  call atk8_expire_late_after_payout "$RES1" expire "{\"bounty_id\":\"$BB\"}"
  note "bounty B after expire: $(view get_bounty "{\"bounty_id\":\"$BB\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ("state","fees_collected","fees_swept")})')"
  ;;
misc)
  BC=$(create c_create 600 300 3600 120); save BOUNTY_C "$BC"
  for v in "$VER1" "$VER2"; do call "c_attest_proof0_${v%%.*}" "$v" attest_proof0 "{\"bounty_id\":\"$BC\",\"journal_hash\":\"$P0_JOURNAL\",\"receipt_hash\":\"$P0_RECEIPT\"}"; done
  # (7) the same verifier twice on Proof 0 of a new bounty D, and (6) an unregistered account
  BD=$(create d_create 600 300 3600 120); save BOUNTY_D "$BD"
  call atk7_same_verifier_1 "$VER1" attest_proof0 "{\"bounty_id\":\"$BD\",\"journal_hash\":\"$P0_JOURNAL\",\"receipt_hash\":\"$P0_RECEIPT\"}"
  call atk7_same_verifier_2 "$VER1" attest_proof0 "{\"bounty_id\":\"$BD\",\"journal_hash\":\"$P0_JOURNAL\",\"receipt_hash\":\"$P0_RECEIPT\"}"
  note "atk7: bounty D opened after the same verifier twice: $(json_field "$(view get_bounty "{\"bounty_id\":\"$BD\"}")" opened), attestations $(json_field "$(view get_bounty "{\"bounty_id\":\"$BD\"}")" proof0_attestations)"
  call_expect_fail atk6_unregistered_attests "$RES2" attest_proof0 "{\"bounty_id\":\"$BD\",\"journal_hash\":\"$P0_JOURNAL\",\"receipt_hash\":\"$P0_RECEIPT\"}"
  # (3) sub-accounts of researcher 2 and (2) junk commits filling K = 3 on bounty C
  for sub in sa sb; do
    acct="$sub.$RES2"
    [ "$(balance "$acct")" != "missing" ] || run_near "create_${sub}" create-account "$RES2" account create-account fund-myself "$acct" '0.3 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as "$RES2" network-config testnet sign-with-legacy-keychain send
    call "credit_$sub" "$acct" deposit_credit '{}' "0.1 NEAR"
  done
  for who in "$RES2" "sa.$RES2" "sb.$RES2" "$RES1"; do
    n=$(nonce); call "atk2_junk_commit_${who%%.*}" "$who" commit "{\"bounty_id\":\"$BC\",\"fingerprint\":\"$(fp_for data/attacks/reject_all.wasm "$who" "$n")\",\"payout\":\"$who\"}"
    note "after a commit by $who: commits=$(json_field "$(view get_bounty "{\"bounty_id\":\"$BC\"}")" commits) active=$(json_field "$(view get_bounty "{\"bounty_id\":\"$BC\"}")" active)"
  done
  # (10) a reveal that does not match its commit (the fourth commit above was ignored; reveal index 0 with other bytes)
  call_expect_fail atk10_mismatched_reveal "$RES2" reveal "{\"bounty_id\":\"$BC\",\"index\":0,\"patch\":\"$(base64 -w0 data/demo/fixed.wasm)\",\"nonce\":\"$(nonce)\"}"
  call_expect_fail atk2_release_too_early "$RES1" release_unrevealed "{\"bounty_id\":\"$BC\",\"index\":0}"
  C=$(json_field "$(view get_submission "{\"bounty_id\":\"$BC\",\"index\":0}")" committed_at_ns)
  wait_past $(( C + 121 * SEC ))
  call atk2_release_unrevealed "$RES1" release_unrevealed "{\"bounty_id\":\"$BC\",\"index\":0}"
  n=$(nonce); call atk2_commit_after_release "$RES1" commit "{\"bounty_id\":\"$BC\",\"fingerprint\":\"$(fp_for data/demo/fixed.wasm "$RES1" "$n")\",\"payout\":\"$RES1\"}"
  note "after the release and a new commit: $(view get_bounty "{\"bounty_id\":\"$BC\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ("commits","active","fees_collected")})')"
  ;;
*) echo "usage: $0 setup|proof0|open|commit_a|prove_a|attack_a|bounty_b|misc"; exit 2 ;;
esac
