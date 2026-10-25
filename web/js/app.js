// The Skarbnik site app: routes (#/, #/bounties, #/bounties/<id>, #/raw/<id>, #/account/<name>, #/arena, #/verify), the
// theme switcher, the mobile menu, and the screens. Live screens read the testnet contract with view calls
// (js/chain.js); recorded parts read data/recorded.json, which scripts/gen_site_recorded.py builds from files in the
// repository. No sample data.
import { CONTRACT, EXPLORER_ACCOUNT, PUBLISHED_IMAGE_ID, view, allBounties, submissions, near, utc, span, left, commitBy, nsToDate } from './chain.js';
import { logo, NAME } from './logo.js';
import { startIntro, introWanted } from './intro.js';
import { $, esc, badge, tx, acct, hashCell, table, facts, initUi, tabbed } from './ui.js';
import { initAccountUi, attemptPanel, accountPage } from './account-ui.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let recorded = null;
const getRecorded = async () => recorded || (recorded = await (await fetch('data/recorded.json')).json());

// ---------- shared pieces ----------
const rec = (src) => `<span class="k-rec">Recorded</span> <span class="k-src">${esc(src)}</span>`;
const levelText = (l) => (l === 2 ? 'The contract checks a Groth16 proof of the RISC Zero result itself.' : 'Two registered verifiers sign the same verdict.');
const isDemo = (b) => recorded && b.exploit_commitment === recorded.notes.demo_exploit_commitment.commitment;
const testNote = (b) => recorded && recorded.test_bounties && recorded.test_bounties[String(b.id)];
const bountyLinks = (b) => `<span class="k-links"><a href="${EXPLORER_ACCOUNT}${CONTRACT}" rel="noopener" target="_blank">Contract</a><a href="#/raw/${esc(b.id)}">Raw data</a></span>`;
const failBox = (e) => `<div class="k-state" role="alert"><p class="k-err">Could not read the contract on testnet.</p><p class="m-note">${esc(e.message)}. Check your connection and reload.</p></div>`;

function bountyState(b, now = Date.now()) {
  if (b.state === 'Paid') return { key: 'closed', v: 'ok', t: '✓ PAID' };
  if (b.state === 'Refunded') return { key: 'closed', v: 'bad', t: '✕ REFUNDED' };
  if (!b.opened) return { key: 'other', v: 'wait', t: '… WAITING FOR PROOF 0' };
  if (nsToDate(b.expires_at_ns).getTime() <= now) return { key: 'other', v: 'wait', t: 'PAST EXPIRY, NOT CLOSED' };
  if (nsToDate(commitBy(b)).getTime() <= now) return { key: 'other', v: 'info', t: 'NO NEW ATTEMPTS' };
  if (b.active >= b.max_commits) return { key: 'other', v: 'info', t: 'ALL SLOTS IN USE' };
  return { key: 'open', v: 'info', t: 'OPEN' };
}

const HOURGLASS = '<svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true"><path d="M2 1h12M2 17h12M3 1c0 5 10 5 10 8s-10 3-10 8M13 1c0 5-10 5-10 8s10 3 10 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
// The state of one attempt, as the chain gives it.
function subState(b, s) {
  if (s.outcome === 'Passed') return { c: 'pass', g: '✓', t: 'PASS', v: 'ok' };
  if (s.outcome === 'Failed') return { c: 'fail', g: '✕', t: 'FAIL', v: 'bad' };
  if (s.outcome === 'TimedOut') return { c: 'time', g: HOURGLASS, t: 'TIMEOUT', v: 'info' };
  if (s.outcome === 'Released') return { c: '', g: '·', t: 'RELEASED', v: 'info' };
  if (s.revealed_at_ns) return b.state !== 'Open' ? { c: 'com', g: '?', t: 'UNDECIDED', v: 'info' } : { c: 'wait', g: '…', t: 'WAITING', v: 'wait' };
  return { c: 'com', g: '○', t: 'COMMITTED', v: 'info' };
}
// One entry per attempt slot: the commits made so far, then the free slots up to the cap.
function slotList(b, subs) {
  const out = subs.map((s) => subState(b, s));
  const free = b.state === 'Open' ? Math.max(0, b.max_commits - b.active) : 0;
  for (let i = 0; i < free; i++) out.push({ c: '', g: '', t: 'FREE' });
  return out;
}
const pips = (b) => `<span class="m-pips" aria-hidden="true">${Array.from({ length: Math.max(b.max_commits, b.commits) }, (_, i) => `<i class="${i < b.commits ? 'c' : ''}"></i>`).join('')}</span>`;
function attemptsText(b) {
  const rel = b.commits - b.active > 0 && b.state === 'Open' ? `, ${b.commits - b.active} released` : '';
  return `${b.commits} of ${b.max_commits} used${rel}`;
}

