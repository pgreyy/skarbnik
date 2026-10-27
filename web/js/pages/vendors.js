// For vendors: how to run a private bounty with tools/skarbnik-vendor, from docs/VENDOR.md. Who it is for and the
// reference fix rule (Proof 0 first), the steps with the exact commands, what the preflight checks, the measured time
// and cost of one proof (laptop CPU, a rented GPU, the 4 core VPS from data/numbers.json, marked "measuring" until it
// is in), the proving modes, and the full command list. Static: no chain reads, no forms, no files and no secrets in
// the browser; every command runs on the vendor's own machine.
import { $, esc, icon, table, note, cmd, chip } from '../ui.js';
import { getNumbers } from '../data.js';

const VENDOR_MD = 'https://github.com/pgreyy/skarbnik/blob/main/docs/VENDOR.md';
const T = 'tools/skarbnik-vendor';

// One proof of bounty 24's program (data/smooth/), docs/numbers.md: prove, compress to succinct, Groth16 wrap.
const LAPTOP = { prove: 8679.49, shrink: 5591.59, wrap: 252.93 };
const GPU = { prove: 29.82, shrink: 21.71, wrap: 337.73 };
const sum = (m) => m.prove + m.shrink + m.wrap;
const s = (x) => `${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
const hm = (x) => (x >= 3600 ? `about ${(x / 3600).toFixed(1)} h` : `about ${Math.round(x / 60)} min`);

export async function vendors(viewEl) {
  const STEPS = [
    ['Write the bounty config', `${T} init --out ~/skarbnik-vendor/mybounty.toml`, 'Asks a few questions and writes a bounty config (TOML): module, reward, K, fees, windows, expiry, check size and the paths of your secret files. <span class="mono txt">--from &lt;older file&gt;</span> reuses an older config, so only the secret and the fix change. It refuses a path inside the repository.'],
    ['Run the preflight', `${T} check --config ~/skarbnik-vendor/mybounty.toml`, 'Every check below, then a preview: the reward, the fee of every attempt from 1 to K, the windows, what the timeout rule does, the proof time and the time to open. It refuses with a plain reason if anything fails.'],
    ['Prove your reference fix: Proof 0', `${T} prove0 --config ~/skarbnik-vendor/mybounty.toml`, 'Prove, shrink to succinct, Groth16, verify, and the contract arguments, one step at a time with a progress line and the memory guard. Its times become the bounty’s measured proof time.'],
    ['Publish the bounty', `${T} publish --config ~/skarbnik-vendor/mybounty.toml`, 'Shows the preview again and asks you to type <span class="mono txt">publish</span>, then creates and opens the bounty and prints both transactions. It refuses if the verdict window is too short for the measured proof time.'],
    ['Leave the auto prover running', `${T} watch --config ~/skarbnik-vendor/watch.toml`, 'Polls the chain for revealed attempts, proves each one (oldest first) with the attempt’s seed and submission id, checks the verdict, the submission id and the secret’s commitment against the chain, and sends <span class="mono txt">submit_groth16</span>. It warns early when a window is at risk. <span class="mono txt">--once</span> does one pass.'],
    ['See where every attempt stands', `${T} status --config ~/skarbnik-vendor/watch.toml`, 'Every watched bounty and attempt, its state and the next action needed.'],
  ];
  const PREFLIGHT = [
    'The module exists and is within the checker’s limits (2,048 bytes); the public tests are there.',
    'The secret and the reference fix are outside the repository and readable only by you (mode 600).',
    'The original crashes on the secret input (the checker’s own run).',
    'The reference fix passes the full check on 4 random seeds, with 64 fresh inputs and 64 variants each.',
    'Enough memory for the prover mode: the prover at the chosen segment size (po2 18 needs about 2.5 GiB, 19 about 5 GiB), and about 7.6 GiB of memory plus swap for the Groth16 wrap.',
    'The checker’s image id is on the contract’s allowlist.',
    'The vendor account holds the reward plus 0.2 NEAR for gas and storage.',
    'The verdict window covers K times the measured proof time times 1.5. Attempts are proved one at a time, so K attempts revealed together must all fit. Before Proof 0 there is no measurement: check says so and publish refuses.',
  ];
  const MODES = [
    ['cpu', 'Your own machine', chip('k-proof', 'Built', 'check'), 'Strongest: the secret never leaves a machine you control.', 'Slowest. Measure it before you choose the windows.'],
    ['server', 'A VPS you control', chip('k-proof', 'Built', 'check'), 'The secret sits on a rented server only you use, in files of mode 600; watch runs there unattended and restarts itself.', 'The same cpu mode, so the same speed class as its cores. The project’s own 4 core VPS is being set up this way; its first measured proof is running.'],
    ['cube', 'A GPU you rent for the job', chip('k-test', 'Measured by hand once', 'flask'), 'The secret sits in the rented machine’s memory during the proof, then is wiped.', 'Under a minute to prove and shrink bounty 24’s attempt. Not yet built into watch.'],
  ];

  viewEl.innerHTML = `<main id="main" class="p-gen p-vendors" tabindex="-1">
