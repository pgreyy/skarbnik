// The parts of the site that use a wallet (testnet only): the header wallet control with the credit chip, the credit
// panel (deposit_credit, withdraw_credit), the attempt panel on a bounty page (commit, reveal, then waiting for the
// vendor's proof), and the read only agent page. Every payment goes through a confirm step and then the wallet; the
// page shows only what the chain says. Attempt fees are taken from credit deposited in the contract first.
import { CONTRACT, view, near, utc, commitBy, nsToDate, allBounties, submissions } from './chain.js';
import * as W from './wallet.js';
import { fingerprint, newNonce, hex, b64, sha256, putAttempt, attemptsFor, dropAttempt, downloadRecord, toYocto } from './attempt.js';
import { $, esc, badge, tx, acct, toast, passStamp } from './ui.js';

let credit = null; // the connected account's contract credit, yoctoNEAR string
const short = (a) => (a.length > 22 ? `${a.slice(0, 12)}…${a.slice(-8)}` : a);
const creditListeners = new Set();
export const onCredit = (f) => { creditListeners.add(f); return () => creditListeners.delete(f); };

async function refreshCredit() {
  if (W.state.status !== 'on') { credit = null; } else {
    try { credit = String(await view('get_credit', { account_id: W.state.account }, { fresh: true })); } catch { credit = null; }
  }
  renderWallet(); creditListeners.forEach((f) => f(credit));
}

// ---------- header control ----------
function renderWallet() {
  const el = $('#walletArea'); if (!el) return;
  const s = W.state;
  if (s.status === 'on') {
    el.innerHTML = `<button class="k-chip" type="button" id="creditChip" aria-haspopup="dialog">Credit <b>${credit === null ? '…' : esc(near(credit))}</b></button>
      <div class="k-acct"><button class="m-btn sec sm" type="button" id="acctBtn" aria-haspopup="true" aria-expanded="false" aria-controls="acctMenu" title="${esc(s.account)}">${esc(short(s.account))}</button>
      <ul class="k-menu" id="acctMenu" hidden>
        <li><button type="button" data-act="copy">Copy account name</button></li>
        <li><button type="button" data-act="credit">View credit</button></li>
        <li><button type="button" data-act="out">Disconnect</button></li></ul></div>`;
    $('#creditChip').onclick = () => openCredit();
    const btn = $('#acctBtn'), menu = $('#acctMenu');
    const show = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', open); if (open) menu.querySelector('button').focus(); };
    btn.onclick = () => show(menu.hidden);
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { show(false); btn.focus(); } });
    menu.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
      show(false);
      if (b.dataset.act === 'copy') { try { await navigator.clipboard.writeText(s.account); toast('Account name copied.'); } catch { toast('Copy was blocked. Select the name instead.'); } }
      if (b.dataset.act === 'credit') openCredit();
      if (b.dataset.act === 'out') { await W.disconnect(); toast('Disconnected.'); }
    }));
  } else if (s.status === 'connecting') {
    el.innerHTML = '<button class="m-btn sm" type="button" disabled aria-busy="true">Connecting…</button>';
  } else if (s.status === 'wrongnet') {
    el.innerHTML = `<span class="m-badge b-bad" role="alert">✕ Not a testnet account</span><button class="m-btn sec sm" type="button" id="outBtn">Disconnect</button>`;
    $('#outBtn').onclick = () => W.disconnect();
  } else if (s.status === 'failed') {
    el.innerHTML = `<span class="k-werr" role="alert">${esc(s.error || 'The wallet did not connect.')}</span><button class="m-btn sm" type="button" id="connBtn">Try again</button>`;
    $('#connBtn').onclick = () => W.connect();
  } else {
    el.innerHTML = '<button class="m-btn sm" type="button" id="connBtn">Connect wallet</button>';
    $('#connBtn').onclick = () => W.connect();
  }
}

export async function initAccountUi() {
  renderWallet();
  W.onChange(() => { renderWallet(); refreshCredit(); });
  await W.init();
  document.addEventListener('click', (e) => { const m = $('#acctMenu'); if (m && !m.hidden && !e.target.closest('.k-acct')) { m.hidden = true; $('#acctBtn').setAttribute('aria-expanded', 'false'); } });
}

