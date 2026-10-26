// Makes an agent key pair in the visitor's browser (Web Crypto, Ed25519) in NEAR's text format: the public key
// "ed25519:<base58 of 32 bytes>" and the private key "ed25519:<base58 of the 32 byte seed and the 32 byte public
// key>". Nothing here sends or stores the private key: the Account page shows it once and offers it as a file.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
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
