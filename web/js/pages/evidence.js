// Evidence, in six tabs (#/evidence/<tab>; the old #/evidence/ledger and #/evidence/checker open Bounties and Proofs).
// Overview: what the page shows, the paid bounties 24, 32, 33 (paid by proof) and 17 (paid by timeout) as rows with
// their deciding transaction, the team run notes, the key numbers and the status labels. Bounties: the four examples
// in full, then every settled bounty, paid by proof or by timeout (kept apart), with its transactions,
// then the Proof Ledger read live from the chain (paid accounts, earnings, the numbers, vendors; rules in
// js/ledger-core.js, the same as ledger.json). Checker: the approved image id, the rebuild command (shown only after
// scripts/check_image_id.sh printed MATCH) and what the checker runs. Contract: the deployment read live (code hash,
// owner, fee pool, full access keys), how to verify the build yourself, the tests and refused attacks, who may call what, where every fee goes.
// Security Lab: how much repeated attempts can learn, the recorded probe run, and the guarded (real, testnet) vs
// unguarded (simulated) recording. Limits: what is not claimed, in plain words. Long tables and command lists sit in
// closed drop downs (details: they open without JavaScript, and the saved page shows them open). Nothing was removed.
// The page is drawn at once; live values say "Loading from the contract" until they arrive, and if the testnet node
// gives no answer within 4 seconds the saved snapshots are shown, labelled with their time.
import { CONTRACT, RPCS, EXPLORER_ACCOUNT, view, near, submissions, accessKeys, allBounties } from '../chain.js';
import { $, esc, icon, copyBtn, chip, tx, acct, hashCell, table, note, cmd, facts, tabbed, seg, bindSeg, collapse } from '../ui.js';
import { STATUS } from '../status.js';
import { loadAll, fromFeed, getRecorded, getMeta, getNumbers, txsOf, paidByProof } from '../data.js';
import { buildLedger } from '../ledger-core.js';
import { hex } from '../attempt.js';
import { CHECKERS } from '../config.js';

