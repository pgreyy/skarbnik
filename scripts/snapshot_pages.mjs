// Saves rendered copies of the key pages as real static HTML, for readers that run no JavaScript (crawlers, agents,
// curl): web/bounties/24/, web/bounties/32/, web/bounties/17/, web/evidence/, web/judge/, web/vendors/, web/agents/
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
  { path: 'bounties/24', route: '#/bounties/24', title: 'Bounty 24 · Skarbnik' },
  { path: 'bounties/32', route: '#/bounties/32', title: 'Bounty 32 · Skarbnik' },
  { path: 'bounties/17', route: '#/bounties/17', title: 'Bounty 17 · Skarbnik' },
  { path: 'evidence', route: '#/evidence', title: 'Evidence · Skarbnik' },
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
for (const entry of PAGES) {
  await p.goto(base + entry.route, { waitUntil: 'networkidle' });
  await p.waitForTimeout(9000);
  // Every tab as a section with its own heading; tab buttons and interactive controls do nothing without JavaScript.
  const main = await p.evaluate(() => {
    const view = document.querySelector('#view').cloneNode(true);
    for (const list of view.querySelectorAll('[role="tablist"]')) {
      const labels = Object.fromEntries([...list.querySelectorAll('[role="tab"]')].map((t) => [t.getAttribute('aria-controls'), t.textContent.trim()]));
      for (const panel of list.parentElement.querySelectorAll(':scope > [role="tabpanel"]')) {
        panel.removeAttribute('hidden');
        const h = document.createElement('h2'); h.className = 'h2s'; h.style.margin = '48px 0 16px'; h.textContent = labels[panel.id] || '';
        panel.before(h);
      }
      list.remove();
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
