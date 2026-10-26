#!/usr/bin/env bash
# Builds the site's icons from the one mark in web/js/logo.js: web/favicon.svg, web/favicon-32.png, web/favicon-16.png
# and the 512 px social image web/social.png (the mark and the name on the dark background). The PNGs are rendered with
# a headless Chromium; set CHROME to its path. The S outline itself comes from scripts/logo/extract_s.mjs.
# Usage, from the repo root: CHROME=/path/to/chrome ./scripts/logo/build.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${CHROME:?set CHROME to a Chromium or headless shell binary}"
W=target/logo-build/render; mkdir -p "$W"
node --input-type=module - "$PWD" <<'JS'
import { writeFileSync } from 'node:fs';
const root = process.argv[2];
const { S_PATH, CRACK } = await import(root + '/web/js/logo.js');
const mark = `<path d="${S_PATH}" fill="#0A0A0A" stroke="#E3B04B" stroke-width="1.6" stroke-linejoin="round"/>` +
  `<path d="${CRACK}" fill="none" stroke="#0A0A0A" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${CRACK}" fill="none" stroke="#E3B04B" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
writeFileSync(root + '/web/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n<!-- The Skarbnik mark (same drawing as web/js/logo.js): Archivo ExtraBold S, gold outline, gold crack. -->\n${mark}\n</svg>\n`);
for (const n of [16, 32]) writeFileSync(`${root}/target/logo-build/render/fav${n}.html`,
  `<!doctype html><html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${n}" height="${n}" style="display:block">${mark}</svg></body></html>`);
writeFileSync(`${root}/target/logo-build/render/social.html`, `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@800&text=SKARBNIK&display=block"></head>
<body style="margin:0;width:512px;height:512px;background:#0A1424;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="260" height="260">${mark}</svg>
<div style="font-family:Archivo,sans-serif;font-weight:800;font-size:46px;letter-spacing:.06em;color:#E8EDF5">SKARBNIK</div></body></html>`);
JS
shot() { timeout 60 "$CHROME" --no-sandbox --headless --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 \
  --virtual-time-budget=4000 --window-size="$2,$2" --screenshot="$PWD/$3" "file://$PWD/$W/$1" > /dev/null 2>&1; }
shot fav16.html 16 web/favicon-16.png
shot fav32.html 32 web/favicon-32.png
shot social.html 512 web/social.png
for f in web/favicon.svg web/favicon-16.png web/favicon-32.png web/social.png; do printf '%8d bytes  %s\n' "$(stat -c %s "$f")" "$f"; done
