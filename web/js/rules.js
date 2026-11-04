// Two small time rules of the contract, shared by the browser pages (js/chain.js, js/status.js) and the live feed
// function (api/feed.js): a nanosecond time as a Date, and the last time a commit is accepted. No imports and no
// browser objects, so Node can load this file too (Vercel builds it into CommonJS for the function).
export const nsToDate = (ns) => new Date(Number(BigInt(ns) / 1000000n));
// the contract refuses a commit that leaves less than the reveal window and the verdict window before expiry
export const commitBy = (b) => (BigInt(b.expires_at_ns) - BigInt(b.reveal_window_ns) - BigInt(b.verdict_window_ns)).toString();
