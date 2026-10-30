// One bounty, in the Bounty 17 page design, for every bounty: the status and kind chips, the reward, attempts and
// verdict window, a "why this is not Proof verified" box for a timeout payment, and four tabs: Overview (the attempt
// panel for commit and reveal, the story of the bounty from its recorded transactions, its attempts), Transactions,
// Rules and timing, and Privacy and evidence. The aside holds the terms, the check-the-checker command (shown only
// after scripts/check_image_id.sh printed MATCH) and a comparison. Everything except the descriptive words is read from
// the chain and from data/recorded.json. Also the raw data page (#/raw/<id>).
import { CONTRACT, EXPLORER_ACCOUNT, PUBLISHED_IMAGE_ID, view, submissions, near, utc, utcShort, span, left, commitBy } from '../chain.js';
import { $, esc, icon, chip, tx, acct, hashCell, table, facts, note, cmd, tabbed } from '../ui.js';
import { STATUS, kindOf, kindChips, statusOf, accepting, isJudge, isNewModule } from '../status.js';
import { getRecorded, getMeta } from '../data.js';
import { attemptPanel } from '../account-ui.js';

const STEP = {
  create_bounty: ['coin', 'Bounty created and funded', 'The vendor locked the reward. Every hash, the windows, K and the check size were fixed on chain. The bounty starts closed.'],
  open_with_groth16: ['seal', 'Opened by Proof 0', 'The vendor proved its own reference fix passes the full check. The contract verified that Groth16 proof itself, so the bounty could open.'],
  attest_proof0: ['seal', 'Proof 0 attested', 'A registered verifier signed that the vendor’s Proof 0 passes (Level 0).'],
  commit: ['hash', 'An attempt commits a fingerprint', 'Only a fingerprint of the patch goes on chain, with the attempt fee from credit.'],
  reveal: ['eye', 'The attempt reveals its patch', 'The patch became public on chain. The block seed chose the hidden fairness inputs, and the verdict window started.'],
  submit_groth16: ['seal', 'A proof of the attempt was accepted', 'The contract checked the Groth16 proof itself and applied its verdict.'],
  attest: ['seal', 'A verifier attested the verdict', 'Level 0: a registered verifier signed the verdict.'],
  claim_timeout: ['hourglass', 'Anyone claimed the timeout', 'The verdict window ended with no accepted proof. claim_timeout paid the revealed attempts still undecided. The contract did not look at the fix.'],
  release_unrevealed: ['undo', 'An unrevealed slot was released', 'A commit that was never revealed in time gave its slot back; its fee went to the protocol pool.'],
  expire: ['undo', 'Expired and refunded', 'After the expiry, expire returned the unpaid reward to the vendor.'],
};

function subState(b, s) {
  if (s.outcome === 'Passed') return ['k-proof', 'Proof verified', 'check'];
  if (s.outcome === 'Failed') return ['k-fail', 'Failed by a proof', 'x'];
  if (s.outcome === 'TimedOut') return ['k-timeout', 'Timeout settlement', 'hourglass'];
  if (s.outcome === 'Released') return ['k-refund', 'Released', 'undo'];
  if (s.revealed_at_ns) return b.state !== 'Open' ? ['k-refund', 'Undecided, refunded as credit', 'undo'] : ['k-await', 'Awaiting evaluation', 'hourglass'];
  return ['k-open', 'Committed', 'clock'];
}
function windowLeft(b, s) {
  if (s.outcome !== 'Open' || b.state !== 'Open') return '<span class="faint">none</span>';
  const ns = s.revealed_at_ns ? s.deadline_ns : (BigInt(s.committed_at_ns) + BigInt(b.reveal_window_ns)).toString();
  const l = left(ns);
  return `${s.revealed_at_ns ? 'proof due' : 'reveal by'} <span class="mono nw">${esc(utcShort(ns))} UTC</span><span class="small">${l ? esc(l) : 'passed'}</span>`;
}

