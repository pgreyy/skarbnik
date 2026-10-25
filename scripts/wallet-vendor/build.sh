#!/usr/bin/env bash
# Rebuilds web/vendor/near-connect.js from the exact version in package.json and package-lock.json: NEAR Connect, the
# wallet connector the NEAR docs recommend, bundled into one file so the site loads it from its own folder with no build
# step and no CDN. The wallets' own scripts are not stored: each is loaded from its official address and checked by sha256 (see fetch_wallets.sh). Installs into target/wallet-build (ignored
# by git) with install scripts switched off, then prints the bundle's sha256 for docs/VERSIONS.md.
# Usage, from the repo root: ./scripts/wallet-vendor/build.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
B=target/wallet-build; mkdir -p "$B" web/vendor
cp scripts/wallet-vendor/package.json scripts/wallet-vendor/entry.js "$B/"
[ -f scripts/wallet-vendor/package-lock.json ] && cp scripts/wallet-vendor/package-lock.json "$B/"
( cd "$B" && if [ -f package-lock.json ]; then npm ci --ignore-scripts --no-audit --no-fund; else npm install --ignore-scripts --no-audit --no-fund; fi )
cp "$B/package-lock.json" scripts/wallet-vendor/package-lock.json
node "$B/node_modules/esbuild/bin/esbuild" "$B/entry.js" --bundle --format=esm --platform=browser --target=es2020 --minify \
  --legal-comments=eof --banner:js="// NEAR Connect (@hot-labs/near-connect 0.11.4), bundled by scripts/wallet-vendor/build.sh from the exact versions in scripts/wallet-vendor/package-lock.json. Do not edit; rebuild." --outfile=web/vendor/near-connect.js
sha256sum web/vendor/near-connect.js
