// Small pieces shared by the screens: HTML escaping, status badges, explorer links, the toast, and the PASS stamp.
import { EXPLORER_TX, EXPLORER_ACCOUNT } from './chain.js';

export const $ = (s, el = document) => el.querySelector(s);
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const badge = (variant, text) => `<span class="m-badge b-${variant}">${esc(text)}</span>`;
export const tx = (hash) => `<a href="${EXPLORER_TX}${encodeURIComponent(hash)}" rel="noopener" target="_blank">${esc(hash)}</a>`;
export const acct = (a) => `<a class="m-a k-mono k-hash" style="padding:0" href="${EXPLORER_ACCOUNT}${encodeURIComponent(a)}" rel="noopener" target="_blank">${esc(a)}</a>`;

let toastTimer;
export function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2200); }

// The PASS stamp, shown only when the chain says an attempt passed.
export const passStamp = () => '<span class="k-stamp" role="img" aria-label="PASS">PASS</span>';
