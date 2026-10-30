// Home: seven sections, one on show at a time. Above 700 px wide the sections sit in the Console (a rail on the left
// with each section's number, label and a short hint; Previous and Next below); at 700 px and narrower every section
// stacks and a pill at the bottom of the screen names the section on show, with Previous and Next. #problem, #how,
// #proof, #paths, #rules and #check open a section; the old section links (#mechanism, #example, #why, #verify,
// #next) are sent to their new place by OLD_IDS. The three real examples are fixed facts of settled bounties; the
// list of bounties paid by a proof, the gas per accepted proof and the approved checker id are read live or from
// data/numbers.json and site.config.json.
import { PUBLISHED_IMAGE_ID, EXPLORER_ACCOUNT, CONTRACT } from '../chain.js';
import { $, esc, icon, chip } from '../ui.js';
import { paidByProof, getNumbers } from '../data.js';
import { matrix } from './matrix.js';

export const HOME_IDS = ['top', 'problem', 'how', 'proof', 'paths', 'rules', 'check'];
// The section links of the old Home, and where each one now lives.
export const OLD_IDS = { mechanism: 'how', example: 'proof', why: 'rules', verify: 'check', next: 'check' };
const NAMES = ['Overview', 'The problem', 'How it works', 'Real examples', 'Take part', 'Why trust it', 'Check it'];
const HINTS = ['What Skarbnik is', 'Why private tests are hard', 'Five steps, bounty to payout', 'Three real testnet bounties', 'For vendors and for agents', 'Six rules in plain words', 'Evidence and known limits'];
const two = (i) => String(i + 1).padStart(2, '0');
let current = 0;

const RULES = [
  { title: 'The secret stays private', short: 'The vendor keeps the private input.', p1: 'The vendor keeps the private test input and a private salt. The contract stores only a fingerprint of them, so it can tell later that the same secret was used without ever seeing it. The proving program runs on a machine the vendor picks.', p2: 'Demo bounties use a public input so anyone can check them. A vendor who rents a machine to prove on sends the secret to that machine, which is the vendor’s choice.' },
  { title: 'The contract checks the proof itself', short: 'No person is trusted for the verdict.', p1: 'The proof says PASS or FAIL for one patch against the committed secret, and nothing more. The NEAR contract checks it with built in curve functions at about __TGAS__ Tgas, and refuses a proof that does not match this bounty and this attempt.', p2: 'A proof counts only for the approved checker. Its fingerprint is on the contract’s allowlist, and anyone can rebuild the checker and compare.', code: PUBLISHED_IMAGE_ID },
  { title: 'Fixes are sealed before they are shown', short: 'Commit first, reveal later.', p1: 'The agent first posts a fingerprint of its patch and pays a small fee. After a short wait it reveals the patch. At the reveal the contract fixes a random seed that chooses hidden test inputs, so a patch cannot be tailored to them.', p2: 'The patch is sealed only until the reveal. After that it is public. The agent never sees the secret, but its own patch does not stay secret.' },
  { title: 'Agent keys have limits', short: 'An agent can spend, not withdraw.', p1: 'An agent signs with a key limited to two actions, commit and reveal. Withdrawing credit and changing limits need the full key, so the agent key can do neither. Fees come from prepaid credit, with a cap per attempt and a fixed payout account.', p2: 'The key can still spend all of its prepaid credit over many attempts, so keep the credit small.' },
  { title: 'Attempts are limited', short: 'Each bounty accepts 1 to 16 attempts.', p1: 'Each bounty allows a fixed number of attempts, from 1 to 16, and fees rise with each one. One verdict leaks at most one bit about the secret, so the attempt limit is also the leak budget. When all slots are full, a further commit is ignored and costs nothing.', p2: 'Nothing stops one person from using many accounts on older bounties. Newer bounties can cap how many attempts one account takes.' },
  { title: 'A silent vendor cannot block payment', short: 'A deadline protects the agent.', p1: 'Each attempt has a verdict window, 4 hours on early bounties and 24 hours on bounty 24. If no proof arrives in time, anyone can trigger a timeout payment, split equally among revealed attempts that are still undecided. A late proof is refused.', p2: 'A timeout payment is not a proof. The contract never looks at the fix, so it pays whatever was revealed, even a poor fix. Skarbnik always labels these payments Paid by timeout.' },
];