// Recorded transactions as one table: what happened, result, transaction, time.
const txTable = (list) => table(['What happened', 'Result', 'Transaction', 'Time'], list.map((t) => [
  `${esc(t.what)}<span class="k-step">${esc(t.step)}</span>`,
  /refused/.test(t.result) ? badge('bad', '✕ Refused') : badge('ok', '✓ Succeeded'),
  tx(t.tx), t.time ? esc(t.time) : '<span class="k-dim">not recorded</span>']), 'k-txt');

// ---------- screens ----------
async function home(main) {
  main.innerHTML = `
  <section class="m-hero">
    <div>
      <p class="m-eye">Bounties for bugs that only crash on a secret input</p>
      <h1 class="m-h1 xl" tabindex="-1">Fix what you can’t see.</h1>
      <p class="m-lead">Researchers and AI agents fix a crash from the public code; the contract checks a Groth16 proof of the RISC Zero result itself and pays by rule.</p>
      <div class="m-cta"><a class="m-btn" href="#/bounties">Browse bounties</a><a class="m-btn sec" href="#/verify">How to verify</a></div>
    </div>
    <div class="m-panel m-hcard" aria-label="Bounty 12" id="heroCard"><p class="k-state">Reading bounty 12 from testnet…</p></div>
  </section>
  <section class="m-sec" aria-labelledby="hw">
    <h2 class="m-h2" id="hw">How a bounty works</h2>
    <ol class="m-steps">
      <li><span class="m-n">1</span><div><h3>Funded</h3><p>A vendor locks NEAR in the contract. Proof 0 shows the program crashes on the secret input and that a fix exists.</p></div></li>
      <li><span class="m-n">2</span><div><h3>Attempts</h3><p>Researchers and AI agents commit a fix, then reveal it. Attempt fees are taken from credit deposited in the contract first.</p></div></li>
      <li><span class="m-n">3</span><div><h3>Proof</h3><p>The vendor proves each revealed fix against the secret input. On Level 2 the contract checks the Groth16 proof itself.</p></div></li>
      <li><span class="m-n">4</span><div><h3>Paid</h3><p>A passing proof pays the fix. If the vendor stays silent past the deadline, the bounty is split among the revealed attempts still waiting. With nothing pending at expiry, the vendor is refunded.</p></div></li>
    </ol>
  </section>
  <section class="m-sec m-two">
    <div class="m-panel" aria-labelledby="lv">
      <h2 class="m-h2" id="lv">Who checks the proof</h2>
      <ul class="m-levels">
        <li><span class="k-mono">L0</span><span>Two registered verifiers sign the same verdict</span>${badge('ok', '✓ Built')}</li>
        <li><span class="k-mono">L2</span><span>The contract checks a Groth16 proof of the RISC Zero result itself</span>${badge('ok', '✓ Built')}</li>
      </ul>
    </div>
    <div class="m-panel" aria-labelledby="rm">
      <h2 class="m-h2" id="rm">Roadmap</h2>
      <ul class="k-road">
        <li>${badge('wait', 'Planned')}<span>Create a bounty from this site</span></li>
        <li>${badge('wait', 'Planned')}<span>A proof ledger</span></li>
        <li>${badge('wait', 'Planned')}<span>Set agent limits from this site</span></li>
        <li>${badge('wait', 'Planned')}<span>A live bounty on a new original module with its own bug</span></li>
      </ul>
    </div>
  </section>`;
  try {
    await getRecorded();
    const b = await view('get_bounty', { bounty_id: '12' });
    const st = bountyState(b);
    $('#heroCard').innerHTML = `
      <div class="m-crow"><span class="k-mono k-bold">Bounty 12</span>${badge(st.v, st.t)}</div>
      <p class="m-ct">A live Level 2 bounty with a private secret input</p>
      <p class="m-amt">${esc(near(b.amount))}<span> bounty</span></p>
      <p class="m-sub">${esc(attemptsText(b))} · next fee ${esc(near(b.next_fee))} · expires ${esc(utc(b.expires_at_ns))}</p>
      <p class="m-sub">It uses the public demo bug, so anyone can submit the public fixed.wasm.</p>
      <div class="m-crow k-cardfoot"><a class="m-btn sec sm" href="#/bounties/12">Open bounty 12</a>${bountyLinks(b)}</div>`;
  } catch (e) { $('#heroCard').innerHTML = failBox(e); }
}

