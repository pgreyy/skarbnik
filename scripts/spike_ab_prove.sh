#!/usr/bin/env bash
# Spike A and B, on the vendor machine (the VPS): proves one rule checker job on a rented GPU pod
# (scripts/spike_output_gpu.py: the watches go first, the pod is always terminated), then wraps the succinct receipt to
# Groth16 here with the CPU host (Docker), verifies it and writes the contract arguments. Everything lands in the job's
# workdir: u_succinct.bin, verify_succinct.txt, u_groth16.bin, verify_groth16.txt, u_args.json, groth16.log.
# Usage, from the spike folder: scripts/spike_ab_prove.sh <gpu config json> <job json> [--wrap-only]
set -euo pipefail
cfg="$1"; job="$2"
export PATH="$HOME/skarbnik/bin:$PATH"   # r0vm (RISC Zero 3.0.6), which the Groth16 step starts, as the vendor tool does
w=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["workdir"])' "$job")
[ "${3:-}" = "--wrap-only" ] || python3 -I scripts/spike_output_gpu.py "$cfg" "$job"
host=bin/skarbnik-host
"$host" verify "$w/u_succinct.bin" --rule > "$w/verify_succinct.txt"
grep -q '^VALID' "$w/verify_succinct.txt"
start=$(date +%s)
RISC0_DEV_MODE=0 /usr/bin/time -v "$host" compress "$w/u_succinct.bin" "$w/u_groth16.bin" groth16 --rule > "$w/groth16.log" 2>&1
echo "groth16 seconds: $(( $(date +%s) - start ))" >> "$w/groth16.log"
"$host" verify "$w/u_groth16.bin" --rule > "$w/verify_groth16.txt"
grep -q '^VALID' "$w/verify_groth16.txt"
"$host" groth16-args "$w/u_groth16.bin" "$w/u_args.json" --rule > /dev/null
grep -E '^(journal sha256|journal.verdict)' "$w/verify_groth16.txt"
echo "groth16 done"
