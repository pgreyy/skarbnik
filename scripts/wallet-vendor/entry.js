// Entry for the wallet bundle: the two functions the site uses, plus Buffer, which MyNearWallet expects as a global.
import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
export { setupWalletSelector, actionCreators } from '@near-wallet-selector/core';
export { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
