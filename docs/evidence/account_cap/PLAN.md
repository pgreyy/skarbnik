# Per-account cap per bounty: design, review and deploy plan (not deployed)

Status: written and tested in unit tests; **not deployed**. The deployed contract on `kintsugi-l2-cihdp.testnet` is still
the hardening build (wasm sha256 `938d5456...d1b7`). Deploying waits for the owner's explicit yes.

## Design

- `create_bounty` takes one new optional argument, `max_commits_per_account` (JSON: omit it or `null` for no cap). It
  applies to bounties created after a deploy only. There is no setter: bounties 7, 12 and every existing bounty have no
  cap and keep working exactly as today.
- A cap outside 1 to K (`max_commits`) is refused: "max_commits_per_account must be 1 to max_commits".
- Stored with the raw key pattern used for the fee pool and agent limits; the `Bounty` and `Submission` structs are
  unchanged and there is no migration:
  - `ACCOUNT_CAP:` + bounty id (u64 little endian) holds the cap (borsh u32), written once at creation;
  - `ACCOUNT_SLOTS:` + bounty id + account id holds how many of that bounty's slots the account holds now (committed and
    not released), written only for bounties with a cap and removed when it reaches 0.
- `commit`: when K is full the commit is ignored as today (null, no fee). Otherwise, on a capped bounty, an account
  that already holds its cap is refused before any fee is taken: "this account already holds max_commits_per_account
  slots of this bounty". The counted account is the committer (the account that signs, also when an agent signs with its
  limited key).
- A slot is freed exactly as K frees it: only when an unrevealed commit is released (`release_unrevealed`, or `expire`
  releasing it). A revealed or decided attempt keeps its slot, as for K.
- `get_bounty` shows `max_commits_per_account` (a new field in the JSON reply, not in the stored struct). A new view,
  `get_account_slots(bounty_id, account_id)`, gives the slots an account holds.
- Every fee path is unchanged: never-revealed fees to the pool, decided Level 2 fees to the pool at expiry, PASS and
  timeout payouts with the own fee back. (A rule sending FAIL fees to the vendor was dropped by the owner on 2026-10-26:
  it would let a vendor fill its own bounty with junk from other accounts, prove it FAIL and get the fees back.)
- The site and the agent check the cap before sending a commit (`web/js/account-ui.js`, `review`; `agent/skarbnik_agent.py`,
  `account_at_cap`, checked again right before sending), and the bounty page shows it ("Per-account cap: N of K slots per
  account", or "none"). Both only check when a bounty reports a cap, so they work with today's contract too. The feed
  carries `max_commits_per_account`.

## Tests

The 16 new unit tests are at the end of `contract/src/tests.rs` (from `setup_capped`): cap reached (refused, no fee),
the refusal message, other accounts still allowed (and K still ignores, not refuses, when full), a cap of 2, a released
commit frees the share (and its fee still goes to the pool), a revealed commit keeps its slot, no cap behaves as today
(three commits by one account, no per-account entries stored), `get_bounty` shows the cap, caps of 0 and 4 (with K = 3)
refused, a cap equal to K allowed, the cap together with agent limits (a commit refused by the fee limit takes no slot;
the cap refuses before any fee), the timeout split unchanged, the PASS payout unchanged, expire releasing an unrevealed
commit (fee to the pool, share freed), caps are per bounty. Every existing test call gained the new argument as `None`.
Results: see `contract_unit_tests.txt` in this folder.

## Review (security first)

| # | Question | Finding |
| --- | --- | --- |
| 1 | Can anyone gain money from the change? | No. The cap adds a refusal and two counters; no transfer, fee or payout path changed (tests 13 to 15 pin the payouts). A refused commit takes no fee. |
| 2 | Does it stop one person using many accounts? | No. It is per committer account. It stops one fast account from taking every slot; it does not stop sybils, and an attacker can also name one payout account from many committers. Counting by payout account too would catch the lazy case; not done (owner's choice). |
| 3 | Can a vendor use the cap against researchers? | Only at creation, in public: the cap is fixed at creation, shown by `get_bounty`, and the same for every account. A cap of 1 means one attempt in flight per account; it cannot be changed later. |
| 4 | Can counts go wrong? | The count rises only when a commit is accepted (after every check) and falls only in `release_to_pool`, the one place a slot is freed; both use saturating math and are bounded by K (at most 16). A refused or ignored commit writes nothing (a panic reverts the call). |
| 5 | Old bounties | No `ACCOUNT_CAP:` entry, so `account_cap` is none: no check, no counter writes, no change. The 119 existing tests run unchanged apart from the extra `None` argument. |
| 6 | Storage | Each capped commit stores one small entry (about 60 bytes) without a storage deposit, like agent limits (finding 12, a known limit). It is removed when the count returns to 0; counts left on a closed bounty stay (harmless, small). The attempt fee (at least above zero, 0.01 NEAR on our bounties) is far above the storage cost of one entry. |
| 7 | Key collisions | The raw keys start with `ACCOUNT_CAP:` and `ACCOUNT_SLOTS:`; the stored collections use one-byte prefixes 0 to 4 and the other raw keys are `OUTLAYER`, `PROTOCOL_POOL`, `ALLOWED_IMAGE_IDS` and `AGENT_LIMITS:`. No prefix of one is a prefix of another. |
| 8 | Client compatibility | JSON callers that omit the argument get no cap (all scripts today). `get_bounty` gains one field; the site, the feed and the agent read it as optional. |

## Risks

- A layout mistake would make stored bounties unreadable. Mitigated: no struct changed, and the deploy plan compares views
  byte for byte before and after.
- A redeploy changes the contract's code hash; EVIDENCE gets the new wasm sha256.
- The cap only counts the committer (review 2), so it is a speed bump for one account, not a sybil defence.
- The contract account's full access key still exists (hardening S14), so any deploy is a trust step.

## Deploy plan (only after the owner's yes)

1. Wait until bounty 15 has closed (it expired 2026-10-26 19:08 UTC with two revealed attempts: claim its timeout or let
   it be claimed first) and while bounty 14 has no proof in flight; no vendor proof of any bounty may be running.
2. Build: `cd contract && cargo near build non-reproducible-wasm`; record the wasm sha256.
3. Save before: `get_bounty` of 7, 12, 14 and 15, `get_protocol_pool` and `get_allowed_image_ids` into
   `docs/evidence/account_cap/before_*.json`.
4. Deploy in place without an init call (as `scripts/hardening_testnet.sh deploy` does), signed by the contract account.
5. Save the same views after and compare byte for byte (`cmp`); except for the new `max_commits_per_account: null` field
   in `get_bounty`, which is the only allowed difference, so the comparison drops that one field first. Stop and roll back
   (redeploy the old wasm `938d5456...d1b7`) if anything else differs.
6. A throwaway Level 2 bounty with `max_commits_per_account: 1` (opened with the demo's Groth16 Proof 0): one account's
   first commit accepted, its second refused with the cap message, another account's commit accepted; record the tx ids.
7. EVIDENCE: a new section with the wasm sha256, the deploy tx, the before and after comparison and the live cap test.

If the owner says no, or there is no time, the README's known limits get this line instead:
"One fast account can use every attempt slot of a bounty; a per account cap is designed but not deployed."
