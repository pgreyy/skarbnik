// Small pieces shared by the screens: HTML escaping, line icons from the page's sprite, status and label chips,
// transaction chips that open the testnet explorer, links to the Account page, long hashes with Copy and Show full,
// tables inside a card that scrolls sideways on narrow screens, facts lists, tabs (arrow keys, Home and End), the
// toast, times in UTC and local time, multi-line code blocks with Copy, collapsible panels (a button with
// aria-expanded and the round chevron) and pickers (small tab groups whose panels can sit anywhere on the page).
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
  copyBtn(h).replace('class="cpy"', 'class="cpy inl"') +
  `<button class="mini" type="button" data-toggle-full aria-expanded="false">Show full</button></span>`;

// An icon only copy button, placed top right inside a code block (.cblk): 44 px tap target, aria-label and tooltip
// "Copy"; after a click the icon turns into a check mark for 1.5 s (handled once, in initUi). Without JavaScript the
// saved pages drop it, so a code block never shows a dead button.
export const copyBtn = (text, label = 'Copy') => `<button class="cpy" type="button" data-copy-text="${esc(text)}" aria-label="${esc(label)}" title="${esc(label)}">${icon('copy', 'i i-cp')}${icon('check', 'i i-ok')}</button>`;

// A command with a Copy button.
export const cmd = (text) => `<div class="cblk"><p class="code">${esc(text)}</p>${copyBtn(text)}</div>`;

// A block of several lines (settings, a prompt, commands) with a Copy button; label names it for screen readers.
export const block = (text) => `<div class="cblk"><pre class="code">${esc(text)}</pre>${copyBtn(text)}</div>`;

// A drop down panel, closed by default: a details element (works without JavaScript; Enter and Space open and close
// it), its title a summary with the round chevron that turns and goes amber when open. The saved copy for readers
// without JavaScript shows it open.
export const collapse = (id, title, body, open = false) => `<details class="clp" id="${esc(id)}"${open ? ' open' : ''}><summary class="clp-btn"><span>${title}</span><span class="chev" aria-hidden="true">${icon('chev')}</span></summary><div class="clp-b">${body}</div></details>`;

// A picker: a small tab group (role tablist) whose panels may sit anywhere, each with id <group>-<item id>.
// items: [{ id, label (one word), sub (a small second label, optional) }]. bindPicker wires clicks, the arrow keys,
// Home and End; onPick(id) runs after a change.
export const picker = (group, items, cur, label) => `<div class="apk" role="tablist" aria-label="${esc(label)}">${items.map((t) =>
  `<button class="apk-b" role="tab" type="button" id="${group}-t-${t.id}" aria-controls="${group}-${t.id}" aria-selected="${t.id === cur}" tabindex="${t.id === cur ? 0 : -1}" data-pick="${t.id}"><span class="apk-l">${t.label}</span>${t.sub ? `<span class="apk-s">${esc(t.sub)}</span>` : ''}</button>`).join('')}</div>`;
export const pickPanel = (group, id, cur, html) => `<div role="tabpanel" id="${group}-${id}" aria-labelledby="${group}-t-${id}"${id === cur ? '' : ' hidden'}>${html}</div>`;
export function bindPicker(root, onPick = () => {}) {
  const pickers = {};
  root.querySelectorAll('.apk').forEach((list) => {
    const btns = [...list.querySelectorAll('[data-pick]')];
    const show = (b, focus) => {
      btns.forEach((x) => { const on = x === b; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; const pn = document.getElementById(x.getAttribute('aria-controls')); if (pn) pn.hidden = !on; });
      if (focus) b.focus();
      onPick(b.dataset.pick, list);
    };
    pickers[list.getAttribute('aria-label')] = (id) => { const b = btns.find((x) => x.dataset.pick === id); if (b) show(b, false); };
    btns.forEach((b, i) => {
      b.addEventListener('click', () => show(b, false));
      b.addEventListener('keydown', (e) => {
        const n = e.key === 'ArrowRight' ? (i + 1) % btns.length : e.key === 'ArrowLeft' ? (i - 1 + btns.length) % btns.length : e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : null;
        if (n !== null) { e.preventDefault(); show(btns[n], true); }
      });
    });
  });
  return pickers;
}

// A table inside a card. cols: headings; rows: lists of HTML cells. cls adds a minimum width (wide, mid).
export function table(cols, rows, cls = 'mid', caption = '') {
  return `<div class="card scroll-x"><table class="tbl ${cls}">${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ''}<thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
// A facts list: rows of [label, value HTML]; empty rows are skipped.
export const facts = (rows) => `<dl class="facts">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
// A note that states a limit: amber outline, an icon, plain words.
// keep: a note about money or key safety, which never gets the dismiss X (js/dismiss.js)
export const note = (html, ic = 'info', keep = false) => `<div class="note"${keep ? ' data-keep' : ''}>${icon(ic)}<p>${html}</p></div>`;

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
      if (c.classList.contains('cpy')) {
        try { await navigator.clipboard.writeText(c.dataset.copyText); c.classList.add('done'); c.setAttribute('aria-label', 'Copied'); $('#live').textContent = 'Copied'; }
        catch { c.setAttribute('aria-label', 'Copy failed: select the text instead'); $('#live').textContent = 'Copy failed: select the text instead'; }
        setTimeout(() => { c.classList.remove('done'); c.setAttribute('aria-label', c.title || 'Copy'); }, 1500);
        return;
      }
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

// Tabs, one panel visible at a time. items: [{ id, label, sub (a small second label, optional), html }]. The chosen
// tab is kept in the address as <base>/<id>: replaced in place, or with push true added to the history, so the back
// button returns to the tab before. A link to that address opens the same tab. Left and Right arrows, Home and End
// move between tabs. onShow(id) runs when a tab is shown. tabNav lets the router show a tab of the page on screen
// without drawing the page again.
export const tabNav = { base: null, ids: [], show: null };
export function tabbed(el, items, current, base, label, onShow = () => {}, push = false) {
  const cur = items.some((t) => t.id === current) ? current : items[0].id;
  el.innerHTML = `<div class="tabs" role="tablist" aria-label="${esc(label)}">${items.map((t) =>
    `<button class="tab" role="tab" type="button" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="${t.id === cur}" tabindex="${t.id === cur ? 0 : -1}" data-tab="${t.id}">${esc(t.label)}${t.sub ? ` <span class="tab-sub">${esc(t.sub)}</span>` : ''}</button>`).join('')}</div>` +
    items.map((t) => `<div role="tabpanel" class="panel" id="panel-${t.id}" aria-labelledby="tab-${t.id}" tabindex="0"${t.id === cur ? '' : ' hidden'}>${t.html}</div>`).join('');
  const btns = [...el.querySelectorAll('[data-tab]')];
  let shown = cur;
  const show = (id, focus, fromRouter = false) => {
    btns.forEach((b) => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    items.forEach((t) => { el.querySelector(`#panel-${t.id}`).hidden = t.id !== id; });
    if (base && !fromRouter) {
      if (push && id !== shown) history.pushState(null, '', `${base}/${id}`); else history.replaceState(null, '', `${base}/${id}`);
    }
    shown = id;
    onShow(id);
  };
  btns.forEach((b, i) => {
    b.addEventListener('click', () => show(b.dataset.tab, false));
    b.addEventListener('keydown', (e) => {
      const n = e.key === 'ArrowRight' ? Math.min(btns.length - 1, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : null;
      if (n !== null) { e.preventDefault(); show(btns[n].dataset.tab, true); }
    });
  });
  if (base) Object.assign(tabNav, { base, ids: items.map((t) => t.id), show, el, onSub: null });
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
