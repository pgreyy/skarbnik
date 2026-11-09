// Tests the live feed function (web/api/feed.js) with no network: it replaces fetch with fakes and calls the handler.
// Cases: every RPC call fails with a network error; every RPC answers HTTP 429; every RPC times out (each falls back
// to the saved web/feed.json, marked source "saved" with the reason); a faked chain where bounty 40 has 3 attempts
// used, bounty 41 has all 8 used and failed, a bounty newer than the saved feed (NEW, one past its newest) of a
// known program has none, and a second new bounty (RULE, two past its newest) on the rule checker of a published
// program no saved bounty uses yet (assets: its kind of bug, checker, target and public code with the rule module)
// (counts, statuses, the rows left as saved, the number of view calls); and a second request within 60 s (answered
// from the cache, no calls). With --real it also reads the real testnet once and prints bounties 39, 40 and 41.
// Usage, from the repo root: node scripts/test_live_feed.mjs [--real]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const handler = require('../web/api/feed.js');
const SAVED = JSON.parse(readFileSync(new URL('../web/feed.json', import.meta.url)));
const SNAP = JSON.parse(readFileSync(new URL('../web/data/bounty_snapshots.json', import.meta.url))).bounties;
const realFetch = globalThis.fetch;

async function call() {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({}, res);
  return { cache: res.headers['Cache-Control'], feed: JSON.parse(res.body) };
}
const pick = (f, id) => { const b = f.bounties.find((x) => x.bounty_id === id); return b ? `${b.status}, ${b.attempts}, accepts ${b.accepts_commits}` : '(none)'; };
let ok = true;
const check = (cond, what) => { console.log(`    ${cond ? 'ok  ' : 'FAIL'} ${what}`); ok = ok && cond; };

async function fallbackCase(name, fake, want) {
  handler._reset(); let calls = 0;
  globalThis.fetch = async (...a) => { calls++; return fake(...a); };
  // Node's abort timers do not keep a script alive by themselves (a real request does): hold it open meanwhile
  const keep = setInterval(() => {}, 1000);
  const t0 = Date.now(); const { cache, feed } = await call(); clearInterval(keep);
  console.log(`===== ${name}: ${calls} RPC calls, ${Date.now() - t0} ms`);
  console.log(`    source: ${feed.source}; updated_at_utc: ${feed.updated_at_utc}; Cache-Control: ${cache}`);
  console.log(`    live_note: ${feed.live_note}`);
  console.log(`    bounty 40: ${pick(feed, 40)}; bounty 41: ${pick(feed, 41)}`);
  check(feed.source === 'saved' && new RegExp(want).test(feed.live_note), `falls back to the saved feed, reason "${want}"`);
  check(JSON.stringify(feed.bounties) === JSON.stringify(SAVED.bounties), 'the rows are the saved rows, unchanged');
  check(/s-maxage=15/.test(cache), 'the saved answer is cached 15 s only');
}

await fallbackCase('every RPC call fails (network error)', async () => { throw new TypeError('fetch failed'); }, 'network error from every RPC');
await fallbackCase('every RPC answers HTTP 429', async () => new Response('{"error":"Too Many Requests"}', { status: 429 }), 'HTTP 429 from every RPC');
await fallbackCase('every RPC times out', (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(o.signal.reason))), 'timeout');

