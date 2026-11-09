// The live agent feed at /api/feed: the same JSON as the saved feed.json (made by scripts/gen_feed.py), with the
// bounties that can still take attempts read again from the chain: the ones the saved feed lists as open
// (open_bounties) and any bounty newer than the saved feed. Every other row is the saved one, from generated_at_utc.
// Each re-read bounty gets its status from the site's own rule file (js/status.js), so the feed, the Bounties list and
// the bounty page say the same. updated_at_utc says when the chain was read; answers are cached about 60 seconds.
// If anything fails (an RPC error, HTTP 429, a timeout), it answers the saved feed, with source "saved" and the
// reason. Read only: view calls, no key, nothing sent, nothing stored, no logging. A new bounty's public code still
// needs its program's public files pushed (data/<program>/ and the saved feed); this function only matches a new
// bounty to a program the saved feed already names (public_programs, by original_hash and corpus_hash). Each row names
// its checker (crash, output or rule) and its kind of bug, as scripts/gen_feed.py does.
'use strict';
const SAVED = require('../feed.json');
const REC = require('../data/recorded.json');
const SITE = require('../site.config.json');
const PROGRAMS = require('../data/programs.json'); // each program's kind of bug by original_hash (scripts/gen_feed.py)

const CONTRACT = SITE.contract;
const CHECKERS = SITE.checkers;
const RPCS = SITE.rpc_urls;
const CACHE_MS = 60000; // how long one live answer is reused, here and at Vercel's edge
const CALL_MS = 4000; // one view call, per RPC address
const TOTAL_MS = 9000; // the whole live read; past it, the saved feed is answered
const IN_FLIGHT = 4; // view calls at once, to stay under the RPCs' rate limits

// The site's status rules. Vercel builds js/status.js and js/rules.js into CommonJS for this function, while Node on
// its own loads them as ES modules: take the named exports either way (on their own, or under default).
let rulesP = null;
const rules = () => (rulesP = rulesP || import('../js/status.js').then((m) => (m.statusOf ? m : m.default)));
let cached = null; // { at, body }

const near = (y) => `${(Number(BigInt(y)) / 1e24).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} NEAR`;
const utc = (ns) => new Date(Number(BigInt(ns) / 1000000n)).toISOString().replace(/\.\d+Z$/, 'Z');

function reader(deadline, stats) {
  let active = 0, failed = null; // after the first failure no further call is sent: the whole read falls back anyway
  const queue = [];
  const slot = () => new Promise((res) => { if (active < IN_FLIGHT) { active++; res(); } else queue.push(res); });
  const free = () => { const n = queue.shift(); if (n) n(); else active--; };
  return async function view(method, args) {
    await slot();
    try {
      if (failed) throw new Error(failed);
      let last = 'no answer';
      for (const url of RPCS) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error('timeout');
        stats.calls++;
        try {
          const r = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(Math.min(CALL_MS, left)),
            body: JSON.stringify({ jsonrpc: '2.0', id: 'f', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') } }),
          });
          if (!r.ok) { last = `HTTP ${r.status}`; continue; }
          const j = await r.json();
          if (j.result && j.result.result) return JSON.parse(Buffer.from(j.result.result).toString());
          last = j.error ? 'RPC error' : 'no result';
        } catch (e) {
          last = e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network error';
        }
      }
      failed = `${method}: ${last} from every RPC`;
      throw new Error(failed);
    } finally {
      free();
    }
  };
}

// One feed row, in the same shape and order as scripts/gen_feed.py writes it.
function row(b, subs, kind, status, acc, pc) {
  // the checker that judges it (crash, output, rule, or other: a retired or unknown id) and the kind of bug: the
  // published program's, else the one data/programs.json names, else from the checker (scripts/gen_feed.py, checker_of
  // and bug_kind)
  const checker = Object.keys(CHECKERS).find((k) => CHECKERS[k] === b.image_id) || 'other';
  const named = (PROGRAMS.programs || {})[b.original_hash];
  const bug = pc && pc.bug ? pc.bug : named && named.bug ? named.bug : ({ output: 'wrong output', rule: 'security rule' })[checker] || 'crash';
  const cb = (BigInt(b.expires_at_ns) - BigInt(b.reveal_window_ns) - BigInt(b.verdict_window_ns)).toString();
  return {
    bounty_id: Number(b.id), status, kind,
    judge_bounty: !!(REC.judge_bounties && REC.judge_bounties[String(b.id)]),
    retired_judge_bounty: (REC.retired_judge_bounties || []).includes(String(b.id)), accepts_commits: acc, level: b.level,
    program: pc ? pc.program : null, module_description: pc ? pc.description : null,
    bug_kind: bug, checker,
    target: (SAVED.targets || {})[bug] || (SAVED.bounties.length ? SAVED.bounties[0].target : null), max_patch_bytes: b.max_patch_bytes,
    reward_yocto: b.amount, reward: near(b.amount),
    max_commits: b.max_commits, attempts_used: b.commits, attempts: `${b.commits} of ${b.max_commits} used`, slots_in_use: b.active,
    max_commits_per_account: b.max_commits_per_account === undefined ? null : b.max_commits_per_account,
    fee_schedule: { base_yocto: b.attempt_fee, step_yocto: b.fee_step, rule: 'the attempt with index n (from 0) costs base + n * step, from credit in the contract' },
    next_fee_yocto: b.next_fee, next_fee: near(b.next_fee),
    windows: { reveal_gap_ns: b.reveal_gap_ns, reveal_window_ns: b.reveal_window_ns, verdict_window_ns: b.verdict_window_ns,
      commit_deadline_utc: utc(cb), expires_at_utc: utc(b.expires_at_ns) },
    image_id: b.image_id, image_id_allowed: b.image_id_allowed,
    original_hash: b.original_hash, corpus_hash: b.corpus_hash, public_code: pc,
  };
}

