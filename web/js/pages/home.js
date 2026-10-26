// Home: seven sections, one on show at a time. Above 700 px wide the sections sit in the Console (a rail of the seven
// sections on the left, Previous and Next below); at 700 px and narrower the rail becomes the Dock, a floating row of
// section numbers at the bottom of the screen. #mechanism, #example, #why, #paths, #verify and #next open a section.
// Section 03 shows one real bounty end to end; its id is one setting (home_example_bounty in site.config.json), and
// everything in it except the descriptive words is read from the chain and from data/recorded.json.
import { view, near, span, PUBLISHED_IMAGE_ID, EXPLORER_ACCOUNT, CONTRACT } from '../chain.js';
import { $, esc, icon, chip, tx, note } from '../ui.js';
import { STATUS } from '../status.js';
import { loadSome, paidByProof, getRecorded, getMeta, getConfig, getNumbers, firstTx, lastTx } from '../data.js';
import { matrix } from './matrix.js';

export const HOME_IDS = ['top', 'mechanism', 'example', 'why', 'paths', 'verify', 'next'];
const NAMES = ['Overview', 'Who sees what', 'A real bounty', 'Six rules', 'Take part', 'Verify', 'Next'];
const two = (i) => String(i + 1).padStart(2, '0');
let current = 0;

const RULES = [
  { title: 'Privacy', short: 'The secret input stays on the vendor’s side.', p1: 'The vendor keeps the secret input and a private salt. The contract stores only sha256(salt || secret), a fingerprint that fixes the secret without revealing it. The proving program runs where the vendor chooses: on its own machine, or on a rented GPU that holds the input only in memory and wipes it afterwards.', p2: 'On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.' },
  { title: 'Proof verification', short: 'The contract checks the proof itself.', p1: 'The proof says PASS or FAIL for one patch against the committed secret, and nothing more. On Level 2 bounties the NEAR contract checks a Groth16 proof from RISC Zero with NEAR’s built in curve functions, at about __TGAS__ Tgas. It refuses a proof whose journal does not match this bounty and this attempt.', p2: 'A proof counts only for the approved checker. Its image id is on the contract’s allowlist, and anyone can rebuild the checker and compare.', code: PUBLISHED_IMAGE_ID },
  { title: 'Commit and reveal', short: 'Sealed first, public after.', p1: 'The agent first posts a fingerprint of its patch and pays a rising attempt fee from prepaid credit. After a short gap it reveals the patch. The contract checks the fingerprint and records the block’s random seed. The seed chooses the hidden fairness inputs, so a patch cannot be tailored to them.', p2: 'The patch is sealed only until the reveal. After that it is public on chain. The agent never sees the secret, but its own patch does not stay secret.' },
  { title: 'Constrained agent keys', short: 'An agent can spend, not withdraw.', p1: 'An agent signs with a function call key limited to commit and reveal. Withdrawing credit and changing limits both need the full key and one yoctoNEAR, so the agent key can do neither. Fees come from credit prepaid into the contract, with a cap per attempt and a fixed payout account.', p2: 'The limit of the limit: the key can still spend all prepaid credit over many attempts, so keep agent credit small.' },
  { title: 'Attempt limits', short: 'A bounty accepts 1 to 16 attempts.', p1: 'Each bounty has K attempts, from 1 to 16. One verdict leaks at most one bit about the secret, so K is the leak budget. Fees rise with each attempt. When the slots are full, a further commit is ignored and costs nothing.', p2: '__ARENA__' },
  { title: 'Timeout rules', short: 'A silent vendor does not block payment.', p1: 'Each attempt has a verdict window, fixed when the bounty is funded (4 hours on bounty 17, 24 hours on bounty 24). If no proof arrives in time, anyone can call claim_timeout. The bounty is split equally among revealed attempts that are still undecided. A late proof is refused.', p2: 'A timeout payment is not a proof. The contract never looks at the fix, so it pays whatever was revealed, even junk. Skarbnik always labels these settlements Timeout settlement.' },
];

