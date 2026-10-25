// Wallet connection for the site, NEAR testnet only. Uses the wallet selector with the MyNearWallet module, bundled in
// vendor/near-wallet.js (exact versions in scripts/wallet-vendor/). Sign in asks for no contract key, so this page never
// holds or stores a key: every transaction opens the wallet, where the person approves or rejects it. The page only
// keeps the signed in account name, as the wallet module does.
import { setupWalletSelector, setupMyNearWallet, actionCreators } from '../vendor/near-wallet.js';
import { CONTRACT, RPCS } from './chain.js';

let selector = null;
const listeners = new Set();
export const state = { status: 'off', account: null, error: '' }; // off | connecting | on | wrongnet | failed

function set(patch) { Object.assign(state, patch); listeners.forEach((f) => f(state)); }
export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }

// A testnet account is a named account under .testnet or a 64 character implicit account.
export const isTestnetAccount = (a) => /\.testnet$/.test(a) || /^[0-9a-f]{64}$/.test(a);

function fromSelector(s) {
  const a = s.accounts && s.accounts[0] ? s.accounts[0].accountId : null;
  if (!a) set({ status: state.status === 'connecting' ? 'connecting' : 'off', account: null });
  else if (!isTestnetAccount(a)) set({ status: 'wrongnet', account: a });
  else set({ status: 'on', account: a, error: '' });
}

export async function init() {
  try {
    selector = await setupWalletSelector({ network: 'testnet', modules: [setupMyNearWallet()] });
    fromSelector(selector.store.getState());
    selector.store.observable.subscribe(fromSelector);
  } catch (e) {
    set({ status: 'failed', error: `The wallet module did not load: ${e.message}` });
  }
}

export async function connect() {
  if (!selector) await init();
  if (!selector) return;
  set({ status: 'connecting', error: '' });
  try {
    const w = await selector.wallet('my-near-wallet');
    await w.signIn({}); // no contractId: the wallet adds no key for this site
    fromSelector(selector.store.getState());
    if (state.status === 'connecting') set({ status: 'failed', error: 'The wallet returned no account.' });
  } catch (e) {
    set({ status: 'failed', error: plainError(e) });
  }
}

export async function disconnect() {
  try { const w = await selector.wallet(); await w.signOut(); } catch { /* already signed out */ }
  set({ status: 'off', account: null, error: '' });
}

// One function call to the contract, approved in the wallet. Returns the transaction outcome.
export async function call(method, args, depositYocto = '0', tgas = 100) {
  if (state.status !== 'on') throw new Error('Connect a testnet wallet first.');
  const w = await selector.wallet();
  return w.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [actionCreators.functionCall(method, args, BigInt(tgas) * 10n ** 12n, BigInt(depositYocto))],
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
  if (/closed the window|rejected|denied|cancel/i.test(m)) return 'The wallet request was closed or rejected. Nothing was sent.';
  if (/popup window blocked/i.test(m)) return 'The browser blocked the wallet window. Allow pop ups for this site and try again.';
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
