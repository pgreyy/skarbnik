#!/usr/bin/env bash
# Keeps `skarbnik-vendor watch` running for the vendor's own user (no root, nothing system-wide): it restarts the watch
# 60 s after it stops, for any reason, and appends everything to ~/skarbnik-vendor/watch-service.log. Start it in a tmux
# session (it survives logging out), and add the same line to the user's crontab with @reboot so it comes back after a
# reboot:
#   tmux new-session -d -s skarbnik-watch ~/skarbnik/tools/vendor-service/run-watch.sh
#   (crontab -l 2>/dev/null; echo '@reboot tmux new-session -d -s skarbnik-watch ~/skarbnik/tools/vendor-service/run-watch.sh') | crontab -
# Expects the repository files in ~/skarbnik (tools/, scripts/s2_measure.sh, data/<module>/) and the binaries in
# ~/skarbnik/bin (skarbnik-host, skarbnik-check, r0vm, near); the watch config is ~/skarbnik-vendor/watch.toml.
set -u
LOG="$HOME/skarbnik-vendor/watch-service.log"
cd "$HOME/skarbnik" || exit 1
export PATH="$HOME/skarbnik/bin:$PATH"
while true; do
  echo "$(date -u +%FT%TZ) watch starting" >> "$LOG"
  python3 -I tools/skarbnik-vendor watch --config "$HOME/skarbnik-vendor/watch.toml" >> "$LOG" 2>&1
  echo "$(date -u +%FT%TZ) watch stopped (exit $?); restarting in 60 s" >> "$LOG"
  sleep 60
done