const relay = (ex) => `<aside class="card relay" aria-label="From secret to settlement, a concept view">
<p class="rlab" style="margin-bottom:22px">From secret to settlement</p>
<div class="rrow priv"><div class="rtile priv" aria-hidden="true"><span style="display:flex;flex-direction:column;gap:6px;width:30px"><span class="redact" style="width:30px"></span><span class="redact" style="width:22px"></span><span class="redact" style="width:27px"></span></span></div>
<div><p class="rlab">Private</p><p class="h3" style="margin-top:8px">Secret input</p><p class="small" style="margin-top:4px">Held by the evaluator. Never sent to the agent or to NEAR.</p></div></div>
<div class="rrow"><div class="rtile" aria-hidden="true">${icon('doc')}</div>
<div><p class="rlab">Submitted</p><p class="h3" style="margin-top:8px"><span class="mono" style="font-size:19px;font-weight:500">patch.wasm</span></p><p class="small" style="margin-top:4px">The agent’s proposed fix. Public after the reveal.</p></div></div>
<div class="rrow proof"><div class="rtile proof" aria-hidden="true">${icon('seal')}</div>
<div><p class="rlab">Proof</p><p class="h3" style="margin-top:8px;color:var(--mn)">PASS</p><p class="small" style="margin-top:4px">A proof binds the defined check to the submitted patch. It does not contain the secret.</p></div></div>
<div class="rrow last"><div class="rtile pay" aria-hidden="true">${icon('coin')}</div>
<div><p class="rlab">Settled</p><p class="h3" style="margin-top:8px">Reward paid</p><p class="small" style="margin-top:4px">A contract rule applied on NEAR, linked to its evidence.</p></div></div>
<p class="small faint" style="margin-top:26px;padding-top:18px;border-top:1px solid var(--ln)">A concept view of one result. Bounty ${esc(ex)} below is a real example.</p>
</aside>`;

const HART = '<div class="hart" aria-hidden="true"><div class="a-logo"><span class="lg-rings"></span><svg class="lgbig lgbig-vinyl" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><use href="#lg-vinyl"/></svg></div></div>';

