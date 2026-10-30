#!/usr/bin/env bash
# Safety net for the confidential proving spike, run in its own tmux session on the VPS next to attempt_in_tee.py:
# every 5 minutes it reads the Phala balance and the CVM list, and deletes every CVM in the workspace when the balance
# is at or below the floor ($1.05: the owner's $4 cap from the $5 credit, with room for the last minutes billed), or
# when the driver (its tmux session) is gone while a CVM still exists. It stops by itself once the driver has ended
# and the CVM list is empty. Usage: cvm_watchdog.sh <driver tmux session> <log file>
set -u
SESSION="$1"; LOG="$2"; P="$HOME/skarbnik-tee/vendor/phala.py"; FLOOR=1.05
cd "$(dirname "$LOG")"
while true; do
  BAL=$(python3 "$P" balance 2>&1 | sed -n 's/.*balance \$\([0-9.]*\).*/\1/p')
  LIST=$(python3 "$P" list 2>&1); N=$(echo "$LIST" | sed -n 's/.*HTTP 200, \([0-9]*\) CVM.*/\1/p')
  ALIVE=$(tmux has-session -t "$SESSION" 2>/dev/null && echo yes || echo no)
  echo "$(date -u +%FT%TZ) balance \$${BAL:-?} CVMs ${N:-?} driver ${ALIVE}" >> "$LOG"
  if [ -n "$N" ] && [ "$N" -gt 0 ]; then
    if { [ -n "$BAL" ] && python3 -c "import sys; sys.exit(0 if float('$BAL') <= $FLOOR else 1)"; } || [ "$ALIVE" = no ]; then
      echo "$(date -u +%FT%TZ) DELETING every CVM (balance \$${BAL:-?}, driver ${ALIVE})" >> "$LOG"
      for id in $(echo "$LIST" | grep -o "'id': '[^']*'" | cut -d"'" -f4); do python3 "$P" delete "$id" >> "$LOG" 2>&1; done
    fi
  elif [ "$ALIVE" = no ]; then
    echo "$(date -u +%FT%TZ) driver ended and no CVM left: watchdog stops" >> "$LOG"; exit 0
  fi
  sleep 300
done
