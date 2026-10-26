#!/usr/bin/env bash
# Builds every site icon from web/favicon.svg (the approved design's logo/favicon.svg: the S12 mark on a dark rounded
# tile): favicon-16.png, favicon-32.png, favicon-48.png, favicon.ico (16, 32 and 48 px inside), apple-touch-icon.png
# (180 px), icon-192.png and icon-512.png (for site.webmanifest), and the 512 px social image social.png (the mark and
# the wordmark "Skarbnik" in Fraunces 600 on the dark background, from web/js/logo.js). Rendered with a headless
# Chromium; set CHROME to its path.
# Usage, from the repo root: CHROME=/path/to/chrome ./scripts/logo/build.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${CHROME:?set CHROME to a Chromium or headless shell binary}"
W=target/logo-build/render; mkdir -p "$W"
SIZES="16 32 48 180 192 512"
node --input-type=module - "$PWD" "$SIZES" <<'JS'
import { writeFileSync, readFileSync } from 'node:fs';
const [root, sizes] = process.argv.slice(2);
const fav = readFileSync(root + '/web/favicon.svg', 'utf8');
for (const n of sizes.split(' ').map(Number)) writeFileSync(`${root}/target/logo-build/render/fav${n}.html`,
  `<!doctype html><html><body style="margin:0;background:transparent"><div style="width:${n}px;height:${n}px">${fav.replace('<svg ', `<svg style="display:block;width:${n}px;height:${n}px" `)}</div></body></html>`);
const { logo } = await import(root + '/web/js/logo.js');
writeFileSync(`${root}/target/logo-build/render/social.html`, `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&display=block"></head>
<body style="--bg:#0A1424;margin:0;width:512px;height:512px;background:#0A1424;color:#E8EDF5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px">
${logo(250)}<div style="font-family:Fraunces,serif;font-weight:600;font-size:64px;letter-spacing:-.01em">Skarbnik</div></body></html>`);
JS
shot() { timeout 60 "$CHROME" --no-sandbox --headless --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 \
  --virtual-time-budget=5000 --window-size="$2,$2" --screenshot="$PWD/$3" "file://$PWD/$W/$1" > /dev/null 2>&1; }
for n in 16 32 48; do shot "fav$n.html" "$n" "web/favicon-$n.png"; done
shot fav180.html 180 web/apple-touch-icon.png
shot fav192.html 192 web/icon-192.png
shot fav512.html 512 web/icon-512.png
shot social.html 512 web/social.png
# favicon.ico: an ICO file holding the 16, 32 and 48 px PNGs as they are (PNG inside ICO)
python3 -I - web/favicon.ico web/favicon-16.png web/favicon-32.png web/favicon-48.png <<'PY'
import struct, sys
out, pngs = sys.argv[1], [open(p, 'rb').read() for p in sys.argv[2:]]
head = struct.pack('<HHH', 0, 1, len(pngs)); offset = 6 + 16 * len(pngs); entries = b''
for data in pngs:
    w, h = struct.unpack('>II', data[16:24])
    entries += struct.pack('<BBBBHHII', w % 256, h % 256, 0, 0, 1, 32, len(data), offset); offset += len(data)
open(out, 'wb').write(head + entries + b''.join(pngs))
PY
cat > web/site.webmanifest <<'JSON'
{
 "name": "Skarbnik",
 "short_name": "Skarbnik",
 "description": "Fix what you can’t see. Bounties for bugs that only crash on a secret input, on NEAR testnet.",
 "start_url": "./",
 "display": "browser",
 "background_color": "#0A1424",
 "theme_color": "#0A1424",
 "icons": [
  { "src": "icon-192.png?v=s12", "sizes": "192x192", "type": "image/png" },
  { "src": "icon-512.png?v=s12", "sizes": "512x512", "type": "image/png" },
  { "src": "favicon.svg?v=s12", "sizes": "any", "type": "image/svg+xml" }
 ]
}
JSON
for f in web/favicon.svg web/favicon.ico web/favicon-16.png web/favicon-32.png web/favicon-48.png web/apple-touch-icon.png web/icon-192.png web/icon-512.png web/social.png web/site.webmanifest; do printf '%8d bytes  %s\n' "$(stat -c %s "$f")" "$f"; done