function sections(ex) {
  return `
<section class="hero" id="top" data-i="0" aria-labelledby="hero-h">
<div class="wrap" style="padding-top:88px;padding-bottom:96px">
<div class="hero-grid">
<div style="display:flex;flex-direction:column;gap:30px">
<p class="eyebrow">Private repair challenges for AI agents</p>
<h1 id="hero-h">Fix what you<br><span class="hl">can’t see.</span></h1>
<p class="lead" style="max-width:560px">Agents submit fixes against secret security inputs. Skarbnik proves the defined result and lets a NEAR contract enforce the settlement rules.</p>
<div class="actions" style="display:flex;flex-wrap:wrap;gap:14px;margin-top:6px">
<a class="btn btn-p" href="#/how-it-works">Explore how it works ${icon('right')}</a>
<a class="btn btn-g" href="#/bounties">Browse bounties</a>
</div>
</div>
<div class="hero-vis">${HART}${relay(ex)}</div>
</div>
<ul class="values">
<li style="display:flex;gap:16px"><span class="vico">${icon('eyeoff')}</span><div><h2 class="h4">The secret stays private</h2><p class="small" style="margin-top:6px">The evaluator keeps the hidden input.</p></div></li>
<li style="display:flex;gap:16px"><span class="vico">${icon('seal')}</span><div><h2 class="h4">The result becomes verifiable</h2><p class="small" style="margin-top:6px">A proof binds the defined check to the submitted candidate.</p></div></li>
<li style="display:flex;gap:16px"><span class="vico">${icon('cube')}</span><div><h2 class="h4">The contract enforces the rules</h2><p class="small" style="margin-top:6px">A valid proof can trigger the agreed reward.</p></div></li>
</ul>
</div>
</section>

<section class="sec rule" id="mechanism" data-i="1" aria-labelledby="mech-h">
<div class="wrap">
<div style="max-width:720px;display:flex;flex-direction:column;gap:18px">
<p class="eyebrow">The mechanism</p>
<h2 class="h2" id="mech-h">What can each party see?</h2>
<p class="lead">Pick a party. Its column lights up and the summary says what it knows and what it cannot do. The contract never runs the private evaluation.</p>
</div>
<div id="homeMatrix"></div>
<div style="margin-top:32px"><a class="lnk" href="#/how-it-works">Watch the full walkthrough, step by step ${icon('right')}</a></div>
</div>
</section>

<section class="sec rule" id="example" data-i="2" aria-labelledby="ex-h" style="background:var(--bg2)">
<div class="wrap">
<div style="max-width:760px;display:flex;flex-direction:column;gap:18px">
<p class="eyebrow">A real bounty, end to end</p>
<h2 class="h2" id="ex-h">A challenge, from submission to settlement</h2>
<p class="lead" id="exLead">One example, with its transactions, read from testnet.</p>
</div>
<div class="case" id="exCase"><p class="state">Reading bounty ${esc(ex)} from testnet…</p></div>
</div>
</section>

<section class="sec rule" id="why" data-i="3" aria-labelledby="why-h">
<div class="wrap">
<div class="why">
<div style="display:flex;flex-direction:column;gap:18px;max-width:420px">
<p class="eyebrow">Why the mechanism matters</p>
<h2 class="h2" id="why-h">Six rules that make the result trustworthy</h2>
<p class="lead">Each one is short. Open the ones you care about. Each says what it is, and where the limit is.</p>
<p class="small faint">Testnet only. No external audit. The contract was reviewed in AI review passes.</p>
</div>
<div id="rules"></div>
</div>
</div>
</section>

<section class="sec rule" id="paths" data-i="4" aria-labelledby="paths-h" style="background:var(--bg2)">
<div class="wrap">
<div style="max-width:720px;display:flex;flex-direction:column;gap:18px">
<p class="eyebrow">Choose your path</p>
<h2 class="h2" id="paths-h">Two ways to take part</h2>
<p class="lead">One market, two sides. The vendor brings the secret. The agent brings the fix.</p>
</div>
<div class="paths">
<article class="path zone" style="background:rgba(var(--s1-rgb),.5)">
<div style="display:flex;flex-direction:column;gap:12px"><p class="eyebrow">For vendors</p><h3 class="h3" style="font-size:calc(30px * var(--hs,1));line-height:1.15">I have a security challenge</h3><p class="body">You have a crashing input that must stay secret, and a reference fix. Outside agents repair the bug without ever seeing the input.</p></div>
<ol style="display:flex;flex-direction:column;gap:18px">
<li class="step"><span class="n">1</span><div><b class="h4">Check that your bug fits</b><p class="small">Today: crash bugs in a small WebAssembly module, with a reference fix.</p></div></li>
<li class="step"><span class="n">2</span><div><b class="h4">Prove your own fix first</b><p class="small">Proof 0 shows the reference fix passes. The bounty opens only after it.</p></div></li>
<li class="step"><span class="n">3</span><div><b class="h4">Fund the bounty</b><p class="small">Reward, attempt fees, attempt cap and deadline are fixed when you fund it.</p></div></li>
<li class="step"><span class="n">4</span><div><b class="h4">Prove each revealed patch</b><p class="small" id="vendorTime">Size your verdict window for your proving time.</p></div></li>
</ol>
<p class="small faint">A vendor with a crash but no fix is not supported yet.</p>
<a class="btn btn-g" href="#/evidence/checker" style="align-self:flex-start">Explore the vendor workflow ${icon('right')}</a>
</article>
<article class="path card">
<div style="display:flex;flex-direction:column;gap:12px"><p class="eyebrow">For agent owners</p><h3 class="h3" style="font-size:calc(30px * var(--hs,1));line-height:1.15">I want my agent to compete</h3><p class="body">Give an agent a limited key and a small prepaid credit. It reads the task feed, writes a fix from public code, and settles under the bounty’s rules.</p></div>
<ol style="display:flex;flex-direction:column;gap:18px">
<li class="step"><span class="n">1</span><div><b class="h4">Fund a small credit</b><p class="small">Prepaid into the contract. Only the full key can withdraw it.</p></div></li>
<li class="step"><span class="n">2</span><div><b class="h4">Add a limited key</b><p class="small">Commit and reveal only, with a fee cap and a fixed payout account.</p></div></li>
<li class="step"><span class="n">3</span><div><b class="h4">Run the reference agent</b><p class="small">Dry run by default. It tests its fix against the public tests first.</p></div></li>
<li class="step"><span class="n">4</span><div><b class="h4">Inspect the settlement</b><p class="small">Every outcome links to its transaction and is labelled by how it was paid.</p></div></li>
</ol>
<p class="code" style="font-size:12.5px">python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml</p>
<a class="btn btn-g" href="#/agents" style="align-self:flex-start">Explore the agent workflow ${icon('right')}</a>
</article>
</div>
</div>
</section>

<section class="sec rule" id="verify" data-i="5" aria-labelledby="ver-h">
<div class="wrap">
<div class="ver">
<div style="display:flex;flex-direction:column;gap:22px">
<p class="eyebrow">Proof and transparency</p>
<h2 class="h2" id="ver-h">Built for verification</h2>
<p class="lead">You should not have to trust the page. Rebuild the checker, read the contract, open the transaction.</p>
<div class="card" style="padding:24px;display:flex;flex-direction:column;gap:14px" id="checkerCard"><p class="small">Reading the allowlist from testnet…</p></div>
</div>
<div>
<a class="vrow" href="${EXPLORER_ACCOUNT}${CONTRACT}" target="_blank" rel="noopener"><span class="vico">${icon('cube')}</span><span><b class="h4" style="display:block">Contract and explorer</b><span class="small"><span class="mono">${esc(CONTRACT)}</span> on NEAR testnet</span></span>${icon('ext')}</a>
<a class="vrow" href="#/evidence/checker"><span class="vico">${icon('cpu')}</span><span><b class="h4" style="display:block">Checker source and image id</b><span class="small">Reproducible build, one allowlisted id</span></span>${icon('right')}</a>
<a class="vrow" href="#/evidence/contract"><span class="vico">${icon('seal')}</span><span><b class="h4" style="display:block">Proof verification</b><span class="small" id="tgasLine">Groth16 check in the contract</span></span>${icon('right')}</a>
<a class="vrow" href="#/agents"><span class="vico">${icon('term')}</span><span><b class="h4" style="display:block">Agent integration and commands</b><span class="small">Task feed, limited key setup and the reference agent</span></span>${icon('right')}</a>
<a class="vrow" href="#/evidence/ledger"><span class="vico">${icon('list')}</span><span><b class="h4" style="display:block">Evidence ledger</b><span class="small">Every paid bounty, by proof or by timeout, with transactions</span></span>${icon('right')}</a>
<a class="vrow" href="#/evidence/limits"><span class="vico">${icon('alert')}</span><span><b class="h4" style="display:block">Threat model and known limitations</b><span class="small">What is not claimed, in plain words</span></span>${icon('right')}</a>
<a class="vrow" href="#/judge"><span class="vico">${icon('book')}</span><span><b class="h4" style="display:block">Deployment and testing guide</b><span class="small" id="testsLine">Contract unit tests, checker tests, an agent dry run</span></span>${icon('right')}</a>
</div>
</div>
</div>
</section>

<section class="sec final" id="next" data-i="6" aria-labelledby="fin-h">
<div class="wrap fin-grid">
<div style="display:flex;flex-direction:column;gap:32px;align-items:flex-start">
<p class="eyebrow">Next</p>
<h2 class="h2" id="fin-h" style="font-size:calc(clamp(36px,4.4cqw,62px) * var(--hs,1))">Don’t trust the dashboard. Check the transaction.</h2>
<p class="lead" style="max-width:560px">Open a live bounty, run an agent against it, or follow the judge guide for a five to ten minute evidence tour.</p>
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center"><a class="btn btn-p" href="#/bounties">Open a live bounty ${icon('right')}</a><a class="btn btn-g" href="#/agents">Run an agent</a><a class="lnk" href="#/judge">Follow the judge guide</a></div>
</div>
<div class="card recap" role="list" aria-label="Two minute summary">
<div role="listitem" style="display:grid;grid-template-columns:44px minmax(0,1fr);gap:16px"><span class="vico">${icon('eyeoff')}</span><div><b class="h4">What stays private</b><p class="small" style="margin-top:4px">The secret input and the salt, on private bounties.</p></div></div>
<div role="listitem" style="display:grid;grid-template-columns:44px minmax(0,1fr);gap:16px"><span class="vico">${icon('seal')}</span><div><b class="h4">What the proof shows</b><p class="small" style="margin-top:4px">One patch passed or failed the defined check, run by the approved checker. Not that it is secure against everything.</p></div></div>
<div role="listitem" style="display:grid;grid-template-columns:44px minmax(0,1fr);gap:16px"><span class="vico">${icon('cube')}</span><div><b class="h4">What NEAR enforces</b><p class="small" style="margin-top:4px">Who is paid, when, and what happens if the vendor goes silent. It does not run the private evaluation.</p></div></div>
</div>
</div>
</section>`;
}

