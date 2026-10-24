#!/usr/bin/env bash
# Spike S8, the "steal the secret" arena, run natively with the same checker code as the zkVM guest (no proofs).
# 1. Builds the arena modules (data/arena/original.rs, fixed.rs) and the public tests.
# 2. The vendor picks a secret: one of the 4,096 crashing inputs, plus a random salt; only sha256(salt || exploit)
#    is published until the game ends. The secret stays in target/arena/ (not committed).
# 3. Proof 0 (the original really crashes on the secret and passes the public tests).
# 4. A scripted probe agent gets K = 3 attempts. Each probe fixes the crash only for values matching a bit
#    pattern, so its verdict says whether the secret matches. Binary search over the top bits.
#    Leak meter after each verdict: bits learned = log2(4096 / candidates still possible).
# 5. Control: the same probes with the crash-variant check on (32 variants), and the honest fix.
# 6. The vendor reveals the secret and salt; the script checks the commitment and that the log is consistent.
# Run from the repo root: ./scripts/s8_arena.sh   Output: docs/evidence/S8/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=docs/evidence/S8; PRIV=target/arena; mkdir -p "$OUT" "$PRIV/probes"
CHECK=./target/debug/kintsugi-check
K=3; FUZZ=16
FLAGS=(--edition 2021 --target wasm32-unknown-unknown --crate-type cdylib -C opt-level=z -C panic=abort
  -C strip=symbols -C codegen-units=1 -C target-cpu=mvp -C link-arg=-zstack-size=8192
  -C link-arg=--initial-memory=131072 -C link-arg=--max-memory=131072)
log() { echo "$*" | tee -a "$OUT/arena_run.txt"; }
: > "$OUT/arena_run.txt"

# 1. modules and public tests
for m in original fixed; do rustc "${FLAGS[@]}" -o data/arena/$m.wasm data/arena/$m.rs; done
{ echo "# Public tests for the arena module (data/arena/original.rs). One per line: <input hex or -> <value>."
  echo "# Expected values come from: target/debug/kintsugi-check run --module data/arena/original.wasm --input <hex>"
  for input in - 00 01 0102 a5 a501 0011223344 a4ffff a6ffff 5aa5ff 6b696e74 ffffffffffff 7f00a5ff 0a0b0c0d0e0f; do
    hex="$input"; [ "$hex" = "-" ] && hex=""
    v=$($CHECK run --module data/arena/original.wasm --input "$hex" | awk '$1=="returned"{print $2}')
    [ -n "$v" ] || { echo "public test $input crashes the original; not allowed" >&2; exit 1; }
    printf '%-20s %s\n' "$input" "$v"
  done; } > data/arena/public_tests.txt
log "modules: original $(stat -c %s data/arena/original.wasm) bytes, fixed $(stat -c %s data/arena/fixed.wasm) bytes; public tests: $(grep -c -v -E '^#|^\s*$' data/arena/public_tests.txt)"

# 2. the vendor's secret
python3 -I - "$PRIV" <<'PY'
import hashlib, secrets, sys, os
d = sys.argv[1]
v = secrets.randbelow(4096); top = secrets.randbelow(16)          # 12 bit value, random top nibble of byte 1
exploit = bytes([0xA5, (top << 4) | (v >> 8), v & 0xFF])
salt = secrets.token_bytes(32)
open(os.path.join(d, "exploit.hex"), "w").write(exploit.hex() + "\n")
with open(os.path.join(d, "secret.env"), "w") as f:
    f.write(f"SECRET_VALUE={v}\nSALT={salt.hex()}\nEXPLOIT={exploit.hex()}\n")
os.chmod(os.path.join(d, "secret.env"), 0o600)
print("COMMITMENT=" + hashlib.sha256(salt + exploit).hexdigest())
PY
COMMITMENT=$(python3 -I -c 'import hashlib;e=dict(l.strip().split("=",1) for l in open("target/arena/secret.env"));print(hashlib.sha256(bytes.fromhex(e["SALT"])+bytes.fromhex(e["EXPLOIT"])).hexdigest())')
SEED=$(python3 -I -c 'import secrets; print(secrets.token_hex(32))')
log "secret space: 4096 values; exploit commitment sha256(salt || exploit): $COMMITMENT; fairness seed: $SEED"
COMMON=(--original data/arena/original.wasm --exploit "$PRIV/exploit.hex" --tests data/arena/public_tests.txt --fuzz-count $FUZZ --seed "$SEED")