export async function bounty(viewEl, id, tab) {
  viewEl.innerHTML = `<main id="main" class="p-bounty" tabindex="-1"><section class="ph"><div class="wrap"><nav class="crumb" aria-label="Breadcrumb"><a href="#/bounties">Bounties</a><span aria-hidden="true">/</span><span style="color:var(--tx)" aria-current="page">Bounty ${esc(id)}</span></nav><h1>Bounty ${esc(id)}</h1><p class="state">Reading bounty ${esc(id)} from testnet…</p></div></section></main>`;
  let b, subs, rec, meta, verifiers;
  try {
    [rec, meta, b] = await Promise.all([getRecorded(), getMeta(), view('get_bounty', { bounty_id: String(id) })]);
    if (!b) { viewEl.querySelector('.state').textContent = `There is no bounty ${id} on ${CONTRACT}.`; return; }
    [subs, verifiers] = await Promise.all([submissions(b), view('get_verifiers').then((v) => v.map((x) => x.account_id))]);
  } catch (e) { const st = viewEl.querySelector('.state'); if (st) st.innerHTML = `Could not read the contract on testnet: ${esc(e.message)}. Check your connection and reload.`; return; }
  if (!document.querySelector('main.p-bounty')) return;
  const kind = kindOf(b, rec), status = statusOf(b, subs, kind), st = STATUS[status], acc = accepting(b);
  const title = (meta.titles || {})[id] || `Bounty ${id}`, story = (meta.story || {})[id] || {};
  const txs = (rec.bounties && rec.bounties[String(id)]) || [], recNote = rec.bounty_notes && rec.bounty_notes[String(id)];
  const imgOk = b.image_id === PUBLISHED_IMAGE_ID, demo = kind === 'demo' || (rec.notes.demo_exploit_commitment || {}).commitment === b.exploit_commitment;
  const check = rec.last_image_check && rec.last_image_check.result === 'MATCH' ? rec.last_image_check : null;
  const program = isNewModule(b, rec) ? (rec.new_module_programs || {})[String(id)] : demo ? 'data/demo/ (public demo module)' : isJudge(b, rec) ? 'data/unpack/ (same as bounty 17)' : null;
  const lead = story.lead || (status === 'Proof verified' ? 'A revealed attempt was proven PASS and the contract paid on that proof.'
    : status === 'Timeout settlement' ? 'No proof was accepted inside the verdict window, so the contract paid by its timeout rule. That is a liveness rule, not a verdict.'
    : status === 'Refunded' ? 'Nothing was paid out. The vendor got the reward back.'
    : acc ? 'Open now: it accepts commits until the time below. Fix the public program and commit from the panel below, or run an agent.'
    : status === 'Awaiting evaluation' ? 'A revealed attempt is waiting for the vendor’s proof. If none arrives before its deadline, anyone can claim the timeout.'
    : status === 'Waiting for Proof 0' ? 'Created and funded, not opened yet. It opens when its Proof 0 is accepted on chain.'
    : status === 'Failed' ? 'Past its expiry and not settled. Anyone can call expire to refund the vendor.'
    : 'Read live from the contract.');

  const timeoutBox = status === 'Timeout settlement' ? `<div class="why" role="note"><span class="vico">${icon('info')}</span><div>
    <h2 class="h3">Why this is not “Proof verified”</h2>
    <p class="body" style="margin-top:8px;max-width:760px">The contract never checked a proof for the paid attempt. It paid because the verdict window ended. We say so on every page that shows this bounty.</p>
    ${story.why ? `<div class="why-list">${story.why.map(([h, p]) => `<div><b>${esc(h)}</b><p class="small">${esc(p)}</p></div>`).join('')}</div>` : ''}
    </div></div>` : '';

  // Overview: the attempt panel, the story from the recorded transactions, the attempts on chain
  // the story in the contract's order: creation, opening, commits, reveals, verdicts, settlement (recorded files are
  // not always in time order); calls of the same kind keep their recorded order
  const RANK = { create_bounty: 0, open_with_groth16: 1, attest_proof0: 1, commit: 2, reveal: 3, submit_groth16: 4, attest: 4, release_unrevealed: 5, claim_timeout: 6, expire: 7 };
  const lastProof = [...txs].reverse().find((t) => t.method === 'submit_groth16' && t.result === 'succeeded');
  const ok = txs.filter((t) => t.result === 'succeeded' && STEP[t.method]).map((t, i) => [t, i]).sort((a, c) => RANK[a[0].method] - RANK[c[0].method] || a[1] - c[1]).map(([t]) => t);
  const storyHtml = ok.length ? `<ol class="tl">${ok.map((t, i) => {
    const [ic, h, p] = STEP[t.method], good = t.method === 'submit_groth16' && status === 'Proof verified' && lastProof && t.tx === lastProof.tx;
    return `<li class="tli"><span class="vico ${good ? 'ok' : t.method === 'claim_timeout' ? 'mn' : ''}">${icon(ic)}</span><div><h3>${esc(h)}</h3><p class="small">${esc(t.what && !/^(Bounty created|Opened with)/.test(t.what) ? `${t.what}. ` : '')}${esc(p)}</p><div class="row">${tx(t.tx, t.method)}${t.time ? `<span class="small faint">${esc(t.time)}</span>` : ''}</div></div></li>`;
  }).join('')}</ol>` : '<p class="body">No transactions of this bounty are recorded in the repository. The attempts below are read from the chain.</p>';
  const slots = subs.map((s) => subState(b, s));
  const free = b.state === 'Open' ? Math.max(0, b.max_commits - b.active) : 0;
  const attemptsHtml = `<div class="aslots" aria-label="Attempt slots">${slots.map((s, i) => `<div class="aslot used"><b>#${i}</b>${chip(...s)}</div>`).join('')}${Array.from({ length: free }, () => '<div class="aslot"><b>free</b>Slot is free</div>').join('')}</div>
    <p class="small mt12">${b.commits} of ${b.max_commits} attempts used${b.commits - b.active > 0 && b.state === 'Open' ? `, ${b.commits - b.active} released` : ''}.</p>
    ${subs.length ? `<div class="mt16">${table(['Attempt', 'State', 'Fee', 'Payout', 'Revealed', 'Next deadline'], subs.map((s, i) => [`#${i}`, chip(...subState(b, s)), s.fee === '0' ? 'refunded' : `<span class="mono nw">${esc(near(s.fee))}</span>`, acct(s.payout), s.revealed_at_ns ? `<span class="nw">${esc(utc(s.revealed_at_ns))}</span>` : '<span class="faint">not revealed</span>', windowLeft(b, s)]), 'wide', 'Attempts')}</div>` : ''}`;
  const overview = `<div class="stack g36">
    <section class="card pad28" id="sendPanel" aria-labelledby="sendT"></section>
    <div><p class="eyebrow">What happened</p><h2 class="h2" style="margin-top:12px;font-size:calc(clamp(28px,3cqw,40px) * var(--hs,1))">${esc(status === 'Timeout settlement' ? 'From a private bug to a timeout payment' : status === 'Proof verified' ? 'From a fix to a proven payment' : 'The record so far')}</h2></div>
    ${storyHtml}
    <div><h3 class="h3">Attempts on chain</h3><div class="mt16">${attemptsHtml}</div></div></div>`;
  const transactions = `<div class="stack g24"><div><p class="eyebrow">Transactions</p><h2 class="h2" style="margin-top:12px;font-size:calc(clamp(28px,3cqw,40px) * var(--hs,1))">${txs.length ? `${txs.length} recorded ${txs.length === 1 ? 'call' : 'calls'} on the contract` : 'No recorded calls'}</h2><p class="body" style="margin-top:12px;max-width:640px">Open any of them on the explorer. Refused calls stay in the list.</p></div>
    ${txs.length ? table(['Step', 'Method', 'What it did', 'Result', 'Transaction'], txs.map((t, i) => [`<b>${i + 1}</b>`, `<span class="mono txt">${esc(t.method)}</span>`, `${esc(t.what)}${t.time ? `<span class="small faint">${esc(t.time)}</span>` : ''}`, /refused/.test(t.result) ? chip('k-reject', 'Refused', 'x') : chip('k-refund', 'Succeeded', 'check'), tx(t.tx)]), 'wide', 'Recorded transactions') + `<p class="small faint">Recorded in ${esc([...new Set(txs.map((t) => t.source))].join(', '))}.</p>` : '<p class="body">No transactions for this bounty are recorded in the repository. The chain still holds them: open the contract on the explorer.</p>'}</div>`;
  const cl = left(commitBy(b));
  const rules = `<div class="stack g32"><div><p class="eyebrow">Rules and timing</p><h2 class="h2" style="margin-top:12px;font-size:calc(clamp(28px,3cqw,40px) * var(--hs,1))">${status === 'Timeout settlement' ? 'Why a timeout paid' : 'The rules of this bounty'}</h2></div>
    <div class="rules">
    <div class="card rule-c"><span class="vico">${icon('clock')}</span><h3 class="h4">A ${esc(span(b.verdict_window_ns))} verdict window</h3><p class="small">It starts at the reveal. A proof for the attempt must reach the contract before it ends.</p></div>
    <div class="card rule-c"><span class="vico">${icon('undo')}</span><h3 class="h4">Late proofs are refused</h3><p class="small">After the window the contract answers “verdict window has closed”.</p></div>
    <div class="card rule-c"><span class="vico">${icon('coin')}</span><h3 class="h4">Anyone can claim</h3><p class="small">claim_timeout splits the bounty equally among revealed attempts still undecided.</p></div>
    <div class="card rule-c"><span class="vico">${icon('eyeoff')}</span><h3 class="h4">The fix is never read</h3><p class="small">A timeout pays whatever was revealed, even junk. That is why it is never called proof.</p></div>
    </div>
    <div><h3 class="h3">Fees, windows and limits</h3><div class="card pad24 mt16">${facts([
      acc ? ['Next attempt fee', `<span class="mono">${esc(near(b.next_fee))}</span><span class="small">${esc(b.next_fee)} yoctoNEAR, for attempt #${esc(b.commits)}, from credit</span>`] : null,
      ['Fee rule', `<span class="mono">${esc(near(b.attempt_fee))} + ${esc(near(b.fee_step))}</span><span class="small">per earlier attempt</span>`],
      ['Patch size limit', `<span class="mono">${esc(Number(b.max_patch_bytes).toLocaleString('en-US'))} bytes</span><span class="small">this bounty’s limit (max_patch_bytes); the checker allows up to 2,048 bytes</span>`],
      ['Attempts', `${esc(b.commits)} of ${esc(b.max_commits)} used`],
      ['Per-account cap', b.max_commits_per_account ? `${esc(b.max_commits_per_account)} of ${esc(b.max_commits)} slots per account` : 'none on this bounty'],
      ['Reveal', `after ${esc(span(b.reveal_gap_ns))}, within ${esc(span(b.reveal_window_ns))} of the commit`],
      ['Verdict window', `${esc(span(b.verdict_window_ns))} from the reveal`],
      ['Commits accepted until', `<span class="mono">${esc(utc(commitBy(b)))}</span>${cl && b.state === 'Open' ? `<span class="small">${esc(cl)}</span>` : ''}`],
      ['Expires', `<span class="mono">${esc(utc(b.expires_at_ns))}</span>${b.state === 'Open' && left(b.expires_at_ns) ? `<span class="small">${esc(left(b.expires_at_ns))}</span>` : ''}`],
      ['Created', `<span class="mono">${esc(utc(b.created_at_ns))}</span>`],
    ])}</div></div>
    ${story.measured ? `<div><h3 class="h3">${esc(story.measured_title)}</h3><div class="mt16">${table(['Step', 'Time', 'Note'], story.measured.map(([a, t, n]) => [`<b>${esc(a)}</b>`, `<span class="mono nw">${esc(t)}</span>`, esc(n)]), '', 'Measured times')}</div><p class="small faint" style="margin-top:14px;max-width:680px">${esc(story.measured_note)}</p></div>` : ''}
    </div>`;
  const privacy = `<div class="stack g28"><div><p class="eyebrow">Privacy and evidence</p><h2 class="h2" style="margin-top:12px;font-size:calc(clamp(28px,3cqw,40px) * var(--hs,1))">What is recorded, and what is not claimed</h2></div>
    ${note(`${demo ? 'This bounty uses the public demo input (data/demo/exploit.hex), so anyone can check it.' : 'Sealed: only the commitment of the secret input is on chain.'} On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.`, 'eyeoff')}
    ${isJudge(b, rec) ? note(esc(rec.judge_bounties[String(id)])) : ''}
    ${rec.test_bounties && rec.test_bounties[String(id)] ? note(esc(rec.test_bounties[String(id)]), 'flask') : ''}
    ${story.claims ? table(['Claim', 'Label', 'Where it is recorded'], story.claims.map(([c, l, w]) => [`<b>${esc(c)}</b>`, l === 'Not claimed' ? '<span class="chip k-fail" style="color:var(--tx2);border-color:var(--ln2)">Not claimed</span>' : `<span class="chip l-demo">${esc(l)}</span>`, esc(w)]), 'mid', 'Claims') : ''}
    <div class="card pad24">${facts([
      ['Checker image id', `${hashCell(b.image_id)}<div class="chips mt8">${imgOk ? chip('l-demo', 'The published checker', 'check') : chip('k-fail', 'Not the published checker', 'x')}${b.image_id_allowed ? chip('l-demo', 'On the allowlist', 'check') : chip('k-fail', 'Not on the allowlist', 'x')}</div>`],
      ['Check size', `${esc(b.fuzz_count)} fresh inputs, ${esc(b.variant_count)} variants of the secret input`],
      ['Exploit commitment', hashCell(b.exploit_commitment) + (demo ? '<span class="small">equals the demo commitment (data/demo/exploit.hex, public salt)</span>' : '')],
      ['Proof 0 journal hash', hashCell(b.proof0_journal_hash)],
      ['Proof 0 receipt hash', hashCell(b.proof0_receipt_hash)],
      ['Reference fix hash', hashCell(b.reference_fix_hash)],
      ['Reference fix module', demo ? 'public on purpose for demo bounties (data/demo/fixed.wasm)' : 'kept by the vendor, never on chain'],
    ])}</div>
    ${story.caveat ? note(esc(story.caveat), 'alert') : ''}
    <p class="small"><a class="lnk sm" href="#/raw/${esc(id)}">Raw get_bounty data, read live</a></p></div>`;
  const others = (rec.new_module_bounties ? Object.keys(rec.new_module_bounties) : []).filter((x) => x !== String(id));
  viewEl.innerHTML = `<main id="main" class="p-bounty" tabindex="-1">