// ---------- credit panel ----------
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
  const head = '<div class="m-crow"><h2 class="m-h2" id="creditTitle">Credit</h2><button class="m-btn sec sm" type="button" data-close>Close</button></div><p class="m-note">Testnet, test NEAR, no real money.</p>';
  if (s.status !== 'on') {
    d.innerHTML = `${head}<p>${s.status === 'wrongnet' ? 'This account is not a testnet account. Switch to a testnet account in your wallet.' : 'Connect a testnet wallet to see and use your credit.'}</p>
      ${s.status === 'wrongnet' ? '' : '<button class="m-btn" type="button" id="dlgConn">Connect wallet</button>'}`;
    bindCommon(d); const c = $('#dlgConn', d); if (c) c.onclick = () => W.connect(); return;
  }
  const bal = await W.balance(s.account);
  const c = credit === null ? null : BigInt(credit);
  const v = creditView;
  let body = '';
  if (v.phase === 'form' && !v.mode) {
    body = c === 0n ? '<p class="k-state">No credit yet.</p><div class="m-cta"><button class="m-btn" type="button" data-mode="deposit">Deposit</button></div>'
      : '<div class="m-cta"><button class="m-btn" type="button" data-mode="deposit">Deposit</button><button class="m-btn sec" type="button" data-mode="withdraw">Withdraw</button></div>';
  } else if (v.phase === 'form') {
    const dep = v.mode === 'deposit';
    body = `<form class="m-form" id="credForm" novalidate>
      <div class="m-field"><label for="amt">${dep ? 'Amount to deposit' : 'Amount to withdraw'} (NEAR)</label>
        <input id="amt" name="amt" inputmode="decimal" autocomplete="off" value="${esc(v.amount)}" aria-describedby="amtErr amtHint" ${v.msg ? 'aria-invalid="true"' : ''}>
        <p class="m-hint" id="amtHint">${dep ? 'Your wallet sends this NEAR to the contract, where it becomes credit for attempt fees.' : 'Withdraw needs a wallet approval, an agent key cannot do it.'}</p>
        ${v.msg ? `<p class="m-err" id="amtErr" role="alert">${esc(v.msg)}</p>` : '<p id="amtErr" hidden></p>'}</div>
      <div class="m-cta"><button class="m-btn" type="submit">Review ${dep ? 'deposit' : 'withdrawal'}</button><button class="m-btn sec" type="button" data-mode="">Back</button></div></form>`;
  } else if (v.phase === 'confirm') {
    const dep = v.mode === 'deposit';
    body = `<div class="k-confirm"><p>${dep ? `Deposit <b class="k-mono">${esc(near(v.yocto))}</b> from ${esc(s.account)} as credit in ${esc(CONTRACT)}.` : `Withdraw <b class="k-mono">${esc(near(v.yocto))}</b> of credit to ${esc(s.account)}. The wallet attaches 1 yoctoNEAR, which only a wallet approval can do.`}</p>
      <div class="m-cta"><button class="m-btn" type="button" id="doIt">Confirm in wallet</button><button class="m-btn sec" type="button" data-mode="${v.mode}">Change amount</button></div></div>`;
  } else if (v.phase === 'wait') {
    body = '<p class="k-state" role="status" aria-busy="true">Waiting for the wallet. Approve or reject the request in the wallet window.</p>';
  } else if (v.phase === 'done') {
    body = `<p role="status">${badge('ok', '✓ Done')} ${esc(v.msg)}</p>${v.tx ? `<p class="m-sub">Transaction ${tx(v.tx)}</p>` : ''}<div class="m-cta"><button class="m-btn sec" type="button" data-mode="">Back to credit</button></div>`;
  } else if (v.phase === 'failed') {
    body = `<p role="alert">${badge('bad', '✕ Not done')} ${esc(v.msg)}</p>${v.tx ? `<p class="m-sub">Transaction ${tx(v.tx)}</p>` : ''}<div class="m-cta"><button class="m-btn" type="button" data-mode="${v.mode}">Try again</button><button class="m-btn sec" type="button" data-mode="">Back</button></div>`;
  }
  d.innerHTML = `${head}
    <dl class="m-facts"><div><dt>Contract credit</dt><dd class="k-mono">${c === null ? 'could not read' : esc(near(credit))}</dd></div>
    <div><dt>Wallet balance</dt><dd class="k-mono">${bal === null || bal === undefined ? 'could not read' : esc(near(bal))}</dd></div></dl>
    <p class="m-sub">Account ${esc(s.account)}. Attempt fees are taken from this credit.</p>${body}`;
  bindCommon(d);
  d.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { creditView = { mode: b.dataset.mode || null, phase: 'form', amount: '', msg: '' }; drawCredit().then(() => { const i = $('#amt', d); if (i) i.focus(); }); }));
  const f = $('#credForm', d);
  if (f) f.onsubmit = (e) => {
    e.preventDefault();
    const raw = $('#amt', d).value, y = toYocto(raw);
    let msg = '';
    if (!y) msg = 'Enter an amount above zero, for example 0.1.';
    else if (v.mode === 'withdraw' && (c === null || BigInt(y) > c)) msg = `You can withdraw at most ${near(credit || '0')}.`;
    else if (v.mode === 'deposit' && bal && BigInt(y) >= BigInt(bal)) msg = 'That is more than the wallet holds (it also needs a little for gas).';
    if (msg) { creditView = { ...v, amount: raw, msg }; drawCredit().then(() => $('#amt', d).focus()); return; }
    creditView = { ...v, phase: 'confirm', yocto: y, amount: raw, msg: '' }; drawCredit().then(() => $('#doIt', d).focus());
  };
  const go = $('#doIt', d);
  if (go) go.onclick = async () => {
    const dep = v.mode === 'deposit';
    creditView = { ...v, phase: 'wait' }; await drawCredit();
    try {
      const out = W.readOutcome(dep ? await W.call('deposit_credit', { account_id: null }, v.yocto, 30) : await W.call('withdraw_credit', { amount: v.yocto }, '1', 30));
      await refreshCredit();
      creditView = out.ok ? { ...v, phase: 'done', tx: out.tx, msg: `${dep ? 'Deposited' : 'Withdrawn'} ${near(v.yocto)}. Credit is now ${credit === null ? 'unknown' : near(credit)}.` }
        : { ...v, phase: 'failed', tx: out.tx, msg: out.error };
    } catch (e) { creditView = { ...v, phase: 'failed', msg: W.plainError(e) }; }
    await drawCredit();
  };
}