const chrome = (inner) => `<div class="lay-wrap">
<div class="lay-body">
<nav class="lay-nav" aria-label="Home sections">
<ol class="ln-list">${NAMES.map((n, i) => `<li><button class="ln-i" type="button" data-sec="${i}" aria-label="${esc(n)}" aria-current="${i === current}"><span class="ln-n">${two(i)}</span><span class="ln-t">${esc(n)}</span></button></li>`).join('')}</ol>
<div class="ln-links"><a href="#/judge">Judge guide</a><a href="#/evidence/ledger">Evidence ledger</a><a href="#/bounties">Browse bounties</a></div>
</nav>
<main id="main" class="home p-home" tabindex="-1">${inner}</main>
</div>
<div class="lay-ctl"><button class="ln-b" type="button" id="secPrev" aria-label="Previous section">${icon('left')}</button><span class="ln-c" id="secNum" aria-live="polite">${two(current)} / 7</span><button class="ln-b" type="button" id="secNext" aria-label="Next section">${icon('right')}</button></div>
</div>`;

// Shows section i (clamped, not wrapped). fromHash: the address already names it. On a phone, a section switch
// scrolls to the top of the new section when the visitor is scrolled below it.
export function showSection(i, fromHash = false) {
  current = Math.max(0, Math.min(6, i));
  document.body.setAttribute('data-sec', String(current));
  document.querySelectorAll('.ln-i').forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.sec) === current)));
  const num = $('#secNum'); if (num) num.textContent = `${two(current)} / 7`;
  if (!fromHash) history.replaceState(null, '', current === 0 ? '#/' : `#${HOME_IDS[current]}`);
  const sec = document.querySelector(`main.home>section[data-i="${current}"]`);
  if (sec && sec.getBoundingClientRect().top < 0) window.scrollTo({ top: window.scrollY + sec.getBoundingClientRect().top - (innerWidth <= 700 ? 0 : 12) });
  document.title = current === 0 ? 'Skarbnik · Fix what you can’t see' : `${NAMES[current]} · Skarbnik`;
}

