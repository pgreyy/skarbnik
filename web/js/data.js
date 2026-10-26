// The site's data, read once per visit and shared by the screens: the recorded transactions (data/recorded.json,
// built by scripts/gen_site_recorded.py), the bounty titles and notes (data/bounty_meta.json), the measured numbers
// (data/numbers.json), and every bounty with its attempts, its kind and its status, read live from the contract
// (js/chain.js). Helpers pick a bounty's recorded transactions by method.
import { allBounties, submissions, view } from './chain.js';
import { kindOf, statusOf, accepting } from './status.js';

const once = (f) => { let p = null; return () => (p = p || f().catch((e) => { p = null; throw e; })); };
const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });

export const getRecorded = once(() => json('data/recorded.json'));
export const getMeta = once(() => json('data/bounty_meta.json'));
export const getNumbers = once(() => json('data/numbers.json'));
export const getConfig = once(() => json('site.config.json'));

// The attempts a bounty's status needs: none for a refunded bounty, the winning attempt for a paid one (whether it was
// paid by proof or by timeout), every attempt for an open one. full: every attempt of every bounty (the ledger).
async function attemptsFor(b, full) {
  if (!b.commits) return [];
  if (full || b.state === 'Open') return submissions(b);
  if (b.state === 'Paid' && b.winner !== null && b.winner !== undefined) {
    const out = []; out[b.winner] = await view('get_submission', { bounty_id: String(b.id), index: b.winner }); return out;
  }
  return [];
}
const entry = (b, subs, rec, now) => { const kind = kindOf(b, rec); return { b, subs, kind, status: statusOf(b, subs, kind, now), accepting: accepting(b, now) }; };

// Every bounty with its kind and status (and its attempts: all of them with full, else those the status needs). Kept
// for 20 seconds (the view calls are cached as long).
let cache = null;
export async function loadAll(full = false) {
  if (cache && Date.now() - cache.t < 20000 && (cache.full || !full)) return cache.v;
  const [rec, list] = await Promise.all([getRecorded(), allBounties()]);
  const bs = list.filter(Boolean);
  const subs = await Promise.all(bs.map((b) => attemptsFor(b, full)));
  const now = Date.now();
  const v = bs.map((b, i) => entry(b, subs[i], rec, now));
  cache = { t: Date.now(), v, full };
  return v;
}
// The ids of the bounties paid by a proof: every bounty, and the winning attempt of each paid one.
export async function paidByProof() {
  const bs = (await allBounties()).filter((b) => b && b.state === 'Paid' && b.winner !== null && b.winner !== undefined);
  const w = await Promise.all(bs.map((b) => view('get_submission', { bounty_id: String(b.id), index: b.winner })));
  return bs.filter((b, i) => w[i] && w[i].outcome === 'Passed').map((b) => b.id);
}
// The last feed snapshot (web/feed.json, scripts/gen_feed.py) in the same shape as loadAll, for when the chain cannot be
// read: { at: its time, list }. Each entry carries the feed row as .snap and has no attempts.
export async function fromFeed() {
  const [rec, feed] = await Promise.all([getRecorded(), json('feed.json')]);
  const demo = (rec.notes.demo_exploit_commitment || {}).commitment;
  return { at: feed.generated_at_utc, list: feed.bounties.map((f) => ({ snap: f, b: { id: f.bounty_id, amount: f.reward_yocto, max_commits: f.max_commits, commits: f.attempts_used, exploit_commitment: f.kind === 'demo' ? demo : null }, subs: [], kind: f.kind, status: f.status, accepting: f.accepts_commits })) };
}
// Some bounties only, by id, with every attempt.
export async function loadSome(ids) {
  const rec = await getRecorded(), now = Date.now();
  const bs = (await Promise.all(ids.map((id) => view('get_bounty', { bounty_id: String(id) })))).filter(Boolean);
  const subs = await Promise.all(bs.map((b) => (b.commits ? submissions(b) : [])));
  return bs.map((b, i) => entry(b, subs[i], rec, now));
}

// A bounty's recorded transactions that succeeded, optionally of one method; first and last of a method.
export const txsOf = (rec, id, method = null) => ((rec.bounties && rec.bounties[String(id)]) || []).filter((t) => t.result === 'succeeded' && (!method || t.method === method));
export const firstTx = (rec, id, method) => { const l = txsOf(rec, id, method); return l.length ? l[0].tx : null; };
export const lastTx = (rec, id, method) => { const l = txsOf(rec, id, method); return l.length ? l[l.length - 1].tx : null; };
