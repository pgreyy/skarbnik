// Writes web/ledger.json, the machine-readable Proof Ledger: every account the testnet contract has paid, each paid fix
// with how it was paid (proof or timeout) and its transaction, each vendor's on-time record and the number of distinct
// counterparties. It reads every bounty and attempt from the chain with read only view calls (no key, nothing sent) and
// uses the same rules as the site's Ledger page (web/js/ledger-core.js). Transaction ids come from
// web/data/recorded.json, who runs each account from web/data/accounts.json. A snapshot: it says when it was made.
// Usage, from the repo root: node scripts/gen_ledger.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { buildLedger } from '../web/js/ledger-core.js';

const cfg = JSON.parse(readFileSync('web/site.config.json', 'utf8'));
const recorded = JSON.parse(readFileSync('web/data/recorded.json', 'utf8'));
const accounts = JSON.parse(readFileSync('web/data/accounts.json', 'utf8'));

async function view(method, args) {
  for (let i = 0; i < 4; i++) {
    for (const rpc of cfg.rpc_urls) {
      try {
        const r = await (await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'l',
          method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: cfg.contract, method_name: method,
            args_base64: Buffer.from(JSON.stringify(args)).toString('base64') } }) })).json();
        if (r.result && r.result.result) return JSON.parse(Buffer.from(r.result.result).toString());
      } catch { /* try the next RPC */ }
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`view ${method} failed on every RPC`);
}

const n = Number(await view('get_next_bounty_id', {}));
const bounties = [], subs = {};
for (let i = 0; i < n; i++) {
  const b = await view('get_bounty', { bounty_id: String(i) });
  if (!b) continue;
  bounties.push(b);
  subs[String(i)] = [];
  for (let k = 0; k < b.commits; k++) subs[String(i)].push(await view('get_submission', { bounty_id: String(i), index: k }));
}
const L = buildLedger(bounties, subs, recorded, accounts);
const out = {
  made_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), network: cfg.network, contract: cfg.contract,
  note: 'Every account in this ledger is run by the Skarbnik team or was seeded by its scripts (accounts.kinds). No scores, no ranks, no credit for unpaid attempts. Amounts in yoctoNEAR; a paid fix also got its own attempt fee back.',
  rules: { proof: 'a final verdict paid the fix (a Groth16 PASS checked by the contract, or two verifier attestations at Level 0)', timeout: 'no final verdict before the deadline; claim_timeout paid it (shared equally among the attempts waiting)', vendor_on_time: 'proved_on_time counts attempts decided by a proof before their deadline; not_proved_in_time counts attempts the timeout rule paid; waiting_past_deadline counts revealed attempts past their deadline and not yet claimed' },
  accounts: { kinds: accounts.kinds, source: accounts.source },
  ...L,
};
writeFileSync('web/ledger.json', JSON.stringify(out, null, 1) + '\n');
console.error(`wrote web/ledger.json: ${L.counts.paid_fixes} paid fixes (${L.counts.paid_by_proof} by proof, ${L.counts.paid_by_timeout} by timeout), ${L.counts.paid_accounts} paid accounts, ${L.counts.vendors} vendors, ${L.counts.distinct_counterparties} distinct counterparties, ${L.counts.outside_the_team} outside the team`);