# 3. Proof 0
log "proof0: $($CHECK proof0 --original data/arena/original.wasm --exploit "$PRIV/exploit.hex" --tests data/arena/public_tests.txt 2>&1 | tail -1)"

probe() { # probe <name> <mask> <value>; builds and prints the wasm path
  sed -e "s/__MASK__/$2/" -e "s/__VALUE__/$3/" data/arena/probe.rs.template > "$PRIV/probes/$1.rs"
  rustc "${FLAGS[@]}" -o "$PRIV/probes/$1.wasm" "$PRIV/probes/$1.rs"; echo "$PRIV/probes/$1.wasm"
}
verdict() { # exit code 0 = PASS, 1 = FAIL, anything else is an error and stops the run
  local rc=0; $CHECK check --candidate "$1" "${COMMON[@]}" --variants "$2" > /dev/null 2>&1 || rc=$?
  case $rc in 0) echo PASS ;; 1) echo FAIL ;; *) echo "checker error (exit $rc) on $1" >&2; exit 1 ;; esac
}

# 4. the game, variants off
log ""; log "| attempt | probe pattern (bits of v) | verdict | candidates left | bits learned | budget K |"; log "| --- | --- | --- | --- | --- | --- |"
mask=0; val=0; echo '[' > "$OUT/arena_log.json"
for a in $(seq 1 $K); do
  bit=$((12 - a)); pm=$((mask | (1 << bit))); pv=$((val | (1 << bit)))
  f=$(probe "probe_$a" "$pm" "$pv"); v=$(verdict "$f" 0)
  [ "$v" = PASS ] && val=$pv; mask=$pm
  known=$(python3 -c "print(bin($mask).count('1'))"); left=$((4096 >> known))
  bits=$(python3 -c "import math; print(round(math.log2(4096/$left),3))")
  log "| $a | (v & 0x$(printf '%03x' $pm)) == 0x$(printf '%03x' $pv) | $v | $left | $bits | $K |"
  [ "$a" -gt 1 ] && echo ',' >> "$OUT/arena_log.json"
  printf '{"attempt":%d,"mask":%d,"value":%d,"verdict":"%s","candidates_left":%d,"bits_learned":%s,"budget":%d,"probe_sha256":"%s"}\n' \
    "$a" "$pm" "$pv" "$v" "$left" "$bits" "$K" "$(sha256sum "$f" | cut -c1-64)" >> "$OUT/arena_log.json"
done
echo ']' >> "$OUT/arena_log.json"
log "attempt 4: refused, the budget K = $K is spent (on chain the contract ignores commits beyond max_commits)"
FINAL_MASK=$mask; FINAL_VAL=$val

# 5. controls
log ""; log "control with the crash-variant check on (32 variants), same probes:"
for a in $(seq 1 $K); do log "  probe_$a: $(verdict "$PRIV/probes/probe_$a.wasm" 32)"; done
log "honest fix, variants 0: $(verdict data/arena/fixed.wasm 0); variants 32: $(verdict data/arena/fixed.wasm 32)"
log "unpatched original: $(verdict data/arena/original.wasm 0)"

# 6. reveal and consistency check
source "$PRIV/secret.env"
log ""; log "reveal (after the game): exploit $EXPLOIT, value $SECRET_VALUE, salt $SALT"
python3 -I - "$SALT" "$EXPLOIT" "$COMMITMENT" "$SECRET_VALUE" "$FINAL_MASK" "$FINAL_VAL" "$K" <<'PY' | tee -a docs/evidence/S8/arena_run.txt
import hashlib, sys
salt, exploit, commitment, v, mask, val = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
ok_commit = hashlib.sha256(bytes.fromhex(salt) + bytes.fromhex(exploit)).hexdigest() == commitment
ok_log = (v & mask) == val
print(f"commitment matches the revealed salt and exploit: {ok_commit}")
print(f"the secret value lies in the candidate set the log describes ((v & {mask:#05x}) == {val:#05x}): {ok_log}")
print(f"bits learned by the probe agent: {bin(mask).count('1')}, budget K = {sys.argv[7]}, within budget: {bin(mask).count('1') <= int(sys.argv[7])}")
PY
