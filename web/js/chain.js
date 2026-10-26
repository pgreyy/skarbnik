// Read only access to the Skarbnik contract on NEAR testnet: JSON-RPC "call_function" view calls, no keys, no wallet,
// nothing is ever signed or sent. Also the small helpers that turn chain values into text (NEAR amounts, UTC times).
export const CONTRACT = 'kintsugi-l2-cihdp.testnet';
export const RPCS = ['https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'];
export const EXPLORER_TX = 'https://testnet.nearblocks.io/txns/';
export const EXPLORER_ACCOUNT = 'https://testnet.nearblocks.io/address/';
export const PUBLISHED_IMAGE_ID = 'dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc';

const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const cache = new Map();

async function rpc(url, method, args) {
  const body = {
    jsonrpc: '2.0', id: 'k', method: 'query',
    params: { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: b64(JSON.stringify(args)) },
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json();
    if (!j.result || !j.result.result) throw new Error((j.result && j.result.error) || (j.error && JSON.stringify(j.error)) || 'no result');
    return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
  } finally {
    clearTimeout(timer);
  }
}

// One view call, trying the second RPC if the first fails. Results are kept for 20 seconds unless opts.fresh is set.
export async function view(method, args = {}, opts = {}) {
  const key = method + JSON.stringify(args);
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.t < 20000) return hit.v;
  let last;
  for (const url of RPCS) {
    try {
      const v = await rpc(url, method, args);
      cache.set(key, { t: Date.now(), v });
      return v;
    } catch (e) { last = e; }
  }
  throw new Error(`could not read ${method} from testnet (${last && last.message})`);
}

export async function allBounties() {
  const n = Number(await view('get_next_bounty_id'));
  const ids = Array.from({ length: n }, (_, i) => i);
  return Promise.all(ids.map((i) => view('get_bounty', { bounty_id: String(i) })));
}

export async function submissions(b) {
  const ids = Array.from({ length: b.commits }, (_, i) => i);
  return Promise.all(ids.map((i) => view('get_submission', { bounty_id: String(b.id), index: i })));
}

// yoctoNEAR (a decimal string) to "0.015 NEAR": exact, with BigInt, trailing zeros removed.
export function near(yocto) {
  const v = BigInt(yocto);
  const whole = v / 10n ** 24n;
  const frac = (v % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '');
  return `${whole}${frac ? '.' + frac.slice(0, 6) : ''} NEAR`;
}

export const nsToDate = (ns) => new Date(Number(BigInt(ns) / 1000000n));
export function utc(ns) {
  const d = nsToDate(ns);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
export function span(ns) {
  const s = Math.round(Number(BigInt(ns) / 1000000000n));
  if (s % 86400 === 0) return `${s / 86400} ${s === 86400 ? 'day' : 'days'}`;
  if (s % 3600 === 0) return `${s / 3600} ${s === 3600 ? 'hour' : 'hours'}`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}
export function left(ns, now = Date.now()) {
  const ms = nsToDate(ns).getTime() - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
  if (d >= 1) return `${d} ${d === 1 ? 'day' : 'days'} ${h % 24} ${h % 24 === 1 ? 'hour' : 'hours'} left`;
  const m = Math.floor((ms % 3600000) / 60000);
  return h >= 1 ? `${h} ${h === 1 ? 'hour' : 'hours'} ${m} min left` : `${m} min left`;
}
// The last moment a commit is accepted: the contract wants the reveal window and the verdict window before expiry.
export const commitBy = (b) => (BigInt(b.expires_at_ns) - BigInt(b.reveal_window_ns) - BigInt(b.verdict_window_ns)).toString();

// The access keys of an account (view_access_key_list): each key's public key and permission (FullAccess, or a
// FunctionCall key with its receiver, methods and gas allowance). Read only; tries the second RPC if the first fails.
export async function accessKeys(account) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        jsonrpc: '2.0', id: 'k', method: 'query', params: { request_type: 'view_access_key_list', finality: 'final', account_id: account } }) });
      const j = await r.json();
      if (j.result && j.result.keys) return j.result.keys;
      last = new Error((j.error && JSON.stringify(j.error)) || 'no result');
    } catch (e) { last = e; }
  }
  throw new Error(`could not read the access keys of ${account} (${last && last.message})`);
}
