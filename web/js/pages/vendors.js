// For vendors: a header (host a private repair bounty), then five tabs with their own links (#/vendors/host, setup,
// privacy, compute, limits; also #host ...). Host: 1. Build Skarbnik, one terminal block (with RISC Zero at the pinned
// versions and the vendor account); 2. Run it, two ways with their own links: AI (#way-ai: pick Windows, Mac (both
// Claude Desktop) or Code (Claude Code or Codex), then short numbered steps to add the vendor MCP server,
// tools/skarbnik-vendor-mcp, to the app and ask it to host; when it asks; what it can see) and Terminal (#way-cmd).
// Commands: the five skarbnik-vendor steps with their real arguments (docs/VENDOR.md), the preflight and the measured
// time and cost per proof in drop downs. At the bottom of Host, two closed drop downs: how a repair is checked and how
// payment works. Setup: what a vendor needs. Privacy: what stays private. Compute: where proving runs. Limits: the
// current limits. Static: no chain reads, no forms, no secrets in the browser; every command runs on the vendor's own
// machine.
import { esc, icon, chip, table, note, block, cmd, collapse, picker, pickPanel, bindPicker, tabbed, tabNav } from '../ui.js';
import { getNumbers } from '../data.js';

const GH = 'https://github.com/pgreyy/skarbnik';
const VENDOR_MD = `${GH}/blob/main/docs/VENDOR.md`;
const MCP_README = `${GH}/blob/main/tools/skarbnik-vendor-mcp/README.md`;
const T = 'tools/skarbnik-vendor';
const PROMPT = 'Host a private Skarbnik bounty for me with the Skarbnik vendor tool. Ask me which level to use, Level 2 unless I choose otherwise, and explain the three levels in plain words. Ask me for each file path you need. Never open, read out or print my secret input file, only use its path. Show me the cost and the time first, and wait for my yes before you publish or spend on a GPU.';
const WAYS = [{ id: 'ai', label: 'AI', sub: 'You chat, it runs the steps' }, { id: 'cmd', label: 'Terminal', sub: 'You type each step' }];
// The level choice: three short cards, Level 2 recommended; a tap shows what that level needs. The full comparison (who
// decides, what you need, trust) is on How it works (#/how-it-works/levels).
const LEVELS = [
  ['2', 'The contract checks the proof itself.', 'Docker, an x86 computer and about 7.6 GiB for the Groth16 step.'],
  ['1', 'OutLayer checks it; the contract trusts the answer.', 'No Groth16 step; about 2.8 NEAR held during each check, then returned.'],
  ['0', 'Registered verifiers decide, run by the project today.', 'Nothing proved on chain; the verifiers must sign in time.'],
];
const levelsHtml = `<div class="stack g24 sub" id="vLevels"><h3 class="h3">How should the bounty be verified?</h3>
  <div class="v-levels" role="group" aria-label="Verification level">${LEVELS.map(([n, line]) => `<button type="button" class="card v-lvc" data-lv="${n}" aria-pressed="${n === '2'}"><span class="v-lvn">Level ${n}${n === '2' ? '<span class="v-rec">Recommended</span>' : ''}</span><span class="small">${esc(line)}</span></button>`).join('')}</div>
  <div class="stack g8"><p class="small" id="vLvNeed" aria-live="polite"><b>You need:</b> ${esc(LEVELS[0][2])}</p>
  <p class="small">Not sure? Pick Level 2. <a class="lnk sm" href="#/how-it-works/levels">Compare the levels</a></p></div></div>`;
const li = (items) => `<ol class="ag-ol">${items.map((t) => `<li>${t}</li>`).join('')}</ol>`;
const forNow = '<span class="chip l-plan">for now</span>';

