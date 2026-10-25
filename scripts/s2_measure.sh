#!/usr/bin/env bash
# Spike S2: runs one host command (normally a proof) and measures the RISC Zero prover's memory while it
# runs. Every 5 s it reads the r0vm process's peak resident memory (VmHWM in /proc) and the machine's
# available memory. If r0vm passes MAX_RSS_MIB or available memory drops under MIN_AVAIL_MIB, it stops
# r0vm and the host by their exact PIDs, so the rest of the machine keeps running. If MAX_SECONDS is set and
# the run is still going after that many seconds, it is stopped the same way (a time limit).
# Usage, from the repo root:
#   scripts/s2_measure.sh <log file> -- ./target/release/kintsugi-host prove data/demo/fixed.wasm --demo-salt --fuzz-count 16 --po2 19 --out target/s2/receipt_f16.bin
# Writes the host output plus wall_seconds, r0vm_peak_rss_mib, min_available_mib and a stop reason to the log.
set -uo pipefail
LOG="$1"; shift; [ "$1" = "--" ] && shift
MAX_RSS_MIB="${MAX_RSS_MIB:-6144}"
MIN_AVAIL_MIB="${MIN_AVAIL_MIB:-1536}"
MAX_SECONDS="${MAX_SECONDS:-0}"
mkdir -p "$(dirname "$LOG")"
{ echo "\$ RISC0_DEV_MODE=0 $*"; echo "utc_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "limits: max_rss_mib=$MAX_RSS_MIB min_avail_mib=$MIN_AVAIL_MIB max_seconds=$MAX_SECONDS"; } > "$LOG"
start=$(date +%s.%N)
RISC0_DEV_MODE=0 "$@" >> "$LOG" 2>&1 &
host=$!
peak=0; min_avail=999999; reason="finished"
while kill -0 "$host" 2>/dev/null; do
  sleep 5
  avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  [ "$avail" -lt "$min_avail" ] && min_avail=$avail
  for p in $(pgrep -x r0vm); do
    hwm=$(awk '/VmHWM/{print int($2/1024)}' /proc/"$p"/status 2>/dev/null); hwm=${hwm:-0}
    [ "$hwm" -gt "$peak" ] && peak=$hwm
  done
  elapsed=$(python3 -c "print(int($(date +%s.%N)-$start))")
  if [ "$MAX_SECONDS" -gt 0 ] && [ "$elapsed" -ge "$MAX_SECONDS" ]; then
    reason="stopped: time limit of ${MAX_SECONDS} s reached"
    for p in $(pgrep -x r0vm); do kill "$p"; done
    kill "$host" 2>/dev/null
    break
  fi
  if [ "$peak" -gt "$MAX_RSS_MIB" ] || [ "$avail" -lt "$MIN_AVAIL_MIB" ]; then
    reason="stopped: r0vm peak ${peak} MiB, available ${avail} MiB"
    for p in $(pgrep -x r0vm); do kill "$p"; done
    kill "$host" 2>/dev/null
    break
  fi
done
wait "$host"; rc=$?
end=$(date +%s.%N)
{ echo "exit=$rc"; echo "wall_seconds=$(python3 -c "print(round($end-$start,2))")"
  echo "r0vm_peak_rss_mib=$peak (VmHWM, sampled every 5 s)"; echo "min_available_mib=$min_avail"; echo "result: $reason"; } >> "$LOG"
tail -8 "$LOG"
