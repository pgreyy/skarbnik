// Judge guide: three tabs. Level A, an evidence tour in the browser (do, expect, verify, with the real transactions);
// Level B, local reproduction (each command with what to expect and what it costs); and Claims and evidence, every
// claim with one label (Implemented, Demonstrated, Experimental, Planned, or Not claimed), filterable. Transaction ids
// come from data/recorded.json, measured numbers from data/numbers.json, the bounty statuses from the chain.
import { CONTRACT, EXPLORER_ACCOUNT, PUBLISHED_IMAGE_ID } from '../chain.js';
import { $, esc, icon, tx, note, cmd, tabbed, seg, bindSeg } from '../ui.js';
import { getRecorded, getNumbers, lastTx, firstTx } from '../data.js';

export async function judge(viewEl, tab) {
  const [rec, nums] = await Promise.all([getRecorded(), getNumbers()]);
  const t = (id, m, last = true) => (last ? lastTx(rec, id, m) : firstTx(rec, id, m));
  const b1 = rec.bounties['1'] || [], b1pass = (b1.find((x) => x.method === 'submit_groth16' && /PASS|paid/i.test(x.what)) || {}).tx || rec.valid_proof_accepted.tx;
  const b1fail = (b1.filter((x) => x.method === 'submit_groth16' && x.result === 'succeeded').find((x) => x.tx !== b1pass) || {}).tx;
  const agent16 = (rec.bounties['16'] || []).find((x) => x.method === 'commit');
  const STEPS = [
    ['1', '1 min', 'Find the contract', `Open the contract on the explorer.<div class="links"><a class="tx" href="${EXPLORER_ACCOUNT}${CONTRACT}" target="_blank" rel="noopener">${esc(CONTRACT)} ${icon('ext')}</a></div>`,
      'A testnet account with a deployed contract and a code hash.', 'The code hash matches the one on the Evidence page, Contract tab, which reads it live.'],
    ['2', '2 min', 'See a proof pay', `Open the payment on bounty 1, then the failed attempt.<div class="links">${tx(b1pass, 'Proof PASS')}${b1fail ? tx(b1fail, 'Proof FAIL') : ''}</div>`,
      'A <span class="mono">submit_groth16</span> call of about 36 Tgas that moves 0.11 NEAR, the reward plus the winner’s own fee. The FAIL call uses about 35.6 Tgas and pays nothing.', 'The two calls are different attempts on the same bounty, and only the PASS paid.'],
    ['3', '2 min', 'Follow the agent', `Open bounty 16’s three calls in order.<div class="links">${tx(t('16', 'commit', false), 'Commit')}${tx(t('16', 'reveal', false), 'Reveal')}${tx(t('16', 'submit_groth16'), 'Proof')}</div>`,
      'A commit that holds only a fingerprint, a reveal that publishes the patch, then a proof call that pays 0.1 NEAR.', `The agent account signed the commit and reveal with a key limited to those two methods${agent16 ? '' : ''}. Its Account page lists the key and the calls.`],
    ['4', '2 min', 'See a timeout, called by its name', `Open bounty 17 here, then its claim on the explorer.<div class="links"><a class="tx" href="#/bounties/17">Bounty 17 on Skarbnik</a>${tx(t('17', 'claim_timeout'), 'Claim')}</div>`,
      'A <span class="mono">claim_timeout</span> call, a Timeout settlement chip, and no <span class="mono">submit_groth16</span> call for that attempt.', 'Bounty 17 does not appear under the Proof verified filter in the evidence ledger.'],
    ['5', '2 min', 'Compare the checker id', 'Read the allowlist with any NEAR view call to <span class="mono">get_allowed_image_ids</span> on the contract.',
      `Exactly one id: <span class="mono" style="overflow-wrap:anywhere">${esc(PUBLISHED_IMAGE_ID)}</span>`, 'It equals the id on the Evidence page, Checker tab, which Level B rebuilds from source.'],
    ['6', '1 min', 'Read what is not claimed', 'Open the Limits tab on the Evidence page.<div class="links"><a class="tx" href="#/evidence/limits">Evidence, Limits</a></div>',
      'Limits in plain words, among them: no external audit, a full access key still on the contract account, and testnet only.', 'The access key can be checked with a NEAR <span class="mono">view_access_key_list</span> call on the contract account.'],
  ];
  const steps = STEPS.map(([n, mins, title, d, e, v]) => `<div class="card step"><div class="sn"><b>${n}</b><span>${mins}</span></div><div><h3 class="h3" style="margin-bottom:18px">${title}</h3><div class="dev">
    <div class="do"><h4>${icon('right')} Do</h4><p>${d}</p></div><div><h4>${icon('eye')} Expect</h4><p>${e}</p></div><div><h4>${icon('check')} Verify</h4><p>${v}</p></div></div></div></div>`).join('');
  const check = rec.last_image_check && rec.last_image_check.result === 'MATCH';
  const CMDS = [
    ...(check ? [['B1', 'Rebuild the checker and compare ids', './scripts/check_image_id.sh', `MATCH on the last line, with the published id <span class="mono">${esc(PUBLISHED_IMAGE_ID.slice(0, 8))}…${esc(PUBLISHED_IMAGE_ID.slice(-4))}</span>.`, `${esc(nums.image_rebuild.cached)} with Docker images cached. ${esc(nums.image_rebuild.fresh)} with the ${esc(nums.image_rebuild.download)} image download. Needs Docker.`]] : []),
    ['B2', 'Run the contract unit tests', 'cargo test -p kintsugi-contract --offline', `${esc(nums.contract_unit_tests.value)} passed.`, `A Rust toolchain. ${esc(nums.contract_unit_tests.detail)}`],
    ['B3', 'Replay the stored receipts', 'cargo test -p kintsugi-contract s1_', '5 passed. Real attempt proofs from testnet are checked by the contract code.', 'Fast. No network.'],
    ['B4', 'Run the agent without a model key', './scripts/agent_dry_run_test.sh', `${esc(nums.agent_dry_run.value)} checks pass (last run on ${esc(nums.agent_dry_run.date)}).`, 'Sends nothing to the network.'],
    ['B5', 'Dry run of the reference agent', 'python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml', 'The agent reads the feed, writes a patch, runs the public tests and stops before sending. Adding <span class="mono">--live</span> would spend a real testnet attempt fee.', 'Needs a NEAR AI Cloud key and a local config. Never paste the key anywhere.'],
  ];
  const cmds = CMDS.map(([n, title, c, e, cost]) => `<div class="card cmd"><div class="sn"><b>${n}</b></div><div><h3 class="h3">${title}</h3><div style="margin-top:14px">${cmd(c)}</div>
    <div class="cmd-m"><div><b>Expect</b><p>${e}</p></div><div><b>Cost</b><p>${cost}</p></div></div></div></div>`).join('');
  const CLAIMS = [
    ['The contract checks a Groth16 proof itself and pays on PASS', 'demo', tx(b1pass, 'Proof PASS'), 'Open the call. About 36 Tgas.'],
    [`${(rec.attacks_s6c || []).length} proof attacks are refused on chain`, 'demo', '<a class="tx" href="#/evidence/contract">Evidence, Contract tab</a>', 'Each refusal is a recorded failed call.'],
    [`${nums.contract_unit_tests.value} contract unit tests pass`, 'impl', `<span class="small">${esc(nums.contract_unit_tests.source)}</span>`, 'Level B, B2.'],
    ['A silent vendor does not block payment', 'demo', `${tx(t('4', 'claim_timeout'), 'Claim 4')}${tx(t('13', 'claim_timeout'), 'Claim 13')}`, 'claim_timeout calls, shown as Timeout settlement.'],
    ['An agent with a limited key fixes a bug and is paid by proof', 'demo', tx(t('16', 'submit_groth16'), 'Proof'), 'The demo bug is named in the module’s comments, so this shows the path, not skill.'],
    ['An agent fixed a new bug it could not see', 'demo', tx(t('17', 'claim_timeout'), 'Claim'), 'Paid by timeout, not by a proof.'],
    ['An agent key cannot withdraw or change limits', 'demo', '<span class="small">docs/EVIDENCE.md, limited agent key</span>', 'The network rejected both before they reached the chain.'],
    ...(check ? [['The checker rebuilds to the id on chain', 'demo', `<span class="small">Image id MATCH, ${esc(rec.last_image_check.utc)}</span>`, 'Level B, B1. One machine so far.']] : []),
    ['The secret input stays off chain and out of the repository', 'demo', '<a class="tx" href="#/bounties/12">Bounty 12</a><a class="tx" href="#/bounties/17">Bounty 17</a>', 'Bounty 12 uses the public demo bug.'],
    ['Vendor proofs on a rented GPU', 'exp', '<span class="small">Bounty 24, attempt 0: 29.82 s prove, 21.71 s shrink</span>', 'One run on one machine, under the published image id. docs/numbers.md.'],
    ['Level 1 verification through OutLayer', 'exp', '<span class="small">Built, never answered on testnet</span>', 'Not used by any current bounty.'],
    ['A per-account cap on attempt slots', 'impl', '<span class="small">docs/evidence/account_cap/</span>', 'Written and tested, not deployed on the testnet contract.'],
    ['A vendor with a crash but no fix', 'plan', '<span class="small">Not built</span>', 'Proof 0 needs a reference fix today.'],
    ['Pull payments for missing payout accounts', 'plan', '<span class="small">Bounty 8 shows the gap</span>', 'Not built.'],
    ['A mainnet contract', 'plan', '<span class="small">None exists</span>', 'Testnet only.'],
    ['An external security audit', 'none', '<span class="small">None</span>', 'Reviews so far are AI review passes.'],
  ];
  const CL = { impl: ['l-impl', 'Implemented'], demo: ['l-demo', 'Demonstrated'], exp: ['l-exp', 'Experimental'], plan: ['l-plan', 'Planned'], none: ['k-fail', 'Not claimed'] };
  const crows = (f) => CLAIMS.filter((c) => f === 'all' || c[1] === f).map(([claim, k, ev, how]) => `<div class="lrow" role="listitem"><b style="color:var(--tx);font-weight:600">${esc(claim)}</b><div><span class="chip ${CL[k][0]}"${k === 'none' ? ' style="color:var(--tx2);border-color:var(--ln2)"' : ''}>${CL[k][1]}</span></div><div class="txs" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${ev}</div><p class="small">${how}</p></div>`).join('');
  const count = (k) => CLAIMS.filter((c) => c[1] === k).length;
  viewEl.innerHTML = `<main id="main" class="p-judge" tabindex="-1">
<section class="ph"><div class="wrap"><div class="ph-grid">
<div style="display:flex;flex-direction:column;gap:24px;max-width:660px">
<p class="eyebrow">Judge guide</p>
<h1>Check it in ten minutes</h1>
<p class="lead">Do something, expect a result, verify it yourself. Level A needs only a browser. Level B is optional and rebuilds things locally.</p>
</div>
<div style="display:flex;flex-direction:column;gap:14px">
<div class="card lv"><span class="vico">${icon('eye')}</span><div><b class="h4">Level A, evidence tour</b><p class="small" style="margin-top:4px">5 to 10 minutes. A browser and the explorer. No install.</p></div></div>
<div class="card lv"><span class="vico">${icon('term')}</span><div><b class="h4">Level B, local reproduction</b><p class="small" style="margin-top:4px">Optional. Docker and Rust, from a clone of the repository.</p></div></div>
</div></div></div></section>
<section style="padding:0 0 112px"><div class="wrap" id="jtabs"></div></section></main>`;
  tabbed($('#jtabs'), [
    { id: 'a', label: 'Level A: evidence tour', html: `<div style="display:flex;flex-direction:column;gap:28px"><div style="max-width:700px"><h2 class="h2s">Level A: an evidence tour</h2><p class="body" style="margin-top:12px">Six steps, each with the same three parts. The real transactions are linked, so every expected result can be checked against the chain and not against this page.</p></div><div>${steps}</div>${note('Testnet only. Test and demo bounties use a public input. On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.')}</div>` },
    { id: 'b', label: 'Level B: reproduce', html: `<div style="display:flex;flex-direction:column;gap:28px"><div style="max-width:700px"><h2 class="h2s">Level B: reproduce locally</h2><p class="body" style="margin-top:12px">Optional. Each command states what to expect and what it costs. None of them needs a key, except the agent dry run.</p></div><div>${cmds}</div>${note('Do not start a full vendor proof as part of a review. One takes about 1.5 to 2.5 hours on a laptop CPU and about 7 GiB of memory for the Groth16 step.', 'alert')}</div>` },
    { id: 'claims', label: 'Claims and evidence', html: `<div style="display:flex;flex-direction:column;gap:28px"><div style="display:flex;flex-wrap:wrap;gap:20px;justify-content:space-between;align-items:end"><div style="max-width:660px"><h2 class="h2s">Claims and their evidence</h2><p class="body" style="margin-top:12px">Every claim carries one label. A claim with no evidence is shown as Planned or Experimental, never as done.</p></div>
      ${seg([['all', 'All', CLAIMS.length], ['impl', 'Implemented', count('impl')], ['demo', 'Demonstrated', count('demo')], ['exp', 'Experimental', count('exp')], ['plan', 'Planned', count('plan')]].map(([id, l, c]) => ({ id, label: `${l} <span style="color:var(--tx3)">${c}</span>` })), 'all', 'Filter claims', 'data-cf')}</div>
      <div class="legend4"><div class="card"><span class="chip l-impl">Implemented</span><p class="small">In the code and covered by tests.</p></div><div class="card"><span class="chip l-demo">Demonstrated</span><p class="small">Done on testnet, with transactions.</p></div><div class="card"><span class="chip l-exp">Experimental</span><p class="small">Tried once, or on a different setup.</p></div><div class="card"><span class="chip l-plan">Planned</span><p class="small">Not built.</p></div></div>
      <div class="blist" role="list" aria-label="Claims" id="crows"><div class="lhead" aria-hidden="true"><span>Claim</span><span>Label</span><span>Evidence</span><span>How to check</span></div>${crows('all')}</div></div>` },
  ], tab, '#/judge', 'Judge guide sections');
  bindSeg($('#jtabs'), 'data-cf', (f) => { $('#crows').innerHTML = `<div class="lhead" aria-hidden="true"><span>Claim</span><span>Label</span><span>Evidence</span><span>How to check</span></div>${crows(f)}`; });
}