function bindCommon(d) { d.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => d.close())); }

// ---------- attempt panel (bounty page) ----------
const OUTCOME = { Passed: ['ok', '✓ PASS'], Failed: ['bad', '✕ FAIL'], TimedOut: ['info', 'Paid by timeout'], Released: ['info', 'Not revealed in time, slot released'] };

export function attemptPanel(el, b, subs, verifiers) {
  let busy = false, msg = '', msgKind = 'info';
  const draw = async () => {
    if (!el.isConnected) return; // the visitor left this bounty page
    const s = W.state, now = Date.now();
    const closed = b.state !== 'Open' || !b.opened || nsToDate(commitBy(b)).getTime() <= now;
    const slotsLeft = Math.max(0, b.max_commits - b.active);
    const mine = s.status === 'on' ? attemptsFor(s.account, b.id) : [];
    const step = mine.some((m) => m.index !== null && m.revealed) ? 3 : mine.some((m) => m.index !== null) ? 2 : 1;
    const stepper = `<ol class="m-sstep" aria-label="Steps of an attempt">${['Commit', 'Reveal', 'Wait for the vendor’s proof'].map((t, i) =>
      `<li class="${i + 1 === step ? 'now' : i + 1 < step ? 'past' : ''}"${i + 1 === step ? ' aria-current="step"' : ''}><span class="m-n">${i + 1 < step ? '✓' : i + 1}</span>${t}</li>`).join('')}</ol>`;
    let mineHtml = '';
    for (const m of mine) {
      let sub = null; if (m.index !== null) { try { sub = await view('get_submission', { bounty_id: String(b.id), index: m.index }, { fresh: true }); } catch { /* shown below */ } }
      let line;
      if (m.index === null) line = '<p>Commit sent, result not known yet. Reload the page; the record is kept.</p>';
      else if (!sub) line = '<p>Could not read this attempt from the chain.</p>';
      else if (OUTCOME[sub.outcome]) line = `<p>${sub.outcome === 'Passed' ? passStamp() : ''} ${badge(...OUTCOME[sub.outcome])} The chain says this attempt is final.</p>`;
      else if (sub.revealed_at_ns) line = `<p>${badge('wait', '… Waiting')} Waiting for the vendor’s proof. Only the vendor can prove an attempt; the deadline for a verdict is ${esc(utc(sub.deadline_ns))}. After it, anyone can claim the timeout.</p>`;
      else {
        const from = Number(BigInt(sub.committed_at_ns) / 1000000n) + Number(BigInt(b.reveal_gap_ns) / 1000000n), until = Number(BigInt(sub.committed_at_ns) / 1000000n) + Number(BigInt(b.reveal_window_ns) / 1000000n);
        line = now < from ? `<p>Reveal opens at ${esc(new Date(from).toISOString().slice(11, 19))} UTC.</p>`
          : now > until ? `<p>${badge('bad', '✕ Reveal window closed')} This commit was not revealed in time. Its fee stays with the contract.</p>`
          : `<p>Committed. Reveal before ${esc(new Date(until).toISOString().slice(0, 16).replace('T', ' '))} UTC.</p><button class="m-btn" type="button" data-reveal="${esc(m.fingerprint)}">Reveal attempt #${m.index}</button>`;
      }
      mineHtml += `<li class="k-mine"><p><b>Attempt #${m.index ?? '?'}</b> <span class="k-src">payout ${esc(m.payout)} · patch sha256 ${esc(m.patchHash.slice(0, 16))}…</span></p>${line}
        <button class="m-link" type="button" data-file="${esc(m.fingerprint)}">Download the attempt record</button></li>`;
    }
    let body;
    if (closed) {
      body = `<p>${badge('info', 'No new attempts')} This bounty does not take new attempts now.</p>`;
    } else if (s.status !== 'on') {
      body = s.status === 'wrongnet' ? '<p role="alert">This wallet account is not on testnet. Attempts are testnet only.</p>'
        : '<p>You can read everything without a wallet. To send an attempt, connect a testnet wallet.</p><button class="m-btn" type="button" id="connSubmit">Connect to submit</button>';
    } else {
      const fixed = el.dataset.fixed || '';
      body = `<form class="m-form" id="attForm" novalidate>
        <div class="m-field"><label for="patch">Your patched module (.wasm, at most ${b.max_patch_bytes} bytes)</label><input id="patch" type="file" accept=".wasm,application/wasm"></div>
        <div class="m-field"><label for="payout">Payout account</label><input id="payout" autocomplete="off" value="${esc(fixed || s.account)}" ${fixed ? 'readonly' : ''} aria-describedby="payHint">
          <p class="m-hint" id="payHint">${fixed ? 'Your agent limits fix this payout account.' : 'Paid if your attempt passes. It must exist and cannot be the vendor, a verifier or the contract.'}</p></div>
        <p class="m-sub">Next fee <b class="k-mono">${esc(near(b.next_fee))}</b>, taken from your credit (${credit === null ? 'reading…' : esc(near(credit))}). ${slotsLeft} of ${b.max_commits} slots left.</p>
        <button class="m-btn" type="submit" ${busy ? 'disabled' : ''}>Review attempt</button></form>`;
    }
    el.innerHTML = `<h2 class="m-h2" id="sendT">Send an attempt</h2>${stepper}
      ${msg ? `<div class="k-msg ${msgKind}" role="${msgKind === 'bad' ? 'alert' : 'status'}">${msg}</div>` : ''}
      ${mine.length ? `<ul class="k-mines">${mineHtml}</ul>` : ''}${body}
      <p class="m-note">Each attempt returns one yes or no. Attempt fees are taken from credit you deposit in the contract first.</p>`;
    const cs = $('#connSubmit', el); if (cs) cs.onclick = () => W.connect();
    el.querySelectorAll('[data-file]').forEach((x) => (x.onclick = () => downloadRecord(mine.find((m) => m.fingerprint === x.dataset.file))));
    el.querySelectorAll('[data-reveal]').forEach((x) => (x.onclick = () => reveal(mine.find((m) => m.fingerprint === x.dataset.reveal))));
    el.querySelectorAll('[data-deposit]').forEach((x) => (x.onclick = () => openCredit('deposit')));
    const f = $('#attForm', el); if (f) f.onsubmit = (e) => { e.preventDefault(); review(); };
  };
  const say = (html, kind = 'info') => { msg = html; msgKind = kind; };

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
    if (credit === null || BigInt(credit) < BigInt(fresh.next_fee)) return stop(`Not enough credit: the fee is ${esc(near(fresh.next_fee))} and your credit is ${esc(near(credit || '0'))}. <button class="m-link" type="button" data-deposit>Deposit</button>`);
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
        if (!out.ok) { dropAttempt(recd); say(commitError(out.error) + (out.tx ? ` Transaction ${tx(out.tx)}.` : ''), 'bad'); }
        else if (out.value === null) { dropAttempt(recd); say(`Cap full: the contract ignored the commit and took nothing. Transaction ${tx(out.tx)}.`, 'bad'); }
        else {
          let index = typeof out.value === 'number' ? out.value : null;
          if (index === null) { const subsNow = await submissions(await view('get_bounty', { bounty_id: String(b.id) }, { fresh: true })); const hit = subsNow.findIndex((x) => x && x.fingerprint === fp); index = hit >= 0 ? hit : null; }
          recd.index = index; recd.commitTx = out.tx; putAttempt(recd);
          say(`Attempt recorded as #${index}. The fee was taken from your credit. Transaction ${tx(out.tx)}.${stored ? ' The record is kept in this browser; download it too.' : ' This browser does not keep it: download the record now, you need it to reveal.'}`, 'ok');
          if (!stored) downloadRecord(recd);
        }
      } catch (e) { dropAttempt(recd); say(`Wallet rejected or failed: ${esc(W.plainError(e))} Nothing was taken.`, 'bad'); }
      busy = false; await refreshCredit(); await draw();
    });
  }

  async function reveal(m) {
    say('Waiting for the wallet. Approve or reject the reveal in the wallet window.'); await draw();
    try {
      const out = W.readOutcome(await W.call('reveal', { bounty_id: String(b.id), index: m.index, patch: m.patchB64, nonce: m.nonce }));
      if (out.ok) { m.revealed = true; m.revealTx = out.tx; putAttempt(m); say(`Revealed. Transaction ${tx(out.tx)}. Waiting for the vendor’s proof.`, 'ok'); }
      else say(`The reveal was refused: ${esc(out.error)}.${out.tx ? ` Transaction ${tx(out.tx)}.` : ''}`, 'bad');
    } catch (e) { say(`Wallet rejected or failed: ${esc(W.plainError(e))}`, 'bad'); }
    await draw();
  }

  W.onChange(draw); onCredit(draw);
  (async () => { if (W.state.status === 'on') { if (credit === null) refreshCredit(); try { const l = await view('get_agent_limits', { account_id: W.state.account }); if (l.fixed_payout) el.dataset.fixed = l.fixed_payout; } catch { /* no limits shown */ } } draw(); })();
}