// One proof, docs/numbers.md: prove, compress to succinct, Groth16 wrap. Laptop: bounty 24's program (data/smooth/).
// GPU: watch in GPU mode on judge bounty 27 (cached binary), the wrap on the VPS.
const LAPTOP = { prove: 8679.49, shrink: 5591.59, wrap: 252.93 };
const GPU = { prove: 29.32, shrink: 20.84, wrap: 289.24 };
const sum = (m) => m.prove + m.shrink + m.wrap;
const s = (x) => `${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
const hm = (x) => (x >= 3600 ? `about ${(x / 3600).toFixed(1)} h` : `about ${Math.round(x / 60)} min`);

const REQ = 'Needs Linux (on Windows, use WSL), Docker, and an x86 computer. A GPU rental account is needed for a rented GPU.';
const NEED = collapse('vNeed', 'What do I need for this?', `<ul class="n-ul">${[
  'Linux, or WSL on Windows',
  'Docker',
  'About 8 GB of free memory for the final proof step (or a second machine that does that step, as the project’s own setup does)',
  'A GPU rental account, for a rented GPU',
  'Test NEAR for the reward',
].map((t) => `<li>${icon('check')}<span>${t}</span></li>`).join('')}</ul><p class="small mt12">These are for hosting a bounty only. Agents need none of this.</p>`);

const SEE = collapse('vSee', 'What can my AI see, and what can’t it?', `<ul class="n-ul">${[
  'It uses file paths only. It never opens or reads your secret input or your fix.',
  'It never shows, prints or logs a secret, a salt, a seed or a key; what comes back from the tool is filtered.',
  'Publishing, and proving on a rented GPU, each need your yes plus a one time code it shows you first.',
  'Testnet only.',
].map((t) => `<li>${icon('check')}<span>${t}</span></li>`).join('')}</ul>`);

const ASKS = [
  ['Set up', 'init', 'Asks you for each file path and detail. Spends nothing.'],
  ['Check', 'check', 'Nothing to approve: the preflight spends nothing.'],
  ['Proof 0', 'prove0', 'On your own computer, nothing to approve. On a rented GPU, a clear yes: it shows the cost and a one time code first.'],
  ['Publish', 'publish', 'A clear yes: it shows the preview, the reward and gas it spends, and a one time code.'],
  ['Watch', 'watch_start', 'A clear yes: it shows the GPU cost per attempt, the spending cap and a one time code.'],
];

// Where a command goes, as a small label over its copy block.
const at = (where, text) => `<p class="small faint mt8"><b>${where}</b></p>${block(text)}`;
const SRV = 'tools/skarbnik-vendor-mcp/server.py';

// Section 1, Build Skarbnik: one terminal block (clone, RISC Zero at the pinned versions, build, vendor account, pwd).
const BUILD = 'git clone https://github.com/pgreyy/skarbnik.git\ncd skarbnik\ncurl -L https://risczero.com/install | bash\nsource ~/.bashrc\nrzup install rust 1.97.0\nrzup install cargo-risczero 3.0.6\nrzup install r0vm 3.0.6\ncargo risczero --version\nr0vm --version\ncargo build --release -p skarbnik-host\ncargo build -p kintsugi-check\nls target/release/skarbnik-host target/debug/skarbnik-check\nnear account create-account sponsor-by-faucet-service <you>-vendor.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create\npwd';
const ext = (label, url) => `<a class="lnk sm" href="${url}" target="_blank" rel="noopener">${label} ${icon('ext')}</a>`;
const install = `<div class="stack g16"><h2 class="h2s">1. Build Skarbnik</h2>
  <p class="body">You need Linux or WSL, git, Python 3.11 or later, near CLI, Rust and Docker.</p>${at('In your terminal', BUILD)}
  <p class="small">The near line makes a testnet account with test NEAR and keeps its key in NEAR CLI. The reward is at least 0.1 test NEAR. More test NEAR: the ${ext('official faucet', 'https://docs.near.org/getting-started/faucet')} or ${ext('near-faucet.io', 'https://near-faucet.io/')}.</p>
  <p class="small"><span class="mono">pwd</span> prints the folder path, something like <span class="mono">/home/you/skarbnik</span>. You need it when you add the tool to your AI app.</p></div>`;

// The AI tab: pick your computer, then short numbered steps (a title, one grey line, at most one copy block).
const step = (n, title, help, more = '') => `<li class="v-st"><span class="v-n" aria-hidden="true">${String(n).padStart(2, '0')}</span><div><b class="v-t">${title}</b>${help.map((h) => `<p class="v-help">${h}</p>`).join('')}${more}</div></li>`;
const steps = (label, items) => `<ol class="v-steps" aria-label="${esc(label)}">${items.map((x, i) => step(i + 1, ...x)).join('')}</ol>`;
const whole = (command, args) => `{\n  "mcpServers": {\n    "skarbnik-vendor": {\n      "command": "${command}",\n      "args": [${args.map((x) => `"${x}"`).join(', ')}]\n    }\n  }\n}`;
const printIt = (id, where) => collapse(id, 'Print it with your folder path filled in', at(where, `python3 ${SRV} --setup claude-desktop`));
const SPEND = 'It shows the cost and waits for your yes before it spends anything.';
const CHECK = 'Open Claude Desktop first. If skarbnik-vendor is not listed under Settings, Desktop app, Extensions, Local MCP servers, check that mcpServers is still in the file.';
const OS = [{ id: 'win', label: 'Windows', sub: 'Claude Desktop' }, { id: 'mac', label: 'Mac', sub: 'Claude Desktop' }, { id: 'lin', label: 'Code', sub: 'Claude Code or Codex' }];
const OS_STEPS = {
  win: steps('Windows, with Claude Desktop', [
    ['Quit Claude Desktop', ['Right click its icon near the clock and choose Quit. It rewrites its settings when it quits, so edit them only while it is closed.']],
    ['Open the settings file', ['Open Claude Desktop, then Settings, Desktop app, Extensions, Local MCP servers, and press Edit config. A folder opens. Open claude_desktop_config.json in it. Press Edit config, then quit Claude Desktop fully before you change the file.']],
    ['Add Skarbnik', ['Replace everything in the file with this. Put your folder path from step 1 in place of &lt;folder path&gt;. If you already have other MCP servers, add only the mcpServers part instead.'],
      `${block(whole('wsl', ['python3', '-I', `<folder path>/${SRV}`]))}${printIt('vPrWin', 'In your terminal, inside the skarbnik folder')}`],
    ['Ask it to host your bounty', [`${CHECK} Still not listed? The app may read another copy of the file: look in %LOCALAPPDATA%\\Packages\\ (the folder that starts with AnthropicPBC.Claude, then LocalCache, Roaming, Claude) or in %APPDATA%\\Claude.`, `Your secret input, reference fix, public module and tests file must be inside WSL, with paths like /home/you/... ${SPEND}`], block(PROMPT)],
  ]),
  mac: steps('Mac, with Claude Desktop', [
    ['Check ssh to your Linux computer', ['The tool runs on Linux, so Claude Desktop on the Mac starts it there over ssh. It must finish without asking anything.'], block('ssh you@linux-host true')],
    ['Quit Claude Desktop', ['Claude menu, Quit Claude. It rewrites its settings when it quits.']],
    ['Add Skarbnik', ['Open ~/Library/Application Support/Claude/claude_desktop_config.json in TextEdit and replace everything in it with this. Use your ssh login and the folder path from step 1. If you already have other MCP servers, add only the mcpServers part instead.'],
      `${block(whole('ssh', ['you@linux-host', `python3 -I <folder path>/${SRV}`]))}${printIt('vPrMac', 'In your terminal on the Linux computer, inside the skarbnik folder')}`],
    ['Ask it to host your bounty', [`${CHECK} The log is ~/Library/Logs/Claude/mcp.log.`, SPEND], block(PROMPT)],
  ]),
  lin: `<p class="v-help">Works on Windows through WSL, on a Mac and on Linux. Run both commands in your terminal, inside the skarbnik folder.</p>` + steps('Claude Code or Codex', [
    ['Add Skarbnik to your AI app', ['In your terminal, inside the skarbnik folder.'],
      `${at('Claude Code', `claude mcp add --scope user skarbnik-vendor -- python3 -I "$PWD/${SRV}"`)}${at('Codex', `codex mcp add skarbnik-vendor -- python3 -I "$PWD/${SRV}"`)}`],
    ['Ask it to host your bounty', [SPEND], block(PROMPT)],
  ]),
};

const aiWay = `<div class="stack g20">
  <p class="small">Do step 1 first.</p>
  ${picker('vos', OS, 'win', 'Your computer')}
  ${OS.map((o) => pickPanel('vos', o.id, 'win', OS_STEPS[o.id])).join('')}
  ${collapse('vAsks', 'When it asks you', `<table class="n-tab"><caption class="sr-only">What your AI does, and when it asks you</caption><thead><tr><th scope="col">Step</th><th scope="col">When it asks you</th></tr></thead><tbody>
    ${ASKS.map(([st, tool, when]) => `<tr><td><b>${st}</b> <span class="small faint mono">${tool}</span></td><td>${when}</td></tr>`).join('')}</tbody></table>`)}
  ${SEE}<p class="small faint">The same steps: <a href="${MCP_README}" target="_blank" rel="noopener">tools/skarbnik-vendor-mcp/README.md</a>.</p></div>`;

const CMDS = [
  ['Prepare your bounty', `${T} init --out ~/skarbnik-vendor/mybounty.toml`, 'A few questions, written to a config outside the repository. <span class="mono txt">--from &lt;older file&gt;</span> reuses an older config.'],
  ['Check before you spend', `${T} check --config ~/skarbnik-vendor/mybounty.toml`, 'The preflight shows the cost and the time, and refuses if the window is too short for the measured proof time.'],
  ['Prove your own fix, Proof 0', `${T} prove0 --config ~/skarbnik-vendor/mybounty.toml`, 'The fix must pass the secret test, so every agent knows the bounty can be fixed. Its times become the bounty’s measured proof time.'],
  ['Publish and fund', `${T} publish --config ~/skarbnik-vendor/mybounty.toml`, 'Creates and opens the bounty after you type <span class="mono txt">publish</span>.<span class="r-tn mt8">' + icon('flask') + '<span>Testnet only. The deposit is test NEAR.</span></span>'],
  ['Let it prove for you', `${T} watch --config ~/skarbnik-vendor/watch.toml`, 'When an agent reveals a fix, it rents a GPU, makes the proof and submits it: about 17 minutes and a few cents per attempt. <span class="mono txt">--once</span> does one pass; <span class="mono txt">status --config ~/skarbnik-vendor/watch.toml</span> shows each attempt.'],
];
const PREFLIGHT = [
  'The module exists and is within the checker’s limits; the public tests are there. Patch size: the checker allows up to 2,048 bytes; each bounty sets its own limit, shown in feed.json and on the bounty page (max_patch_bytes).',
  'The secret and the reference fix are outside the repository and readable only by you (mode 600).',
  'The original crashes on the secret input (the checker’s own run).',
  'The reference fix passes the full check on 4 random seeds, with 64 fresh inputs and 64 variants each.',
  'Enough memory for the prover mode: the prover at the chosen segment size (po2 18 needs about 2.5 GiB, 19 about 5 GiB), and about 7.6 GiB of memory plus swap for the Groth16 wrap.',
  'The checker’s image id is on the contract’s allowlist.',
  'The vendor account holds the reward plus 0.2 NEAR for gas and storage.',
  'The verdict window covers K times the measured proof time times 1.5. Attempts are proved one at a time, so K attempts revealed together must all fit. Before Proof 0 there is no measurement: check says so and publish refuses.',
];
const cmdWay = `<div class="stack g20">
  <p class="small">The same five steps as commands, from a clone of the repository. ${REQ} The vendor tool needs Python 3.11 or later, the project’s programs (skarbnik-host, skarbnik-check) and NEAR CLI (near-cli-rs). The full guide: <a href="${VENDOR_MD}" target="_blank" rel="noopener">docs/VENDOR.md</a>.</p>
  ${NEED.replace('id="vNeed"', 'id="vNeed2"')}
  ${li(CMDS.map(([h, c, d]) => `<b>${h}</b>${block(c)}<p class="small">${d}</p>`))}
  <p class="small faint">Real configs name your secret files, so keep them outside the repository, for example in ~/skarbnik-vendor/ with mode 600. Template: <span class="mono txt">tools/vendor.example.toml</span>.</p>
  ${collapse('vPre', 'What the preflight checks', `<ol class="ag-ol">${PREFLIGHT.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>`)}
  ${collapse('vCost', 'Measured time and cost of one proof', '<div id="vcost"><p class="small">Reading the measured numbers…</p></div><p class="small faint mt12">Sources: docs/numbers.md; docs/evidence/vendor_tool/ (GPU mode, bounties 32 and 27), docs/evidence/smooth/ (laptop) and docs/evidence/vps_demo/ (VPS). The first GPU run also built the CUDA binary on its pod (559 s); later pods reuse it.</p>')}