const dur = (sec) => { const m = Math.round(sec / 60), h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${m} min`; };
const kindChip = (k) => `<span class="chip k-refund">${esc(k)}</span>`;

async function codeHash() {
  for (const url of RPCS) {
    try {
      const j = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'c', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: CONTRACT } }) })).json();
      if (j.result) return j.result.code_hash;
    } catch { /* next RPC */ }
  }
  return null;
}

// All eight limits, the ones a judge needs first at the top.
const LIMITS = (live) => [
  ['alert', 'am', 'Testnet only', 'No mainnet contract exists. Every transaction on this site is a testnet transaction, and every bounty so far was set up and run by the Skarbnik team, not by outside customers.', '<span id="paidSoFar">Loading from the contract</span>'],
  ['cube', '', 'Small programs only', 'Crash bugs in small WebAssembly modules. Patch size: the checker allows up to 2,048 bytes; each bounty sets its own limit (the open bounties use 1,024), shown in feed.json and on the bounty page. A vendor needs a working fix before posting; a crash with no known fix cannot be posted.'],
  ['link', 'am', 'Level 1 depends on OutLayer', 'At Level 1 the contract does not check the proof itself: it trusts OutLayer, and its operator, running the verifier program pinned on chain (get_outlayer). OutLayer must be up and able to download the pinned file from GitHub, or still hold it in its cache, which it can drop; if no check arrives, the timeout rule applies. A check costs about 0.011 NEAR and holds about 2.8 NEAR while OutLayer works, returned after. Only Level 2 is checked by the contract itself.'],
  ['hourglass', '', 'A timeout pays whatever was revealed', 'If no verdict arrives in time, the timeout rule splits the reward among the attempts still waiting. The contract does not read the fix, so this is not a pass; under a silent vendor an honest fix may get as little as 1/K of the bounty.'],
  ['check', '', 'What is not shown yet', 'The path works on NEAR testnet and nothing wider. Not shown: an external audit (the contract had AI review passes only), outside customers, a wallet other than NEAR CLI signing a transaction, OutLayer downloading the pinned file afresh when the contract asks, and sealed hardware for OutLayer’s workers (never claimed).'],
  ['clock', '', 'Proving is slow without a GPU', 'Level 2 figures (16 fresh inputs and 32 variants, then the Groth16 step): on a laptop CPU one attempt takes about 1.5 to 2.5 hours to prove, plus the shrink step, so it can miss a 4 hour window; then the timeout rule applies. On a rented GPU the vendor’s watch took about 17 minutes from reveal to submit (bounty 32), about $0.04 of GPU a proof, with the secret in that machine’s RAM during the proof. Level 1, with the smallest check (1 and 1) and no Groth16 step: about 12 to 37 minutes per attempt on the laptop CPU (bounties 36 and 37), and about 7 to 10 seconds to prove on a rented Ada generation GPU (bounties 38 and 39).'],
  ['key', 'am', live.fullKeys === 0 ? 'No full access key' : 'Full access key kept on purpose (testnet)', live.fullKeys === 0 ? 'Read live: the contract account has no full access key, so its code cannot be replaced.' : `The testnet contract’s account keeps a full access key, so its owner can replace the code under live bounties. This is deliberate: it’s an experimental testnet contract that will keep changing. The mainnet contract (skarbnik.near) is planned without an upgrade key the owner controls alone (key removed, or upgrades behind a multisig or DAO with a delay). ${live.fullKeys === null ? 'The keys could not be read just now.' : `Read live: ${live.fullKeys} full access ${live.fullKeys === 1 ? 'key' : 'keys'}.`} To check that the code has not changed silently, compare the live code hash on the Contract tab with the last deploy in docs/EVIDENCE.md, “Contract code and every deploy”, which lists every deploy transaction.`],
  ['eye', '', 'Attempts are public and limited', 'After the reveal a patch is on chain for anyone to read. Each verdict tells a researcher at most one bit about the secret, so the attempt cap K is the leak budget; one person with many accounts can still fill a bounty’s slots.'],
];

const GH = 'https://github.com/pgreyy/skarbnik';
const kv = (rows) => `<div class="n-kv">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
const proofChip = chip('k-proof', 'Paid by proof', 'check');
// The four examples: fixed facts of settled bounties (docs/CLAIMS.md, docs/evidence/), each with its deciding transaction.
const PAID = [
  ['24', 'proof', 'Private repair: an AI agent fixed a bug it could not see; the vendor proved it on a rented GPU', '9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR', 'Proof and payment'],
  ['32', 'proof', 'Automatic vendor proving: 17 min 8 s from reveal to verdict, no one at the keyboard (public demo program)', '9B7FPyju4FpmwCLGfkzoccrTfbxdfhpn7EC1uu3UpM7y', 'Proof and payment'],
  ['33', 'proof', 'Proved inside sealed hardware (Phala TEE, Intel TDX), a team run test', 'Gg81ZZgdnjMrCFM6sZ6KuaW48e2kmKXiG2TUAp8jizmS', 'Proof and payment'],
  ['17', 'timeout', 'Timeout settlement: the proof came after the window, so the timeout rule paid. Not a PASS', 'BLcWs7dpWFaiDn5BmRzr4QVCVRn4zXn4LLUgpRx3e2mh', 'Timeout claim'],
];
const PAID_ROWS = () => `<div class="ev-paid" role="list" aria-label="Paid bounties">${PAID.map(([id, how, t, h, l]) => `<div class="ev-row" role="listitem"><a class="lid" href="#/bounties/${id}">Bounty ${id}</a>${how === 'proof' ? chip('k-proof', 'Paid by proof', 'check') : chip('k-timeout', 'Paid by timeout', 'hourglass')}<p class="small">${esc(t)}</p>${tx(h, l)}</div>`).join('')}</div>`;
const EXAMPLES = () => `<div class="n-ex3 n-ex4" style="margin-top:0">
<article class="card n-ex"><div style="display:flex;flex-wrap:wrap;gap:8px">${proofChip}</div><p class="eyebrow" style="color:var(--tx3)">Bounty 24</p><h3 class="h3">Private repair, paid by proof</h3>
<p class="body">A private secret and a new bug, a division by zero. An AI agent wrote the fix. The vendor proved it on a rented GPU, and the contract checked the proof and paid.</p>
${kv([['Reward', '0.11 NEAR'], ['Verdict after reveal', '6 h 10 min'], ['Proving', 'Rented GPU, run by hand']])}
<div class="txs">${tx('9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR', 'Proof and payment')}<a class="lnk sm" href="#/bounties/24">Bounty 24 ${icon('right')}</a></div></article>
<article class="card n-ex"><div style="display:flex;flex-wrap:wrap;gap:8px">${proofChip}${chip('k-test', 'Public demo program', 'flask')}</div><p class="eyebrow" style="color:var(--tx3)">Bounty 32</p><h3 class="h3">Automatic vendor proving</h3>
<p class="body">The vendor tool watched the bounty, proved the revealed patch and sent the proof with no one at the keyboard. The program is the public demo. The secret was private, made on the vendor’s server.</p>
${kv([['Reveal to verdict', '17 min 8 s'], ['Proving', 'Automatic, skarbnik-vendor watch']])}
<div class="txs">${tx('9B7FPyju4FpmwCLGfkzoccrTfbxdfhpn7EC1uu3UpM7y', 'Proof and payment')}<a class="lnk sm" href="#/bounties/32">Bounty 32 ${icon('right')}</a></div></article>
<article class="card n-ex"><div style="display:flex;flex-wrap:wrap;gap:8px">${chip('k-timeout', 'Paid by timeout', 'hourglass')}</div><p class="eyebrow" style="color:var(--tx3)">Bounty 17</p><h3 class="h3">Timeout settlement, not a PASS</h3>
<p class="body">The vendor’s proof finished after the 4 hour window, so the contract paid by the timeout rule. No proof was checked. This is not a proven pass.</p>
${kv([['What it shows', 'The timeout rule works'], ['Proof checked', 'No']])}
<div class="txs">${tx('BLcWs7dpWFaiDn5BmRzr4QVCVRn4zXn4LLUgpRx3e2mh', 'Timeout claim')}<a class="lnk sm" href="#/bounties/17">Bounty 17 ${icon('right')}</a></div></article>
<article class="card n-ex"><div style="display:flex;flex-wrap:wrap;gap:8px">${proofChip}${chip('k-test', 'Team run test', 'flask')}</div><p class="eyebrow" style="color:var(--tx3)">Bounty 33</p><h3 class="h3">Proved inside sealed hardware (Phala TEE, Intel TDX)</h3>
<p class="body">The prove step of one attempt ran inside a confidential VM on Phala Cloud that held the secret in memory only. The receipt came out, the VM was deleted, and the contract checked the Groth16 proof and paid. One test of the planned managed proving, not a service yet.</p>
${kv([['Reveal to payout', '2 h 10 min'], ['Sealed compute', 'About $0.84'], ['Proving', 'Intel TDX confidential VM, CPU']])}
<div class="txs">${tx('Gg81ZZgdnjMrCFM6sZ6KuaW48e2kmKXiG2TUAp8jizmS', 'Proof and payment')}<a class="lnk sm" href="${GH}/tree/main/docs/evidence/tee_spike" target="_blank" rel="noopener">docs/evidence/tee_spike/ ${icon('ext')}</a><a class="lnk sm" href="${GH}/blob/main/docs/CONFIDENTIAL_PROVING.md" target="_blank" rel="noopener">docs/CONFIDENTIAL_PROVING.md ${icon('ext')}</a></div></article>
</div>`;

const VOCAB = ['Proof verified', 'Verified by OutLayer', 'Proof rejected', 'Failed by OutLayer', 'Awaiting evaluation', 'Timeout settlement', 'Refunded', 'Failed', 'Demo or test only', 'Open for attempts', 'Waiting for Proof 0'];

export async function evidence(viewEl, tab) {
  const t0 = { ledger: 'bounties', checker: 'proofs' }[tab] || tab;
  viewEl.innerHTML = `<main id="main" class="p-evidence" tabindex="-1">
<section class="n-ph"><div class="wrap">
<div style="max-width:820px;display:flex;flex-direction:column;gap:24px">
<p class="eyebrow">Proof &amp; evidence</p>
<h1>Read the real examples first. Then check the record.</h1>
<p class="lead">Every claim here points to a transaction, a file or a command. Where something is not proven, the label says so. The examples show the outcomes a bounty can have.</p>
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center"><a class="btn btn-p" href="#/judge">Take the judge tour ${icon('right')}</a><a class="lnk" href="#/evidence/bounties" id="deeperLink">Go to the technical record</a><a class="lnk" href="#/evidence/limits">Read the limits</a></div>
</div></div></section>
<section style="padding:0 0 112px"><div class="wrap"><div id="liveNote" aria-live="polite"></div><div id="etabs"></div></div></section></main>`;
  const overview = `<div class="stack g28">
    <div style="max-width:720px" class="stack g12"><h2 class="h2s" id="deeper">What this page shows</h2><p class="body">The path works on NEAR testnet: bounties were paid by a proof the contract checked, and one was paid by the timeout rule, labelled as such. Each row links to the transaction that decided it.</p></div>
    ${PAID_ROWS()}
    <p class="small" id="ctSum">Reading the contract…</p>
    <div class="nums" role="list" aria-label="Key numbers" id="nums"></div>
    ${collapse('vocab', 'What the status labels mean', `<p class="body" style="max-width:640px">Mint is used only for a verified outcome, and always with a word and an icon. A timeout is never styled like a proof. The last two labels are the feed’s states for bounties that are not settled.</p>
    <div class="vocab" style="margin-top:20px">${VOCAB.map((st) => `<div class="card vc">${chip(STATUS[st].cls, st, STATUS[st].icon)}<p class="small">${esc(STATUS[st].help)}</p></div>`).join('')}
    <div class="card vc"><p class="eyebrow" style="color:var(--tx3)">Labels for claims</p><div style="display:flex;flex-wrap:wrap;gap:6px"><span class="chip l-impl">Implemented</span><span class="chip l-demo">Demonstrated</span><span class="chip l-exp">Experimental</span><span class="chip l-plan">Planned</span></div><p class="small">Used in the judge guide. No audit badge is shown, because there is no audit.</p></div></div>`)}
  </div>`;

  let rec, meta, nums;
  try { [rec, meta, nums] = await Promise.all([getRecorded(), getMeta(), getNumbers()]); } catch (e) {
    if ($('#etabs')) $('#etabs').innerHTML = note(`Could not load the site's data: ${esc(e.message)}. Reload to try again.`, 'alert'); return;
  }
  if (!$('#etabs')) return;
  // The page is drawn at once from the site's own files. Live values are read from the contract afterwards and fill
  // in when they arrive; until then each says so. If the node has not answered within 4 seconds (tried twice), the saved
  // snapshots (feed.json, ledger.json) are shown instead, with one calm line giving the time they were made; a warning
  // appears only if the saved snapshots could not be loaded either. The node counts as answering once the
  // bounty list arrives; the full read of every attempt then takes a few seconds more (3 to 8 s measured), up to 30 s.
  const LOADING = 'Loading from the contract';
  const within = (p, ms, why) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(why)), ms))]);
  // One live read: the node must give its first answer (the bounty list) within 4 s, then the full read within 30 s.
  // load() is caught here too: when the node never answered, its later failure is expected, not an error to report.
  const tryLive = (load) => {
    const answered = within(allBounties(), 4000, 'the testnet node did not answer within 4 seconds'); answered.catch(() => {});
    const p = load(); p.catch(() => {});
    return answered.then(() => within(p, 30000, 'the full read took longer than 30 seconds'));
  };
  // the live read is tried twice before the page falls back to the saved record
  const full = (load) => tryLive(load).catch(() => tryLive(load));
  const savedAt = (at) => `${String(at).replace('T', ' ').replace(/:\d\dZ$/, '').replace(/Z$/, '')} UTC`;
  const andList = (ids) => (ids.length > 1 ? `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}` : String(ids[0]));
  let all = null, snapshot = null, settled = [], nProof = 0, nOl = 0, nTime = 0;
  const liveP = full(() => loadAll(true)).then((l) => { all = l; }, async (e) => { const f = await fromFeed(); all = f.list; snapshot = { at: f.at, err: e.message }; });

  // the bounties paid by a checked proof, read live from the contract (the ledger decides the list)
  const paidText = full(() => paidByProof()).then((ids) => (ids.length ? `Paid by proof so far, read live from the contract: bounties ${andList(ids)}.` : 'No bounty has been paid by proof yet.'),
    async () => { const f = await fromFeed(); const ids = f.list.filter((x) => x.status === 'Proof verified').map((x) => x.b.id); return `From the saved record of ${savedAt(f.at)}: paid by proof, bounties ${andList(ids)}.`; })
    .catch(() => 'The list of bounties paid by proof could not be read just now; the ledger has it.');
  const showPaid = () => paidText.then((t) => { const el = $('#paidSoFar'); if (el) el.textContent = t; });
  const attacks = (rec.attacks_s6c || []).filter((a) => /refused/.test(a.result)).length;
  const drawNums = () => { const el = $('#nums'); if (!el) return; el.innerHTML = [[all ? `${nProof}` : LOADING, 'Paid by a verified proof', !all], [all ? `${nTime}` : LOADING, 'Paid by timeout, never called proven', !all], [`${nums.contract_unit_tests.value}`, 'Contract unit tests passed'], [`${attacks}`, 'Proof attacks refused on chain'], [`${nums.accepted_proof_tgas.value}<small>Tgas</small>`, `About, per accepted proof (${nums.accepted_proof_tgas.range})`]]
    .map(([v, t, ld]) => `<div role="listitem"><b${ld ? ' class="ld"' : ''}>${v}</b><span>${esc(t)}</span></div>`).join(''); };
  const ctLine = () => `The contract on NEAR testnet: <a class="tx" href="${EXPLORER_ACCOUNT}${CONTRACT}" target="_blank" rel="noopener">${esc(CONTRACT)} ${icon('ext')}</a>. ${all ? `One approved checker id, ${all.length} bounties${snapshot ? ` (saved ${esc(savedAt(snapshot.at))})` : ''}, and no mainnet contract.` : `${LOADING}.`} Read it on the explorer, not on this page.`;

  // ---- Ledger: the settled bounties (filled in when the live values arrive), then the Proof Ledger
  const chips = (id, how) => {
    const list = [['commit', 'Commit'], ['reveal', 'Reveal']].flatMap(([m, l]) => txsOf(rec, id, m).slice(0, 2).map((t) => [t.tx, l]));
    const end = how === 'proof' ? txsOf(rec, id, 'submit_groth16').map((t) => [t.tx, 'Proof'])
      : how === 'outlayer' ? txsOf(rec, id, 'check_with_outlayer').map((t) => [t.tx, 'OutLayer check']) : txsOf(rec, id, 'claim_timeout').map((t) => [t.tx, 'Claim']);
    return [...list, ...end].map(([t, l]) => tx(t, l)).join('');
  };
  const ledgerRows = (f) => settled.filter((x) => f === 'all' || x.status === f).map((x) => {
    const id = String(x.b.id), st = STATUS[x.status], n8 = rec.bounty_notes && rec.bounty_notes[id];
    return `<div class="lrow" role="listitem"><div><a class="lid" style="color:var(--tx);text-decoration:none" href="#/bounties/${esc(id)}">#${esc(id)}</a><p class="small" style="margin-top:4px">${esc((meta.titles || {})[id] || '')}</p></div>
      <div>${chip(st.cls, x.status, st.icon)}${n8 && n8.transfer_failed ? `<div class="mt8">${chip('k-fail', 'Paid on paper, transfer failed', 'x')}</div>` : ''}</div>
      <div class="txs">${chips(id, x.status === 'Proof verified' ? 'proof' : x.status === 'Verified by OutLayer' ? 'outlayer' : 'timeout') || '<span class="small faint">no transactions recorded</span>'}</div>
      <p class="small">${esc(n8 ? n8.text : (meta.notes || {})[id] || '')}</p></div>`;
  }).join('');
  let lf = 'all';
  const ledgerTop = () => `<div style="display:flex;flex-wrap:wrap;gap:20px;justify-content:space-between;align-items:end">
    <div style="max-width:640px"><h2 class="h2s">The settlement ledger</h2><p class="body" style="margin-top:12px">Every paid bounty on the contract, with the transactions that show how it was decided. Paid by proof, paid on OutLayer’s answer (Level 1) and paid by timeout are kept apart on purpose.</p></div>
    ${seg([['all', 'All', settled.length], ['Proof verified', 'Proof verified', nProof], ...(nOl ? [['Verified by OutLayer', 'Verified by OutLayer', nOl]] : []), ['Timeout settlement', 'Timeout settlement', nTime]].map(([id, l, c]) => ({ id, label: `${esc(l)} <span style="color:var(--tx3)">${c}</span>` })), lf, 'Filter the ledger', 'data-lf')}</div>
    <div class="blist" role="list" aria-label="Ledger" id="lrows"><div class="lhead" aria-hidden="true"><span>Bounty</span><span>Settlement</span><span>Transactions</span><span>Note</span></div>${ledgerRows(lf)}</div>
    ${note('Bounty 17 is paid by timeout, not by a proof. Its evidence proof says PASS, but it finished after the window and was never submitted.')}`;
  const exampleList = [['24', 'Bounty 24: private repair, paid by proof'], ['32', 'Bounty 32: automatic vendor proving, paid by proof'], ['17', 'Bounty 17: timeout settlement, not a PASS'], ['33', 'Bounty 33: proved inside sealed hardware, paid by proof']];
  const exArticles = EXAMPLES().split('<article ').slice(1).map((a) => `<article ${a.replace(/<\/div>\s*$/, '')}`);
  const ledger = `<div class="stack g16"><div style="max-width:700px"><h2 class="h2s">The four examples</h2><p class="body" style="margin-top:12px">The outcomes a bounty can have, each with its deciding transaction.</p></div>
    ${exampleList.map(([id, t], i) => collapse(`ex${id}`, esc(t), `<div class="ev-ex">${exArticles[i]}</div>`)).join('')}</div>
    <div class="stack g28 mt48">${collapse('ledgerAll', 'The settlement ledger: <span id="ledgerN">every settled bounty</span>, every transaction', `<div class="stack g28" id="ledgerTop"><p class="state">${LOADING}</p></div>`)}</div>
    <div class="stack g24 mt48" id="proofLedger"><p class="state">${LOADING}</p></div>`;

  // ---- Checker
  const check = rec.last_image_check && rec.last_image_check.result === 'MATCH' ? rec.last_image_check : null;
  const checker = `<div class="stack g24">
    <div style="max-width:700px"><h2 class="h2s">The approved checkers</h2><p class="body" style="margin-top:12px">A proof counts only for an approved checker program. There are two: one for crashes, and one for wrong answers and memory safety bugs. Each fingerprint, the image id, is on the contract’s allowlist, and anyone can rebuild both and compare.</p></div>
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:18px">
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center"><p class="eyebrow" style="color:var(--tx3)">Crash checker</p>${check ? chip('l-demo', `MATCH on rebuild, ${check.utc.slice(0, 10)}`, 'check') : ''}</div>
    <div class="cblk"><p class="imgid">${esc(CHECKERS.crash)}</p>${copyBtn(CHECKERS.crash)}</div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">${tx(nums.allowlist_tx.tx, 'allowlisted in')}</div>
    <p class="eyebrow" style="color:var(--tx3);margin-top:8px">Output checker: wrong output and memory safety</p>
    <div class="cblk"><p class="imgid">${esc(CHECKERS.output)}</p>${copyBtn(CHECKERS.output)}</div>
    ${rec.output_checker && rec.output_checker.allow_tx ? `<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">${tx(rec.output_checker.allow_tx, 'allowlisted in')}</div>` : ''}
    <p class="small">It passes a fix that returns the right answer on the secret input and the same answers as the vendor’s hidden reference fix on random inputs, near copies of the secret and every value of up to 4 private byte positions. It judges answers; it does not detect memory corruption in general.</p>
    <p class="small" id="allowLine">${LOADING}</p>
    ${Object.keys(rec.retired_checkers || {}).map((r) => `<p class="small faint">Retired: <span class="mono">${esc(r.slice(0, 16))}…</span> ${esc(rec.retired_checkers[r])}</p>`).join('')}
    </div>
    <div class="two">
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:16px">
    <h3 class="h3">Rebuild it yourself</h3>
    ${check ? `<p class="small">Level B of the judge guide. It builds both checkers in a pinned container and compares both ids.</p>${cmd('./scripts/check_image_id.sh')}
    <p class="small">The last line should read <b class="txt">MATCH</b>. It took ${esc(nums.image_rebuild.cached)} with the Docker images cached, and ${esc(nums.image_rebuild.fresh)} with the ${esc(nums.image_rebuild.download)} image download. Needs Docker.</p>
    <p class="small faint">Shown on one machine so far (${esc(check.source)}).</p>` : '<p class="small">The rebuild command is shown here once scripts/check_image_id.sh has printed MATCH.</p>'}
    </div>
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:14px">
    <h3 class="h3">What a match establishes</h3>
    <p class="small"><b class="txt">It does.</b> The id on chain is the id of the public checker source, built the reproducible way.</p>
    <p class="small"><b class="txt">It does not.</b> It does not show that the checker is complete, or that a passing fix is secure against everything. A proof says one patch passed or failed this defined check.</p>
    </div></div>
    <div class="sub"><h3 class="h3">What the checker runs on every patch</h3>
    <div class="card" style="padding:8px 28px;margin-top:24px"><div class="steps">
    ${[['Validate the module', 'No imports, at most 2 memory pages, checked exports. The checker allows up to 2,048 bytes; each bounty sets its own limit (the open bounties use 1,024), shown in feed.json and on the bounty page.'], ['Run the secret input', 'It must not crash or run out of fuel, 50,000 units per input, in a fresh interpreter each time.'], ['Run the public tests', 'Every answer must match the original program’s.'], ['Run fairness inputs', 'Drawn from the reveal seed, so a patch cannot be tailored to them. They must match the original.'], ['Run crash variants', 'One or two byte changes of the secret must not crash where the original crashes.']]
      .map(([h, p], i) => `<div class="st"><span class="n">${i + 1}</span><div><b class="h4">${esc(h)}</b><p class="small" style="margin-top:4px">${esc(p)}</p></div></div>`).join('')}
    </div></div></div>
    ${collapse('checkRepo', 'Check it from the repository: five commands', `<p class="small">Commands run from the root of the Skarbnik repository.</p>
    <div class="card pad24 stack g16 mt16">
      <div><b class="h4">Read a bounty from the chain</b><div class="mt8">${cmd(`near contract call-function as-read-only ${CONTRACT} get_bounty json-args '{"bounty_id":"12"}' network-config testnet now`)}</div><p class="small mt8">Or open its <a href="#/raw/12">raw data</a>.</p></div>
      <div><b class="h4">A real proof is accepted</b><div class="mt8">${cmd('cargo test -p kintsugi-contract --offline level2_opens_with_the_real_proof0')}</div><p class="small mt8">On testnet: ${tx(rec.valid_proof_accepted.tx)}, a PASS proof for bounty 1, accepted and paid.</p></div>
      <div><b class="h4">A proof for the wrong bounty is refused</b><div class="mt8">${cmd('cargo test -p kintsugi-contract --offline s1_the_same_proof_is_refused_on_another_bounty')}</div><p class="small mt8">On testnet: ${tx(rec.wrong_bounty_refused.tx)}, refused by the contract.</p></div>
      <div><b class="h4">Run every contract test</b><div class="mt8">${cmd('cargo test -p kintsugi-contract --offline')}</div><p class="small mt8">${esc(nums.contract_unit_tests.detail)}</p></div>
      <div><b class="h4">Read the findings of the AI review passes</b><p class="small mt8">docs/AUDIT.md (every finding, fix and known limit) and docs/SECURITY.md (guards and known limits).</p></div>
    </div>`)}</div>`;

  // ---- Contract
  const contract = `<div class="stack g24">
    <div style="max-width:700px"><h2 class="h2s">The contract</h2><p class="body" style="margin-top:12px">It holds the money and the deadlines, checks Groth16 proofs with NEAR’s built in curve functions, and applies the rules. It does not run the private evaluation.</p></div>
    <div class="two">
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:18px"><h3 class="h3">Deployment, read live</h3><div id="deploy"><p class="small">${LOADING}</p></div></div>
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:16px"><h3 class="h3">Tests and refused attacks</h3>
    <p class="small"><b class="txt">${esc(nums.contract_unit_tests.value)}</b> contract unit tests pass in the repository. ${esc(nums.contract_unit_tests.detail)}</p>
    <p class="small"><b class="txt">${attacks}</b> proof attacks were refused on chain: ${esc((rec.attacks_s6c || []).map((a) => a.what.charAt(0).toLowerCase() + a.what.slice(1)).join(', '))}.</p>
    <p class="small">A proof for the wrong bounty fails cheaply, at ${esc(nums.wrong_bounty_tgas.value)} Tgas. ${tx(rec.wrong_bounty_refused.tx)}</p>
    ${note('These are AI review passes and tests. There is no external security audit.', 'shield')}</div></div>
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:16px"><div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center"><h3 class="h3">Contract build and source</h3><span class="chip l-demo">${icon('check')} Reproducible build</span></div>
    <p class="small">The contract is built reproducibly from the public source, so its code hash can be rebuilt and compared. The code hash on chain is the base58 form of the wasm’s sha256.</p>
    ${facts([['Source', `<a class="lnk sm" href="${GH}/tree/c86db11bd2c7ac461c4d915b6fd8e125eeb31b9e" target="_blank" rel="noopener">github.com/pgreyy/skarbnik, commit c86db11 ${icon('ext')}</a>`], ['Code hash', '<span class="mono txt" style="overflow-wrap:anywhere">7fgVdHPVUZRzSYg4FRE4exfZb36aKH7znEtMCn87PuRC</span> (compare with the one read live above)'], ['Deploy', tx(nums.last_deploy.tx)]])}
    ${collapse('verifyContract', 'Verify the contract yourself', `<p class="small">1. Get the source at the deployed commit. 2. Build it with the reproducible build (Docker and cargo-near 0.22.0; the build image is pinned in contract/Cargo.toml). 3. Hash the wasm and compare with the code hash NEAR shows for ${esc(CONTRACT)}. From a clone of the repository:</p>
    <div class="stack g8">${cmd('git checkout c86db11bd2c7ac461c4d915b6fd8e125eeb31b9e')}${cmd('(cd contract && cargo near build reproducible-wasm)')}${cmd('sha256sum target/near/kintsugi_contract/kintsugi_contract.wasm')}${cmd(`python3 -c "import hashlib,sys; A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; n=int.from_bytes(hashlib.sha256(open(sys.argv[1],'rb').read()).digest(),'big'); print(''.join(reversed([A[(n//58**i)%58] for i in range(50) if n//58**i])))" target/near/kintsugi_contract/kintsugi_contract.wasm`)}${cmd(`curl -s https://test.rpc.fastnear.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"${CONTRACT}"}}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["code_hash"])'`)}</div>
    <p class="small">Expect <span class="mono txt">630ed90923bda105cfe2f50c4ded6191808425f6710aa773210a7bb6063150bb</span> from sha256sum, and <span class="mono txt">7fgVdHPVUZRzSYg4FRE4exfZb36aKH7znEtMCn87PuRC</span> from the last two lines. Our two builds gave the same hash. docs/TRY_IT.md, step 11; docs/EVIDENCE.md, “Contract code and every deploy”.</p>`)}</div>
    <div id="keyNote"></div>
    ${collapse('attacks', `Refused attacks on testnet: ${attacks} refused`, `<div>${table(['What was tried', 'Result', 'Transaction'], (rec.attacks_s6c || []).map((a) => [esc(a.what), /refused/.test(a.result) ? chip('k-reject', 'Refused', 'x') : chip('k-refund', esc(a.result)), tx(a.tx)]), 'mid', 'Refused attacks')}</div><p class="small faint mt8">Recorded in docs/evidence/S6c/transactions.tsv.</p>`)}
    ${collapse('callers', 'Who may call what', `<div>${table(['Method', 'Caller', 'Rule'], [
      ['create_bounty', 'Anyone except a verifier', 'At least 0.1 NEAR, K from 1 to 16, checker id on the allowlist'], ['open_with_groth16', 'Anyone', 'Checks Proof 0 on chain, then opens the bounty'],
      ['commit', 'Anyone except the vendor', 'Fee taken from prepaid credit. Ignored when the slots are full'], ['reveal', 'The committer', 'After the gap, inside the window. Records the block seed'],
      ['submit_groth16', 'Anyone', 'PASS pays and closes. FAIL spends the attempt. A late proof is refused'], ['claim_timeout', 'Anyone, after the deadline', 'Splits equally among revealed attempts still undecided'],
      ['expire', 'Anyone, after expiry', 'Refunds an unpaid bounty to the vendor'], ['withdraw_credit', 'The account, 1 yoctoNEAR', 'A limited agent key cannot call it'],
      ['set_agent_limits', 'The account, 1 yoctoNEAR', 'Caps the fee per commit and fixes the payout account'], ['allow_image_id', 'Owner', 'Adds a checker id. There is no removal'],
    ].map(([m, c, r]) => [`<span class="mono txt">${esc(m)}</span>`, esc(c), esc(r)]), 'wide', 'Who may call what')}</div>`)}
    ${collapse('fees', 'Where every fee goes', `<p class="small">An attempt fee is taken from your credit in the contract when your commit is counted. It never goes to the vendor.</p><div class="mt16">${table(['How the attempt ends', 'Where its fee goes', 'When'], [
      ['Never revealed in time', 'Protocol fee pool', 'When anyone calls release_unrevealed after the reveal window, or at expire'],
      ['Wins with a PASS proof', 'Back to the winner, with the bounty', 'Same transaction'],
      ['Paid by the timeout rule', 'Back to each account that shares the payout, with its share', 'Same transaction'],
      ['Revealed and still waiting when another attempt wins', 'Back to the committer as credit', 'Same transaction'],
      ['Decided FAIL', 'Level 2 bounties: the protocol fee pool. Level 0: equal shares to the registered verifiers', 'When anyone calls expire after the bounty’s expiry'],
    ].map((r) => r.map(esc)), 'wide', 'Where every fee goes')}</div><p class="small mt12">The protocol fee pool cannot be withdrawn: no method takes NEAR out of it. Unspent credit is always yours: withdraw_credit returns it (it needs 1 yoctoNEAR, so only your full key can call it, never an agent’s limited key). docs/SECURITY.md, “Where every fee goes”.</p>`)}
    ${collapse('levels', 'Levels: what you trust', `<div>${table(['Level', 'Who checks the proof', 'You trust'], [['<span class="mono txt">L0</span>', 'Two registered verifiers sign the same verdict', 'Those two verifiers'], ['<span class="mono txt">L2</span>', 'The contract checks a Groth16 proof of the RISC Zero result itself', 'The maths, a one time setup by RISC Zero, and the published checker (its image id)']], 'mid', 'Levels')}</div>`)}
    ${collapse('creditRead', 'Credit and agent limits, read only', `<div class="stack g12">${cmd(`near contract call-function as-read-only ${CONTRACT} get_credit json-args '{"account_id":"<account>"}' network-config testnet now`)}${cmd(`near contract call-function as-read-only ${CONTRACT} get_agent_limits json-args '{"account_id":"<account>"}' network-config testnet now`)}</div>`)}
    </div>`;

  // ---- Security Lab
  const ar = rec.arena, A = ar.attempts, K = A[0].budget, bitsTotal = Math.log2(ar.secret_space);
  const lab = `<div class="stack g24">
    <div style="max-width:700px"><div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px"><span class="chip l-demo">Demonstrated</span>${chip('k-test', 'Recorded, replayed here', 'flask')}</div><h2 class="h2s">Security Lab: how much can probing learn?</h2><p class="body" style="margin-top:12px">One verdict leaks at most one bit about the secret, so the attempt limit K is the leak budget. A probe agent tried to learn a ${Number(ar.secret_space).toLocaleString('en-US')} value secret one bit at a time. Step through what was recorded.</p><p class="small" style="margin-top:12px"><b class="txt">What this lab covers:</b> one attack only, learning the secret through many yes or no attempts. It does not cover other attacks: forged and replayed proofs are on the <a href="#/evidence/contract">Contract tab</a>, and timing and other side channels are not measured (<a href="#/evidence/limits">Limits</a>).</p></div>
    <div class="two" style="align-items:stretch">
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:22px">
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center"><p class="eyebrow" style="color:var(--tx3)">K = ${K} attempts</p><div style="display:flex;gap:10px"><button class="btn btn-p btn-s" type="button" id="probeNext">Run first probe</button><button class="btn btn-g btn-s" type="button" id="probeReset">${icon('replay')} Reset</button></div></div>
    <div class="slots" aria-label="Attempt slots" id="slots"></div>
    <div aria-live="polite"><p class="body txt" id="probeText"></p></div>
    </div>
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:20px">
    <div><p class="small faint">Bits learned</p><b class="big"><span id="bits">0</span> <span style="font:500 16px/1 var(--fu);color:var(--tx3)">of ${bitsTotal}</span></b></div>
    <div class="meter" role="img" id="meter" aria-label="0 of ${bitsTotal} bits learned"><i style="width:0%"></i></div>
    <div><p class="small faint">Candidates left for the secret</p><b class="big" id="left">${Number(ar.secret_space).toLocaleString('en-US')}</b></div>
    <p class="small faint">A ${Number(ar.secret_space).toLocaleString('en-US')} value secret holds ${bitsTotal} bits. ${K} attempts reveal at most ${K}, which leaves ${(ar.secret_space / 2 ** K).toLocaleString('en-US')} candidates. Verdicts came from ${esc(ar.verdicts_from)}.</p>
    <div style="margin-top:auto">${tx((ar.chain.steps.find((s) => /ignored|fourth|4/i.test(s.what)) || ar.chain.steps[ar.chain.steps.length - 1]).tx)}<p class="small faint" style="margin-top:8px">The recorded run on an earlier testnet contract (${esc(ar.chain.contract)}), where the commit after the cap was ignored.</p></div>
    </div></div>
    <div id="gu" class="sub"><p class="small">Reading the guarded and unguarded runs…</p></div>
    ${collapse('variantsOn', 'Crash variant check on', `<p class="small">With the check of ${esc(ar.control_variants)} variants of the secret input switched on, the same probes all FAIL whatever the secret, so the probe agent learns 0 bits.</p><div class="mt16">${table(['Probe', 'Verdict'], ar.control_variant_check_on.map((c) => [`<span class="mono">${esc(c.probe)}</span>`, c.verdict === 'PASS' ? chip('k-proof', 'PASS', 'check') : chip('k-fail', 'FAIL', 'x')]), '', 'Control')}</div>`)}
    ${collapse('capChain', 'The same cap on testnet', `<div>${table(['What happened', 'Result', 'Transaction', 'Time'], ar.chain.steps.map((t) => [esc(t.what), /refused/.test(t.result) ? chip('k-reject', 'Refused', 'x') : chip('k-refund', 'Succeeded', 'check'), tx(t.tx), t.time ? esc(t.time) : '<span class="faint">not recorded</span>']), 'wide', 'On testnet')}</div><p class="small faint mt8">Recorded in ${esc(ar.chain.source)} and ${esc(ar.source)}.</p>`)}
    </div>`;

  // ---- Limits
  const limits = `<div class="stack g32"><div style="max-width:700px"><h2 class="h2s">Known limitations, in plain words</h2><p class="body" style="margin-top:12px">These are the points a skeptical reader should check first. None of them is hidden elsewhere.</p></div><div class="lim" id="limList"></div></div>`;
  const limCard = ([i, c, t, d, live2]) => `<div class="card"><span class="ic ${c}">${icon(i)}</span><div><h3 class="h4">${esc(t)}</h3><p class="small" style="margin-top:6px">${esc(d)}${live2 ? ` ${live2}` : ''}</p></div></div>`;
  const drawLimits = (live) => {
    const el = $('#limList');
    if (el) el.innerHTML = LIMITS(live).map(limCard).join('');
    showPaid();
  };

  const ids = { overview: 'Overview', bounties: 'Bounties', proofs: 'Proofs', contract: 'Contract', lab: 'Lab', limits: 'Limits' };
  const html = { overview, bounties: ledger, proofs: checker, contract, lab, limits };
  tabbed($('#etabs'), Object.keys(ids).map((id) => ({ id, label: ids[id], html: html[id] })), t0, '#/evidence', 'Evidence sections', () => {}, true);
  if (tab && t0 !== tab) history.replaceState(null, '', `#/evidence/${t0}`); // an old tab link (ledger, checker) shows its new address
  drawNums();
  $('#ctSum').innerHTML = ctLine();
  showPaid();
  // ledger filter
  const bindLedger = () => bindSeg($('#ledgerTop'), 'data-lf', (f) => { lf = f; $('#lrows').innerHTML = '<div class="lhead" aria-hidden="true"><span>Bounty</span><span>Settlement</span><span>Transactions</span><span>Note</span></div>' + ledgerRows(lf); });
  // security lab stepper
  let probe = 0;
  const T = [`No probes yet. The probe agent knows nothing beyond the size of the secret, ${Number(ar.secret_space).toLocaleString('en-US')} values.`,
    ...A.map((a, i) => `Verdict ${i + 1}: ${a.verdict}. ${a.bits_learned} ${a.bits_learned === 1 ? 'bit' : 'bits'} learned, ${a.candidates_left.toLocaleString('en-US')} candidates left.${i === A.length - 1 ? ` That is the whole leak budget for K = ${K}.` : ''}`),
    'The contract ignored the next commit. It returned nothing and charged nothing.'];
  const drawProbe = () => {
    const bits = probe === 0 ? 0 : A[Math.min(probe, A.length) - 1].bits_learned;
    $('#slots').innerHTML = [...A.map((a, i) => (i < probe ? `<div class="slot used"><span class="eyebrow" style="color:inherit;font-size:11px">Attempt ${i + 1}</span><b class="h4" style="color:inherit">${esc(a.verdict)}: learned 1 bit</b><span class="small" style="color:inherit">One verdict, one bit</span></div>` : `<div class="slot"><span class="eyebrow" style="color:inherit;font-size:11px">Attempt ${i + 1}</span><b class="h4" style="color:inherit">Unused</b><span class="small" style="color:inherit">Slot is free</span></div>`)),
      probe > A.length ? '<div class="slot ign"><span class="eyebrow" style="color:inherit;font-size:11px">Next commit</span><b class="h4" style="color:inherit">Ignored</b><span class="small" style="color:inherit">Slots are full. Costs nothing</span></div>' : `<div class="slot"><span class="eyebrow" style="color:inherit;font-size:11px">Next commit</span><b class="h4" style="color:inherit">Not tried</b><span class="small" style="color:inherit">K = ${K} allows ${K}</span></div>`].join('');
    $('#probeText').textContent = T[probe];
    $('#bits').textContent = String(bits);
    $('#meter').setAttribute('aria-label', `${bits} of ${bitsTotal} bits learned`); $('#meter').firstElementChild.style.width = `${(bits / bitsTotal) * 100}%`;
    $('#left').textContent = (probe === 0 ? ar.secret_space : A[Math.min(probe, A.length) - 1].candidates_left).toLocaleString('en-US');
    const nb = $('#probeNext'); nb.disabled = probe > A.length; nb.textContent = probe === 0 ? 'Run first probe' : probe < A.length ? 'Run next probe' : probe === A.length ? 'Try one more commit' : 'Done';
  };
  $('#probeNext').addEventListener('click', () => { probe = Math.min(A.length + 1, probe + 1); drawProbe(); });
  $('#probeReset').addEventListener('click', () => { probe = 0; drawProbe(); });
  drawProbe();

  // live parts, read after the page is shown
  (async () => {
    let gu = null; try { gu = await (await fetch('data/arena_probe.json')).json(); } catch { gu = null; }
    const el = $('#gu'); if (!el) return;
    if (!gu) { el.innerHTML = note('The guarded and unguarded runs are not recorded yet.'); return; }
    const pct = (x) => `${Math.round(x * 100)}%`, bar = (x) => `<span class="sharebar" role="img" aria-label="${pct(x)} of the secret"><i style="width:${Math.round(x * 100)}%"></i></span>`;
    const g = gu.guarded, u = gu.unguarded, bid = (g.where.match(/bounty (\d+)/) || [])[1];
    el.innerHTML = `<h3 class="h3">Guarded vs unguarded</h3><p class="body" style="margin-top:12px;max-width:760px">The same probe agent asks one yes or no question per attempt about one bit of a ${esc(gu.secret_bits)} bit secret. Without a cap it learns the whole secret; on the contract the cap stops it after ${esc(g.attempts_counted)} counted attempts, so it can learn at most ${esc(g.bits_at_most)} of ${esc(gu.secret_bits)} bits.</p>
      <div class="two mt24">
      <div class="card pad28 stack g16"><div class="row" style="justify-content:space-between"><b class="h4">Guarded</b><span class="chip l-demo">Real, testnet</span></div>${table(['Measure', 'Value'], [['Attempts sent', `<span class="mono">${esc(g.attempts_sent)}</span>`], ['Attempts counted', `<span class="mono">${esc(g.attempts_counted)}</span><span class="small">cap K = ${esc(g.cap_K)}; the rest ignored at no cost</span>`], ['NEAR spent', `<span class="mono">${esc(g.fees_near)} NEAR in fees + ${esc(Number(g.gas_near).toFixed(4))} NEAR gas</span>`], ['Bits learned', `<span class="mono">at most ${esc(g.bits_at_most)}</span><span class="small">0 in this run: the probes were not revealed, so no verdict was asked for</span>`], ['Share of the secret exposed', `${bar(g.share_exposed_at_most)}<span class="mono">at most ${pct(g.share_exposed_at_most)}</span>`]], '', 'Guarded run')}
        <p class="small">${bid ? `<a href="#/bounties/${esc(bid)}">${esc(g.where)}</a>` : esc(g.where)}, probe account ${acct(g.account)}, ${esc(g.account_kind)} by the project. First commit ${tx(g.txs[0])}, first ignored commit ${tx(g.txs[g.attempts_counted])}.</p></div>
      <div class="card pad28 stack g16"><div class="row" style="justify-content:space-between"><b class="h4">Unguarded</b>${chip('k-test', 'Simulated, this machine', 'flask')}</div>${table(['Measure', 'Value'], [['Attempts sent', `<span class="mono">${esc(u.attempts_sent)}</span>`], ['Attempts counted', `<span class="mono">${esc(u.attempts_counted)}</span><span class="small">no cap</span>`], ['NEAR spent', '<span class="mono">0, no fee</span>'], ['Bits learned', `<span class="mono">${esc(u.bits_learned)}</span><span class="small">the probes named the secret’s value, checked against the secret revealed after the run</span>`], ['Share of the secret exposed', `${bar(u.share_exposed)}<span class="mono">${pct(u.share_exposed)}</span>`]], '', 'Unguarded run')}
        <p class="small">Never run against the contract: ${esc(u.where)}. With the crash variant check on, every probe FAILs and learns 0 bits.</p></div></div>
      <p class="small faint mt8">Recorded in docs/evidence/arena_probe/.</p>`;
  })();
  // no live answer after both tries: say so (the values still fill in if they arrive later)
  liveP.catch(() => {}).then(() => {
    if (all && !snapshot) return;
    const d = $('#deploy'), al = $('#allowLine'), gone = `Live reading is paused just now. The contract account is on the <a class="lnk sm" href="${EXPLORER_ACCOUNT}${CONTRACT}" target="_blank" rel="noopener">explorer ${icon('ext')}</a>.`;
    if (d && d.textContent.trim() === LOADING) d.innerHTML = `<p class="small">${gone}</p>`;
    if (al && al.textContent.trim() === LOADING) al.innerHTML = gone;
  });
  (async () => {
    const [ch, owner, pool, allowed, keys] = await Promise.all([codeHash(), view('get_owner').catch(() => null), view('get_protocol_pool').catch(() => null), view('get_allowed_image_ids').catch(() => null), accessKeys(CONTRACT).catch(() => null)]);
    const fullKeys = keys === null ? null : keys.filter((k) => k.access_key.permission === 'FullAccess').length;
    const d = $('#deploy'); if (!d) return;
    d.innerHTML = `<dl class="kv2"><dt>Account</dt><dd><a class="tx" href="${EXPLORER_ACCOUNT}${CONTRACT}" target="_blank" rel="noopener">${esc(CONTRACT)} ${icon('ext')}</a></dd>
      <dt>Code hash</dt><dd class="mono" style="overflow-wrap:anywhere">${ch ? esc(ch) : 'could not read'}</dd>
      <dt>Last deploy</dt><dd>${tx(nums.last_deploy.tx)}</dd>
      <dt>Owner</dt><dd>${owner ? (owner === CONTRACT ? 'The contract account itself' : acct(owner)) : 'could not read'}</dd>
      <dt>Fee pool</dt><dd>${pool !== null ? `${esc(near(pool))}, locked. No method takes it out.` : 'could not read'}</dd>
      <dt>Full access keys</dt><dd>${fullKeys === null ? 'could not read' : fullKeys}</dd></dl><p class="small faint">Read live from testnet just now, except the last deploy (${esc(nums.last_deploy.source)}).</p>`;
    const al = $('#allowLine'); if (al) al.textContent = allowed === null ? 'The allowlist could not be read just now.' : `Read live: the allowlist holds ${allowed.length} ${allowed.length === 1 ? 'id' : 'ids'}: ${allowed.map((a) => a === CHECKERS.crash ? 'the crash checker' : a === CHECKERS.output ? 'the output checker' : (rec.retired_checkers || {})[a] ? 'a retired checker' : 'an unknown id').join(', ')}.`;
    const kn = $('#keyNote'); if (kn && fullKeys) kn.innerHTML = note(`Read live just now: the contract account has ${fullKeys} full access ${fullKeys === 1 ? 'key' : 'keys'}. The testnet contract’s account keeps a full access key, so its owner can replace the code under live bounties. This is deliberate: it’s an experimental testnet contract that will keep changing. The mainnet contract (skarbnik.near) is planned without an upgrade key the owner controls alone (key removed, or upgrades behind a multisig or DAO with a delay). To check that the code has not changed silently, compare the live code hash above with the last deploy in docs/EVIDENCE.md, “Contract code and every deploy”, which lists every deploy transaction.`, 'alert');
    drawLimits({ fullKeys });
  })();
  drawLimits({ fullKeys: null });

  // the live values, then the Proof Ledger, from every bounty and attempt on chain (js/ledger-core.js)
  (async () => {
    try { await liveP; } catch (e) {
      for (const id of ['#ledgerTop', '#proofLedger']) { const el = $(id); if (el) el.innerHTML = note(`Could not read the contract or the saved list: ${esc(e.message)}. Reload to try again.`, 'alert'); }
      return;
    }
    if (!$('#etabs')) return;
    nProof = all.filter((x) => x.status === 'Proof verified').length; nOl = all.filter((x) => x.status === 'Verified by OutLayer').length; nTime = all.filter((x) => x.status === 'Timeout settlement').length;
    const ORDER = ['Proof verified', 'Verified by OutLayer', 'Timeout settlement'];
    settled = all.filter((x) => ORDER.includes(x.status)).slice().sort((a, b) => (a.status === b.status ? Number(b.b.id) - Number(a.b.id) : ORDER.indexOf(a.status) - ORDER.indexOf(b.status)));
    drawNums(); $('#ctSum').innerHTML = ctLine();
    const ln = $('#ledgerN'); if (ln) ln.textContent = `${settled.length} settled bounties`;
    const lt = $('#ledgerTop'); if (lt) { lt.innerHTML = ledgerTop(); bindLedger(); }
    // the saved record loaded: one calm line, not a warning (a real warning appears only if the saved record failed too)
    if (snapshot) $('#liveNote').innerHTML = `<div style="margin-top:24px">${note(`Showing the saved record of ${esc(savedAt(snapshot.at))} (feed.json, ledger.json). Live reading is paused; reload to read it live.`, 'info')}</div>`;
    try {
      const [accounts, provers, costs] = await Promise.all([fetch('data/accounts.json').then((x) => x.json()), fetch('data/provers.json').then((x) => x.json()), fetch('data/operator_costs.json').then((x) => x.json())]);
      let L, names;
      if (snapshot) { L = await (await fetch('ledger.json')).json(); names = new Set([...L.paid_accounts.map((a) => a.account), ...L.vendors.map((v) => v.vendor), ...L.earnings.map((x) => x.account)].filter((a) => /\.testnet$/.test(a))); }
      else {
        const bs = all.map((x) => x.b), subs = Object.fromEntries(all.map((x) => [String(x.b.id), x.subs]));
        names = new Set([...bs.map((b) => b.vendor), ...Object.values(subs).flat().flatMap((s) => [s.committer, s.payout])]);
        const hashes = new Map(await Promise.all([...names].map(async (a) => [a, hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a))))])));
        L = buildLedger(bs, subs, rec, accounts, Date.now(), hashes, provers.attempts, costs.costs);
      }
      const c = L.counts;
      const pl = $('#proofLedger'); if (!pl) return;
      const howChip = (f) => (f.transfer_failed ? chip('k-fail', 'Paid on paper, transfer failed (audit finding 8)', 'x') : f.how === 'proof' ? chip('k-proof', 'Paid by proof', 'check') : f.how === 'outlayer' ? chip('k-await', 'Verified by OutLayer', 'seal') : chip('k-timeout', 'Paid by timeout', 'hourglass'));
      pl.innerHTML = `<div style="max-width:700px"><h2 class="h2s">The Proof Ledger</h2><p class="body" style="margin-top:12px">Every account the contract has paid, how each fix was paid, and each vendor’s on-time record, ${snapshot ? `from the snapshot made at ${esc(L.made_at)} (ledger.json)` : 'computed live from every bounty and attempt on chain'}. No scores, no ranks, no credit for unpaid attempts.</p></div>
        ${note(`<b>${c.outside_the_team === 0 ? 'Every account below is run by the Skarbnik team or was seeded by its scripts.' : `${c.outside_the_team} account(s) below are not on the team’s list.`}</b> An account missing from the team’s list (data/accounts.json) would show as “not known”.`)}
        <div class="stat4"><div><b class="num">${c.paid_fixes}</b><span>Paid fixes: ${c.paid_by_proof} by proof, ${c.paid_by_outlayer ? `${c.paid_by_outlayer} on OutLayer’s answer (Level 1), ` : ''}${c.paid_by_timeout} by timeout${c.paid_on_paper_transfer_failed ? `; ${c.paid_on_paper_transfer_failed} more paid on paper only (transfer failed)` : ''}</span></div><div><b class="num">${c.paid_accounts}</b><span>Paid accounts</span></div><div><b class="num">${c.vendors}</b><span>Vendors</span></div><div><b class="num">${c.distinct_counterparties}</b><span>Distinct counterparties: paid accounts and vendors</span></div></div>
        ${collapse('plFixes', `Paid fixes: ${c.paid_fixes}`, table(['Bounty', 'Attempt', 'Paid to', 'How', 'Paid', 'Checker', 'Transaction'], L.paid_fixes.map((f) => [
          `<a class="nw" href="#/bounties/${esc(f.bounty_id)}">Bounty ${esc(f.bounty_id)}</a>`, `#${esc(f.attempt)}`, `${names.has(f.payout_account) ? acct(f.payout_account) : esc(f.payout_account)}<span class="small">${esc(f.kind)}</span>`,
          `${howChip(f)}<span class="small">${esc(f.how === 'proof' ? 'PASS means: ' : '')}${esc(f.means)}</span>${f.note ? `<span class="small">${esc(f.note)}</span>` : ''}`,
          f.transfer_failed ? `<span class="mono nw">0 NEAR</span><span class="small">${esc(near(f.on_paper_yocto))} on paper; the transfer failed, no NEAR moved</span>` : `<span class="mono nw">${esc(near(f.paid_yocto))}</span><span class="small">plus its own fee back</span>`,
          hashCell(f.image_id), tx(f.tx)]), 'xl', 'Paid fixes'))}
        ${collapse('plAccounts', `Paid accounts: ${c.paid_accounts}`, table(['Account', 'Who runs it', 'Fixes paid', 'By proof', 'On OutLayer’s answer', 'By timeout', 'Total paid'], L.paid_accounts.map((a) => [names.has(a.account) ? acct(a.account) : esc(a.account), kindChip(a.kind), esc(a.fixes_paid), esc(a.paid_by_proof), esc(a.paid_by_outlayer || 0), esc(a.paid_by_timeout), `<span class="mono nw">${esc(near(a.total_paid_yocto))}</span>`]), 'wide', 'Paid accounts'))}
        ${collapse('plEarnings', 'Earnings by account', `<p class="small">Every account that committed or was paid. Fees spent are the attempt fees it paid; fees returned came back with a payout or as credit when a bounty closed. Model and compute costs appear only if the agent’s operator supplies them (data/operator_costs.json).</p>
        ${table(['Account', 'Who runs it', 'Attempts', 'Gross rewards', 'Fees spent', 'Fees returned', 'Proof-checked passes', 'Passes on OutLayer’s answer', 'Timeout payouts', 'Rejected by a FAIL proof', 'Released unrevealed', 'Model and compute cost'], L.earnings.map((x) => [
          names.has(x.account) ? acct(x.account) : esc(x.account), kindChip(x.kind), esc(x.attempts), `<span class="mono nw">${esc(near(x.gross_rewards_yocto))}</span>`, `<span class="mono nw">${esc(near(x.fees_spent_yocto))}</span>`, `<span class="mono nw">${esc(near(x.fees_returned_yocto))}</span>`,
          esc(x.proof_checked_passes), esc(x.outlayer_passes || 0), esc(x.timeout_payouts), esc(x.rejected_by_a_fail_proof), esc(x.released_unrevealed), x.model_and_compute_cost ? esc(x.model_and_compute_cost) : '<span class="faint">not supplied</span>']), 'xl', 'Earnings')}`)}
        ${collapse('plNumbers', 'Numbers: settled by proof and by the timeout rule, reveal to settlement', `<p class="small">From the chain only (every decided attempt); the proving machine from data/provers.json.</p>
        ${table(['Measure', 'Value'], [['Decided attempts', esc(L.metrics.decided_attempts)], ['Settled by a proof', `${esc(L.metrics.settled_by_proof)} (${esc(Math.round((L.metrics.share_settled_by_proof || 0) * 100))}%)`], ['Settled on OutLayer’s answer (Level 1)', esc(L.metrics.settled_by_outlayer || 0)], ['Settled by the timeout rule (timeout rate)', `${esc(L.metrics.settled_by_timeout)} (${esc(Math.round((L.metrics.timeout_rate || 0) * 100))}%)`],
          ...Object.entries(L.metrics.reveal_to_settlement_seconds).map(([k, v]) => [`Reveal to settlement, ${esc(k)}`, `median ${esc(dur(v.median))}, slowest ${esc(dur(v.slowest))} (${esc(v.attempts)} attempts)`]),
          ['Distinct outside accounts', `${esc(L.metrics.distinct_outside_accounts)}${L.metrics.distinct_outside_accounts === 0 ? ': every account so far is run or seeded by the team' : ''}`]], '', 'Numbers')}
        <p class="small">${esc(L.metrics.timing_note)} Machine-readable: <a href="metrics.json">metrics.json</a>.</p>`)}
        ${collapse('plVendors', 'Vendors: proved in time or not', `<p class="small">For each revealed attempt: decided by a proof before its deadline, or not (then the timeout rule paid it, or it is still waiting past its deadline).</p>
        ${table(['Vendor', 'Who runs it', 'Bounties', 'Proved in time', 'Not proved in time', 'Waiting past deadline'], L.vendors.map((v) => [names.has(v.vendor) ? acct(v.vendor) : esc(v.vendor), kindChip(v.kind), esc(v.bounties), esc(v.proved_on_time), esc(v.not_proved_in_time), esc(v.waiting_past_deadline)]), 'wide', 'Vendors')}`)}
        <p class="small">Machine-readable: <a href="ledger.json">ledger.json</a> (a snapshot made by <span class="mono txt">node scripts/gen_ledger.mjs</span> with the same rules). Transaction links come from the files the repository records; amounts and outcomes come from the chain.</p>`;
    } catch (e) { const pl = $('#proofLedger'); if (pl) pl.innerHTML = note(`Could not compute the Proof Ledger: ${esc(e.message)}`, 'alert'); }
  })();
}
