// The Skarbnik site app: routes (#/, #/bounties, #/bounties/<id>, #/raw/<id>, #/account/<name>, #/arena, #/verify,
// #/agents), keyboard shortcuts (1 to 4, ?, Esc), the theme switch (the visitor's system setting by default), the
// Private toggle, the cursor light, and the screens. Live screens read the testnet contract with view calls (js/chain.js); recorded parts read
// data/recorded.json, which scripts/gen_site_recorded.py builds from files in the repository. No sample data.
import { CONTRACT, EXPLORER_ACCOUNT, EXPLORER_TX, PUBLISHED_IMAGE_ID, view, allBounties, submissions, near, utc, utcShort, span, left, commitBy, nsToDate } from './chain.js';
import { logo, NAME } from './logo.js';
import { startIntro, introWanted } from './intro.js';
import { $, esc, badge, tx, acct, hashCell, table, facts, sealed, viewLink, shortId, initUi, tabbed } from './ui.js';
import { initAccountUi, attemptPanel, accountPage } from './account-ui.js';
import { buildLedger } from './ledger-core.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let recorded = null;
const getRecorded = async () => recorded || (recorded = await (await fetch('data/recorded.json')).json());

// ---------- shared pieces ----------
const rec = (src) => `<span class="k-rec">Recorded</span> <span class="k-src">${esc(src)}</span>`;
const levelText = (l) => (l === 2 ? 'The contract checks a Groth16 proof of the RISC Zero result itself.' : 'Two registered verifiers sign the same verdict.');
const testNote = (b) => recorded && recorded.test_bounties && recorded.test_bounties[String(b.id)];
const isDemo = (b) => recorded && b.exploit_commitment === recorded.notes.demo_exploit_commitment.commitment;
const newModule = (b) => recorded && recorded.new_module_bounties && recorded.new_module_bounties[String(b.id)];
const judgeNote = (b) => recorded && recorded.judge_bounties && recorded.judge_bounties[String(b.id)];
const inputLabel = (b) => (judgeNote(b) ? 'Judge bounty' : newModule(b) ? 'Private bounty, new module' : isDemo(b) ? (testNote(b) ? 'Test bounty · demo input' : 'Demo input') : 'Private secret input');
const bountyLinks = (b) => `<span class="k-links"><a href="${EXPLORER_ACCOUNT}${CONTRACT}" rel="noopener" target="_blank">Contract</a><a href="#/raw/${esc(b.id)}">Raw data</a></span>`;
const typeText = (b) => inputLabel(b);
// How a paid bounty was paid: the outcome of its winning attempt (TimedOut means paid by the timeout rule).
async function paidHow(b) {
  if (b.state !== 'Paid' || b.winner === null || b.winner === undefined) return null;
  try { return (await view('get_submission', { bounty_id: String(b.id), index: b.winner })).outcome === 'TimedOut' ? 'timeout' : 'proof'; } catch { return null; }
}
// The successful claim_timeout transaction of a bounty, when the repository records it.
const claimTx = (b) => { const c = recorded && (recorded.bounties[String(b.id)] || []).find((t) => t.method === 'claim_timeout' && t.result === 'succeeded'); return c ? c.tx : null; };
const timeoutNote = (b) => (claimTx(b) ? `<span class="m-sub">claim ${tx(claimTx(b))}</span>` : '');
// The explorer target of a bounty: its creation transaction when the repository records it, otherwise the contract.
function explorerOf(b) {
  const c = recorded && (recorded.bounties[String(b.id)] || []).find((t) => /create/.test(t.step) && t.method === 'create_bounty');
  return c ? [EXPLORER_TX + c.tx, `Bounty ${b.id} creation transaction`] : [EXPLORER_ACCOUNT + CONTRACT, `The contract ${CONTRACT}`];
}
// The last moment a commit is accepted, as a UTC date and time, or Closed.
const closesText = (b) => (b.state !== 'Open' ? 'Closed' : utcShort(commitBy(b)));
const cmd = (text) => `<div class="m-cmd"><code>${esc(text)}</code><button class="k-mini" type="button" data-copy-text="${esc(text)}">copy</button></div>`;
// The same step with the older JavaScript near CLI (npm package near-cli 4.0.13), which NEAR Connect does not support.
const jsCmd = (...lines) => `<p class="m-sub">With the older JS near CLI:</p>${lines.map(cmd).join('')}`;
// The home page shows the check command only after ./scripts/check_image_id.sh (no arguments) was run and printed MATCH.
const SHOW_CHECK_CMD = true;
// A real commit fingerprint (bounty 16, attempt 0, read from the chain), shown blurred on the home page.
const LOCK = '<svg class="k-lock" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const SAMPLE_FINGERPRINT = 'd8c2c76d001ff41c192daddf542d39dd2fe3dbe045d987145340f4aa1ae842dd';
const failBox = (e) => `<div class="k-state" role="alert"><p class="k-err">Could not read the contract on testnet.</p><p class="m-note">${esc(e.message)}. Check your connection and reload.</p></div>`;