let filter = 'all';
async function bounties(main) {
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">Bounties</h1>
    <p class="m-lead">Every bounty on ${esc(CONTRACT)}, read live from testnet.</p>
    <div class="m-tabs" role="tablist" aria-label="Filter bounties">
      ${[['all', 'All'], ['open', 'Open now'], ['closed', 'Closed']].map(([k, t]) => `<button role="tab" type="button" data-f="${k}" aria-selected="${filter === k}" tabindex="${filter === k ? 0 : -1}">${t}</button>`).join('')}
    </div>
    <div id="list"><p class="k-state">Reading bounties from testnet…</p></div>`;
  let all;
  try { await getRecorded(); all = (await allBounties()).filter(Boolean).reverse(); } catch (e) { $('#list').innerHTML = failBox(e); return; }
  const draw = () => {
    const rows = all.filter((b) => filter === 'all' || bountyState(b).key === filter);
    if (!rows.length) { $('#list').innerHTML = '<div class="m-panel"><p>No bounties in this view.</p></div>'; return; }
    $('#list').innerHTML = `<div class="m-panel k-tablepanel">${table(['Bounty', 'State', 'Amount', 'Attempts', 'Next fee', 'Deadline', 'Level'], rows.map((b) => {
      const st = bountyState(b), cl = left(commitBy(b));
      const time = b.state !== 'Open' ? 'Closed' : cl ? `Attempts close in ${cl.replace(' left', '')}` : `Expires ${utc(b.expires_at_ns)}`;
      return [
        `<a class="m-bid" href="#/bounties/${esc(b.id)}">Bounty ${esc(b.id)}</a>${testNote(b) ? ' <span class="m-tag">Test bounty</span>' : ''}<span class="m-sub">${isDemo(b) ? 'Demo input' : 'Private secret input'}</span>${bountyLinks(b)}`,
        badge(st.v, st.t), `<span class="k-mono k-nw">${esc(near(b.amount))}</span>`,
        `<span class="k-mono k-nw">${esc(attemptsText(b))}</span>${pips(b)}`,
        b.state === 'Open' ? `<span class="k-mono k-nw">${esc(near(b.next_fee))}</span>` : '<span class="k-dim">closed</span>',
        esc(time), `Level ${b.level}`];
    }), 'k-blist')}</div>`;
  };
  draw();
  tabs(main, '[data-f]', (btn) => { filter = btn.dataset.f; draw(); });
}

async function bounty(main, id, tab) {
  main.innerHTML = `<a class="m-back" href="#/bounties">← All bounties</a><h1 class="m-h1" tabindex="-1">Bounty ${esc(id)}</h1><div id="b"><p class="k-state">Reading bounty ${esc(id)} from testnet…</p></div>`;
  let b, subs, rd, verifiers;
  try {
    rd = await getRecorded();
    b = await view('get_bounty', { bounty_id: String(id) });
    if (!b) { $('#b').innerHTML = `<div class="m-panel"><p>There is no bounty ${esc(id)} on ${esc(CONTRACT)}.</p></div>`; return; }
    subs = await submissions(b);
    verifiers = (await view('get_verifiers')).map((v) => v.account_id);
  } catch (e) { $('#b').innerHTML = failBox(e); return; }
  const st = bountyState(b), slots = slotList(b, subs), txs = rd.bounties[String(b.id)] || [], note = rd.bounty_notes && rd.bounty_notes[String(b.id)];
  const demo = isDemo(b), imgOk = b.image_id === PUBLISHED_IMAGE_ID, cl = left(commitBy(b));
  $('#b').innerHTML = `
  <div class="m-line">${badge(st.v, st.t)}${testNote(b) ? '<span class="m-tag">Test bounty</span>' : ''}<span class="m-tok">Checked by Level ${b.level}</span><span class="m-tok">${demo ? 'Demo input' : 'Private secret input'}</span>${bountyLinks(b)}</div>
  <p class="m-note">On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.</p>
  ${testNote(b) ? `<p class="m-note"><b>${esc(testNote(b))}</b></p>` : ''}
  ${Number(b.id) === 12 ? '<p class="m-note">Bounty 12 uses the public demo bug: anyone can submit the public fixed.wasm, and if the vendor stays silent the timeout rule can pay out without any proof.</p>' : ''}
  ${note ? `<p class="m-note"><b>Note.</b> ${esc(note.text)} ${tx(note.tx)} <span class="k-src">${esc(note.source)}</span></p>` : ''}
  <section class="m-panel k-send" id="sendPanel" aria-labelledby="sendT"></section>
  <div class="m-sec" id="btabs"></div>`;
  const overview = `<div class="k-ovgrid">
    <section class="m-panel" aria-label="Overview">${facts([
      ['Reward', `<span class="k-mono">${esc(near(b.amount))}</span>`],
      ['State on chain', esc(b.state) + (b.opened ? ', opened' : ', not opened')],
      b.state === 'Open' ? ['Next attempt fee', `<span class="k-mono">${esc(near(b.next_fee))}</span>, from credit`] : null,
      ['Fee rule', `${esc(near(b.attempt_fee))} + ${esc(near(b.fee_step))} per earlier attempt`],
      ['Attempts', esc(attemptsText(b))],
      ['Commits accepted until', esc(utc(commitBy(b))) + (cl && b.state === 'Open' ? ` (${esc(cl)})` : '')],
      ['Expires', esc(utc(b.expires_at_ns))],
      ['Windows', `reveal ${esc(span(b.reveal_window_ns))}, verdict ${esc(span(b.verdict_window_ns))}${b.level === 0 ? ', attest ' + esc(span(b.attest_window_ns)) : ''}`],
      ['Vendor', acct(b.vendor)],
      b.winner !== null && b.winner !== undefined ? ['Winner', `#${esc(b.winner)} ${subs[b.winner] ? acct(subs[b.winner].payout) : ''}`] : null,
      ['Created', esc(utc(b.created_at_ns))],
    ])}</section>
    <div class="m-col">
      <section class="m-panel m-lv" aria-labelledby="lvl"><h2 class="m-h2" id="lvl">Checked by Level ${b.level}</h2>
        <p>${esc(levelText(b.level))}</p>
        <div class="m-lvl" style="grid-template-columns:repeat(2,1fr)"><div class="${b.level === 0 ? 'on' : ''}"><b>L0</b>Built</div><div class="${b.level === 2 ? 'on' : ''}"><b>L2</b>Built</div></div>
      </section>
      <section class="m-panel" aria-labelledby="bs"><h2 class="m-h2" id="bs">Bounty state</h2>
        <ul class="m-states">
          <li><span>Created</span>${badge('ok', '✓')}</li>
          <li class="${b.opened ? (b.state === 'Open' ? 'now' : '') : 'off'}"><span>Opened (Proof 0 accepted)</span>${b.opened ? badge(b.state === 'Open' ? 'wait' : 'ok', b.state === 'Open' ? 'Now' : '✓') : '<span>not reached</span>'}</li>
          <li class="${b.state === 'Paid' ? 'now' : 'off'}"><span>Paid</span>${b.state === 'Paid' ? badge('ok', '✓ Now') : '<span>not taken</span>'}</li>
          <li class="${b.state === 'Refunded' ? 'now' : 'off'}"><span>Refunded to the vendor</span>${b.state === 'Refunded' ? badge('bad', '✕ Now') : '<span>not taken</span>'}</li>
        </ul>
      </section>
    </div></div>`;
  const attempts = `<section class="m-panel k-tablepanel" aria-label="Attempts">
      <div class="m-slots k-pad">${slots.map((s, i) => `<div class="m-slot"><i class="${s.c}" aria-hidden="true">${s.g}</i><span>${i < subs.length ? '#' + i + ' ' : ''}${s.t}</span></div>`).join('')}</div>
      <p class="m-sub k-pad">${esc(attemptsText(b))}.</p>
      ${subs.length ? table(['Attempt', 'State', 'Fee', 'Payout', 'Revealed'], subs.map((s, i) => [`#${i}`, badge(subState(b, s).v, subState(b, s).t), s.fee === '0' ? 'refunded' : `<span class="k-mono k-nw">${esc(near(s.fee))}</span>`, acct(s.payout), s.revealed_at_ns ? esc(utc(s.revealed_at_ns)) : '<span class="k-dim">not revealed</span>'])) : '<p class="m-sub k-pad">No attempts yet.</p>'}
    </section>`;
  const transactions = `<section class="m-panel k-tablepanel" aria-label="Transactions">
      ${txs.length ? `${txTable(txs)}<p class="m-sub k-pad">${rec([...new Set(txs.map((t) => t.source))].join(', '))}</p>` : '<p class="m-sub k-pad">No transactions for this bounty are recorded in the repository.</p>'}
    </section>`;
  const proof = `<section class="m-panel" aria-label="Proof facts">${facts([
      ['Checker image id', `${hashCell(b.image_id)}<span class="k-badges">${imgOk ? badge('ok', '✓ published checker') : badge('bad', '✕ not the published checker')}${b.image_id_allowed ? badge('ok', '✓ on the allowlist') : badge('bad', '✕ not on the allowlist')}</span>`],
      ['Check size', `${b.fuzz_count} fresh inputs, ${b.variant_count} variants of the secret input`],
      ['Exploit commitment', hashCell(b.exploit_commitment) + (demo ? '<span class="k-dim k-block">equals the demo commitment (data/demo/exploit.hex, public salt)</span>' : '')],
      ['Proof 0 journal hash', hashCell(b.proof0_journal_hash)],
      ['Proof 0 receipt hash', hashCell(b.proof0_receipt_hash)],
      ['Reference fix hash', hashCell(b.reference_fix_hash)],
    ])}</section>`;
  tabbed($('#btabs'), [
    { id: 'overview', label: 'Overview', html: overview },
    { id: 'attempts', label: `Attempts (${subs.length})`, html: attempts },
    { id: 'transactions', label: `Transactions (${txs.length})`, html: transactions },
    { id: 'proof', label: 'Proof facts', html: proof },
  ], tab, `#/bounties/${b.id}`, 'Bounty sections');
  attemptPanel($('#sendPanel'), b, subs, verifiers);
}

