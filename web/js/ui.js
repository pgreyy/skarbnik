// Small pieces shared by the screens: HTML escaping, line icons from the page's sprite, status and label chips,
// transaction chips that open the testnet explorer, links to the Account page, long hashes with Copy and Show full,
// tables inside a card that scrolls sideways on narrow screens, facts lists, tabs (arrow keys, Home and End), the
// toast, and times in UTC and local time.
import { EXPLORER_TX } from './chain.js';

export const $ = (s, el = document) => el.querySelector(s);
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (name, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const shortId = (h) => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);

// A chip: always a word, with an icon when given. cls is one of the design's chip classes (k-proof, k-timeout, ...).
export const chip = (cls, text, ic = null) => `<span class="chip ${cls}">${ic ? icon(ic) : ''}${esc(text)}</span>`;

// A transaction, shortened (first 8 and last 4 characters), linking to the testnet explorer; the full id is its title.
export const tx = (hash, label = null) => hash ? `<a class="tx" href="${EXPLORER_TX}${encodeURIComponent(hash)}" target="_blank" rel="noopener" title="${esc(hash)}" aria-label="Open ${label ? esc(label) + ' ' : ''}transaction ${esc(shortId(hash))} on the explorer (new tab)">${label ? `${esc(label)} <span class="faint">${esc(shortId(hash))}</span>` : esc(shortId(hash))}${icon('ext')}</a>` : '<span class="faint">not recorded</span>';
// An account name, linking to this site's Account page.
export const acct = (a) => `<a class="mono acct-link" style="color:var(--tx)" href="#/account/${encodeURIComponent(a)}">${esc(a)}</a>`;

// A long hash: first 8 and last 4 characters, with Copy and Show full (handled once, in initUi).
export const hashCell = (h) => `<span class="hsh"><code data-full="${esc(h)}" data-short="${esc(shortId(h))}">${esc(shortId(h))}</code>` +
  `<button class="mini" type="button" data-copy-text="${esc(h)}" aria-label="Copy the full value">Copy</button>` +
  `<button class="mini" type="button" data-toggle-full aria-expanded="false">Show full</button></span>`;

// A command with a Copy button.
export const cmd = (text) => `<div class="code-row"><p class="code">${esc(text)}</p><button class="mini" type="button" data-copy-text="${esc(text)}" aria-label="Copy the command">Copy</button></div>`;

// A table inside a card. cols: headings; rows: lists of HTML cells. cls adds a minimum width (wide, mid).
export function table(cols, rows, cls = 'mid', caption = '') {
  return `<div class="card scroll-x"><table class="tbl ${cls}">${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ''}<thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
// A facts list: rows of [label, value HTML]; empty rows are skipped.
export const facts = (rows) => `<dl class="facts">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
// A note that states a limit: amber outline, an icon, plain words.
export const note = (html, ic = 'info') => `<div class="note">${icon(ic)}<p>${html}</p></div>`;

// A moment (milliseconds) as UTC and as the visitor's own local time.
export function bothTimes(ms) {
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC (${d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} your time)`;
}

let toastTimer;
export function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2400); }

// One handler for every Copy and Show full button on the site.
export function initUi() {
  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy-text]');
    if (c) {
      const was = c.textContent;
      try { await navigator.clipboard.writeText(c.dataset.copyText); c.textContent = 'Copied'; } catch { c.textContent = 'Select it'; }
      setTimeout(() => (c.textContent = was), 1400);
      return;
    }
    const t = e.target.closest('[data-toggle-full]');
    if (t) {
      const code = t.closest('.hsh').querySelector('code'), open = t.getAttribute('aria-expanded') !== 'true';
      code.textContent = open ? code.dataset.full : code.dataset.short;
      t.setAttribute('aria-expanded', open); t.textContent = open ? 'Show short' : 'Show full';
    }
  });
}

// Tabs, one panel visible at a time. items: [{ id, label, html }]. The chosen tab is kept in the address as
// <base>/<id> (replaced in place), so a link to that address opens the same tab. Left and Right arrows, Home and End
// move between tabs. onShow(id) runs when a tab is shown.
export function tabbed(el, items, current, base, label, onShow = () => {}) {
  const cur = items.some((t) => t.id === current) ? current : items[0].id;
  el.innerHTML = `<div class="tabs" role="tablist" aria-label="${esc(label)}">${items.map((t) =>
    `<button class="tab" role="tab" type="button" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="${t.id === cur}" tabindex="${t.id === cur ? 0 : -1}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}</div>` +
    items.map((t) => `<div role="tabpanel" class="panel" id="panel-${t.id}" aria-labelledby="tab-${t.id}" tabindex="0"${t.id === cur ? '' : ' hidden'}>${t.html}</div>`).join('');
  const btns = [...el.querySelectorAll('[data-tab]')];
  const show = (id, focus) => {
    btns.forEach((b) => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    items.forEach((t) => { el.querySelector(`#panel-${t.id}`).hidden = t.id !== id; });
    if (base) history.replaceState(null, '', `${base}/${id}`);
    onShow(id);
  };
  btns.forEach((b, i) => {
    b.addEventListener('click', () => show(b.dataset.tab, false));
    b.addEventListener('keydown', (e) => {
      const n = e.key === 'ArrowRight' ? Math.min(btns.length - 1, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : null;
      if (n !== null) { e.preventDefault(); show(btns[n].dataset.tab, true); }
    });
  });
  onShow(cur);
  return show;
}

// A group of pressed-state buttons (the design's "seg" control). items: [{ id, label }]. Returns the HTML; bind() wires it.
export const seg = (items, cur, label, attr = 'data-seg') => `<div class="seg" role="group" aria-label="${esc(label)}">${items.map((t) =>
  `<button type="button" ${attr}="${esc(t.id)}" aria-pressed="${t.id === cur}">${t.label}</button>`).join('')}</div>`;
export function bindSeg(root, attr, onPick) {
  root.querySelectorAll(`[${attr}]`).forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll(`[${attr}]`).forEach((x) => x.setAttribute('aria-pressed', x === b));
    onPick(b.getAttribute(attr));
  }));
}