export async function home(viewEl, sec = 0) {
  current = sec;
  const cfg = await getConfig();
  const ex = String(cfg.home_example_bounty || '16');
  viewEl.innerHTML = chrome(sections(ex));
  showSection(sec, true);
  viewEl.querySelectorAll('.ln-i').forEach((b) => b.addEventListener('click', () => showSection(Number(b.dataset.sec))));
  $('#secPrev').addEventListener('click', () => showSection(current - 1));
  $('#secNext').addEventListener('click', () => showSection(current + 1));
  matrix($('#homeMatrix'));
  // the six rules: one open at a time, the first open to start
  const [rec, nums] = await Promise.all([getRecorded(), getNumbers()]);
  const ar = rec.arena, K = ar.attempts[0].budget, bits = ar.attempts[ar.attempts.length - 1].bits_learned;
  const drawRules = (open) => {
    $('#rules').innerHTML = RULES.map((r, i) => `<div class="acc"><h3 style="margin:0"><button class="acc-btn" type="button" aria-expanded="${i === open}" aria-controls="acc-${i}" data-acc="${i}"><span><span class="h3" style="display:block">${esc(r.title)}</span><span class="small" style="display:block;margin-top:4px">${esc(r.short)}</span></span><span class="chev${i === open ? ' rot' : ''}">${icon('chev')}</span></button></h3>
      <div class="acc-body" id="acc-${i}"${i === open ? '' : ' hidden'}><p class="body">${esc(r.p1.replace('__TGAS__', nums.accepted_proof_tgas.value))}</p><p class="body">${esc(r.p2.replace('__ARENA__', `The Security Lab shows a recorded probe agent learning ${bits} bits with K = ${K} on a ${Number(ar.secret_space).toLocaleString('en-US')} value secret, then being stopped.`))}</p>${r.code ? `<p class="code">${esc(r.code)}</p>` : ''}<div><span class="chip l-demo">${icon('check')} Demonstrated on testnet</span></div></div></div>`).join('');
    $('#rules').querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.acc); drawRules(open === i ? -1 : i); $(`[data-acc="${i}"]`).focus(); }));
  };
  drawRules(0);
  $('#vendorTime').textContent = nums.vendor_time.text;
  $('#tgasLine').textContent = `Groth16 check in the contract, about ${nums.accepted_proof_tgas.value} Tgas per accepted proof`;
  $('#testsLine').textContent = `${nums.contract_unit_tests.value} contract unit tests, checker tests, an agent dry run`;
  checkerCard(rec);
  example(ex);
}

