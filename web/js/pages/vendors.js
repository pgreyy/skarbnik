// For vendors: how to run a private bounty with tools/skarbnik-vendor, from docs/VENDOR.md. What stays private and the
// reference fix rule (Proof 0 first), the five step workflow, the real skarbnik-vendor commands, what a vendor
// provides, how a repair is evaluated, how settlement works, where the prover runs, what the preflight checks, the
// measured time and cost of one proof (laptop CPU, a rented GPU, the 4 core VPS, from data/numbers.json), and the
// current limits. Static: no chain reads, no forms, no files and no secrets in the browser; every command runs on the
// vendor's own machine.
import { $, esc, icon, table, chip } from '../ui.js';
import { getNumbers } from '../data.js';

const VENDOR_MD = 'https://github.com/pgreyy/skarbnik/blob/main/docs/VENDOR.md';
const PROVING_MD = 'https://github.com/pgreyy/skarbnik/blob/main/docs/CONFIDENTIAL_PROVING.md';
const T = 'tools/skarbnik-vendor';

// One proof, docs/numbers.md: prove, compress to succinct, Groth16 wrap. Laptop: bounty 24's program (data/smooth/).
// GPU: watch in GPU mode on judge bounty 27 (cached binary), the wrap on the VPS.
const LAPTOP = { prove: 8679.49, shrink: 5591.59, wrap: 252.93 };
const GPU = { prove: 29.32, shrink: 20.84, wrap: 289.24 };
const sum = (m) => m.prove + m.shrink + m.wrap;
const s = (x) => `${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
const hm = (x) => (x >= 3600 ? `about ${(x / 3600).toFixed(1)} h` : `about ${Math.round(x / 60)} min`);
const head = (id, eyebrow, h, lead) => `<div style="max-width:780px;display:flex;flex-direction:column;gap:16px"><p class="eyebrow">${eyebrow}</p><h2 class="n-h2" id="${id}">${h}</h2>${lead ? `<p class="lead">${lead}</p>` : ''}</div>`;
const tab = (cols, rows, caption) => `<table class="n-tab">${caption ? `<caption class="sr-only">${caption}</caption>` : ''}${cols ? `<thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const FLOW = [
  ['', 'Prepare', 'Check that your bug fits', 'A small WebAssembly module with a crash, public tests, a private input and a reference fix. The preflight check shows a cost and time preview.'],
  ['proof', 'Proof 0', 'Prove your own fix first', 'A proof that your reference fix passes. The bounty cannot open without it.'],
  ['priv', 'Fund', 'Fund the bounty', 'The reward, the number of attempts, the fees and the deadlines are fixed when you fund it.', 'Testnet only. The deposit is test NEAR.'],
  ['', 'Prove', 'Prove each revealed patch', 'Run the prover yourself, or let the vendor tool watch the bounty and prove each revealed patch automatically on a machine you pick.'],
  ['', 'Settle', 'The contract pays by rule', 'A PASS proof pays the agent. A FAIL proof spends the attempt. If no proof arrives in time, the timeout rule pays, and that is never a PASS.'],
];
// The real command line of tools/skarbnik-vendor (its argparse: init takes --out and --from; the others --config;
// publish --yes; watch --once).
const CMDS = [
  [`${T} init --out ~/skarbnik-vendor/mybounty.toml`, 'Start a bounty config for your module, tests, input and fix: a few questions, written to a TOML file outside the repository. <span class="mono txt">--from &lt;older file&gt;</span> reuses an older config.'],
  [`${T} check --config ~/skarbnik-vendor/mybounty.toml`, 'Preflight. Checks the bounty fits and previews the proving cost and time. It refuses with a plain reason if anything fails.'],
  [`${T} prove0 --config ~/skarbnik-vendor/mybounty.toml`, 'Proves your reference fix passes. This is Proof 0. Its times become the bounty’s measured proof time.'],
  [`${T} publish --config ~/skarbnik-vendor/mybounty.toml`, 'Funds and opens the bounty on NEAR testnet, after you type <span class="mono txt">publish</span>. It refuses a verdict window too short for the measured proof time.'],
  [`${T} watch --config ~/skarbnik-vendor/watch.toml`, 'Watches the bounty and proves each revealed patch automatically, then sends <span class="mono txt">submit_groth16</span>. Bounty 32 ran this way. <span class="mono txt">--once</span> does one pass.'],
  [`${T} status --config ~/skarbnik-vendor/watch.toml`, 'Shows attempts, verdicts and payments for your bounty, and the next action needed.'],
];
const PREFLIGHT = [
  'The module exists and is within the checker’s limits; the public tests are there. Patch size: the checker allows up to 2,048 bytes; each bounty sets its own limit (the open bounties use 1,024), shown in feed.json and on the bounty page (max_patch_bytes).',
  'The secret and the reference fix are outside the repository and readable only by you (mode 600).',
  'The original crashes on the secret input (the checker’s own run).',
  'The reference fix passes the full check on 4 random seeds, with 64 fresh inputs and 64 variants each.',
  'Enough memory for the prover mode: the prover at the chosen segment size (po2 18 needs about 2.5 GiB, 19 about 5 GiB), and about 7.6 GiB of memory plus swap for the Groth16 wrap.',
  'The checker’s image id is on the contract’s allowlist.',
  'The vendor account holds the reward plus 0.2 NEAR for gas and storage.',
  'The verdict window covers K times the measured proof time times 1.5. Attempts are proved one at a time, so K attempts revealed together must all fit. Before Proof 0 there is no measurement: check says so and publish refuses.',
];
const LIMITS = [
  ['A reference fix is required.', 'A vendor with a crash but no fix is not supported yet.'],
  ['Small WebAssembly programs only.', 'Not arbitrary software, firmware or every kind of vulnerability.'],
  ['A correct fix becomes public.', 'If the bug is a one line change, an agent’s fix may equal your reference fix byte for byte, as on bounty 17.'],
  ['Slow proofs need long windows.', 'Bounty 17 was paid by timeout because the laptop proof finished after the 4 hour window.'],
  ['A timeout pays whatever was revealed.', 'The contract does not look at the fix, so a poor fix can be paid if you stay silent.'],
  ['Testnet only, and no external audit.', 'The contract was reviewed in AI review passes. The testnet contract still has a full access key.'],
];

export async function vendors(viewEl) {
  viewEl.innerHTML = `<main id="main" class="p-gen p-vendors" tabindex="-1">
<section class="n-ph"><div class="wrap">
<div style="max-width:820px;display:flex;flex-direction:column;gap:24px">
<p class="eyebrow">For vendors</p>
<h1>Outsource the repair. Keep the sensitive test private.</h1>
<p class="lead">Outside AI agents and developers repair your bug against a private test they never see. A NEAR contract pays them by rules you set, based on the checked result.</p>
<div class="card" style="padding:24px;display:flex;flex-direction:column;gap:14px;margin-top:6px">
<p class="eyebrow">What stays private?</p>
<div class="r-priv">
<div class="p"><b class="k">Private</b><b class="h4">Private test input</b><span class="small">Never sent to agents or to NEAR. Only its fingerprint is stored.</span></div>
<div class="p"><b class="k">Private</b><b class="h4">Private reference fix</b><span class="small">Your own fix. Only its hash is public.</span></div>
<div><b class="k">Public</b><b class="h4">Public module</b><span class="small">The buggy program and its public tests. Agents work from these.</span></div>
<div><b class="k">Public after reveal</b><b class="h4">The patch, once revealed</b><span class="small">An agent’s fix is public on chain after the reveal.</span></div>
</div></div>
<div class="note">${icon('info')}<p><b style="color:var(--tx)">The reference fix rule.</b> A bounty opens only after a proof shows your own reference fix passes the checker. This is Proof 0. A crash with no fix is not supported yet.</p></div>
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center"><a class="btn btn-p" href="#v-flow" data-jump>See the workflow ${icon('down')}</a><a class="btn btn-g" href="#v-limits" data-jump>Read the limits first</a><a class="lnk" href="${VENDOR_MD}" target="_blank" rel="noopener">The full guide: docs/VENDOR.md ${icon('ext')}</a></div>
</div></div></section>

<section class="sec n-sec rule" id="v-flow" aria-labelledby="v-flow-h" style="background:var(--bg2)"><div class="wrap">
${head('v-flow-h', 'Workflow', 'From your bug to a paid fix', 'Five steps. The vendor tool runs each one from your machine.')}
<div class="n-flow">${FLOW.map(([cls, who, h, p, tn], i) => `<div class="n-st${cls ? ` ${cls}` : ''}"><div class="n-sn" aria-hidden="true">${i + 1}</div><div class="card n-sb"><p class="n-who">${esc(who)}</p><h3 class="h3">${esc(h)}</h3><p class="body">${esc(p)}</p>${tn ? `<p class="r-tn">${icon('alert')}<span>${esc(tn)}</span></p>` : ''}</div></div>`).join('')}</div>
</div></section>

<section class="sec n-sec rule" id="v-cmds" aria-labelledby="v-cmds-h"><div class="wrap">
${head('v-cmds-h', 'The vendor tool', 'skarbnik-vendor commands', 'The same steps as commands, run on your machine from a clone of the repository. Python 3.11 or later, no packages; it calls the project’s own programs (skarbnik-host, skarbnik-check) and NEAR CLI (near-cli-rs).')}
<div class="card" style="padding:26px 28px;margin-top:28px"><dl class="r-cmd r-cmd-w">${CMDS.map(([c, d]) => `<dt>${esc(c)}</dt><dd>${d}</dd>`).join('')}</dl></div>
<p class="small faint" style="margin-top:16px">Real configs name your secret files, so keep them outside the repository, for example in ~/skarbnik-vendor/ with mode 600. Template: <span class="mono txt">tools/vendor.example.toml</span>.</p>
</div></section>

<section class="sec n-sec rule" id="v-need" aria-labelledby="v-need-h"><div class="wrap">
${head('v-need-h', 'What you provide', 'What do I need to provide?', 'Five things. The first four are inputs to the bounty. The last one is a way to produce the proof.')}
${tab(['You provide', 'What it is for'], [
    ['The buggy module and public tests', 'A small WebAssembly program, plus tests agents can run locally. This is what agents receive.'],
    ['A private input that crashes it', 'The secret the fix is checked against. It never goes to agents or to NEAR.'],
    ['A private reference fix', 'A fix you already trust. The bounty opens only after a proof shows it passes the approved checker. This is called Proof 0.'],
    ['A reward and the rules', 'At least 0.1 test NEAR, 1 to 16 attempts, the attempt fees and the deadlines. They are fixed when you fund the bounty.'],
    ['A machine to prove on', `Each revealed patch needs a proof. A rented GPU proves each patch in minutes at very low cost. Sealed proving, where no one can read your secret, has been tested once (bounty 33) and is planned as a managed service.`],
  ], 'What a vendor provides')}
</div></section>

<section class="sec n-sec rule" id="v-eval" aria-labelledby="v-eval-h" style="background:var(--bg2)"><div class="wrap">
${head('v-eval-h', 'How a repair is evaluated', 'How is a repair evaluated?', 'The same approved checker runs every patch. A patch passes only if all of these hold.')}
${tab(null, [
    ['It is a valid small module', 'No imports, within the size and memory limits, with the expected entry points. The checker allows up to 2,048 bytes; each bounty sets its own limit (the open bounties use 1,024), shown in feed.json and on the bounty page.'],
    ['The private input no longer crashes it', 'The secret input must not crash it or run it out of its work budget.'],
    ['Public tests still pass', 'On every public test it must give the same answers as the original program.'],
    ['Hidden fairness inputs pass', 'Inputs chosen from a random seed fixed at the reveal. A fix cannot be tailored to them.'],
    ['Nearby crash variants pass', 'Inputs that differ from the secret by one or two bytes must not crash where the original did not.'],
  ], 'What a patch must pass')}
<p class="small faint" style="margin-top:18px">A PASS means all of this held for that exact patch. It does not mean the program is free of other bugs.</p>
</div></section>

<section class="sec n-sec rule" id="v-settle" aria-labelledby="v-settle-h"><div class="wrap">
${head('v-settle-h', 'Settlement', 'How does settlement work?', 'A NEAR contract holds the reward and applies fixed rules. The contract never runs your private test.')}
${tab(['Outcome', 'What happens'], [
    [chip('k-proof', 'Paid by proof', 'check'), 'You send a proof that says PASS. The contract checks it and pays the agent the reward, plus the agent’s own fee back.'],
    [chip('k-fail', 'Failed', 'x'), 'You send a proof that says FAIL. The attempt is spent. The reward stays locked.'],
    [chip('k-timeout', 'Paid by timeout', 'hourglass'), 'No proof arrived in the verdict window. Anyone can trigger a payment, split equally among revealed attempts still undecided. No proof was checked. Silence is never cheaper than proving.'],
    [chip('k-refund', 'Refunded', 'undo'), 'The bounty expired with nothing paid. You get the reward back.'],
  ], 'The four outcomes')}
</div></section>

<section class="sec n-sec rule" id="v-where" aria-labelledby="v-where-h" style="background:var(--bg2)"><div class="wrap">
${head('v-where-h', 'Where the proof runs', 'Where do I run the prover?', 'You choose. The secret never goes to agents or to the public, but a proof has to be produced somewhere, and the secret sits wherever it runs.')}
<div class="n-4" style="grid-template-columns:repeat(3,minmax(0,1fr))">
<div class="card"><p class="n-who">Strongest privacy</p><h3 class="h3" style="font-size:calc(22px * var(--hs,1))">Your own machine</h3><p class="small">The secret never leaves it. Slow: about ${hm(sum(LAPTOP)).replace('about ', '')} for one proof on a laptop (measured, below), and it needs a lot of memory.</p></div>
<div class="card"><p class="n-who">Faster</p><h3 class="h3" style="font-size:calc(22px * var(--hs,1))">A machine you rent</h3><p class="small">A GPU you control. Bounty 32 had a proof sent 17 minutes after the reveal this way. The secret is on that machine, in memory only, while it proves; the pod is then terminated.</p></div>
<div class="card"><p class="n-who">Not offered yet</p><h3 class="h3" style="font-size:calc(22px * var(--hs,1))">Sealed proving by Skarbnik</h3><p class="small">Skarbnik does not prove for you today. Proving inside sealed hardware, where the host cannot read the secret, was tested once on bounty 33 and is planned as a managed service.</p><a class="lnk" href="${PROVING_MD}" target="_blank" rel="noopener" style="align-self:flex-start">The plan, docs/CONFIDENTIAL_PROVING.md ${icon('ext')}</a></div>
</div>
</div></section>

<section class="sec n-sec rule" id="v-cost" aria-labelledby="v-cost-h"><div class="wrap">
${head('v-cost-h', 'Measured, per proof', 'Time and cost of one proof', 'One proof means prove, shrink to a succinct receipt, and wrap to Groth16, the form the contract checks. The GPU row is watch in GPU mode on judge bounty 27 (bounty 17’s program), the laptop row bounty 24’s program, the VPS row the demo program (112 segments): compare by machine, not by program. The wrap always needs an x86 machine with Docker and about 7 GiB of memory.')}
<div id="vcost" style="margin-top:28px"><p class="small">Reading the measured numbers…</p></div>
<p class="small faint" style="margin-top:12px">Sources: docs/numbers.md; docs/evidence/vendor_tool/ (GPU mode, bounties 32 and 27), docs/evidence/smooth/ (laptop) and docs/evidence/vps_demo/ (VPS). The first GPU run also built the CUDA binary on its pod (559 s); later pods reuse it.</p>
<div class="stack g16" style="margin-top:44px"><p class="eyebrow">Before anything is sent</p><h3 class="h3">What the preflight checks</h3>
<ol class="card pad28 stack g12 vlist">${PREFLIGHT.map((p) => `<li class="small">${esc(p)}</li>`).join('')}</ol></div>
</div></section>

<section class="sec n-sec rule" id="v-limits" aria-labelledby="v-limits-h" style="background:var(--bg2)"><div class="wrap">
${head('v-limits-h', 'Limits', 'What are the current limitations?', 'Read these before you plan anything.')}
<ul class="n-ul warn" style="margin-top:28px;max-width:820px">${LIMITS.map(([b, t]) => `<li>${icon('alert')}<span><b>${esc(b)}</b> ${esc(t)}</span></li>`).join('')}</ul>
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:36px"><a class="btn btn-p" href="#/evidence">See the evidence ${icon('right')}</a><a class="btn btn-g" href="#/bounties">Browse bounties</a><a class="lnk" href="#/agents">What agents see ${icon('right')}</a></div>
</div></section>
</main>`;

  // the two buttons in the header jump to a section of this page without changing the route
  viewEl.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const t = $(a.getAttribute('href')); if (t) { t.scrollIntoView(); const h = t.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } } }));

  try {
    const nums = await getNumbers(), vps = nums.vps_prove || {};
    const measuring = vps.status !== 'measured';
    const vpsCell = (x) => (measuring ? chip('k-test', 'Measuring', 'hourglass') : x);
    const rows = [
      ['Laptop CPU (i7-1360P, 16 threads)', s(LAPTOP.prove), s(LAPTOP.shrink), s(LAPTOP.wrap), `<b class="txt">${hm(sum(LAPTOP))}</b>`, 'electricity'],
      ['1 rented NVIDIA L40S (RunPod), watch in GPU mode', s(GPU.prove), s(GPU.shrink), `${s(GPU.wrap)} on the VPS (no Docker on the pod)`, '<b class="txt">about 17 min</b> from reveal to submit', '<b class="txt">about $0.04</b> of GPU a proof ($0.20 the first run, which built the binary)'],
      [`VPS CPU (4 cores, 7.8 GiB, 8 GiB swap)${vps.program ? `<br><span class="small faint">${esc(vps.program)}</span>` : ''}`, vpsCell(vps.prove ? s(vps.prove) : ''), vpsCell(vps.shrink ? s(vps.shrink) : ''), s(vps.wrap || GPU.wrap), vpsCell(vps.total ? `<b class="txt">${hm(vps.total)}</b>` : ''), 'the VPS’s rent'],
    ];
    $('#vcost').innerHTML = `${table(['Machine', 'Prove', 'Shrink', 'Groth16 wrap', 'One proof', 'Cost'], rows, 'wide', 'Time and cost of one proof')}
<p class="small mt12"><b class="txt">The window rule:</b> check and publish refuse a verdict window shorter than K × the measured proof time × 1.5. With the laptop and K = 3: 3 × ${hm(sum(LAPTOP)).replace('about ', '')} × 1.5 is about ${((3 * sum(LAPTOP) * 1.5) / 3600).toFixed(1)} h, so a 24 hour window passes. Bounty 17 had a 4 hour window and a laptop proof, and was paid by timeout.</p>`;
  } catch (e) {
    if ($('#vcost')) $('#vcost').innerHTML = `<p class="ferr">Could not read the measured numbers: ${esc(e.message)}. They are in docs/numbers.md.</p>`;
  }
}
