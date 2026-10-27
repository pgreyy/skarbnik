#!/usr/bin/env bash
# Builds every site icon from the Vinyl mark (web/img/vinyl-mark-dark.svg, the design's logo/vinyl-mark-dark.svg, which
# is also web/favicon.svg): favicon-16.png, favicon-32.png, favicon-48.png (the mark on a clear background),
# favicon.ico (16, 32 and 48 px inside), apple-touch-icon.png (180 px), icon-192.png and icon-512.png (the mark on the
# dark page colour, for site.webmanifest), and the 1200x630 social card social.png (the mark and the wordmark
# "Skarbnik" in Chakra Petch 600 on the dark page colour). Rendered with a headless Chromium; set CHROME to its path.
# Usage, from the repo root: CHROME=/path/to/chrome ./scripts/logo/build.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${CHROME:?set CHROME to a Chromium or headless shell binary}"
W=target/logo-build/render; mkdir -p "$W"
cp web/img/vinyl-mark-dark.svg web/favicon.svg
node --input-type=module - "$PWD" <<'JS'
import { writeFileSync, readFileSync } from 'node:fs';
const [root] = process.argv.slice(2);
const mark = readFileSync(root + '/web/img/vinyl-mark-dark.svg', 'utf8');
const font = root + '/web/fonts/chakra-petch-latin-600-normal.woff2';
const tile = (n, bg, pad) => `<!doctype html><html><body style="margin:0;background:${bg}"><div style="width:${n}px;height:${n}px;display:flex;align-items:center;justify-content:center">${mark.replace('<svg ', `<svg style="display:block;width:${n - 2 * pad}px;height:${n - 2 * pad}px" `)}</div></body></html>`;
for (const n of [16, 32, 48]) writeFileSync(`${root}/target/logo-build/render/fav${n}.html`, tile(n, 'transparent', 0));
writeFileSync(`${root}/target/logo-build/render/fav180.html`, tile(180, '#12120C', 22));
writeFileSync(`${root}/target/logo-build/render/fav192.html`, tile(192, '#12120C', 24));
writeFileSync(`${root}/target/logo-build/render/fav512.html`, tile(512, '#12120C', 64));
writeFileSync(`${root}/target/logo-build/render/social.html`, `<!doctype html><html><head><style>@font-face{font-family:U;font-weight:600;src:url(file://${font})}</style></head>
<body style="margin:0;width:1200px;height:630px;background:#12120C;display:flex;align-items:center;justify-content:center;gap:40px">
${mark.replace('<svg ', '<svg style="width:200px;height:200px" ')}<span style="font:600 96px/1 U;color:#E8E9DC;letter-spacing:-.6px">Skarbnik</span></body></html>`);
JS
shot() { timeout 60 "$CHROME" --no-sandbox --headless --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 \
  --virtual-time-budget=5000 --window-size="$2" --screenshot="$PWD/$3" "file://$PWD/$W/$1" > /dev/null 2>&1; }
for n in 16 32 48; do shot "fav$n.html" "$n,$n" "web/favicon-$n.png"; done
shot fav180.html 180,180 web/apple-touch-icon.png
shot fav192.html 192,192 web/icon-192.png
shot fav512.html 512,512 web/icon-512.png
shot social.html 1200,630 web/social.png
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
for f in web/favicon.svg web/favicon.ico web/favicon-16.png web/favicon-32.png web/favicon-48.png web/apple-touch-icon.png web/icon-192.png web/icon-512.png web/social.png; do printf '%8d bytes  %s\n' "$(stat -c %s "$f")" "$f"; done
