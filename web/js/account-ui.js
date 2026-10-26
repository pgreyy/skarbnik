// The parts of the site that use a wallet (testnet only): the header wallet control with the credit chip, the credit
// dialog (deposit_credit, withdraw_credit), the attempt panel on a bounty page (commit, reveal, then waiting for the
// vendor's proof), and the Account page: balances, agent keys, the agent limits form and the stop button
// (set_agent_limits), "Create an agent key" (made in this browser, shown once, added by the wallet as a key limited to
// commit and reveal), and an audit log. Every payment goes through a confirm step and then the wallet; the page shows
// only what the chain says. Attempt fees are taken from credit deposited in the contract first.
import { CONTRACT, EXPLORER_ACCOUNT, view, near, utc, span, commitBy, nsToDate, allBounties, submissions, accessKeys } from './chain.js';
import { TX_INDEX } from './config.js';
import * as W from './wallet.js';
import { fingerprint, newNonce, hex, b64, sha256, putAttempt, attemptsFor, dropAttempt, downloadRecord, toYocto } from './attempt.js';
import { newAgentKey } from './agentkey.js';
import { $, esc, icon, chip, tx, acct, toast, table, facts, bothTimes, cmd, note } from './ui.js';

let credit = null; // the connected account's contract credit, yoctoNEAR string
const short = (a) => (a.length > 22 ? `${a.slice(0, 12)}…${a.slice(-8)}` : a);
const creditListeners = new Set();
export const onCredit = (f) => { creditListeners.add(f); return () => creditListeners.delete(f); };
const OK = (t) => chip('k-proof', t, 'check');
const BAD = (t) => chip('k-fail', t, 'x');

async function refreshCredit() {
  if (W.state.status !== 'on') { credit = null; } else {
    try { credit = String(await view('get_credit', { account_id: W.state.account }, { fresh: true })); } catch { credit = null; }
  }
  renderWallet(); creditListeners.forEach((f) => f(credit));
}

// ---------- header control (desktop header and the phone menu) ----------
function walletHtml(where) {
  const s = W.state;
  if (s.status === 'on') {
    return `<button class="credit-chip" type="button" data-w="credit" aria-haspopup="dialog">Credit <b>${credit === null ? '…' : esc(near(credit))}</b></button>
      <div class="acct"><button class="btn btn-g btn-s" type="button" data-w="menu" aria-haspopup="true" aria-expanded="false" aria-controls="acctMenu-${where}" title="${esc(s.account)}">${icon('user')} ${esc(short(s.account))}</button>
      <div class="acct-menu" id="acctMenu-${where}" hidden>
        <button type="button" data-act="activity">My account and agent setup</button>
        <button type="button" data-act="copy">Copy account name</button>
        <button type="button" data-act="credit">Credit</button>
        <button type="button" data-act="out">Disconnect</button></div></div>`;
  }
  if (s.status === 'connecting') return '<button class="btn btn-g btn-s" type="button" disabled aria-busy="true">Connecting…</button>';
  if (s.status === 'wrongnet') return `${BAD('Not a testnet account')}<button class="btn btn-g btn-s" type="button" data-w="out">Disconnect</button>`;
  if (s.status === 'failed') return `<span class="werr" role="alert">${esc(s.error || 'The wallet did not connect.')}</span><button class="btn btn-g btn-s" type="button" data-w="connect">Try again</button>`;
  return `<button class="btn btn-g btn-s" type="button" data-w="connect">${icon('wallet')} Connect wallet</button>`;
}
function renderWallet() {
  for (const [id, where] of [['#walletArea', 'top'], ['#sheetWallet', 'sheet']]) {
    const el = $(id); if (!el) continue;
    el.innerHTML = walletHtml(where);
    const c = el.querySelector('[data-w="connect"]'); if (c) c.onclick = () => W.connect();
    const o = el.querySelector('[data-w="out"]'); if (o) o.onclick = () => W.disconnect();
    const cr = el.querySelector('[data-w="credit"]'); if (cr) cr.onclick = () => openCredit();
    const btn = el.querySelector('[data-w="menu"]'), menu = el.querySelector('.acct-menu');
    if (btn) {
      const show = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', open); if (open) menu.querySelector('button').focus(); };
      btn.onclick = () => show(menu.hidden);
      menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { show(false); btn.focus(); } });
      menu.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
        show(false);
        const a = W.state.account;
        if (b.dataset.act === 'copy') { try { await navigator.clipboard.writeText(a); toast('Account name copied.'); } catch { toast('Copy was blocked. Select the name instead.'); } }
        if (b.dataset.act === 'credit') openCredit();
        if (b.dataset.act === 'activity') location.hash = `#/account/${encodeURIComponent(a)}`;
        if (b.dataset.act === 'out') { await W.disconnect(); toast('Disconnected.'); }
      }));
    }
  }
}

export async function initAccountUi() {
  renderWallet();
  W.onChange(() => { renderWallet(); refreshCredit(); });
  await W.init();
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.acct-menu').forEach((m) => { if (!m.hidden && !e.target.closest('.acct')) { m.hidden = true; const b = m.parentElement.querySelector('[data-w="menu"]'); if (b) b.setAttribute('aria-expanded', 'false'); } });
  });
}

// ---------- credit dialog ----------
const dlg = () => $('#creditDlg');
let creditView = { mode: null, phase: 'form', amount: '', msg: '', tx: null };

export async function openCredit(mode = null) {
  creditView = { mode, phase: 'form', amount: '', msg: '', tx: null };
  if (W.state.status === 'on') await refreshCredit();
  await drawCredit();
  if (!dlg().open) dlg().showModal();
}