<section class="ph"><div class="wrap">
<nav class="crumb" aria-label="Breadcrumb"><a href="#/bounties">Bounties</a><span aria-hidden="true">/</span><span style="color:var(--tx)" aria-current="page">Bounty ${esc(id)}</span></nav>
<div class="ph-grid">
<div style="display:flex;flex-direction:column;gap:22px">
<div style="display:flex;flex-wrap:wrap;gap:8px">${chip(st.cls, status, st.icon)}${kindChips(b, rec).map(([t, c]) => chip(c, t)).join('')}<span class="chip k-refund">Level ${esc(b.level)}</span></div>
<h1>Bounty ${esc(id)}: ${esc(title.charAt(0).toLowerCase() + title.slice(1))}</h1>
<p class="lead" style="max-width:640px">${esc(lead)}</p>
</div>
<div class="card" style="padding:24px 26px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">
<div><p class="small faint">Reward</p><b class="h3">${esc(near(b.amount).replace(' NEAR', ''))} <span style="font:500 12px/1 var(--fu);color:var(--tx3)">NEAR</span></b></div>
<div><p class="small faint">Attempts</p><b class="h3">${esc(b.max_commits)} max</b></div>
<div><p class="small faint">Window</p><b class="h3">${esc(span(b.verdict_window_ns).replace(/ hours?/, ' h').replace(/ days?/, ' d'))}</b></div>
</div>
</div>
${timeoutBox}
${recNote ? `<div style="margin-top:24px">${note(`${esc(recNote.text)} ${tx(recNote.tx)}`, 'alert')}</div>` : ''}
</div></section>
<section style="padding:0 0 112px"><div class="wrap">
<div class="main-grid" style="margin-top:0">
<div id="btabs"></div>
<aside class="aside" aria-label="Terms and checks">
<div class="card" style="padding:24px;display:flex;flex-direction:column;gap:18px">
<p class="eyebrow" style="color:var(--tx3)">Terms</p>
<dl class="kv">
${program ? `<dt>Module</dt><dd class="mono" style="font-size:13px">${esc(program)}</dd>` : ''}
<dt>Reward</dt><dd>${esc(near(b.amount))}</dd>
<dt>Attempts</dt><dd>Up to ${esc(b.max_commits)}</dd>
<dt>Verdict window</dt><dd>${esc(span(b.verdict_window_ns))}</dd>
<dt>Level</dt><dd>${b.level === 2 ? '2, the contract checks the proof' : '0, two verifiers sign'}</dd>
<dt>Vendor</dt><dd>${acct(b.vendor)}</dd>
${b.winner !== null && b.winner !== undefined && subs[b.winner] ? `<dt>Paid to</dt><dd>${acct(subs[b.winner].payout)}</dd>` : ''}
<dt>Network</dt><dd>NEAR testnet</dd>
</dl>
</div>
${check ? `<div class="card" style="padding:24px;display:flex;flex-direction:column;gap:14px">
<p class="eyebrow" style="color:var(--tx3)">Check the checker</p>
<p class="small">Rebuild it and compare with the id on chain. Expect MATCH on the last line.</p>
${cmd(`./scripts/check_image_id.sh ${CONTRACT} ${id}`)}
<p class="small faint">MATCH on ${esc(check.utc)}, on one machine.</p>
<a class="lnk" href="#/judge">Open the judge guide ${icon('right')}</a>
</div>` : ''}
<div class="card" style="padding:24px;display:flex;flex-direction:column;gap:12px">
<p class="eyebrow" style="color:var(--tx3)">Compare</p>
${String(id) === '16' ? '<p class="small">Bounty 17 used a new module with a private secret and was paid by timeout, not by a proof.</p><a class="lnk" href="#/bounties/17">Open bounty 17 ' + icon('right') + '</a>'
  : '<p class="small">Bounty 16 used the public demo module and was paid by a verified proof.</p><a class="lnk" href="#/bounties/16">Open bounty 16 ' + icon('right') + '</a>'}