async function raw(main, id) {
  main.innerHTML = `<a class="m-back" href="#/bounties/${esc(id)}">← Bounty ${esc(id)}</a><h1 class="m-h1" tabindex="-1">Bounty ${esc(id)}: raw data</h1><div id="raw"><p class="k-state">Reading from testnet…</p></div>`;
  try {
    const b = await view('get_bounty', { bounty_id: String(id) }, { fresh: true });
    $('#raw').innerHTML = `<p class="m-lead">The live result of <span class="k-mono">get_bounty {"bounty_id":"${esc(id)}"}</span> on ${esc(CONTRACT)}, read ${esc(new Date().toISOString().slice(0, 19).replace('T', ' '))} UTC.</p>
      <div class="m-panel"><pre class="k-pre">${esc(JSON.stringify(b, null, 2))}</pre><button class="m-btn sec sm" type="button" data-copy-text="${esc(JSON.stringify(b))}">Copy</button></div>`;
  } catch (e) { $('#raw').innerHTML = failBox(e); }
}

async function arena(main, tab) {
  const r = (await getRecorded()).arena, A = r.attempts, K = A[0].budget, n = A.length;
  const P = (i) => { const a = (-90 + (360 / n) * i) * Math.PI / 180; return [160 + 140 * Math.cos(a), 160 + 140 * Math.sin(a)]; };
  const seam = (j) => { const [x0, y0] = P(j), [x1, y1] = P((j + 1) % n), dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L, o = j % 2 ? 13 : -13;
    const p1 = [x0 + 0.34 * dx + nx * o, y0 + 0.34 * dy + ny * o], p2 = [x0 + 0.66 * dx - nx * 0.8 * o, y0 + 0.66 * dy - ny * 0.8 * o], pts = [[x0, y0], p1, p2, [x1, y1]].map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
    return `<g class="m-sg" data-j="${j}" style="opacity:0"><polyline points="${pts}" fill="none" stroke="var(--sink)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${pts}" fill="none" stroke="var(--gold)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></g>`; };
  const sock = (i) => { const [x, y] = P(i), f = A[i].verdict === 'PASS'; return `<g class="m-rb" data-i="${i}" transform="translate(${(x - 14).toFixed(1)},${(y - 14).toFixed(1)})" style="opacity:.18"><path d="M0 0H18A10 10 0 0 1 28 10V28H0Z" fill="var(--surface)" stroke="var(--sink)" stroke-width="2.5"/><text x="14" y="19" text-anchor="middle" font-size="15" font-weight="700" fill="${f ? 'var(--ok)' : 'var(--bad)'}">${f ? '✓' : '✕'}</text></g>`; };
  const hatch = [-60, -36, -12, 12, 36, 60].map((d) => `<line x1="110" x2="210" y1="${160 + d}" y2="${160 + d}" stroke="var(--sink)" stroke-width="1.5" opacity=".55"/>`).join('');
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">Arena: how much can repeated attempts leak?</h1>
  <p class="m-lead">Each attempt returns PASS or FAIL, so at most one bit about the secret. The recorded run of a scripted probe agent (spike S8): a secret space of ${esc(r.secret_space)} values and a cap of ${K} attempts.</p>
  <div id="atabs"></div>`;
  const run = `<div class="m-two m-arena">
    <section class="m-panel" aria-labelledby="bx">
      <div class="m-crow"><div><h2 class="m-h2" id="bx">Bits extracted</h2><p class="m-big"><span id="cnt">0</span><small> of ${K}</small></p></div><button class="m-btn sec sm" type="button" id="replay">Replay</button></div>
      <svg class="m-ring" viewBox="0 0 320 320" role="img" aria-label="Arena ring. ${n} attempts: ${A.map((a) => a.verdict).join(', ')}. ${A[n - 1].bits_learned} bits learned, cap ${K}.">
        <circle cx="160" cy="160" r="140" fill="none" stroke="var(--sink)" stroke-width="3"/>
        <circle cx="160" cy="160" r="96" fill="none" stroke="var(--sink)" stroke-width="2" stroke-dasharray="3 6"/>
        <circle cx="160" cy="160" r="58" fill="var(--surface)" stroke="var(--sink)" stroke-width="3"/>${hatch}
        <text x="160" y="164" text-anchor="middle" font-size="10" font-weight="700" font-family="Space Mono, monospace" fill="var(--sink)" stroke="var(--surface)" stroke-width="5" paint-order="stroke">secret input: sealed</text>
        ${A.map((_, j) => seam(j)).join('')}${A.map((_, i) => sock(i)).join('')}
      </svg>
      <p class="m-sub m-leg">The gold seam joins the bits in the order they were taken. The cap of ${K} closes it.</p>
      <p class="m-acap k-mono" id="acap" style="min-height:22px"></p>
      <p class="m-line"><span id="stop" hidden>${badge('bad', '✕ Stopped')}</span><span class="m-sub">${rec(r.source)}</span></p>
    </section>
    <div class="m-col">
      <section class="m-panel k-tablepanel" aria-labelledby="at2"><h2 class="m-h2 k-pad" id="at2">The attempts</h2>
        ${table(['Attempt', 'Verdict', 'Bits learned', 'Candidates left'], A.map((a) => [`<span class="k-mono">${a.attempt} of ${a.budget}</span>`, a.verdict === 'PASS' ? badge('ok', '✓ PASS') : badge('bad', '✕ FAIL'), `<span class="k-mono">${a.bits_learned}</span>`, `<span class="k-mono">${a.candidates_left}</span>`]))}
        <p class="m-note k-pad">Verdicts come from ${esc(r.verdicts_from)}.</p>
      </section>
      <section class="m-panel" aria-labelledby="wc"><h2 class="m-h2" id="wc">What we claim</h2>
        <p>The cap and the rising fee limit how many answers anyone gets per bounty. They do not make leaking impossible.</p>
      </section>
    </div>
  </div>`;
  const control = `<section class="m-panel k-narrow" aria-label="Control"><h2 class="m-h2">Crash variant check on</h2>
      <p>With the check of ${esc(r.control_variants)} variants of the secret input switched on, the same probes all FAIL whatever the secret, so the probe agent learns 0 bits.</p>
      ${table(['Probe', 'Verdict'], r.control_variant_check_on.map((c) => [`<span class="k-mono">${esc(c.probe)}</span>`, c.verdict === 'PASS' ? badge('ok', '✓ PASS') : badge('bad', '✕ FAIL')]))}
      <p class="m-sub">${rec('docs/evidence/S8/arena_run.txt')}</p></section>`;
  const chain = `<section class="m-panel k-tablepanel" aria-label="On testnet"><p class="m-sub k-pad">The same cap on chain, on the older contract ${esc(r.chain.contract)}: the fourth probe commit was ignored.</p>
      ${txTable(r.chain.steps)}<p class="m-sub k-pad">${rec(r.chain.source)}</p></section>`;
  tabbed($('#atabs'), [{ id: 'run', label: 'Recorded run', html: run }, { id: 'control', label: 'Control', html: control }, { id: 'chain', label: 'On testnet', html: chain }],
    tab, '#/arena', 'Arena sections', (id) => { if (id === 'run' && document.getElementById('replay')) setTimeout(() => play(), 0); });
  let timers = [];
  const play = () => {
    timers.forEach(clearTimeout); timers = [];
    main.querySelectorAll('.m-rb').forEach((g) => (g.style.opacity = '.18'));
    main.querySelectorAll('.m-sg').forEach((g) => (g.style.opacity = '0'));
    $('#cnt').textContent = '0'; $('#acap').textContent = ''; $('#stop').hidden = true;
    A.forEach((a, k) => timers.push(setTimeout(() => {
      main.querySelector(`.m-rb[data-i="${k}"]`).style.opacity = '1';
      if (k > 0) main.querySelector(`.m-sg[data-j="${k - 1}"]`).style.opacity = '1';
      $('#cnt').textContent = String(Math.round(a.bits_learned));
      $('#acap').textContent = `bit ${k + 1} of ${K}: ${a.verdict}`;
      if (k === n - 1) { main.querySelector(`.m-sg[data-j="${n - 1}"]`).style.opacity = '1'; $('#stop').hidden = false; $('#acap').textContent = `cap reached after ${K} yes or no answers`; }
    }, reduce.matches ? 0 : 350 * k + 250)));
  };
  $('#replay').addEventListener('click', play);
}

async function verify(main) {
  const r = await getRecorded();
  const cmd = (text) => `<div class="m-cmd"><code>${esc(text)}</code><button class="k-mini" type="button" data-copy-text="${esc(text)}">Copy</button></div>`;
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">How to verify</h1>
  <p class="m-lead">Six checks. Commands run from the root of the Skarbnik repository.</p>
  <ol class="k-ol k-steplist m-panel">
    <li><span class="m-n">1</span><div><h3>Read a bounty from the chain</h3>${cmd(`near contract call-function as-read-only ${CONTRACT} get_bounty json-args '{"bounty_id":"12"}' network-config testnet now`)}<p class="m-sub">Or open its <a href="#/raw/12">raw data</a>.</p></div></li>
    <li><span class="m-n">2</span><div><h3>Rebuild the checker and compare its image id</h3>${cmd(`./scripts/check_image_id.sh ${CONTRACT} 12`)}<p class="m-sub">Prints <b class="m-okline">MATCH</b> (needs Docker).</p></div></li>
    <li><span class="m-n">3</span><div><h3>A real proof is accepted</h3>${cmd('cargo test -p kintsugi-contract --offline level2_opens_with_the_real_proof0')}<p class="m-sub">On testnet: ${tx(r.valid_proof_accepted.tx)}, a PASS proof for bounty 1, accepted and paid.</p></div></li>
    <li><span class="m-n">4</span><div><h3>A proof for the wrong bounty is refused</h3>${cmd('cargo test -p kintsugi-contract --offline s1_the_same_proof_is_refused_on_another_bounty')}<p class="m-sub">On testnet: ${tx(r.wrong_bounty_refused.tx)}, refused by the contract.</p></div></li>
    <li><span class="m-n">5</span><div><h3>Run every contract test</h3>${cmd('cargo test -p kintsugi-contract --offline')}</div></li>
    <li><span class="m-n">6</span><div><h3>Read the findings of the AI review passes</h3><p>docs/AUDIT.md (every finding, fix and known limit) and docs/SECURITY.md (guards and known limits).</p></div></li>
  </ol>
  <details class="m-sec m-panel k-more"><summary>More detail</summary>
    <h2 class="m-h2">Levels: what you trust</h2>
    ${table(['Level', 'Who checks the proof', 'You trust', 'Status'], [
      ['<span class="k-mono">L0</span>', 'Two registered verifiers sign the same verdict', 'Those two verifiers', badge('ok', '✓ Built')],
      ['<span class="k-mono">L2</span>', 'The contract checks a Groth16 proof of the RISC Zero result itself', 'The maths, a one time setup by RISC Zero, and the published checker (its image id)', badge('ok', '✓ Built')]])}
    <h2 class="m-h2 k-gap">Credit and agent limits, read only</h2>
    ${cmd(`near contract call-function as-read-only ${CONTRACT} get_credit json-args '{"account_id":"<account>"}' network-config testnet now`)}
    ${cmd(`near contract call-function as-read-only ${CONTRACT} get_agent_limits json-args '{"account_id":"<account>"}' network-config testnet now`)}
    <h2 class="m-h2 k-gap">Refused attacks on testnet</h2>
    ${txTable(r.attacks_s6c)}<p class="m-sub">${rec('docs/evidence/S6c/transactions.tsv')}</p>
  </details>`;
}