async function drawCredit() {
  const d = dlg(), s = W.state;
  const head = `<div class="dhead"><h2 class="h3" id="creditTitle">Credit</h2><button class="btn btn-g btn-s" type="button" data-close>Close</button></div><p class="small faint">Testnet, test NEAR, no real money.</p>`;
  if (s.status !== 'on') {
    d.innerHTML = `${head}<p class="body mt16">${s.status === 'wrongnet' ? 'This account is not a testnet account. Switch to a testnet account in your wallet.' : 'Connect a testnet wallet to see and use your credit.'}</p>
      ${s.status === 'wrongnet' ? '' : `<div class="row mt16"><button class="btn btn-p" type="button" id="dlgConn">${icon('wallet')} Connect wallet</button></div>`}`;
    bindCommon(d); const c = $('#dlgConn', d); if (c) c.onclick = () => W.connect(); return;
  }
  const bal = await W.balance(s.account);
  const c = credit === null ? null : BigInt(credit);
  const v = creditView;
  let body = '';
  if (v.phase === 'form' && !v.mode) {
    body = `<div class="row">${c === 0n ? '<p class="small">No credit yet.</p>' : ''}<button class="btn btn-p" type="button" data-mode="deposit">Deposit</button>${c && c > 0n ? '<button class="btn btn-g" type="button" data-mode="withdraw">Withdraw</button>' : ''}</div>`;
  } else if (v.phase === 'form') {
    const dep = v.mode === 'deposit';
    body = `<form class="form" id="credForm" novalidate>
      <div class="field"><label for="amt">${dep ? 'Amount to deposit' : 'Amount to withdraw'} (NEAR)</label>
        <input id="amt" name="amt" inputmode="decimal" autocomplete="off" value="${esc(v.amount)}" aria-describedby="amtErr amtHint" ${v.msg ? 'aria-invalid="true"' : ''}>
        <p class="hint" id="amtHint">${dep ? 'Your wallet sends this NEAR to the contract, where it becomes credit for attempt fees.' : 'Withdraw needs a wallet approval. An agent key cannot do it.'}</p>
        ${v.msg ? `<p class="ferr" id="amtErr" role="alert">${esc(v.msg)}</p>` : '<p id="amtErr" hidden></p>'}</div>
      <div class="row"><button class="btn btn-p" type="submit">Review ${dep ? 'deposit' : 'withdrawal'}</button><button class="btn btn-g" type="button" data-mode="">Back</button></div></form>`;
  } else if (v.phase === 'confirm') {
    const dep = v.mode === 'deposit';
    body = `<div class="stack g16"><p class="body txt">${dep ? `Deposit <b class="mono">${esc(near(v.yocto))}</b> from ${esc(s.account)} as credit in ${esc(CONTRACT)}.` : `Withdraw <b class="mono">${esc(near(v.yocto))}</b> of credit to ${esc(s.account)}. The wallet attaches 1 yoctoNEAR, which only a wallet approval can do.`}</p>
      <div class="row"><button class="btn btn-p" type="button" id="doIt">Approve in wallet</button><button class="btn btn-g" type="button" data-mode="${v.mode}">Change amount</button></div></div>`;
  } else if (v.phase === 'wait') {
    body = '<p class="msg" role="status" aria-busy="true">Waiting for the wallet. Approve or reject the request in the wallet window.</p>';
  } else if (v.phase === 'done') {
    body = `<div class="msg ok" role="status">${OK('Done')} ${esc(v.msg)}${v.tx ? `<div class="mt8">${tx(v.tx)}</div>` : ''}</div><div class="row mt16"><button class="btn btn-g" type="button" data-mode="">Back to credit</button></div>`;
  } else if (v.phase === 'failed') {
    body = `<div class="msg bad" role="alert">${BAD('Not done')} ${esc(v.msg)}${v.tx ? `<div class="mt8">${tx(v.tx)}</div>` : ''}</div><div class="row mt16"><button class="btn btn-p" type="button" data-mode="${v.mode}">Try again</button><button class="btn btn-g" type="button" data-mode="">Back</button></div>`;
  }
  d.innerHTML = `${head}
    <div class="mt16">${facts([['Contract credit', `<span class="mono">${c === null ? 'could not read' : esc(near(credit))}</span>`], ['Wallet balance', `<span class="mono">${bal === null || bal === undefined ? 'could not read' : esc(near(bal))}</span>`], ['Account', `<span class="mono">${esc(s.account)}</span>`]])}</div>
    <p class="small mt12">Attempt fees are taken from this credit.</p><div class="mt16">${body}</div>
    <section class="mt24" aria-labelledby="recentT"><div class="row" style="justify-content:space-between"><h3 class="h4" id="recentT">Recent activity</h3><a class="lnk sm" href="#/account/${encodeURIComponent(s.account)}" data-close>View all</a></div>
      <div id="recent" class="mt12"><p class="small">Reading recent activity…</p></div></section>`;
  bindCommon(d);
  drawRecent(s.account);
  d.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { creditView = { mode: b.dataset.mode || null, phase: 'form', amount: '', msg: '' }; drawCredit().then(() => { const i = $('#amt', d); if (i) i.focus(); }); }));
  const f = $('#credForm', d);
  if (f) f.onsubmit = (e) => {
    e.preventDefault();
    const rawAmt = $('#amt', d).value, y = toYocto(rawAmt);
    let msg = '';
    if (!y) msg = 'Enter an amount above zero, for example 0.1.';
    else if (v.mode === 'withdraw' && (c === null || BigInt(y) > c)) msg = `You can withdraw at most ${near(credit || '0')}.`;
    else if (v.mode === 'deposit' && bal && BigInt(y) >= BigInt(bal)) msg = 'That is more than the wallet holds (it also needs a little for gas).';
    if (msg) { creditView = { ...v, amount: rawAmt, msg }; drawCredit().then(() => $('#amt', d).focus()); return; }
    creditView = { ...v, phase: 'confirm', yocto: y, amount: rawAmt, msg: '' }; drawCredit().then(() => $('#doIt', d).focus());
  };
  const go = $('#doIt', d);
  if (go) go.onclick = async () => {
    const dep = v.mode === 'deposit';
    creditView = { ...v, phase: 'wait' }; await drawCredit();
    // The wallet opens its own window over the page; a modal dialog would make it unclickable, so the dialog steps
    // aside while the wallet is open and comes back with the result.
    d.close();
    try {
      const out = W.readOutcome(dep ? await W.call('deposit_credit', { account_id: null }, v.yocto, 30) : await W.call('withdraw_credit', { amount: v.yocto }, '1', 30));
      await refreshCredit();
      creditView = out.ok ? { ...v, phase: 'done', tx: out.tx, msg: `${dep ? 'Deposited' : 'Withdrawn'} ${near(v.yocto)}. Credit is now ${credit === null ? 'unknown' : near(credit)}.` }
        : { ...v, phase: 'failed', tx: out.tx, msg: out.error };
    } catch (e) { creditView = { ...v, phase: 'failed', msg: W.plainError(e) }; }
    await drawCredit();
    if (!d.open) d.showModal();
  };
}

function bindCommon(d) { d.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => d.close())); }

// ---------- attempt panel (bounty page) ----------
const OUTCOME = { Passed: ['k-proof', 'Proof verified, PASS', 'check'], Failed: ['k-fail', 'Failed by a proof', 'x'], TimedOut: ['k-timeout', 'Timeout settlement', 'hourglass'], Released: ['k-refund', 'Not revealed in time, slot released', 'undo'] };

