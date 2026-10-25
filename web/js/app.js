// The Kintsugi site app: routes (#/, #/bounties, #/bounties/<id>, #/arena, #/verify), the theme switcher, the mobile
// menu, and the five screens. Live screens read the testnet contract with view calls (js/chain.js); recorded screens
// read data/recorded.json, which scripts/gen_site_recorded.py builds from files in the repository. No sample data.
import { CONTRACT, PUBLISHED_IMAGE_ID, view, allBounties, submissions, near, utc, span, left, commitBy, nsToDate } from './chain.js';
import { logo, NAME } from './logo.js';
import { startIntro, introWanted } from './intro.js';
import { $, esc, badge, tx, acct, toast } from './ui.js';
import { initAccountUi, attemptPanel, agentPage } from './account-ui.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let recorded = null;
const getRecorded = async () => recorded || (recorded = await (await fetch('data/recorded.json')).json());

// ---------- shared pieces ----------
const rec = (src) => `<span class="k-rec">Recorded</span> <span class="k-src">${esc(src)}</span>`;
const levelText = (l) => (l === 2 ? 'The contract checks a Groth16 proof of the RISC Zero result itself.' : 'Two registered verifiers sign the same verdict.');
const isDemo = (b) => recorded && b.exploit_commitment === recorded.notes.demo_exploit_commitment.commitment;

function bountyState(b, now = Date.now()) {
  if (b.state === 'Paid') return { key: 'closed', v: 'ok', t: '✓ PAID' };
  if (b.state === 'Refunded') return { key: 'closed', v: 'bad', t: '✕ REFUNDED' };
  if (!b.opened) return { key: 'other', v: 'wait', t: '… WAITING FOR PROOF 0' };
  if (nsToDate(b.expires_at_ns).getTime() <= now) return { key: 'other', v: 'wait', t: 'PAST EXPIRY, NOT CLOSED' };
  if (nsToDate(commitBy(b)).getTime() <= now) return { key: 'other', v: 'info', t: 'NO NEW ATTEMPTS' };
  if (b.active >= b.max_commits) return { key: 'other', v: 'info', t: 'ALL SLOTS IN USE' };
  return { key: 'open', v: 'info', t: 'OPEN' };
}

// One entry per attempt slot: the commits made so far (with their outcome), then the free slots up to the cap.
function slotList(b, subs) {
  const closed = b.state !== 'Open';
  const out = subs.map((s) => {
    if (s.outcome === 'Passed') return { c: 'pass', g: '✓', t: 'PASS', p: 'p' };
    if (s.outcome === 'Failed') return { c: 'fail', g: '✕', t: 'FAIL', p: 'f' };
    if (s.outcome === 'TimedOut') return { c: 'time', g: '<svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true"><path d="M2 1h12M2 17h12M3 1c0 5 10 5 10 8s-10 3-10 8M13 1c0 5-10 5-10 8s10 3 10 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', t: 'TIMEOUT', p: 't' };
    if (s.outcome === 'Released') return { c: '', g: '·', t: 'RELEASED', p: '' };
    if (s.revealed_at_ns) return closed ? { c: 'com', g: '?', t: 'UNDECIDED', p: 'c' } : { c: 'wait', g: '…', t: 'WAITING', p: 'w' };
    return { c: 'com', g: '○', t: 'COMMITTED', p: 'c' };
  });
  const free = b.state === 'Open' ? Math.max(0, b.max_commits - b.active) : 0;
  for (let i = 0; i < free; i++) out.push({ c: '', g: '', t: 'FREE', p: '' });
  return out;
}
const pips = (b) => `<span class="m-pips" aria-hidden="true">${Array.from({ length: Math.max(b.max_commits, b.commits) }, (_, i) => `<i class="${i < b.commits ? 'c' : ''}"></i>`).join('')}</span>`;

function attemptsText(b) {
  const rel = b.commits - b.active > 0 && b.state === 'Open' ? `, ${b.commits - b.active} released` : '';
  return `${b.commits} of ${b.max_commits} used${rel}`;
}

