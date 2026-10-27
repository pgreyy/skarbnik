// Builds the Vinyl lockup for the README: the Vinyl mark (web/img/vinyl-mark-<mode>.svg) and the wordmark "Skarbnik"
// as it is in the site header (Chakra Petch 600, 22 px next to a 38 px mark, 12 px apart, heading tracking -0.006 em).
// The letters are turned into outlines, so the SVG needs no font where it is shown (GitHub loads no web fonts).
// Writes web/img/vinyl-lockup-light.svg (dark letters, for light pages) and web/img/vinyl-lockup-dark.svg.
// Needs opentype.js 1.3.4 and wawoff2 2.0.1. Usage, from the repo root:
//   NODE_PATH=/path/to/node_modules node scripts/logo/lockup.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + '/' : import.meta.url);
const opentype = require('opentype.js');
const wawoff2 = require('wawoff2');

const ttf = await wawoff2.decompress(readFileSync('web/fonts/chakra-petch-latin-600-normal.woff2'));
const font = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));
const MARK = 38, GAP = 12, SIZE = 22, TRACK = -0.006 * SIZE, H = 40;
const text = { light: '#1B2632', dark: '#E8E9DC' };

// The word, laid out glyph by glyph with the header's tracking, centred on the mark like the header's flex row.
let x = 0; const glyphs = font.stringToGlyphs('Skarbnik'), parts = [];
const scale = SIZE / font.unitsPerEm;
const asc = font.tables.os2.sCapHeight * scale;
for (let i = 0; i < glyphs.length; i++) {
  parts.push({ g: glyphs[i], x });
  x += glyphs[i].advanceWidth * scale + (i < glyphs.length - 1 ? font.getKerningValue(glyphs[i], glyphs[i + 1]) * scale + TRACK : 0);
}
const wordW = x, baseline = (H + asc) / 2, left = (H - MARK) / 2 + MARK + GAP;
const d = parts.map(({ g, x }) => g.getPath(left + x, baseline, SIZE).toPathData(2)).join('');
const W = Math.ceil(left + wordW + 2);

for (const mode of ['light', 'dark']) {
  const mark = readFileSync(`web/img/vinyl-mark-${mode}.svg`, 'utf8').replace(/^<svg[^>]*>\n?/, '').replace(/<\/svg>\s*$/, '');
  const off = (H - MARK) / 2, k = MARK / 40;
  writeFileSync(`web/img/vinyl-lockup-${mode}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Skarbnik">\n` +
    `<g transform="translate(${off} ${off}) scale(${k})">\n${mark}</g>\n<path fill="${text[mode]}" d="${d}"/>\n</svg>\n`);
  console.log(`web/img/vinyl-lockup-${mode}.svg ${W}x${H}`);
}