// how: 'timeout' when the attempt that was paid timed out (the vendor gave no verdict), so it was paid by the timeout
// rule, not by a proof: a neutral chip, never the green proof chip.
function bountyState(b, now = Date.now(), how = null) {
  if (b.state === 'Paid') return how === 'timeout' ? { key: 'closed', v: 'info', t: 'Paid by timeout' } : { key: 'closed', v: 'ok', t: '✓ PAID' };
  if (b.state === 'Refunded') return { key: 'closed', v: 'info', t: 'REFUNDED' };
  if (!b.opened) return { key: 'other', v: 'wait', t: '… WAITING FOR PROOF 0' };
  if (nsToDate(b.expires_at_ns).getTime() <= now) return { key: 'other', v: 'wait', t: 'PAST EXPIRY, NOT CLOSED' };
  if (nsToDate(commitBy(b)).getTime() <= now) return { key: 'other', v: 'info', t: 'NO NEW ATTEMPTS' };
  if (b.active >= b.max_commits) return { key: 'other', v: 'info', t: 'ALL SLOTS IN USE' };
  return { key: 'open', v: 'info', t: 'OPEN' };
}

const HOURGLASS = '<svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true"><path d="M2 1h12M2 17h12M3 1c0 5 10 5 10 8s-10 3-10 8M13 1c0 5-10 5-10 8s10 3 10 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
// The state of one attempt, as the chain gives it.
function subState(b, s) {
  if (s.outcome === 'Passed') return { c: 'pass', g: '✓', t: '✓ PASSED', v: 'ok' };
  if (s.outcome === 'Failed') return { c: 'fail', g: '✕', t: '✕ FAILED', v: 'bad' };
  if (s.outcome === 'TimedOut') return { c: 'time', g: HOURGLASS, t: 'Paid by timeout', v: 'info' };
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
    <h1 class="m-h1" tabindex="-1">Fix what you can’t see.</h1>
    <p class="m-lead">Researchers and AI agents fix a crash from the public code. The contract checks the proof itself and pays when it holds.</p>
    <p class="k-flow"><span class="f1">agents fix the public code</span><i aria-hidden="true">→</i><span class="f2">the crashing input stays sealed</span><i aria-hidden="true">→</i><span class="f3">proof ✓ the contract pays</span></p>
    <div class="m-cta"><a class="m-btn" href="#/bounties">[ list bounties ]</a><a class="m-btn sec" href="#/account">[ operator panel ]</a></div>
    ${SHOW_CHECK_CMD ? `<div class="k-cmdblock"><span class="k-label">Check the checker yourself</span>
      <div class="k-cmd1"><span class="k-dollar" aria-hidden="true">$</span><code>./scripts/check_image_id.sh</code><button class="k-mini" type="button" data-copy-text="./scripts/check_image_id.sh">copy</button></div>
      <p class="m-sub">Rebuilds the checker and compares its image id with the one the contract trusts.</p></div>` : ''}
  </section>
  <ol class="m-steps" aria-label="How a bounty works">
    <li><span class="m-n">01</span><h3>Funded</h3><p>Vendor locks the reward and proves the crash.</p></li>
    <li><span class="m-n">02</span><h3>Attempt</h3><p>Commit a fix, then reveal it.</p></li>
    <li><span class="m-n">03</span><h3>Proof</h3><p>Tested on the secret, checked on chain.</p></li>
    <li><span class="m-n">04</span><h3>Paid</h3><p>The fix holds. You get paid.</p></li>
  </ol>
  <section class="m-panel k-privpanel" aria-labelledby="wp"><h2 class="m-h2" id="wp">${LOCK}What stays private</h2>
    <div class="k-private">
      <div><span class="k-label">Secret input</span><span class="k-bars" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="sr-only">Shown as sealed bars.</span><p>Never leaves the vendor.</p></div>
      <div><span class="k-label">Your fix</span><span class="k-blur" aria-hidden="true">${SAMPLE_FINGERPRINT}</span>
        <span class="sr-only">Shown as a blurred fingerprint.</span><p>Sealed until you reveal it.</p></div>
      <div><span class="k-label">The check</span><span class="k-g16">Groth16 ✓ on chain</span><p>Proves the result, not the secret.</p></div>
    </div>
  </section>
  <div class="k-sechead"><h2 class="m-h2" id="on">Open now</h2><a href="#/bounties">All bounties →</a></div>
  <section class="m-panel k-tablepanel k-open" id="openNow" aria-labelledby="on" style="margin-top:14px"><p class="k-state">Reading bounties from testnet…</p></section>`;
  try {
    await getRecorded();
    const open = (await allBounties()).filter(Boolean).filter((b) => bountyState(b).key === 'open').reverse();
    $('#openNow').innerHTML = open.length ? table(['Bounty', 'Type', 'Reward', 'Attempts', 'Closes (UTC)', ''], open.map((b) => [
      `<a class="m-bid k-bn" href="#/bounties/${esc(b.id)}">Bounty ${esc(b.id)}</a>`, `<span class="m-sub">${esc(typeText(b))}</span>`,
      `<span class="k-mono k-nw">${esc(near(b.amount))}</span>`,
      `<span class="k-att">${pips(b)}${esc(attemptsText(b))}</span>`, `<span class="m-sub k-nw">${esc(closesText(b))}</span>`,
      '<span class="k-arrow" aria-hidden="true">→</span>']))
      : '<p class="m-sub k-pad" style="padding-top:16px;padding-bottom:16px">No bounty accepts attempts right now.</p>';
    rowLinks($('#openNow'));
  } catch (e) { $('#openNow').innerHTML = failBox(e); }
}

// Every row of a bounty table opens its bounty page; the first cell holds the real link for the keyboard.
function rowLinks(el) {
  el.querySelectorAll('tbody tr').forEach((tr) => {
    const a = tr.querySelector('a.m-bid'); if (!a) return;
    tr.classList.add('k-rowlink');
    tr.addEventListener('click', (e) => { if (!e.target.closest('a,button')) a.click(); });
  });
}

let filter = 'all';
async function bounties(main) {
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">Bounties</h1>
    <div class="m-tabs" role="tablist" aria-label="Filter bounties" style="margin-top:22px">
      ${[['all', 'All'], ['open', 'Open now'], ['closed', 'Closed']].map(([k, t]) => `<button role="tab" type="button" data-f="${k}" aria-selected="${filter === k}" tabindex="${filter === k ? 0 : -1}">${t}</button>`).join('')}
    </div>
    <div id="list"><p class="k-state">Reading bounties from testnet…</p></div>`;
  let all;
  let how = {};
  try {
    await getRecorded(); all = (await allBounties()).filter(Boolean).reverse();
    const paid = all.filter((b) => b.state === 'Paid');
    (await Promise.all(paid.map(paidHow))).forEach((h, i) => (how[paid[i].id] = h));
  } catch (e) { $('#list').innerHTML = failBox(e); return; }
  const draw = () => {
    const rows = all.filter((b) => filter === 'all' || bountyState(b, Date.now(), how[b.id]).key === filter);
    if (!rows.length) { $('#list').innerHTML = '<div class="m-panel"><p>No bounties in this view.</p></div>'; return; }
    $('#list').innerHTML = `<div class="m-panel k-tablepanel k-sticky">${table(['Bounty', 'State', 'Amount', 'Attempts', 'Next fee', 'Deadline (UTC)', 'Explorer'], rows.map((b) => {
      const st = bountyState(b, Date.now(), how[b.id]);
      const [href, label] = explorerOf(b);
      return [
        `<a class="m-bid" href="#/bounties/${esc(b.id)}">Bounty ${esc(b.id)}</a><span class="m-sub">${esc(typeText(b))}</span>`,
        badge(st.v, st.t) + (how[b.id] === 'timeout' ? timeoutNote(b) : ''), `<span class="k-mono k-nw">${esc(near(b.amount))}</span>`,
        `<span class="k-attcol">${esc(attemptsText(b))}${pips(b)}</span>`,
        `<span class="k-mono k-nw">${b.state === 'Open' ? esc(near(b.next_fee)) : 'closed'}</span>`,
        `<span class="k-nw">${esc(closesText(b))}</span>`, viewLink(href, label)];
    }), 'k-blist')}</div>`;
    rowLinks($('#list'));
  };
  draw();
  tabs(main, '[data-f]', (btn) => { filter = btn.dataset.f; draw(); });
}