export function attemptPanel(el, b, subs, verifiers) {
  let busy = false, msg = '', msgKind = '';
  const draw = async () => {
    if (!el.isConnected) return; // the visitor left this bounty page
    const s = W.state, now = Date.now();
    const closed = b.state !== 'Open' || !b.opened || nsToDate(commitBy(b)).getTime() <= now;
    const slotsLeft = Math.max(0, b.max_commits - b.active);
    const mine = s.status === 'on' ? attemptsFor(s.account, b.id) : [];
    const step = mine.some((m) => m.index !== null && m.revealed) ? 3 : mine.some((m) => m.index !== null) ? 2 : 1;
    const stepper = `<ol class="steps3" aria-label="Steps of an attempt">${['Commit', 'Reveal', 'Vendor’s proof'].map((t, i) =>
      `<li class="${i + 1 === step ? 'now' : i + 1 < step ? 'past' : ''}"${i + 1 === step ? ' aria-current="step"' : ''}><span>${i + 1 < step ? '✓' : i + 1}</span>${t}</li>`).join('')}</ol>`;
    let mineHtml = '';
    for (const m of mine) {
      let sub = null; if (m.index !== null) { try { sub = await view('get_submission', { bounty_id: String(b.id), index: m.index }, { fresh: true }); } catch { /* shown below */ } }
      let line;
      if (m.index === null) line = '<p class="small">Commit sent, result not known yet. Reload the page; the record is kept.</p>';
      else if (!sub) line = '<p class="small">Could not read this attempt from the chain.</p>';
      else if (OUTCOME[sub.outcome]) line = `<p class="small">${chip(...OUTCOME[sub.outcome])} The chain says this attempt is final.</p>`;
      else if (sub.revealed_at_ns) {
        const dl = Number(BigInt(sub.deadline_ns) / 1000000n);
        line = now > dl ? `<p class="small">${chip('k-timeout', 'Vendor’s time is up', 'hourglass')} The vendor did not prove it by ${esc(bothTimes(dl))}. Anyone can now claim the timeout: a liveness rule, not a verdict.</p>`
          : `<p class="small">${chip('k-await', 'Awaiting evaluation', 'hourglass')} Only the vendor can prove an attempt. Deadline: ${esc(bothTimes(dl))}.</p>`;
      } else {
        const from = Number(BigInt(sub.committed_at_ns) / 1000000n) + Number(BigInt(b.reveal_gap_ns) / 1000000n), until = Number(BigInt(sub.committed_at_ns) / 1000000n) + Number(BigInt(b.reveal_window_ns) / 1000000n);
        const soon = until - now < 10 * 60000;
        line = now < from ? `<p class="small">Reveal opens at ${esc(bothTimes(from))}.</p>`
          : now > until ? `<p class="small">${chip('k-fail', 'Too late to reveal', 'x')} The reveal deadline, ${esc(bothTimes(until))}, has passed. This commit can no longer be revealed and its fee stays with the contract.</p>`
          : `<p class="small">Reveal by ${esc(bothTimes(until))}.${soon ? ' <b>Less than 10 minutes left.</b>' : ''}</p><div><button class="btn btn-p" type="button" data-reveal="${esc(m.fingerprint)}">Reveal attempt #${m.index}</button></div>`;
      }
      mineHtml += `<li class="mine"><p class="body txt"><b>Your attempt #${m.index ?? '?'}</b> <span class="small faint">payout ${esc(m.payout)}</span></p>${line}
        <div><button class="linkbtn" type="button" data-file="${esc(m.fingerprint)}">Download the attempt record</button></div></li>`;
    }
    let body;
    if (closed) {
      body = `<p class="small">${chip('k-refund', 'No new attempts')} This bounty does not take new attempts now.</p>`;
    } else if (slotsLeft === 0) {
      body = `<p class="small">${chip('k-refund', 'All slots in use')} Every attempt slot of this bounty is taken. A slot comes back when an unrevealed commit is released.</p>`;
    } else if (s.status !== 'on') {
      body = s.status === 'wrongnet' ? '<p class="msg bad" role="alert">This wallet account is not on testnet. Attempts are testnet only.</p>'
        : `<div><button class="btn btn-p" type="button" id="connSubmit">${icon('wallet')} Connect to submit</button></div>`;
    } else {
      const fixed = el.dataset.fixed || '';
      body = `<form class="form" id="attForm" novalidate>
        <div class="field"><label for="patch">Your patched module (.wasm, at most ${b.max_patch_bytes} bytes)</label><input id="patch" type="file" accept=".wasm,application/wasm"></div>
        <div class="field"><label for="payout">Payout account</label><input id="payout" autocomplete="off" value="${esc(fixed || s.account)}" ${fixed ? 'readonly' : ''} aria-describedby="payHint">
          <p class="hint" id="payHint">${fixed ? 'Your agent limits fix this payout account.' : 'Paid if your attempt passes. It must exist and cannot be the vendor, a verifier or the contract.'}</p></div>
        <p class="small">Next fee <b class="mono txt">${esc(near(b.next_fee))}</b>, taken from your credit (${credit === null ? 'reading…' : esc(near(credit))}). ${slotsLeft} of ${b.max_commits} slots left.</p>
        <div><button class="btn btn-p" type="submit" ${busy ? 'disabled' : ''}>Review attempt</button></div></form>`;
    }
    el.hidden = closed && !mine.length; // a closed bounty with nothing of yours to follow needs no attempt panel
    if (el.hidden) return;
    el.innerHTML = `<div class="stack g16"><h2 class="h3" id="sendT">Send an attempt</h2>${stepper}
      <p class="small">Commit locks a sealed fingerprint of your fix. Reveal sends the fix itself so it can be tested. Reveal within ${esc(span(b.reveal_window_ns))} of your commit. After you reveal, the vendor has ${esc(span(b.verdict_window_ns))} to prove the result.</p>
      ${msg ? `<div class="msg ${msgKind}" role="${msgKind === 'bad' ? 'alert' : 'status'}">${msg}</div>` : ''}
      ${mine.length ? `<ul>${mineHtml}</ul>` : ''}${body}</div>`;
    const cs = $('#connSubmit', el); if (cs) cs.onclick = () => W.connect();
    el.querySelectorAll('[data-file]').forEach((x) => (x.onclick = () => downloadRecord(mine.find((m) => m.fingerprint === x.dataset.file))));
    el.querySelectorAll('[data-reveal]').forEach((x) => (x.onclick = () => reveal(mine.find((m) => m.fingerprint === x.dataset.reveal))));
    el.querySelectorAll('[data-deposit]').forEach((x) => (x.onclick = () => openCredit('deposit')));
    const f = $('#attForm', el); if (f) f.onsubmit = (e) => { e.preventDefault(); review(); };
  };
  const say = (html, kind = '') => { msg = html; msgKind = kind; };

  async function review() {
    const s = W.state, fileEl = $('#patch', el), payout = $('#payout', el).value.trim();
    const file = fileEl.files && fileEl.files[0];
    const stop = (html) => { say(html, 'bad'); draw(); };
    if (!file) return stop('Choose your patched module (.wasm) first.');
    const patch = new Uint8Array(await file.arrayBuffer());
    if (!patch.length || patch.length > b.max_patch_bytes) return stop(`The patch must be 1 to ${b.max_patch_bytes} bytes; this file is ${patch.length} bytes.`);
    // Read the live state again and refuse here what the contract would refuse.
    const fresh = await view('get_bounty', { bounty_id: String(b.id) }, { fresh: true });
    const lim = await view('get_agent_limits', { account_id: s.account }, { fresh: true });
    await refreshCredit();
    if (fresh.state !== 'Open' || !fresh.opened || nsToDate(commitBy(fresh)).getTime() <= Date.now()) return stop('Bounty closed: it does not take new attempts. Nothing was sent.');
    if (fresh.active >= fresh.max_commits) return stop('Cap full: every attempt slot of this bounty is in use. Nothing was sent.');
    if (fresh.max_commits_per_account) {
      const held = Number(await view('get_account_slots', { bounty_id: String(b.id), account_id: s.account }, { fresh: true }));
      if (held >= fresh.max_commits_per_account) return stop(`Per-account cap: your account already holds ${held} of the ${fresh.max_commits_per_account} slots one account may hold on this bounty. Nothing was sent.`);
    }
    if (credit === null || BigInt(credit) < BigInt(fresh.next_fee)) return stop(`Not enough credit: the fee is ${esc(near(fresh.next_fee))} and your credit is ${esc(near(credit || '0'))}. <button class="linkbtn" type="button" data-deposit>Deposit</button>`);
    if (lim.max_fee_per_commit && BigInt(fresh.next_fee) > BigInt(lim.max_fee_per_commit)) return stop(`Refused before sending: the fee ${esc(near(fresh.next_fee))} is above your own max fee per attempt (${esc(near(lim.max_fee_per_commit))}, set with set_agent_limits). Nothing taken.`);
    if (lim.fixed_payout && lim.fixed_payout !== payout) return stop(`Your agent limits fix the payout account to ${esc(lim.fixed_payout)}.`);
    if (payout === fresh.vendor || payout === CONTRACT || verifiers.includes(payout)) return stop('The payout account cannot be the vendor, a registered verifier or the contract.');
    const pb = await W.balance(payout);
    if (pb === undefined) return stop('Could not check the payout account on testnet. Nothing was sent; try again.');
    if (pb === null) return stop(`The payout account ${esc(payout)} does not exist on testnet. A payout to it would be lost.`);
    const nonce = newNonce(), fp = await fingerprint(patch, payout, nonce), patchHash = hex(await sha256(patch));
    confirmSheet({ fee: fresh.next_fee, left: fresh.max_commits - fresh.active, cap: fresh.max_commits, payout, patchHash }, async () => {
      const recd = { bounty: String(b.id), account: s.account, payout, fingerprint: fp, nonce: hex(nonce), patchB64: b64(patch), patchHash, index: null, revealed: false, contract: CONTRACT };
      const stored = putAttempt(recd);
      busy = true; say('Waiting for the wallet. Approve or reject the commit in the wallet window.'); await draw();
      try {
        const out = W.readOutcome(await W.call('commit', { bounty_id: String(b.id), fingerprint: fp, payout }));
        if (!out.ok) { dropAttempt(recd); say(commitError(out.error) + (out.tx ? ` ${tx(out.tx)}` : ''), 'bad'); }
        else if (out.value === null) { dropAttempt(recd); say(`Cap full: the contract ignored the commit and took nothing. ${tx(out.tx)}`, 'bad'); }
        else {
          let index = typeof out.value === 'number' ? out.value : null;
          if (index === null) { const subsNow = await submissions(await view('get_bounty', { bounty_id: String(b.id) }, { fresh: true })); const hit = subsNow.findIndex((x) => x && x.fingerprint === fp); index = hit >= 0 ? hit : null; }
          recd.index = index; recd.commitTx = out.tx; putAttempt(recd);
          say(`Attempt recorded as #${index}. The fee was taken from your credit. ${tx(out.tx)}${stored ? ' The record is kept in this browser; download it too.' : ' This browser does not keep it: download the record now, you need it to reveal.'}`, 'ok');
          if (!stored) downloadRecord(recd);
        }
      } catch (e) { dropAttempt(recd); say(`Wallet rejected or failed: ${esc(W.plainError(e))} Nothing was taken.`, 'bad'); }
      try { Object.assign(b, await view('get_bounty', { bounty_id: String(b.id) }, { fresh: true })); } catch { /* the counts refresh on reload */ }
      busy = false; await refreshCredit(); await draw();
    });
  }

  async function reveal(m) {
    say('Waiting for the wallet. Approve or reject the reveal in the wallet window.'); await draw();
    try {
      const out = W.readOutcome(await W.call('reveal', { bounty_id: String(b.id), index: m.index, patch: m.patchB64, nonce: m.nonce }));
      if (out.ok) { m.revealed = true; m.revealTx = out.tx; putAttempt(m); say(`Revealed. ${tx(out.tx)} Waiting for the vendor’s proof.`, 'ok'); }
      else say(`The reveal was refused: ${esc(out.error)}.${out.tx ? ` ${tx(out.tx)}` : ''}`, 'bad');
    } catch (e) { say(`Wallet rejected or failed: ${esc(W.plainError(e))}`, 'bad'); }
    await draw();
  }

  W.onChange(draw); onCredit(draw);
  (async () => { if (W.state.status === 'on') { if (credit === null) refreshCredit(); try { const l = await view('get_agent_limits', { account_id: W.state.account }); if (l.fixed_payout) el.dataset.fixed = l.fixed_payout; } catch { /* no limits shown */ } } draw(); })();
}

