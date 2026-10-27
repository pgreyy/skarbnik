// Judge guide: the same guide as JUDGE_GUIDE.md, read from data/judge.json (made from it by scripts/gen_judge_data.py),
// so the page and the file never differ. Three tabs. Level A, the evidence tour: six steps, each with Do, Expect,
// Verify, What this proves and What it does not prove. Level B, local reproduction: seven steps, each with what it
// shows, what it needs, its download and memory, and the same three lines. Claims and evidence: every claim with its
// one label (Implemented, Demonstrated, Experimental, Planned, Not claimed) and its evidence, filterable.
import { $, icon, note, tabbed, seg, bindSeg } from '../ui.js';

const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });
const CL = { impl: ['l-impl', 'Implemented'], demo: ['l-demo', 'Demonstrated'], exp: ['l-exp', 'Experimental'], plan: ['l-plan', 'Planned'], none: ['k-fail', 'Not claimed'] };
const pn = (s) => `<div class="pn"><div><b>${icon('check')} What this proves</b><p>${s['What this proves']}</p></div><div><b>${icon('x')} What it does not prove</b><p>${s['What it does not prove']}</p></div></div>`;

export async function judge(viewEl, tab) {
  let g;
  try { g = await json('data/judge.json'); } catch (e) {
    viewEl.innerHTML = `<main id="main" class="p-judge" tabindex="-1"><section class="ph"><div class="wrap"><h1>Judge guide</h1><p class="ferr" style="margin-top:20px">Could not read the guide: ${e.message}. It is JUDGE_GUIDE.md in the repository.</p></div></section></main>`;
    return;
  }
  const steps = g.a.map((s) => `<div class="card step"><div class="sn"><b>${s.n}</b><span>${s.time}</span></div><div><h3 class="h3" style="margin-bottom:18px">${s.title}</h3><div class="dev">
    <div class="do"><h4>${icon('right')} Do</h4><p>${s.Do}</p></div><div><h4>${icon('eye')} Expect</h4><p>${s.Expect}</p></div><div><h4>${icon('check')} Verify</h4><p>${s.Verify}</p></div></div>${pn(s)}</div></div>`).join('');
  const cmds = g.b.map((s) => `<div class="card cmd"><div class="sn"><b>${s.n}</b></div><div><h3 class="h3 bshow">${s.shows}</h3>
    <div class="cmd-m m3"><div><b>Needs</b><p>${s.needs}</p></div><div><b>Download</b><p>${s.download}</p></div><div><b>Memory</b><p>${s.memory}</p></div></div>
    <div class="dev one mt16"><div class="do"><h4>${icon('eye')} Expect</h4><p>${s.Expect}</p></div></div>${pn(s)}</div></div>`).join('');
  const crows = (f) => g.claims.filter((c) => f === 'all' || c.label === f).map((c) => `<div class="lrow l3" role="listitem"><b style="color:var(--tx);font-weight:600">${c.claim}</b><div><span class="chip ${CL[c.label][0]}"${c.label === 'none' ? ' style="color:var(--tx2);border-color:var(--ln2)"' : ''}>${CL[c.label][1]}</span></div><p class="small cev">${c.evidence}</p></div>`).join('');
  const head = '<div class="lhead l3" aria-hidden="true"><span>Claim</span><span>Label</span><span>Evidence</span></div>';
  const count = (k) => g.claims.filter((c) => c.label === k).length;
  viewEl.innerHTML = `<main id="main" class="p-judge" tabindex="-1">
<section class="ph"><div class="wrap"><div class="ph-grid">
<div style="display:flex;flex-direction:column;gap:24px;max-width:660px">
<p class="eyebrow">Judge guide</p>
<h1>Check it in ten minutes</h1>
${g.intro.map((p, i) => `<p class="${i ? 'body' : 'lead'}">${p}</p>`).join('')}
</div>
<div style="display:flex;flex-direction:column;gap:14px">
<div class="card lv"><span class="vico">${icon('eye')}</span><div><b class="h4">Level A, evidence tour</b><p class="small" style="margin-top:4px">5 to 10 minutes. A browser and the explorer. No install.</p></div></div>
<div class="card lv"><span class="vico">${icon('term')}</span><div><b class="h4">Level B, local reproduction</b><p class="small" style="margin-top:4px">Optional. From a clone of the repository.</p></div></div>
</div></div></div></section>
<section style="padding:0 0 112px"><div class="wrap" id="jtabs"></div></section></main>`;
  tabbed($('#jtabs'), [
    { id: 'a', label: 'Level A: evidence tour', html: `<div style="display:flex;flex-direction:column;gap:28px"><div style="max-width:760px"><h2 class="h2s">Level A: evidence tour (5 to 10 minutes, no install)</h2>${g.a_intro.map((p) => `<p class="body" style="margin-top:12px">${p}</p>`).join('')}</div><div>${steps}</div></div>` },
    { id: 'b', label: 'Level B: reproduce', html: `<div style="display:flex;flex-direction:column;gap:28px"><div style="max-width:760px"><h2 class="h2s">Level B: reproduce (optional)</h2>${g.b_intro.map((p) => `<p class="body" style="margin-top:12px">${p}</p>`).join('')}</div><div>${cmds}</div>${g.b_notes.map((p, i) => (i === g.b_notes.length - 1 ? note(p, 'alert') : `<p class="body">${p}</p>`)).join('')}</div>` },
    { id: 'claims', label: 'Claims and evidence', html: `<div style="display:flex;flex-direction:column;gap:28px"><div style="display:flex;flex-wrap:wrap;gap:20px;justify-content:space-between;align-items:end"><div style="max-width:660px"><h2 class="h2s">Claims and their evidence</h2>${g.claims_intro.map((p) => `<p class="body" style="margin-top:12px">${p}</p>`).join('')}</div>
      ${seg([['all', 'All', g.claims.length], ...Object.keys(CL).map((k) => [k, CL[k][1], count(k)])].map(([id, l, c]) => ({ id, label: `${l} <span style="color:var(--tx3)">${c}</span>` })), 'all', 'Filter claims', 'data-cf')}</div>
      <div class="blist" role="list" aria-label="Claims" id="crows">${head}${crows('all')}</div></div>` },
  ], tab, '#/judge', 'Judge guide sections');
  bindSeg($('#jtabs'), 'data-cf', (f) => { $('#crows').innerHTML = `${head}${crows(f)}`; });
}