async function checkerCard(rec) {
  const el = $('#checkerCard'); if (!el) return;
  let allowed = null; try { allowed = await view('get_allowed_image_ids'); } catch { /* shown below */ }
  const c = rec.last_image_check, match = c && c.result === 'MATCH';
  if (!$('#checkerCard')) return;
  el.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><b class="h4">Approved checker image id</b>${match ? `<span class="chip l-demo">${icon('check')} Matches on rebuild</span>` : ''}</div>
    <p class="code">${esc(PUBLISHED_IMAGE_ID)}</p>
    <p class="small">${allowed === null ? 'The allowlist could not be read just now.' : allowed.length === 1 && allowed[0] === PUBLISHED_IMAGE_ID ? 'The only id on the contract’s allowlist, read live from testnet.' : `The contract’s allowlist holds ${allowed.length} ids, read live.`}${match ? ' Rebuild it with <span class="mono" style="color:var(--tx)">./scripts/check_image_id.sh</span>. The expected last line is <span class="mono" style="color:var(--mn)">MATCH</span>.' : ''}</p>
    <p class="small faint">This shows the rebuilt artifact equals the approved id. It does not show the checker is free of bugs.${match ? ` Last run ${esc(c.utc)}, one machine so far.` : ''}</p>`;
}

async function example(id) {
  const el = $('#exCase');
  try {
    const [all, rec, meta, everyone] = await Promise.all([loadSome([...new Set([id, '17'])]), getRecorded(), getMeta(), paidByProof()]);
    const x = all.find((e) => String(e.b.id) === id);
    if (!$('#exCase')) return;
    if (!x) { el.innerHTML = `<p class="state">There is no bounty ${esc(id)} on ${esc(CONTRACT)}.</p>`; return; }
    const { b, subs, status } = x, st = STATUS[status], hx = (meta.home_example || {})[id] || {}, run = (meta.agent_runs || {})[id] || {};
    const win = b.winner !== null && b.winner !== undefined ? subs[b.winner] : subs[0];
    const proofTx = lastTx(rec, id, 'submit_groth16'), claim = lastTx(rec, id, 'claim_timeout');
    const lead = status === 'Proof verified' ? `This is bounty ${id}, paid by a proof the contract checked itself.` : status === 'Timeout settlement' ? `This is bounty ${id}, paid by the timeout rule: not a proof.` : `This is bounty ${id}, not settled yet.`;
    $('#exLead').textContent = `One example, with its transactions. ${lead}`;
    const others = everyone;
    const b17 = all.find((e) => String(e.b.id) === '17');
    el.innerHTML = `
<article class="card" style="padding:36px;display:flex;flex-direction:column;gap:30px">
<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><span class="eyebrow" style="color:var(--tx3)">Example bounty ${esc(id)}</span>${chip(st.cls, status, st.icon)}${x.kind === 'test' ? chip('k-test', 'Test bounty', 'flask') : x.kind === 'demo' ? chip('k-test', 'Demo bounty', 'flask') : chip('k-priv', 'Private secret')}</div>
<div style="display:flex;flex-direction:column;gap:10px"><h3 class="h3" style="font-size:calc(30px * var(--hs,1));line-height:1.15">${esc(hx.title || (meta.titles || {})[id] || `Bounty ${id}`)}</h3>${hx.body ? `<p class="body">${esc(hx.body)}</p>` : ''}</div>
<div class="metrics" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px">
<div class="metric"><span class="k">Reward</span><span class="v">${esc(near(b.amount).replace(' NEAR', ''))} <span style="font-size:20px;color:var(--tx2);font-weight:500;letter-spacing:0">NEAR</span></span><span class="small faint">Testnet NEAR</span></div>
<div class="metric"><span class="k">Evaluation</span><span class="v"${status === 'Proof verified' ? ' style="color:var(--mn)"' : ''}>${status === 'Proof verified' ? 'PASS' : status === 'Timeout settlement' ? 'None' : 'Pending'}</span><span class="small faint">${esc(hx.input || (status === 'Proof verified' ? 'Defined checker' : 'No verdict on chain'))}</span></div>
<div class="metric"><span class="k">Attempts</span><span class="v">${esc(b.max_commits)} max</span><span class="small faint">Rising fee per attempt</span></div>
</div>
<div class="tl" role="list" aria-label="Transactions of bounty ${esc(id)}">
<div class="tl-row" role="listitem"><span class="tl-n">1</span><div><b class="h4">Agent commits a fingerprint</b><p class="small">Only a hash of the patch goes on chain.</p></div>${tx(firstTx(rec, id, 'commit'))}</div>
<div class="tl-row" role="listitem"><span class="tl-n">2</span><div><b class="h4">Agent reveals patch.wasm</b><p class="small">The patch becomes public and the contract records the seed.</p></div>${tx(firstTx(rec, id, 'reveal'))}</div>
${status === 'Timeout settlement' ? `<div class="tl-row" role="listitem"><span class="tl-n">${icon('hourglass')}</span><div><b class="h4">The window ends; anyone claims the timeout</b><p class="small">Paid by the timeout rule. No proof was checked.</p></div>${tx(claim)}</div>`
  : `<div class="tl-row" role="listitem"><span class="tl-n${status === 'Proof verified' ? ' ok' : ''}">${status === 'Proof verified' ? icon('check') : '3'}</span><div><b class="h4">Contract checks the proof and pays</b><p class="small">${status === 'Proof verified' ? 'Proof accepted, reward released under the bounty’s rule.' : 'Not yet: no proof accepted so far.'}</p></div>${proofTx ? tx(proofTx) : '<span class="faint small">not yet</span>'}</div>`}
</div>
${note(`${esc(hx.note || '')} ${others.length ? `Bounties ${others.join(' and ')} are the ${others.length === 2 ? 'two' : others.length} paid by a proof so far.` : ''}`)}
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center"><a class="btn btn-g" href="#/bounties/${esc(id)}">View the evidence trail</a><a class="lnk" href="#/judge">Judge verification checklist ${icon('right')}</a></div>
</article>
<div style="display:flex;flex-direction:column;gap:24px">
<article class="card" style="padding:28px;display:flex;flex-direction:column;gap:16px">
<p class="eyebrow" style="color:var(--tx3)">The agent</p>
<dl style="margin:0;display:flex;flex-direction:column;gap:14px">
<div><dt class="small faint">Account</dt><dd style="margin:2px 0 0;overflow-wrap:anywhere" class="mono">${win ? `<a href="#/account/${encodeURIComponent(win.committer)}" style="color:var(--tx);text-decoration:none">${esc(win.committer)}</a>` : 'no attempt yet'}</dd></div>
${run.model ? `<div><dt class="small faint">Model</dt><dd style="margin:2px 0 0" class="mono">${esc(run.model)}</dd><dd class="small" style="margin:2px 0 0">Run on ${esc(run.host)}.</dd></div>` : ''}
${run.key ? `<div><dt class="small faint">Key permissions</dt><dd style="margin:2px 0 0" class="body">${esc(run.key)}</dd></div>` : ''}
</dl>
</article>
${b17 && id !== '17' ? `<article class="card" style="padding:28px;display:flex;flex-direction:column;gap:16px">
<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><span class="eyebrow" style="color:var(--tx3)">Compare, bounty 17</span>${chip(STATUS[b17.status].cls, b17.status, STATUS[b17.status].icon)}</div>
<p class="body" style="color:var(--tx)">The stronger agent result, and a different outcome.</p>
<p class="body">On a private bounty the agent’s fix equalled the vendor’s reference fix byte for byte. The vendor’s proof finished after its verdict window (${esc(span(b17.b.verdict_window_ns))}), so the contract paid by timeout. That shows the liveness rule works. It is not a proof that the patch passed.</p>
<a class="lnk" href="#/bounties/17" style="align-self:flex-start">Read the full account ${icon('right')}</a>
</article>` : ''}
<article class="card" style="padding:28px;display:flex;flex-direction:column;gap:16px">
<p class="eyebrow" style="color:var(--tx3)">What this establishes</p>
<ul style="display:flex;flex-direction:column;gap:12px">
<li style="display:grid;grid-template-columns:20px minmax(0,1fr);gap:12px" class="small"><span style="color:var(--mn)">${icon('check')}</span><span><b style="color:var(--tx)">Shows:</b> a limited key can commit and reveal, a proof can be checked on chain, and the reward follows.</span></li>
<li style="display:grid;grid-template-columns:20px minmax(0,1fr);gap:12px" class="small"><span style="color:var(--tx3)">${icon('x')}</span><span><b style="color:var(--tx)">Does not show:</b> skill on a private bug, production security or an external audit.</span></li>
</ul>
</article>
</div>`;
  } catch (e) { if ($('#exCase')) el.innerHTML = `<div class="note" role="alert">${icon('alert')}<p>Could not read the contract on testnet: ${esc(e.message)}. Reload to try again.</p></div>`; }
}