${others.length ? `<p class="small">Other new module bounties: ${others.map((o) => `<a href="#/bounties/${esc(o)}">bounty ${esc(o)}</a>`).join(', ')}.</p>` : ''}
<a class="lnk" href="#/evidence/ledger">See the evidence ledger ${icon('right')}</a>
</div>
</aside>
</div>
</div></section>
</main>`;
  tabbed($('#btabs'), [
    { id: 'overview', label: 'Overview', html: overview },
    { id: 'transactions', label: `Transactions (${txs.length})`, html: transactions },
    { id: 'rules', label: 'Rules and timing', html: rules },
    { id: 'privacy', label: 'Privacy and evidence', html: privacy },
  ], tab, `#/bounties/${id}`, `Bounty ${id} sections`);
  attemptPanel($('#sendPanel'), b, subs, verifiers);
}

export async function raw(viewEl, id) {
  if (!/^\d+$/.test(id || '')) { viewEl.innerHTML = '<main id="main" class="p-gen"><section class="ph"><div class="wrap"><h1>Not found</h1></div></section></main>'; return; }
  viewEl.innerHTML = `<main id="main" class="p-gen" tabindex="-1"><section class="ph"><div class="wrap stack g16"><nav class="crumb" aria-label="Breadcrumb" style="display:flex;gap:8px"><a class="lnk sm" href="#/bounties/${esc(id)}">${icon('left')} Bounty ${esc(id)}</a></nav><h1>Bounty ${esc(id)}: raw data</h1><p class="lead" id="rawLead">Reading from testnet…</p></div></section>
    <section class="pbody"><div class="wrap" id="raw"></div></section></main>`;
  try {
    const b = await view('get_bounty', { bounty_id: String(id) }, { fresh: true });
    $('#rawLead').innerHTML = `The live result of <span class="mono txt">get_bounty {"bounty_id":"${esc(id)}"}</span> on ${esc(CONTRACT)}, read ${esc(new Date().toISOString().slice(0, 19).replace('T', ' '))} UTC. Skarbnik was built under the working name Kintsugi; the testnet contract keeps that name.`;
    $('#raw').innerHTML = `<div class="stack g16"><pre class="code">${esc(JSON.stringify(b, null, 2))}</pre><div><button class="btn btn-g btn-s" type="button" data-copy-text="${esc(JSON.stringify(b))}">${icon('copy')} Copy</button> <a class="lnk sm" href="${EXPLORER_ACCOUNT}${CONTRACT}" target="_blank" rel="noopener">The contract on the explorer ${icon('ext')}</a></div></div>`;
  } catch (e) { $('#raw').innerHTML = note(`Could not read: ${esc(e.message)}`, 'alert'); }
}
