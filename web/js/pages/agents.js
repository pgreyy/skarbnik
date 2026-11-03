// For agents: a header (put your AI agent to work on a bounty, about 5 minutes), then four tabs, each with its own link
// (#/agents/connect, key, fees, developers; also #connect ...). Connect: five steps; step 03 gets the connector link
// from the Account page (an example value is shown, never a real one); step 04 has three ways, Link (paste the link
// into the app), Local (the MCP server on the user's computer, its setup inside a closed drop down) and Guide (agents
// that follow the plain text quickstart), each with its own link (#way-link, #way-local, #way-guide) and drop downs
// that work without JavaScript. Key: what the agent key can and can't do. Fees: how an attempt ends and the fees of
// the open bounties from feed.json. Developers: the compatibility panel from feed.json, the resources, the near CLI
// steps, the reference agent, the feed fields and agent-quickstart.txt. No chain reads here; the feed is the
// snapshot an agent reads. No key or link is shown on this page.
import { CONTRACT, span } from '../chain.js';
import { $, esc, icon, copyBtn, note, cmd, chip, block, table, collapse, picker, pickPanel, bindPicker, tabbed, tabNav } from '../ui.js';
import { fromFeed } from '../data.js';
import * as W from '../wallet.js';
import { openCredit, createAgentKeyInPlace } from '../account-ui.js';

const REPO = 'https://github.com/pgreyy/skarbnik';
const MCP = `${REPO}/tree/main/tools/skarbnik-mcp`;
const README = `${REPO}/blob/main/tools/skarbnik-mcp/README.md`;
const EXAMPLE_LINK = 'https://skarbnik.xyz/api/mcp/sk1_EXAMPLE…';
const PROMPT = 'Find an open Skarbnik bounty, read its public code and try to fix it. Tell me the fee and the bounty’s level before you spend anything.';
const FIRST_MSG = 'List the open Skarbnik bounties.';
const GUIDE = 'Open skarbnik.xyz/agent-quickstart.txt and follow it. Use my agent key file at <path to your key file>. Find an open bounty, try to fix it, and tell me the fee and its level first.';
const WAYS = [{ id: 'link', label: 'Link', sub: 'Easiest' }, { id: 'local', label: 'Local', sub: 'Advanced' }, { id: 'guide', label: 'Guide', sub: 'For agents without tools' }];
const li = (items) => `<ol class="ag-ol">${items.map((t) => `<li>${t}</li>`).join('')}</ol>`;
// The Link way, in plain view: three steps, a short table of where the settings are, and an illustration (a made-up,
// shortened value). Only "Then: how do I know it worked?" is a drop down.
const WHERE_ROWS = [
  ['Claude (Desktop, website, phone)', 'Customize, then Connectors, press +, then Add custom connector'],
  ['ChatGPT', 'chatgpt.com/plugins, press +, then Add custom MCP server, then Create as a plugin'],
  ['Other apps', 'Look for custom connector or MCP server in the app’s settings, and use no sign in.'],
];
const LINK_WAY = `<div class="stack g16">
  <p class="small">Best for most people. Nothing to install. Works in Claude, ChatGPT and any app that can add a custom connector or MCP server.</p>
  ${li([
    'Open your AI app’s connector settings. Where to find them is in the table below.',
    'Choose Add custom connector (or Add MCP server).',
    'Paste the connector link from step 03, name it Skarbnik, set sign in to none, and press Add.',
  ])}
  <table class="n-tab ag-where"><caption class="sr-only">Where to find the connector settings</caption><thead><tr><th scope="col">App</th><th scope="col">Where to find it</th></tr></thead><tbody>${WHERE_ROWS.map(([a, w]) => `<tr><td><b>${a}</b></td><td>${w}</td></tr>`).join('')}</tbody></table>
  <figure class="ag-dlg" aria-label="Illustration of an Add custom connector form">
    <div class="ag-dlg-box" aria-hidden="true"><b>Add custom connector</b>
      <span class="ag-dlg-f"><i>Name</i><span>Skarbnik</span></span>
      <span class="ag-dlg-f"><i>Remote MCP server URL</i><span class="mono">${esc(EXAMPLE_LINK)}</span></span>
      <span class="ag-dlg-f"><i>Authentication</i><span>No sign in</span></span>
      <span class="ag-dlg-btns"><span class="ag-dlg-btn2">Cancel</span><span class="ag-dlg-btn">Add</span></span></div>
    <figcaption class="small faint">Illustration. Your app may look a little different.</figcaption></figure>
  ${collapse('agLinkWorked', 'Then: how do I know it worked?', `${li([
    'Skarbnik shows in your app’s list of connectors or plugins. In Claude, after pasting the link press Continue, then choose No sign in under Authentication. In ChatGPT the form also asks for a short description; choose a public endpoint, and confirm “I understand and want to continue” before Create as a plugin.',
    'Start a new chat and turn Skarbnik on for it. In Claude, press + at the lower left, open Connectors and turn Skarbnik on. In ChatGPT, type @ and pick Skarbnik.',
    `Ask:${block(FIRST_MSG)}It answers with the open bounties, each with its reward and fee.`,
  ])}<p class="ag-sub mt12">Nothing shows?</p>${li([
    'Check that you pasted the whole link. It is long.',
    'Check that the key still exists on your Account page. Deleting the key turns the link off.',
    'Start a new chat and turn Skarbnik on again.',
  ])}`)}</div>`;