const failBox = (e) => `<div class="k-state" role="alert"><p class="k-err">Could not read the contract on testnet.</p><p class="m-note">${esc(e.message)}. Check your connection and reload. Nothing on this page is cached or made up.</p></div>`;

// ---------- screens ----------
async function home(main) {
  main.innerHTML = `
  <section class="m-hero">
    <div>
      <p class="m-eye">Bounties for bugs that only crash on a secret input</p>
      <h1 class="m-h1 xl" tabindex="-1">Fix what you can’t see.</h1>
      <p class="m-lead">Researchers and AI agents fix a crash from the public code; the contract checks a Groth16 proof of the RISC Zero result itself and pays by rule.</p>
      <div class="m-cta"><a class="m-btn" href="#/bounties">Browse bounties</a><a class="m-btn sec" href="#/verify">See how to verify</a></div>
      <p class="m-note">On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.</p>
    </div>
    <div class="m-panel m-hcard" aria-label="Live bounty 12" id="heroCard"><p class="k-state">Reading bounty 12 from testnet…</p></div>
  </section>
  <section class="m-sec" aria-labelledby="hw">
    <h2 class="m-h2" id="hw">How a bounty works</h2>
    <ol class="m-steps">
      <li><span class="m-n">1</span><div><h3>Funded</h3><p>A vendor locks NEAR in the contract. Proof 0 shows the program crashes on the secret input and that a fix exists.</p></div></li>
      <li><span class="m-n">2</span><div><h3>Attempts</h3><p>Researchers and AI agents commit a fix, then reveal it. Each bounty has its own number of attempt slots. Attempt fees are taken from credit you deposit in the contract first.</p></div></li>
      <li><span class="m-n">3</span><div><h3>Proof</h3><p>The vendor proves each revealed fix against the secret input. On a Level 2 bounty the contract checks the Groth16 proof itself.</p></div></li>
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
      <p class="m-note">Only levels that exist on testnet are listed.</p>
    </div>
    <div class="m-panel" aria-labelledby="rm">
      <h2 class="m-h2" id="rm">Roadmap</h2>
      <ul class="k-road">
        <li>${badge('wait', 'Planned')}<span>Connect a wallet</span></li>
        <li>${badge('wait', 'Planned')}<span>Deposit credit and send attempts from this site</span></li>
        <li>${badge('wait', 'Planned')}<span>Create a bounty from this site</span></li>
        <li>${badge('wait', 'Planned')}<span>A proof ledger</span></li>
        <li>${badge('wait', 'Planned')}<span>A live bounty on a new original module with its own bug</span></li>
      </ul>
      <p class="m-note">None of these are built. This version only reads the chain.</p>
    </div>
  </section>`;
  try {
    await getRecorded();
    const b = await view('get_bounty', { bounty_id: '12' });
    const st = bountyState(b);
    $('#heroCard').innerHTML = `
      <div class="m-crow"><span class="k-mono" style="font-weight:700">Bounty 12</span>${badge(st.v, st.t)}</div>
      <p class="m-ct">A live Level 2 bounty with a private secret input</p>
      <p class="m-amt">${esc(near(b.amount))}<span> held by the contract</span></p>
      <p class="m-sub">${esc(attemptsText(b))} · next fee ${esc(near(b.next_fee))} · expires ${esc(utc(b.expires_at_ns))}</p>
      <p class="m-sub">Checked by Level ${b.level}. ${esc(levelText(b.level))}</p>
      <p class="m-sub">It uses the public demo bug, so anyone can submit the public fixed.wasm.</p>
      <a class="m-btn sec sm" href="#/bounties/12">Open bounty 12</a>`;
  } catch (e) { $('#heroCard').innerHTML = failBox(e); }
}