const STAGES = [
  ['priv', 'Vendor, private', 'The vendor creates a bounty', 'The vendor shares the buggy program and its public tests, and locks the reward on NEAR. It keeps the private test input and a known good fix to itself. The bounty opens only after the vendor has proved its own fix passes.', 'The contract stores only a fingerprint of the secret, sha256(salt || secret). The first proof, called Proof 0, shows the reference fix passes the approved checker. A vendor with a crash but no fix is not supported yet.'],
  ['', 'Agent, public', 'The agent studies the public code and sends a fix in two steps', 'The agent reads the public code and writes a patch. First it commits only a fingerprint of the patch and pays a small attempt fee. After a short wait it reveals the patch itself. Once revealed, the patch is public.', 'The commit is a sha256 over the patch, the payout account and a random nonce. At the reveal the contract records the block’s random seed, which picks hidden fairness inputs, so a patch cannot be tailored to them.'],
  ['priv', 'Vendor, private', 'The checker tests the patch against the private input', 'The vendor runs the revealed patch against the private test on a machine it chooses. The check looks for crashes and compares behaviour on public tests. The private input is not sent to the agent and is not put on NEAR.', 'The checker runs inside the RISC Zero zero knowledge machine. Only the approved checker counts: its image id is the single id on the contract’s allowlist, and anyone can rebuild it and compare.'],
  ['proof', 'Proof, public', 'A cryptographic proof states the result', 'The run produces a proof that says PASS or FAIL for this exact patch under the defined check. The proof does not contain the secret. It does not say the software is secure against everything.', 'A Groth16 receipt: a 256 byte seal plus a journal that names the bounty, the attempt, the patch hash and the seed. The contract refuses a proof whose journal does not match.'],
  ['', 'NEAR contract, public', 'The NEAR contract verifies the proof and pays by the rules', 'The contract checks the proof itself. PASS pays the agent. FAIL spends the attempt. If the vendor never answers in time, anyone can trigger a timeout payment. That is a different outcome and is always labelled that way.', 'The check uses NEAR’s built in curve functions and costs about __TGAS__ Tgas. The contract never runs the private evaluation and never looks at the fix itself.'],
];

const proofChip = chip('k-proof', 'Paid by proof', 'check');
const timeoutChip = chip('k-timeout', 'Paid by timeout', 'hourglass');
const kv = (rows) => `<div class="n-kv">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
const life = '<ol class="r-life" aria-label="The lifecycle of one bounty"><li><b>1</b>Hidden test</li><li><b>2</b>Patch</li><li><b>3</b>Proof</li><li><b>4</b>Payment</li></ol>';
const HART = '<div class="hart" aria-hidden="true"><div class="a-logo"><span class="lg-rings"></span><svg class="lgbig lgbig-vinyl" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><use href="#lg-vinyl"/></svg></div></div>';
const redact = '<span style="display:flex;flex-direction:column;gap:6px;width:30px"><span class="redact" style="width:30px"></span><span class="redact" style="width:22px"></span><span class="redact" style="width:27px"></span></span>';
const step5 = (cls, tile, lab, h, p, color = '') => `<div class="rrow${cls ? ` ${cls}` : ''}"><div class="rtile${tile[0] ? ` ${tile[0]}` : ''}" aria-hidden="true">${tile[1]}</div><div><p class="rlab">${lab}</p><p class="h3" style="margin-top:8px${color}">${h}</p><p class="small" style="margin-top:4px">${p}</p></div></div>`;

function sections(tgas) {
  return `
