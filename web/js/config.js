// The site's settings, read once from web/site.config.json (the one place for the site's own address, the network,
// the contract, the RPC addresses, the explorer and the transaction index). Every other module imports from here.
const cfg = await (await fetch(new URL('../site.config.json', import.meta.url))).json();
export const SITE_URL = cfg.site_url;
export const NETWORK = cfg.network;
export const CONTRACT = cfg.contract;
export const RPCS = cfg.rpc_urls;
export const EXPLORER_TX = cfg.explorer_tx;
export const EXPLORER_ACCOUNT = cfg.explorer_account;
export const TX_INDEX = cfg.tx_index;
export const PUBLISHED_IMAGE_ID = cfg.published_image_id;
// An account of this network: a named account under .testnet (or .near on mainnet), or a 64 character implicit account.
export const isNetworkAccount = (a) => (NETWORK === 'mainnet' ? /\.near$/ : /\.testnet$/).test(a) || /^[0-9a-f]{64}$/.test(a);
