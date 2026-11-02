// The hosted agent connector's tools, for api/mcp/[token].js: the same agent work as tools/skarbnik-mcp, for AI apps
// that can only add a link (Claude custom connectors, ChatGPT developer mode). The link carries a key limited to
// commit and reveal (made on the Account page); every request decodes it, reads the key's permission from the chain
// and refuses (plain 404) unless it is a function call key for the contract limited to commit and reveal, so deleting
// the key on chain turns the link off at once. Nothing is stored: each attempt's nonce is derived from the key and the
// patch (HMAC), so a reveal only needs the same patch again. Patches are WebAssembly text (WAT) assembled here with
// wabt, or a base64 module; check_patch runs the bounty's public tests on it in a worker with a time limit. Signing:
// Ed25519 (node:crypto) over NEAR's transaction format (Borsh), as in tools/skarbnik-mcp/server.py. Testnet only.
// Nothing here logs: no console calls, and errors returned to the client never carry the link or the key.
'use strict';
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const SITE = require('../../site.config.json');

const VERSION = '1.0.0';
const BASE = 'https://skarbnik.xyz/';
const CONTRACT = SITE.contract;
const RPCS = SITE.rpc_urls;
const IMAGE_ID = SITE.published_image_id;
if (SITE.network !== 'testnet') throw new Error('the hosted connector runs on testnet only');

class Fail extends Error {}

// ---------- the link's token: "sk1_" + base64url(account length, account, 32 byte seed) ----------
function decodeToken(token) {
  if (typeof token !== 'string' || !/^sk1_[A-Za-z0-9_-]{50,200}$/.test(token)) return null;
  const b = Buffer.from(token.slice(4), 'base64url');
  const n = b[0];
  if (!n || b.length !== 1 + n + 32) return null;
  const account = b.subarray(1, 1 + n).toString('utf8');
  if (!/^[a-z0-9._-]{2,64}$/.test(account) || !/\.testnet$|^[0-9a-f]{64}$/.test(account)) return null;
  const seed = Buffer.from(b.subarray(1 + n));
  const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const pub = Buffer.from(crypto.createPublicKey(priv).export({ format: 'jwk' }).x, 'base64url');
  return { account, seed, priv, pub, pubText: `ed25519:${b58encode(pub)}` };
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes) {
  let n = 0n;
  for (const x of bytes) n = (n << 8n) + BigInt(x);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const x of bytes) { if (x === 0) out = '1' + out; else break; }
  return out;
}
function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Fail('bad base58'); n = n * 58n + BigInt(i); }
  const hex = n ? n.toString(16) : '';
  const body = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  return Buffer.concat([Buffer.alloc(s.length - s.replace(/^1+/, '').length), body]);
}

// ---------- chain ----------
async function rpc(method, params, timeoutMs = 20000) {
  let last;
  for (const url of RPCS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'h', method, params }), signal: AbortSignal.timeout(timeoutMs) });
        const j = await r.json();
        if (j.result !== undefined || j.error) return j;
      } catch (e) { last = e; }
    }
  }
  throw new Fail(`no RPC answered (${last ? last.name : 'no answer'})`);
}
async function view(method, args) {
  const j = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  if (!j.result || !j.result.result) throw new Fail(`view ${method} failed`);
  return JSON.parse(Buffer.from(j.result.result).toString());
}
// The key's permission on chain: true only for a function call key on the contract limited to commit and reveal.
async function keyAllowed(k) {
  const j = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: k.account, public_key: k.pubText });
  const perm = j.result && j.result.permission;
  const fc = perm && perm.FunctionCall;
  if (!fc || fc.receiver_id !== CONTRACT) return null;
  const names = fc.method_names || [];
  if (!names.length || !names.every((m) => m === 'commit' || m === 'reveal')) return null;
  return { nonce: j.result.nonce };
}

