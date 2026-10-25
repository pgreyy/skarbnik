// Small pieces shared by the screens: HTML escaping, status badges, links to transactions and to the Account page,
// shortened hashes with Copy and "Show full", tables that turn into stacked rows on a phone, times in UTC and local
// time, the toast, and the PASS stamp.
import { EXPLORER_TX } from './chain.js';

export const $ = (s, el = document) => el.querySelector(s);
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const badge = (variant, text) => `<span class="m-badge b-${variant}">${esc(text)}</span>`;
export const shortId = (h) => (h.length > 18 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);

// A transaction id, shortened, linking to the testnet explorer.
export const tx = (hash) => `<a class="k-mono" href="${EXPLORER_TX}${encodeURIComponent(hash)}" rel="noopener" target="_blank" title="${esc(hash)}">${esc(shortId(hash))}</a>`;
// An account name, linking to this site's Account page.
export const acct = (a) => `<a class="k-mono k-hash" href="#/account/${encodeURIComponent(a)}">${esc(a)}</a>`;

// A long hash: first 8 and last 6 characters, with Copy and Show full (handled once, in initUi).
export const hashCell = (h) => `<span class="k-h"><code class="k-hs" data-full="${esc(h)}" data-short="${esc(shortId(h))}">${esc(shortId(h))}</code>` +
  `<span class="k-hb"><button class="k-mini" type="button" data-copy-text="${esc(h)}">Copy</button>` +
  `<button class="k-mini" type="button" data-toggle-full aria-expanded="false">Show full</button></span></span>`;

// A table: cols is a list of headings, rows a list of lists of HTML cells. On a phone each row stacks, each cell
// labelled with its column heading.
export function table(cols, rows, cls = '') {
  return `<div class="k-tw"><table class="k-table ${cls}"><thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((cell, i) => `<td data-label="${esc(cols[i])}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
// A two column table of facts: rows of [label, value HTML].
export const facts = (rows) => `<table class="k-kv"><tbody>${rows.filter(Boolean).map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;

// A moment (milliseconds) as UTC and as the visitor's own local time.
export function bothTimes(ms) {
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC (${d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} your time)`;
}

let toastTimer;
export function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2200); }

// The PASS stamp, shown only when the chain says an attempt passed.
export const passStamp = () => '<span class="k-stamp" role="img" aria-label="PASS">PASS</span>';

// One handler for every Copy and Show full button on the site.
export function initUi() {
  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy-text]');
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copyText); c.textContent = 'Copied'; toast('Copied.'); setTimeout(() => (c.textContent = 'Copy'), 1500); }
      catch { c.textContent = 'Select it'; }
      return;
    }
    const t = e.target.closest('[data-toggle-full]');
    if (t) {
      const code = t.closest('.k-h').querySelector('.k-hs'), open = t.getAttribute('aria-expanded') !== 'true';
      code.textContent = open ? code.dataset.full : code.dataset.short;
      code.classList.toggle('full', open);
      t.setAttribute('aria-expanded', open); t.textContent = open ? 'Show short' : 'Show full';
    }
  });
}
