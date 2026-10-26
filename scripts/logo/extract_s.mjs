// Converts the "S" of a font file (Google Fonts, OFL) into one SVG path in a 64 by 64 box, about 56 units tall, centred.
// Used for an earlier mark; the current mark (web/js/logo.js) comes as a path from the approved design.
import opentype from 'opentype.js';
const font = opentype.loadSync(process.argv[2]);
const g = font.charToGlyph('S');
const raw = g.getPath(0, 0, 1000);                // font units, y down
const bb = raw.getBoundingBox();
const h = bb.y2 - bb.y1, w = bb.x2 - bb.x1, s = 56 / h;
const ox = (64 - w * s) / 2 - bb.x1 * s, oy = (64 - h * s) / 2 - bb.y1 * s;
const p = g.getPath(ox, oy, 1000 * s);
const d = p.toPathData(2);
console.log(JSON.stringify({ d, width: +(w * s).toFixed(2), height: +(h * s).toFixed(2), box: p.getBoundingBox(), unitsPerEm: font.unitsPerEm, family: font.names.fontFamily.en, version: font.names.version.en, license: (font.names.license || {}).en }));
