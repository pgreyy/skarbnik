#!/usr/bin/env bash
# Writes the site's wallet list (web/vendor/wallets/manifest.json) for NEAR Connect. The repository keeps no copy of any
# wallet's script: each entry points at the wallet's official address and carries the sha256 of the bytes checked here;
# the site (web/js/wallet.js) refuses a script whose bytes differ. Wallets: Intear (testnet, web wallet) and NEAR CLI
# (signs in your own terminal; the page holds no key). MyNearWallet was removed: it is retired on 31 October 2026.
# Entries come from NEAR Connect's public manifest at a fixed commit; the NEAR CLI script at a fixed commit; Intear's
# script from the wallet's own site (no versioned address exists), so a new Intear release needs this script run again.
# Usage, from the repo root: ./scripts/wallet-vendor/fetch_wallets.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
SELECTOR=6766ea5e71864e5cbcbf5b70d2aeae23b20b60e9     # hot-dao/near-selector, 2026-10-14
NEARCLI=dc5cb123e3a8e42ed095739f4ea058b767a80ad2      # near/near-cli-connect, 2026-06-17
D=web/vendor/wallets; T=target/wallet-fetch; mkdir -p "$D" "$T"
INTEAR_URL="https://wallet.intear.tech/near-selector.js"
NEARCLI_URL="https://raw.githubusercontent.com/near/near-cli-connect/$NEARCLI/dist/near-cli.js"
curl -sfL -o "$T/manifest.json" "https://raw.githubusercontent.com/hot-dao/near-selector/$SELECTOR/repository/manifest.json"
curl -sfL -o "$T/near-cli.js" "$NEARCLI_URL"
curl -sfL -o "$T/intear-wallet.js" "$INTEAR_URL"
python3 -I - "$T" "$D/manifest.json" "$INTEAR_URL" "$NEARCLI_URL" <<'PY'
import hashlib, json, sys
t, out_path, intear_url, nearcli_url = sys.argv[1:]
src = json.load(open(t + "/manifest.json"))
keep = {"intear-wallet": (intear_url, "intear-wallet.js"), "near-cli": (nearcli_url, "near-cli.js")}
out = []
for w in src["wallets"]:
    if w["id"] in keep:
        url, local = keep[w["id"]]
        h = hashlib.sha256(open(t + "/" + local, "rb").read()).hexdigest()
        w = dict(w); w["executor"] = url; w["sha256"] = h; w["version"] = w["version"] + "+sha256-" + h[:16]
        out.append(w)
        print(h, url)
order = ["intear-wallet", "near-cli"]
out.sort(key=lambda w: order.index(w["id"]))
json.dump({"version": src["version"], "wallets": out}, open(out_path, "w"), indent=1)
PY
( cd "$D" && sha256sum manifest.json > SHA256SUMS && cat SHA256SUMS )