<section class="ph"><div class="wrap ph-grid">
<div class="stack g24" style="max-width:680px"><p class="eyebrow">For vendors</p><h1>Run a private bounty</h1>
<p class="lead">You keep a crashing input secret and hold a fix for it. Outside agents repair the bug from the public code; you prove each attempt against the secret, and the contract checks your proof and pays by rule. Testnet only.</p>
<div class="row"><a class="btn btn-p" href="${VENDOR_MD}" target="_blank" rel="noopener">${icon('doc')} Read docs/VENDOR.md ${icon('ext')}</a><a class="lnk" href="#/bounties/24">See bounty 24, paid by proof ${icon('right')}</a></div></div>
<div class="card pad24 stack g12"><p class="eyebrow" style="color:var(--tx3)">Who it is for</p>
<p class="small">A vendor with a crash bug in a small WebAssembly module, defined public tests, a secret input that crashes the original, and a reference fix that passes.</p>
<p class="small"><b class="txt">Proof 0 first.</b> You must already hold a fix that passes every check. The bounty opens only after the contract checks the proof of that fix, so no agent pays fees chasing a bounty that cannot be fixed. A vendor with a crash but no fix is not supported yet.</p></div>
</div></section>
<section class="pbody"><div class="wrap stack g48">
${note('This page takes no files and holds no secrets. Every command runs on your own machine; the secret input, the reference fix and the salt stay there, in files of mode 600, and are never printed, committed or sent. Only proofs, receipts and their hashes leave it.', 'shield')}

<div class="stack g16"><p class="eyebrow">The steps</p><h2 class="h2s">From a config file to an open bounty</h2>
${STEPS.map(([h, c, body], i) => `<div class="card pad28 vstep"><span class="vico" style="font:var(--wd) 16px/1 var(--fd)">${i + 1}</span><div class="stack g12"><h3 class="h3">${esc(h)}</h3>${cmd(c)}<p class="small">${body}</p></div></div>`).join('')}</div>

<div class="stack g16"><p class="eyebrow">Before anything is sent</p><h2 class="h2s">What the preflight checks</h2>
<ol class="card pad28 stack g12 vlist">${PREFLIGHT.map((p) => `<li class="small">${esc(p)}</li>`).join('')}</ol></div>

<div class="stack g16"><p class="eyebrow">Measured, per proof</p><h2 class="h2s">Time and cost of one proof</h2>
<p class="body" style="max-width:780px">One proof means prove, shrink to a succinct receipt, and wrap to Groth16, the form the contract checks. Laptop and GPU are the same patch of bounty 24’s program under the same checker; the VPS row is the demo program (112 segments), so compare it by machine, not by program. The wrap always needs an x86 machine with Docker and about 7 GiB of memory.</p>
<div id="vcost"><p class="small">Reading the measured numbers…</p></div>
<p class="small faint">Sources: docs/numbers.md (bounty 24, <span class="mono">data/smooth/</span>; the VPS run, <span class="mono">data/demo/</span>), docs/evidence/smooth/ and docs/evidence/vps_demo/. The GPU’s pod setup took a further 554 s once (install and build).</p></div>

