// Checks the colour contrast of the site (WCAG 2 relative luminance): reads the Panyl dark and light colour tokens from
// web/css/panyl.css and prints the contrast ratio of every text and background pair the site uses, in both modes,
// including the tinted chip backgrounds (the chip's colour at its alpha over a card). Text needs at least 4.5:1;
// control borders and the focus ring need 3:1 (non-text contrast).
// Usage, from the repo root: node scripts/contrast_check.mjs   (exit 1 if any pair is below its minimum)
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/css/panyl.css', import.meta.url), 'utf8');
const block = (sel) => {
  const i = css.indexOf(sel + '{'), body = css.slice(i + sel.length + 1, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):(#[0-9A-Fa-f]{6})/g)].map((x) => [x[1], x[2]]));
};
const modes = { Dark: block('.sk[data-th="panyl"],.sk[data-th="panyl"][data-md="dark"]'), Light: block('.sk[data-th="panyl"][data-md="light"]') };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c) => { const v = c.map((x) => x / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// a colour at alpha over a background
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

// [what, text token, background: token or [token, alpha, over token], minimum]
const PAIRS = [
  ['text on page', 'tx', 'bg', 4.5], ['text on card', 'tx', 's1', 4.5], ['text on selected', 'tx', 's2', 4.5], ['text on footer and rail', 'tx', 'bg2', 4.5],
  ['secondary text on page', 'tx2', 'bg', 4.5], ['secondary text on card', 'tx2', 's1', 4.5], ['secondary text on footer', 'tx2', 'bg2', 4.5],
  ['muted text on page', 'tx3', 'bg', 4.5], ['muted text on card', 'tx3', 's1', 4.5], ['muted text on selected', 'tx3', 's2', 4.5], ['muted text on footer', 'tx3', 'bg2', 4.5],
  ['amber (links, eyebrow) on page', 'am', 'bg', 4.5], ['amber on card', 'am', 's1', 4.5], ['amber on footer and rail', 'am', 'bg2', 4.5],
  ['mint (verified) on page', 'mn', 'bg', 4.5], ['mint on card', 'mn', 's1', 4.5], ['mint on footer', 'mn', 'bg2', 4.5],
  ['coral (rejected) on page', 'co', 'bg', 4.5], ['coral on card', 'co', 's1', 4.5],
  ['button text on primary button', 'on-btn', 'btn', 4.5], ['button text on primary hover', 'on-btn', 'btnh', 4.5],
  ['Proof verified chip', 'mn', ['mn', 0.09, 's1'], 4.5], ['Proof rejected chip', 'co', ['co', 0.09, 's1'], 4.5], ['Awaiting chip', 'am', ['am', 0.08, 's1'], 4.5],
  ['Timeout chip', 'tx', ['tx3', 0.16, 's1'], 4.5], ['Open chip', 'tx', ['am', 0.07, 's1'], 4.5], ['Refunded and test chips', 'tx2', 's1', 4.5],
  ['note text (amber tint)', 'tx2', ['am', 0.07, 'bg'], 4.5], ['who holds cell', 'am', ['am', 0.1, 's1'], 4.5], ['who sees cell', 'tx', ['tx', 0.07, 's1'], 4.5],
  ['control borders on page (non-text)', 'ln2', 'bg', 3], ['control borders on card (non-text)', 'ln2', 's1', 3], ['focus ring on page (non-text)', 'am', 'bg', 3], ['focus ring on card (non-text)', 'am', 's1', 3],
];
let bad = 0;
for (const [name, t] of Object.entries(modes)) {
  console.log(`${name}:`);
  for (const [what, fg, bg, min] of PAIRS) {
    const b = Array.isArray(bg) ? over(rgb(t[bg[0]]), bg[1], rgb(t[bg[2]])) : rgb(t[bg]);
    const r = ratio(rgb(t[fg]), b);
    const ok = r >= min;
    if (!ok) bad++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1  ${what}${min === 3 ? ' (needs 3:1)' : ''}`);
  }
}
console.log(bad ? `${bad} pair(s) below the minimum` : 'every pair passes');
process.exit(bad ? 1 : 0);