function commitError(e) {
  if (/not enough credit/.test(e)) return 'Not enough credit: nothing was taken. <button class="m-link" type="button" data-deposit>Deposit</button>';
  if (/max_fee_per_commit/.test(e)) return 'Refused: the fee is above your own max fee per attempt. Nothing taken.';
  if (/bounty is closed|has expired|too close to expiry|not open/.test(e)) return 'Bounty closed: it does not take new attempts. Nothing taken.';
  if (/fixed payout/.test(e)) return 'Refused: your agent limits fix another payout account. Nothing taken.';
  return `Refused by the contract: ${esc(e)}. Nothing taken.`;
}

function confirmSheet(info, onYes) {
  const d = $('#confirmDlg');
  d.innerHTML = `<h2 class="m-h2" id="confTitle">Confirm the attempt</h2>
    <dl class="m-facts"><div><dt>Fee, from your credit</dt><dd class="k-mono">${esc(near(info.fee))}</dd></div>
    <div><dt>Slots left</dt><dd>${info.left} of ${info.cap}</dd></div>
    <div><dt>Payout account</dt><dd class="k-hash">${esc(info.payout)}</dd></div><div><dt>Patch sha256</dt><dd class="k-mono k-hash">${esc(info.patchHash)}</dd></div></dl>
    <p><b>Each attempt returns one yes or no.</b></p>
    <div class="m-cta"><button class="m-btn" type="button" id="confYes">Commit in wallet</button><button class="m-btn sec" type="button" id="confNo">Cancel</button></div>`;
  d.showModal(); $('#confYes', d).focus();
  $('#confNo', d).onclick = () => d.close();
  $('#confYes', d).onclick = () => { d.close(); onYes(); };
}