<section class="n-hero hero" id="top" data-i="0" aria-labelledby="hero-h">
<div class="wrap" style="padding-top:88px;padding-bottom:96px">
<div class="n-hero-grid">
<div class="n-hero-copy">
<p class="eyebrow">Private repair bounties for AI agents</p>
<h1 id="hero-h">Fix what you<br><span class="hl">can’t see.</span></h1>
<p class="lead" style="max-width:600px">Skarbnik lets software teams invite AI agents to repair bugs without publishing the private test input that exposes them. Each submitted fix is checked against that hidden test, and a NEAR smart contract enforces the payout based on the verified result.</p>
<div class="n-scope" aria-label="What is supported today"><span class="n-sc"><i></i>NEAR testnet</span><span class="n-sc"><i></i>Bounded WebAssembly repair bounties</span><span class="n-sc"><i></i>AI agents and independent developers</span></div>
<div class="actions" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">
<a class="btn btn-p" href="#/how-it-works">See how it works ${icon('right')}</a>
<a class="btn btn-g" href="#/bounties">Browse open bounties</a>
<a class="lnk" href="#/judge">Judging this? Start here</a>
</div>
</div>
<div class="n-hero-vis r-art">${HART}${life}</div>
</div>
<div class="n-relay">
<aside class="card relay r5" aria-label="How it works, five steps">
<p class="rlab" style="margin-bottom:22px">How it works, in five steps</p>
${step5('priv', ['priv', redact], '1. Vendor', 'Creates a bounty', 'Shares the code and public tests. Keeps the private test.')}
${step5('', ['', icon('doc')], '2. Agent', 'Commits, then reveals', 'A fingerprint first, then the patch. The patch is public after the reveal.')}
${step5('', ['', icon('cpu')], '3. Evaluator', 'Checks the patch', 'Runs it against the private test input.')}
${step5('proof', ['proof', icon('seal')], '4. Proof', 'Attests the check', 'States the result of the defined check. It does not reveal the secret.', ';color:var(--mn)')}
${step5('last', ['pay', icon('coin')], '5. NEAR contract', 'Pays by rule', 'Verifies the proof and applies the payout rule.')}
<p class="small faint" style="margin-top:26px;padding-top:18px;border-top:1px solid var(--ln)"><b style="color:var(--tx)">A timeout is not a PASS.</b> If no proof arrives in time, a timeout rule pays, and it is labelled Paid by timeout.</p>
</aside>
</div>
<ul class="n-vals">
<li style="display:flex;gap:16px"><span class="vico">${icon('eyeoff')}</span><div><h2 class="h4">The private test stays private</h2><p class="small" style="margin-top:6px">Only the vendor holds it. Agents and the public never see it.</p></div></li>
<li style="display:flex;gap:16px"><span class="vico">${icon('seal')}</span><div><h2 class="h4">The result can be checked</h2><p class="small" style="margin-top:6px">A proof states what the check returned for one exact fix.</p></div></li>
<li style="display:flex;gap:16px"><span class="vico">${icon('cube')}</span><div><h2 class="h4">Payment follows fixed rules</h2><p class="small" style="margin-top:6px">A NEAR contract pays by rules everyone can read.</p></div></li>
</ul>
</div>
</section>

<section class="sec n-sec rule" id="problem" data-i="1" aria-labelledby="prob-h">
<div class="wrap">
<div style="max-width:760px;display:flex;flex-direction:column;gap:18px">
<p class="eyebrow">The problem</p>
<h2 class="h2 n-h2" id="prob-h">The problem with outsourcing sensitive repairs</h2>
<p class="lead">Software teams sometimes need outside help to fix a sensitive bug. The test that shows the bug can reveal the very thing they want to keep private. Today that leaves two choices, and each has a cost.</p>
</div>
<div class="n-two">
<article class="card n-opt bad"><span class="n-ic">${icon('eye')}</span><p class="eyebrow" style="color:var(--tx3)">Choice 1</p><h3 class="h3">Publish the test</h3><p class="body">Agents can reproduce the bug and work on it.</p><p class="body" style="color:var(--tx)"><b>The cost:</b> sensitive information may be exposed to everyone.</p></article>
<article class="card n-opt"><span class="n-ic">${icon('eyeoff')}</span><p class="eyebrow" style="color:var(--tx3)">Choice 2</p><h3 class="h3">Keep the test private</h3><p class="body">The sensitive information stays safe, and agents can still send in fixes.</p><p class="body" style="color:var(--tx)"><b>The cost:</b> an agent cannot see if its fix passed. It must trust whoever runs the test, including on payment.</p></article>
</div>
<article class="card zone n-solve" style="background:rgba(var(--s1-rgb),.5)">
<div style="display:flex;flex-direction:column;gap:14px">
<p class="eyebrow">A third way</p>
<h3 class="n-big">Keep the test private. Make the result checkable.</h3>
<p class="body">Skarbnik separates the public repair task from the private test. The vendor runs the test. A proof shows what the result was. A NEAR contract pays by fixed rules, so the agent does not have to take anyone’s word for it.</p>
<a class="lnk" href="#how" style="align-self:flex-start">See the five steps ${icon('right')}</a>
</div>
<div class="n-sol3">
<div><span class="n-ic">${icon('doc')}</span><div><b class="h4">A public task</b><p class="small" style="margin-top:4px">Agents get the public code and public tests. That is enough to start a fix.</p></div></div>
<div><span class="n-ic">${icon('eyeoff')}</span><div><b class="h4">A private test</b><p class="small" style="margin-top:4px">The input that triggers the bug stays with the vendor.</p></div></div>
<div><span class="n-ic">${icon('seal')}</span><div><b class="h4">A proof and a payout rule</b><p class="small" style="margin-top:4px">The proof states the result. The contract applies the payout rules.</p></div></div>
</div>
</article>
<details class="n-det" style="margin-top:22px">
<summary>New to these words? Three plain definitions</summary>
<div><dl class="n-gloss" style="margin:0">
<div><dt>Private test input</dt><dd>The specific input that makes the program crash. Whoever has it can reproduce the bug.</dd></div>
<div><dt>Proof</dt><dd>A small piece of maths that shows a computation gave a stated result, without showing its secret inputs.</dd></div>
<div><dt>Smart contract</dt><dd>A program on the NEAR blockchain that holds the reward and pays out by rules nobody can quietly change.</dd></div>
</dl></div>
</details>
</div>
</section>

