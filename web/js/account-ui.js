// The parts of the site that use a wallet (testnet only): the header wallet control with the credit chip, the credit
// panel (deposit_credit, withdraw_credit), the attempt panel on a bounty page (commit, reveal, then waiting for the
// vendor's proof), and the read only agent page. Every payment goes through a confirm step and then the wallet; the
// page shows only what the chain says. Attempt fees are taken from credit deposited in the contract first.
import { CONTRACT, EXPLORER_ACCOUNT, view, near, utc, span, commitBy, nsToDate, allBounties, submissions, accessKeys } from './chain.js';
import { TX_INDEX } from './config.js';
import * as W from './wallet.js';
import { fingerprint, newNonce, hex, b64, sha256, putAttempt, attemptsFor, dropAttempt, downloadRecord, toYocto } from './attempt.js';
import { $, esc, badge, tx, acct, toast, passStamp, table, facts, bothTimes, tabbed, hashCell } from './ui.js';

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
    el.innerHTML = `<button class="k-chip" type="button" id="creditChip" aria-haspopup="dialog">Credit <b class="k-priv">${credit === null ? '…' : esc(near(credit))}</b></button>
      <div class="k-acct"><button class="m-btn" type="button" id="acctBtn" aria-haspopup="true" aria-expanded="false" aria-controls="acctMenu" title="${esc(s.account)}"><span class="k-priv">${esc(short(s.account))}</span></button>
      <ul class="k-menu" id="acctMenu" hidden>
        <li><button type="button" data-act="activity">My activity</button></li>
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
      if (b.dataset.act === 'activity') location.hash = `#/account/${encodeURIComponent(s.account)}`;
      if (b.dataset.act === 'out') { await W.disconnect(); toast('Disconnected.'); }
    }));
  } else if (s.status === 'connecting') {
    el.innerHTML = '<button class="m-btn" type="button" disabled aria-busy="true">Connecting…</button>';
  } else if (s.status === 'wrongnet') {
    el.innerHTML = `<span class="m-badge b-bad" role="alert">✕ Not a testnet account</span><button class="m-btn sec sm" type="button" id="outBtn">Disconnect</button>`;
    $('#outBtn').onclick = () => W.disconnect();
  } else if (s.status === 'failed') {
    el.innerHTML = `<span class="k-werr" role="alert">${esc(s.error || 'The wallet did not connect.')}</span><button class="m-btn" type="button" id="connBtn">Try again</button>`;
    $('#connBtn').onclick = () => W.connect();
  } else {
    el.innerHTML = '<button class="m-btn" type="button" id="connBtn">Connect wallet</button>';
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
      <div class="m-cta"><button class="m-btn" type="button" id="doIt">Approve in wallet</button><button class="m-btn sec" type="button" data-mode="${v.mode}">Change amount</button></div></div>`;
  } else if (v.phase === 'wait') {
    body = '<p class="k-state" role="status" aria-busy="true">Waiting for the wallet. Approve or reject the request in the wallet window.</p>';
  } else if (v.phase === 'done') {
    body = `<p role="status">${badge('ok', '✓ Done')} ${esc(v.msg)}</p>${v.tx ? `<p class="m-sub">Transaction ${tx(v.tx)}</p>` : ''}<div class="m-cta"><button class="m-btn sec" type="button" data-mode="">Back to credit</button></div>`;
  } else if (v.phase === 'failed') {
    body = `<p role="alert">${badge('bad', '✕ Not done')} ${esc(v.msg)}</p>${v.tx ? `<p class="m-sub">Transaction ${tx(v.tx)}</p>` : ''}<div class="m-cta"><button class="m-btn" type="button" data-mode="${v.mode}">Try again</button><button class="m-btn sec" type="button" data-mode="">Back</button></div>`;
  }
  d.innerHTML = `${head}
    <dl class="m-facts"><div><dt>Contract credit</dt><dd class="k-mono k-priv">${c === null ? 'could not read' : esc(near(credit))}</dd></div>
    <div><dt>Wallet balance</dt><dd class="k-mono k-priv">${bal === null || bal === undefined ? 'could not read' : esc(near(bal))}</dd></div></dl>
    <p class="m-sub">Account <span class="k-priv">${esc(s.account)}</span>. Attempt fees are taken from this credit.</p>${body}
    <section class="k-recent" aria-labelledby="recentT"><div class="m-crow"><h2 class="m-h2" id="recentT">Recent activity</h2><a href="#/account/${encodeURIComponent(s.account)}/credit" data-close>View all</a></div>
      <div id="recent"><p class="m-sub">Reading recent activity…</p></div></section>`;
  bindCommon(d);
  drawRecent(s.account);
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
const OUTCOME = { Passed: ['ok', '✓ PASSED'], Failed: ['bad', '✕ FAILED'], TimedOut: ['info', 'Paid by timeout'], Released: ['info', 'Not revealed in time, slot released'] };

export function attemptPanel(el, b, subs, verifiers) {
  let busy = false, msg = '', msgKind = 'info';
  const draw = async () => {
    if (!el.isConnected) return; // the visitor left this bounty page
    const s = W.state, now = Date.now();
    const closed = b.state !== 'Open' || !b.opened || nsToDate(commitBy(b)).getTime() <= now;
    const slotsLeft = Math.max(0, b.max_commits - b.active);
    const mine = s.status === 'on' ? attemptsFor(s.account, b.id) : [];
    const step = mine.some((m) => m.index !== null && m.revealed) ? 3 : mine.some((m) => m.index !== null) ? 2 : 1;
    const stepper = `<ol class="m-sstep" aria-label="Steps of an attempt">${['Commit', 'Reveal', 'Vendor’s proof'].map((t, i) =>
      `<li class="${i + 1 === step ? 'now' : i + 1 < step ? 'past' : ''}"${i + 1 === step ? ' aria-current="step"' : ''}><span class="m-n">${i + 1 < step ? '✓' : i + 1}</span>${t}</li>`).join('')}</ol>`;
    let mineHtml = '';
    for (const m of mine) {
      let sub = null; if (m.index !== null) { try { sub = await view('get_submission', { bounty_id: String(b.id), index: m.index }, { fresh: true }); } catch { /* shown below */ } }
      let line;
      if (m.index === null) line = '<p>Commit sent, result not known yet. Reload the page; the record is kept.</p>';
      else if (!sub) line = '<p>Could not read this attempt from the chain.</p>';
      else if (OUTCOME[sub.outcome]) line = `<p>${sub.outcome === 'Passed' ? passStamp() : ''} ${badge(...OUTCOME[sub.outcome])} The chain says this attempt is final.</p>`;
      else if (sub.revealed_at_ns) {
        const dl = Number(BigInt(sub.deadline_ns) / 1000000n);
        line = now > dl ? `<p>${badge('info', 'Vendor’s time is up')} The vendor did not prove it by ${esc(bothTimes(dl))}. Anyone can now claim the timeout.</p>`
          : `<p>${badge('wait', '… Waiting for the vendor’s proof')} Only the vendor can prove an attempt. Deadline: ${esc(bothTimes(dl))}.</p>`;
      }
      else {
        const from = Number(BigInt(sub.committed_at_ns) / 1000000n) + Number(BigInt(b.reveal_gap_ns) / 1000000n), until = Number(BigInt(sub.committed_at_ns) / 1000000n) + Number(BigInt(b.reveal_window_ns) / 1000000n);
        const soon = until - now < 10 * 60000;
        line = now < from ? `<p>Reveal opens at ${esc(bothTimes(from))}.</p>`
          : now > until ? `<p>${badge('bad', '✕ Too late to reveal')} The reveal deadline, ${esc(bothTimes(until))}, has passed. This commit can no longer be revealed and its fee stays with the contract.</p>`
          : `<p>Reveal by ${esc(bothTimes(until))}.${soon ? ' <b>Less than 10 minutes left.</b>' : ''}</p><button class="m-btn" type="button" data-reveal="${esc(m.fingerprint)}">Reveal attempt #${m.index}</button>`;
      }
      mineHtml += `<li class="k-mine"><p><b>Your attempt #${m.index ?? '?'}</b> <span class="k-src">payout ${esc(m.payout)}</span></p>${line}
        <button class="m-link" type="button" data-file="${esc(m.fingerprint)}">Download the attempt record</button></li>`;
    }
    let body;
    if (closed) {
      body = `<p>${badge('info', 'No new attempts')} This bounty does not take new attempts now.</p>`;
    } else if (s.status !== 'on') {
      body = s.status === 'wrongnet' ? '<p role="alert">This wallet account is not on testnet. Attempts are testnet only.</p>'
        : '<button class="m-btn" type="button" id="connSubmit">Connect to submit</button>';
    } else {
      const fixed = el.dataset.fixed || '';
      body = `<form class="m-form" id="attForm" novalidate>
        <div class="m-field"><label for="patch">Your patched module (.wasm, at most ${b.max_patch_bytes} bytes)</label><input id="patch" type="file" accept=".wasm,application/wasm"></div>
        <div class="m-field"><label for="payout">Payout account</label><input id="payout" autocomplete="off" value="${esc(fixed || s.account)}" ${fixed ? 'readonly' : ''} aria-describedby="payHint">
          <p class="m-hint" id="payHint">${fixed ? 'Your agent limits fix this payout account.' : 'Paid if your attempt passes. It must exist and cannot be the vendor, a verifier or the contract.'}</p></div>
        <p class="m-sub">Next fee <b class="k-mono">${esc(near(b.next_fee))}</b>, taken from your credit (${credit === null ? 'reading…' : esc(near(credit))}). ${slotsLeft} of ${b.max_commits} slots left.</p>
        <button class="m-btn" type="submit" ${busy ? 'disabled' : ''}>Review attempt</button></form>`;
    }
    el.hidden = closed && !mine.length; // a closed bounty with nothing of yours to follow needs no attempt panel
    if (el.hidden) return;
    el.innerHTML = `<h2 class="m-h2" id="sendT">Send an attempt</h2>${stepper}
      <p class="m-sub k-lines">Commit locks a sealed fingerprint of your fix. Reveal sends the fix itself so it can be tested. Reveal within ${esc(span(b.reveal_window_ns))} of your commit.<br>After you reveal, the vendor has ${esc(span(b.verdict_window_ns))} to prove the result.</p>
      ${msg ? `<div class="k-msg ${msgKind}" role="${msgKind === 'bad' ? 'alert' : 'status'}">${msg}</div>` : ''}
      ${mine.length ? `<ul class="k-mines">${mineHtml}</ul>` : ''}${body}`;
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
    <div class="m-cta"><button class="m-btn" type="button" id="confYes">Approve in wallet</button><button class="m-btn sec" type="button" id="confNo">Cancel</button></div>`;
  d.showModal(); $('#confYes', d).focus();
  $('#confNo', d).onclick = () => d.close();
  $('#confYes', d).onclick = () => { d.close(); onYes(); };
}

// ---------- activity and the Account page ----------
const OUT_LABEL = { Passed: ['ok', '✓ PASSED'], Failed: ['bad', '✕ FAILED'], TimedOut: ['info', 'TIMEOUT'], Released: ['info', 'RELEASED'] };
const FASTNEAR_TX = TX_INDEX; // the transaction index, from the site config
const fastPost = async (path, body) => (await fetch(`${FASTNEAR_TX}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const localTime = (ms) => new Date(ms).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// The account's own transactions to this contract, newest first: deposits, withdrawals and commits (with the attempt's
// fee and number, read from the contract). Transaction ids and times come from the FastNEAR transaction index, because
// the contract's views keep neither. Empty if the index does not answer.
async function activity(account, max = 150) {
  const items = [];
  try {
    const list = ((await fastPost('account', { account_id: account })).account_txs || []).filter((t) => t.is_signer)
      .sort((a, b) => (BigInt(b.tx_block_timestamp) > BigInt(a.tx_block_timestamp) ? 1 : -1)).slice(0, max);
    const meta = new Map(list.map((t) => [t.transaction_hash, t]));
    for (let i = 0; i < list.length; i += 20) {
      const res = await fastPost('transactions', { tx_hashes: list.slice(i, i + 20).map((t) => t.transaction_hash) });
      for (const t of res.transactions || []) {
        const x = t.transaction; if (!x || x.receiver_id !== CONTRACT) continue;
        const fc = (x.actions || []).map((a) => a.FunctionCall).find(Boolean); if (!fc) continue;
        let args = {}; try { args = JSON.parse(atob(fc.args)); } catch { /* not JSON */ }
        const m = meta.get(x.hash), base = { tx: x.hash, ms: Number(BigInt(m.tx_block_timestamp) / 1000000n), ok: m.is_success !== false, key: x.public_key };
        if (fc.method_name === 'deposit_credit') items.push({ ...base, kind: 'deposit', amount: String(fc.deposit) });
        else if (fc.method_name === 'withdraw_credit') items.push({ ...base, kind: 'withdraw', amount: String(args.amount || '0') });
        else if (fc.method_name === 'commit') items.push({ ...base, kind: 'attempt', bounty: String(args.bounty_id), fingerprint: args.fingerprint });
        else if (fc.method_name === 'reveal') items.push({ ...base, kind: 'reveal', bounty: String(args.bounty_id), index: args.index });
        else if (fc.method_name === 'set_agent_limits') items.push({ ...base, kind: 'limits', maxFee: args.max_fee_per_commit, payout: args.fixed_payout });
      }
    }
  } catch { return []; }
  items.sort((a, b) => b.ms - a.ms);
  // the fee and number of each attempt, from the contract
  const bountyIds = [...new Set(items.filter((x) => x.kind === 'attempt').map((x) => x.bounty))];
  for (const id of bountyIds) {
    try {
      const subs = await submissions(await view('get_bounty', { bounty_id: id }));
      items.filter((x) => x.kind === 'attempt' && x.bounty === id).forEach((x) => { const k = subs.findIndex((s) => s && s.fingerprint === x.fingerprint); if (k >= 0) { x.index = k; x.amount = subs[k].fee; } });
    } catch { /* fee unknown */ }
  }
  return items;
}

