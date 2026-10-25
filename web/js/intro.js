// The opening animation, ported from the Gilt Arena handoff (intro/scene.js) and changed to real data only: a bounty
// with 3 attempt slots, no named players. Two fixes fail and each leaves a hairline crack; one fix holds; gold runs
// through the cracks; three gold rings show the checks of a real Proof 0 (bounty 12: the public tests from
// data/demo/public_tests.txt and the fresh inputs from docs/evidence/S18/verify_proof0.txt), then the PASS stamp and the
// logo. It follows the Light or Night theme every frame. It plays once per browser session, never with reduced motion,
// and never with ?intro=0 in the address. Skip intro or Escape ends it; focus then goes to the page heading.
// For checking frames by hand, ?introAt=<scene ms> holds the intro still at that moment (it then never ends by itself).
import { logo, NAME } from './logo.js';

const SCENE_LEN = 10200, TS = 1.5; // scene milliseconds; the scene clock runs 1.5 times real time (6.8 s real)
const PALS = {
  dark: { bg: '#120403', g0: 'rgba(255,170,120,0.07)', g1: 'rgba(0,0,0,0.5)', plate: '#1E0B07', line: '#F3E6D0', gold: '#E3B341', chipink: '#120403', hole: '#050101', hatch: 'rgba(243,230,208,0.28)', gfill: '#F3E6D0', gstroke: '#050101', stampsh: '#8E2616', under: '', ring: '#F3E6D0', lgold: '#E3B341', lbg: '#120403' },
  light: { bg: '#F4E6C8', g0: 'rgba(255,255,255,0.45)', g1: 'rgba(120,70,20,0.10)', plate: '#FFFAEF', line: '#2A0805', gold: '#E3B341', chipink: '#2A0805', hole: '#2A0805', hatch: 'rgba(251,239,217,0.28)', gfill: '#FFFFFF', gstroke: '#2A0805', stampsh: '#7E1D12', under: '#2A0805', ring: '#2A0805', lgold: '#A8740A', lbg: '#F4E6C8' },
};
const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const E = { o3: (x) => 1 - Math.pow(1 - x, 3), io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2), back: (x) => (x <= 0 ? 0 : 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2)) };
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

let labels = null; // filled from data/recorded.json before the first frame
async function loadLabels() {
  if (labels) return labels;
  const r = await (await fetch('data/recorded.json')).json();
  const t = r.notes.demo_public_tests.count, f = r.notes.bounty12_proof0.fuzz_count;
  labels = [`${t} of ${t} public tests`, `${f} of ${f} fresh inputs`, 'Proof accepted by the contract'];
  return labels;
}