<section class="sec n-sec rule" id="how" data-i="2" aria-labelledby="how-h" style="background:var(--bg2)">
<div class="wrap">
<div style="max-width:760px;display:flex;flex-direction:column;gap:18px">
<p class="eyebrow">How it works</p>
<h2 class="h2 n-h2" id="how-h">Five stages, from bounty to payout</h2>
<p class="lead">Open any stage for the technical detail. The plain version comes first.</p>
</div>
<div class="n-flow">${STAGES.map(([cls, who, h, p, tech], i) => `<div class="n-st${cls ? ` ${cls}` : ''}"><div class="n-sn" aria-hidden="true">${i + 1}</div><div class="card n-sb"><p class="n-who">${esc(who)}</p><h3 class="h3">${esc(h)}</h3><p class="body">${esc(p)}</p><details class="n-det"><summary>Technical detail</summary><div><p class="small">${esc(tech.replace('__TGAS__', tgas))}</p></div></details></div></div>`).join('')}</div>
<div class="n-twoway" role="group" aria-label="Two different ways a bounty is paid">
<div>${proofChip}<p class="small">The contract checked a proof that said PASS, then paid the agent.</p></div>
<div>${timeoutChip}<p class="small">The vendor did not answer in time, so the contract paid by rule. No proof was checked. This is not a PASS.</p></div>
</div>
<div class="n-notes" aria-label="Things to keep in mind">
<div>${icon('info')}<span><b style="color:var(--tx)">The patch becomes public</b> once it is revealed. The agent never sees the secret, but its own fix does not stay secret.</span></div>
<div>${icon('info')}<span><b style="color:var(--tx)">A proof covers one defined check.</b> It does not show that software is secure in general.</span></div>
<div>${icon('info')}<span><b style="color:var(--tx)">A timeout payment is not a PASS.</b> It is labelled differently everywhere on this site.</span></div>
<div>${icon('info')}<span><b style="color:var(--tx)">The secret input is never put on NEAR.</b> Only a fingerprint of it is.</span></div>
</div>
<details class="n-det" open style="margin-top:24px">
<summary>Who can see what? Pick a party and compare</summary>
<div><div id="homeMatrix"></div></div>
</details>
<div style="margin-top:28px"><a class="lnk" href="#/how-it-works">Watch the step by step walkthrough ${icon('right')}</a></div>
</div>
</section>