function commitError(e) {
  if (/not enough credit/.test(e)) return 'Not enough credit: nothing was taken. <button class="linkbtn" type="button" data-deposit>Deposit</button>';
  if (/max_fee_per_commit/.test(e)) return 'Refused: the fee is above your own max fee per attempt. Nothing taken.';
  if (/bounty is closed|has expired|too close to expiry|not open/.test(e)) return 'Bounty closed: it does not take new attempts. Nothing taken.';
  if (/fixed payout/.test(e)) return 'Refused: your agent limits fix another payout account. Nothing taken.';
  return `Refused by the contract: ${esc(e)}. Nothing taken.`;
}

function confirmSheet(info, onYes) {
  const d = $('#confirmDlg');
  d.innerHTML = `<div class="dhead"><h2 class="h3" id="confTitle">Confirm the attempt</h2></div>
    ${facts([['Fee, from your credit', `<span class="mono">${esc(near(info.fee))}</span>`], ['Slots left', `${info.left} of ${info.cap}`], ['Payout account', `<span class="mono">${esc(info.payout)}</span>`], ['Patch sha256', `<span class="mono">${esc(info.patchHash)}</span>`]])}
    <p class="body txt mt16"><b>Each attempt returns one yes or no.</b></p>
    <div class="row mt16"><button class="btn btn-p" type="button" id="confYes">Approve in wallet</button><button class="btn btn-g" type="button" id="confNo">Cancel</button></div>`;
  d.showModal(); $('#confYes', d).focus();
  $('#confNo', d).onclick = () => d.close();
  $('#confYes', d).onclick = () => { d.close(); onYes(); };
}