function makeScene(W, H) {
  const M = W < 760, cx = W / 2, cy = M ? H * 0.44 : H * 0.46, R = Math.min(M ? 160 : 270, W * 0.42, H * 0.36);
  const ST = [-2.3, -0.4, 1.6]; // three attempt slots around the ring
  const AT = [{ who: 0, t0: 1500, res: 'f' }, { who: 1, t0: 2900, res: 'f' }, { who: 2, t0: 5200, res: 'p' }];
  const pol = (r, a) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  const r = rng(7); let n = 0;
  AT.forEach((a) => { if (a.res !== 'f') return; const base = ST[a.who] + 0.5, drift = ((n % 3) - 1) * 0.16, pts = [pol(R * 0.46, base)]; for (let i = 1; i <= 6; i++) { const f = i / 6; pts.push(pol(R * (0.46 + 0.31 * f) + (r() - 0.5) * R * 0.045, base + drift * f + (r() - 0.5) * 0.11)); } a.crack = pts; a.cn = n++; });
  const bez = (a, b, c2, p) => ({ x: (1 - p) * (1 - p) * a.x + 2 * (1 - p) * p * b.x + p * p * c2.x, y: (1 - p) * (1 - p) * a.y + 2 * (1 - p) * p * b.y + p * p * c2.y });
  const part = (c, pts, f) => { if (f <= 0) return; const k = pts.length - 1, m = Math.min(k, f * k); c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (let i = 1; i <= Math.floor(m); i++) c.lineTo(pts[i].x, pts[i].y); const fl = Math.floor(m); if (fl < k && m > fl) { const a = pts[fl], b = pts[fl + 1], q = m - fl; c.lineTo(a.x + (b.x - a.x) * q, a.y + (b.y - a.y) * q); } c.stroke(); };
  const slot = (c, x, y, z, fill, stroke) => { c.fillStyle = fill; c.strokeStyle = stroke; c.lineWidth = 2.2; c.beginPath(); c.moveTo(x - z, y - z); c.lineTo(x + z * 0.4, y - z); c.quadraticCurveTo(x + z, y - z, x + z, y - z * 0.4); c.lineTo(x + z, y + z); c.lineTo(x - z, y + z); c.closePath(); c.fill(); c.stroke(); };

  return function draw(c, t, theme) {
    const P = PALS[theme === 'light' ? 'light' : 'dark'], CRM = P.line, GOLD = P.gold;
    const hp = seg(t, 9000, 10000), fadeA = (1 - 0.82 * E.o3(seg(t, 8100, 8800))) * (1 - 0.9 * hp);
    c.globalAlpha = 1; c.fillStyle = P.bg; c.fillRect(0, 0, W, H);
    const gg = c.createRadialGradient(W * 0.3, H * 0.2, 20, W * 0.5, H * 0.5, W * 0.9); gg.addColorStop(0, P.g0); gg.addColorStop(1, P.g1); c.fillStyle = gg; c.fillRect(0, 0, W, H);
    c.globalAlpha = fadeA; c.lineCap = 'round'; c.lineJoin = 'round';
    const g = E.o3(seg(t, 100, 1300));
    c.beginPath(); c.arc(cx, cy, R * g, 0, 6.283); c.fillStyle = P.plate; c.fill();
    c.strokeStyle = CRM; [0.4, 0.62, 0.82, 1].forEach((f, i) => { c.lineWidth = i === 3 ? 4 : 1.6; c.globalAlpha = fadeA * (i === 3 ? 1 : 0.7); c.beginPath(); c.arc(cx, cy, R * f * g, 0, 6.283); c.stroke(); });
    c.globalAlpha = fadeA * 0.7; c.lineWidth = 1.4; c.beginPath(); for (let k = 0; k < 48; k++) { const a = k * 0.1309, r0 = R * 0.82 * g, r1 = R * (k % 4 ? 0.88 : 0.94) * g; c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); } c.stroke();
    c.globalAlpha = fadeA;
    // cracks: one hairline per failed fix, then gold runs through every one
    const mt = 5900;
    AT.forEach((a) => { if (!a.crack) return; const gr = E.o3(seg(t, a.t0 + 500, a.t0 + 1150)); if (gr > 0) { c.strokeStyle = CRM; c.lineWidth = 1.7; c.globalAlpha = fadeA * 0.8; part(c, a.crack, gr); }
      const m = E.o3(seg(t, mt + a.cn * 110, mt + a.cn * 110 + 520)); if (m > 0) { c.globalAlpha = fadeA; if (P.under) { c.strokeStyle = P.under; c.lineWidth = 6.4; part(c, a.crack, m); } c.strokeStyle = GOLD; c.lineWidth = 3.6; c.shadowColor = GOLD; c.shadowBlur = P.under ? 0 : 8; part(c, a.crack, m); c.shadowBlur = 0; } });
    c.globalAlpha = fadeA;
    // the sealed centre: the secret input nobody sees
    const sr = R * 0.4 * g; c.save(); c.beginPath(); c.arc(cx, cy, sr, 0, 6.283); c.fillStyle = P.hole; c.fill(); c.clip(); c.strokeStyle = P.hatch; c.lineWidth = 1.2; for (let k = -sr * 2; k < sr * 2; k += 8) { c.beginPath(); c.moveTo(cx + k, cy + sr); c.lineTo(cx + k + sr, cy - sr); c.stroke(); } c.restore(); c.strokeStyle = CRM; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, sr, 0, 6.283); c.stroke();
    // the attempts: each runs from its slot to the centre; a failed one returns
    const passT = 5200 + 900, frozen = t > passT;
    AT.forEach((a) => {
      if (t < a.t0) return; const st = ST[a.who]; const home = pol(R, st), tgt = pol(R * 0.46, st + 0.5), ctl = pol(R * 0.72, st - 0.55);
      const go = E.io(seg(t, a.t0, a.t0 + 600)); const ret = a.res === 'f' ? E.io(seg(t, a.t0 + 800, a.t0 + 1200)) : 0;
      if (frozen && a.res === 'f' && t > a.t0 + 1200) return;
      c.globalAlpha = fadeA; const trace = () => { c.beginPath(); for (let k = 0; k <= 24; k++) { const pt = bez(home, ctl, tgt, (k / 24) * Math.min(go, 1)); k ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y); } if (ret < 1) c.stroke(); };
      if (a.res === 'p' && P.under) { c.strokeStyle = P.under; c.lineWidth = 8.4; trace(); }
      c.strokeStyle = a.res === 'p' ? GOLD : rgba(CRM, 0.75); c.lineWidth = a.res === 'p' ? 5 : 2.5; if (a.res === 'p' && !P.under) { c.shadowColor = GOLD; c.shadowBlur = 10; } trace(); c.shadowBlur = 0;
      if (a.res === 'f' && go >= 1 && ret < 0.5) { c.strokeStyle = CRM; c.lineWidth = 3; c.beginPath(); c.moveTo(tgt.x - 8, tgt.y - 8); c.lineTo(tgt.x + 8, tgt.y + 8); c.moveTo(tgt.x + 8, tgt.y - 8); c.lineTo(tgt.x - 8, tgt.y + 8); c.stroke(); }
    });
    // the three slots on the ring, numbered; a used slot fills
    ST.forEach((a, i) => {
      const home = pol(R, a), at = AT[i], used = t > at.t0 + 800, z = (M ? 11 : 14) * E.back(seg(t, 700 + i * 120, 1200 + i * 120));
      const fill = used ? (at.res === 'p' ? GOLD : CRM) : P.gfill;
      c.globalAlpha = fadeA; slot(c, home.x, home.y, z, fill, P.gstroke);
      const lp = pol(R + (M ? 32 : 46), a); c.font = '700 12px "Space Mono", monospace'; c.textAlign = 'center'; c.fillStyle = CRM; c.fillText(`slot ${i + 1}`, lp.x, lp.y + 4);
    });
    // checks: three rings drawn in gold, with the real check sizes
    const vr = seg(t, 6500, 7900);
    if (vr > 0 && labels) {
      [0.46, 0.62, 0.82].forEach((f, i) => { const k = E.o3(seg(vr, i * 0.25, i * 0.25 + 0.4)); if (k <= 0) return; c.globalAlpha = fadeA; if (P.under) { c.strokeStyle = P.under; c.lineWidth = 7.4; c.beginPath(); c.arc(cx, cy, R * f, -1.5708, -1.5708 + 6.283 * k); c.stroke(); } c.strokeStyle = GOLD; c.lineWidth = 4; c.shadowColor = GOLD; c.shadowBlur = P.under ? 0 : 8; c.beginPath(); c.arc(cx, cy, R * f, -1.5708, -1.5708 + 6.283 * k); c.stroke(); c.shadowBlur = 0; });
      [[0.46, 0.2, 0.5], [0.62, 0.45, 0.75], [0.82, 0.7, 0.95]].forEach(([f, a0, a1], i) => { const k = E.o3(seg(vr, a0, a1)); if (k > 0.02) { c.globalAlpha = fadeA * k; c.font = '700 12px "Space Mono", monospace'; c.textAlign = 'center'; const s0 = labels[i], wd = c.measureText(s0).width; c.fillStyle = GOLD; c.fillRect(cx - wd / 2 - 5, cy - R * f - 19, wd + 10, 18); c.fillStyle = P.chipink; c.fillText(s0, cx, cy - R * f - 5); } });
    }
    // PASS stamp
    const ps = E.back(seg(t, 7600, 8100));
    if (ps > 0) { c.save(); c.translate(cx, cy); c.rotate(-0.14); c.globalAlpha = fadeA; const w = (M ? 118 : 150) * ps, h = (M ? 50 : 60) * ps; c.fillStyle = P.stampsh; c.fillRect(-w / 2 + 6, -h / 2 + 6, w, h); c.fillStyle = GOLD; c.fillRect(-w / 2, -h / 2, w, h); c.strokeStyle = P.gstroke; c.lineWidth = 3; c.strokeRect(-w / 2, -h / 2, w, h); c.fillStyle = P.chipink; c.font = `800 ${Math.round((M ? 32 : 40) * ps)}px Archivo, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('PASS', 0, 3); c.restore(); c.textBaseline = 'alphabetic'; }
    c.globalAlpha = 1;
    return { hp, P };
  };
}

const capWin = [[0, 1500], [1500, 5000], [5000, 7400], [7400, 8800]];
let raf = 0, running = false;

export function introWanted() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (new URLSearchParams(location.search).get('intro') === '0') return false;
  if (new URLSearchParams(location.search).has('introAt')) return true;
  try { if (sessionStorage.getItem('kintsugi-intro')) return false; } catch { /* storage blocked: play once per load */ }
  return true;
}

export async function startIntro(replay) {
  if (running) return;
  const layer = document.getElementById('intro'), app = document.getElementById('app'), canvas = document.getElementById('introCanvas');
  const caps = [0, 1, 2, 3].map((i) => document.getElementById('cap' + i)), word = document.getElementById('introWord');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { await loadLabels(); } catch { labels = null; }
  try { sessionStorage.setItem('kintsugi-intro', '1'); } catch { /* ignore */ }
  word.innerHTML = `${logo(110)}<span>${NAME}</span>`;
  running = true; layer.hidden = false; layer.style.opacity = '1'; layer.style.display = '';
  app.setAttribute('aria-hidden', 'true'); app.inert = true;
  const skip = document.getElementById('skipIntro'); skip.focus();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W, H, draw;
  const size = () => { W = layer.clientWidth; H = layer.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; draw = makeScene(W, H); };
  size(); window.addEventListener('resize', size);
  const ctx = canvas.getContext('2d');
  const t0 = performance.now();
  let ended = false;
  const finish = () => {
    if (ended) return; ended = true; cancelAnimationFrame(raf); window.removeEventListener('resize', size); document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      layer.style.opacity = '0';
      setTimeout(() => { layer.hidden = true; app.removeAttribute('aria-hidden'); app.inert = false; running = false; const h1 = document.querySelector('#main h1'); if (h1) h1.focus({ preventScroll: true }); }, reduce ? 0 : 520);
    }, reduce ? 0 : 350);
  };
  const onKey = (e) => { if (e.key === 'Escape') finish(); };
  document.addEventListener('keydown', onKey);
  skip.onclick = finish;
  // Reduced motion (only reachable through "Replay the intro"): three still frames, about 5.4 s.
  const stills = [3000, 7000, 8300];
  const at = new URLSearchParams(location.search).get('introAt'), hold = at !== null && /^\d+$/.test(at) ? Number(at) : null;
  const frame = (now) => {
    const real = now - t0, theme = document.documentElement.getAttribute('data-theme');
    const t = hold !== null ? hold : reduce ? stills[Math.min(2, Math.floor(real / 1800))] : real * TS;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { hp } = draw(ctx, t, theme);
    caps.forEach((el, i) => { const [a, b] = capWin[i]; const on = seg(t, a + 100, a + 600) * (1 - seg(t, b - 400, b)); el.style.opacity = String(on * (1 - hp)); el.style.transform = `translateY(${(1 - E.o3(seg(t, a, a + 600))) * 12}px)`; });
    const lg = E.o3(seg(t, 8700, 9300)) * (1 - seg(t, 9600, 10100)); word.style.opacity = String(lg); word.style.transform = `scale(${0.9 + 0.1 * lg})`;
    if (hold === null && ((reduce && real >= 5400) || (!reduce && t >= SCENE_LEN))) { finish(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  if (replay) window.scrollTo(0, 0);
}
