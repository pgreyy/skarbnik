#!/usr/bin/env bash
# Copies the wallet scripts the site offers through NEAR Connect into web/vendor/wallets/, from pinned sources, and
# writes the site's own wallet list (manifest.json) pointing at those local copies. Wallets: Intear (testnet, web
# wallet) and NEAR CLI (signs in your own terminal; the page holds no key). MyNearWallet was removed: it is retired on
# 31 October 2026. Entries come from NEAR Connect's public manifest at a fixed commit; the NEAR CLI script at a fixed
# commit; Intear's script from the wallet's own site (no versioned address exists), recorded by sha256.
# Usage, from the repo root: ./scripts/wallet-vendor/fetch_wallets.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
SELECTOR=6766ea5e71864e5cbcbf5b70d2aeae23b20b60e9     # hot-dao/near-selector, 2026-10-14
NEARCLI=dc5cb123e3a8e42ed095739f4ea058b767a80ad2      # near/near-cli-connect, 2026-06-17
D=web/vendor/wallets; T=target/wallet-fetch; mkdir -p "$D" "$T"
curl -sfL -o "$T/manifest.json" "https://raw.githubusercontent.com/hot-dao/near-selector/$SELECTOR/repository/manifest.json"
curl -sfL -o "$D/near-cli.js" "https://raw.githubusercontent.com/near/near-cli-connect/$NEARCLI/dist/near-cli.js"
curl -sfL -o "$D/intear-wallet.js" "https://wallet.intear.tech/near-selector.js"
python3 -I - "$T/manifest.json" "$D/manifest.json" <<'PY'
import json, sys
src = json.load(open(sys.argv[1]))
keep = {"intear-wallet": "intear-wallet.js", "near-cli": "near-cli.js"}
out = []
for w in src["wallets"]:
    if w["id"] in keep:
        w = dict(w); w["executor"] = "vendor/wallets/" + keep[w["id"]]
        out.append(w)
order = ["intear-wallet", "near-cli"]
out.sort(key=lambda w: order.index(w["id"]))
json.dump({"version": src["version"], "wallets": out}, open(sys.argv[2], "w"), indent=1)
PY
( cd "$D" && sha256sum manifest.json intear-wallet.js near-cli.js > SHA256SUMS && cat SHA256SUMS )
