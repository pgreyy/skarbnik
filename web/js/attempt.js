// What a visitor's browser computes for an attempt, with nothing hidden: the commit fingerprint, exactly as the
// contract's commit_fingerprint does it, sha256("kintsugi-commit-v1" || u32 LE patch length || patch || u32 LE payout
// length || payout account || 32 byte nonce); a random nonce from the browser's crypto; and a record of the attempt
// (bounty, index, payout, nonce, patch) kept in this site's local storage so it can be revealed later. The record is also
// offered as a file. It holds no key and cannot move money: the nonce only proves which patch the commit locked in.
const DOMAIN = new TextEncoder().encode('kintsugi-commit-v1');
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
export const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

export async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }

export async function fingerprint(patch, payout, nonce) {
  const p = new TextEncoder().encode(payout);
  const buf = new Uint8Array(DOMAIN.length + 4 + patch.length + 4 + p.length + 32);
  let o = 0;
  for (const part of [DOMAIN, u32(patch.length), patch, u32(p.length), p, nonce]) { buf.set(part, o); o += part.length; }
  return hex(await sha256(buf));
}

export const newNonce = () => crypto.getRandomValues(new Uint8Array(32));

export function b64(bytes) { let s = ''; bytes.forEach((x) => (s += String.fromCharCode(x))); return btoa(s); }

// Attempt records, per committing account, in localStorage under one key. Every access is guarded: storage can be
// blocked, and the page then says so and offers the file instead.
const KEY = 'kintsugi-attempts-v1';
function all() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } }
export function attemptsFor(account, bountyId) { return all().filter((a) => a.account === account && String(a.bounty) === String(bountyId)); }
export function putAttempt(rec) {
  const list = all().filter((a) => !(a.account === rec.account && String(a.bounty) === String(rec.bounty) && a.fingerprint === rec.fingerprint));
  list.push(rec);
  return save(list);
}
export function dropAttempt(rec) { save(all().filter((a) => a.fingerprint !== rec.fingerprint)); }

export function downloadRecord(rec) {
  const blob = new Blob([JSON.stringify({ note: 'Skarbnik attempt record (testnet). Keep it until you have revealed. It holds no key.', ...rec }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `skarbnik-bounty-${rec.bounty}-attempt-${rec.index ?? 'pending'}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// "1.5" NEAR to yoctoNEAR (a decimal string), exactly; null if the text is not a positive amount with at most 24 decimals.
export function toYocto(text) {
  const m = String(text).trim().match(/^(\d+)(?:\.(\d{1,24}))?$/);
  if (!m) return null;
  const v = BigInt(m[1]) * 10n ** 24n + BigInt((m[2] || '').padEnd(24, '0') || '0');
  return v > 0n ? v.toString() : null;
}
