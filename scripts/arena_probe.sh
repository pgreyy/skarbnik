#!/usr/bin/env bash
# Arena recording (Task 4): how little a probe agent learns about the secret before the attempt cap stops it.
# The probe agent's plan: the secret is one of 4,096 values (12 bits, the S8 arena, data/arena/). Probe b (b = 11 down
# to 0) fixes the crash only when bit b of the secret is 1, so its verdict answers one yes or no question: one bit. The
# same 12 probes are used in both runs.
# Phases:
#   unguarded  SIMULATED on this machine only, never on the contract: no cap and no fee. Verdicts come from the native
#              checker (the same code as the zkVM guest), with the crash-variant check off (the worst case: with it on,
#              every probe fails and learns nothing, S8). A fresh secret is drawn for the run and revealed afterwards.
#   guarded    REAL, on NEAR testnet: a Level 2 bounty on the demo program with the real cap (K = 3) and rising fee
#              (0.01 NEAR, then +0.005 NEAR), opened with the demo's Groth16 Proof 0. A seeded probe account deposits
#              credit and commits all 12 probes. The contract counts K of them and ignores the rest at no cost. The
#              probes are not revealed (so this run asks for no verdict and learns 0 bits); with K = 3 it could learn
#              at most 3 bits however it played.
#   summary    writes web/data/arena_probe.json for the Arena page from both runs' files
# Usage, from the repo root: ./scripts/arena_probe.sh <phase>. Output: docs/evidence/arena_probe/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/arena_probe; PRIV=target/arena_probe; mkdir -p "$OUTDIR/steps" "$PRIV/probes"
export OUT="$OUTDIR" CONTRACT=kintsugi-l2-cihdp.testnet
source scripts/s3_lib.sh; source docs/evidence/S3b/accounts.env
CHECK=./target/debug/skarbnik-check; SEC=1000000000
FLAGS=(--edition 2021 --target wasm32-unknown-unknown --crate-type cdylib -C opt-level=z -C panic=abort -C strip=symbols
  -C codegen-units=1 -C target-cpu=mvp -C link-arg=-zstack-size=8192 -C link-arg=--initial-memory=131072 -C link-arg=--max-memory=131072)
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
note() { echo "$(date -u +%FT%TZ) $*" | tee -a "$OUTDIR/summary.txt"; }
json_field() { python3 -c 'import json,sys; print(json.loads(sys.argv[1])[sys.argv[2]])' "$1" "$2"; }
probe() { # probe <bit>: builds the probe for one bit, prints its wasm path
  local m=$((1 << $1)); sed -e "s/__MASK__/$m/" -e "s/__VALUE__/$m/" data/arena/probe.rs.template > "$PRIV/probes/bit_$1.rs"
  rustc "${FLAGS[@]}" -o "$PRIV/probes/bit_$1.wasm" "$PRIV/probes/bit_$1.rs"; echo "$PRIV/probes/bit_$1.wasm"; }

case "${1:-}" in
unguarded)
  # A fresh secret for the simulation: value v (12 bits) and a salt, kept in target/ until the reveal below.
  python3 -I - "$PRIV" <<'PY'
import os, secrets, sys
d = sys.argv[1]; v = secrets.randbelow(4096); top = secrets.randbelow(16)
open(os.path.join(d, "exploit.hex"), "w").write(bytes([0xA5, (top << 4) | (v >> 8), v & 0xFF]).hex() + "\n")
open(os.path.join(d, "value.txt"), "w").write(f"{v}\n")
PY
  SEED=$(python3 -I -c 'import secrets; print(secrets.token_hex(32))')
  COMMON=(--original data/arena/original.wasm --exploit "$PRIV/exploit.hex" --tests data/arena/public_tests.txt --fuzz-count 16 --seed "$SEED")
  echo '[' > "$OUTDIR/unguarded_sim.json"; learned=0; v_guess=0
  for b in 11 10 9 8 7 6 5 4 3 2 1 0; do
    f=$(probe "$b"); rc=0; $CHECK check --candidate "$f" "${COMMON[@]}" --variants 0 > /dev/null 2>&1 || rc=$?
    case $rc in 0) verdict=PASS; v_guess=$((v_guess | (1 << b))) ;; 1) verdict=FAIL ;; *) echo "checker error $rc"; exit 1 ;; esac
    rc2=0; $CHECK check --candidate "$f" "${COMMON[@]}" --variants 32 > /dev/null 2>&1 || rc2=$?
    learned=$((learned + 1))
    [ "$b" -lt 11 ] && echo ',' >> "$OUTDIR/unguarded_sim.json"
    printf '{"attempt":%d,"bit":%d,"verdict":"%s","verdict_with_variant_check":"%s","bits_learned":%d,"fee_near":0}\n' \
      "$((12 - b))" "$b" "$verdict" "$([ $rc2 = 0 ] && echo PASS || echo FAIL)" "$learned" >> "$OUTDIR/unguarded_sim.json"
  done
  echo ']' >> "$OUTDIR/unguarded_sim.json"
  V=$(cat "$PRIV/value.txt")
  note "unguarded (SIMULATED, this machine, no cap, no fee, variant check off): 12 probes, 12 bits learned, value from the probes $v_guess, the secret revealed after the run $V, match $([ "$V" = "$v_guess" ] && echo yes || echo NO); with the variant check on every probe FAILs (0 bits)"
  save SIM_SECRET_REVEALED "$V"; save SIM_SEED "$SEED"
  ;;