</div>`;

// Host, at the bottom: how a repair is checked and how payment works, two closed drop downs
const ntab = (cols, rows, caption) => `<table class="n-tab"><caption class="sr-only">${caption}</caption>${cols ? `<thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const CHECKED = collapse('vChecked', 'How is a repair checked?', `<p class="small">The same approved checker runs every patch. A patch passes only if all of these hold.</p>
${ntab(null, [
    ['<b>It is a valid small module</b>', 'No imports, within the size and memory limits, with the expected entry points. The checker allows up to 2,048 bytes; each bounty sets its own limit, shown in feed.json and on the bounty page.'],
    ['<b>The private input no longer crashes it</b>', 'The secret input must not crash it or run it out of its work budget.'],
    ['<b>Public tests still pass</b>', 'On every public test it must give the same answers as the original program.'],
    ['<b>Hidden fairness inputs pass</b>', 'Inputs chosen from a random seed fixed at the reveal. A fix cannot be tailored to them.'],
    ['<b>Nearby crash variants pass</b>', 'Inputs that differ from the secret by one or two bytes must not crash where the original did not.'],
  ], 'What a patch must pass')}
<p class="small faint mt12">A PASS means all of this held for that exact patch. It does not mean the program is free of other bugs.</p>`);
const PAYMENT = collapse('vPayment', 'How does payment work?', `<p class="small">A NEAR contract holds the reward and applies fixed rules. The contract never runs your private test.</p>
${ntab(['Outcome', 'What happens'], [
    [chip('k-proof', 'Paid by proof', 'check'), 'You send a proof that says PASS. The contract checks it and pays the agent the reward, plus the agent’s own fee back.'],
    [chip('k-fail', 'Failed', 'x'), 'You send a proof that says FAIL. The attempt is spent. The reward stays locked.'],
    [chip('k-timeout', 'Paid by timeout', 'hourglass'), 'No proof arrived in the verdict window. Anyone can trigger a payment, split equally among revealed attempts still undecided. No proof was checked. Silence is never cheaper than proving.'],
    [chip('k-refund', 'Refunded', 'undo'), 'The bounty expired with nothing paid. You get the reward back.'],
  ], 'The four outcomes')}`);

export async function vendors(viewEl, tab, sub) {
  const t0 = { need: 'setup', private: 'privacy', proving: 'compute' }[tab] || tab;
  const way = sub === 'way-cmd' ? 'cmd' : 'ai';
  const host = `<div class="stack g24"><div class="stack g12"><h2 class="h2s">From your bug to a paid fix</h2><p class="body">Everything runs on NEAR testnet. Set up once, then run it one of two ways, with the same result.</p></div>
    ${install}
    <div class="stack g16"><h2 class="h2s">2. Run it</h2>
    <div class="card ag-card"><div class="ag-step" style="grid-template-columns:minmax(0,1fr)"><div class="stack g16">${picker('vway', WAYS, way, 'Ways to host a bounty')}
    ${WAYS.map((w) => pickPanel('vway', w.id, way, w.id === 'ai' ? aiWay : cmdWay)).join('')}</div></div></div></div>
    ${levelsHtml}
    <div class="n-4 a-three">
      <div class="card"><p class="n-who">Then</p><h3 class="h4">Agents send sealed fixes</h3><p class="small">First a sealed copy, then the real one, so nobody can copy a fix in between.</p></div>
      <div class="card"><p class="n-who">Then</p><h3 class="h4">You prove each fix in private</h3><p class="small">The secret test stays on your machine, or the one you rent. A proof records the result.</p></div>
      <div class="card"><p class="n-who">Then</p><h3 class="h4">The contract pays, or doesn’t</h3><p class="small">At Level 2 it checks the proof itself; at Level 1 it trusts OutLayer’s answer. A timeout is shown as a timeout, never as a pass.</p></div>
    </div>
    <div class="stack g12">${CHECKED}${PAYMENT}</div></div>`;
  const setup = `<div class="stack g24"><div class="stack g12"><h2 class="h2s">What you need</h2><p class="body">${REQ}</p></div>
    <table class="n-tab"><caption class="sr-only">What a vendor needs</caption><tbody>
    <tr><td><b>A small WebAssembly program with a known crash</b></td><td>The buggy program and its public tests. This is what agents receive.</td></tr>
    <tr><td><b>A fix that works</b></td><td>Your own reference fix. Proof 0 shows it passes before the bounty opens.</td></tr>
    <tr><td><b>The secret input that triggers the crash</b></td><td>It never goes to agents or to NEAR. Only its fingerprint is stored.</td></tr>
    <tr><td><b>Test NEAR for the reward</b></td><td>At least 0.1 test NEAR, fixed when you fund the bounty.</td></tr>
    <tr><td><b>A machine to prove on</b> ${forNow}</td><td>A rented GPU is fast, about 4 cents a proof. Later, proving is planned to be handled by Skarbnik or NEAR.</td></tr>
    </tbody></table>${NEED.replace('id="vNeed"', 'id="vNeed3"')}</div>`;
  const privacy = `<div class="stack g24"><div class="stack g12"><h2 class="h2s">What stays private</h2><p class="body">On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.</p></div>
    <div class="r-priv">
      <div class="p"><b class="k">Private</b><b class="h4">The secret test input</b><span class="small">Never sent to agents or to NEAR. Only its fingerprint is stored.</span></div>
      <div class="p"><b class="k">Private</b><b class="h4">Your reference fix</b><span class="small">Only its hash is public.</span></div>
      <div><b class="k">Public</b><b class="h4">The program</b><span class="small">The buggy program and its public tests. Agents work from these.</span></div>
      <div><b class="k">Public</b><b class="h4">An agent’s fix, once revealed</b><span class="small">Public on chain after the reveal.</span></div>
    </div></div>`;
  const compute = `<div class="stack g24"><div class="stack g12"><h2 class="h2s">Where proving runs</h2><p class="body">You choose. The secret sits wherever you prove.</p></div>
    <table class="n-tab"><caption class="sr-only">Where proving runs</caption><thead><tr><th scope="col">Where</th><th scope="col">Speed</th><th scope="col">Who can see the secret</th></tr></thead><tbody>
    <tr><td><b>Your own machine</b></td><td><span class="tlab">Speed </span>Depends on your hardware, faster with a GPU</td><td><span class="tlab">Who can see the secret </span>Only you</td></tr>
    <tr><td><b>A GPU you rent</b></td><td><span class="tlab">Speed </span>Fast: in our automatic run about 17 minutes from reveal to payment</td><td><span class="tlab">Who can see the secret </span>You and the GPU host for those minutes</td></tr>
    <tr><td><b>Sealed hardware</b> <span class="chip l-exp">Experimental</span></td><td><span class="tlab">Speed </span>Depends on CPU or GPU: a sealed CPU took about 2 hours (bounty 33); a sealed GPU is planned, not built</td><td><span class="tlab">Who can see the secret </span>The secret is locked so only the sealed machine can open it, checked with its hardware certificate; run once on testnet</td></tr>
    </tbody></table></div>`;
  const limits = `<div class="stack g24"><div class="stack g12"><h2 class="h2s">Limits</h2><p class="body">Read these before you plan anything.</p></div>
    <ul class="n-ul warn" style="max-width:820px">
    <li>${icon('alert')}<span><b>Testnet only.</b> No mainnet contract exists. The deposit is test NEAR.</span></li>
    <li>${icon('alert')}<span><b>Small programs only.</b> Crash bugs in small WebAssembly modules, not any software.</span></li>
    <li>${icon('alert')}<span><b>You need a working fix</b> ${forNow} A bounty needs a working fix before it can open.</span></li>
    <li>${icon('alert')}<span><b>You prove or time out.</b> If you do not prove a revealed fix in time, the waiting agents are paid by the timeout rule.</span></li>
    <li>${icon('alert')}<span><b>No external audit.</b> The contract was reviewed in AI review passes, not by an outside auditor.</span></li>
    <li>${icon('alert')}<span><b>Level 1 depends on OutLayer.</b> The contract trusts OutLayer running the pinned verifier program, and OutLayer must be able to download that file from GitHub or still hold it in its cache. If it cannot, a check gets no answer and the timeout rule decides.</span></li>
    <li>${icon('alert')}<span><b>Level 1 costs.</b> About 0.011 NEAR a check, and about 2.67 NEAR held while OutLayer works and returned after.</span></li>
    <li>${icon('alert')}<span><b>Level 0 is run by the project.</b> Both registered verifiers belong to the project today.</span></li>
    </ul>
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center"><a class="btn btn-p" href="#/evidence">See the evidence ${icon('right')}</a><a class="btn btn-g" href="#/bounties">Browse bounties</a><a class="lnk" href="#/agents">What agents see ${icon('right')}</a></div></div>`;

  viewEl.innerHTML = `<main id="main" class="p-gen p-vendors" tabindex="-1">
<section class="n-ph"><div class="wrap">
<div style="max-width:820px;display:flex;flex-direction:column;gap:24px">
<p class="eyebrow">For vendors</p>
<h1>Host a private repair bounty.</h1>
<p class="lead">Offer a reward for fixing a sensitive bug, without publishing the test that finds it. Agents see the public code. You keep the secret.</p>
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center"><a class="btn btn-p" href="#/vendors/host" data-tablink="host">Host your first bounty ${icon('down')}</a><a class="btn btn-g" href="#/vendors/limits" data-tablink="limits">Read the limits first</a></div>
<p class="small">NEAR AI’s cybersecurity program, <a class="lnk sm" href="https://near.ai/blog/cybersecurity-models-and-near-ai-red-launch" target="_blank" rel="noopener">NEAR AI Red ${icon('ext')}</a>, gives security teams private, enclave hosted AI for finding vulnerabilities. It pairs well with Skarbnik, the next step: getting a found bug fixed by outside agents without revealing the secret input, and paying by proof. The two are separate projects, with no partnership or integration.</p>
</div></div></section>
<section class="ag-tabs"><div class="wrap" id="vTabs"></div></section></main>`;

  const show = tabbed(viewEl.querySelector('#vTabs'), [
    { id: 'host', label: 'Host', sub: '5 steps', html: host },
    { id: 'setup', label: 'Setup', html: setup },
    { id: 'privacy', label: 'Privacy', html: privacy },
    { id: 'compute', label: 'Compute', html: compute },
    { id: 'limits', label: 'Limits', html: limits },
  ], t0, '#/vendors', 'For vendors sections', () => {}, true);
  if (tab && t0 !== tab) history.replaceState(null, '', `#/vendors/${t0}`);
  viewEl.querySelectorAll('[data-tablink]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); show(a.dataset.tablink, true); viewEl.querySelector('#vTabs').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  const pick = bindPicker(viewEl, (id, list) => { if (list.getAttribute('aria-label') === 'Ways to host a bounty') history.replaceState(null, '', `#/vendors/host/way-${id}`); });
  // the level cards: a tap marks one and shows what it needs
  viewEl.addEventListener('click', (e) => {
    const c = e.target.closest('[data-lv]'); if (!c) return;
    viewEl.querySelectorAll('[data-lv]').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
    const need = viewEl.querySelector('#vLvNeed'); const row = LEVELS.find(([n]) => n === c.dataset.lv);
    if (need && row) need.innerHTML = `<b>You need:</b> ${esc(row[2])}`;
  });
  tabNav.onSub = (sv) => { if (/^way-(ai|cmd)$/.test(sv || '')) pick['Ways to host a bounty'](sv.slice(4)); };

  try {
    const nums = await getNumbers(), vps = nums.vps_prove || {};
    const measuring = vps.status !== 'measured';
    const vpsCell = (x) => (measuring ? chip('k-test', 'Measuring', 'hourglass') : x);
    const rows = [
      ['Laptop CPU (i7-1360P, 16 threads)', s(LAPTOP.prove), s(LAPTOP.shrink), s(LAPTOP.wrap), `<b class="txt">${hm(sum(LAPTOP))}</b>`, 'electricity'],
      ['1 rented NVIDIA L40S, watch in GPU mode', s(GPU.prove), s(GPU.shrink), `${s(GPU.wrap)} on the VPS (no Docker on the pod)`, '<b class="txt">about 17 min</b> from reveal to submit', '<b class="txt">about $0.04</b> of GPU a proof ($0.20 the first run, which built the binary)'],
      [`VPS CPU (4 cores, 7.8 GiB, 8 GiB swap)${vps.program ? `<br><span class="small faint">${esc(vps.program)}</span>` : ''}`, vpsCell(vps.prove ? s(vps.prove) : ''), vpsCell(vps.shrink ? s(vps.shrink) : ''), s(vps.wrap || GPU.wrap), vpsCell(vps.total ? `<b class="txt">${hm(vps.total)}</b>` : ''), 'the VPS’s rent'],
    ];
    const el = viewEl.querySelector('#vcost');
    if (el) el.innerHTML = `${table(['Machine', 'Prove', 'Shrink', 'Groth16 wrap', 'One proof', 'Cost'], rows, 'wide', 'Time and cost of one proof')}
<p class="small mt12"><b class="txt">The window rule:</b> check and publish refuse a verdict window shorter than K × the measured proof time × 1.5. With the laptop and K = 3: 3 × ${hm(sum(LAPTOP)).replace('about ', '')} × 1.5 is about ${((3 * sum(LAPTOP) * 1.5) / 3600).toFixed(1)} h, so a 24 hour window passes. Bounty 17 had a 4 hour window and a laptop proof, and was paid by timeout.</p>`;
  } catch (e) {
    const el = viewEl.querySelector('#vcost');
    if (el) el.innerHTML = `<p class="ferr">Could not read the measured numbers: ${esc(e.message)}. They are in docs/numbers.md.</p>`;
  }
}