<div class="stack g16"><p class="eyebrow">Where proving runs</p><h2 class="h2s">The proving modes</h2>
<p class="body" style="max-width:780px">You choose where proving runs, and the secret sits wherever it runs.</p>
<div class="vmodes">${MODES.map(([ic, h, c, priv, speed]) => `<div class="card pad24 stack g12"><span class="vico">${icon(ic === 'server' ? 'cpu' : ic)}</span><h3 class="h3">${esc(h)}</h3><div>${c}</div><p class="small"><b class="txt">Privacy:</b> ${esc(priv)}</p><p class="small"><b class="txt">Speed:</b> ${esc(speed)}</p></div>`).join('')}</div>
<p class="small">A hosted proving service run by Skarbnik is <b class="txt">not offered</b>: it would have to see your secret.</p></div>

<div class="stack g16"><p class="eyebrow">Commands</p><h2 class="h2s">Every skarbnik-vendor command</h2>
<p class="body" style="max-width:780px">Python 3.11 or later, no packages. It calls the project’s own programs (skarbnik-host, skarbnik-check) and NEAR CLI (near-cli-rs). Run from a clone of the repository; real configs name your secret files, so keep them outside it, for example in ~/skarbnik-vendor/ with mode 600. Template: <span class="mono txt">tools/vendor.example.toml</span>.</p>
${table(['Command', 'What it does'], [
    [`init --out &lt;file&gt; [--from &lt;older file&gt;]`, 'Writes a bounty config from a few questions'],
    ['check --config &lt;file&gt;', 'The preflight, then the preview'],
    ['prove0 --config &lt;file&gt;', 'Proof 0 of the reference fix; its times become the measured proof time'],
    ['publish --config &lt;file&gt;', 'Creates and opens the bounty after you type publish'],
    ['watch --config &lt;watch file&gt; [--once]', 'The auto prover: proves each revealed attempt and sends submit_groth16'],
    ['status --config &lt;watch file&gt;', 'Every watched bounty and attempt, and the next action'],
  ].map(([c, w]) => [`<span class="mono txt">${c}</span>`, esc(w)]), 'mid', 'skarbnik-vendor commands')}
<div class="row"><a class="lnk" href="${VENDOR_MD}" target="_blank" rel="noopener">The full guide: docs/VENDOR.md ${icon('ext')}</a></div></div>
</div></section></main>`;

  try {
    const nums = await getNumbers(), vps = nums.vps_prove || {};
    const measuring = vps.status !== 'measured';
    const vpsCell = (x) => (measuring ? chip('k-test', 'Measuring', 'hourglass') : x);
    const rows = [
      ['Laptop CPU (i7-1360P, 16 threads)', s(LAPTOP.prove), s(LAPTOP.shrink), s(LAPTOP.wrap), `<b class="txt">${hm(sum(LAPTOP))}</b>`, 'electricity'],
      ['1 rented NVIDIA L40S (RunPod)', s(GPU.prove), s(GPU.shrink), `${s(GPU.wrap)} on the VPS (no Docker on the pod)`, `<b class="txt">${hm(sum(GPU))}</b>`, '$0.60 for the pod session'],
      [`VPS CPU (4 cores, 7.8 GiB, 8 GiB swap)${vps.program ? `<br><span class="small faint">${esc(vps.program)}</span>` : ''}`, vpsCell(vps.prove ? s(vps.prove) : ''), vpsCell(vps.shrink ? s(vps.shrink) : ''), s(vps.wrap || GPU.wrap), vpsCell(vps.total ? `<b class="txt">${hm(vps.total)}</b>` : ''), 'the VPS’s rent'],
    ];
    $('#vcost').innerHTML = `${table(['Machine', 'Prove', 'Shrink', 'Groth16 wrap', 'One proof', 'Cost'], rows, 'wide', 'Time and cost of one proof')}
${measuring ? `<p class="small mt12">${esc(vps.text || 'The VPS number is being measured.')}. It will appear here when it is in.</p>` : ''}
<p class="small mt12"><b class="txt">The window rule:</b> check and publish refuse a verdict window shorter than K × the measured proof time × 1.5. With the laptop and K = 3: 3 × ${hm(sum(LAPTOP)).replace('about ', '')} × 1.5 is about ${((3 * sum(LAPTOP) * 1.5) / 3600).toFixed(1)} h, so a 24 hour window passes. Bounty 17 had a 4 hour window and a laptop proof, and was paid by timeout.</p>`;
  } catch (e) {
    if ($('#vcost')) $('#vcost').innerHTML = `<p class="ferr">Could not read the measured numbers: ${esc(e.message)}. They are in docs/numbers.md.</p>`;
  }
}