function activityRows(items) {
  return items.map((x) => [
    x.kind === 'deposit' ? 'Deposit' : x.kind === 'withdraw' ? 'Withdrawal'
      : x.kind === 'limits' ? `Agent limits set: max fee ${x.maxFee ? esc(near(x.maxFee)) : 'none'}, payout ${x.payout ? esc(x.payout) : 'any'}`
      : `${x.kind === 'reveal' ? 'Reveal' : 'Attempt'} on <a href="#/bounties/${esc(x.bounty)}">bounty ${esc(x.bounty)}</a>${x.index !== undefined ? ` #${x.index}` : ''}`,
    !x.ok ? badge('bad', '✕ FAILED') : x.kind === 'reveal' || x.kind === 'limits' ? '<span class="k-dim">no amount</span>'
      : x.amount !== undefined ? `<span class="k-mono k-nw k-priv">${x.kind === 'attempt' ? 'fee ' : ''}${esc(near(x.amount))}</span>` : '<span class="k-dim">fee unknown</span>',
    esc(localTime(x.ms)), tx(x.tx)]);
}

async function drawRecent(account) {
  const el = document.getElementById('recent'); if (!el) return;
  const items = (await activity(account, 60)).filter((x) => x.kind === 'deposit' || x.kind === 'withdraw' || x.kind === 'attempt').slice(0, 10);
  if (!document.getElementById('recent')) return;
  el.innerHTML = items.length ? table(['What', 'Amount', 'Time', 'Transaction'], activityRows(items), 'k-small k-stack')
    : '<p class="m-sub">No activity yet.</p>';
}

