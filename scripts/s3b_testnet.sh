#!/usr/bin/env bash
# Spike S3b on NEAR testnet: attempt fees and credit on bounty.kintsugi-djloo.testnet.
#   1. register three verifiers; two researchers deposit credit;
#   2. bounty A (fee 0.01 NEAR, step 0.005 NEAR): researcher 1 commits (fee 0.01), researcher 2 commits
#      (fee 0.015), an account without credit commits (must fail), researcher 1 reveals, the vendor posts
#      PASS, two verifiers attest, researcher 1 is paid; after expiry, expire sends the 0.025 NEAR of fees
#      to the three verifiers;
#   3. bounty B with no commits: expire refunds the vendor;
#   4. researcher 2 withdraws unspent credit (needs 1 yoctoNEAR attached).
# Hashes posted are labelled placeholders. Testnet only. Run from the repo root after ./scripts/s3b_setup.sh.
# Output: docs/evidence/S3b/ (steps/*.txt, transactions.tsv, run summary in summary.txt).
set -euo pipefail
cd "$(dirname "$0")/.."
export OUT=docs/evidence/S3b CONTRACT=bounty.kintsugi-djloo.testnet
source scripts/s3_lib.sh
source "$OUT/accounts.env"
VENDOR=$VENDOR; R1=$RES1; R2=$RES2; V1=$VER1; V2=$VER2; V3=$VER3
mkdir -p "$OUT/steps" target/s3-logs
SUM="$OUT/summary.txt"; : > "$SUM"
note() { echo "$*" | tee -a "$SUM"; }