// ---------- agent page ----------
export async function agentPage(main) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '').get('account') || '';
  main.innerHTML = `<h1 class="m-h1" tabindex="-1">Agent check</h1>
    <p class="m-lead">Read only. Type an account name to see its credit, its agent limits and its attempts on ${esc(CONTRACT)}. Only a wallet can set limits or withdraw.</p>
    <form class="m-panel m-form" id="agForm" novalidate><div class="m-field"><label for="agAcc">Account name</label>
      <input id="agAcc" autocomplete="off" value="${esc(q)}" aria-describedby="agErr"></div><p id="agErr" class="m-err" role="alert" hidden></p>
      <button class="m-btn" type="submit">Check</button></form>
    <div id="agOut" class="m-sec"></div>
    <section class="m-sec m-panel"><h2 class="m-h2">For agents</h2><p>Machine readable: <a href="feed.json">feed.json</a> (open bounties) and <a href="agent-quickstart.txt">agent-quickstart.txt</a> (how to commit, reveal and use limits).</p></section>`;
  const run = async (a) => {
    const out = $('#agOut'); out.innerHTML = '<p class="k-state">Reading from testnet…</p>';
    try {
      const [c, lim, bs] = await Promise.all([view('get_credit', { account_id: a }), view('get_agent_limits', { account_id: a }), allBounties()]);
      const rows = [];
      for (const b of bs.filter(Boolean)) { (await submissions(b)).forEach((s, i) => { if (s && (s.committer === a || s.payout === a)) rows.push({ b, s, i }); }); }
      rows.sort((x, y) => Number(BigInt(y.s.committed_at_ns) - BigInt(x.s.committed_at_ns)));
      out.innerHTML = `<div class="m-two"><section class="m-panel"><h2 class="m-h2">Credit and limits</h2>
        <dl class="m-facts" style="grid-template-columns:1fr"><div><dt>Credit</dt><dd class="k-mono">${esc(near(String(c)))}</dd></div>
        <div><dt>Max fee per attempt</dt><dd>${lim.max_fee_per_commit ? `<span class="k-mono">${esc(near(lim.max_fee_per_commit))}</span>` : 'not set'}</dd></div>
        <div><dt>Fixed payout account</dt><dd>${lim.fixed_payout ? acct(lim.fixed_payout) : 'not set'}</dd></div></dl>
        <p class="m-note">Only a wallet can set limits (set_agent_limits) or withdraw: both need 1 yoctoNEAR attached, which an agent's commit only key cannot attach.</p></section>
        <section class="m-panel"><h2 class="m-h2">Attempts (${rows.length})</h2>${rows.length ? `<ul class="k-txs">${rows.slice(0, 20).map(({ b, s, i }) => `<li><span><a href="#/bounties/${esc(b.id)}">Bounty ${esc(b.id)}</a> #${i} · ${esc(s.outcome)}${s.revealed_at_ns ? '' : ', not revealed'} · fee ${s.fee === '0' ? 'refunded' : esc(near(s.fee))}<br><span class="k-src">${s.committer === a ? 'committed by this account' : 'payout to this account'}, ${esc(utc(s.committed_at_ns))}</span></span></li>`).join('')}</ul>` : '<p>No attempts by or for this account.</p>'}
        <p class="m-note">Found by reading every bounty's attempts from the chain.</p></section></div>`;
    } catch (e) { out.innerHTML = `<p class="k-err" role="alert">Could not read: ${esc(e.message)}</p>`; }
  };
  $('#agForm').onsubmit = (e) => {
    e.preventDefault(); const a = $('#agAcc').value.trim(), err = $('#agErr');
    if (!/^[a-z0-9._-]{2,64}$/.test(a)) { err.textContent = 'Enter a NEAR account name, for example name.testnet.'; err.hidden = false; $('#agAcc').setAttribute('aria-invalid', 'true'); $('#agAcc').focus(); return; }
    err.hidden = true; $('#agAcc').removeAttribute('aria-invalid'); run(a);
  };
  if (q) run(q);
}
