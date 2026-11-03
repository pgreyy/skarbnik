// A small X at the right end of informational note boxes (the bordered boxes with the info icon), so a reader can
// close them. Closing hides the box and remembers it in this browser: localStorage, one key per box
// ("skarbnik-closed-<route>-<hash of the box's text>", value "1"), nothing else stored; if storage is blocked the box
// is hidden for this visit only. Not on warnings, errors, money or key safety notes (other icons, or data-keep), and
// not inside dialogs. The X is added by script, so the saved pages without JavaScript show the boxes without it.
import { icon } from './ui.js';

const PREFIX = 'skarbnik-closed-';
const closedThisVisit = new Set();
const hash = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); };
const route = () => (location.hash.match(/^#\/([a-z-]+)/) || [])[1] || 'home';
const keyOf = (el) => `${PREFIX}${route()}-${hash((el.querySelector(':scope > p') || el).textContent.replace(/\s+/g, ' ').trim())}`;
const isClosed = (k) => { if (closedThisVisit.has(k)) return true; try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const remember = (k) => { closedThisVisit.add(k); try { localStorage.setItem(k, '1'); } catch { /* storage blocked: this visit only */ } };
const informational = (el) => !el.hasAttribute('data-keep') && !el.closest('dialog, [role=alert]') && !!el.querySelector(':scope > svg use[href="#i-info"]');

function enhance(el) {
  if (el.hasAttribute('data-dm')) return;
  el.setAttribute('data-dm', '');
  if (!informational(el)) return;
  const k = keyOf(el);
  if (isClosed(k)) { el.hidden = true; return; }
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'note-x'; b.setAttribute('aria-label', 'Dismiss');
  b.innerHTML = `<span class="chev" aria-hidden="true">${icon('x')}</span>`;
  b.addEventListener('click', () => {
    remember(k);
    // the box folds away instead of vanishing, so the content below moves up smoothly; focus goes to the next thing
    const next = el.nextElementSibling;
    const h = el.offsetHeight;
    el.style.height = `${h}px`; el.classList.add('note-closing');
    requestAnimationFrame(() => { el.style.height = '0px'; });
    const done = () => { el.hidden = true; el.style.height = ''; el.classList.remove('note-closing'); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else { el.addEventListener('transitionend', done, { once: true }); setTimeout(done, 400); }
    if (next && next.focus) { if (!next.hasAttribute('tabindex') && !next.matches('a,button,summary,[tabindex]')) next.setAttribute('tabindex', '-1'); next.focus({ preventScroll: true }); }
  });
  el.classList.add('has-x');
  el.append(b);
}

const scan = (root) => { if (root.querySelectorAll) root.querySelectorAll('.note:not([data-dm])').forEach(enhance); };
// notes are added as pages draw: the observer runs before the browser paints, so a closed box never flashes
export function initDismiss() {
  scan(document);
  new MutationObserver(() => scan(document)).observe(document.body, { childList: true, subtree: true });
}