let filter = 'all';
async function bounties(main) {
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">Bounties</h1>
    <p class="m-lead">Every bounty on the testnet contract ${esc(CONTRACT)}, read live from the chain.</p>
    <div class="m-tabs" role="tablist" aria-label="Filter bounties">
      ${[['all', 'All'], ['open', 'Open now'], ['closed', 'Closed']].map(([k, t]) => `<button role="tab" type="button" data-f="${k}" aria-selected="${filter === k}" tabindex="${filter === k ? 0 : -1}">${t}</button>`).join('')}
    </div>
    <div id="list"><p class="k-state">Reading bounties from testnet…</p></div>`;
  let all;
  try { await getRecorded(); all = (await allBounties()).filter(Boolean).reverse(); } catch (e) { $('#list').innerHTML = failBox(e); return; }
  const draw = () => {
    const rows = all.filter((b) => filter === 'all' || bountyState(b).key === filter);
    if (!rows.length) { $('#list').innerHTML = '<div class="m-panel"><p>No bounties in this view.</p></div>'; return; }
    const cell = (b) => {
      const st = bountyState(b), cl = left(commitBy(b));
      return { st, time: b.state !== 'Open' ? 'Closed' : (cl ? `Attempts close in ${cl.replace(' left', '')}` : `Expires ${utc(b.expires_at_ns)}`) };
    };
    $('#list').innerHTML = `
    <div class="m-panel m-tw k-only-wide"><table class="m-table">
      <thead><tr><th scope="col">Bounty</th><th scope="col">State</th><th scope="col">Amount</th><th scope="col">Attempts</th><th scope="col">Next fee</th><th scope="col">Deadline</th><th scope="col">Checked by</th></tr></thead>
      <tbody>${rows.map((b) => { const c = cell(b); return `<tr>
        <td><a class="m-bid" href="#/bounties/${b.id}">Bounty ${esc(b.id)}</a><span class="m-sub">${isDemo(b) ? 'Demo input' : 'Private secret input'}</span></td>
        <td>${badge(c.st.v, c.st.t)}</td>
        <td class="k-mono">${esc(near(b.amount))}</td>
        <td><span class="k-mono">${esc(attemptsText(b))}</span>${pips(b)}</td>
        <td class="k-mono">${b.state === 'Open' ? esc(near(b.next_fee)) : 'none, closed'}</td>
        <td><span title="Expires ${esc(utc(b.expires_at_ns))}">${esc(c.time)}</span></td>
        <td>Level ${b.level}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="m-cards k-only-narrow">${rows.map((b) => { const c = cell(b); return `<a class="m-card" href="#/bounties/${b.id}" style="color:inherit;text-decoration:none">
        <span class="m-crow"><span class="k-mono" style="font-weight:700">Bounty ${esc(b.id)}</span>${badge(c.st.v, c.st.t)}</span>
        <span class="m-ct2">${esc(near(b.amount))}, Level ${b.level}</span>
        <span class="m-crow"><span class="k-mono">${esc(attemptsText(b))}</span><span>${b.state === 'Open' ? 'next fee ' + esc(near(b.next_fee)) : ''}</span></span>
        <span class="m-sub">${esc(c.time)} · ${isDemo(b) ? 'Demo input' : 'Private secret input'}</span>${pips(b)}</a>`; }).join('')}</div>`;
  };
  draw();
  tabs(main, '[data-f]', (btn) => { filter = btn.dataset.f; draw(); });
}

async function bounty(main, id) {
  main.innerHTML = `<a class="m-back" href="#/bounties">← All bounties</a><h1 class="m-h1" tabindex="-1">Bounty ${esc(id)}</h1><div id="b"><p class="k-state">Reading bounty ${esc(id)} from testnet…</p></div>`;
  let b, subs, rd, verifiers;
  try {
    rd = await getRecorded();
    b = await view('get_bounty', { bounty_id: String(id) });
    if (!b) { $('#b').innerHTML = `<div class="m-panel"><p>There is no bounty ${esc(id)} on ${esc(CONTRACT)}.</p></div>`; return; }
    subs = await submissions(b);
    verifiers = (await view('get_verifiers')).map((v) => v.account_id);
  } catch (e) { $('#b').innerHTML = failBox(e); return; }
  const st = bountyState(b), slots = slotList(b, subs), txs = rd.bounties[String(b.id)] || [];
  const demo = isDemo(b), imgOk = b.image_id === PUBLISHED_IMAGE_ID;
  const fact = (t, v) => `<div><dt>${t}</dt><dd>${v}</dd></div>`;
  const cl = left(commitBy(b));
  $('#b').innerHTML = `
  <div class="m-line">${badge(st.v, st.t)}<span class="m-tok">Checked by Level ${b.level}</span><span class="m-tag">Testnet</span><span class="m-tag">Live</span></div>
  ${rd.bounty_notes && rd.bounty_notes[String(b.id)] ? `<p class="m-note"><b>Note.</b> ${esc(rd.bounty_notes[String(b.id)].text)} ${tx(rd.bounty_notes[String(b.id)].tx)} <span class="k-src">${esc(rd.bounty_notes[String(b.id)].source)}</span></p>` : ''}
  <p class="m-note">On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.</p>
  <p class="m-line"><span class="m-tok">${demo ? 'Demo input' : 'Private secret input'}</span></p>
  ${demo ? `<p class="m-note">The exploit commitment below equals the demo commitment recomputed from data/demo/exploit.hex and the public demo salt.</p>`
    : `<p class="m-note">${Number(b.id) === 12 ? 'Bounty 12 uses the public demo bug: anyone can submit the public fixed.wasm, and if the vendor stays silent the timeout rule can pay out without any proof.' : ''}</p>`}
  <div class="m-grid3" style="margin-top:18px">
    <div class="m-col">
      <section class="m-panel" aria-labelledby="sl"><h2 class="m-h2" id="sl">Attempt slots</h2>
        <div class="m-slots">${slots.map((s, i) => `<div class="m-slot"><i class="${s.c}" aria-hidden="true">${s.g}</i><span>${i < subs.length ? '#' + i + ' ' : ''}${s.t}</span></div>`).join('')}</div>
        <p class="m-sub">${esc(attemptsText(b))}. The cap K is ${b.max_commits} for this bounty.</p>
      </section>
      <section class="m-panel" aria-labelledby="at"><h2 class="m-h2" id="at">Attempts</h2>
        ${subs.length ? `<ul class="k-txs">${subs.map((s, i) => `<li><span><b>#${i}</b> ${esc(slots[i].t)} · fee ${s.fee === '0' ? 'refunded' : esc(near(s.fee))}<br>payout ${acct(s.payout)}${s.revealed_at_ns ? `<br><span class="k-src">revealed ${esc(utc(s.revealed_at_ns))}${s.deadline_ns ? ', deadline ' + esc(utc(s.deadline_ns)) : ''}</span>` : ''}</span></li>`).join('')}</ul>` : '<p class="m-sub">No attempts yet.</p>'}
      </section>
    </div>
    <div class="m-col m-mid">
      <section class="m-panel" id="sendPanel" aria-labelledby="sendT"></section>
      <section class="m-panel" aria-labelledby="kf"><h2 class="m-h2" id="kf">Key facts, live</h2>
        <dl class="m-facts">
          ${fact('Bounty amount', `<span class="k-mono">${esc(near(b.amount))}</span>`)}
          ${fact('State on chain', esc(b.state) + (b.opened ? ', opened' : ', not opened'))}
          ${b.state === 'Open' ? fact('Next attempt fee', `<span class="k-mono">${esc(near(b.next_fee))}</span> (from credit)`) : ''}
          ${fact('Fee rule', `${esc(near(b.attempt_fee))} + ${esc(near(b.fee_step))} per earlier attempt`)}
          ${fact('Attempts', esc(attemptsText(b)))}
          ${fact('Commits accepted until', esc(utc(commitBy(b))) + (cl && b.state === 'Open' ? ` (${esc(cl)})` : ''))}
          ${fact('Expires', esc(utc(b.expires_at_ns)))}
          ${fact('Windows', `reveal ${esc(span(b.reveal_window_ns))}, verdict ${esc(span(b.verdict_window_ns))}${b.level === 0 ? ', attest ' + esc(span(b.attest_window_ns)) : ''}`)}
          ${fact('Check size', `${b.fuzz_count} fresh inputs, ${b.variant_count} secret variants`)}
          ${fact('Vendor', acct(b.vendor))}
          ${b.winner !== null && b.winner !== undefined ? fact('Winner slot', '#' + esc(b.winner)) : ''}
          ${fact('Created', esc(utc(b.created_at_ns)))}
        </dl>
        <dl class="m-facts" style="grid-template-columns:1fr">
          ${fact('Checker image id', `<span class="k-mono k-hash">${esc(b.image_id)}</span><br>${imgOk ? badge('ok', '✓ the published checker') : badge('bad', '✕ not the published checker')} ${b.image_id_allowed ? badge('ok', '✓ on the allowlist') : badge('bad', '✕ not on the allowlist')}`)}
          ${fact('Exploit commitment', `<span class="k-mono k-hash">${esc(b.exploit_commitment)}</span>`)}
          ${fact('Proof 0 journal hash', `<span class="k-mono k-hash">${esc(b.proof0_journal_hash)}</span>`)}
          ${fact('Proof 0 receipt hash', `<span class="k-mono k-hash">${esc(b.proof0_receipt_hash)}</span>`)}
          ${fact('Reference fix hash', `<span class="k-mono k-hash">${esc(b.reference_fix_hash)}</span>`)}
        </dl>
      </section>
      <section class="m-panel" aria-labelledby="tx"><h2 class="m-h2" id="tx">Transactions</h2>
        ${txs.length ? `<p class="m-sub">${rec([...new Set(txs.map((t) => t.source))].join(', '))}</p><ul class="k-txs">${txs.map((t) => `<li><span><b>${esc(t.step)}</b> <span class="k-src">${esc(t.method)}, ${esc(t.result)}</span><br>${tx(t.tx)}</span></li>`).join('')}</ul>`
          : '<p class="m-sub">No transactions for this bounty are recorded in the repository. The chain view above is still live.</p>'}
      </section>
    </div>
    <div class="m-col">
      <section class="m-panel m-lv" aria-labelledby="lvl"><h2 class="m-h2" id="lvl">Checked by Level ${b.level}</h2>
        <p>${esc(levelText(b.level))}</p>
        <div class="m-lvl" style="grid-template-columns:repeat(2,1fr)">
          <div class="${b.level === 0 ? 'on' : ''}"><b>L0</b>Built</div><div class="${b.level === 2 ? 'on' : ''}"><b>L2</b>Built</div>
        </div>
      </section>
      <section class="m-panel" aria-labelledby="bs"><h2 class="m-h2" id="bs">Bounty state</h2>
        <ul class="m-states">
          <li class="${b.opened ? '' : 'now'}"><span>Created</span>${badge('ok', '✓')}</li>
          <li class="${b.opened ? (b.state === 'Open' ? 'now' : '') : 'off'}"><span>Opened (Proof 0 accepted)</span>${b.opened ? badge(b.state === 'Open' ? 'wait' : 'ok', b.state === 'Open' ? 'Now' : '✓') : '<span>not reached</span>'}</li>
          <li class="${b.state === 'Paid' ? 'now' : 'off'}"><span>Paid</span>${b.state === 'Paid' ? badge('ok', '✓ Now') : '<span>not taken</span>'}</li>
          <li class="${b.state === 'Refunded' ? 'now' : 'off'}"><span>Refunded to the vendor</span>${b.state === 'Refunded' ? badge('bad', '✕ Now') : '<span>not taken</span>'}</li>
        </ul>
        <p class="m-note">Read live from get_bounty and get_submission on ${esc(CONTRACT)}.</p>
      </section>
    </div>
  </div>`;
  attemptPanel($('#sendPanel'), b, subs, verifiers);
}

async function arena(main) {
  const r = (await getRecorded()).arena, A = r.attempts, K = A[0].budget, n = A.length;
  const P = (i) => { const a = (-90 + (360 / n) * i) * Math.PI / 180; return [160 + 140 * Math.cos(a), 160 + 140 * Math.sin(a)]; };
  const seam = (j) => { const [x0, y0] = P(j), [x1, y1] = P((j + 1) % n), dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L, o = j % 2 ? 13 : -13;
    const p1 = [x0 + 0.34 * dx + nx * o, y0 + 0.34 * dy + ny * o], p2 = [x0 + 0.66 * dx - nx * 0.8 * o, y0 + 0.66 * dy - ny * 0.8 * o], pts = [[x0, y0], p1, p2, [x1, y1]].map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
    return `<g class="m-sg" data-j="${j}" style="opacity:0"><polyline points="${pts}" fill="none" stroke="var(--sink)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${pts}" fill="none" stroke="var(--gold)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></g>`; };
  const sock = (i) => { const [x, y] = P(i), f = A[i].verdict === 'PASS'; return `<g class="m-rb" data-i="${i}" transform="translate(${(x - 14).toFixed(1)},${(y - 14).toFixed(1)})" style="opacity:.18"><path d="M0 0H18A10 10 0 0 1 28 10V28H0Z" fill="var(--surface)" stroke="var(--sink)" stroke-width="2.5"/><text x="14" y="19" text-anchor="middle" font-size="15" font-weight="700" fill="${f ? 'var(--ok)' : 'var(--bad)'}">${f ? '✓' : '✕'}</text></g>`; };
  const hatch = [-60, -36, -12, 12, 36, 60].map((d) => `<line x1="110" x2="210" y1="${160 + d}" y2="${160 + d}" stroke="var(--sink)" stroke-width="1.5" opacity=".55"/>`).join('');
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">Arena: how much can repeated attempts leak?</h1>
  <p class="m-lead">Each attempt returns PASS or FAIL, so at most one bit about the secret. This is the recorded run of a scripted probe agent (spike S8) against a secret space of ${esc(r.secret_space)} values, with a cap of ${K} attempts.</p>
  <div class="m-two m-arena">
    <section class="m-panel" aria-labelledby="bx">
      <div class="m-crow"><div><h2 class="m-h2" id="bx">Bits extracted</h2><p class="m-big" aria-live="off"><span id="cnt">0</span><small> of ${K}</small></p></div><button class="m-btn sec sm" type="button" id="replay">Replay</button></div>
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
      <section class="m-panel" aria-labelledby="at2"><h2 class="m-h2" id="at2">The attempts</h2>
        <table class="m-table"><thead><tr><th scope="col">Attempt</th><th scope="col">Verdict</th><th scope="col">Bits learned</th><th scope="col">Candidates left</th></tr></thead>
        <tbody>${A.map((a) => `<tr><td class="k-mono">${a.attempt} of ${a.budget}</td><td>${a.verdict === 'PASS' ? badge('ok', '✓ PASS') : badge('bad', '✕ FAIL')}</td><td class="k-mono">${a.bits_learned}</td><td class="k-mono">${a.candidates_left}</td></tr>`).join('')}</tbody></table>
        <p class="m-note">Verdicts come from ${esc(r.verdicts_from)}.</p>
      </section>
      <section class="m-panel" aria-labelledby="ct"><h2 class="m-h2" id="ct">Control: crash variant check on</h2>
        <p>With the check of ${esc(r.control_variants)} variants of the secret input switched on, the same probes all FAIL whatever the secret: ${r.control_variant_check_on.map((c) => `${esc(c.probe)} ${esc(c.verdict)}`).join(', ')}. The probe agent then learns 0 bits.</p>
        <p class="m-sub">${rec('docs/evidence/S8/arena_run.txt')}</p>
      </section>
      <section class="m-panel" aria-labelledby="ch"><h2 class="m-h2" id="ch">On testnet</h2>
        <p>The same cap on chain, on the older contract ${esc(r.chain.contract)}: probe commits 1 to 3 counted, the fourth was ignored (${esc(r.chain.note.replace(/^the fourth probe commit was ignored: /, ''))}).</p>
        <ul class="k-txs">${r.chain.steps.map((s) => `<li><span><b>${esc(s.step)}</b><br>${tx(s.tx)}</span></li>`).join('')}</ul>
        <p class="m-sub">${rec(r.chain.source)}</p>
      </section>
      <section class="m-panel" aria-labelledby="wc"><h2 class="m-h2" id="wc">What we claim</h2>
        <p>The cap and the rising fee limit how many answers anyone gets per bounty. They do not make leaking impossible.</p>
      </section>
    </div>
  </div>`;
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
  play();
}

async function verify(main) {
  const r = await getRecorded();
  const cmd = (text, id) => `<div class="m-cmd"><code id="${id}">${esc(text)}</code><button class="m-btn sec sm" type="button" data-copy="${id}">Copy the command</button></div>`;
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">How to verify</h1>
  <p class="m-lead">You do not have to take our word for a result. Each step below is something you can run or look up yourself. Commands run from the root of the Kintsugi repository.</p>
  <ol class="k-ol">
    <li class="m-panel"><span class="m-n">1</span><div><h3>Read a bounty from the chain yourself</h3>
      <p>Everything on the Bounties pages comes from read only view calls. Make the same call with NEAR's command line tool:</p>
      ${cmd(`near contract call-function as-read-only ${CONTRACT} get_bounty json-args '{"bounty_id":"12"}' network-config testnet now`, 'c1')}
      <p class="m-sub">Look for "level": 2, "opened": true, "image_id_allowed": true and the image id below.</p></div></li>
    <li class="m-panel"><span class="m-n">2</span><div><h3>Rebuild the checker and compare its image id</h3>
      <p>A proof shows that a program with a given fingerprint (its image id) ran. Rebuilding the checker yourself shows that the fingerprint belongs to the published code. One command rebuilds it in RISC Zero's builder image (Docker) and compares it with a bounty:</p>
      ${cmd(`./scripts/check_image_id.sh ${CONTRACT} 12`, 'c2')}
      <p>It prints <b class="m-okline">MATCH</b> when the bounty's image id is <span class="k-mono k-hash">${esc(PUBLISHED_IMAGE_ID)}</span>.</p>
      <p class="m-sub">${rec('docs/evidence/S18/check_image_id.txt (MATCH for bounty 12)')}</p></div></li>
    <li class="m-panel"><span class="m-n">3</span><div><h3>See a stored valid proof accepted</h3>
      <p>The repository stores real Groth16 receipts as test vectors (contract/src/groth16_test_vectors.rs and groth16_attempt_vectors.rs). The contract's own code accepts them:</p>
      ${cmd('cargo test -p kintsugi-contract --offline level2_opens_with_the_real_proof0', 'c3')}
      ${cmd('cargo test -p kintsugi-contract --offline s1_real_attempt_proofs_fail_then_pass', 'c4')}
      <p>On testnet: ${esc(r.valid_proof_accepted.what)}: ${tx(r.valid_proof_accepted.tx)}.</p>
      <p class="m-sub">${rec(r.valid_proof_accepted.source)}</p></div></li>
    <li class="m-panel"><span class="m-n">4</span><div><h3>See a proof for the wrong bounty refused</h3>
      <p>A proof is bound to one bounty and one attempt. The same real proof sent for another bounty is refused:</p>
      ${cmd('cargo test -p kintsugi-contract --offline s1_the_same_proof_is_refused_on_another_bounty', 'c5')}
      <p>On testnet: ${esc(r.wrong_bounty_refused.what)}, refused by the contract: ${tx(r.wrong_bounty_refused.tx)}.</p>
      <p class="m-sub">${rec(r.wrong_bounty_refused.source)}</p>
      <details><summary class="m-link" style="display:inline-flex">More refused attacks on testnet (${r.attacks_s6c.length})</summary>
        <ul class="k-txs">${r.attacks_s6c.map((a) => `<li><span><b>${esc(a.step)}</b> <span class="k-src">refused</span><br>${tx(a.tx)}</span></li>`).join('')}</ul>
        <p class="m-sub">${rec('docs/evidence/S6c/transactions.tsv')}</p></details></div></li>
    <li class="m-panel"><span class="m-n">5</span><div><h3>Check credit and agent limits</h3>
      <p>Attempt fees are taken from credit you deposit in the contract first. Read an account's credit and its agent limits:</p>
      ${cmd(`near contract call-function as-read-only ${CONTRACT} get_credit json-args '{"account_id":"<account>"}' network-config testnet now`, 'c6')}
      ${cmd(`near contract call-function as-read-only ${CONTRACT} get_agent_limits json-args '{"account_id":"<account>"}' network-config testnet now`, 'c7')}
      <p class="m-sub">Facts, read only on this site: deposit_credit adds credit; withdraw_credit takes unspent credit back and needs exactly 1 yoctoNEAR, which an agent's commit only key cannot attach; set_agent_limits sets a largest fee per attempt and a fixed payout account. Details in agent-quickstart.txt.</p></div></li>
  </ol>
  <section class="m-sec m-panel" aria-labelledby="lvt"><h2 class="m-h2" id="lvt">Levels: what you trust</h2>
    <div class="m-tw" style="box-shadow:none;border:0"><table class="m-table"><thead><tr><th scope="col">Level</th><th scope="col">Who checks the proof</th><th scope="col">You trust</th><th scope="col">Status</th></tr></thead>
    <tbody><tr><td class="k-mono">L0</td><td>Two registered verifiers sign the same verdict</td><td>Those two verifiers</td><td>${badge('ok', '✓ Built')}</td></tr>
    <tr><td class="k-mono">L2</td><td>The contract checks a Groth16 proof of the RISC Zero result itself</td><td>The maths, a one time setup by RISC Zero, and the published checker (its image id)</td><td>${badge('ok', '✓ Built')}</td></tr></tbody></table></div>
  </section>
  <section class="m-sec m-panel" aria-labelledby="rv"><h2 class="m-h2" id="rv">AI review passes</h2>
    <p>The contract went through AI review passes. Every finding, its fix or its status as a known limit, and the testnet reruns are in docs/AUDIT.md; the guards and the known limits are in docs/SECURITY.md.</p>
    ${cmd('cargo test -p kintsugi-contract --offline', 'c8')}
  </section>`;
  main.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
    const text = $('#' + btn.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; toast('Copied. Paste it in a terminal.'); setTimeout(() => (btn.textContent = 'Copy the command'), 1500); }
    catch { btn.textContent = 'Select the text'; }
  }));
}

// ---------- tabs, toast, theme, menu, router ----------
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
  const main = $('#main'), h = location.hash.replace(/^#\/?/, '');
  const [page, id] = h.split('?')[0].split('/');
  setMenu(false);
  document.querySelectorAll('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', false));
  const cur = page === 'bounties' ? 'bounties' : page;
  const navEl = document.querySelector(`[data-nav="${cur}"]`); if (navEl) navEl.setAttribute('aria-current', 'page');
  try {
    if (!page) await home(main);
    else if (page === 'bounties' && id !== undefined && /^\d+$/.test(id)) await bounty(main, id);
    else if (page === 'bounties') await bounties(main);
    else if (page === 'arena') await arena(main);
    else if (page === 'verify') await verify(main);
    else if (page === 'agent') await agentPage(main);
    else main.innerHTML = '<h1 class="m-h1" tabindex="-1">Page not found</h1><p class="m-lead"><a class="m-a" href="#/">Go to the home page</a></p>';
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
initAccountUi();
route().then(() => { if (introWanted()) startIntro(false); });
