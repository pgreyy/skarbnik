#!/usr/bin/env bash
# Watches a Groth16 compression (the RISC Zero prover runs in a Docker container): samples every 2 s, until stopped, the
# laptop's available memory and the container's memory, and kills the container if available memory falls below
# KILL_BELOW_MIB (default 500 MiB, owner's setting of 2026-10-25). Writes samples and the peaks to its log.
# Usage: scripts/watch_mem.sh <log file> (run in the background; kill it when the compression ends).
log=$1; peak=0; minavail=999999
limit="${KILL_BELOW_MIB:-500}"
echo "REMINDER: close editor windows before a Groth16 run (it needs about 7 GiB). Available now: $(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo) MiB; the container is stopped below $limit MiB." >&2
while true; do
  avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  [ "$avail" -lt "$minavail" ] && minavail=$avail
  c=$(docker ps -q --filter ancestor=risczero/risc0-groth16-prover:v2025-04-03.1 | head -1)
  if [ -n "$c" ]; then
    m=$(docker stats --no-stream --format '{{.MemUsage}}' "$c" 2>/dev/null | awk '{print $1}')
    mib=$(python3 -c "import re,sys; s='$m'; v=float(re.match(r'[\d.]+',s).group()) if s else 0; u=s[len(re.match(r'[\d.]+',s).group()):] if s else 'MiB'; print(int(v*{'B':1/1048576,'KiB':1/1024,'MiB':1,'GiB':1024}.get(u,1)))" 2>/dev/null || echo 0)
    [ "$mib" -gt "$peak" ] && peak=$mib
    echo "$(date -u +%T) avail_mib=$avail container_mib=$mib" >> "$log"
    if [ "$avail" -lt "$limit" ]; then echo "$(date -u +%T) KILL: available memory below $limit MiB" >> "$log"; docker kill "$c" >> "$log" 2>&1; fi
  fi
  echo "peak_container_mib=$peak min_available_mib=$minavail" > "$log.peaks"
  sleep 2
done
