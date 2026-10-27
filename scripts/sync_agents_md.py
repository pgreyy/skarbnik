#!/usr/bin/env python3
# Copies AGENTS.md (the repository's guide for AI agents) to web/agents.md, served at https://skarbnik.xyz/agents.md.
# Links to files in the repository become full GitHub links, since the site does not serve the repository. Run it after
# every edit to AGENTS.md: python3 -I scripts/sync_agents_md.py
import re

REPO = "https://github.com/pgreyy/skarbnik/blob/main/"
s = open("AGENTS.md", encoding="utf-8").read()
s = re.sub(r"\]\((?!https?://|#)([^)\s]+)\)", lambda m: f"]({REPO}{m.group(1)})", s)
open("web/agents.md", "w", encoding="utf-8").write(s)
print(f"web/agents.md: {len(s.splitlines())} lines, {len(re.findall(re.escape(REPO), s))} repository links")
