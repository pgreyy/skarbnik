// Evidence: five tabs. Ledger: every settled bounty, paid by proof or by timeout (kept apart), with its transactions,
// then the Proof Ledger read live from the chain (paid accounts, earnings, the numbers, vendors; rules in
// js/ledger-core.js, the same as ledger.json). Checker: the approved image id, the rebuild command (shown only after
// scripts/check_image_id.sh printed MATCH) and what the checker runs. Contract: the deployment read live (code hash,
// owner, fee pool, full access keys), what was tested, refused attacks, who may call what, where every fee goes.
// Security Lab: how much repeated attempts can learn, the recorded probe run, and the guarded (real, testnet) vs
// unguarded (simulated) recording. Limits: what is not claimed. Then the status vocabulary.
import { CONTRACT, RPCS, EXPLORER_ACCOUNT, PUBLISHED_IMAGE_ID, view, near, submissions, accessKeys } from '../chain.js';
import { $, esc, icon, chip, tx, acct, hashCell, table, note, cmd, tabbed, seg, bindSeg } from '../ui.js';
import { STATUS } from '../status.js';
import { loadAll, fromFeed, getRecorded, getMeta, getNumbers, txsOf } from '../data.js';
import { buildLedger } from '../ledger-core.js';
import { hex } from '../attempt.js';

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

const LIMITS = (live) => [
  ['alert', 'am', 'Testnet only', 'No mainnet contract exists. Every transaction on this site is a testnet transaction.'],
  ['shield', '', 'No external audit', 'The contract was reviewed in AI review passes, with every finding reproduced before it was fixed. The checker, scripts, site and agent were outside that review.'],
  ['key', 'am', live.fullKeys === 0 ? 'No full access key' : 'Full access key kept on purpose (testnet)', live.fullKeys === 0 ? 'Read live: the contract account has no full access key, so its code cannot be replaced.' : `The testnet contract’s account keeps a full access key, so its owner can replace the code under live bounties. This is deliberate: it’s an experimental testnet contract that will keep changing. The mainnet contract (skarbnik.near) is planned without an upgrade key the owner controls alone (key removed, or upgrades behind a multisig or DAO with a delay). ${live.fullKeys === null ? 'The keys could not be read just now.' : `Read live: ${live.fullKeys} full access ${live.fullKeys === 1 ? 'key' : 'keys'}.`} To check that the code has not changed silently, compare the live code hash on the Contract tab with the last deploy in docs/EVIDENCE.md, “Contract code and every deploy”, which lists every deploy transaction.`],
  ['clock', '', 'Vendor proofs are slow on a laptop', 'One attempt takes about 1.5 to 2.5 hours to prove on a laptop CPU, plus the shrink step, so it can miss a 4 hour window. Then the timeout rule applies.'],
  ['cpu', '', 'GPU proving rents a machine', 'The vendor’s watch proves each attempt on a rented GPU (bounties 32 and 27): about 17 minutes from reveal to submit, about $0.04 of GPU a proof. The secret sits in that machine’s RAM during the proof, then is wiped. The Groth16 wrap needs Docker on an x86 machine.'],
  ['hourglass', '', 'A timeout pays whatever was revealed', 'The contract does not read the fix. Under a silent vendor, an honest fix may get as little as 1/K of the bounty.'],
  ['eye', '', 'Revealed fixes are public', 'After the reveal a patch is on chain. A one line fix is often the reference fix byte for byte, so a secret reference fix protects little.'],
  ['cube', '', 'Narrow scope', 'Crash bugs in small WebAssembly modules, patches up to 2,048 bytes. A vendor with a crash but no fix is not supported.'],
  ['coin', '', 'A payout to a missing account is lost', 'Bounty 8 shows it. The site and the agent check the account before a commit, but the contract does not.'],
  ['hash', '', 'One verdict leaks one bit', 'K is the leak budget. A per-account cap (deployed 2026-10-26) limits how many slots one account holds, but one person with many accounts can still fill a bounty’s slots.'],
  ['link', '', 'Level 1 is not built', 'The OutLayer path exists but never answered on testnet. Every current bounty is Level 2 or the older Level 0.'],
  ['wallet', '', 'Wallets are mostly untested', 'NEAR CLI was clicked through to real transactions. The other wallets were only loaded, not signed in.'],
];

const VOCAB = ['Proof verified', 'Proof rejected', 'Awaiting evaluation', 'Timeout settlement', 'Refunded', 'Failed', 'Demo or test only', 'Open for attempts', 'Waiting for Proof 0'];