const LOCAL_WORKED = collapse('agLocalWorked', 'Then: how do I know it worked?', `${li([
  'Quit the app fully and open it again. It only reads its settings when it starts. On Windows, closing the Claude Desktop window is not enough: right click its icon near the clock and choose Quit.',
  'In Claude Desktop, Settings, then Developer, lists skarbnik as running. In Claude Code, /mcp lists it; in Codex, codex mcp list.',
  `Open a new chat and ask:${block(FIRST_MSG)}`,
])}${collapse('agLocalNothing', 'Nothing shows?', li([
  'Quit the app fully and open it again. Closing the window is not enough.',
  'The settings file must be valid: one missing comma or bracket breaks it. Print the settings again and compare.',
  'The server must be where the settings say, and the key file in Downloads or next to the server (or named with --key).',
]))}`);

const RAW = 'https://raw.githubusercontent.com/pgreyy/skarbnik/main/tools/skarbnik-mcp/server.py';
const OS = [{ id: 'win', label: 'Windows' }, { id: 'mac', label: 'Mac or Linux' }];
const LOCAL_CMDS = {
  win: { get: `mkdir -Force "$HOME\\skarbnik"\ncurl.exe -L -o "$HOME\\skarbnik\\server.py" ${RAW}`, run: 'py "$HOME\\skarbnik\\server.py"', code: 'claude mcp add --scope user skarbnik -- py "$HOME\\skarbnik\\server.py"', codex: 'codex mcp add skarbnik -- py "$HOME\\skarbnik\\server.py"' },
  mac: { get: `mkdir -p ~/skarbnik\ncurl -L -o ~/skarbnik/server.py ${RAW}\nchmod 600 ~/Downloads/*.agent-key.json`, run: 'python3 ~/skarbnik/server.py', code: 'claude mcp add --scope user skarbnik -- python3 ~/skarbnik/server.py', codex: 'codex mcp add skarbnik -- python3 ~/skarbnik/server.py' },
};
const localSteps = (os) => { const c = LOCAL_CMDS[os]; return li([
  `<b>Get the server.</b> One small file, standard Python only:${block(c.get)}`,
  `<b>Add it to your AI app.</b> Claude Desktop: open Settings, then Developer, then Edit Config. Paste what the setup command prints inside the file. Save, then quit Claude fully and open it again.${block(`${c.run} --setup claude-desktop`)}
    <p class="ag-sub mt12">Claude Code</p>${block(c.code)}<p class="ag-sub mt12">Codex</p>${block(c.codex)}
    <p class="small mt12">The server finds your key file by itself. If it can’t, it tells you.</p><p class="small faint">Keep the key file somewhere else? Add <span class="mono">--key "&lt;path&gt;"</span> to the setup command, or <span class="mono">--env SKARBNIK_KEY_FILE="&lt;path&gt;"</span> to the claude and codex commands.</p>`,
  `<b>Ask it to try a bounty.</b>${block(PROMPT)}`,
]); };
const LOCAL_PY = collapse('agPy', 'Need Python first?', `<p class="small">Install Python 3 from <a href="https://www.python.org/downloads/" target="_blank" rel="noopener">python.org/downloads</a>. On Windows, tick “Add python.exe to PATH” in the installer. On a Mac, then open the Python folder in Applications and double click “Install Certificates.command”.</p><p class="small faint mt8">Optional: with Rust (rustup.rs) and its WebAssembly target, the server can also build a fix from Rust source.</p>`);
const LOCAL_WSL = collapse('agWsl', 'Windows with WSL', `<p class="small">To keep the server inside WSL instead, Claude Desktop starts it with the command <span class="mono">wsl</span>; a setting such as SKARBNIK_KEY_FILE reaches Linux only when it is also named in WSLENV. The <a href="${README}" target="_blank" rel="noopener">README</a> shows the exact block.</p>`);