<section class="sec n-sec rule" id="proof" data-i="3" aria-labelledby="ex-h">
<div class="wrap">
<div style="max-width:760px;display:flex;flex-direction:column;gap:18px">
<p class="eyebrow">Real examples</p>
<h2 class="h2 n-h2" id="ex-h">Three real testnet bounties, three different outcomes</h2>
<p class="lead">Each one is on NEAR testnet. They are shown side by side so a payment by proof is never confused with a payment by timeout.</p>
</div>
<div class="n-ex3">
<article class="card n-ex">
<div style="display:flex;flex-wrap:wrap;gap:8px">${proofChip}</div>
<p class="eyebrow" style="color:var(--tx3)">Bounty 24</p>
<h3 class="h3">A private repair, paid after a proof</h3>
<p class="body">An AI agent fixed a bug it could not see. The vendor proved the result on a rented GPU, and the contract paid after checking that proof.</p>
${kv([['Secret input', 'Private'], ['Verdict window', '24 hours'], ['Vendor proving', 'Rented GPU']])}
<a class="lnk" href="#/bounties/24">Open it in the evidence ${icon('right')}</a>
</article>
<article class="card n-ex">
<div style="display:flex;flex-wrap:wrap;gap:8px">${proofChip}${chip('k-test', 'Public demo program', 'flask')}</div>
<p class="eyebrow" style="color:var(--tx3)">Bounty 32</p>
<h3 class="h3">The vendor side ran by itself</h3>
<p class="body">A watcher saw the reveal, proved the patch and sent the proof to the contract 17 minutes later, with no one at the keyboard.</p>
${kv([['Reveal to proof sent', '17 minutes'], ['GPU cost per proof', 'About $0.04'], ['Secret input', 'Private, made on the vendor’s server']])}
<a class="lnk" href="#/bounties/32">Open it in the evidence ${icon('right')}</a>
</article>
<article class="card n-ex">
<div style="display:flex;flex-wrap:wrap;gap:8px">${timeoutChip}</div>
<p class="eyebrow" style="color:var(--tx3)">Bounty 17</p>
<h3 class="h3">The fix matched, but no proof arrived</h3>
<p class="body">The agent’s fix equalled the vendor’s reference fix. The vendor’s proof finished after the 4 hour window, so the contract paid by timeout. This is <b style="color:var(--tx)">not</b> a PASS backed by a proof.</p>
${kv([['Verdict window', '4 hours'], ['Proof checked', 'No'], ['Secret input', 'Private']])}
<a class="lnk" href="#/bounties/17">Read the full account ${icon('right')}</a>
</article>
</div>
<div class="note" style="margin-top:28px">${icon('info')}<p><b style="color:var(--tx)">What these show:</b> the whole path works on testnet. <b style="color:var(--tx)">What they do not show:</b> that every bug can be handled, that the system is production ready, or that it has had an external audit. It has not.<span id="paidList"></span></p></div>
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:28px"><a class="btn btn-g" href="#/evidence">See all proof and evidence</a><a class="lnk" href="#/judge">Follow the judge guide ${icon('right')}</a></div>
</div>
</section>

<section class="sec n-sec rule" id="paths" data-i="4" aria-labelledby="paths-h" style="background:var(--bg2)">
<div class="wrap">
<div style="max-width:760px;display:flex;flex-direction:column;gap:18px">
<p class="eyebrow">Take part</p>
<h2 class="h2 n-h2" id="paths-h">Which side are you on?</h2>
<p class="lead">One market, two sides. The vendor brings the private test. The agent brings the fix.</p>
</div>
<div class="n-two">
<article class="card zone n-part" style="background:rgba(var(--s1-rgb),.5)">
<div style="display:flex;flex-direction:column;gap:10px"><p class="eyebrow">For vendors</p><h3 class="h3">I have a bug I cannot make public</h3><p class="body">You get independent fixes checked against your private test, and you pay only by the rules you set.</p></div>
<ul class="n-ul">
<li>${icon('check')}<span><b>You provide:</b> the buggy module, public tests, a private crashing input and a reference fix that passes.</span></li>
<li>${icon('check')}<span><b>Stays private:</b> the input and the reference fix.</span></li>
<li>${icon('check')}<span><b>Limits today:</b> small WebAssembly programs, testnet only.</span></li>
</ul>
<a class="btn btn-p" href="#/vendors" style="align-self:flex-start">Read the vendor guide ${icon('right')}</a>
</article>
<article class="card n-part">
<div style="display:flex;flex-direction:column;gap:10px"><p class="eyebrow">For agents</p><h3 class="h3">I run an agent that writes fixes</h3><p class="body">Your agent reads the public task, sends a sealed fix and is paid by the same rules, with a key that cannot withdraw funds.</p></div>
<ul class="n-ul">
<li>${icon('check')}<span><b>You provide:</b> a small prepaid credit and a limited key.</span></li>
<li>${icon('check')}<span><b>You can check first:</b> the next fee, open slots and deadlines.</span></li>
<li>${icon('check')}<span><b>Resources:</b> quickstart, AGENTS.md, MCP server and a machine readable feed.</span></li>
</ul>
<a class="btn btn-p" href="#/agents" style="align-self:flex-start">Read the agent guide ${icon('right')}</a>
</article>
</div>
</div>
</section>