export async function evidence(viewEl, tab) {
  viewEl.innerHTML = `<main id="main" class="p-evidence" tabindex="-1">
<section class="ph"><div class="wrap"><div class="ph-grid">
<div style="display:flex;flex-direction:column;gap:24px;max-width:640px">
<p class="eyebrow">Evidence</p>
<h1>Built for verification</h1>
<p class="lead">Every claim here points to a transaction, a file or a command. Where something is not proven, the label says so.</p>
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center"><a class="btn btn-p" href="#/judge">Take the judge tour ${icon('right')}</a><a class="lnk" href="#vocab" id="vocabLink">What the status labels mean</a></div>
</div>
<div class="card" style="padding:24px 26px;display:flex;flex-direction:column;gap:14px">
<p class="eyebrow" style="color:var(--tx3)">Contract on NEAR testnet</p>
<a class="tx" style="align-self:flex-start" href="${EXPLORER_ACCOUNT}${CONTRACT}" target="_blank" rel="noopener">${esc(CONTRACT)} ${icon('ext')}</a>
<p class="small" id="ctSum">Reading the contract…</p>
</div>
</div></div></section>
<section style="padding:0 0 112px"><div class="wrap">
<div class="nums" role="list" aria-label="Key numbers" id="nums"><div role="listitem"><b>…</b><span>Reading from testnet</span></div></div>
<div style="margin-top:56px" id="etabs"></div>
<div id="vocab" style="margin-top:104px">
<p class="eyebrow">Status vocabulary</p>
<h2 class="h2s" style="margin-top:12px;max-width:640px">The same labels everywhere</h2>
<p class="body" style="margin-top:12px;max-width:640px">Mint is used only for a verified outcome, and always with a word and an icon. A timeout is never styled like a proof. The last two labels are the feed’s states for bounties that are not settled.</p>
<div class="vocab" style="margin-top:32px">${VOCAB.map((s) => `<div class="card vc">${chip(STATUS[s].cls, s, STATUS[s].icon)}<p class="small">${esc(STATUS[s].help)}</p></div>`).join('')}
<div class="card vc"><p class="eyebrow" style="color:var(--tx3)">Labels for claims</p><div style="display:flex;flex-wrap:wrap;gap:6px"><span class="chip l-impl">Implemented</span><span class="chip l-demo">Demonstrated</span><span class="chip l-exp">Experimental</span><span class="chip l-plan">Planned</span></div><p class="small">Used in the judge guide. No audit badge is shown, because there is no audit.</p></div>
</div></div>
</div></section></main>`;
  $('#vocabLink').addEventListener('click', (e) => { e.preventDefault(); $('#vocab').scrollIntoView(); });
  let all, rec, meta, nums, snapshot = null;
  try { [rec, meta, nums] = await Promise.all([getRecorded(), getMeta(), getNumbers()]); } catch (e) {
    if ($('#etabs')) $('#etabs').innerHTML = note(`Could not load the site's data: ${esc(e.message)}. Reload to try again.`, 'alert'); return;
  }
  // Live from the chain; if it cannot be read within 6 seconds, the feed and ledger.json snapshots, labelled with their time.
  try { all = await Promise.race([loadAll(true), new Promise((_, no) => setTimeout(() => no(new Error('the testnet RPC is slow or busy')), 6000))]); } catch (e) {
    try { const f = await fromFeed(); all = f.list; snapshot = { at: f.at, err: e.message }; } catch {
      if ($('#etabs')) $('#etabs').innerHTML = note(`Could not read the contract on testnet: ${esc(e.message)}. Reload to try again.`, 'alert'); return;
    }
  }
  if (!$('#etabs')) return;
  const nProof = all.filter((x) => x.status === 'Proof verified').length, nTime = all.filter((x) => x.status === 'Timeout settlement').length;
  const attacks = (rec.attacks_s6c || []).filter((a) => /refused/.test(a.result)).length;
  $('#nums').innerHTML = [[`${nProof}`, 'Bounties paid by a verified proof'], [`${nTime}`, 'Settled by timeout, never called proven'], [`${nums.contract_unit_tests.value}`, 'Contract unit tests pass in the repository'], [`${attacks}`, 'Proof attacks refused on chain'], [`${nums.accepted_proof_tgas.value}<small>Tgas</small>`, `About, per accepted proof (${nums.accepted_proof_tgas.range})`]]
    .map(([v, t]) => `<div role="listitem"><b>${v}</b><span>${esc(t)}</span></div>`).join('');
  if (snapshot) $('#etabs').insertAdjacentHTML('beforebegin', `<div style="margin-top:24px">${note(`The contract could not be read just now (${esc(snapshot.err)}). The numbers and the ledger below are the snapshots made at ${esc(snapshot.at)} (feed.json, ledger.json): reload to read them live.`, 'alert')}</div>`);
  $('#ctSum').textContent = `One approved checker id, ${all.length} bounties, and no mainnet contract. Read it on the explorer, not on this page.`;

  // ---- Ledger: the settled bounties, then the Proof Ledger
  const settled = all.filter((x) => x.status === 'Proof verified' || x.status === 'Timeout settlement').slice().sort((a, b) => (a.status === b.status ? Number(b.b.id) - Number(a.b.id) : a.status === 'Proof verified' ? -1 : 1));
  const chips = (id, how) => {
    const list = [['commit', 'Commit'], ['reveal', 'Reveal']].flatMap(([m, l]) => txsOf(rec, id, m).slice(0, 2).map((t) => [t.tx, l]));
    const end = how === 'proof' ? txsOf(rec, id, 'submit_groth16').map((t) => [t.tx, 'Proof']) : txsOf(rec, id, 'claim_timeout').map((t) => [t.tx, 'Claim']);
    return [...list, ...end].map(([t, l]) => tx(t, l)).join('');
  };
  const ledgerRows = (f) => settled.filter((x) => f === 'all' || x.status === f).map((x) => {
    const id = String(x.b.id), st = STATUS[x.status], n8 = rec.bounty_notes && rec.bounty_notes[id];
    return `<div class="lrow" role="listitem"><div><a class="lid" style="color:var(--tx);text-decoration:none" href="#/bounties/${esc(id)}">#${esc(id)}</a><p class="small" style="margin-top:4px">${esc((meta.titles || {})[id] || '')}</p></div>
      <div>${chip(st.cls, x.status, st.icon)}${n8 && n8.transfer_failed ? `<div class="mt8">${chip('k-fail', 'Paid on paper, transfer failed', 'x')}</div>` : ''}</div>
      <div class="txs">${chips(id, x.status === 'Proof verified' ? 'proof' : 'timeout') || '<span class="small faint">no transactions recorded</span>'}</div>
      <p class="small">${esc(n8 ? n8.text : (meta.notes || {})[id] || '')}</p></div>`;
  }).join('');
  let lf = 'all';
  const ledgerTop = () => `<div style="display:flex;flex-wrap:wrap;gap:20px;justify-content:space-between;align-items:end">
    <div style="max-width:640px"><h2 class="h2s">The settlement ledger</h2><p class="body" style="margin-top:12px">Every paid bounty on the contract, with the transactions that show how it was decided. Paid by proof and paid by timeout are kept apart on purpose.</p></div>
    ${seg([['all', 'All', settled.length], ['Proof verified', 'Proof verified', nProof], ['Timeout settlement', 'Timeout settlement', nTime]].map(([id, l, c]) => ({ id, label: `${esc(l)} <span style="color:var(--tx3)">${c}</span>` })), lf, 'Filter the ledger', 'data-lf')}</div>
    <div class="blist" role="list" aria-label="Ledger" id="lrows"><div class="lhead" aria-hidden="true"><span>Bounty</span><span>Settlement</span><span>Transactions</span><span>Note</span></div>${ledgerRows(lf)}</div>
    ${note('Bounty 17 is paid by timeout, not by a proof. Its evidence proof says PASS, but it finished after the window and was never submitted.')}`;
  const ledger = `<div class="stack g28" id="ledgerTop">${ledgerTop()}</div><div class="stack g24 mt48" id="proofLedger"><p class="state">Computing the Proof Ledger from the chain…</p></div>`;

  // ---- Checker
  const check = rec.last_image_check && rec.last_image_check.result === 'MATCH' ? rec.last_image_check : null;
  const checker = `<div class="stack g36">
    <div style="max-width:700px"><h2 class="h2s">The approved checker</h2><p class="body" style="margin-top:12px">A proof counts only for one checker program. Its fingerprint, the image id, is the only id on the contract’s allowlist, and anyone can rebuild the checker and compare.</p></div>
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:18px">
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center"><p class="eyebrow" style="color:var(--tx3)">Image id on the allowlist</p>${check ? chip('l-demo', `MATCH on rebuild, ${check.utc.slice(0, 10)}`, 'check') : ''}</div>
    <p class="imgid">${esc(PUBLISHED_IMAGE_ID)}</p>
    <p class="small" id="allowLine">Reading the allowlist from testnet…</p>
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center"><button class="btn btn-g btn-s" type="button" data-copy-text="${esc(PUBLISHED_IMAGE_ID)}">${icon('copy')} Copy image id</button>${tx(nums.allowlist_tx.tx, 'allowlisted in')}</div>
    </div>
    <div class="two">
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:16px">
    <h3 class="h3">Rebuild it yourself</h3>
    ${check ? `<p class="small">Level B of the judge guide. It builds the checker in a pinned container and compares the id.</p>${cmd('./scripts/check_image_id.sh')}
    <p class="small">The last line should read <b class="txt">MATCH</b>. It took ${esc(nums.image_rebuild.cached)} with the Docker images cached, and ${esc(nums.image_rebuild.fresh)} with the ${esc(nums.image_rebuild.download)} image download. Needs Docker.</p>
    <p class="small faint">Shown on one machine so far (${esc(check.source)}).</p>` : '<p class="small">The rebuild command is shown here once scripts/check_image_id.sh has printed MATCH.</p>'}
    </div>
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:14px">
    <h3 class="h3">What a match establishes</h3>
    <p class="small"><b class="txt">It does.</b> The id on chain is the id of the public checker source, built the reproducible way.</p>
    <p class="small"><b class="txt">It does not.</b> It does not show that the checker is complete, or that a passing fix is secure against everything. A proof says one patch passed or failed this defined check.</p>
    </div></div>
    <div><h3 class="h3">What the checker runs on every patch</h3>
    <div class="card" style="padding:8px 28px;margin-top:16px"><div class="steps">
    ${[['Validate the module', 'No imports, at most 2,048 bytes, at most 2 memory pages, checked exports.'], ['Run the secret input', 'It must not crash or run out of fuel, 50,000 units per input, in a fresh interpreter each time.'], ['Run the public tests', 'Every answer must match the original program’s.'], ['Run fairness inputs', 'Drawn from the reveal seed, so a patch cannot be tailored to them. They must match the original.'], ['Run crash variants', 'One or two byte changes of the secret must not crash where the original crashes.']]
      .map(([h, p], i) => `<div class="st"><span class="n">${i + 1}</span><div><b class="h4">${esc(h)}</b><p class="small" style="margin-top:4px">${esc(p)}</p></div></div>`).join('')}
    </div></div></div>
    <div><h3 class="h3">Check it from the repository</h3><p class="small" style="margin-top:8px">Commands run from the root of the Skarbnik repository.</p>
    <div class="card pad24 stack g16 mt16">
      <div><b class="h4">Read a bounty from the chain</b><div class="mt8">${cmd(`near contract call-function as-read-only ${CONTRACT} get_bounty json-args '{"bounty_id":"12"}' network-config testnet now`)}</div><p class="small mt8">Or open its <a href="#/raw/12">raw data</a>.</p></div>
      <div><b class="h4">A real proof is accepted</b><div class="mt8">${cmd('cargo test -p kintsugi-contract --offline level2_opens_with_the_real_proof0')}</div><p class="small mt8">On testnet: ${tx(rec.valid_proof_accepted.tx)}, a PASS proof for bounty 1, accepted and paid.</p></div>
      <div><b class="h4">A proof for the wrong bounty is refused</b><div class="mt8">${cmd('cargo test -p kintsugi-contract --offline s1_the_same_proof_is_refused_on_another_bounty')}</div><p class="small mt8">On testnet: ${tx(rec.wrong_bounty_refused.tx)}, refused by the contract.</p></div>
      <div><b class="h4">Run every contract test</b><div class="mt8">${cmd('cargo test -p kintsugi-contract --offline')}</div><p class="small mt8">${esc(nums.contract_unit_tests.detail)}</p></div>
      <div><b class="h4">Read the findings of the AI review passes</b><p class="small mt8">docs/AUDIT.md (every finding, fix and known limit) and docs/SECURITY.md (guards and known limits).</p></div>
    </div></div></div>`;

  // ---- Contract
  const contract = `<div class="stack g36">
    <div style="max-width:700px"><h2 class="h2s">The contract</h2><p class="body" style="margin-top:12px">It holds the money and the deadlines, checks Groth16 proofs with NEAR’s built in curve functions, and applies the rules. It does not run the private evaluation.</p></div>
    <div class="two">
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:18px"><h3 class="h3">Deployment, read live</h3><div id="deploy"><p class="small">Reading from testnet…</p></div></div>
    <div class="card" style="padding:28px;display:flex;flex-direction:column;gap:16px"><h3 class="h3">What was tested</h3>
    <p class="small"><b class="txt">${esc(nums.contract_unit_tests.value)}</b> contract unit tests pass in the repository. ${esc(nums.contract_unit_tests.detail)}</p>
    <p class="small"><b class="txt">${attacks}</b> proof attacks were refused on chain: ${esc((rec.attacks_s6c || []).map((a) => a.what.charAt(0).toLowerCase() + a.what.slice(1)).join(', '))}.</p>
    <p class="small">A proof for the wrong bounty fails cheaply, at ${esc(nums.wrong_bounty_tgas.value)} Tgas. ${tx(rec.wrong_bounty_refused.tx)}</p>
    ${note('These are AI review passes and tests. There is no external security audit.', 'shield')}</div></div>
    <div id="keyNote"></div>
    <div><h3 class="h3">Refused attacks on testnet</h3><div class="mt16">${table(['What was tried', 'Result', 'Transaction'], (rec.attacks_s6c || []).map((a) => [esc(a.what), /refused/.test(a.result) ? chip('k-reject', 'Refused', 'x') : chip('k-refund', esc(a.result)), tx(a.tx)]), 'mid', 'Refused attacks')}</div><p class="small faint mt8">Recorded in docs/evidence/S6c/transactions.tsv.</p></div>
    <div><h3 class="h3">Who may call what</h3><div class="mt16">${table(['Method', 'Caller', 'Rule'], [
      ['create_bounty', 'Anyone except a verifier', 'At least 0.1 NEAR, K from 1 to 16, checker id on the allowlist'], ['open_with_groth16', 'Anyone', 'Checks Proof 0 on chain, then opens the bounty'],
      ['commit', 'Anyone except the vendor', 'Fee taken from prepaid credit. Ignored when the slots are full'], ['reveal', 'The committer', 'After the gap, inside the window. Records the block seed'],
      ['submit_groth16', 'Anyone', 'PASS pays and closes. FAIL spends the attempt. A late proof is refused'], ['claim_timeout', 'Anyone, after the deadline', 'Splits equally among revealed attempts still undecided'],
      ['expire', 'Anyone, after expiry', 'Refunds an unpaid bounty to the vendor'], ['withdraw_credit', 'The account, 1 yoctoNEAR', 'A limited agent key cannot call it'],
      ['set_agent_limits', 'The account, 1 yoctoNEAR', 'Caps the fee per commit and fixes the payout account'], ['allow_image_id', 'Owner', 'Adds a checker id. There is no removal'],
    ].map(([m, c, r]) => [`<span class="mono txt">${esc(m)}</span>`, esc(c), esc(r)]), 'wide', 'Who may call what')}</div></div>
    <div><h3 class="h3">Where every fee goes</h3><p class="small" style="margin-top:8px">An attempt fee is taken from your credit in the contract when your commit is counted. It never goes to the vendor.</p><div class="mt16">${table(['How the attempt ends', 'Where its fee goes', 'When'], [
      ['Never revealed in time', 'Protocol fee pool', 'When anyone calls release_unrevealed after the reveal window, or at expire'],
      ['Wins with a PASS proof', 'Back to the winner, with the bounty', 'Same transaction'],
      ['Paid by the timeout rule', 'Back to each account that shares the payout, with its share', 'Same transaction'],
      ['Revealed and still waiting when another attempt wins', 'Back to the committer as credit', 'Same transaction'],
      ['Decided FAIL', 'Level 2 bounties: the protocol fee pool. Level 0: equal shares to the registered verifiers', 'When anyone calls expire after the bounty’s expiry'],
    ].map((r) => r.map(esc)), 'wide', 'Where every fee goes')}</div><p class="small mt12">The protocol fee pool cannot be withdrawn: no method takes NEAR out of it. Unspent credit is always yours: withdraw_credit returns it (it needs 1 yoctoNEAR, so only your full key can call it, never an agent’s limited key). docs/SECURITY.md, “Where every fee goes”.</p></div>
    <div><h3 class="h3">Levels: what you trust</h3><div class="mt16">${table(['Level', 'Who checks the proof', 'You trust'], [['<span class="mono txt">L0</span>', 'Two registered verifiers sign the same verdict', 'Those two verifiers'], ['<span class="mono txt">L2</span>', 'The contract checks a Groth16 proof of the RISC Zero result itself', 'The maths, a one time setup by RISC Zero, and the published checker (its image id)']], 'mid', 'Levels')}</div></div>
    <div><h3 class="h3">Credit and agent limits, read only</h3><div class="stack g12 mt16">${cmd(`near contract call-function as-read-only ${CONTRACT} get_credit json-args '{"account_id":"<account>"}' network-config testnet now`)}${cmd(`near contract call-function as-read-only ${CONTRACT} get_agent_limits json-args '{"account_id":"<account>"}' network-config testnet now`)}</div></div>
    </div>`;

  // ---- Security Lab
  const ar = rec.arena, A = ar.attempts, K = A[0].budget, bitsTotal = Math.log2(ar.secret_space);
  const lab = `<div class="stack g32">
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
    <div id="gu"><p class="small">Reading the guarded and unguarded runs…</p></div>
    <div><h3 class="h3">Crash variant check on</h3><p class="small" style="margin-top:8px">With the check of ${esc(ar.control_variants)} variants of the secret input switched on, the same probes all FAIL whatever the secret, so the probe agent learns 0 bits.</p><div class="mt16">${table(['Probe', 'Verdict'], ar.control_variant_check_on.map((c) => [`<span class="mono">${esc(c.probe)}</span>`, c.verdict === 'PASS' ? chip('k-proof', 'PASS', 'check') : chip('k-fail', 'FAIL', 'x')]), '', 'Control')}</div></div>
    <div><h3 class="h3">The same cap on testnet</h3><div class="mt16">${table(['What happened', 'Result', 'Transaction', 'Time'], ar.chain.steps.map((t) => [esc(t.what), /refused/.test(t.result) ? chip('k-reject', 'Refused', 'x') : chip('k-refund', 'Succeeded', 'check'), tx(t.tx), t.time ? esc(t.time) : '<span class="faint">not recorded</span>']), 'wide', 'On testnet')}</div><p class="small faint mt8">Recorded in ${esc(ar.chain.source)} and ${esc(ar.source)}.</p></div>
    </div>`;

  // ---- Limits
  const limits = `<div class="stack g32"><div style="max-width:700px"><h2 class="h2s">Known limitations, in plain words</h2><p class="body" style="margin-top:12px">These are the points a skeptical reader should check first. None of them is hidden elsewhere.</p></div><div class="lim" id="limList"></div></div>`;
  const drawLimits = (live) => { const el = $('#limList'); if (el) el.innerHTML = LIMITS(live).map(([i, c, t, d]) => `<div class="card"><span class="ic ${c}">${icon(i)}</span><div><h3 class="h4">${esc(t)}</h3><p class="small" style="margin-top:6px">${esc(d)}</p></div></div>`).join(''); };

  const ids = { ledger: 'Ledger', checker: 'Checker', contract: 'Contract', lab: 'Security Lab', limits: 'Limits' };
  const html = { ledger, checker, contract, lab, limits };
  tabbed($('#etabs'), Object.keys(ids).map((id) => ({ id, label: ids[id], html: html[id] })), tab, '#/evidence', 'Evidence sections');
  // ledger filter
  const bindLedger = () => bindSeg($('#ledgerTop'), 'data-lf', (f) => { lf = f; $('#lrows').innerHTML = '<div class="lhead" aria-hidden="true"><span>Bounty</span><span>Settlement</span><span>Transactions</span><span>Note</span></div>' + ledgerRows(lf); });
  bindLedger();
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
    el.innerHTML = `<h3 class="h3">Guarded vs unguarded</h3><p class="body" style="margin-top:8px;max-width:760px">The same probe agent asks one yes or no question per attempt about one bit of a ${esc(gu.secret_bits)} bit secret. Without a cap it learns the whole secret; on the contract the cap stops it after ${esc(g.attempts_counted)} counted attempts, so it can learn at most ${esc(g.bits_at_most)} of ${esc(gu.secret_bits)} bits.</p>
      <div class="two mt24">
      <div class="card pad28 stack g16"><div class="row" style="justify-content:space-between"><b class="h4">Guarded</b><span class="chip l-demo">Real, testnet</span></div>${table(['Measure', 'Value'], [['Attempts sent', `<span class="mono">${esc(g.attempts_sent)}</span>`], ['Attempts counted', `<span class="mono">${esc(g.attempts_counted)}</span><span class="small">cap K = ${esc(g.cap_K)}; the rest ignored at no cost</span>`], ['NEAR spent', `<span class="mono">${esc(g.fees_near)} NEAR in fees + ${esc(Number(g.gas_near).toFixed(4))} NEAR gas</span>`], ['Bits learned', `<span class="mono">at most ${esc(g.bits_at_most)}</span><span class="small">0 in this run: the probes were not revealed, so no verdict was asked for</span>`], ['Share of the secret exposed', `${bar(g.share_exposed_at_most)}<span class="mono">at most ${pct(g.share_exposed_at_most)}</span>`]], '', 'Guarded run')}
        <p class="small">${bid ? `<a href="#/bounties/${esc(bid)}">${esc(g.where)}</a>` : esc(g.where)}, probe account ${acct(g.account)}, ${esc(g.account_kind)} by the project. First commit ${tx(g.txs[0])}, first ignored commit ${tx(g.txs[g.attempts_counted])}.</p></div>
      <div class="card pad28 stack g16"><div class="row" style="justify-content:space-between"><b class="h4">Unguarded</b>${chip('k-test', 'Simulated, this machine', 'flask')}</div>${table(['Measure', 'Value'], [['Attempts sent', `<span class="mono">${esc(u.attempts_sent)}</span>`], ['Attempts counted', `<span class="mono">${esc(u.attempts_counted)}</span><span class="small">no cap</span>`], ['NEAR spent', '<span class="mono">0, no fee</span>'], ['Bits learned', `<span class="mono">${esc(u.bits_learned)}</span><span class="small">the probes named the secret’s value, checked against the secret revealed after the run</span>`], ['Share of the secret exposed', `${bar(u.share_exposed)}<span class="mono">${pct(u.share_exposed)}</span>`]], '', 'Unguarded run')}
        <p class="small">Never run against the contract: ${esc(u.where)}. With the crash variant check on, every probe FAILs and learns 0 bits.</p></div></div>
      <p class="small faint mt8">Recorded in docs/evidence/arena_probe/.</p>`;
  })();
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
    const al = $('#allowLine'); if (al) al.textContent = allowed === null ? 'The allowlist could not be read just now.' : `Read live: the allowlist holds ${allowed.length} ${allowed.length === 1 ? 'id' : 'ids'}${allowed.length === 1 && allowed[0] === PUBLISHED_IMAGE_ID ? ', this one' : ''}.`;
    const kn = $('#keyNote'); if (kn && fullKeys) kn.innerHTML = note(`Read live just now: the contract account has ${fullKeys} full access ${fullKeys === 1 ? 'key' : 'keys'}. The testnet contract’s account keeps a full access key, so its owner can replace the code under live bounties. This is deliberate: it’s an experimental testnet contract that will keep changing. The mainnet contract (skarbnik.near) is planned without an upgrade key the owner controls alone (key removed, or upgrades behind a multisig or DAO with a delay). To check that the code has not changed silently, compare the live code hash above with the last deploy in docs/EVIDENCE.md, “Contract code and every deploy”, which lists every deploy transaction.`, 'alert');
    drawLimits({ fullKeys });
  })();
  drawLimits({ fullKeys: null });

  // the Proof Ledger, from every bounty and attempt on chain (js/ledger-core.js)
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
    const howChip = (f) => (f.transfer_failed ? chip('k-fail', 'Paid on paper, transfer failed (audit finding 8)', 'x') : f.how === 'proof' ? chip('k-proof', 'Paid by proof', 'check') : chip('k-timeout', 'Paid by timeout', 'hourglass'));
    pl.innerHTML = `<div style="max-width:700px"><h2 class="h2s">The Proof Ledger</h2><p class="body" style="margin-top:12px">Every account the contract has paid, how each fix was paid, and each vendor’s on-time record, ${snapshot ? `from the snapshot made at ${esc(L.made_at)} (ledger.json)` : 'computed live from every bounty and attempt on chain'}. No scores, no ranks, no credit for unpaid attempts.</p></div>
      ${note(`<b>${c.outside_the_team === 0 ? 'Every account below is run by the Skarbnik team or was seeded by its scripts.' : `${c.outside_the_team} account(s) below are not on the team’s list.`}</b> An account missing from the team’s list (data/accounts.json) would show as “not known”.`)}
      <div class="stat4"><div><b class="num">${c.paid_fixes}</b><span>Paid fixes: ${c.paid_by_proof} by proof, ${c.paid_by_timeout} by timeout${c.paid_on_paper_transfer_failed ? `; ${c.paid_on_paper_transfer_failed} more paid on paper only (transfer failed)` : ''}</span></div><div><b class="num">${c.paid_accounts}</b><span>Paid accounts</span></div><div><b class="num">${c.vendors}</b><span>Vendors</span></div><div><b class="num">${c.distinct_counterparties}</b><span>Distinct counterparties: paid accounts and vendors</span></div></div>
      <h3 class="h3 mt24">Paid fixes</h3>${table(['Bounty', 'Attempt', 'Paid to', 'How', 'Paid', 'Checker', 'Transaction'], L.paid_fixes.map((f) => [
        `<a class="nw" href="#/bounties/${esc(f.bounty_id)}">Bounty ${esc(f.bounty_id)}</a>`, `#${esc(f.attempt)}`, `${names.has(f.payout_account) ? acct(f.payout_account) : esc(f.payout_account)}<span class="small">${esc(f.kind)}</span>`,
        `${howChip(f)}<span class="small">${esc(f.how === 'proof' ? 'PASS means: ' : '')}${esc(f.means)}</span>${f.note ? `<span class="small">${esc(f.note)}</span>` : ''}`,
        f.transfer_failed ? `<span class="mono nw">0 NEAR</span><span class="small">${esc(near(f.on_paper_yocto))} on paper; the transfer failed, no NEAR moved</span>` : `<span class="mono nw">${esc(near(f.paid_yocto))}</span><span class="small">plus its own fee back</span>`,
        hashCell(f.image_id), tx(f.tx)]), 'xl', 'Paid fixes')}
      <h3 class="h3 mt24">Paid accounts</h3>${table(['Account', 'Who runs it', 'Fixes paid', 'By proof', 'By timeout', 'Total paid'], L.paid_accounts.map((a) => [names.has(a.account) ? acct(a.account) : esc(a.account), kindChip(a.kind), esc(a.fixes_paid), esc(a.paid_by_proof), esc(a.paid_by_timeout), `<span class="mono nw">${esc(near(a.total_paid_yocto))}</span>`]), 'wide', 'Paid accounts')}
      <h3 class="h3 mt24">Earnings by account</h3><p class="small">Every account that committed or was paid. Fees spent are the attempt fees it paid; fees returned came back with a payout or as credit when a bounty closed. Model and compute costs appear only if the agent’s operator supplies them (data/operator_costs.json).</p>
      ${table(['Account', 'Who runs it', 'Attempts', 'Gross rewards', 'Fees spent', 'Fees returned', 'Proof-checked passes', 'Timeout payouts', 'Rejected by a FAIL proof', 'Released unrevealed', 'Model and compute cost'], L.earnings.map((x) => [
        names.has(x.account) ? acct(x.account) : esc(x.account), kindChip(x.kind), esc(x.attempts), `<span class="mono nw">${esc(near(x.gross_rewards_yocto))}</span>`, `<span class="mono nw">${esc(near(x.fees_spent_yocto))}</span>`, `<span class="mono nw">${esc(near(x.fees_returned_yocto))}</span>`,
        esc(x.proof_checked_passes), esc(x.timeout_payouts), esc(x.rejected_by_a_fail_proof), esc(x.released_unrevealed), x.model_and_compute_cost ? esc(x.model_and_compute_cost) : '<span class="faint">not supplied</span>']), 'xl', 'Earnings')}
      <h3 class="h3 mt24">Numbers</h3><p class="small">From the chain only (every decided attempt); the proving machine from data/provers.json.</p>
      ${table(['Measure', 'Value'], [['Decided attempts', esc(L.metrics.decided_attempts)], ['Settled by a proof', `${esc(L.metrics.settled_by_proof)} (${esc(Math.round((L.metrics.share_settled_by_proof || 0) * 100))}%)`], ['Settled by the timeout rule (timeout rate)', `${esc(L.metrics.settled_by_timeout)} (${esc(Math.round((L.metrics.timeout_rate || 0) * 100))}%)`],
        ...Object.entries(L.metrics.reveal_to_settlement_seconds).map(([k, v]) => [`Reveal to settlement, ${esc(k)}`, `median ${esc(dur(v.median))}, slowest ${esc(dur(v.slowest))} (${esc(v.attempts)} attempts)`]),
        ['Distinct outside accounts', `${esc(L.metrics.distinct_outside_accounts)}${L.metrics.distinct_outside_accounts === 0 ? ': every account so far is run or seeded by the team' : ''}`]], '', 'Numbers')}
      <p class="small">${esc(L.metrics.timing_note)} Machine-readable: <a href="metrics.json">metrics.json</a>.</p>
      <h3 class="h3 mt24">Vendors: proved in time or not</h3><p class="small">For each revealed attempt: decided by a proof before its deadline, or not (then the timeout rule paid it, or it is still waiting past its deadline).</p>
      ${table(['Vendor', 'Who runs it', 'Bounties', 'Proved in time', 'Not proved in time', 'Waiting past deadline'], L.vendors.map((v) => [names.has(v.vendor) ? acct(v.vendor) : esc(v.vendor), kindChip(v.kind), esc(v.bounties), esc(v.proved_on_time), esc(v.not_proved_in_time), esc(v.waiting_past_deadline)]), 'wide', 'Vendors')}
      <p class="small">Machine-readable: <a href="ledger.json">ledger.json</a> (a snapshot made by <span class="mono txt">node scripts/gen_ledger.mjs</span> with the same rules). Transaction links come from the files the repository records; amounts and outcomes come from the chain.</p>`;
  } catch (e) { const pl = $('#proofLedger'); if (pl) pl.innerHTML = note(`Could not compute the Proof Ledger: ${esc(e.message)}`, 'alert'); }
}
