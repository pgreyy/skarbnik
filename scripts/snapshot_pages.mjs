// Saves rendered copies of the key pages as real static HTML, for readers that run no JavaScript (crawlers, agents,
// curl): web/how-it-works/, web/bounties/24/, web/bounties/32/, web/bounties/17/, web/bounties/33/, web/evidence/,
// web/judge/, web/vendors/, web/agents/
// (each an index.html). For each one it opens the live route in a headless Chromium against a local copy of web/
// (which reads the chain like any visitor), waits for the data, shows every tab as a section, and writes the page's
// shell with that content in place of "Loading…", a snapshot time, the page's own title and canonical address, and
// <base href="/"> so the shared files load from any path. With JavaScript, js/app.js turns the path into its #/ route
// and draws the live page over the copy. Run it after the data scripts (scripts/rebuild_site_data.sh).
// Needs playwright-core and a Chromium: NODE_PATH=/path/to/node_modules CHROME=/path/to/chrome node scripts/snapshot_pages.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + '/' : import.meta.url);
const { chromium } = require('playwright-core');

const SITE = 'https://skarbnik.xyz';
const PAGES = [
  { path: 'how-it-works', route: '#/how-it-works', title: 'How it works · Skarbnik' },
  { path: 'bounties/24', route: '#/bounties/24', title: 'Bounty 24 · Skarbnik' },
  { path: 'bounties/32', route: '#/bounties/32', title: 'Bounty 32 · Skarbnik' },
  { path: 'bounties/17', route: '#/bounties/17', title: 'Bounty 17 · Skarbnik' },
  { path: 'bounties/33', route: '#/bounties/33', title: 'Bounty 33 · Skarbnik' },
  { path: 'evidence', route: '#/evidence', title: 'Proof and evidence · Skarbnik' },
  { path: 'judge', route: '#/judge', title: 'Judge guide · Skarbnik' },
  { path: 'vendors', route: '#/vendors', title: 'For vendors · Skarbnik' },
  { path: 'agents', route: '#/agents', title: 'For agents · Skarbnik' },
];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain', '.md': 'text/markdown', '.wasm': 'application/wasm' };

// A local copy of web/, served as the site would be.
const root = new URL('../web/', import.meta.url).pathname;
const server = createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.endsWith('/')) p += 'index.html';
  try { res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(join(root, p))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const shell = readFileSync(join(root, 'index.html'), 'utf8');
const at = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
// ONLY=vendors,agents saves just those pages (the others stay as they are)
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const entry of PAGES.filter((e) => !only || only.includes(e.path))) {
  await p.goto(base + entry.route, { waitUntil: 'networkidle' });
  await p.waitForTimeout(9000);
  // Every tab as a section with its own heading (a page tab's heading carries its short link id, so /agents/#connect
  // lands on it; a picker inside a tab gets a smaller heading); every drop down (details) and collapsible panel open;
  // tab buttons and interactive controls do nothing without JavaScript.
  const main = await p.evaluate(() => {
    const view = document.querySelector('#view').cloneNode(true);
    for (const list of view.querySelectorAll('[role="tablist"]')) {
      const nested = !!list.parentElement.closest('[role="tabpanel"]');
      for (const t of list.querySelectorAll('[role="tab"]')) {
        const panel = view.querySelector(`#${CSS.escape(t.getAttribute('aria-controls'))}`);
        if (!panel) continue;
        panel.removeAttribute('hidden');
        const label = [...t.childNodes].filter((n) => n.nodeType === 3 || !n.classList || !(n.classList.contains('chip') || n.classList.contains('tab-sub'))).map((n) => n.textContent).join('').trim();
        const h = document.createElement(nested ? 'h4' : 'h2');
        h.className = nested ? 'ag-sub' : 'h2s'; h.style.margin = nested ? '20px 0 10px' : '48px 0 16px'; h.textContent = label;
        if (!nested && panel.id.startsWith('panel-')) h.id = panel.id.slice(6);
        panel.before(h);
      }
      list.remove();
    }
    view.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
    // the dismiss X is added by script (js/dismiss.js): the saved page shows every note without it
    view.querySelectorAll('.note-x').forEach((x) => x.remove());
    view.querySelectorAll('.note').forEach((n) => { n.classList.remove('has-x'); n.removeAttribute('data-dm'); n.hidden = false; });
    // the Agent quickstart card: a plain link to the file; its text under a plain heading below the grid
    for (const c of view.querySelectorAll('.qs-card')) {
      const panel = view.querySelector(`#${CSS.escape(c.getAttribute('aria-controls'))}`);
      c.removeAttribute('role'); c.removeAttribute('aria-expanded'); c.removeAttribute('aria-controls');
      const chev = c.querySelector('.chev'); if (chev) chev.remove();
      if (panel) { panel.removeAttribute('hidden'); const h = document.createElement('h3'); h.className = 'h3'; h.style.marginTop = '24px'; h.textContent = 'Agent quickstart'; c.closest('.qs-grid').after(h); h.after(panel); }
    }
    for (const b of view.querySelectorAll('[aria-expanded][aria-controls]')) {
      const body = view.querySelector(`#${CSS.escape(b.getAttribute('aria-controls'))}`);
      if (body) body.removeAttribute('hidden');
      const chev = b.querySelector('.chev'); if (chev) chev.remove();
      const span = document.createElement('span'); span.className = b.className; span.innerHTML = b.innerHTML; b.replaceWith(span);
    }
    view.querySelectorAll('button, dialog, [aria-live]:empty').forEach((e) => e.remove());
    return view.innerHTML;
  });
  const canonical = `${SITE}/${entry.path}/`;
  const note = `<p class="small faint" style="padding:16px 24px">A saved copy of <a href="/${entry.route}">this page</a>, made ${at} from the chain and the site's data files. With JavaScript the page shows the live data.</p>`;
  let html = shell
    .replace('<head>', '<head>\n<base href="/">')
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(entry.title)}</title>\n<link rel="canonical" href="${canonical}">`)
    .replace(/<div class="view" id="view">[\s\S]*?<\/main><\/div>/, `<div class="view" id="view">${note}${main}</div>`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, '<noscript><p style="padding:24px">You are reading a saved copy. For agents: <a href="/agents.md">agents.md</a>, <a href="/llms.txt">llms.txt</a>, <a href="/feed.json">feed.json</a>.</p></noscript>');
  if (!html.includes(main.slice(0, 200))) throw new Error(`${entry.path}: the shell's view did not match; nothing written`);
  mkdirSync(join(root, entry.path), { recursive: true });
  writeFileSync(join(root, entry.path, 'index.html'), html);
  console.log(`web/${entry.path}/index.html: ${html.length} bytes`);
}
await b.close();
server.close();