function bstr(s) { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function u128(n) { const b = Buffer.alloc(16); let v = BigInt(n); for (let i = 0; i < 16; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; }
function functionCallTx(signer, pub, nonce, receiver, blockHash, method, argsJson, gas, deposit = 0) {
  const l = Buffer.alloc(4); l.writeUInt32LE(argsJson.length);
  const action = Buffer.concat([Buffer.from([2]), bstr(method), l, argsJson, u64(gas), u128(deposit)]);
  const one = Buffer.alloc(4); one.writeUInt32LE(1);
  return Buffer.concat([bstr(signer), Buffer.from([0]), pub, u64(nonce), bstr(receiver), blockHash, one, action]);
}
async function signAndSend(k, method, args) {
  const ak = await keyAllowed(k);
  if (!ak) throw new Fail('this link\'s key is no longer a key limited to commit and reveal');
  const blk = await rpc('block', { finality: 'final' });
  const tx = functionCallTx(k.account, k.pub, BigInt(ak.nonce) + 1n, CONTRACT, b58decode(blk.result.header.hash), method, Buffer.from(JSON.stringify(args)), 100n * 10n ** 12n);
  const sig = crypto.sign(null, crypto.createHash('sha256').update(tx).digest(), k.priv);
  const j = await rpc('send_tx', { signed_tx_base64: Buffer.concat([tx, Buffer.from([0]), sig]).toString('base64'), wait_until: 'FINAL' }, 60000);
  const res = j.result || {};
  const st = res.status || {};
  const out = { tx: (res.transaction || {}).hash || null, ok: !!j.result && !('Failure' in st) };
  for (const o of res.receipts_outcome || []) if ('Failure' in o.outcome.status) out.ok = false;
  if ('SuccessValue' in st) { const raw = Buffer.from(st.SuccessValue, 'base64').toString(); out.value = raw ? JSON.parse(raw) : null; }
  if (!out.ok) { const m = JSON.stringify(j).match(/Smart contract panicked: ([^"\\]+)/); out.error = m ? m[1] : 'the transaction failed'; }
  return out;
}

// ---------- site files ----------
async function site(path, binary = false) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Fail(`could not read ${path} (HTTP ${r.status})`);
  return binary ? new Uint8Array(await r.arrayBuffer()) : r.text();
}
const feed = async () => JSON.parse(await site('feed.json'));
// A bounty's public code: from its feed row, or (for a bounty newer than the feed) from any feed row of the same
// program, matched by original_hash on chain.
async function publicCode(bid, b) {
  const rows = (await feed()).bounties;
  const row = rows.find((x) => String(x.bounty_id) === bid && x.public_code) || rows.find((x) => x.public_code && x.original_hash === b.original_hash);
  if (!row) throw new Fail(`bounty ${bid} has no public code on the site`);
  return row;
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const nsUtc = (ns) => new Date(Number(BigInt(ns) / 1000000n)).toISOString().replace(/\.\d+Z$/, 'Z');

// ---------- patches: WAT or base64, the interface, the public tests ----------
let wabtP = null;
const wabt = () => (wabtP = wabtP || require('wabt')());
const MAX_WAT = 200000, MAX_PATCH = 16384; // characters of WebAssembly text; bytes of a module (the checker takes 2,048)
async function patchBytes(a) {
  if (a.wat && a.patch_base64) throw new Fail('give wat or patch_base64, not both');
  if (a.wat && String(a.wat).length > MAX_WAT) throw new Fail(`the WebAssembly text is longer than ${MAX_WAT.toLocaleString('en-US')} characters`);
  if (a.patch_base64 && String(a.patch_base64).length > Math.ceil(MAX_PATCH / 3) * 4) throw new Fail(`the module is larger than ${MAX_PATCH.toLocaleString('en-US')} bytes`);
  if (a.patch_base64) { const b = Buffer.from(String(a.patch_base64), 'base64'); if (!b.length) throw new Fail('patch_base64 is empty'); return new Uint8Array(b); }
  if (!a.wat) throw new Fail('give the fixed module as wat (WebAssembly text) or as patch_base64');
  const w = await wabt();
  let mod;
  try { mod = w.parseWat('patch.wat', String(a.wat)); mod.resolveNames(); mod.validate(); } catch (e) { throw new Fail(`the WAT does not assemble: ${String(e.message || e).slice(0, 600)}`); }
  let out;
  try { out = new Uint8Array(mod.toBinary({}).buffer); } finally { mod.destroy(); }
  if (out.length > MAX_PATCH) throw new Fail(`the module is larger than ${MAX_PATCH.toLocaleString('en-US')} bytes`);
  return out;
}
// The fix's exports against the public program's: the same names and kinds, the same number of parameters for each
// function, and no imports. Returns null when they match, else what differs.
function exportsOf(bytes) {
  const m = new WebAssembly.Module(bytes);
  const inst = WebAssembly.Module.imports(m).length ? null : new WebAssembly.Instance(m, {});
  return { imports: WebAssembly.Module.imports(m).length, list: WebAssembly.Module.exports(m).map((e) => `${e.name}:${e.kind}${e.kind === 'function' && inst ? `/${inst.exports[e.name].length}` : ''}`).sort() };
}
function iface(bytes, original) {
  let mine;
  try { mine = exportsOf(bytes); } catch (e) { return `not a valid WebAssembly module: ${String(e.message).slice(0, 200)}`; }
  if (mine.imports) return 'the module has imports; the public program has none';
  const want = exportsOf(original).list;
  if (mine.list.join() !== want.join()) return `the exports differ from the public program's: it exports ${want.join(', ')}; this exports ${mine.list.join(', ') || 'nothing'}`;
  return null;
}
function parseTests(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => { const [inp, want] = l.split(/\s+/); return { hex: inp === '-' ? '' : inp, want: Number(want) }; });
}
// The public demo input (published on purpose, data/demo/README.md): a bounty whose exploit commitment equals the
// public demo bounty's (bounty 7) uses it, so check_patch can also run it there.
const DEMO_INPUT_URL = 'https://raw.githubusercontent.com/pgreyy/skarbnik/main/data/demo/exploit.hex';
const DEMO_BOUNTY = '7';
const WORKER = `const { parentPort, workerData } = require('node:worker_threads');
const m = new WebAssembly.Module(workerData.bytes); const out = [];
for (const t of workerData.tests) {
  try { const i = new WebAssembly.Instance(m, {}); const inp = Buffer.from(t.hex, 'hex'); const p = i.exports.input_buf();
    new Uint8Array(i.exports.memory.buffer, p, inp.length).set(inp); out.push({ got: i.exports.parse(inp.length) }); }
  catch (e) { out.push({ trap: String(e.message || e).slice(0, 80) }); }
}
parentPort.postMessage(out);`;
function runTests(bytes, tests, ms = 4000) {
  return new Promise((resolve) => {
    const w = new Worker(WORKER, { eval: true, workerData: { bytes, tests }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    const t = setTimeout(() => { w.terminate(); resolve(null); }, ms);
    w.once('message', (m) => { clearTimeout(t); w.terminate(); resolve(m); });
    w.once('error', () => { clearTimeout(t); resolve(null); });
  });
}
async function checkPatch(bid, bytes, b) {
  const row = await publicCode(bid, b);
  const tests = parseTests(await site(row.public_code.tests));
  const original = await site(row.public_code.module, true);
  const bad = iface(bytes, original);
  // On a bounty that uses the public demo input, that input runs too (the last item): the fix must not crash on it.
  let demo = false;
  if (!bad) { const d = bid === DEMO_BOUNTY ? b : await bounty(DEMO_BOUNTY).catch(() => null); demo = !!d && d.exploit_commitment === b.exploit_commitment; }
  const extra = demo ? [{ hex: (await (await fetch(DEMO_INPUT_URL, { signal: AbortSignal.timeout(20000) })).text()).replace(/\s+/g, ''), want: null }] : [];
  const res = bad ? null : await runTests(bytes, tests.concat(extra));
  const fails = res ? tests.map((t, i) => ({ ...t, ...res[i] })).filter((t) => t.trap || t.got !== t.want) : [];
  const demoRun = res && demo ? res[tests.length] : null;
  const hash = sha256(bytes);
  return {
    bytes: bytes.length, sha256: hash, max_patch_bytes: b.max_patch_bytes, fits: bytes.length <= b.max_patch_bytes,
    same_as_original: hash === b.original_hash, interface_ok: !bad, interface_problem: bad || undefined,
    public_tests: res ? { passed: tests.length - fails.length, of: tests.length, failures: fails.slice(0, 5).map((f) => ({ input_hex: f.hex.slice(0, 64), expected: f.want, got: f.got, trapped: f.trap })) }
      : bad ? undefined : { passed: 0, of: tests.length, note: 'the tests did not finish within 4 seconds (too slow or an endless loop)' },
    public_demo_input: demo ? (demoRun ? { crashes: !!demoRun.trap, trap: demoRun.trap } : { crashes: null, note: 'did not finish within 4 seconds' }) : undefined,
    note: 'This checks the module, its exports and the public tests' + (demo ? ' and the public demo input' : '') + '. It does not show that the fix passes the bounty\'s private test: only the vendor\'s proof decides that.',
  };
}
const patchOk = (c) => c.fits && !c.same_as_original && c.interface_ok && c.public_tests && c.public_tests.passed === c.public_tests.of && !(c.public_demo_input && c.public_demo_input.crashes !== false);

// The attempt's nonce, derived so nothing has to be stored: HMAC-SHA256 under the key's seed over the bounty, the
// payout and the patch's hash. Unknown to anyone without the key; the same patch gives the same nonce at reveal.
const nonceFor = (k, bid, payout, bytes) => crypto.createHmac('sha256', k.seed).update(`skarbnik-hosted-nonce-v1|${CONTRACT}|${bid}|${payout}|${sha256(bytes)}`).digest();
function fingerprint(bytes, payout, nonce) {
  const p = Buffer.from(payout, 'utf8'); const a = Buffer.alloc(4); a.writeUInt32LE(bytes.length); const c = Buffer.alloc(4); c.writeUInt32LE(p.length);
  return sha256(Buffer.concat([Buffer.from('kintsugi-commit-v1'), a, Buffer.from(bytes), c, p, nonce]));
}

async function checks(b, account) {
  const now = BigInt(Date.now()) * 1000000n;
  const out = {
    open: b.state === 'Open' && b.opened, level_2: b.level === 2, published_checker: b.image_id_allowed && b.image_id === IMAGE_ID,
    free_slot: b.active < b.max_commits, time_left: now + BigInt(b.reveal_window_ns) + BigInt(b.verdict_window_ns) <= BigInt(b.expires_at_ns),
  };
  const [credit, limits] = await Promise.all([view('get_credit', { account_id: account }), view('get_agent_limits', { account_id: account })]);
  out.credit_covers_fee = BigInt(credit) >= BigInt(b.next_fee);
  out.fee_within_limit = limits.max_fee_per_commit == null || BigInt(b.next_fee) <= BigInt(limits.max_fee_per_commit);
  if (b.max_commits_per_account != null) out.account_below_cap = (await view('get_account_slots', { bounty_id: String(b.id), account_id: account })) < b.max_commits_per_account;
  out.ok_to_commit = Object.values(out).every(Boolean);
  return { checks: out, credit_yocto: String(credit), limits };
}
const near = (y) => `${(Number(BigInt(y) / 10n ** 18n) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 })} NEAR`;
async function bounty(bid) { const b = await view('get_bounty', { bounty_id: bid }); if (!b) throw new Fail(`no bounty ${bid}`); return b; }

// ---------- tools ----------
const TOOLS = {
  list_bounties: {
    ro: true, d: 'Open Skarbnik bounties from the feed (a snapshot): reward, next attempt fee, slots, windows. Call get_bounty for the live state.',
    p: { only_open: { type: 'boolean', description: 'only bounties accepting attempts (default true)' } }, r: [],
    async run(k, a) {
      const f = await feed();
      const rows = f.bounties.filter((b) => b.accepts_commits || a.only_open === false);
      // bounties newer than the feed, read live (open ones only), with their program found by original_hash
      const top = Math.max(...f.bounties.map((b) => Number(b.bounty_id)));
      const next = Number(await view('get_next_bounty_id', {}));
      for (let id = top + 1; id < next && id <= top + 20; id++) {
        const b = await view('get_bounty', { bounty_id: String(id) }).catch(() => null);
        if (!b || b.state !== 'Open' || !b.opened || b.active >= b.max_commits) continue;
        const same = f.bounties.find((x) => x.original_hash === b.original_hash && x.public_code);
        rows.push({ bounty_id: id, status: 'Open for attempts (newer than the feed)', kind: same ? same.kind : undefined, program: same && same.program, module_description: same && same.module_description,
          reward: near(b.amount), next_fee: near(b.next_fee), slots_left: b.max_commits - b.active, max_commits: b.max_commits, max_commits_per_account: b.max_commits_per_account,
          max_patch_bytes: b.max_patch_bytes, commit_deadline_utc: nsUtc(BigInt(b.expires_at_ns) - BigInt(b.reveal_window_ns) - BigInt(b.verdict_window_ns)) });
      }
      return { generated_at_utc: f.generated_at_utc, network: 'testnet', bounties: rows.map((b) => ({ bounty_id: String(b.bounty_id), status: b.status, kind: b.kind, test_bounty: b.test_bounty || undefined,
        program: b.program, description: b.module_description, reward: b.reward, next_fee: b.next_fee, slots_left: b.slots_left, max_commits: b.max_commits,
        max_commits_per_account: b.max_commits_per_account, max_patch_bytes: b.max_patch_bytes, commit_deadline_utc: b.commit_deadline_utc })),
        next: 'pick one, call get_public_code, then check_patch with your fix' };
    },
  },
  get_bounty: {
    ro: true, d: 'One bounty read live from the contract, with the checks to pass before committing for this link\'s account (credit, fee limit, slots, time).',
    p: { bounty_id: { type: 'string' } }, r: ['bounty_id'],
    async run(k, a) {
      const b = await bounty(String(a.bounty_id));
      const c = await checks(b, k.account);
      return { bounty_id: String(b.id), state: b.state, opened: b.opened, reward: near(b.amount), next_fee: near(b.next_fee), next_fee_yocto: b.next_fee,
        slots_in_use: b.active, max_commits: b.max_commits, max_patch_bytes: b.max_patch_bytes, reveal_gap_seconds: Number(BigInt(b.reveal_gap_ns) / 1000000000n),
        reveal_window_seconds: Number(BigInt(b.reveal_window_ns) / 1000000000n), verdict_window_hours: Number(BigInt(b.verdict_window_ns) / 3600000000000n),
        expires_at_utc: nsUtc(b.expires_at_ns), account: k.account, credit: near(c.credit_yocto), checks: c.checks };
    },
  },
  get_public_code: {
    ro: true, d: 'The public code of a bounty: the Rust source with its known bug, the original module as WebAssembly text (WAT, the form a fix is sent in), the public tests and what a fix must do. The module is checked against the hash on chain.',
    p: { bounty_id: { type: 'string' } }, r: ['bounty_id'],
    async run(k, a) {
      const bid = String(a.bounty_id);
      const b = await bounty(bid);
      const row = await publicCode(bid, b);
      const pc = row.public_code;
      const mod = await site(pc.module, true);
      if (sha256(mod) !== b.original_hash) throw new Fail(`the public module of bounty ${bid} does not match original_hash on chain; do not use it`);
      const w = await wabt();
      const m = w.readWasm(new Uint8Array(mod), { readDebugNames: false });
      let wat; try { wat = m.toText({ foldExprs: false, inlineExport: false }); } finally { m.destroy(); }
      return { bounty_id: bid, program: pc.program, description: pc.description, target: row.target, max_patch_bytes: b.max_patch_bytes,
        source_rust: await site(pc.source), original_wat: wat, public_tests: await site(pc.tests),
        how_to_send_a_fix: 'Change original_wat to fix the bug the Rust source describes (the Rust is the readable version of the same program). Keep the exports memory, input_buf and parse, and the answer of every public test. Then call check_patch with the whole fixed module as wat.' };
    },
  },
  check_patch: {
    ro: true, d: 'Check a fix before spending anything: turns the WebAssembly text (or patch_base64) into a module, confirms it is valid, that its size fits and that its exports match the public program, and runs the public tests; on a bounty that uses the public demo input it runs that input too. Sends nothing and spends nothing. It does not show that the fix passes the bounty\'s private test: only the vendor\'s proof decides that.',
    p: { bounty_id: { type: 'string' }, wat: { type: 'string', description: 'the whole fixed module as WebAssembly text' }, patch_base64: { type: 'string', description: 'or the fixed .wasm module in base64' } }, r: ['bounty_id'],
    async run(k, a) {
      const bid = String(a.bounty_id); const b = await bounty(bid); const bytes = await patchBytes(a);
      const c = await checkPatch(bid, bytes, b);
      return { ...c, ready_to_commit: patchOk(c), fee: near(b.next_fee), next: patchOk(c) ? `tell the user the fee (${near(b.next_fee)}) and wait for a yes, then call commit with the same wat` : 'fix the problems above and check again' };
    },
  },
  get_credit: {
    ro: true, d: 'This link\'s account: its credit in the contract (attempt fees come from it) and its agent limits.', p: {}, r: [],
    async run(k) { const [c, l] = await Promise.all([view('get_credit', { account_id: k.account }), view('get_agent_limits', { account_id: k.account })]); return { account: k.account, credit: near(c), credit_yocto: String(c), limits: l }; },
  },
  commit: {
    ro: false, d: 'Commit a fix to a bounty: sends a sealed fingerprint of it and takes the attempt fee from credit. Only after the user said yes to the fee. The fix must pass check_patch. Keep the same wat: reveal needs it.',
    p: { bounty_id: { type: 'string' }, wat: { type: 'string' }, patch_base64: { type: 'string' }, payout: { type: 'string', description: 'payout account (default: the account\'s fixed payout, else the account)' } }, r: ['bounty_id'],
    async run(k, a) {
      const bid = String(a.bounty_id); const b = await bounty(bid); const bytes = await patchBytes(a);
      const c = await checkPatch(bid, bytes, b);
      if (!patchOk(c)) throw new Fail(`refused before sending: the fix does not pass check_patch (${JSON.stringify({ fits: c.fits, same_as_original: c.same_as_original, interface: c.interface_problem, public_tests: c.public_tests && `${c.public_tests.passed} of ${c.public_tests.of}` })})`);
      const ch = await checks(b, k.account);
      if (!ch.checks.ok_to_commit) throw new Fail('refused before sending: ' + Object.entries(ch.checks).filter(([n, v]) => !v && n !== 'ok_to_commit').map(([n]) => n).join(', '));
      const payout = a.payout || ch.limits.fixed_payout || k.account;
      const fp = fingerprint(bytes, payout, nonceFor(k, bid, payout, bytes));
      const r = await signAndSend(k, 'commit', { bounty_id: bid, fingerprint: fp, payout });
      if (!r.ok || r.value == null) return { committed: false, tx: r.tx, reason: r.error || 'no free slot: the commit was ignored and cost nothing' };
      const gap = Number(BigInt(b.reveal_gap_ns) / 1000000000n), win = Number(BigInt(b.reveal_window_ns) / 1000000000n);
      return { committed: true, tx: r.tx, bounty_id: bid, index: r.value, fee: near(b.next_fee), patch_sha256: c.sha256, payout,
        next: `wait ${gap} seconds, then call reveal with bounty_id ${bid}, index ${r.value} and the same wat, within ${Math.round(win / 60)} minutes` };
    },
  },
  reveal: {
    ro: false, d: 'Reveal a committed fix after the bounty\'s reveal gap, with the same wat (or patch_base64) as the commit. The fix becomes public; the vendor then proves it.',
    p: { bounty_id: { type: 'string' }, index: { type: 'integer', description: 'the index commit returned' }, wat: { type: 'string' }, patch_base64: { type: 'string' }, payout: { type: 'string' } }, r: ['bounty_id', 'index'],
    async run(k, a) {
      const bid = String(a.bounty_id), idx = Number(a.index); const bytes = await patchBytes(a);
      const [s, b, limits] = await Promise.all([view('get_submission', { bounty_id: bid, index: idx }), bounty(bid), view('get_agent_limits', { account_id: k.account })]);
      if (!s || s.committer !== k.account) throw new Fail(`attempt ${idx} on bounty ${bid} was not committed by this link's account`);
      if (s.revealed_at_ns) return { revealed: true, already: true, revealed_at_utc: nsUtc(s.revealed_at_ns) };
      const payout = a.payout || s.payout || limits.fixed_payout || k.account;
      const nonce = nonceFor(k, bid, payout, bytes);
      if (fingerprint(bytes, payout, nonce) !== s.fingerprint) throw new Fail('this is not the fix that was committed (its fingerprint differs): send exactly the same wat');
      const wait = Number((BigInt(s.committed_at_ns) + BigInt(b.reveal_gap_ns) - BigInt(Date.now()) * 1000000n) / 1000000000n);
      if (wait > 0) return { revealed: false, wait_seconds: wait + 3, reason: 'the reveal gap has not passed yet; nothing was sent' };
      const r = await signAndSend(k, 'reveal', { bounty_id: bid, index: idx, patch: Buffer.from(bytes).toString('base64'), nonce: nonce.toString('hex') });
      if (!r.ok) return { revealed: false, tx: r.tx, reason: r.error };
      return { revealed: true, tx: r.tx, bounty_id: bid, index: idx, next: 'the vendor now proves the fix; call status later. A pass pays the reward; a fail spends the attempt; if the vendor stays silent, the timeout rule pays waiting attempts (never shown as a pass).' };
    },
  },
  status: {
    ro: true, d: 'This link\'s attempts and their outcome on chain (Open, Passed, Failed, TimedOut, Released), for one bounty or for the bounties in the feed.',
    p: { bounty_id: { type: 'string', description: 'one bounty (optional)' } }, r: [],
    async run(k, a) {
      const ids = a.bounty_id != null ? [String(a.bounty_id)] : (await feed()).bounties.filter((b) => b.attempts_used > 0 || b.accepts_commits).map((b) => String(b.bounty_id));
      const out = [];
      for (const bid of ids) {
        const b = await bounty(bid).catch(() => null); if (!b) continue;
        const subs = await Promise.all(Array.from({ length: b.commits }, (_, i) => view('get_submission', { bounty_id: bid, index: i }).catch(() => null)));
        subs.forEach((s, i) => { if (s && s.committer === k.account) out.push({ bounty_id: bid, index: i, outcome: s.outcome, verdict: s.verdict || null, revealed: !!s.revealed_at_ns, committed_at_utc: nsUtc(s.committed_at_ns), deadline_utc: s.deadline_ns ? nsUtc(s.deadline_ns) : null }); });
      }
      return { account: k.account, attempts: out, meaning: { Open: 'waiting (to be revealed, or for the vendor\'s proof)', Passed: 'paid by proof', Failed: 'the fix failed the check; the attempt is spent', TimedOut: 'paid by the timeout rule, not a pass', Released: 'not revealed in time' } };
    },
  },
};

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
// One JSON-RPC message for an allowed key; returns the response object, or null for a notification.
async function handleMessage(k, msg) {
  const { method, id } = msg || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') {
    const want = msg.params && msg.params.protocolVersion;
    return ok({ protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[1], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'skarbnik', title: 'Skarbnik (testnet)', version: VERSION },
      instructions: 'Skarbnik repair bounties on NEAR testnet, with a key that can only commit and reveal. Order: list_bounties, get_public_code, check_patch until it is ready, get_bounty, tell the user the fee and wait for a yes, commit, then reveal after the gap with the same wat, then status.' });
  }
  if (id === undefined || id === null) return null; // notifications (initialized, cancelled) need no answer
  if (method === 'ping') return ok({});
  if (method === 'tools/list') {
    return ok({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.d, inputSchema: { type: 'object', properties: t.p, required: t.r, additionalProperties: false },
      annotations: { readOnlyHint: t.ro, destructiveHint: false, idempotentHint: t.ro, openWorldHint: true } })) });
  }
  if (method === 'tools/call') {
    const p = msg.params || {}; const t = TOOLS[p.name];
    if (!t) return ok({ content: [{ type: 'text', text: `unknown tool ${String(p.name).slice(0, 40)}` }], isError: true });
    try {
      const res = await t.run(k, p.arguments || {});
      return ok({ content: [{ type: 'text', text: JSON.stringify(res, null, 1) }], structuredContent: res, isError: false });
    } catch (e) {
      return ok({ content: [{ type: 'text', text: e instanceof Fail ? e.message : 'the tool failed; try again' }], isError: true });
    }
  }
  if (method === 'resources/list') return ok({ resources: [] });
  if (method === 'prompts/list') return ok({ prompts: [] });
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } };
}

module.exports = { decodeToken, keyAllowed, handleMessage, VERSION, TOOLS, b58encode, b58decode, functionCallTx, fingerprint, checkPatch, patchBytes, patchOk, bounty, Fail };