// a faked chain: raw get_bounty answers in the contract's shape, made from the saved snapshot of bounty 35
const base = SNAP['35'].bounty, sub = SNAP['35'].submissions[0];
const real = (id) => SAVED.bounties.find((x) => x.bounty_id === id);
const far = String(BigInt(Date.now() + 40 * 86400000) * 1000000n);
const NEW = Math.max(...SAVED.bounties.map((x) => x.bounty_id)) + 1; // one bounty newer than the saved feed
const RULE = NEW + 1; // a rule checker bounty of a published program (assets) that no saved bounty uses
const ASSETS = SAVED.public_programs.find((x) => x.program === 'assets');
const fakeB = {
  40: { ...base, id: '40', level: 1, max_commits: 8, commits: 3, active: 3, max_commits_per_account: 2, expires_at_ns: far, exploit_commitment: 'aa'.repeat(32), original_hash: real(40).original_hash, corpus_hash: real(40).corpus_hash, state: 'Open', opened: true, winner: null },
  41: { ...base, id: '41', level: 2, max_commits: 8, commits: 8, active: 8, max_commits_per_account: 2, expires_at_ns: far, exploit_commitment: 'bb'.repeat(32), original_hash: real(41).original_hash, corpus_hash: real(41).corpus_hash, state: 'Open', opened: true, winner: null },
  [NEW]: { ...base, id: String(NEW), level: 2, max_commits: 8, commits: 0, active: 0, max_commits_per_account: 2, expires_at_ns: far, exploit_commitment: 'cc'.repeat(32), original_hash: real(41).original_hash, corpus_hash: real(41).corpus_hash, state: 'Open', opened: true, winner: null },
  [RULE]: { ...base, id: String(RULE), level: 2, max_commits: 8, commits: 0, active: 0, max_commits_per_account: 2, expires_at_ns: far, exploit_commitment: 'dd'.repeat(32), original_hash: ASSETS.original_hash, corpus_hash: ASSETS.corpus_hash, image_id: SAVED.checkers.rule, state: 'Open', opened: true, winner: null },
};
const fakeS = { 40: ['Failed', 'Open', 'Open'], 41: Array(8).fill('Failed') };
function chain(stats) {
  return async (url, o) => {
    stats.calls++;
    const p = JSON.parse(o.body).params, args = JSON.parse(Buffer.from(p.args_base64, 'base64').toString());
    let v;
    if (p.method_name === 'get_next_bounty_id') v = RULE + 1;
    else if (p.method_name === 'get_bounty') v = fakeB[args.bounty_id] || SNAP[args.bounty_id]?.bounty || { ...base, id: args.bounty_id };
    else if (p.method_name === 'get_submission') v = fakeS[args.bounty_id] ? { ...sub, outcome: fakeS[args.bounty_id][args.index], revealed_at_ns: null } : (SNAP[args.bounty_id]?.submissions[args.index] || { ...sub, outcome: 'Released', revealed_at_ns: null });
    else throw new Error(p.method_name);
    return new Response(JSON.stringify({ result: { result: [...Buffer.from(JSON.stringify(v))] } }), { status: 200 });
  };
}
handler._reset();
const stats = { calls: 0 }; globalThis.fetch = chain(stats);
let { cache, feed } = await call();
console.log(`===== a faked chain: ${stats.calls} RPC calls (saved feed: ${SAVED.bounties.length} bounties, ${SAVED.open_bounties.length} open)`);
console.log(`    source: ${feed.source}; updated_at_utc: ${feed.updated_at_utc}; Cache-Control: ${cache}`);
console.log(`    live_note: ${feed.live_note}`);
for (const id of [39, 40, 41, NEW, RULE]) console.log(`    bounty ${id}: ${pick(feed, id)}`);
check(feed.source === 'live' && /s-maxage=60/.test(cache), 'a live answer, cached 60 s');
check(pick(feed, 40) === 'Open for attempts, 3 of 8 used, accepts true', 'bounty 40: 3 attempts used, one failed, still Open for attempts');
check(pick(feed, 41) === 'Proof rejected, 8 of 8 used, accepts false', 'bounty 41: every slot used and failed, Level 2: Proof rejected');
check(pick(feed, NEW) === 'Open for attempts, 0 of 8 used, accepts true' && feed.bounties.find((x) => x.bounty_id === NEW).public_code?.program === 'grid', `bounty ${NEW} (newer than the saved feed): listed, with the public code of its known program`);
check(JSON.stringify(feed.bounties.find((x) => x.bounty_id === 39)) === JSON.stringify(real(39)), 'bounty 39 (not open in the saved feed): the saved row, not read');
{ const n = feed.bounties.find((x) => x.bounty_id === NEW); check(n.bug_kind === 'crash' && n.checker === 'crash' && n.target === SAVED.targets.crash, `bounty ${NEW}: kind of bug crash, the crash checker and its target`); }
{ const r = feed.bounties.find((x) => x.bounty_id === RULE), pc = r && r.public_code;
  check(!!r && r.bug_kind === 'path traversal' && r.checker === 'rule' && r.target === SAVED.targets['path traversal'], `bounty ${RULE}: kind of bug path traversal, the rule checker and its target`);
  check(!!pc && pc.program === 'assets' && pc.checker === 'rule' && pc.rule && pc.rule.module === 'code/assets/rule.wasm' && !('original_hash' in pc), `bounty ${RULE}: the public code of assets from public_programs, with its rule module`); }
check(feed.open_bounties.map((x) => x.bounty_id).join(',') === SAVED.open_bounties.map((x) => x.bounty_id).filter((x) => x !== 41).concat(NEW, RULE).join(','), `open_bounties: the saved open ones less 41, plus ${NEW} and ${RULE}`);
check(feed.open_bounties.find((x) => x.bounty_id === 40).slots_left === 5, 'bounty 40 open row: 5 slots left');
check(stats.calls < SAVED.bounties.length, `view calls: ${stats.calls}, fewer than one per saved bounty (${SAVED.bounties.length}): only the open and newer bounties are read`);
const before = stats.calls; ({ feed } = await call());
check(stats.calls === before && feed.source === 'live', 'a second request within 60 s: from the cache, no RPC calls');

if (process.argv.includes('--real')) {
  handler._reset(); let n = 0; globalThis.fetch = async (...a) => { n++; return realFetch(...a); };
  const t0 = Date.now(); ({ cache, feed } = await call());
  console.log(`===== the real testnet: ${n} RPC calls, ${Date.now() - t0} ms`);
  console.log(`    source: ${feed.source}; updated_at_utc: ${feed.updated_at_utc}; Cache-Control: ${cache}`);
  console.log(`    live_note: ${feed.live_note}`);
  for (const id of [39, 40, 41]) console.log(`    bounty ${id}: ${pick(feed, id)}`);
}
globalThis.fetch = realFetch;
console.log(ok ? 'ALL PASS' : 'FAILED');
process.exit(ok ? 0 : 1);