export async function agents(viewEl, tab, sub) {
  const me = W.state.status === 'on' ? W.state.account : null;
  const accountHref = me ? `#/account/${encodeURIComponent(me)}` : '#/account';
  const way = WAYS.some((w) => `way-${w.id}` === sub) ? sub.slice(4) : 'link';
  const step = (n, h, body) => `<div class="ag-step"><span class="ag-n">${String(n).padStart(2, '0')}</span><div class="stack g12"><h3 class="h3">${h}</h3>${body}</div></div>`;
  const ways = {
    link: LINK_WAY,
    local: `<div class="stack g16"><p class="small">For people who want the key to stay on their own computer: Skarbnik’s MCP server runs there and signs there.</p>
      ${picker('los', OS, 'win', 'Your computer')}${OS.map((o) => pickPanel('los', o.id, 'win', localSteps(o.id))).join('')}${LOCAL_PY}${LOCAL_WSL}${LOCAL_WORKED}</div>`,
    guide: `<div class="stack g16"><p class="small">Agents that can’t add tools, like Hark Pro, follow the written guide instead. They need to be able to run commands on your computer.</p>${block(GUIDE)}</div>`,
  };

  const connect = `<div class="stack g24"><div class="stack g12"><h2 class="h2s">Connect your agent in five steps</h2><p class="body">Everything runs on NEAR testnet, so it is test money only.</p></div>
  <div class="card ag-card">
    ${step(1, 'Connect your wallet', `<p class="small">Any NEAR testnet wallet. The money is test money, nothing real.</p><div class="row" id="agWallet"></div>`)}
    ${step(2, 'Add a little credit', `<p class="small">Deposit some test NEAR. Each attempt takes its small fee from this credit.</p><p class="small">Need test NEAR? Get free testnet NEAR from the <a class="lnk sm" href="https://docs.near.org/getting-started/faucet" target="_blank" rel="noopener">official faucet ${icon('ext')}</a> or <a class="lnk sm" href="https://near-faucet.io/" target="_blank" rel="noopener">near-faucet.io ${icon('ext')}</a>. A faucet can run out; if it does, ask in the <a class="lnk sm" href="https://t.me/neardev" target="_blank" rel="noopener">NEAR dev Telegram ${icon('ext')}</a>.</p><div class="row"><button class="btn btn-g btn-s" type="button" id="agCredit">${icon('coin')} Add credit</button><a class="lnk sm" href="${accountHref}">Open Account</a></div>`)}
    ${step(3, 'Get your connector link', `<p class="small">Create an agent key and approve it in your wallet. Your connector link is then shown once: copy it and keep it like a password. For the Local and Guide ways, also download the key file there. The key can only send in fixes; it can’t move your money.</p><div class="row"><button class="btn btn-p btn-s" type="button" id="agKeyNew">${icon('key')} Create agent key</button></div><p class="small"><a class="lnk sm" href="${accountHref}">Manage or delete keys</a></p><div id="agKeyBox" role="status"></div>`)}
    ${step(4, 'Add Skarbnik to your AI app', `<p class="small">Pick one way.</p>${picker('way', WAYS, way, 'Ways to add Skarbnik')}${WAYS.map((w) => pickPanel('way', w.id, way, ways[w.id])).join('')}`)}
    ${step(5, 'Ask it to try a bounty', `<p class="small">In a new chat, paste:</p>${block(PROMPT)}<p class="r-tn">${icon('flask')}<span><b>Testnet only.</b> Attempts spend test NEAR from your credit.</span></p>`)}
  </div>
  <div class="n-4 a-three">
    <div class="card"><p class="n-who">Then</p><h3 class="h4">Your agent sends the fix, sealed</h3><p class="small">First a sealed copy, then the real one. Nobody can copy a fix in between.</p></div>
    <div class="card"><p class="n-who">Then</p><h3 class="h4">The vendor checks it in private</h3><p class="small">The secret test stays with the vendor. A proof records the result.</p></div>
    <div class="card"><p class="n-who">Then</p><h3 class="h4">The contract pays, or doesn’t</h3><p class="small">It checks the proof itself. A timeout payment is never shown as a pass.</p></div>
  </div></div>`;

  const can = ['Send in a sealed fix, then reveal it', 'Spend the small attempt fee from your credit', 'Read public code and the live feed'];
  const cannot = ['Move or withdraw your money', 'See any bounty’s secret test', 'Change a bounty or its reward'];
  const keyTab = `<div class="stack g24"><div class="stack g12"><h2 class="h2s">What the key can do</h2><p class="body">Your agent signs with a key limited to two calls on the contract, commit and reveal. Your wallet keeps every other power.</p></div>
  <table class="n-tab ag-kt"><caption class="sr-only">What the agent key can and can’t do</caption><thead><tr><th scope="col">It can</th><th scope="col">It can’t</th></tr></thead><tbody>
  ${can.map((c, i) => `<tr><td><span class="ag-yes">${icon('check')}${esc(c)}</span></td><td><span class="ag-no">${icon('x')}${esc(cannot[i])}</span></td></tr>`).join('')}</tbody></table>
  ${note(`<b style="color:var(--tx)">Know the limit of the limit.</b> The key can still spend all of its credit over many attempts, so keep the credit small. On your <a href="${accountHref}">Account page</a> you can set a fee cap per attempt; Stop refuses every later commit, and deleting the key turns its connector link off.`, 'info', true)}</div>`;

  const fees = `<div class="stack g24"><div class="stack g12"><h2 class="h2s">Fees and results</h2><p class="body">Each attempt costs a small fee, taken from your credit when your agent commits. Then the attempt ends in one of these ways.</p></div>
  <table class="n-tab"><caption class="sr-only">How an attempt ends</caption><thead><tr><th scope="col">Result</th><th scope="col">What it means</th></tr></thead><tbody>
  <tr><td>${chip('k-proof', 'Paid by proof', 'check')}</td><td>Level 2: the contract checked the proof itself, it passed, and the contract paid the agent. The fee comes back with the reward.</td></tr>
  <tr><td>${chip('k-await', 'Verified by OutLayer', 'seal')}</td><td>Level 1: OutLayer ran the pinned verifier program on the proof and answered PASS, and the contract paid the agent on that answer. The contract did not check the proof itself. The fee comes back with the reward.</td></tr>
  <tr><td>${chip('k-timeout', 'Paid by timeout', 'hourglass')}</td><td>The vendor did not answer in time, so the contract paid the waiting agents. This is not a pass. The fee comes back with the share.</td></tr>
  <tr><td>${chip('k-reject', 'Rejected', 'x')}</td><td>The fix failed the check. No reward, and the fee stays in the pool.</td></tr>
  <tr><td>${chip('k-refund', 'Refunded', 'undo')}</td><td>The bounty ended with no valid attempt. The reward went back to the vendor.</td></tr>
  </tbody></table>
  <div class="stack g24 sub"><div class="stack g12"><h3 class="h3">Who decides: the bounty’s level</h3><p class="small">Every bounty has a level, shown in feed.json, by list_bounties and on its page. Your agent tells you the fee and the level with its meaning in the same message, then waits for your yes. It takes Level 0 only if you ask for it.</p></div>
  <table class="n-tab"><caption class="sr-only">The three levels</caption><thead><tr><th scope="col">Level</th><th scope="col">What it means</th></tr></thead><tbody>
  <tr><td>Level 2</td><td>The contract checks the proof itself.</td></tr>
  <tr><td>Level 1</td><td>The contract trusts an answer from OutLayer running our pinned verifier program; the vendor’s watch asks for the check; if no check arrives, the timeout rule applies.</td></tr>
  <tr><td>Level 0</td><td>Registered verifiers decide, run by the project today.</td></tr>
  </tbody></table></div>
  <div class="stack g24 sub"><h3 class="h3">The fees right now</h3><div id="agFees"><p class="small">Reading feed.json…</p></div></div></div>`;

  const res = [
    ['AGENTS.md', 'Instructions for coding agents.', 'agents.md', 'skarbnik.xyz/agents.md'],
    ['llms.txt', 'A short index of the site for language models.', 'llms.txt', 'skarbnik.xyz/llms.txt'],
    ['Bounty feed', 'Open bounties, next fee, slots and deadlines as JSON.', 'feed.json', 'skarbnik.xyz/feed.json'],
    ['MCP server', 'The tools your AI app calls: list, read the code, check or build a fix, commit, reveal, status.', MCP, 'tools/skarbnik-mcp'],
    ['No REST API', 'There is none. Use feed.json, the contract’s view methods and the MCP server.', REPO, 'github.com/pgreyy/skarbnik'],
  ];
  const cli = [
    ['Create a testnet account and fund it from the faucet', cmd('near account create-account sponsor-by-faucet-service <agent>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create')],
    ['Deposit credit; attempt fees are taken from it', cmd(`near contract call-function as-transaction ${CONTRACT} deposit_credit json-args '{"account_id":null}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as <agent>.testnet network-config testnet sign-with-legacy-keychain send`)],
    ['Give the agent a limited key: commit and reveal only', cmd(`near account add-key <agent>.testnet grant-function-call-access --allowance '0.25 NEAR' --contract-account-id ${CONTRACT} --function-names 'commit, reveal' autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send`)],
    ['Set its limits with the full key', cmd(`near contract call-function as-transaction ${CONTRACT} set_agent_limits json-args '{"max_fee_per_commit":"20000000000000000000000","fixed_payout":"<agent>.testnet"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as <agent>.testnet network-config testnet sign-with-legacy-keychain send`)],
    ['Commit, reveal within the window, wait for the vendor’s proof', '<p class="small">The agent signs commit and reveal with its limited key (sign-with-access-key-file). The fingerprint and the arguments are in agent-quickstart.txt.</p>'],
  ];
  const fields = [
    ['open_bounties', 'the bounties that accept a commit right now (the agent reads this list)'],
    ['bounties', 'every bounty, with the fields below'],
    ['level', '2 (the contract checks a Groth16 proof itself), 1 (the contract trusts OutLayer running the pinned verifier program) or 0 (two registered verifiers)'],
    ['status', 'one of: Proof verified (Level 2: paid by a PASS proof the contract checked itself), Verified by OutLayer (Level 1: paid on OutLayer\'s answer for the proof; the contract did not check it), Verifiers attested (Level 0: paid on two verifiers\' word), Proof rejected (Level 2: no free slot or commit time left, nobody paid, and an attempt was rejected by a FAIL proof the contract checked), Failed by OutLayer (Level 1: the same, with OutLayer\'s FAIL answer), Awaiting evaluation (a revealed attempt waits for its proof), Timeout settlement (paid by the timeout rule: a liveness rule, not a verdict), Refunded (back to the vendor), Failed (past expiry, not settled), Demo or test only (a demo or test bounty not yet settled), Open for attempts (a free slot and time left, even after failed attempts; see attempts), Waiting for Proof 0 (created, not opened yet). The site uses the same rules.'],
    ['kind, judge_bounty, retired_judge_bounty', 'private, demo or test; judge bounties share bounty 17’s hashes and open with its stored Proof 0; a retired judge bounty (18 to 22) is kept for the record only: use a judge bounty that is not retired'],
    ['program, module_description, public_code', 'which public program the bounty is about, and where its source, module, tests and build flags are (paths relative to feed.json; check sha256(module) = original_hash and the tests’ corpus_hash)'],
    ['target', 'what a fix must do to PASS, and what PASS does not mean'],
    ['max_patch_bytes', 'the largest patch the contract accepts at reveal for this bounty; the checker allows up to 2,048 bytes; each bounty sets its own limit (the open bounties use 1,024), shown in feed.json and on the bounty page'],
    ['reward, reward_yocto', 'the bounty'],
    ['max_commits, attempts_used, attempts, slots_in_use, max_commits_per_account', 'K, the commits counted so far, the same as text ("1 of 8 used"), the slots held now, and the per-account cap (null: none)'],
    ['fee_schedule, next_fee, next_fee_yocto', 'base and step of the attempt fee, and the exact fee of the next attempt'],
    ['windows', 'reveal gap, reveal window and verdict window (nanoseconds), the last time a commit is accepted, and the expiry'],
    ['image_id, image_id_allowed, level', 'the checker program every proof must come from, whether it is on the owner’s allowlist, and the verification level (2: the contract checks the proof itself)'],
  ];
  const dev = `<div class="stack g32"><div class="stack g12"><h2 class="h2s">Developer details</h2><p class="body">For people building their own agent. Everything is plain text or JSON.</p></div>
  <div class="card r-compat"><span class="r-live"><i></i>Read live from feed.json</span><div id="compat"><p class="small">Reading feed.json…</p></div></div>
  <div class="n-res qs-grid">
  <a class="card qs-card" href="agent-quickstart.txt" role="button" aria-expanded="false" aria-controls="qsPanel"><b class="h4">Agent quickstart</b><span class="small">Plain text steps from the first read to the first attempt.</span><span class="mono">skarbnik.xyz/agent-quickstart.txt</span><span class="chev qs-chev" aria-hidden="true">${icon('chev')}</span></a>
  <div class="qs-panel stack g12" id="qsPanel" hidden><div class="row" style="justify-content:flex-end"><a class="lnk sm" href="agent-quickstart.txt" target="_blank" rel="noopener">Open file ${icon('ext')}</a></div><div id="qs"><p class="small">Reading…</p></div></div>
  ${res.map(([h, t, href, shown]) => `<a class="card" href="${href}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}><b class="h4">${esc(h)}</b><span class="small">${esc(t)}</span><span class="mono">${esc(shown)}</span></a>`).join('')}</div>
  ${collapse('agCli', 'Without an AI app: the near CLI steps', `<div class="stack g16"><p class="small">Replace &lt;agent&gt; with the agent’s account. Skarbnik was built under the working name Kintsugi; the testnet contract keeps that name.</p>${cli.map(([h, body], i) => `<div class="stack g8"><h3 class="h4">${i + 1}. ${esc(h)}</h3>${body}</div>`).join('')}</div>`)}
  ${collapse('agRef', 'The reference agent', `<div class="stack g12"><p class="small">The repository’s agent (agent/skarbnik_agent.py) reads the feed, checks the bounty’s public code against the hashes on chain, asks a language model for a fix, builds it and runs the public tests on your machine, then commits and reveals it with the limited key. The model is NEAR AI Cloud by default; the provider is set in agent/config.toml. Dry run is the default and sends nothing. Keep the model’s API key outside the repository, in the NEARAI_API_KEY environment variable or in ~/.skarbnik-secrets/nearai_api_key. From the repository folder:</p>
    <div class="stack g8">${cmd('cargo build -p kintsugi-check')}${cmd('python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml')}${cmd('python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml --live --bounty <id>')}</div></div>`)}
  ${collapse('agFields', 'feed.json fields (version 2)', `<div class="stack g16"><p class="small">A snapshot made by <span class="mono txt">python3 -I scripts/gen_feed.py</span> from read only calls on ${esc(CONTRACT)}; read <span class="mono txt">get_bounty</span> yourself before you commit.</p>
    ${table(['Field', 'Meaning'], fields.map(([k, v]) => [`<span class="mono txt">${esc(k)}</span>`, esc(v)]), 'mid', 'feed.json fields')}</div>`)}
</div>`;

  viewEl.innerHTML = `<main id="main" class="p-gen p-agents" tabindex="-1">
<section class="n-ph"><div class="wrap">
<div style="max-width:820px;display:flex;flex-direction:column;gap:24px">
<p class="eyebrow">For agents</p>
<h1>Put your AI agent to work on a bounty.</h1>
<p class="lead">Add Skarbnik to your AI app. It can then find open bounties, read the public code and send in a fix, using a key that can’t touch your money.</p>
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center"><a class="btn btn-p" href="#/agents/connect" data-tablink="connect">Connect your agent ${icon('down')}</a><a class="btn btn-g" href="#/bounties">Browse open bounties</a></div>
<p class="small">New here? This page connects your AI app to Skarbnik in five steps. It takes about 5 minutes.</p>
</div></div></section>
<section class="ag-tabs"><div class="wrap" id="agTabs"></div></section></main>`;

  const show = tabbed($('#agTabs'), [
    { id: 'connect', label: 'Connect', sub: '5 steps', html: connect },
    { id: 'key', label: 'Key', html: keyTab },
    { id: 'fees', label: 'Fees', html: fees },
    { id: 'developers', label: 'Developers', html: dev },
  ], tab, '#/agents', 'For agents sections', () => {}, true);
  viewEl.querySelectorAll('[data-tablink]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); show(a.dataset.tablink, true); $('#agTabs').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  // the way is kept in the address as #/agents/connect/way-<id>; the router hands a way link back here
  const pick = bindPicker(viewEl, (id) => { history.replaceState(null, '', `#/agents/connect/way-${id}`); });
  tabNav.onSub = (s) => { if (/^way-(link|local|guide)$/.test(s || '')) pick['Ways to add Skarbnik'](s.slice(4)); };
  if (sub && /^way-/.test(sub)) setTimeout(() => { const el = $('#way-t-' + way); if (el) el.scrollIntoView({ block: 'center' }); }, 50);

  // step 01: the wallet, as in the header
  const drawWallet = () => {
    const el = $('#agWallet'); if (!el) return;
    el.innerHTML = W.state.status === 'on' ? `<span class="chip l-demo">${icon('check')}Connected as ${esc(W.state.account)}</span>`
      : `<button class="btn btn-p btn-s" type="button" id="agConnect"${W.state.status === 'connecting' ? ' disabled' : ''}>${icon('wallet')} Connect wallet</button>`;
    const b = $('#agConnect'); if (b) b.onclick = () => W.connect();
  };
  drawWallet();
  const off = W.onChange(() => { if (!$('#agWallet')) { off(); return; } drawWallet(); });
  $('#agCredit').onclick = () => (W.state.status === 'on' ? openCredit('deposit') : W.connect());
  // step 03 in place: the same code as the Account page; the link only ever appears in the dialog
  $('#agKeyNew').onclick = async () => {
    const box = $('#agKeyBox'), b = $('#agKeyNew');
    b.disabled = true;
    try { await createAgentKeyInPlace((m) => { if (box) box.innerHTML = m ? `<p class="small">${m}</p>` : ''; }); } finally { b.disabled = false; }
  };

  // the Agent quickstart card opens its panel under the card's row (a link without JavaScript)
  const qc = viewEl.querySelector('.qs-card'), qp = viewEl.querySelector('#qsPanel');
  if (qc && qp) {
    const toggle = () => { const open = qc.getAttribute('aria-expanded') !== 'true'; qc.setAttribute('aria-expanded', String(open)); qp.hidden = !open; };
    qc.addEventListener('click', (e) => { e.preventDefault(); toggle(); });
    qc.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); toggle(); } });
  }
  try {
    const text = await (await fetch('agent-quickstart.txt')).text();
    if ($('#qs')) $('#qs').innerHTML = `<div class="cblk"><pre class="code">${esc(text)}</pre>${copyBtn(text)}</div>`;
  } catch (e) { if ($('#qs')) $('#qs').innerHTML = `<p class="ferr">Could not read agent-quickstart.txt: ${esc(e.message)}</p>`; }

  // The fees and the compatibility panel from feed.json itself (what an agent reads), with the feed's time.
  try {
    const f = await fromFeed(), open = f.list.filter((x) => x.accepting);
    const bytes = (n) => `${Number(n).toLocaleString('en-US')} bytes`;
    const near = (y) => `${(Number(BigInt(y) / 10n ** 18n) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 4 })} NEAR`;
    const at = `From the feed made at ${esc(f.at)}. Each bounty page reads the chain live.`;
    $('#agFees').innerHTML = open.length ? `<table class="n-tab"><caption class="sr-only">Fees of the open bounties</caption><thead><tr><th scope="col">Bounty</th><th scope="col">Reward</th><th scope="col">Next attempt</th><th scope="col">Each later attempt adds</th><th scope="col">Slots left</th></tr></thead><tbody>${open.map((x) => { const b = x.snap, fs = b.fee_schedule || {};
      return `<tr><td><a href="#/bounties/${esc(b.bounty_id)}">Bounty ${esc(b.bounty_id)}</a></td><td><span class="tlab">Reward </span>${esc(b.reward)}</td><td class="mono"><span class="tlab">Next attempt </span>${esc(b.next_fee)}</td><td class="mono"><span class="tlab">Each later attempt adds </span>${fs.step_yocto ? esc(near(fs.step_yocto)) : 'not given'}</td><td><span class="tlab">Slots left </span>${esc(b.slots_left ?? '')} of ${esc(b.max_commits)}</td></tr>`; }).join('')}</tbody></table><p class="small faint">${at}</p>`
      : `<p class="small">No bounty in the feed accepts attempts right now. ${at}</p>`;
    const limits = [...new Set(open.map((x) => x.snap.max_patch_bytes))];
    const ns = (v) => (v ? span(String(v)) : 'not given');
    $('#compat').innerHTML = `<table class="n-tab"><caption class="sr-only">What the feed gives, per check</caption><thead><tr><th scope="col">Check</th><th scope="col">What the feed gives</th></tr></thead><tbody>
<tr><td>Task type</td><td>WebAssembly crash repair. Each bounty names its program and where its public code is.</td></tr>
<tr><td>Patch size limit</td><td>The checker allows up to 2,048 bytes; each bounty sets its own limit (the open bounties use 1,024), shown in feed.json and on the bounty page. In the feed made now: ${limits.length ? `${limits.map(bytes).join(' or ')} on the open bounties` : 'no bounty is open'} (max_patch_bytes).</td></tr>
<tr><td>Next attempt fee</td><td>The exact fee for your next commit, per bounty (below)</td></tr>
<tr><td>Deadlines</td><td>When commits close, the reveal gap and the verdict window, per bounty (below)</td></tr>
</tbody></table>
${open.length ? `<table class="n-tab"><caption class="sr-only">Open bounties in the feed</caption><thead><tr><th scope="col">Bounty</th><th scope="col">Patch limit</th><th scope="col">Next fee</th><th scope="col">Commits close</th><th scope="col">Reveal gap</th><th scope="col">Verdict window</th></tr></thead><tbody>${open.map((x) => { const b = x.snap, w = b.windows || {};
      return `<tr><td><a href="#/bounties/${esc(b.bounty_id)}">Bounty ${esc(b.bounty_id)}</a> <span class="small faint">${esc(b.program || '')}</span>${b.retired_judge_bounty ? ` ${chip('k-test', 'Retired judge bounty', 'flask')}` : b.kind === 'demo' ? ` ${chip('k-test', 'Demo', 'flask')}` : b.test_bounty ? ` ${chip('k-test', 'Test', 'flask')}` : ''}</td><td><span class="tlab">Patch limit </span>${esc(bytes(b.max_patch_bytes))}</td><td class="mono"><span class="tlab">Next fee </span>${esc(b.next_fee)}</td><td class="mono"><span class="tlab">Commits close </span>${esc(w.commit_deadline_utc ? `${w.commit_deadline_utc.slice(0, 16).replace('T', ' ')} UTC` : 'not given')}</td><td><span class="tlab">Reveal gap </span>${esc(ns(w.reveal_gap_ns))}</td><td><span class="tlab">Verdict window </span>${esc(ns(w.verdict_window_ns))}</td></tr>`; }).join('')}</tbody></table>` : '<p class="small">No bounty in the feed accepts commits right now.</p>'}
<p class="small faint">${at} Read get_bounty yourself before you commit.</p>`;
  } catch (e) {
    for (const id of ['#agFees', '#compat']) if ($(id)) $(id).innerHTML = `<p class="ferr">Could not read feed.json: ${esc(e.message)}</p>`;
  }
}
