#!/usr/bin/env bash
# Spike S6b on NEAR testnet: deploys the Groth16 spike contract (verifier/groth16-near) to a new throwaway faucet
# account and calls `verify_groth16` four times: the real demo Proof 0 Groth16 receipt (must be accepted), the same
# seal with one flipped bit, a changed journal, and a wrong image id (each must be rejected). Then reads every
# transaction's gas from the RPC. Testnet only. Not the bounty contract and no payout logic.
# Phases: setup, calls, gas. Usage, from the repo root: ./scripts/s6b_testnet.sh <phase>. State: docs/evidence/S6b/run.env.
set -euo pipefail
cd "$(dirname "$0")/.."
OUTDIR=docs/evidence/S6b; mkdir -p "$OUTDIR/steps" target/s6b
RUN="$OUTDIR/run.env"; touch "$RUN"; source "$RUN"
export OUT="$OUTDIR" CONTRACT="${S6B_CONTRACT:-none}"
source scripts/s3_lib.sh
source docs/evidence/S3b/accounts.env
save() { grep -v "^$1=" "$RUN" > "$RUN.tmp" || true; echo "$1=$2" >> "$RUN.tmp"; mv "$RUN.tmp" "$RUN"; }
W=target/near/kintsugi_groth16_spike/kintsugi_groth16_spike.wasm
ARGS=target/s6b/args.json   # from: ./target/release/kintsugi-host groth16-args target/s6/proof0_groth16.bin target/s6b/args.json

# args <variant>: the JSON arguments for one call (real | flipped | journal | image)
args() { python3 -I - "$ARGS" "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); v = sys.argv[2]
seal, image, journal = d["seal"], d["image_id"], d["journal"]
if v == "flipped":   # flip the lowest bit of the last seal byte (C's y coordinate)
    b = bytearray.fromhex(seal); b[255] ^= 1; seal = b.hex()
elif v == "journal": # change the last journal byte
    b = bytearray.fromhex(journal); b[-1] ^= 1; journal = b.hex()
elif v == "image":   # S13's plain-build image id instead of the reproducible one
    image = "043ec633f68431f51b99cacd6a460560647a15916cdd0cb58762b61f9ede7f8d"
print(json.dumps({"seal": seal, "image_id": image, "journal": journal}))
PY
}

case "${1:-}" in
setup)
  if [ "$CONTRACT" = none ]; then
    acct="kintsugi-g16-$(python3 -c 'import secrets, string; print("".join(secrets.choice(string.ascii_lowercase) for _ in range(5)))').testnet"
    run_near create_s6b_account create-account faucet account create-account sponsor-by-faucet-service "$acct" \
      autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
    save S6B_CONTRACT "$acct"; export CONTRACT="$acct"
  fi
  { echo "wasm_bytes=$(stat -c %s "$W")"; echo "wasm_sha256=$(sha256sum "$W" | cut -d' ' -f1)"; } | tee "$OUTDIR/contract_wasm.txt"
  run_near deploy deploy "$CONTRACT" contract deploy "$CONTRACT" use-file "$W" without-init-call \
    network-config testnet sign-with-legacy-keychain send
  ;;
calls)
  call s6b_real "$RES2" verify_groth16 "$(args real)" "0 NEAR" "300 Tgas"
  call_expect_fail s6b_flipped_seal_bit "$RES2" verify_groth16 "$(args flipped)"
  call s6b_changed_journal "$RES2" verify_groth16 "$(args journal)" "0 NEAR" "300 Tgas"
  call s6b_wrong_image_id "$RES2" verify_groth16 "$(args image)" "0 NEAR" "300 Tgas"
  ;;
gas)
  # Every receipt's gas_burnt for each call, from the RPC (EXPERIMENTAL_tx_status), plus the contract's own log.
  python3 -I - "$OUTDIR/transactions.tsv" "$RES2" "$RPC" <<'PY' | tee "$OUTDIR/gas.txt"
import csv, json, sys, urllib.request
rows = [r for r in csv.DictReader(open(sys.argv[1]), delimiter="\t") if r["step"].startswith("s6b_")]
for r in rows:
    req = {"jsonrpc": "2.0", "id": 1, "method": "EXPERIMENTAL_tx_status",
           "params": {"tx_hash": r["tx_hash"], "sender_account_id": sys.argv[2], "wait_until": "FINAL"}}
    d = json.load(urllib.request.urlopen(urllib.request.Request(sys.argv[3], json.dumps(req).encode(), {"Content-Type": "application/json"})))["result"]
    outs = [d["transaction_outcome"]] + d["receipts_outcome"]
    total = sum(o["outcome"]["gas_burnt"] for o in outs)
    contract = sum(o["outcome"]["gas_burnt"] for o in d["receipts_outcome"] if o["outcome"]["executor_id"] != sys.argv[2])
    status = d["status"]
    ret = status.get("SuccessValue")
    import base64
    ret = base64.b64decode(ret).decode() if ret else None
    err = json.dumps(status.get("Failure"))[:220] if "Failure" in status else None
    logs = [l for o in d["receipts_outcome"] for l in o["outcome"]["logs"]]
    print(f"{r['step']}: tx {r['tx_hash']} | total gas burnt {total/1e12:.3f} Tgas | in the contract receipt {contract/1e12:.3f} Tgas | return {ret} | failure {err} | log {logs}")
PY
  ;;
*) echo "usage: $0 setup|calls|gas"; exit 2 ;;
esac