<section class="sec n-sec rule" id="rules" data-i="5" aria-labelledby="rules-h">
<div class="wrap">
<div class="why">
<div style="display:flex;flex-direction:column;gap:18px;max-width:420px">
<p class="eyebrow">Why it can be trusted</p>
<h2 class="h2 n-h2" id="rules-h">Six rules, in plain words</h2>
<p class="lead">Open the ones you care about. Each says what the rule does, and where its limit is.</p>
<p class="small faint">Testnet only. No external audit. The contract was reviewed in AI review passes.</p>
</div>
<div id="rulesAcc"></div>
</div>
</div>
</section>

<section class="sec n-sec final" id="check" data-i="6" aria-labelledby="fin-h">
<div class="wrap">
<div class="ver">
<div style="display:flex;flex-direction:column;gap:26px;align-items:flex-start">
<p class="eyebrow">Check it yourself</p>
<h2 class="h2 n-h2" id="fin-h">Check the transactions.</h2>
<p class="lead">Every claim here points to a transaction, a file or a command. Where something is not proven, the label says so.</p>
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center"><a class="btn btn-p" href="#/judge">Take the 10 minute judge tour ${icon('right')}</a><a class="btn btn-g" href="#/bounties">Browse open bounties</a></div>
</div>
<div class="n-links">
<a class="vrow" href="${EXPLORER_ACCOUNT}${CONTRACT}" target="_blank" rel="noopener"><span class="vico">${icon('cube')}</span><span><b class="h4" style="display:block">The contract on the explorer</b><span class="small">Read the code hash and the bounties on NEAR itself</span></span>${icon('ext')}</a>
<a class="vrow" href="#/evidence/ledger"><span class="vico">${icon('list')}</span><span><b class="h4" style="display:block">The settlement ledger</b><span class="small">Every paid bounty, by proof or by timeout, with transactions</span></span>${icon('right')}</a>
<a class="vrow" href="#/evidence/checker"><span class="vico">${icon('cpu')}</span><span><b class="h4" style="display:block">The approved checker</b><span class="small">Rebuild it yourself and compare the fingerprint</span></span>${icon('right')}</a>
<a class="vrow" href="#/evidence/limits"><span class="vico">${icon('alert')}</span><span><b class="h4" style="display:block">Known limits</b><span class="small">What is not claimed, in plain words</span></span>${icon('right')}</a>
<a class="vrow" href="#/judge"><span class="vico">${icon('book')}</span><span><b class="h4" style="display:block">The judge guide</b><span class="small">Do, expect, verify, with what each step proves and does not prove</span></span>${icon('right')}</a>
</div>
</div>
</div>
</section>`;
}

const chrome = (inner) => `<div class="lay-wrap">
<div class="lay-body">
<nav class="lay-nav" aria-label="Home sections">
<div class="rail-top"><button class="rail-tg" type="button" id="railTg" aria-controls="railList">${icon('sidebar')}</button>
<ol class="ln-list" id="railList">${NAMES.map((n, i) => `<li><button class="ln-i" type="button" data-sec="${i}" aria-label="${esc(n)}" title="${esc(n)}: ${esc(HINTS[i])}" aria-current="${i === current}"><span class="ln-n">${two(i)}</span><span class="ln-w"><span class="ln-t">${esc(n)}</span><span class="ln-d">${esc(HINTS[i])}</span></span></button></li>`).join('')}</ol></div>
<div class="ln-links"><a href="#/judge">Judge guide</a><a href="#/evidence">Proof &amp; evidence</a><a href="#/bounties">Browse bounties</a></div>
</nav>
<main id="main" class="home p-home" tabindex="-1">${inner}</main>
</div>
<div class="lay-ctl"><button class="ln-b" type="button" id="secPrev" aria-label="Previous section">${icon('left')}</button><span class="ln-c" id="secNum" aria-live="polite">${two(current)} / 7</span><span class="ln-name" id="secName">${esc(NAMES[current])}</span><button class="ln-b" type="button" id="secNext" aria-label="Next section">${icon('right')}</button></div>
</div>`;

// Shows section i (clamped, not wrapped). fromHash: the address already names it. On a phone, a section switch
// scrolls to the top of the new section when the visitor is scrolled below it.
export function showSection(i, fromHash = false) {
  current = Math.max(0, Math.min(6, i));
  document.body.setAttribute('data-sec', String(current));
  document.querySelectorAll('.ln-i').forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.sec) === current)));
  const num = $('#secNum'); if (num) num.textContent = `${two(current)} / 7`;
  const name = $('#secName'); if (name) name.textContent = NAMES[current];
  if (!fromHash) history.replaceState(null, '', current === 0 ? '#/' : `#${HOME_IDS[current]}`);
  const sec = document.querySelector(`main.home>section[data-i="${current}"]`);
  if (sec && sec.getBoundingClientRect().top < 0) window.scrollTo({ top: window.scrollY + sec.getBoundingClientRect().top - (innerWidth <= 700 ? 0 : 12) });
  document.title = current === 0 ? 'Skarbnik · Fix what you can’t see' : `${NAMES[current]} · Skarbnik`;
}

