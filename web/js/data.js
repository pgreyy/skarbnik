// The site's data, read once per visit and shared by the screens: the recorded transactions (data/recorded.json,
// built by scripts/gen_site_recorded.py), the bounty titles and notes (data/bounty_meta.json), the measured numbers
// (data/numbers.json), and every bounty with its attempts, its kind and its status, read live from the contract
// (js/chain.js). Helpers pick a bounty's recorded transactions by method.
import { allBounties, submissions } from './chain.js';
import { kindOf, statusOf, accepting } from './status.js';

const once = (f) => { let p = null; return () => (p = p || f().catch((e) => { p = null; throw e; })); };
const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });

export const getRecorded = once(() => json('data/recorded.json'));
export const getMeta = once(() => json('data/bounty_meta.json'));
export const getNumbers = once(() => json('data/numbers.json'));
export const getConfig = once(() => json('site.config.json'));

// Every bounty with its attempts, kind and status. Kept for 20 seconds (the view calls are cached as long).
let cache = null;
export async function loadAll(fresh = false) {
  if (!fresh && cache && Date.now() - cache.t < 20000) return cache.v;
  const [rec, list] = await Promise.all([getRecorded(), allBounties()]);
  const bs = list.filter(Boolean);
  const subs = await Promise.all(bs.map((b) => (b.commits ? submissions(b) : [])));
  const now = Date.now();
  const v = bs.map((b, i) => { const kind = kindOf(b, rec); return { b, subs: subs[i], kind, status: statusOf(b, subs[i], kind, now), accepting: accepting(b, now) }; });
  cache = { t: Date.now(), v };
  return v;
}

// A bounty's recorded transactions that succeeded, optionally of one method; first and last of a method.
export const txsOf = (rec, id, method = null) => ((rec.bounties && rec.bounties[String(id)]) || []).filter((t) => t.result === 'succeeded' && (!method || t.method === method));
export const firstTx = (rec, id, method) => { const l = txsOf(rec, id, method); return l.length ? l[0].tx : null; };
export const lastTx = (rec, id, method) => { const l = txsOf(rec, id, method); return l.length ? l[l.length - 1].tx : null; };
