// Makes an agent key pair in the visitor's browser (Web Crypto, Ed25519) in NEAR's text format: the public key
// "ed25519:<base58 of 32 bytes>" and the private key "ed25519:<base58 of the 32 byte seed and the 32 byte public
// key>". Nothing here sends or stores the private key: the Account page shows it once and offers it as a file, and
// once as the connector link (the hosted agent connector at /api/mcp/<token>, web/api/mcp/[token].js): the token is
// "sk1_" and base64url of the account name's length, the account name and the key's 32 byte seed.
import { SITE_URL } from './config.js';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}

export function base58decode(s) {
  let n = 0n;
  for (const c of s) { const i = ALPHABET.indexOf(c); if (i < 0) throw new Error('not base58'); n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c === '1') out.unshift(0); else break; }
  return new Uint8Array(out);
}

// The connector link for an agent key: the hosted connector's address with the account and the key's seed in it.
export function connectorLink(account, privateKey) {
  const seed = base58decode(privateKey.split(':')[1]).slice(0, 32);
  const name = new TextEncoder().encode(account);
  const bytes = new Uint8Array(1 + name.length + 32);
  bytes[0] = name.length; bytes.set(name, 1); bytes.set(seed, 1 + name.length);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${SITE_URL}/api/mcp/sk1_${b64}`;
}

// Returns { publicKey, privateKey } as NEAR text keys, or throws when this browser has no Ed25519 in Web Crypto.
export async function newAgentKey() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const seed = pkcs8.slice(pkcs8.length - 32);
  const full = new Uint8Array(64); full.set(seed, 0); full.set(pub, 32);
  return { publicKey: `ed25519:${base58(pub)}`, privateKey: `ed25519:${base58(full)}` };
}