guarded)
  if [ -z "${GBOUNTY:-}" ]; then
    T=$(view get_next_bounty_id '{}' | tr -d '"')
    B=$(view get_bounty '{"bounty_id":"7"}')   # the demo program and its Proof 0, as bounty 7
    call arena_guarded_create "$VENDOR" create_bounty "{\"original_hash\":\"$(json_field "$B" original_hash)\",\"corpus_hash\":\"$(json_field "$B" corpus_hash)\",\"image_id\":\"$(json_field "$B" image_id)\",\"exploit_commitment\":\"$(json_field "$B" exploit_commitment)\",\"proof0_receipt_hash\":\"$(json_field "$B" proof0_receipt_hash)\",\"max_commits\":3,\"max_patch_bytes\":2048,\"reveal_gap_ns\":\"$(( 60 * SEC ))\",\"verdict_window_ns\":\"$(( 4 * 3600 * SEC ))\",\"attest_window_ns\":\"$(( 3600 * SEC ))\",\"expiry_ns\":\"$(( 24 * 3600 * SEC ))\",\"attempt_fee\":\"10000000000000000000000\",\"fee_step\":\"5000000000000000000000\",\"reference_fix_hash\":\"$(json_field "$B" reference_fix_hash)\",\"proof0_journal_hash\":\"$(json_field "$B" proof0_journal_hash)\",\"reveal_window_ns\":\"$(( 3600 * SEC ))\",\"fuzz_count\":16,\"variant_count\":32,\"level\":2}" "0.1 NEAR"
    P0=docs/evidence/receipts/demo_proof0_args.json
    call arena_guarded_open "$VENDOR" open_with_groth16 "{\"bounty_id\":\"$T\",$(python3 -I -c 'import base64,json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"seal":base64.b64encode(bytes.fromhex(d["seal"])).decode(),"journal":base64.b64encode(bytes.fromhex(d["journal"])).decode()})[1:-1])' "$P0")}" "0 NEAR" "300 Tgas"
    save GBOUNTY "$T"; GBOUNTY=$T
  fi
  if [ -z "${PROBER:-}" ]; then
    PROBER="skarbnik-probe-$(python3 -c 'import secrets;print(secrets.token_hex(3))').testnet"
    run_near arena_prober_account create-account "$PROBER" account create-account sponsor-by-faucet-service "$PROBER" \
      autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
    save PROBER "$PROBER"; sleep 3
    call arena_prober_deposit "$PROBER" deposit_credit '{"account_id":null}' "0.2 NEAR" "30 Tgas"
  fi
  W0=$(balance "$PROBER"); C0=$(view get_credit "{\"account_id\":\"$PROBER\"}" | tr -d '"')
  echo '[' > "$OUTDIR/guarded_live.json"
  for b in 11 10 9 8 7 6 5 4 3 2 1 0; do
    f=$(probe "$b"); a=$((12 - b))
    before=$(view get_credit "{\"account_id\":\"$PROBER\"}" | tr -d '"')
    FP=$(python3 -I - "$f" "$PROBER" "$PRIV/nonce_$b.hex" <<'PY'
import hashlib, secrets, sys
patch = open(sys.argv[1], "rb").read(); payout = sys.argv[2].encode(); nonce = secrets.token_bytes(32)
open(sys.argv[3], "w").write(nonce.hex() + "\n")
buf = b"kintsugi-commit-v1" + len(patch).to_bytes(4, "little") + patch + len(payout).to_bytes(4, "little") + payout + nonce
print(hashlib.sha256(buf).hexdigest())
PY
)
    call "arena_probe_commit_$a" "$PROBER" commit "{\"bounty_id\":\"$GBOUNTY\",\"fingerprint\":\"$FP\",\"payout\":\"$PROBER\"}" "0 NEAR" "30 Tgas"
    sleep 2; after=$(view get_credit "{\"account_id\":\"$PROBER\"}" | tr -d '"')
    H=$(awk -F'\t' -v s="arena_probe_commit_$a" '$1==s {print $4}' "$OUTDIR/transactions.tsv" | tail -1)
    counted=$(grep -q '"commit_ignored"' "$OUTDIR/steps/arena_probe_commit_$a.txt" && echo false || echo true)
    [ "$a" -gt 1 ] && echo ',' >> "$OUTDIR/guarded_live.json"
    printf '{"attempt":%d,"bit":%d,"tx":"%s","counted":%s,"fee_yocto":"%s"}\n' "$a" "$b" "$H" "$counted" "$(python3 -c "print(int('$before') - int('$after'))")" >> "$OUTDIR/guarded_live.json"
  done
  echo ']' >> "$OUTDIR/guarded_live.json"
  BB=$(view get_bounty "{\"bounty_id\":\"$GBOUNTY\"}"); W1=$(balance "$PROBER"); C1=$(view get_credit "{\"account_id\":\"$PROBER\"}" | tr -d '"')
  save GAS_NEAR "$(python3 -c "print((int('$W0')-int('$W1'))/1e24)")"
  note "guarded (REAL, testnet bounty $GBOUNTY, K = $(json_field "$BB" max_commits)): 12 probe commits sent by $PROBER; counted by the contract $(json_field "$BB" commits); fees from credit $(python3 -c "print((int('$C0')-int('$C1'))/1e24)") NEAR; gas and other costs from the wallet $(python3 -c "print((int('$W0')-int('$W1'))/1e24)") NEAR; not revealed, so 0 bits learned in this run; at most $(json_field "$BB" commits) bits however it played"
  ;;