placeholder() { python3 -c 'import hashlib,sys; print(hashlib.sha256(("kintsugi S3b placeholder: "+sys.argv[1]).encode()).hexdigest())' "$1"; }
json_field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])
for k in filter(None, sys.argv[2].split(".")): d=d[int(k)] if isinstance(d,list) else d[k]
print(d)' "$1" "$2"; }
now_ns() { curl -4 -s --max-time 60 "$RPC" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"t","method":"block","params":{"finality":"final"}}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["header"]["timestamp_nanosec"])'; }
wait_past() { local target="$1"; while [ "$(now_ns)" -le "$target" ]; do sleep 3; done; }
wait_balance_change() { local acct="$1" old="$2" b i; for i in $(seq 1 20); do b=$(balance "$acct"); [ "$b" != "$old" ] && break; sleep 3; done; echo "$b"; }
yocto_diff() { python3 -c 'import sys; print(int(sys.argv[2])-int(sys.argv[1]))' "$1" "$2"; }
credit() { json_field "$(view get_credit "{\"account_id\":\"$1\"}")" ""; }

SEC=1000000000
FEE=10000000000000000000000      # 0.01 NEAR
STEP=5000000000000000000000      # 0.005 NEAR
BOUNTY="0.5 NEAR"
ORIG=$(placeholder "original module"); CORPUS=$(placeholder "public test corpus"); IMAGE=$(placeholder "harness image id")
EXPLOIT=$(placeholder "exploit commitment"); PROOF0=$(placeholder "proof 0 receipt")
JOURNAL=$(placeholder "journal"); RECEIPT=$(placeholder "receipt")

make_patch() {  # make_patch <label> <payout>; prints base64 patch, nonce hex, fingerprint hex
  python3 - "$1" "$2" <<'PY'
import base64, hashlib, secrets, sys
patch = ("kintsugi S3b placeholder patch, not a real module: " + sys.argv[1]).encode()
payout = sys.argv[2].encode()
nonce = secrets.token_bytes(32)
buf = b"kintsugi-commit-v1" + len(patch).to_bytes(4, "little") + patch + len(payout).to_bytes(4, "little") + payout + nonce
print(base64.b64encode(patch).decode(), nonce.hex(), hashlib.sha256(buf).hexdigest())
PY
}

create() {  # create <step> <expiry_s>; prints bounty id
  local id; id=$(json_field "$(view get_next_bounty_id '{}')" "")
  call "$1" "$VENDOR" create_bounty "{\"original_hash\":\"$ORIG\",\"corpus_hash\":\"$CORPUS\",\"image_id\":\"$IMAGE\",\"exploit_commitment\":\"$EXPLOIT\",\"proof0_receipt_hash\":\"$PROOF0\",\"max_commits\":3,\"max_patch_bytes\":1024,\"reveal_gap_ns\":\"$(( 2 * SEC ))\",\"verdict_window_ns\":\"$(( 600 * SEC ))\",\"attest_window_ns\":\"$(( 600 * SEC ))\",\"expiry_ns\":\"$(( $2 * SEC ))\",\"attempt_fee\":\"$FEE\",\"fee_step\":\"$STEP\"}" "$BOUNTY" >&2
  [ "$(view get_bounty "{\"bounty_id\":\"$id\"}")" != "null" ] || { echo "create_bounty $1 failed, stopping" >&2; exit 1; }
  echo "$id"
}

note "### S3b testnet run $(date -u +%Y-%m-%dT%H:%M:%SZ), contract $CONTRACT"

# 1. verifiers and credit
VERIFIERS=$(view get_verifiers '{}')
for v in "$V1:verifier 1 (S3b test account, run by the project)" "$V2:verifier 2 (S3b test account, run by the project)" "$V3:verifier 3 (S3b test account, run by the project)"; do
  acct="${v%%:*}"; label="${v#*:}"
  grep -q "\"$acct\"" <<<"$VERIFIERS" || call "register_${acct%%.*}" "$CONTRACT" register_verifier "{\"account_id\":\"$acct\",\"label\":\"$label\"}"
done
call credit_r1 "$R1" deposit_credit '{}' "0.1 NEAR"
call credit_r2 "$R2" deposit_credit '{}' "0.1 NEAR"
note "credit after deposits: r1=$(credit "$R1") r2=$(credit "$R2") (yoctoNEAR)"

# 2. bounty A: fees, payout, fee sweep
BA=$(create a_create_bounty 150)
CREATED_A=$(now_ns)
read -r P1 N1 F1 < <(make_patch "a r1" "$R1")
call a_commit_r1 "$R1" commit "{\"bounty_id\":\"$BA\",\"fingerprint\":\"$F1\",\"payout\":\"$R1\"}"
read -r P2 N2 F2 < <(make_patch "a r2" "$R2")
call a_commit_r2 "$R2" commit "{\"bounty_id\":\"$BA\",\"fingerprint\":\"$F2\",\"payout\":\"$R2\"}"
read -r P3 N3 F3 < <(make_patch "a v3" "$V3")
call_expect_fail a_commit_without_credit "$V3" commit "{\"bounty_id\":\"$BA\",\"fingerprint\":\"$F3\",\"payout\":\"$V3\"}"
note "credit after commits: r1=$(credit "$R1") r2=$(credit "$R2") v3=$(credit "$V3")"
note "bounty A after commits: $(view get_bounty "{\"bounty_id\":\"$BA\"}")"
sleep 3
call a_reveal_r1 "$R1" reveal "{\"bounty_id\":\"$BA\",\"index\":0,\"patch\":\"$P1\",\"nonce\":\"$N1\"}"
V="\"bounty_id\":\"$BA\",\"index\":0,\"verdict\":\"PASS\",\"journal_hash\":\"$JOURNAL\",\"receipt_hash\":\"$RECEIPT\""
call a_post_verdict "$VENDOR" post_verdict "{$V}"
call a_attest_v1 "$V1" attest "{$V}"
R1B0=$(balance "$R1")
call a_attest_v2 "$V2" attest "{$V}"
R1B1=$(wait_balance_change "$R1" "$R1B0")
note "researcher 1 balance change on the paying attestation: $(yocto_diff "$R1B0" "$R1B1") yoctoNEAR"

# 3. bounty B: no commits, refund only
BB=$(create b_create_bounty 30)
CREATED_B=$(now_ns)

# 4. withdraw unspent credit
call withdraw_r2 "$R2" withdraw_credit "{\"amount\":\"$(credit "$R2")\"}" "1 yoctoNEAR"
note "r2 credit after withdraw: $(credit "$R2")"

# Expiry of B, then A
wait_past $(( CREATED_B + 31 * SEC ))
VB0=$(balance "$VENDOR")
call b_expire_refund "$R1" expire "{\"bounty_id\":\"$BB\"}"
note "vendor balance change on bounty B expire: $(yocto_diff "$VB0" "$(wait_balance_change "$VENDOR" "$VB0")") yoctoNEAR"
wait_past $(( CREATED_A + 151 * SEC ))
B1=$(balance "$V1"); B2=$(balance "$V2"); B3=$(balance "$V3")
call a_expire_sweep_fees "$R2" expire "{\"bounty_id\":\"$BA\"}"
note "verifier balance changes on bounty A fee sweep: v1=$(yocto_diff "$B1" "$(wait_balance_change "$V1" "$B1")") v2=$(yocto_diff "$B2" "$(wait_balance_change "$V2" "$B2")") v3=$(yocto_diff "$B3" "$(wait_balance_change "$V3" "$B3")")"
call_expect_fail a_expire_again "$R2" expire "{\"bounty_id\":\"$BA\"}"
note "bounty A final: $(view get_bounty "{\"bounty_id\":\"$BA\"}")"
note "bounty B final: $(view get_bounty "{\"bounty_id\":\"$BB\"}")"
note "### done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