// ---------- activity and the Account page ----------
const fastPost = async (path, body) => (await fetch(`${TX_INDEX}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const localTime = (ms) => new Date(ms).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// The account's own transactions to this contract, newest first: deposits, withdrawals, commits (with the attempt's
// fee and number, read from the contract), reveals, timeout claims, limit changes and agent keys added for the
// contract. Transaction ids and times come from the FastNEAR transaction index, because the contract's views keep
// neither. Empty if the index does not answer.
async function activity(account, max = 150) {
  const items = [];
  try {
    const list = ((await fastPost('account', { account_id: account })).account_txs || []).filter((t) => t.is_signer)
      .sort((a, b) => (BigInt(b.tx_block_timestamp) > BigInt(a.tx_block_timestamp) ? 1 : -1)).slice(0, max);
    const meta = new Map(list.map((t) => [t.transaction_hash, t]));
    for (let i = 0; i < list.length; i += 20) {
      const res = await fastPost('transactions', { tx_hashes: list.slice(i, i + 20).map((t) => t.transaction_hash) });
      for (const t of res.transactions || []) {
        const x = t.transaction; if (!x) continue;
        const m = meta.get(x.hash), base = { tx: x.hash, ms: Number(BigInt(m.tx_block_timestamp) / 1000000n), ok: m.is_success !== false, key: x.public_key };
        const ak = (x.actions || []).map((a) => a.AddKey).find(Boolean);
        if (ak && x.receiver_id === account) {
          const fc = ak.access_key && ak.access_key.permission && ak.access_key.permission.FunctionCall;
          if (fc && fc.receiver_id === CONTRACT) items.push({ ...base, kind: 'addkey', pub: ak.public_key, methods: fc.method_names });
          continue;
        }
        if (x.receiver_id !== CONTRACT) continue;
        const fc = (x.actions || []).map((a) => a.FunctionCall).find(Boolean); if (!fc) continue;
        let args = {}; try { args = JSON.parse(atob(fc.args)); } catch { /* not JSON */ }
        if (fc.method_name === 'deposit_credit') items.push({ ...base, kind: 'deposit', amount: String(fc.deposit) });
        else if (fc.method_name === 'withdraw_credit') items.push({ ...base, kind: 'withdraw', amount: String(args.amount || '0') });
        else if (fc.method_name === 'commit') items.push({ ...base, kind: 'attempt', bounty: String(args.bounty_id), fingerprint: args.fingerprint });
        else if (fc.method_name === 'reveal') items.push({ ...base, kind: 'reveal', bounty: String(args.bounty_id), index: args.index });
        else if (fc.method_name === 'claim_timeout') items.push({ ...base, kind: 'timeout', bounty: String(args.bounty_id), index: args.index });
        else if (fc.method_name === 'set_agent_limits') items.push({ ...base, kind: 'limits', maxFee: args.max_fee_per_commit, payout: args.fixed_payout });
      }
    }
  } catch { return []; }
  items.sort((a, b) => b.ms - a.ms);
  const bountyIds = [...new Set(items.filter((x) => x.kind === 'attempt').map((x) => x.bounty))];
  for (const id of bountyIds) {
    try {
      const subs = await submissions(await view('get_bounty', { bounty_id: id }));
      items.filter((x) => x.kind === 'attempt' && x.bounty === id).forEach((x) => { const k = subs.findIndex((s) => s && s.fingerprint === x.fingerprint); if (k >= 0) { x.index = k; x.amount = subs[k].fee; } });
    } catch { /* fee unknown */ }
  }
  return items;
}

const whatOf = (x) => x.kind === 'deposit' ? `Deposited ${esc(near(x.amount))} credit`
  : x.kind === 'withdraw' ? `Withdrew ${esc(near(x.amount || '0'))} of credit`
  : x.kind === 'timeout' ? `Claimed the timeout on <a href="#/bounties/${esc(x.bounty)}">bounty ${esc(x.bounty)}</a>${x.index !== undefined ? `, attempt #${esc(x.index)}` : ''}: paid by timeout, not by a proof`
  : x.kind === 'limits' ? `Set agent limits: max fee ${x.maxFee ? esc(near(x.maxFee)) : 'none'}, payout ${x.payout ? esc(x.payout) : 'any'}`
  : x.kind === 'addkey' ? `Added an agent key <span class="mono">${esc(x.pub.slice(0, 18))}…</span> for ${esc((x.methods || []).join(' and ') || 'every method')} on the contract`
  : `${x.kind === 'reveal' ? 'Revealed' : 'Committed'} attempt${x.index !== undefined ? ` #${esc(x.index)}` : ''} on <a href="#/bounties/${esc(x.bounty)}">bounty ${esc(x.bounty)}</a>${x.kind === 'attempt' && x.amount !== undefined ? ` · fee ${esc(near(x.amount))}` : ''}`;

async function drawRecent(account) {
  const el = document.getElementById('recent'); if (!el) return;
  const items = (await activity(account, 60)).filter((x) => x.kind === 'deposit' || x.kind === 'withdraw' || x.kind === 'attempt').slice(0, 8);
  if (!document.getElementById('recent')) return;
  el.innerHTML = items.length ? table(['What', 'Time', 'Transaction'], items.map((x) => [`${whatOf(x)}${x.ok ? '' : ' ' + BAD('Failed')}`, esc(localTime(x.ms)), tx(x.tx)]), '') : '<p class="small">No activity yet.</p>';
}

// The Account page of one account: balances, its agent keys on this contract (scope, gas allowance, spend cap,
// spent), an audit log with transaction links and, for the connected owner only, the agent setup: the limits form,
// the stop button, "Create an agent key" and the test mode note. Everything shown is read from testnet.
let pendingKey = null; // the agent key made on this page, kept in memory only until the visitor leaves the page
export async function accountPage(viewEl, name) {
  pendingKey = null;
  if (!name) {
    if (W.state.status === 'on') { location.replace(`#/account/${encodeURIComponent(W.state.account)}`); return; }
    viewEl.innerHTML = `<main id="main" class="p-gen" tabindex="-1"><section class="ph"><div class="wrap ph-grid"><div class="stack g24" style="max-width:640px"><p class="eyebrow">Account</p><h1>Account and agent setup</h1>
      <p class="lead">Balances, agent keys, spend limits and an audit log of one account, read from testnet. Connect a wallet to open your own and set up an agent, or enter any account to read it.</p></div>
      <div class="card pad24 stack g16"><div><button class="btn btn-p" type="button" id="acConn">${icon('wallet')} Connect wallet</button></div>
      <form class="form" id="agForm" novalidate><div class="field"><label for="agAcc">Or read any account</label>
      <input id="agAcc" autocomplete="off" placeholder="name.testnet" aria-describedby="agErr"><p id="agErr" class="ferr" role="alert" hidden></p></div>
      <div><button class="btn btn-g" type="submit">Show account</button></div></form></div></div></section></main>`;
    $('#acConn').onclick = () => W.connect();
    const off = W.onChange(() => { if (W.state.status === 'on' && /^#\/account\/?$/.test(location.hash)) { off(); location.replace(`#/account/${encodeURIComponent(W.state.account)}`); } });
    $('#agForm').onsubmit = (e) => {
      e.preventDefault(); const a = $('#agAcc').value.trim(), err = $('#agErr');
      if (!/^[a-z0-9._-]{2,64}$/.test(a)) { err.textContent = 'Enter a NEAR account name, for example name.testnet.'; err.hidden = false; $('#agAcc').setAttribute('aria-invalid', 'true'); $('#agAcc').focus(); return; }
      location.hash = `#/account/${encodeURIComponent(a)}`;
    };
    return;
  }
  viewEl.innerHTML = `<main id="main" class="p-gen" tabindex="-1"><section class="ph"><div class="wrap stack g16"><p class="eyebrow">Account</p><h1 style="font-size:clamp(26px,3.4cqw,48px)">${esc(name)}</h1>
    <p class="lead">Read from NEAR testnet${W.state.status === 'on' && W.state.account === name ? '. This is your connected account' : ''}.</p></div></section>
    <section class="pbody"><div class="wrap" id="acOut"><p class="state">Reading from testnet…</p></div></section></main>`;
  await drawAccount(name);
  const off = W.onChange(() => { if (!document.getElementById('acOut')) { off(); return; } drawAccount(name); });
}

async function drawAccount(name) {
  const out = $('#acOut'); if (!out) return;
  try {
    const [c, lim, bs, act, keys, bal] = await Promise.all([view('get_credit', { account_id: name }, { fresh: true }), view('get_agent_limits', { account_id: name }, { fresh: true }),
      allBounties(), activity(name), accessKeys(name).catch(() => null), W.balance(name)]);
    if (!$('#acOut')) return;
    const txOf = new Map(act.filter((x) => x.kind === 'attempt').map((x) => [`${x.bounty}:${x.fingerprint}`, x.tx]));
    const mine = [], created = [];
    for (const b of bs.filter(Boolean)) {
      if (b.vendor === name) created.push(b);
      (await submissions(b)).forEach((s, i) => { if (s && s.committer === name) mine.push({ b, s, i }); });
    }
    mine.sort((x, y) => Number(BigInt(y.s.committed_at_ns) - BigInt(x.s.committed_at_ns)));
    // Fees not paid back: a passed attempt and an attempt paid by timeout get their own fee back.
    const spent = mine.filter(({ s }) => s.outcome !== 'Passed' && s.outcome !== 'TimedOut').reduce((t, { s }) => t + BigInt(s.fee || '0'), 0n);
    const stateText = (b, s) => ({ Passed: 'Passed, paid', Failed: 'Failed by a proof', TimedOut: 'Paid by timeout', Released: 'Slot released' }[s.outcome]
      || (s.revealed_at_ns ? (b.state === 'Open' ? 'Awaiting the vendor’s proof' : 'Undecided') : 'Committed, not revealed'));
    const stopped = lim.max_fee_per_commit === '0';
    const agentKeys = (keys || []).filter((k) => k.access_key.permission.FunctionCall && k.access_key.permission.FunctionCall.receiver_id === CONTRACT);
    const agentSet = new Set(agentKeys.map((k) => k.public_key));
    const fullKeys = (keys || []).filter((k) => k.access_key.permission === 'FullAccess').length;
    const scope = (m) => { const set = new Set(m || []); return m && m.length && [...set].every((x) => x === 'commit' || x === 'reveal')
      ? 'commit and reveal on the contract<span class="small">cannot withdraw or change limits</span>' : m && m.length ? esc([...set].join(', ')) : 'every method of the contract that takes no deposit'; };
    const me = W.state.status === 'on' && W.state.account === name;
    const history = [...mine.map(({ b, s, i }) => ({ ms: Number(BigInt(s.committed_at_ns) / 1000000n),
        row: [`<a href="#/bounties/${esc(b.id)}">Bounty ${esc(b.id)}</a> · #${i}`, `${esc(stateText(b, s))}<span class="small">${s.fee === '0' ? 'fee refunded' : `fee ${esc(near(s.fee))}`}</span>`,
          tx(txOf.get(`${b.id}:${s.fingerprint}`) || null)] })),
      ...act.filter((x) => x.kind === 'deposit' || x.kind === 'withdraw').map((x) => ({ ms: x.ms,
        row: [x.kind === 'deposit' ? 'Deposit' : 'Withdrawal', x.ok ? `Credit <span class="mono">${esc(near(x.amount))}</span>` : BAD('Failed'), tx(x.tx)] }))]
      .sort((p, q) => q.ms - p.ms).slice(0, 12);
    out.innerHTML = `
      <div class="stat4 acc-out">
        <div><b class="num">${esc(near(String(c)).replace(' NEAR', ''))}<small>NEAR</small></b><span>Contract credit</span></div>
        <div><b class="num">${bal === null || bal === undefined ? '–' : esc(near(bal).replace(' NEAR', '').replace(/(\.\d{3})\d+/, '$1'))}<small>NEAR</small></b><span>Wallet balance${bal === null ? ': the account does not exist' : ''}</span></div>
        <div><b class="num">${mine.length}</b><span>Attempts committed</span></div>
        <div><b class="num">${agentKeys.length}</b><span>Agent ${agentKeys.length === 1 ? 'key' : 'keys'} on this contract</span></div></div>
      ${me ? setupHtml(name, lim, stopped, agentKeys.length) : `<div class="mt32">${note(W.state.status === 'on' ? `You are connected as ${esc(W.state.account)}. Only the owner of ${esc(name)} can set its agent limits or add its keys.` : 'Connect this account’s wallet to set agent limits, stop its agents or add an agent key.', 'info')}</div>`}
      <h2 class="h2s mt48">Agent keys</h2>
      <div class="mt16">${keys === null ? '<p class="small">Could not read the account’s access keys.</p>'
        : agentKeys.length ? table(['Agent key', 'Scope', 'Spend cap', 'Spent', 'Status'], agentKeys.map((k) => {
          const fc = k.access_key.permission.FunctionCall;
          return [`<span class="hsh"><code title="${esc(k.public_key)}">${esc(k.public_key.slice(0, 20))}…</code><button class="mini" type="button" data-copy-text="${esc(k.public_key)}">Copy</button></span><span class="small">function call key</span>`,
            `${scope(fc.method_names)}<span class="small">gas allowance left ${fc.allowance ? esc(near(fc.allowance)) : 'not limited'}</span>`,
            `<span class="mono nw">${lim.max_fee_per_commit ? esc(near(lim.max_fee_per_commit)) : 'none set'}</span><span class="small">per attempt</span>`,
            `<span class="mono nw">${esc(near(spent.toString()))}</span>`, stopped ? BAD('Stopped') : chip('k-open', 'Active')];
        }), 'wide') : '<p class="small">No key of this account is limited to this contract.</p>'}
      <p class="small mt12">${keys === null ? '' : `Spend cap: the most one attempt may cost (set_agent_limits). Spent: attempt fees not paid back. ${fullKeys} full access ${fullKeys === 1 ? 'key' : 'keys'} (the owner’s wallet keys) not listed.`}${lim.fixed_payout ? ` Fixed payout: ${acct(lim.fixed_payout)}.` : ''}${stopped ? ' Stopped: the max fee per attempt is 0, so every commit by this account is refused.' : ''}</p></div>
      <h2 class="h2s mt48">History</h2>
      <div class="mt16">${history.length ? table(['What', 'State', 'Transaction'], history.map((h) => h.row)) : '<p class="small">No attempts or deposits yet.</p>'}</div>
      <h2 class="h2s mt48">Audit log</h2>
      <div class="mt16">${act.length ? table(['Signed by', 'What', 'Transaction', 'When'], act.map((x) => {
          const agent = agentSet.has(x.key);
          return [chip(agent ? 'k-test' : 'k-refund', agent ? 'Agent key' : 'Operator'), `${whatOf(x)}${x.ok ? '' : ' ' + BAD('Failed')}`, tx(x.tx), `<span class="small">${esc(localTime(x.ms))}</span>`];
        }), 'wide') + '<p class="small mt12">Every call this account signed to the contract, from the FastNEAR transaction index. Agent key: signed by a key limited to this contract; operator: signed by another key of the account.</p>'
        : '<p class="small">No calls to the contract yet.</p>'}</div>
      ${created.length ? `<h2 class="h2s mt48">Bounties created</h2><div class="mt16">${table(['Bounty', 'State', 'Reward', 'Created'], created.slice().reverse().map((b) => [`<a href="#/bounties/${esc(b.id)}">Bounty ${esc(b.id)}</a>`, esc(b.state), `<span class="mono nw">${esc(near(b.amount))}</span>`, `<span class="mono">${esc(utc(b.created_at_ns))}</span>`]))}</div>` : ''}
      <p class="mt24"><a class="lnk sm" href="${EXPLORER_ACCOUNT}${encodeURIComponent(name)}" rel="noopener" target="_blank">All transactions of this account on the explorer ${icon('ext')}</a></p>`;
    if (me) bindSetup(name, lim);
  } catch (e) { out.innerHTML = note(`Could not read: ${esc(e.message)}`, 'alert'); }
}

// ---------- agent setup (connected owner only) ----------
const CLI = (account, pub, allowance) => `near account add-key ${account} grant-function-call-access --allowance '${allowance} NEAR' --contract-account-id ${CONTRACT} --function-names 'commit, reveal' use-manually-provided-public-key ${pub} network-config testnet sign-with-legacy-keychain send`;

function setupHtml(name, lim, stopped, nKeys) {
  const k = pendingKey;
  return `<h2 class="h2s mt48">Agent setup</h2>
  <p class="body mt12" style="max-width:720px">Three steps for an agent that may spend your credit but never withdraw it: limits, a key limited to commit and reveal, and a dry run. Testnet only.</p>
  <div class="mt24" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:24px">
  <div class="card pad28 stack g16">
    <p class="eyebrow" style="color:var(--tx3)">1. Limits</p><h3 class="h3">Max fee and payout account</h3>
    ${facts([['Max fee per attempt now', lim.max_fee_per_commit ? `<span class="mono">${esc(near(lim.max_fee_per_commit))}</span>${stopped ? ' (stopped)' : ''}` : 'none set'], ['Fixed payout now', lim.fixed_payout ? `<span class="mono">${esc(lim.fixed_payout)}</span>` : 'any account']])}
    <form class="form" id="limForm" novalidate>
      <div class="field"><label for="limFee">Max fee per attempt (NEAR)</label><input id="limFee" inputmode="decimal" autocomplete="off" value="${lim.max_fee_per_commit && !stopped ? esc(near(lim.max_fee_per_commit).replace(' NEAR', '')) : '0.02'}" aria-describedby="limHint limErr"></div>
      <div class="field"><label for="limPay">Fixed payout account</label><input id="limPay" autocomplete="off" value="${esc(lim.fixed_payout || name)}" aria-describedby="limHint limErr">
        <p class="hint" id="limHint">set_agent_limits, with 1 yoctoNEAR attached, so only your wallet can call it, never an agent key. A commit by this account above the fee, or naming another payout, is refused by the contract.</p>
        <p class="ferr" id="limErr" role="alert" hidden></p></div>
      <div class="row"><button class="btn btn-p" type="submit">Save limits in wallet</button>${!stopped && nKeys ? `<button class="btn btn-g" type="button" id="stopBtn">${icon('stop')} Stop ${nKeys > 1 ? 'agents' : 'agent'}</button>` : ''}</div>
    </form>
    <div id="limBox"></div>
  </div>
  <div class="card pad28 stack g16">
    <p class="eyebrow" style="color:var(--tx3)">2. Agent key</p><h3 class="h3">Create an agent key</h3>
    <p class="small">The key pair is made in this browser. The private key is shown once, never sent anywhere and never stored by this site. Your wallet then adds the public key as a key that may call only commit and reveal on ${esc(CONTRACT)}, with a small gas allowance.</p>
    ${k ? `<div class="keybox" role="region" aria-label="Your new agent key">
      ${note('<b>Save this private key now.</b> It is shown only once and this site does not keep it. Anyone holding it can commit and reveal as this account, spending its credit up to your limits. It cannot withdraw.', 'alert')}
      <div><p class="small faint">Public key</p><code>${esc(k.publicKey)}</code></div>
      <div><p class="small faint">Private key</p><code id="privKey">${esc(k.privateKey)}</code></div>
      <div class="row"><button class="btn btn-g btn-s" type="button" id="keyFile">${icon('download')} Download as a key file</button><button class="mini" type="button" data-copy-text="${esc(k.privateKey)}">Copy private key</button></div>
      ${k.added ? `<div class="msg ok" role="status">${OK('Added')} This key may call only commit and reveal on ${esc(CONTRACT)}. ${tx(k.added)}</div><div class="row"><button class="btn btn-g btn-s" type="button" id="keyForget">I saved it, hide the key</button></div>`
      : `<div class="field"><label for="keyAllow">Gas allowance for this key (NEAR)</label><input id="keyAllow" inputmode="decimal" value="0.25" aria-describedby="allowHint"><p class="hint" id="allowHint">The most this key may spend on gas. Attempt fees come from credit, not from this allowance.</p></div>
      <div class="row"><button class="btn btn-p" type="button" id="keyAdd">Add this key with my wallet</button><button class="btn btn-g btn-s" type="button" id="keyForget">Forget this key</button></div>`}
      <div id="keyBox"></div></div>`
    : `<div class="row"><button class="btn btn-p" type="button" id="keyNew">${icon('key')} Create an agent key</button></div>`}
    <p class="small faint">Wallets tested for adding a key from this page: NEAR CLI (docs/EVIDENCE.md, "Agent setup from the site"). Other wallets were not tried; if one refuses, the exact CLI command is shown here instead.</p>
  </div>
  </div>
  <div class="card pad28 stack g16 mt24">
    <p class="eyebrow" style="color:var(--tx3)">3. Test mode</p><h3 class="h3">Dry run first</h3>
    <p class="small">Save the key file as the agent's limited_key_file, set account and payout in a copy of agent/config.toml, then run the reference agent. Dry run is the default: it reads the feed, writes a fix, runs the public tests and sends nothing.</p>
    ${cmd('python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml')}
    <p class="small">Add <span class="mono txt">--live --bounty &lt;id&gt;</span> only when you mean to spend a real testnet attempt fee from credit.</p>
  </div>`;
}

function bindSetup(name, lim) {
  const limBox = $('#limBox');
  const say = (box, cls, html) => { box.innerHTML = `<div class="msg ${cls}" role="${cls === 'bad' ? 'alert' : 'status'}">${html}</div>`; };
  const send = async (box, args, done) => {
    say(box, '', 'Waiting for the wallet. Approve or reject the request in the wallet window.');
    try {
      const o = W.readOutcome(await W.call('set_agent_limits', args, '1', 30));
      if (o.ok) { say(box, 'ok', `${done} ${tx(o.tx)}`); setTimeout(() => drawAccount(name), 2500); }
      else say(box, 'bad', `Not saved: ${esc(o.error)} ${o.tx ? tx(o.tx) : ''}`);
    } catch (e) { say(box, 'bad', `Not saved: ${esc(W.plainError(e))}`); }
  };
  $('#limForm').onsubmit = async (e) => {
    e.preventDefault();
    const fee = toYocto($('#limFee').value), pay = $('#limPay').value.trim(), err = $('#limErr');
    let m = '';
    if (!fee) m = 'Enter a max fee above zero, for example 0.02. To stop the agent, use Stop.';
    else if (!/^[a-z0-9._-]{2,64}$/.test(pay)) m = 'Enter a NEAR account name for the payout, for example name.testnet.';
    else { const b = await W.balance(pay); if (b === null) m = `The account ${pay} does not exist on testnet. A payout to it would be lost.`; }
    if (m) { err.textContent = m; err.hidden = false; return; }
    err.hidden = true;
    await send(limBox, { max_fee_per_commit: fee, fixed_payout: pay }, `Saved: max fee ${esc(near(fee))} per attempt, payout ${esc(pay)}.`);
  };
  const stop = $('#stopBtn');
  if (stop) stop.onclick = () => send(limBox, { max_fee_per_commit: '0', fixed_payout: lim.fixed_payout || null }, 'Stopped. The max fee per attempt is now 0, so every commit by this account is refused, whichever key signs it. Reveals of attempts already made still work.');
  const nk = $('#keyNew');
  if (nk) nk.onclick = async () => {
    try { pendingKey = await newAgentKey(); } catch { pendingKey = null; toast('This browser cannot make an Ed25519 key. Use the CLI command on the For agents page.'); return; }
    await drawAccount(name); const p = $('#privKey'); if (p) p.scrollIntoView({ block: 'center' });
  };
  const kf = $('#keyFile');
  if (kf) kf.onclick = () => {
    const blob = new Blob([JSON.stringify({ account_id: name, public_key: pendingKey.publicKey, private_key: pendingKey.privateKey }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}.agent-key.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const fg = $('#keyForget'); if (fg) fg.onclick = () => { pendingKey = null; drawAccount(name); };
  const ka = $('#keyAdd');
  if (ka) ka.onclick = async () => {
    const box = $('#keyBox'), allowText = $('#keyAllow').value.trim(), allow = toYocto(allowText);
    if (!allow) { say(box, 'bad', 'Enter a gas allowance above zero, for example 0.25.'); return; }
    say(box, '', 'Waiting for the wallet. Approve or reject the AddKey request in the wallet window.');
    const fallback = `<p class="small mt12">If your wallet cannot add the key, run this in a terminal with the NEAR CLI (near-cli-rs), signed with your full key:</p>${cmd(CLI(name, pendingKey.publicKey, allowText))}`;
    try {
      const o = W.readOutcome(await W.addKey(pendingKey.publicKey, allow));
      if (o.ok) { pendingKey.added = o.tx; say(box, 'ok', `The key was added: it may call only commit and reveal on ${esc(CONTRACT)}. ${tx(o.tx)}`); setTimeout(() => drawAccount(name), 3000); }
      else box.innerHTML = `<div class="msg bad" role="alert">The wallet sent the request but it failed: ${esc(o.error)} ${o.tx ? tx(o.tx) : ''}</div>${fallback}`;
    } catch (e) { box.innerHTML = `<div class="msg bad" role="alert">The wallet did not add the key: ${esc(W.plainError(e))}</div>${fallback}`; }
  };
}
