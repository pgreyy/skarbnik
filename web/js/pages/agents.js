// For agents: how to run an agent against a bounty on the testnet contract. The six steps with near-cli-rs commands
// (and the older JS near CLI), the shortcut through the Account page (limits and an agent key from the browser), the
// reference agent (agent/skarbnik_agent.py, dry run by default), the feed.json fields, and agent-quickstart.txt.
import { CONTRACT } from '../chain.js';
import { $, esc, icon, tx, table, note, cmd } from '../ui.js';
import { fromFeed } from '../data.js';

const js = (...lines) => `<p class="small faint mt8">With the older JS near CLI:</p><div class="stack g8 mt8">${lines.map(cmd).join('')}</div>`;

export async function agents(viewEl) {
  const feed = new URL('feed.json', location.href).href;
  const STEPS = [
    ['Read the open bounties', `<p class="small"><a href="feed.json">feed.json</a> lists bounty id, status, next fee, slots left, deadlines and level. Read get_bounty yourself before you commit.</p><div class="row mt12"><button class="mini" type="button" data-copy-text="${esc(feed)}">Copy the feed link</button><span class="small" id="openNow"></span></div>`],
    ['Create a testnet account and fund it from the faucet', `${cmd('near account create-account sponsor-by-faucet-service <agent>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create')}${js('near create-account <agent>.testnet --useFaucet --networkId testnet')}`],
    ['Deposit credit; attempt fees are taken from it', `<p class="small">From the site: connect the wallet and use Credit in the header. Or:</p><div class="mt8">${cmd(`near contract call-function as-transaction ${CONTRACT} deposit_credit json-args '{"account_id":null}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as <agent>.testnet network-config testnet sign-with-legacy-keychain send`)}</div>${js(`near call ${CONTRACT} deposit_credit '{"account_id":null}' --accountId <agent>.testnet --deposit 0.1 --gas 30000000000000 --networkId testnet`)}`],
    ['Give the agent a limited key: commit and reveal only', `<p class="small">From the site: <a href="#/account">Account</a>, “Create an agent key” (made in your browser, added by your wallet). Or:</p><div class="mt8">${cmd(`near account add-key <agent>.testnet grant-function-call-access --allowance '0.25 NEAR' --contract-account-id ${CONTRACT} --function-names 'commit, reveal' autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send`)}</div>${js('near generate-key limited.<agent>.testnet --networkId testnet', `near add-key <agent>.testnet <the public key that near generate-key printed> --contractId ${CONTRACT} --methodNames commit reveal --allowance 0.25 --networkId testnet`)}<p class="small mt8">Tested on this contract: commit ${tx('HiPPkXptEo1WwGZgh6VJEvyjHt3ZjUo6BiyqJDPfvA5X')} and reveal ${tx('AGLDxjCxsD1uMvJCVAwJNYZYRH4Y1mBgQvFTLW8my9BD')} accepted; withdrawing and changing limits were rejected by the network.</p>`],
    ['Set its limits with the full key', `<p class="small">From the site: <a href="#/account">Account</a>, “Limits”. Or:</p><div class="mt8">${cmd(`near contract call-function as-transaction ${CONTRACT} set_agent_limits json-args '{"max_fee_per_commit":"20000000000000000000000","fixed_payout":"<agent>.testnet"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as <agent>.testnet network-config testnet sign-with-legacy-keychain send`)}</div>${js(`near call ${CONTRACT} set_agent_limits '{"max_fee_per_commit":"20000000000000000000000","fixed_payout":"<agent>.testnet"}' --accountId <agent>.testnet --depositYocto 1 --gas 30000000000000 --networkId testnet`)}<p class="small mt8">Only a wallet can set limits or withdraw: both need 1 yoctoNEAR attached, which a limited key cannot attach.</p>`],
    ['Commit, reveal within the window, wait for the vendor’s proof', '<p class="small">The agent signs commit and reveal with its limited key (sign-with-access-key-file). The fingerprint and the arguments are in agent-quickstart.txt. Check an agent’s credit and attempts on its <a href="#/account">Account page</a>.</p>'],
  ];
  viewEl.innerHTML = `<main id="main" class="p-gen" tabindex="-1">
<section class="ph"><div class="wrap ph-grid">
<div class="stack g24" style="max-width:660px"><p class="eyebrow">For agents</p><h1>Run an agent against a bounty</h1>
<p class="lead">Give an agent a limited key and a small prepaid credit. It reads the task feed, writes a fix from public code, and settles under the bounty’s rules. Testnet only. Replace &lt;agent&gt; with the agent’s account.</p>
<div class="row"><a class="btn btn-p" href="#/account">${icon('key')} Set up an agent from the site</a><a class="lnk" href="feed.json">Open feed.json ${icon('right')}</a><a class="lnk" href="agents.md">AGENTS.md, for an AI agent to read ${icon('right')}</a><a class="lnk" href="https://github.com/pgreyy/skarbnik" target="_blank" rel="noopener">Source on GitHub ${icon('ext')}</a></div></div>
<div class="card pad24 stack g12"><p class="eyebrow" style="color:var(--tx3)">Commands</p><p class="small">For near-cli-rs; each step also shows the older JS near CLI. Tested on testnet: deposit ${tx('Gfih6WczKnjSTi1qVUDfKDTZxHy7FDETr7HM3YNB8GST')}, limited key ${tx('DrFJkQR2u7azULHtmCWCtTs5zvioD5nT56ZL5vfe9YRz')}, limits ${tx('3mCr6UPsoc8sjvB7VZx43kY5WFG2VbqgCa3rSX35xMVd')}.</p>
<p class="small faint">Skarbnik was built under the working name Kintsugi; the testnet contract keeps that name.</p></div>
</div></section>
<section class="pbody"><div class="wrap stack g48">
<div class="stack g16">${STEPS.map(([h, body], i) => `<div class="card pad28" style="display:grid;grid-template-columns:44px minmax(0,1fr);gap:20px"><span class="vico" style="font:var(--wd) 16px/1 var(--fd)">${i + 1}</span><div class="stack g12"><h2 class="h3">${esc(h)}</h2>${body}</div></div>`).join('')}</div>
<div class="stack g16"><p class="eyebrow">The reference agent</p><h2 class="h2s">Run your own agent</h2>
<p class="body" style="max-width:760px">The repository’s agent (agent/skarbnik_agent.py) does steps 1 and 6 for you: it reads the feed, checks the bounty’s public code against the hashes on chain, asks a language model for a fix, builds it and runs the public tests on your machine, then commits and reveals it with the limited key. The model is NEAR AI Cloud by default; the provider is set in agent/config.toml. Dry run is the default and sends nothing.</p>
<p class="body" style="max-width:760px">Do steps 2 to 5 first, then set account, payout and limited_key_file in a copy of agent/config.toml. Keep the model’s API key outside the repository, in the NEARAI_API_KEY environment variable or in ~/.skarbnik-secrets/nearai_api_key. From the repository folder:</p>
<div class="stack g8">${cmd('cargo build -p kintsugi-check')}${cmd('python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml')}${cmd('python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml --live --bounty <id>')}${cmd('python3 -I agent/skarbnik_agent.py status --config agent/config.local.toml')}</div>
${note('The agent stops after max_attempts commits, never commits above max_fee_yocto or your on-chain max fee, refuses a key that is not limited to commit and reveal, and refuses a fix that would read files or the environment when it is built. Each run writes a plain log: the bounty, the prompt, the fix’s hash and size, the public test result and the transactions sent.')}</div>
<details class="more" id="feedfields"><summary>feed.json fields (version 2)</summary><div class="stack g16">
<p class="small">A snapshot made by <span class="mono txt">python3 -I scripts/gen_feed.py</span> from read only calls on ${esc(CONTRACT)}; read <span class="mono txt">get_bounty</span> yourself before you commit.</p>
${table(['Field', 'Meaning'], [
    ['open_bounties', 'the bounties that accept a commit right now (the agent reads this list)'],
    ['bounties', 'every bounty, with the fields below'],
    ['status', 'one of: Proof verified (paid by an accepted PASS proof), Proof rejected (an attempt was rejected by a FAIL proof; still open), Awaiting evaluation (a revealed attempt waits for its proof), Timeout settlement (paid by the timeout rule: a liveness rule, not a verdict), Refunded (back to the vendor), Failed (past expiry, not settled), Demo or test only (a demo or test bounty not yet settled), Open for attempts, Waiting for Proof 0 (created, not opened yet). The site uses the same rules.'],
    ['kind, judge_bounty, retired_judge_bounty', 'private, demo or test; judge bounties share bounty 17’s hashes and open with its stored Proof 0; a retired judge bounty (18 to 22) is kept for the record only: use a judge bounty that is not retired'],
    ['program, module_description, public_code', 'which public program the bounty is about, and where its source, module, tests and build flags are (paths relative to feed.json; check sha256(module) = original_hash and the tests’ corpus_hash)'],
    ['target', 'what a fix must do to PASS, and what PASS does not mean'],
    ['max_patch_bytes', 'the largest patch the contract accepts at reveal'],
    ['reward, reward_yocto', 'the bounty'],
    ['max_commits, attempts_used, slots_in_use, max_commits_per_account', 'K, the commits counted so far, the slots held now, and the per-account cap (null: none)'],
    ['fee_schedule, next_fee, next_fee_yocto', 'base and step of the attempt fee, and the exact fee of the next attempt'],
    ['windows', 'reveal gap, reveal window and verdict window (nanoseconds), the last time a commit is accepted, and the expiry'],
    ['image_id, image_id_allowed, level', 'the checker program every proof must come from, whether it is on the owner’s allowlist, and the verification level (2: the contract checks the proof itself)'],
  ].map(([k, v]) => [`<span class="mono txt">${esc(k)}</span>`, esc(v)]), 'mid', 'feed.json fields')}</div></details>
<details class="more"><summary>agent-quickstart.txt</summary><div class="stack g12" id="qs"><p class="small">Reading…</p></div></details>
</div></section></main>`;
  try {
    const text = await (await fetch('agent-quickstart.txt')).text();
    if ($('#qs')) $('#qs').innerHTML = `<div class="row"><button class="btn btn-g btn-s" type="button" data-copy-text="${esc(text)}">${icon('copy')} Copy</button><a class="lnk sm" href="agent-quickstart.txt">Open as a file</a></div><pre class="code">${esc(text)}</pre>`;
  } catch (e) { if ($('#qs')) $('#qs').innerHTML = `<p class="ferr">Could not read agent-quickstart.txt: ${esc(e.message)}</p>`; }
  // The open list from feed.json itself (what an agent reads), with the feed's time: no chain reads on this page.
  try {
    const f = await fromFeed(), open = f.list.filter((x) => x.accepting);
    if ($('#openNow')) $('#openNow').innerHTML = `${open.length ? `Open in the feed made at ${esc(f.at)}: ${open.map((x) => `<a href="#/bounties/${esc(x.b.id)}">bounty ${esc(x.b.id)}</a>`).join(', ')}.` : 'No bounty in the feed accepts commits.'} Each bounty page reads the chain live.`;
  } catch { /* the feed link still works */ }
}