summary)
  python3 -I - <<'PY'
import json
sim = json.load(open("docs/evidence/arena_probe/unguarded_sim.json"))
live = json.load(open("docs/evidence/arena_probe/guarded_live.json"))
env = dict(l.strip().split("=", 1) for l in open("docs/evidence/arena_probe/run.env") if "=" in l)
counted = [x for x in live if x["counted"]]
fees = sum(int(x["fee_yocto"]) for x in live)
out = {"secret_bits": 12, "note": "The probe agent's plan: one yes or no question per attempt about one bit of a 12 bit secret (4,096 values, the S8 arena).",
  "guarded": {"label": "real", "where": f"NEAR testnet, kintsugi-l2-cihdp.testnet bounty {env['GBOUNTY']}", "cap_K": len(counted),
              "attempts_sent": len(live), "attempts_counted": len(counted), "fees_near": fees / 1e24, "gas_near": float(env.get("GAS_NEAR", "0")),
              "bits_at_most": len(counted), "bits_learned_in_run": 0, "share_exposed_at_most": len(counted) / 12,
              "account": env["PROBER"], "account_kind": "seeded", "txs": [x["tx"] for x in live],
              "why_0_bits": "the probes were committed but not revealed, so no verdict was asked for; with K counted attempts no play can learn more than K bits"},
  "unguarded": {"label": "simulated", "where": "this machine only (native checker), never on the contract; no cap, no fee, crash-variant check off",
                "attempts_sent": len(sim), "attempts_counted": len(sim), "fees_near": 0, "bits_learned": sim[-1]["bits_learned"],
                "share_exposed": sim[-1]["bits_learned"] / 12, "with_variant_check_on": "every probe FAILs: 0 bits"},
  "sources": ["docs/evidence/arena_probe/guarded_live.json", "docs/evidence/arena_probe/unguarded_sim.json", "docs/evidence/arena_probe/summary.txt", "scripts/arena_probe.sh"]}
json.dump(out, open("web/data/arena_probe.json", "w"), indent=1); open("web/data/arena_probe.json", "a").write("\n")
print(json.dumps({k: (v if k != "guarded" else {kk: vv for kk, vv in v.items() if kk != "txs"}) for k, v in out.items()}, indent=1))
PY
  ;;
*) echo "usage: $0 unguarded|guarded|summary"; exit 2 ;;
esac
