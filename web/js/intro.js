// The opening animation, "Handshake". Left: near_bounty.json, its lines dropping in one by one (about 0.4 s apart),
// with the public fields read live from the contract (get_bounty of bounty 17, a private bounty: its secret input and
// its reference fix are not in the repository) and the vendor only fields shown sealed. Right, at the same time: the
// mark draws itself (dashed circle and cross, then the S outline, then the finished mark and the name).
// Rules: it plays by itself only on the first visit in a browser (remembered in localStorage), only on the home page,
// never on a direct link such as #/bounties/7, and never when storage is blocked. "Replay the intro" plays it again.
// "Skip intro" (top right, always visible) and Esc close it; "[ faster ]" jumps to the end, "[ enter ]" closes it.
// It uses the page's colour tokens, so it follows the current light or dark mode. Reduced motion: the finished state at
// once. No value is invented: if the bounty cannot be read, the intro says so.
import { view, near, PUBLISHED_IMAGE_ID } from './chain.js';
import { esc } from './ui.js';
import { NAME, S_PATH, S_TRANSFORM, logo } from './logo.js';

const SEEN = 'skarbnik-intro-seen';
const BOUNTY = '17';
let running = false;

export function introWanted() {
  if (new URLSearchParams(location.search).get('intro') === '0') return false;
  const h = location.hash;
  if (h && h !== '#' && h !== '#/') return false; // never on a direct link
  try { return !localStorage.getItem(SEEN); } catch { return false; } // storage blocked: do not play by itself
}

const short = (h) => `${h.slice(0, 8)}…${h.slice(-6)}`;
const SEAL = '<span class="k-jseal" aria-hidden="true"><i></i><i></i><i></i></span><span class="sr-only">sealed</span>';

async function lines() {
  const q = (v) => `<span class="k-jv">"${esc(v)}"</span>`;
  const pub = (k, html) => ({ html: `<span class="k-jk">"${k}"</span>: ${html}`, tag: 'PUBLIC' });
  const seal = (k) => ({ html: `<span class="k-jk">"${k}"</span>: ${SEAL}`, tag: 'VENDOR ONLY' });
  let fields;
  try {
    const b = await view('get_bounty', { bounty_id: BOUNTY });
    fields = [pub('id', `<span class="k-jv data">${esc(b.id)}</span>`), pub('kind', q('private')), pub('reward', q(near(b.amount))),
      pub('attempts', q(`${b.commits} of ${b.max_commits}`)),
      pub('checker', `<span class="k-jv data" title="${esc(b.image_id)}">"${esc(short(b.image_id))}"</span> <button class="k-mini" type="button" data-copy-text="${esc(b.image_id)}">copy</button>`),
      seal('secret_input'), seal('reference_fix')];
  } catch {
    fields = [pub('id', `<span class="k-jv data">${BOUNTY}</span>`), pub('note', q('could not read the bounty from testnet')),
      pub('checker', `<span class="k-jv data" title="${PUBLISHED_IMAGE_ID}">"${short(PUBLISHED_IMAGE_ID)}"</span>`), seal('secret_input'), seal('reference_fix')];
  }
  return [{ html: '<span class="k-jk">{</span>', brace: true }, ...fields.map((f) => ({ ...f, ind: true })), { html: '<span class="k-jk">}</span>', brace: true }];
}

export async function startIntro() {
  if (running) return;
  running = true;
  try { localStorage.setItem(SEEN, '1'); } catch { /* ignore */ }
  const layer = document.getElementById('intro'), app = document.getElementById('app');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rows = await lines();
  layer.innerHTML = `
    <button class="k-skipi" type="button" id="skipIntro">Skip intro →</button>
    <div class="k-stage">
      <div class="k-json" aria-label="near_bounty.json, a private bounty read from the contract">
        <div class="k-jt"><span>near_bounty.json</span><span class="k-demo">Sealed fields</span></div>
        <div class="k-jb">${rows.map((r) => `<div class="k-jl${r.ind ? ' ind' : ''}"><span>${r.html}</span>${r.tag ? `<span class="k-vis">${r.tag}</span>` : '<span></span>'}</div>`).join('')}</div>
      </div>
      <div class="k-markcol"><div class="k-mark">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle class="k-guide dash" cx="32" cy="34" r="27"/><path class="k-guide" d="M2 34 H62 M32 4 V64"/>
          <path class="k-trace" transform="${S_TRANSFORM}" d="${S_PATH}"/>
          <g class="k-final">${logo(64).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>
        </svg>
        <div class="k-wm" aria-hidden="true">${NAME}</div>
      </div></div>
    </div>
    <div class="k-ctl"><button class="m-btn sec" type="button" id="introFast">[ faster ]</button><button class="m-btn" type="button" id="introEnter" hidden>[ enter ]</button></div>`;
  layer.hidden = false; layer.style.opacity = '1';
  app.setAttribute('aria-hidden', 'true'); app.inert = true;
  const ls = [...layer.querySelectorAll('.k-jl')], guides = [...layer.querySelectorAll('.k-guide')];
  const trace = layer.querySelector('.k-trace'), fin = layer.querySelector('.k-final'), wm = layer.querySelector('.k-wm');
  const fast = layer.querySelector('#introFast'), enter = layer.querySelector('#introEnter');
  const len = trace.getTotalLength();
  trace.style.strokeDasharray = `${len}`; trace.style.strokeDashoffset = `${len}`;
  const timers = [];
  const at = (ms, f) => timers.push(setTimeout(f, ms));
  const done = () => {
    timers.forEach(clearTimeout);
    ls.forEach((l) => l.classList.add('on')); guides.forEach((g) => (g.style.opacity = '1'));
    trace.style.transition = 'none'; trace.style.strokeDashoffset = '0'; trace.style.opacity = '0';
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
  ls.forEach((l, i) => at(250 + 400 * i, () => l.classList.add('on')));
  at(150, () => guides.forEach((g) => (g.style.opacity = '1')));
  at(500, () => { trace.style.transition = 'stroke-dashoffset 2s ease-in-out'; trace.style.strokeDashoffset = '0'; });
  at(2600, () => { fin.style.opacity = '1'; trace.style.transition = 'opacity .6s'; trace.style.opacity = '0'; });
  at(3100, () => { wm.style.opacity = '1'; });
  at(Math.max(3600, 250 + 400 * ls.length + 300), done);
}
