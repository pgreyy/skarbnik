#!/usr/bin/env bash
# Rebuilds every generated file of the site, in order: the recorded transactions (scripts/gen_site_recorded.py), the
# agent feed (scripts/gen_feed.py), the Proof Ledger (scripts/gen_ledger.mjs), the Judge guide page data from
# JUDGE_GUIDE.md (scripts/gen_judge_data.py), web/agents.md from AGENTS.md (scripts/sync_agents_md.py), and the saved
# copies of the key pages for readers without JavaScript (scripts/snapshot_pages.mjs, which needs playwright-core and a
# Chromium: set NODE_PATH and CHROME). Usage, from the repo root: ./scripts/rebuild_site_data.sh
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -I scripts/gen_site_recorded.py
python3 -I scripts/gen_feed.py
node scripts/gen_ledger.mjs
python3 -I scripts/gen_judge_data.py
python3 -I scripts/sync_agents_md.py
: "${CHROME:?set CHROME (and NODE_PATH for playwright-core) to save the static pages}"
node scripts/snapshot_pages.mjs
