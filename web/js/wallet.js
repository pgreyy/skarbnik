// Wallet connection for the site, NEAR testnet only, through NEAR Connect (vendor/near-connect.js, the connector the NEAR
// docs recommend). The wallets offered are listed in vendor/wallets/manifest.json and their scripts are local copies in
// vendor/wallets/ (exact sources and sha256 in scripts/wallet-vendor/fetch_wallets.sh): Intear Wallet, NEAR CLI (signs
// in your own terminal), and MyNearWallet until it is retired on 31 October 2026. Each wallet's script runs in a sandboxed
// frame. This page's own code never creates, stores or prints a key; a wallet's script may keep its own session key in
// the browser (Intear does; it cannot spend on chain). Every transaction is approved in the wallet.
import { NearConnector } from '../vendor/near-connect.js';
import { CONTRACT, RPCS } from './chain.js';

let connector = null;
const listeners = new Set();
export const state = { status: 'off', account: null, wallet: null, error: '' }; // off | connecting | on | wrongnet | failed

function set(patch) { Object.assign(state, patch); listeners.forEach((f) => f(state)); }
export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }

// A testnet account is a named account under .testnet or a 64 character implicit account.
export const isTestnetAccount = (a) => /\.testnet$/.test(a) || /^[0-9a-f]{64}$/.test(a);

function fromAccounts(accounts, walletName) {
  const a = accounts && accounts[0] ? accounts[0].accountId : null;
  if (!a) set({ status: 'off', account: null, wallet: null });
  else if (!isTestnetAccount(a)) set({ status: 'wrongnet', account: a, wallet: walletName });
  else set({ status: 'on', account: a, wallet: walletName, error: '' });
}

async function manifest() {
  const m = await (await fetch('vendor/wallets/manifest.json')).json();
  m.wallets = m.wallets.map((w) => ({ ...w, executor: new URL(w.executor, location.href).href }));
  return m;
}

export async function init() {
  try {
    connector = new NearConnector({ network: 'testnet', manifest: await manifest(), footerBranding: null, providers: { testnet: RPCS } });
    connector.on('wallet:signIn', async (e) => { const w = await connector.wallet().catch(() => null); fromAccounts(e.accounts, w && w.manifest ? w.manifest.name : null); });
    connector.on('wallet:signOut', () => set({ status: 'off', account: null, wallet: null }));
    const c = await connector.getConnectedWallet().catch(() => null);
    if (c) fromAccounts(c.accounts, c.wallet && c.wallet.manifest ? c.wallet.manifest.name : null);
  } catch (e) {
    set({ status: 'failed', error: `The wallet connector did not load: ${e.message}` });
  }
}

export async function connect() {
  if (!connector) await init();
  if (!connector) return;
  set({ status: 'connecting', error: '' });
  try {
    await connector.connect(); // opens NEAR Connect's wallet list; signs in with no contract key
    const c = await connector.getConnectedWallet().catch(() => null);
    if (c) fromAccounts(c.accounts, c.wallet && c.wallet.manifest ? c.wallet.manifest.name : null);
    else set({ status: 'off' });
  } catch (e) {
    set({ status: /closed|reject|cancel/i.test(e && e.message) ? 'off' : 'failed', error: plainError(e) });
  }
}

export async function disconnect() {
  try { await connector.disconnect(); } catch { /* already signed out */ }
  set({ status: 'off', account: null, wallet: null, error: '' });
}

// One function call to the contract, approved in the wallet. Returns the transaction outcome.
export async function call(method, args, depositYocto = '0', tgas = 100) {
  if (state.status !== 'on') throw new Error('Connect a testnet wallet first.');
  const w = await connector.wallet();
  return w.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [{ type: 'FunctionCall', params: { methodName: method, args, gas: (BigInt(tgas) * 10n ** 12n).toString(), deposit: String(depositYocto) } }],
  });
}

// What a transaction outcome says: its id, whether it succeeded, the decoded return value, or the contract's message.
export function readOutcome(o) {
  if (!o) return { ok: false, tx: null, error: 'The wallet did not return a result. Check the account on the explorer.' };
  const tx = o.transaction && o.transaction.hash ? o.transaction.hash : (o.transaction_outcome && o.transaction_outcome.id) || null;
  const st = o.status || {};
  if (st.Failure) return { ok: false, tx, error: failureText(st.Failure) };
  for (const r of o.receipts_outcome || []) { if (r.outcome && r.outcome.status && r.outcome.status.Failure) return { ok: false, tx, error: failureText(r.outcome.status.Failure) }; }
  let value;
  if (typeof st.SuccessValue === 'string') {
    const raw = st.SuccessValue ? atob(st.SuccessValue) : '';
    try { value = raw ? JSON.parse(raw) : null; } catch { value = raw; }
  }
  return { ok: true, tx, value };
}

function failureText(f) {
  const s = JSON.stringify(f);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/);
  return m ? m[1] : s.slice(0, 300);
}

export function plainError(e) {
  const m = (e && e.message) || String(e);
  if (/closed the window|closed|rejected|denied|cancel/i.test(m)) return 'The wallet request was closed or rejected. Nothing was sent.';
  if (/popup window blocked|blocked/i.test(m)) return 'The browser blocked the wallet window. Allow pop ups for this site and try again.';
  const p = m.match(/Smart contract panicked: ([^"\\]+)/);
  return p ? p[1] : m.slice(0, 300);
}

// The wallet's own NEAR balance (view_account), in yoctoNEAR; null when the account does not exist, undefined when
// no RPC answered.
export async function balance(account) {
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'b', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: account } }) });
      const j = await r.json();
      if (j.result) return j.result.amount;
      if (j.error) return null;
    } catch { /* try the next RPC */ }
  }
  return undefined;
}