async function agents(main) {
  const cmd = (text) => `<div class="m-cmd"><code>${esc(text)}</code><button class="k-mini" type="button" data-copy-text="${esc(text)}">Copy</button></div>`;
  const feed = new URL('feed.json', location.href).href;
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">For agents</h1>
  <p class="m-lead">Run an agent against a bounty on ${esc(CONTRACT)}. Testnet only. Replace &lt;agent&gt; with the agent's account.</p>
  <ol class="k-ol k-steplist m-panel k-agents-steps">
    <li><span class="m-n">1</span><div><h3>Read the open bounties</h3><p class="m-sub"><a href="feed.json">feed.json</a> lists bounty id, next fee, slots left, deadlines and level. Read get_bounty before you commit. <button class="k-mini" type="button" data-copy-text="${esc(feed)}">Copy link</button></p></div></li>
    <li><span class="m-n">2</span><div><h3>Create a testnet account and fund it from the faucet</h3>${cmd(`near account create-account sponsor-by-faucet-service <agent>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`)}</div></li>
    <li><span class="m-n">3</span><div><h3>Deposit credit; attempt fees are taken from it</h3>${cmd(`near contract call-function as-transaction ${CONTRACT} deposit_credit json-args '{"account_id":null}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as <agent>.testnet network-config testnet sign-with-legacy-keychain send`)}</div></li>
    <li><span class="m-n">4</span><div><h3>Give the agent a limited key: commit and reveal only</h3>${cmd(`near account add-key <agent>.testnet grant-function-call-access --allowance '0.25 NEAR' --contract-account-id ${CONTRACT} --function-names 'commit, reveal' autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send`)}<p class="m-sub">Tested on this contract: commit ${tx('HiPPkXptEo1WwGZgh6VJEvyjHt3ZjUo6BiyqJDPfvA5X')} and reveal ${tx('AGLDxjCxsD1uMvJCVAwJNYZYRH4Y1mBgQvFTLW8my9BD')} accepted; withdrawing and changing limits were rejected by the network.</p></div></li>
    <li><span class="m-n">5</span><div><h3>Set its limits with the full key</h3>${cmd(`near contract call-function as-transaction ${CONTRACT} set_agent_limits json-args '{"max_fee_per_commit":"20000000000000000000000","fixed_payout":"<agent>.testnet"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as <agent>.testnet network-config testnet sign-with-legacy-keychain send`)}<p class="m-sub">Only a wallet can set limits or withdraw: both need 1 yoctoNEAR attached, which a limited key cannot attach.</p></div></li>
    <li><span class="m-n">6</span><div><h3>Commit, reveal within the window, wait for the vendor's proof</h3><p class="m-sub">The agent signs commit and reveal with its limited key (sign-with-access-key-file). The fingerprint and the arguments are in agent-quickstart.txt. Check an agent's credit and attempts on its <a href="#/account">Account page</a>.</p></div></li>
  </ol>
  <section class="m-sec m-panel"><h2 class="m-h2">Run your own agent</h2>
    <p class="m-sub">The repository's agent (agent/kintsugi_agent.py) does steps 1 and 6 for you: it reads the feed, checks the bounty's public code against the hashes on chain, asks a language model for a fix, builds it and runs the public tests on your machine, then commits and reveals it with the limited key. The model is NEAR AI Cloud by default; the provider is set in agent/config.toml. Dry run is the default and sends nothing.</p>
    <p class="m-sub">Do steps 2 to 5 first, then set account, payout and limited_key_file in a copy of agent/config.toml. Keep the model's API key outside the repository, in the NEARAI_API_KEY environment variable or in ~/.kintsugi-secrets/nearai_api_key. From the repository folder:</p>
    ${cmd('cargo build -p kintsugi-check')}
    ${cmd('python3 -I agent/kintsugi_agent.py run --config agent/config.local.toml')}
    ${cmd('python3 -I agent/kintsugi_agent.py run --config agent/config.local.toml --live --bounty <id>')}
    ${cmd('python3 -I agent/kintsugi_agent.py status --config agent/config.local.toml')}
    <p class="m-sub">The agent stops after max_attempts commits, never commits above max_fee_yocto or your on-chain max fee, refuses a key that is not limited to commit and reveal, and refuses a fix that would read files or the environment when it is built. Each run writes a plain log: the bounty, the prompt, the fix's hash and size, the public test result and the transactions sent.</p>
  </section>
  <details class="m-sec m-panel k-more"><summary>agent-quickstart.txt</summary><div id="qs"><p class="k-state">Reading…</p></div></details>`;
  try {
    const text = await (await fetch('agent-quickstart.txt')).text();
    $('#qs').innerHTML = `<button class="m-btn sec sm" type="button" data-copy-text="${esc(text)}">Copy</button> <a href="agent-quickstart.txt">Open as a file</a><pre class="k-pre k-qs">${esc(text)}</pre>`;
  } catch (e) { $('#qs').innerHTML = `<p class="k-err">Could not read agent-quickstart.txt: ${esc(e.message)}</p>`; }
}

// ---------- tabs, theme, menu, router ----------
function tabs(root, sel, onSelect) {
  const list = [...root.querySelectorAll(sel)];
  const pick = (btn) => { list.forEach((b) => { b.setAttribute('aria-selected', b === btn); b.tabIndex = b === btn ? 0 : -1; }); onSelect(btn); btn.focus(); };
  list.forEach((btn, i) => {
    btn.addEventListener('click', () => pick(btn));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); pick(list[(i + 1) % list.length]); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); pick(list[(i - 1 + list.length) % list.length]); }
    });
  });
}

let pref = 'system';
const dark = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const theme = pref === 'system' ? (dark.matches ? 'dark' : 'light') : pref;
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('[data-pref]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.pref === pref));
}
dark.addEventListener('change', () => pref === 'system' && applyTheme());
document.querySelectorAll('[data-pref]').forEach((b) => b.addEventListener('click', () => { pref = b.dataset.pref; applyTheme(); }));

const menuBtn = $('#menuBtn'), sheet = $('#sheet');
const setMenu = (open) => { sheet.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', open); menuBtn.textContent = open ? 'Close' : 'Menu'; };
menuBtn.addEventListener('click', () => setMenu(!sheet.classList.contains('open')));

$('#brand').innerHTML = `${logo(28)}<span>${NAME}</span>`;

async function route() {
  const main = $('#main'), h = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (h === 'agent' || h.startsWith('agent/')) { location.replace('#/account'); return null; }
  const [page, ...rest] = h.split('/'), id = rest.join('/');
  setMenu(false);
  document.querySelectorAll('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', false));
  const navEl = document.querySelector(`[data-nav="${page === 'raw' ? 'bounties' : page}"]`); if (navEl) navEl.setAttribute('aria-current', 'page');
  try {
    if (!page) await home(main);
    else if (page === 'bounties' && /^\d+$/.test(rest[0] || '')) await bounty(main, rest[0], rest[1]);
    else if (page === 'bounties') await bounties(main);
    else if (page === 'raw' && /^\d+$/.test(id)) await raw(main, id);
    else if (page === 'account') await accountPage(main, decodeURIComponent(rest[0] || ''), rest[1]);
    else if (page === 'arena') await arena(main, rest[0]);
    else if (page === 'verify') await verify(main);
    else if (page === 'agents') await agents(main);
    else main.innerHTML = '<h1 class="m-h1" tabindex="-1">Page not found</h1><p class="m-lead"><a href="#/">Go to the home page</a></p>';
  } catch (e) { main.innerHTML = `<h1 class="m-h1" tabindex="-1">Something went wrong</h1><div class="k-state" role="alert"><p class="k-err">This page could not be shown.</p><p class="m-note">${esc(e.message)}</p></div>`; }
  const h1 = main.querySelector('h1');
  document.title = `${h1 ? h1.textContent : NAME} · ${NAME} (testnet)`;
  $('#live').textContent = `${h1 ? h1.textContent : ''} screen`;
  window.scrollTo(0, 0);
  return h1;
}

window.addEventListener('hashchange', async () => { const h1 = await route(); if (h1) h1.focus({ preventScroll: true }); });
$('#replayIntro').addEventListener('click', () => { if (location.hash && location.hash !== '#/') location.hash = '#/'; startIntro(true); });
applyTheme();
initUi();
initAccountUi();
route().then(() => { if (introWanted()) startIntro(false); });