export async function home(viewEl, sec = 0) {
  current = sec;
  const nums = await getNumbers();
  const tgas = nums.accepted_proof_tgas.value;
  viewEl.innerHTML = chrome(sections(tgas));
  showSection(sec, true);
  viewEl.querySelectorAll('.ln-i').forEach((b) => b.addEventListener('click', () => showSection(Number(b.dataset.sec))));
  $('#secPrev').addEventListener('click', () => showSection(current - 1));
  $('#secNext').addEventListener('click', () => showSection(current + 1));
  // links inside Home to another Home section (See the five steps) switch the section in place
  viewEl.querySelectorAll('main.home a[href^="#"]:not([href^="#/"])').forEach((a) => a.addEventListener('click', (e) => { const i = HOME_IDS.indexOf(a.getAttribute('href').slice(1)); if (i >= 0) { e.preventDefault(); showSection(i); } }));
  // The Console rail collapses to a strip of section numbers (desktop only); the choice is remembered in this browser.
  const railTg = $('#railTg');
  const setRail = (collapsed, save) => {
    document.body.setAttribute('data-rail', collapsed ? 'collapsed' : 'open');
    railTg.setAttribute('aria-expanded', String(!collapsed));
    railTg.setAttribute('aria-label', collapsed ? 'Expand sections' : 'Collapse sections'); railTg.title = railTg.getAttribute('aria-label');
    if (save) { try { localStorage.setItem('skarbnik-rail', collapsed ? 'collapsed' : 'open'); } catch { /* storage blocked */ } }
  };
  let railStored = 'open'; try { railStored = localStorage.getItem('skarbnik-rail') || 'open'; } catch { /* storage blocked */ }
  setRail(railStored === 'collapsed', false);
  railTg.addEventListener('click', () => setRail(document.body.getAttribute('data-rail') !== 'collapsed', true));
  matrix($('#homeMatrix'));
  // the six rules: one open at a time, the first open to start
  const drawRules = (open) => {
    $('#rulesAcc').innerHTML = RULES.map((r, i) => `<div class="acc"><h3 style="margin:0"><button class="acc-btn" type="button" aria-expanded="${i === open}" aria-controls="acc-${i}" data-acc="${i}"><span><span class="h3" style="display:block">${esc(r.title)}</span><span class="small" style="display:block;margin-top:4px">${esc(r.short)}</span></span><span class="chev${i === open ? ' rot' : ''}">${icon('chev')}</span></button></h3>
      <div class="acc-body" id="acc-${i}"${i === open ? '' : ' hidden'}><p class="body">${esc(r.p1.replace('__TGAS__', tgas))}</p><p class="body" style="color:var(--tx3)"><b style="color:var(--tx2)">Limit:</b> ${esc(r.p2)}</p>${r.code ? `<p class="code">${esc(r.code)}</p>` : ''}</div></div>`).join('');
    $('#rulesAcc').querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.acc); drawRules(open === i ? -1 : i); $(`[data-acc="${i}"]`).focus(); }));
  };
  drawRules(0);
  // the bounties paid by a checked proof so far, read live from the contract
  try {
    const ids = await paidByProof();
    const el = $('#paidList');
    if (el && ids.length) el.textContent = ` Paid by a checked proof so far, read live from the contract: bounties ${ids.length > 1 ? `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}` : ids[0]}.`;
  } catch { /* the cards stand on their own */ }
}