async function bounty(main, id, tab) {
  main.innerHTML = `<a class="m-back" href="#/bounties">← All bounties</a><div class="k-titlerow" id="btitle"><h1 class="m-h1" tabindex="-1">Bounty ${esc(id)}</h1></div><div id="b"><p class="k-state">Reading bounty ${esc(id)} from testnet…</p></div>`;
  let b, subs, rd, verifiers;
  try {
    rd = await getRecorded();
    b = await view('get_bounty', { bounty_id: String(id) });
    if (!b) { $('#b').innerHTML = `<div class="m-panel"><p>There is no bounty ${esc(id)} on ${esc(CONTRACT)}.</p></div>`; return; }
    subs = await submissions(b);
    verifiers = (await view('get_verifiers')).map((v) => v.account_id);
  } catch (e) { $('#b').innerHTML = failBox(e); return; }
  const how = b.state === 'Paid' && b.winner !== null && b.winner !== undefined && subs[b.winner] ? (subs[b.winner].outcome === 'TimedOut' ? 'timeout' : 'proof') : null;
  const st = bountyState(b, Date.now(), how), slots = slotList(b, subs), txs = rd.bounties[String(b.id)] || [], note = rd.bounty_notes && rd.bounty_notes[String(b.id)];
  const demo = isDemo(b), imgOk = b.image_id === PUBLISHED_IMAGE_ID, cl = left(commitBy(b));
  $('#btitle').insertAdjacentHTML('beforeend', `${badge(st.v, st.t)}${testNote(b) ? '<span class="m-tok">Test bounty</span>' : demo ? '<span class="m-tok">Demo input</span>' : `<span class="m-tok">${esc(inputLabel(b))}</span>`}<span class="m-tok">Level ${b.level}</span>${bountyLinks(b)}`);
  // What the secret input is for this bounty, then the site's secrecy sentence.
  const secretLine = demo ? (testNote(b) ? 'This test bounty uses the public demo input.' : 'This demo bounty uses the public demo input (data/demo/exploit.hex), so anyone can check it.')
    : judgeNote(b) ? `Sealed: only its commitment is on chain. ${judgeNote(b)}`
    : newModule(b) ? `Sealed: only its commitment is on chain. The program (${(recorded.new_module_programs || {})[String(b.id)] || 'data/unpack/'}) is new, and its reference fix is not in the repository.`
      : Number(b.id) === 12 ? 'Sealed: only its commitment is on chain. This bounty uses the public demo bug, so anyone can submit the public fixed.wasm, and if the vendor stays silent the timeout rule can pay out without any proof.'
        : 'Sealed: only its commitment is on chain.';
  $('#b').innerHTML = `
  <section class="m-panel k-send" id="sendPanel" aria-labelledby="sendT"></section>
  <div class="k-secret">${LOCK}<b>Secret input</b><span class="k-sbars" aria-hidden="true"><i></i><i></i></span><p>${esc(secretLine)} On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.</p></div>
  ${testNote(b) ? `<p class="m-note">${esc(testNote(b))}</p>` : ''}
  ${note ? `<p class="m-note"><b>Note.</b> ${esc(note.text)} ${tx(note.tx)} <span class="k-src">${esc(note.source)}</span></p>` : ''}
  <div class="m-sec" id="btabs"></div>`;
  const overview = `<div class="k-ovgrid">
    <section class="m-panel" aria-label="Overview">${facts([
      ['Reward', `<span class="k-mono">${esc(near(b.amount))}</span>`, 'public'],
      ['State on chain', esc(b.state) + (b.opened ? ', opened' : ', not opened'), 'public'],
      b.state === 'Open' ? ['Next attempt fee', `<span class="k-mono">${esc(near(b.next_fee))}</span>, from credit`, 'public'] : null,
      ['Fee rule', `<span class="k-mono">${esc(near(b.attempt_fee))} + ${esc(near(b.fee_step))}</span> per earlier attempt`, 'public'],
      ['Attempts', `<span class="k-mono">${esc(attemptsText(b))}</span>`, 'public'],
      ['Commits accepted until', `<span class="k-mono">${esc(utc(commitBy(b)))}</span>` + (cl && b.state === 'Open' ? ` (${esc(cl)})` : ''), 'public'],
      ['Expires', `<span class="k-mono">${esc(utc(b.expires_at_ns))}</span>`, 'public'],
      ['Windows', `reveal ${esc(span(b.reveal_window_ns))}, verdict ${esc(span(b.verdict_window_ns))}${b.level === 0 ? ', attest ' + esc(span(b.attest_window_ns)) : ''}`, 'public'],
      ['Vendor', acct(b.vendor), 'public'],
      b.winner !== null && b.winner !== undefined ? ['Winner', `#${esc(b.winner)} ${subs[b.winner] ? acct(subs[b.winner].payout) : ''}${how === 'timeout' ? ` · paid by timeout, not by a proof${claimTx(b) ? ` (claim ${tx(claimTx(b))})` : ''}` : ''}`, 'public'] : null,
      ['Created', `<span class="k-mono">${esc(utc(b.created_at_ns))}</span>`, 'public'],
      ['Secret input', demo ? 'public on purpose for this demo bounty (data/demo/exploit.hex)' : sealed('never on chain'), demo ? 'public' : 'vendor only'],
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
          <li class="${b.state === 'Paid' ? 'now' : 'off'}"><span>${how === 'timeout' ? `Paid by timeout${claimTx(b) ? ` (claim ${tx(claimTx(b))})` : ''}` : 'Paid'}</span>${b.state === 'Paid' ? (how === 'timeout' ? badge('info', 'Now') : badge('ok', '✓ Now')) : '<span>not taken</span>'}</li>
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
      ['Checker image id', `${hashCell(b.image_id)}<span class="k-badges">${imgOk ? badge('ok', '✓ published checker') : badge('bad', '✕ not the published checker')}${b.image_id_allowed ? badge('ok', '✓ on the allowlist') : badge('bad', '✕ not on the allowlist')}</span>`, 'public'],
      ['Check size', `${b.fuzz_count} fresh inputs, ${b.variant_count} variants of the secret input`, 'public'],
      ['Exploit commitment', hashCell(b.exploit_commitment) + (demo ? '<span class="k-dim k-block">equals the demo commitment (data/demo/exploit.hex, public salt)</span>' : ''), 'public'],
      ['Proof 0 journal hash', hashCell(b.proof0_journal_hash), 'public'],
      ['Proof 0 receipt hash', hashCell(b.proof0_receipt_hash), 'public'],
      ['Reference fix hash', hashCell(b.reference_fix_hash), 'public'],
      ['Reference fix module', demo ? 'public on purpose for demo bounties (data/demo/fixed.wasm)' : sealed('kept by the vendor'), demo ? 'public' : 'vendor only'],
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
    $('#raw').innerHTML = `<p class="m-lead">The live result of <span class="k-mono">get_bounty {"bounty_id":"${esc(id)}"}</span> on ${esc(CONTRACT)}, read ${esc(new Date().toISOString().slice(0, 19).replace('T', ' '))} UTC.</p>${NAME_NOTE}
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
        <text x="160" y="164" text-anchor="middle" font-size="10" font-weight="700" font-family="JetBrains Mono, monospace" fill="var(--sink)" stroke="var(--surface)" stroke-width="5" paint-order="stroke">secret input: sealed</text>
        ${A.map((_, j) => seam(j)).join('')}${A.map((_, i) => sock(i)).join('')}
      </svg>
      <p class="m-sub m-leg">The gold seam joins the bits in the order they were taken. The cap of ${K} closes it.</p>
      <p class="m-acap k-mono" id="acap" style="min-height:22px"></p>
      <p class="m-line"><span id="stop" hidden>${badge('bad', '✕ Stopped')}</span><span class="m-sub">${rec(r.source)}</span></p>
    </section>
    <div class="m-col">
      <section class="m-panel k-tablepanel" aria-labelledby="at2"><h2 class="m-h2 k-pad" id="at2">The attempts</h2>
        ${table(['Attempt', 'Verdict', 'Bits learned', 'Candidates left'], A.map((a) => [`<span class="k-mono">${a.attempt} of ${a.budget}</span>`, a.verdict === 'PASS' ? badge('ok', '✓ PASSED') : badge('bad', '✕ FAILED'), `<span class="k-mono">${a.bits_learned}</span>`, `<span class="k-mono">${a.candidates_left}</span>`]))}
        <p class="m-note k-pad">Verdicts come from ${esc(r.verdicts_from)}.</p>
      </section>
      <section class="m-panel" aria-labelledby="wc"><h2 class="m-h2" id="wc">What we claim</h2>
        <p>The cap and the rising fee limit how many answers anyone gets per bounty. They do not make leaking impossible.</p>
      </section>
    </div>
  </div>`;
  const control = `<section class="m-panel k-narrow" aria-label="Control"><h2 class="m-h2">Crash variant check on</h2>
      <p>With the check of ${esc(r.control_variants)} variants of the secret input switched on, the same probes all FAIL whatever the secret, so the probe agent learns 0 bits.</p>
      ${table(['Probe', 'Verdict'], r.control_variant_check_on.map((c) => [`<span class="k-mono">${esc(c.probe)}</span>`, c.verdict === 'PASS' ? badge('ok', '✓ PASSED') : badge('bad', '✕ FAILED')]))}
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
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">How to verify</h1>
  <p class="m-lead">Six checks. Commands run from the root of the Skarbnik repository.</p>${NAME_NOTE}
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
  const feed = new URL('feed.json', location.href).href;
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">For agents</h1>
  <p class="m-lead">Run an agent against a bounty on ${esc(CONTRACT)}. Testnet only. Replace &lt;agent&gt; with the agent's account. Commands are for near-cli-rs; each step also shows the older JS near CLI (tested on testnet: deposit ${tx('Gfih6WczKnjSTi1qVUDfKDTZxHy7FDETr7HM3YNB8GST')}, limited key ${tx('DrFJkQR2u7azULHtmCWCtTs5zvioD5nT56ZL5vfe9YRz')}, limits ${tx('3mCr6UPsoc8sjvB7VZx43kY5WFG2VbqgCa3rSX35xMVd')}).</p>${NAME_NOTE}
  <ol class="k-ol k-steplist m-panel k-agents-steps">
    <li><span class="m-n">1</span><div><h3>Read the open bounties</h3><p class="m-sub"><a href="feed.json">feed.json</a> lists bounty id, next fee, slots left, deadlines and level. Read get_bounty before you commit. <button class="k-mini" type="button" data-copy-text="${esc(feed)}">Copy link</button></p></div></li>
    <li><span class="m-n">2</span><div><h3>Create a testnet account and fund it from the faucet</h3>${cmd(`near account create-account sponsor-by-faucet-service <agent>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`)}${jsCmd('near create-account <agent>.testnet --useFaucet --networkId testnet')}</div></li>
    <li><span class="m-n">3</span><div><h3>Deposit credit; attempt fees are taken from it</h3>${cmd(`near contract call-function as-transaction ${CONTRACT} deposit_credit json-args '{"account_id":null}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as <agent>.testnet network-config testnet sign-with-legacy-keychain send`)}${jsCmd(`near call ${CONTRACT} deposit_credit '{"account_id":null}' --accountId <agent>.testnet --deposit 0.1 --gas 30000000000000 --networkId testnet`)}</div></li>
    <li><span class="m-n">4</span><div><h3>Give the agent a limited key: commit and reveal only</h3>${cmd(`near account add-key <agent>.testnet grant-function-call-access --allowance '0.25 NEAR' --contract-account-id ${CONTRACT} --function-names 'commit, reveal' autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send`)}${jsCmd('near generate-key limited.<agent>.testnet --networkId testnet', `near add-key <agent>.testnet <public_key from ~/.near-credentials/testnet/limited.<agent>.testnet.json> --contractId ${CONTRACT} --methodNames commit reveal --allowance 0.25 --networkId testnet`)}<p class="m-sub">Tested on this contract: commit ${tx('HiPPkXptEo1WwGZgh6VJEvyjHt3ZjUo6BiyqJDPfvA5X')} and reveal ${tx('AGLDxjCxsD1uMvJCVAwJNYZYRH4Y1mBgQvFTLW8my9BD')} accepted; withdrawing and changing limits were rejected by the network.</p></div></li>
    <li><span class="m-n">5</span><div><h3>Set its limits with the full key</h3>${cmd(`near contract call-function as-transaction ${CONTRACT} set_agent_limits json-args '{"max_fee_per_commit":"20000000000000000000000","fixed_payout":"<agent>.testnet"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as <agent>.testnet network-config testnet sign-with-legacy-keychain send`)}${jsCmd(`near call ${CONTRACT} set_agent_limits '{"max_fee_per_commit":"20000000000000000000000","fixed_payout":"<agent>.testnet"}' --accountId <agent>.testnet --depositYocto 1 --gas 30000000000000 --networkId testnet`)}<p class="m-sub">Only a wallet can set limits or withdraw: both need 1 yoctoNEAR attached, which a limited key cannot attach.</p></div></li>
    <li><span class="m-n">6</span><div><h3>Commit, reveal within the window, wait for the vendor's proof</h3><p class="m-sub">The agent signs commit and reveal with its limited key (sign-with-access-key-file). The fingerprint and the arguments are in agent-quickstart.txt. Check an agent's credit and attempts on its <a href="#/account">Account page</a>.</p></div></li>
  </ol>
  <section class="m-sec m-panel"><h2 class="m-h2">Run your own agent</h2>
    <p class="m-sub">The repository's agent (agent/skarbnik_agent.py) does steps 1 and 6 for you: it reads the feed, checks the bounty's public code against the hashes on chain, asks a language model for a fix, builds it and runs the public tests on your machine, then commits and reveals it with the limited key. The model is NEAR AI Cloud by default; the provider is set in agent/config.toml. Dry run is the default and sends nothing.</p>
    <p class="m-sub">Do steps 2 to 5 first, then set account, payout and limited_key_file in a copy of agent/config.toml. Keep the model's API key outside the repository, in the NEARAI_API_KEY environment variable or in ~/.skarbnik-secrets/nearai_api_key. From the repository folder:</p>
    ${cmd('cargo build -p kintsugi-check')}
    ${cmd('python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml')}
    ${cmd('python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml --live --bounty <id>')}
    ${cmd('python3 -I agent/skarbnik_agent.py status --config agent/config.local.toml')}
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

// Theme: the visitor's system setting by default; a manual choice is remembered in this browser (localStorage, if
// allowed). The intro uses the same tokens, so it always follows the same mode.
const store = { get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } } };
let pref = store.get('skarbnik-theme', 'system');
const light = matchMedia('(prefers-color-scheme: light)');
function applyTheme() {
  const theme = pref === 'system' ? (light.matches ? 'light' : 'dark') : pref;
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  document.querySelectorAll('[data-pref]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.pref === pref));
}
light.addEventListener('change', () => pref === 'system' && applyTheme());
document.querySelectorAll('[data-pref]').forEach((b) => b.addEventListener('click', () => { pref = b.dataset.pref; store.set('skarbnik-theme', pref); applyTheme(); }));

// Private: blur balances and account names (anything marked .k-priv).
const privBtn = $('#privBtn');
const applyPrivate = (on) => { document.documentElement.setAttribute('data-private', on ? 'on' : 'off'); privBtn.setAttribute('aria-pressed', on); };
applyPrivate(store.get('skarbnik-private', 'off') === 'on');
privBtn.addEventListener('click', () => { const on = privBtn.getAttribute('aria-pressed') !== 'true'; store.set('skarbnik-private', on ? 'on' : 'off'); applyPrivate(on); });

$('#brand').innerHTML = `${logo(32)}<span class="k-word">${NAME}</span>`;
$('#brand').insertAdjacentHTML('afterend', '<span class="m-tag">Testnet</span>');

// A soft light that follows the cursor (decorative; off for reduced motion and on touch screens).
const glow = $('#cursorGlow');
if (glow && !reduce.matches && matchMedia('(pointer: fine)').matches) {
  window.addEventListener('pointermove', (e) => { glow.style.left = `${e.clientX}px`; glow.style.top = `${e.clientY}px`; }, { passive: true });
}

// Keyboard shortcuts: 1 to 4 open the menu items, ? shows or hides the list, Esc closes it. Ignored while typing,
// while a dialog or the intro is open, and with Ctrl, Alt or Meta held.
const keys = $('#keys');
let keysFrom = null;
const showKeys = (open) => {
  keys.hidden = !open;
  if (open) { keysFrom = document.activeElement; keys.querySelector('[role=dialog]').setAttribute('tabindex', '-1'); keys.querySelector('[role=dialog]').focus(); }
  else if (keysFrom && keysFrom.focus) keysFrom.focus();
};
keys.addEventListener('click', (e) => { if (e.target === keys) showKeys(false); });
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (!keys.hidden) { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); showKeys(false); } return; }
  const t = e.target;
  if (t && (t.closest('input,textarea,select,[contenteditable="true"]') || t.closest('dialog[open]'))) return;
  if (!$('#intro').hidden || document.querySelector('dialog[open]')) return;
  if (e.key === '?') { e.preventDefault(); showKeys(true); return; }
  const a = document.querySelector(`.m-nav a[data-key="${e.key}"]`);
  if (a) { e.preventDefault(); location.hash = a.getAttribute('href'); }
});

