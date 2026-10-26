#!/usr/bin/env bash
# Builds the site's raster icons: web/favicon-32.png and web/favicon-16.png from web/favicon.svg (the approved design's
# logo/favicon.svg: the S12 mark on a dark rounded tile), and the 512 px social image web/social.png (the mark and the
# wordmark "Skarbnik" in Fraunces 600 on the dark background), from the one mark in web/js/logo.js. Rendered with a
# headless Chromium; set CHROME to its path.
# Usage, from the repo root: CHROME=/path/to/chrome ./scripts/logo/build.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${CHROME:?set CHROME to a Chromium or headless shell binary}"
W=target/logo-build/render; mkdir -p "$W"
node --input-type=module - "$PWD" <<'JS'
import { writeFileSync, readFileSync } from 'node:fs';
const root = process.argv[2];
const fav = readFileSync(root + '/web/favicon.svg', 'utf8');
for (const n of [16, 32]) writeFileSync(`${root}/target/logo-build/render/fav${n}.html`,
  `<!doctype html><html><body style="margin:0;background:transparent"><div style="width:${n}px;height:${n}px">${fav.replace('<svg ', `<svg style="display:block;width:${n}px;height:${n}px" `)}</div></body></html>`);
const { logo } = await import(root + '/web/js/logo.js');
writeFileSync(`${root}/target/logo-build/render/social.html`, `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&display=block"></head>
<body style="--bg:#0A1424;margin:0;width:512px;height:512px;background:#0A1424;color:#E8EDF5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px">
${logo(250)}<div style="font-family:Fraunces,serif;font-weight:600;font-size:64px;letter-spacing:-.01em">Skarbnik</div></body></html>`);
JS
shot() { timeout 60 "$CHROME" --no-sandbox --headless --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 \
  --virtual-time-budget=5000 --window-size="$2,$2" --screenshot="$PWD/$3" "file://$PWD/$W/$1" > /dev/null 2>&1; }
shot fav16.html 16 web/favicon-16.png
shot fav32.html 32 web/favicon-32.png
shot social.html 512 web/social.png
for f in web/favicon.svg web/favicon-16.png web/favicon-32.png web/social.png; do printf '%8d bytes  %s\n' "$(stat -c %s "$f")" "$f"; done