// The operator panel of one account: balances, the agent keys it gave this contract (scope, allowance, spend cap, amount
// spent), an audit log of its calls with transaction links, and, for the connected owner only, a stop button that sets
// the account's max fee per attempt to 0 in the contract (set_agent_limits, approved in the wallet): every later commit
// by the account is then refused, whichever key signs it. Everything shown is read from testnet.
export async function accountPage(main, name, tab) {
  if (!name) {
    if (W.state.status === 'on') { location.replace(`#/account/${encodeURIComponent(W.state.account)}`); return; }
    main.innerHTML = `<h1 class="m-h1" tabindex="-1">Operator panel</h1>
      <p class="m-lead">Balances, agent keys, spend limits and an audit log of one account, read from testnet. Connect a wallet to open your own, or enter any account.</p>
      <form class="m-panel m-form k-acform" id="agForm" novalidate><div class="m-field"><label for="agAcc">Account name</label>
      <input id="agAcc" autocomplete="off" aria-describedby="agErr"><p id="agErr" class="m-err" role="alert" hidden></p></div>
      <button class="m-btn" type="submit">Show account</button></form>`;
    $('#agForm').onsubmit = (e) => {
      e.preventDefault(); const a = $('#agAcc').value.trim(), err = $('#agErr');
      if (!/^[a-z0-9._-]{2,64}$/.test(a)) { err.textContent = 'Enter a NEAR account name, for example name.testnet.'; err.hidden = false; $('#agAcc').setAttribute('aria-invalid', 'true'); $('#agAcc').focus(); return; }
      location.hash = `#/account/${encodeURIComponent(a)}`;
    };
    return;
  }
  main.innerHTML = `<p class="m-eye">Account</p><h1 class="m-h1 k-acname k-priv" tabindex="-1">${esc(name)}</h1>
    <div id="acOut"><p class="k-state" style="margin-top:28px">Reading from testnet…</p></div>`;
  try {
    const [c, lim, bs, act, keys, bal] = await Promise.all([view('get_credit', { account_id: name }, { fresh: true }), view('get_agent_limits', { account_id: name }, { fresh: true }),
      allBounties(), activity(name), accessKeys(name).catch(() => null), W.balance(name)]);
    const txOf = new Map(act.filter((x) => x.kind === 'attempt').map((x) => [`${x.bounty}:${x.fingerprint}`, x.tx]));
    const mine = [], created = [];
    for (const b of bs.filter(Boolean)) {
      if (b.vendor === name) created.push(b);
      (await submissions(b)).forEach((s, i) => { if (s && s.committer === name) mine.push({ b, s, i }); });
    }
    mine.sort((x, y) => Number(BigInt(y.s.committed_at_ns) - BigInt(x.s.committed_at_ns)));
    // Fees not paid back: a passed attempt and an attempt paid by timeout get their own fee back.
    const spent = mine.filter(({ s }) => s.outcome !== 'Passed' && s.outcome !== 'TimedOut').reduce((t, { s }) => t + BigInt(s.fee || '0'), 0n);
    const stateText = (b, s) => ({ Passed: 'Passed, paid', Failed: 'Failed', TimedOut: 'Paid by timeout', Released: 'Slot released' }[s.outcome]
      || (s.revealed_at_ns ? (b.state === 'Open' ? 'Waiting for the vendor’s proof' : 'Undecided') : 'Committed, not revealed'));
    const stopped = lim.max_fee_per_commit === '0';
    const agentKeys = (keys || []).filter((k) => k.access_key.permission.FunctionCall && k.access_key.permission.FunctionCall.receiver_id === CONTRACT);
    const agentSet = new Set(agentKeys.map((k) => k.public_key));
    const fullKeys = (keys || []).filter((k) => k.access_key.permission === 'FullAccess').length;
    const scope = (m) => { const set = new Set(m || []); return m && m.length && [...set].every((x) => x === 'commit' || x === 'reveal')
      ? `commit and reveal on ${esc(CONTRACT)}<span class="m-sub">cannot withdraw or change limits</span>` : m && m.length ? esc([...set].join(', ')) : 'every method of the contract that takes no deposit'; };
    const me = W.state.status === 'on' && W.state.account === name;
    const history = [...mine.map(({ b, s, i }) => ({ ms: Number(BigInt(s.committed_at_ns) / 1000000n),
        row: [`<a href="#/bounties/${esc(b.id)}">Bounty ${esc(b.id)}</a> · #${i}`, `${esc(stateText(b, s))} · <span class="k-mono k-priv">${s.fee === '0' ? 'fee refunded' : esc(near(s.fee))}</span>`,
          txOf.get(`${b.id}:${s.fingerprint}`) ? tx(txOf.get(`${b.id}:${s.fingerprint}`)) : '<span class="k-dim">not found</span>'] })),
      ...act.filter((x) => x.kind === 'deposit' || x.kind === 'withdraw').map((x) => ({ ms: x.ms,
        row: [x.kind === 'deposit' ? 'Deposit' : 'Withdrawal', x.ok ? `Credit <span class="k-mono k-priv">${esc(near(x.amount))}</span>` : badge('bad', '✕ FAILED'), tx(x.tx)] }))]
      .sort((p, q) => q.ms - p.ms).slice(0, 12);
    const plain = (rows) => `<div class="k-tw"><table class="k-table"><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td><div class="k-cv">${c}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const stopCell = (i) => (me && !stopped && i === 0 ? `<button class="m-btn sec sm" type="button" id="stopBtn">[ ${agentKeys.length > 1 ? 'stop agents' : 'stop agent'} ]</button>` : '');
    $('#acOut').innerHTML = `
      <dl class="k-stats">
        <div><dt>Contract credit</dt><dd class="k-priv">${esc(near(String(c)))}</dd></div>
        <div><dt>Wallet balance</dt><dd class="k-priv">${bal === null || bal === undefined ? 'could not read' : esc(near(bal))}</dd></div>
        <div><dt>Attempts</dt><dd>${mine.length}</dd></div></dl>
      ${history.length ? `<section class="m-panel k-tablepanel" aria-label="History">${plain(history.map((h) => h.row))}</section>` : '<p class="k-state">No attempts or deposits yet.</p>'}
      <div class="k-ophead"><h2 class="m-h2" id="opT">Operator panel</h2></div>
      <section class="m-panel k-tablepanel" aria-labelledby="opT">${keys === null ? '<p class="m-sub k-pad" style="padding:16px 18px">Could not read the account’s access keys.</p>'
        : agentKeys.length ? table(['Agent', 'Scope', 'Spend cap', 'Spent', 'Status', ''], agentKeys.map((k, i) => {
          const fc = k.access_key.permission.FunctionCall;
          return [`<span class="k-agentname"><b>Agent key</b><code title="${esc(k.public_key)}">${esc(k.public_key.slice(0, 16))}…</code> <button class="k-mini" type="button" data-copy-text="${esc(k.public_key)}">copy</button><span class="m-sub">function-call key</span></span>`,
            `${scope(fc.method_names)}<span class="m-sub">gas allowance left ${fc.allowance ? esc(near(fc.allowance)) : 'not limited'}</span>`,
            `<span class="k-mono k-nw">${lim.max_fee_per_commit ? `${esc(near(lim.max_fee_per_commit))}` : 'none set'}</span><span class="m-sub">per attempt</span>`,
            `<span class="k-mono k-nw k-priv">${esc(near(spent.toString()))}</span>`,
            stopped ? badge('bad', '✕ Stopped') : badge('ok', 'Active'), stopCell(i)];
        })) : '<p class="m-sub k-pad" style="padding:16px 18px">No key of this account is limited to this contract.</p>'}
        <p class="m-sub k-pad">${keys === null ? '' : `Spend cap: the most one attempt may cost (set_agent_limits). Spent: attempt fees not paid back. ${fullKeys} full access ${fullKeys === 1 ? 'key' : 'keys'} (the owner’s wallet keys) not listed.`}
        ${lim.fixed_payout ? ` Fixed payout: ${acct(lim.fixed_payout)}.` : ''}${me && !stopped && agentKeys.length ? ' Stop: your wallet approves one call (set_agent_limits with a max fee of 0, 1 yoctoNEAR attached); every later commit by this account is then refused, whichever key signs it. Reveals of attempts already made still work, and the key stays.' : ''}
        ${stopped ? ' Stopped: the max fee per attempt is 0, so every commit by this account is refused. To start again, set a new max fee (For agents, step 5).' : ''}</p>
        <p class="m-note k-pad" style="margin-top:0;padding-bottom:14px">Skarbnik was built under the working name Kintsugi; the testnet contract keeps that name. Mainnet: skarbnik.near.</p>
        <div id="stopBox" class="k-pad" style="padding-bottom:4px"></div>
      </section>
      <h2 class="k-auditt" id="auT">Audit log</h2>
      <section class="m-panel k-tablepanel" aria-labelledby="auT">${act.length ? plain(act.map((x) => {
          const agent = agentSet.has(x.key), what = x.kind === 'deposit' ? `Deposited <span class="k-priv">${esc(near(x.amount))}</span> credit`
            : x.kind === 'withdraw' ? `Withdrew <span class="k-priv">${esc(near(x.amount || '0'))}</span> of credit`
              : x.kind === 'limits' ? `Set agent limits: max fee ${x.maxFee ? esc(near(x.maxFee)) : 'none'}, payout ${x.payout ? esc(x.payout) : 'any'}`
                : `${x.kind === 'reveal' ? 'Revealed' : 'Committed'} attempt${x.index !== undefined ? ` #${esc(x.index)}` : ''} on bounty ${esc(x.bounty)}${x.kind === 'attempt' && x.amount !== undefined ? ` · fee ${esc(near(x.amount))}` : ''}`;
          return [`<span class="k-actor">${agent ? 'agent' : 'operator'}</span>`, `${what}${x.ok ? '' : ' ' + badge('bad', '✕ FAILED')}`, tx(x.tx), `<span class="k-vis">${agent ? 'Agent' : 'Operator'}</span>`];
        })) + '<p class="m-sub k-pad">Every call this account signed to the contract, from the FastNEAR transaction index. Agent: signed by a key limited to this contract; operator: signed by another key of the account.</p>'
        : '<p class="m-sub k-pad" style="padding:16px 18px">No calls to the contract yet.</p>'}</section>
      ${created.length ? `<h2 class="k-auditt" id="crT">Bounties created</h2><section class="m-panel k-tablepanel" aria-labelledby="crT">${table(['Bounty', 'State', 'Reward', 'Created'], created.slice().reverse().map((b) => [`<a href="#/bounties/${esc(b.id)}">Bounty ${esc(b.id)}</a>`, esc(b.state), `<span class="k-mono k-nw">${esc(near(b.amount))}</span>`, `<span class="k-mono">${esc(utc(b.created_at_ns))}</span>`]))}</section>` : ''}
      <p class="m-sub" style="margin-top:18px"><a href="${EXPLORER_ACCOUNT}${encodeURIComponent(name)}" rel="noopener" target="_blank">All transactions of this account on the explorer ↗</a></p>`;
    const stop = $('#stopBtn');
    if (stop) stop.onclick = async () => {
      const box = $('#stopBox');
      box.innerHTML = '<p class="k-state" role="status" aria-busy="true">Waiting for the wallet. Approve or reject the request in the wallet window.</p>';
      try {
        const out = W.readOutcome(await W.call('set_agent_limits', { max_fee_per_commit: '0', fixed_payout: lim.fixed_payout || null }, '1', 30));
        box.innerHTML = out.ok ? `<p class="k-msg ok" role="status">Stopped. The max fee per attempt is now 0. Transaction ${tx(out.tx)}</p>`
          : `<p class="k-msg bad" role="alert">Not stopped: ${esc(out.error)}${out.tx ? ` Transaction ${tx(out.tx)}` : ''}</p>`;
      } catch (e) { box.innerHTML = `<p class="k-msg bad" role="alert">Not stopped: ${esc(W.plainError(e))}</p>`; }
    };
  } catch (e) { $('#acOut').innerHTML = `<p class="k-err" role="alert">Could not read: ${esc(e.message)}</p>`; }
}