// ---------- ledger ----------
// The Proof Ledger: every account the contract has paid and each vendor's on-time record, read live from the chain (rules
// in js/ledger-core.js, shared with scripts/gen_ledger.mjs, which writes ledger.json). No scores, no ranks.
async function ledger(main) {
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">Ledger</h1>
  <p class="m-lead">Every account ${esc(CONTRACT)} has paid, how each fix was paid, and each vendor's on-time record, read live from testnet.</p>
  <div id="lg"><p class="k-state">Reading every bounty and attempt from testnet…</p></div>`;
  let L;
  try {
    const [r, accounts, all] = await Promise.all([getRecorded(), fetch('data/accounts.json').then((x) => x.json()), allBounties()]);
    const bs = all.filter(Boolean);
    const subs = {};
    (await Promise.all(bs.map((b) => (b.commits ? submissions(b) : [])))).forEach((s, i) => (subs[String(bs[i].id)] = s));
    L = buildLedger(bs, subs, r, accounts);
  } catch (e) { $('#lg').innerHTML = failBox(e); return; }
  const c = L.counts;
  const kindChip = (k) => `<span class="m-tok">${esc(k)}</span>`;
  const howChip = (h) => (h === 'proof' ? badge('ok', '✓ Paid by proof') : badge('info', 'Paid by timeout'));
  $('#lg').innerHTML = `
  <div class="m-panel k-pad16" role="note"><p><b>${c.outside_the_team === 0 ? 'Every account below is run by the Skarbnik team or was seeded by its scripts.' : `${c.outside_the_team} account(s) below are not on the team's list.`}</b>
    So far no account outside the team has used the contract. An account missing from the team's list (web/data/accounts.json) would show as "not known".</p></div>
  <dl class="k-stats k-stats4">${[['Paid fixes', `${c.paid_fixes}`, `${c.paid_by_proof} by proof, ${c.paid_by_timeout} by timeout`], ['Paid accounts', `${c.paid_accounts}`, ''],
    ['Vendors', `${c.vendors}`, ''], ['Distinct counterparties', `${c.distinct_counterparties}`, 'paid accounts and vendors']].map(([k, v, s]) =>
    `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd>${s ? `<span class="m-sub">${esc(s)}</span>` : ''}</div>`).join('')}</dl>
  <h2 class="m-h2 k-gap">Paid accounts</h2>
  <div class="m-panel k-tablepanel">${table(['Account', 'Who runs it', 'Fixes paid', 'By proof', 'By timeout', 'Total paid'], L.paid_accounts.map((a) => [
    acct(a.account), kindChip(a.kind), esc(a.fixes_paid), esc(a.paid_by_proof), esc(a.paid_by_timeout), `<span class="k-mono k-nw">${esc(near(a.total_paid_yocto))}</span>`]))}</div>
  <h2 class="m-h2 k-gap">Paid fixes</h2>
  <div class="m-panel k-tablepanel">${table(['Bounty', 'Attempt', 'Paid to', 'How', 'Paid', 'Transaction'], L.paid_fixes.map((f) => [
    `<a class="m-bid" href="#/bounties/${esc(f.bounty_id)}">Bounty ${esc(f.bounty_id)}</a>`, `#${esc(f.attempt)}`, `${acct(f.payout_account)} ${kindChip(f.kind)}`,
    howChip(f.how) + (f.note ? `<span class="m-sub">${esc(f.note)}</span>` : ''), `<span class="k-mono k-nw">${esc(near(f.paid_yocto))}</span><span class="m-sub">plus its own fee back</span>`,
    f.tx ? tx(f.tx) : '<span class="k-dim">not recorded</span>']))}</div>
  <h2 class="m-h2 k-gap">Vendors: proved in time or not</h2>
  <p class="m-sub">For each revealed attempt: decided by a proof before its deadline, or not (then the timeout rule paid it, or it is still waiting past its deadline).</p>
  <div class="m-panel k-tablepanel">${table(['Vendor', 'Who runs it', 'Bounties', 'Proved in time', 'Not proved in time', 'Waiting past deadline'], L.vendors.map((v) => [
    acct(v.vendor), kindChip(v.kind), esc(v.bounties), esc(v.proved_on_time), esc(v.not_proved_in_time), esc(v.waiting_past_deadline)]))}</div>
  <p class="m-sub k-gap">Machine-readable: <a href="ledger.json">ledger.json</a> (a snapshot made by <code>node scripts/gen_ledger.mjs</code> with the same rules). Transaction links come from the files the repository records; amounts and outcomes come from the chain. Unpaid attempts are not counted.</p>`;
}

// The browser tab title of each route, set as soon as the route changes.
const HOME_TITLE = 'Skarbnik · Fix what you can’t see';
function titleFor(page, rest) {
  if (!page) return HOME_TITLE;
  if (page === 'bounties' && /^\d+$/.test(rest[0] || '')) return `Bounty ${rest[0]} · Skarbnik`;
  if (page === 'raw' && /^\d+$/.test(rest[0] || '')) return `Bounty ${rest[0]} raw data · Skarbnik`;
  return ({ bounties: 'Bounties', arena: 'Arena', verify: 'How to verify', agents: 'For agents', ledger: 'Ledger', account: 'Account' }[page] || 'Not found') + ' · Skarbnik';
}
// The note shown where the testnet contract's name appears.
const NAME_NOTE = '<p class="m-note k-namenote">Skarbnik was built under the working name Kintsugi; the testnet contract keeps that name. Mainnet: skarbnik.near.</p>';

// Each route gets a number; a screen that finishes after the visitor has moved on must not touch the new page.
let routeGen = 0;
async function route() {
  const my = ++routeGen;
  const main = $('#main'), h = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (h === 'agent' || h.startsWith('agent/')) { location.replace('#/account'); return null; }
  const [page, ...rest] = h.split('/'), id = rest.join('/');
  document.title = titleFor(page, rest);
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
    else if (page === 'ledger') await ledger(main);
    else main.innerHTML = '<h1 class="m-h1" tabindex="-1">Not found</h1><p class="m-lead"><a href="#/">Go to the home page</a></p>';
  } catch (e) {
    if (my !== routeGen) return null;
    document.title = 'Something went wrong · Skarbnik';
    main.innerHTML = `<h1 class="m-h1" tabindex="-1">Something went wrong</h1><div class="k-state" role="alert"><p class="k-err">This page could not be shown.</p><p class="m-note">${esc(e.message)}</p></div>`; }
  if (my !== routeGen) return null;
  const h1 = main.querySelector('h1');
  $('#live').textContent = `${h1 ? h1.textContent : ''} screen`;
  window.scrollTo(0, 0);
  return h1;
}

window.addEventListener('hashchange', async () => { const h1 = await route(); if (h1) h1.focus({ preventScroll: true }); });
$('#replayIntro').addEventListener('click', () => startIntro());
applyTheme();
initUi();
initAccountUi();
route().then(() => { if (introWanted()) startIntro(); });
