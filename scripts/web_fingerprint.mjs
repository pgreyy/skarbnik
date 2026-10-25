// Prints the commit fingerprint for a patch file, a payout account and a nonce (64 hex), computed by the site's own
// browser code (web/js/attempt.js), so a testnet run can send exactly what the page would send.
// Usage, from the repo root: node scripts/web_fingerprint.mjs <patch.wasm> <payout account> <nonce hex>
import { readFileSync } from 'node:fs';
import { fingerprint, unhex } from '../web/js/attempt.js';
const [patchFile, payout, nonceHex] = process.argv.slice(2);
console.log(await fingerprint(new Uint8Array(readFileSync(patchFile)), payout, unhex(nonceHex)));
