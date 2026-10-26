// Checks the colour contrast of the site (WCAG 2 relative luminance): reads the Dark and Light colour tokens from
// web/css/app.css and prints the contrast ratio of every text and background pair the site uses, in both themes.
// Text needs at least 4.5:1 and the focus ring 3:1. The gold button's fill and offset shadow are printed for information
// (their colours are fixed by the approved design; the button is identified by its text, which passes).
// Usage, from the repo root: node scripts/contrast_check.mjs   (exit 1 if any pair is below its minimum)
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/css/app.css', import.meta.url), 'utf8');
const block = (sel) => {
  const m = css.match(new RegExp(sel.replace(/[[\]"().]/g, (c) => '\\' + c) + '\\{([^}]*)\\}'));
  return Object.fromEntries([...m[1].matchAll(/--([a-z]+):(#[0-9A-Fa-f]{6})/g)].map((x) => [x[1], x[2]]));
};
const themes = { Dark: block(':root,:root[data-theme="dark"]'), Light: block(':root[data-theme="light"]') };
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [what, foreground token or #hex, background token or #hex, minimum]
const PAIRS = [
  ['text on page', 'ink', 'bg', 4.5], ['text on panel', 'ink', 'panel', 4.5], ['text on row hover', 'ink', 'hover', 4.5],
  ['muted text on page', 'mut', 'bg', 4.5], ['muted text on panel', 'mut', 'panel', 4.5], ['muted text on row hover', 'mut', 'hover', 4.5],
  ['gold text on page (active menu, tab)', 'goldtext', 'bg', 4.5], ['gold text on panel', 'goldtext', 'panel', 4.5],
  ['button text on gold fill', 'onfill', 'goldfill', 4.5],
  ['data blue on page', 'data', 'bg', 4.5], ['data blue on panel', 'data', 'panel', 4.5], ['data blue on row hover', 'data', 'hover', 4.5],
  ['success on page', 'ok', 'bg', 4.5], ['success on panel', 'ok', 'panel', 4.5],
  ['page colour on text colour (pressed toggle, toast)', 'bg', 'ink', 4.5],
  ['focus ring against page (non-text)', 'focus', 'bg', 3], ['focus ring against panel (non-text)', 'focus', 'panel', 3],
  ['gold button fill against page (non-text, information only)', 'goldfill', 'bg', 0], ['gold button offset shadow against page (decoration, information only)', 'goldshadow', 'bg', 0],
  ['Skip intro chip text', 'skipink', 'skipbg', 4.5], ['panel text on page colour code block', 'ink', 'bg', 4.5],
];
let bad = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log(`== ${name}`);
  for (const [what, f, b, min] of PAIRS) {
    const fg = f.startsWith('#') ? f : t[f], bg = b.startsWith('#') ? b : t[b];
    const r = ratio(fg, bg), ok = r >= min;
    if (!ok) bad++;
    console.log(`${min === 0 ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  ${min ? `(min ${min})` : '        '}  ${what}: ${fg} on ${bg}`);
  }
}
console.log(bad ? `${bad} pair(s) below the minimum` : 'every pair passes');
process.exit(bad ? 1 : 0);
