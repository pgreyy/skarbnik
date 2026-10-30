#!/usr/bin/env bash
# Writes the site's wallet list (web/vendor/wallets/manifest.json) for NEAR Connect from NEAR Connect's own public
# wallet list (hot-dao/near-selector, at a fixed commit). The repository keeps no copy of any wallet's script: each entry
# points at the wallet's official script address and carries the sha256 of the bytes checked here; the site
# (web/js/wallet.js) refuses a script whose bytes differ. A script on GitHub is pinned to a fixed commit, not a branch;
# a script on a wallet's own site has no versioned address and is pinned by its sha256 only (a new release there stops
# that wallet on this site until this script runs again). Every wallet in NEAR Connect's list is kept with its own
# features; NEAR Connect itself shows on testnet only the wallets whose features say testnet. Two changes from upstream:
# MyNearWallet is left out (it no longer connected on testnet; removed 2026-10-30, before its 31 October 2026 closing);
# NEAR CLI stays at the commit tested on testnet through the site. Usage, from the repo root: ./scripts/wallet-vendor/fetch_wallets.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
SELECTOR=5385297f1ebd21af648c99fa347eac28ba55d462     # hot-dao/near-selector main, 2026-10-26
NEARCLI=dc5cb123e3a8e42ed095739f4ea058b767a80ad2      # near/near-cli-connect, tested through the site on testnet
D=web/vendor/wallets; T=target/wallet-fetch; mkdir -p "$D" "$T/pinned"
curl -sfL -o "$T/manifest.json" "https://raw.githubusercontent.com/hot-dao/near-selector/$SELECTOR/repository/manifest.json"
python3 -I - "$T" "$D/manifest.json" "$SELECTOR" "$NEARCLI" <<'PY'
import hashlib, json, re, subprocess, sys, urllib.request
t, out_path, selector, nearcli = sys.argv[1:]
src = json.load(open(t + "/manifest.json"))
branch_sha = {}
def pin(url, wid):
    m = re.match(r"https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/(?:refs/heads/)?(.+)$", url)
    if not m:
        return url  # a wallet's own site: pinned by sha256 only
    owner, repo, rest = m.groups()
    if (owner, repo) == ("hot-dao", "near-selector"):
        return f"https://raw.githubusercontent.com/{owner}/{repo}/{selector}/{rest.split('/', 1)[1]}"
    if (owner, repo) == ("near", "near-cli-connect"):
        return f"https://raw.githubusercontent.com/{owner}/{repo}/{nearcli}/{rest.split('/', 1)[1]}"
    # another repository on a branch: find the branch whose name matches the start of the path, pin its current commit
    parts = rest.split("/")
    for i in range(len(parts) - 1, 0, -1):
        br = "/".join(parts[:i])
        for _ in range(3):  # the GitHub API sometimes fails once; a branch that does not exist fails every time
            r = subprocess.run(["gh", "api", f"repos/{owner}/{repo}/commits/{br}", "-q", ".sha"], capture_output=True, text=True)
            if r.returncode == 0 and re.fullmatch(r"[0-9a-f]{40}", r.stdout.strip()):
                return f"https://raw.githubusercontent.com/{owner}/{repo}/{r.stdout.strip()}/{'/'.join(parts[i:])}"
    raise SystemExit(f"cannot pin {wid}: {url}")
out = []
for w in src["wallets"]:
    if w["id"] == "mynearwallet":
        continue  # no longer connects; left out of the site's list
    w = dict(w)
    url = pin(w["executor"], w["id"])
    req = urllib.request.Request(url, headers={"User-Agent": "skarbnik-wallet-pin"})
    data = urllib.request.urlopen(req, timeout=60).read()
    h = hashlib.sha256(data).hexdigest()
    w["executor"], w["sha256"] = url, h
    w["version"] = w.get("version", "1.0.0") + "+sha256-" + h[:16]
    perms = dict(w.get("permissions", {}))
    if isinstance(perms.get("allowsOpen"), list):  # drop the wallets' own development addresses
        perms["allowsOpen"] = [u for u in perms["allowsOpen"] if "localhost" not in u and ".local" not in u]
    w["permissions"] = perms
    out.append(w)
    print(f"{h}  {w['id']:<18} testnet={str(bool(w.get('features', {}).get('testnet'))):<5} {url}")
json.dump({"version": src["version"], "wallets": out}, open(out_path, "w"), indent=1)
PY
( cd "$D" && sha256sum manifest.json > SHA256SUMS && cat SHA256SUMS )
