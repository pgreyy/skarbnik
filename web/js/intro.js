// The opening animation, "Handshake". Left: bounty_12.json, its lines dropping in one by one (about 0.4 s apart), with
// the public fields read live from the contract (get_bounty 12) and the vendor only fields shown sealed. Right, at the
// same time: the mark draws itself (dashed guides, then the S outline, then the finished mark and the name).
// Rules: it plays by itself only on the first visit in a browser (remembered in localStorage), only on the home page,
// never on a direct link such as #/bounties/7, and never when storage is blocked. "Replay the intro" plays it again.
// "Skip intro" (top right) and Esc close it at any time; "faster" jumps to the end. Reduced motion: the finished state
// is shown at once. No value is invented: a field that cannot be read says so.
import { view, near, PUBLISHED_IMAGE_ID } from './chain.js';
import { esc } from './ui.js';
import { NAME, S_PATH, CRACK } from './logo.js';

const SEEN = 'skarbnik-intro-seen';
let running = false;

export function introWanted() {
  if (new URLSearchParams(location.search).get('intro') === '0') return false;
  const h = location.hash;
  if (h && h !== '#' && h !== '#/') return false; // never on a direct link
  try { return !localStorage.getItem(SEEN); } catch { return false; } // storage blocked: do not play by itself
}

async function fields() {
  const pub = (k, v, cls = '') => ({ k, v, cls, tag: 'PUBLIC' });
  const sealed = (k) => ({ k, sealed: true, tag: 'VENDOR ONLY' });
  try {
    const b = await view('get_bounty', { bounty_id: '12' });
    return [pub('id', '12'), pub('kind', 'private secret input'), pub('reward', near(b.amount)),
      pub('attempts', `${b.commits} of ${b.max_commits} used`), pub('checker', b.image_id, 'data'),
      sealed('secret_input'), sealed('reference_fix')];
  } catch {
    return [pub('id', '12'), pub('note', 'could not read bounty 12 from testnet'), pub('checker', PUBLISHED_IMAGE_ID, 'data'),
      sealed('secret_input'), sealed('reference_fix')];
  }
}

const short = (h) => `${h.slice(0, 8)}…${h.slice(-6)}`;

export async function startIntro() {
  if (running) return;
  running = true;
  try { localStorage.setItem(SEEN, '1'); } catch { /* ignore */ }
  const layer = document.getElementById('intro'), app = document.getElementById('app');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rows = await fields();
  layer.innerHTML = `
    <button class="k-skipi" type="button" id="skipIntro">Skip intro →</button>
    <div class="k-json" aria-label="bounty_12.json, read from the contract">
      <div class="k-jt"><span>bounty_12.json</span><span>read from testnet</span></div>
      ${rows.map((r) => `<div class="k-jl"><span><span class="k-jk">${esc(r.k)}:</span> ${r.sealed
        ? '<span class="k-jseal"><span class="k-jbar" aria-hidden="true"></span><span class="sr-only">sealed</span></span>'
        : r.cls === 'data' ? `<span class="k-jv data" title="${esc(r.v)}">${esc(short(r.v))}</span> <button class="k-mini" type="button" data-copy-text="${esc(r.v)}">Copy</button>`
          : `<span class="k-jv">${esc(r.v)}</span>`}</span><span class="k-vis">${r.tag}</span></div>`).join('')}
    </div>
    <div class="k-markcol"><div class="k-mark">
      <svg viewBox="-4 -4 72 72" aria-hidden="true">
        <circle class="k-guide" cx="32" cy="32" r="30"/><line class="k-guide" x1="32" y1="-2" x2="32" y2="66"/><line class="k-guide" x1="-2" y1="32" x2="66" y2="32"/>
        <path class="k-trace" d="${S_PATH}"/>
        <g class="k-final"><path d="${S_PATH}" fill="#0A0A0A" stroke="#E3B04B" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="${CRACK}" fill="none" stroke="#0A0A0A" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="${CRACK}" fill="none" stroke="#E3B04B" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>
      </svg>
      <div class="k-wm" aria-hidden="true">${NAME.toUpperCase()}</div>
    </div></div>
    <div class="k-ctl"><button class="k-fast" type="button" id="introFast">[ faster ]</button><button class="k-enter" type="button" id="introEnter" hidden>[ enter ]</button></div>`;
  layer.hidden = false; layer.style.opacity = '1';
  app.setAttribute('aria-hidden', 'true'); app.inert = true;
  const lines = [...layer.querySelectorAll('.k-jl')], guides = [...layer.querySelectorAll('.k-guide')];
  const trace = layer.querySelector('.k-trace'), fin = layer.querySelector('.k-final'), wm = layer.querySelector('.k-wm');
  const fast = layer.querySelector('#introFast'), enter = layer.querySelector('#introEnter');
  const len = trace.getTotalLength();
  trace.style.strokeDasharray = `${len}`; trace.style.strokeDashoffset = `${len}`;
  const timers = [];
  const at = (ms, f) => timers.push(setTimeout(f, ms));
  const done = () => {
    timers.forEach(clearTimeout);
    lines.forEach((l) => l.classList.add('on')); guides.forEach((g) => (g.style.opacity = '1'));
    trace.style.transition = 'none'; trace.style.strokeDashoffset = '0';
    fin.style.opacity = '1'; wm.style.opacity = '1';
    fast.hidden = true; enter.hidden = false; enter.focus();
  };
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    timers.forEach(clearTimeout); document.removeEventListener('keydown', onKey);
    layer.style.opacity = '0';
    setTimeout(() => {
      layer.hidden = true; layer.innerHTML = ''; app.removeAttribute('aria-hidden'); app.inert = false; running = false;
      const h1 = document.querySelector('#main h1'); if (h1) h1.focus({ preventScroll: true });
    }, reduce ? 0 : 400);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey);
  layer.querySelector('#skipIntro').onclick = close;
  fast.onclick = done; enter.onclick = close;
  if (reduce) { done(); return; }
  layer.querySelector('#skipIntro').focus();
  lines.forEach((l, i) => at(300 + 400 * i, () => l.classList.add('on')));
  at(200, () => guides.forEach((g) => (g.style.opacity = '1')));
  at(700, () => { trace.style.transition = 'stroke-dashoffset 1.6s ease-in-out'; trace.style.strokeDashoffset = '0'; });
  at(2500, () => { fin.style.opacity = '1'; });
  at(3000, () => { wm.style.opacity = '1'; });
  at(Math.max(3400, 300 + 400 * lines.length + 200), done);
}
