#!/usr/bin/env bash
# Audit round 1 rerun, part b: finishes the checks on bounty X of scripts/audit1_testnet.sh after that script stopped
# early (the FAIL proof was made but not submitted; J's verdict window has closed). On X: R (the honest fix, revealed
# first) and J (junk, revealed later) are both undecided. Checks: fix 1 (a commit too close to expiry is refused), fix 3
# (J's timeout is refused while R is undecided; R is then paid), fix 4 (J's fee is refunded as credit when X closes).
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/audit1; mkdir -p "$OUTDIR/steps"
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
SEC=1000000000
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
X=$(grep -oE 'x_create.*' "$OUTDIR/transactions.tsv" >/dev/null; view get_next_bounty_id '{}' | python3 -c 'import json,sys; print(int(json.load(sys.stdin))-1)')
B=$(view get_bounty "{\"bounty_id\":\"$X\"}")
note "== audit1 part b $(date -u +%FT%TZ): bounty $X state $(json_field "$B" state), commits $(json_field "$B" commits), pending $(json_field "$B" pending)"
# fix 1: created + 960 s has passed, the bounty is still Open
call_expect_fail fix1_commit_too_close_to_expiry "$RES1" commit "{\"bounty_id\":\"$X\",\"fingerprint\":\"$(fp_for data/demo/fixed.wasm "$RES1" "$(nonce)")\",\"payout\":\"$RES1\"}"
# fix 3: both deadlines have passed; the later reveal (J, index 1) cannot be timed out while R (index 0) is undecided
call_expect_fail fix3_timeout_of_later_reveal_refused "$RES2" claim_timeout "{\"bounty_id\":\"$X\",\"index\":1}"
CR0=$(json_field "$(view get_credit "{\"account_id\":\"$RES2\"}")" ""); B0=$(balance "$RES1")
call fix3_timeout_of_first_reveal "$RES2" claim_timeout "{\"bounty_id\":\"$X\",\"index\":0}"; sleep 6
CR1=$(json_field "$(view get_credit "{\"account_id\":\"$RES2\"}")" "")
note "R paid by timeout: researcher 1 balance change $(python3 -c "print(($(balance "$RES1")-$B0)/1e24)") NEAR (0.11 expected: bounty + own fee); J's fee refunded as credit to researcher 2: credit change $(python3 -c "print(($CR1-$CR0)/1e24)") NEAR (0.015 expected)"
note "bounty $X after the payout: $(view get_bounty "{\"bounty_id\":\"$X\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ("state","winner","fees_collected","fees_swept","pending")})')"
