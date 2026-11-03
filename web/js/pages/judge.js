// Judge guide: the same guide as JUDGE_GUIDE.md, read from data/judge.json (made from it by scripts/gen_judge_data.py),
// so the page and the file never differ. A header, four door cards (Quick tab, Verify tab, For vendors, For agents),
// then four tabs with their own links (#/judge/quick, verify, claims, limits). Quick and Verify: numbered steps, each
// with its instruction, an optional command, a button, and a small box: You should see, This shows, Does not show.
// Claims: one table (Claim, See it, Does not prove). Limits: the short list and a link to every limit on Evidence. The
// guide's longer parts sit in closed drop downs under Verify and Claims. Only the site's own file is read: nothing
// waits on the chain.
import { $, esc, icon, note, cmd, collapse, tabbed } from '../ui.js';

const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });
const OLD = { a: 'quick', b: 'verify' }; // the earlier tabs, Level A and Level B

const ntab = (head, rows, caption, labels = null) => `<table class="n-tab jg-tab"><caption class="sr-only">${esc(caption)}</caption><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td>${labels && labels[i] ? `<span class="tlab">${esc(labels[i])} </span>` : ''}${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const body = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.cmd ? `<div class="stack g8">${p.cmd.split('\n').map(cmd).join('')}</div>` : ntab(p.table.head, p.table.rows, 'Table', p.table.head.map((h) => h.replace(/<[^>]+>/g, ''))))).join('');
const more = (sec, id) => (sec.more.length ? `<div class="stack g12">${sec.more.map((m, i) => collapse(`${id}${i}`, m.title, `<div class="stack g16">${body(m.body)}</div>`)).join('')}</div>` : '');

function stepCard(s) {
  const btn = s.button ? `<a class="btn btn-g btn-s" href="${esc(s.button.href)}"${s.button.ext ? ' target="_blank" rel="noopener"' : ''}>${s.button.label} ${icon(s.button.ext ? 'ext' : 'right')}</a>` : '';
  return `<li class="card jg-step"><span class="jg-n" aria-hidden="true">${esc(s.n)}</span><div class="stack g16">
    <h3 class="h3">${s.title}${s.time ? ` <span class="jg-time">${s.time}</span>` : ''}</h3>
    ${s.text.map((t) => `<p class="body">${t}</p>`).join('')}
    ${s.note ? note(s.note) : ''}
    ${s.cmds.length ? `<div class="stack g8">${s.cmds.flatMap((c) => c.split('\n')).map(cmd).join('')}</div>` : ''}
    ${btn ? `<div>${btn}</div>` : ''}
    <dl class="jg-box"><div><dt>You should see</dt><dd>${s.see}</dd></div><div><dt>This shows</dt><dd>${s.shows}</dd></div><div><dt>Does not show</dt><dd>${s.not}</dd></div></dl>
  </div></li>`;
}
const steps = (sec, label) => `<ol class="jg-steps" aria-label="${esc(label)}">${sec.steps.map(stepCard).join('')}</ol>`;

export async function judge(viewEl, tab) {
  let g;
  try { g = await json('data/judge.json'); } catch (e) {
    viewEl.innerHTML = `<main id="main" class="p-judge" tabindex="-1"><section class="n-ph"><div class="wrap"><h1>Judge guide</h1><p class="ferr" style="margin-top:20px">Could not read the guide: ${esc(e.message)}. It is JUDGE_GUIDE.md in the repository.</p></div></section></main>`;
    return;
  }
  const t0 = OLD[tab] || tab;
  const doors = [
    ['#/judge/quick', 'quick', '5 minutes', 'Check a paid bounty', 'eye'],
    ['#/judge/verify', 'verify', '30 minutes', 'Verify it yourself', 'term'],
    ['#/vendors', null, 'Try it', 'Host a bounty', 'coin'],
    ['#/agents', null, 'Try it', 'Connect an agent', 'cpu'],
  ];
  const q = g.quick, v = g.verify, c = g.claims, l = g.limits;
  const quick = `<div class="stack g28"><div style="max-width:760px" class="stack g12"><h2 class="h2s">Check a paid bounty</h2>${q.intro.map((p) => `<p class="body">${p}</p>`).join('')}</div>${steps(q, 'Quick steps')}${more(q, 'jq')}</div>`;
  const verify = `<div class="stack g28"><div style="max-width:760px" class="stack g12"><h2 class="h2s">Verify it yourself</h2>${v.intro.map((p) => `<p class="body">${p}</p>`).join('')}</div>${steps(v, 'Verify steps')}${more(v, 'jv')}</div>`;
  const claims = `<div class="stack g28"><div style="max-width:760px" class="stack g12"><h2 class="h2s">What is claimed, and where to see it</h2>${c.intro.map((p) => `<p class="body">${p}</p>`).join('')}</div>
    ${ntab(['Claim', 'See it', 'Does not prove'], c.rows.map((r) => [`<b>${r.claim}</b>`, r.see, r.not]), 'Claims', [null, 'See it', 'Does not prove'])}${more(c, 'jc')}</div>`;
  const limits = `<div class="stack g28"><div style="max-width:760px" class="stack g12"><h2 class="h2s">The limits, in short</h2>${l.intro.map((p) => `<p class="body">${p}</p>`).join('')}</div>
    <ul class="n-ul jg-lim">${l.items.map((i) => `<li>${icon('alert')}<span>${i}</span></li>`).join('')}</ul>
    <div><a class="lnk" href="${esc(l.link.href)}">${l.link.label} ${icon('right')}</a></div>${more(l, 'jl')}</div>`;
  viewEl.innerHTML = `<main id="main" class="p-judge" tabindex="-1">
<section class="n-ph"><div class="wrap stack g32">
<div style="max-width:760px" class="stack g20">
<p class="eyebrow">Judge guide</p>
<h1>${g.h1}</h1>
<p class="lead">${g.lead}</p>
</div>
<nav class="jg-doors" aria-label="Ways to check">${doors.map(([h, t, k, title, ic]) => `<a class="card jg-door" href="${h}"${t ? ` data-tablink="${t}"` : ''}><span class="vico">${icon(ic)}</span><span class="stack jg-dt"><span class="n-who">${esc(k)}</span><b class="h4">${esc(title)}</b></span>${icon('right')}</a>`).join('')}</nav>
${g.intro.map((p) => `<p class="small" style="max-width:760px">${p}</p>`).join('')}
</div></section>
<section style="padding:0 0 112px"><div class="wrap" id="jtabs"></div></section></main>`;
  const show = tabbed($('#jtabs'), [
    { id: 'quick', label: 'Quick', sub: '5 min', html: quick },
    { id: 'verify', label: 'Verify', html: verify },
    { id: 'claims', label: 'Claims', html: claims },
    { id: 'limits', label: 'Limits', html: limits },
  ], t0, '#/judge', 'Judge guide sections', () => {}, true);
  if (tab && t0 !== tab) history.replaceState(null, '', `#/judge/${t0}`); // an old tab link (a, b) shows its new address
  viewEl.querySelectorAll('[data-tablink]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); show(a.dataset.tablink, true); $('#jtabs').scrollIntoView({ block: 'start' }); }));
}