async function live() {
  const now = Date.now(), stats = { calls: 0 };
  const view = reader(now + TOTAL_MS, stats);
  const { kindOf, statusOf, accepting } = await rules();
  const savedIds = SAVED.bounties.map((x) => x.bounty_id);
  const top = savedIds.length ? Math.max(...savedIds) : -1;
  const next = Number(await view('get_next_bounty_id', {}));
  const ids = [...new Set([...SAVED.open_bounties.map((x) => x.bounty_id), ...Array.from({ length: Math.max(0, next - top - 1) }, (_, i) => top + 1 + i)])];
  // a program's public code, matched by (original_hash, corpus_hash): from the saved feed's list of published programs
  // (public_programs), else from a saved bounty of the same program
  const code = (b) => {
    const p = (SAVED.public_programs || []).find((x) => x.original_hash === b.original_hash && x.corpus_hash === b.corpus_hash);
    if (p) { const { original_hash, corpus_hash, ...pc } = p; return pc; }
    return (SAVED.bounties.find((x) => x.public_code && x.original_hash === b.original_hash && x.corpus_hash === b.corpus_hash) || {}).public_code || null;
  };
  const fresh = await Promise.all(ids.map(async (id) => {
    const b = await view('get_bounty', { bounty_id: String(id) });
    if (!b) return null;
    const kind = kindOf(b, REC);
    // the status needs the winner of a paid bounty, and every attempt of an unsettled private one
    const subs = [];
    if (b.state === 'Paid' && b.winner !== null && b.winner !== undefined) subs[b.winner] = await view('get_submission', { bounty_id: String(id), index: b.winner });
    else if (b.state === 'Open' && kind === 'private') {
      const all = await Promise.all(Array.from({ length: b.commits }, (_, k) => view('get_submission', { bounty_id: String(id), index: k })));
      all.forEach((s, k) => { subs[k] = s; });
    }
    const acc = accepting(b, now);
    return { b, subs, r: row(b, subs, kind, statusOf(b, subs, kind, now), acc, code(b)) };
  }));
  const byId = new Map(fresh.filter(Boolean).map((x) => [x.r.bounty_id, x]));
  const bounties = SAVED.bounties.map((x) => (byId.has(x.bounty_id) ? byId.get(x.bounty_id).r : x));
  for (const [id, x] of byId) if (!savedIds.includes(id)) bounties.push(x.r);
  const open = bounties.filter((x) => x.accepts_commits).map((x) => {
    const b = (byId.get(x.bounty_id) || {}).b;
    const saved = SAVED.open_bounties.find((o) => o.bounty_id === x.bounty_id);
    if (!b) return saved;
    return { ...x, slots_left: b.max_commits - b.active, commit_deadline_utc: x.windows.commit_deadline_utc, expires_at_utc: x.windows.expires_at_utc,
      bounty_amount: near(b.amount), test_bounty: !!(REC.test_bounties && REC.test_bounties[String(b.id)]) };
  }).filter(Boolean);
  const paid = [...SAVED.paid_by_timeout];
  for (const [id, x] of byId) {
    const w = x.b.state === 'Paid' ? x.subs[x.b.winner] : null;
    if (w && w.outcome === 'TimedOut' && !paid.some((p) => p.bounty_id === id)) {
      const tx = ((REC.bounties || {})[String(id)] || []).find((t) => t.method === 'claim_timeout' && t.result === 'succeeded');
      paid.push({ bounty_id: id, attempt: x.b.winner, outcome: 'paid by timeout, not by a proof', claim_tx: tx ? tx.tx : null });
    }
  }
  return {
    ...SAVED,
    updated_at_utc: new Date(now).toISOString().replace(/\.\d+Z$/, 'Z'),
    source: 'live',
    live_note: `Read from the chain at updated_at_utc: bounties ${[...byId.keys()].join(', ') || 'none'} (the ones the saved feed lists as open, and any newer ones), ${stats.calls} view calls; every other row is the saved feed of generated_at_utc. Cached about 60 seconds. Read get_bounty before you commit.`,
    open_bounties: open, bounties, paid_by_timeout: paid,
  };
}

function saved(reason) {
  return { ...SAVED, updated_at_utc: SAVED.updated_at_utc || SAVED.generated_at_utc, source: 'saved',
    live_note: `The live read failed (${reason}); this is the saved feed of generated_at_utc. Read get_bounty before you commit.` };
}

module.exports = async function handler(req, res) {
  let body, ok = true;
  if (cached && Date.now() - cached.at < CACHE_MS) body = cached.body;
  else {
    try {
      body = await live();
      cached = { at: Date.now(), body };
    } catch (e) {
      ok = false;
      body = saved(String((e && e.message) || 'error').slice(0, 120));
    }
  }
  res.statusCode = 200;
  // a live answer is kept 60 s at the edge; the saved one only 15 s, so a recovered RPC shows soon
  res.setHeader('Cache-Control', ok ? 'public, max-age=0, s-maxage=60' : 'public, max-age=0, s-maxage=15');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body, null, 1));
};
module.exports._reset = () => { cached = null; };
