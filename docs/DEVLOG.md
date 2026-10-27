# Development log

One dated entry per work block: what was done, the exact commands, the results, what failed, what is next.

## 2026-10-27: AGENTS.md, served at /agents.md and listed in /llms.txt; followed literally on test bounty 26

- AGENTS.md at the repository root, written to an AI agent: the feed's fields, the checks before a commit, the
  fingerprint exactly as `commit_fingerprint` in `contract/src/lib.rs`, commit and reveal with a limited key file
  (real arguments from the run), credit and fees, and what PASS, FAIL and timeout mean for payment.
  `scripts/sync_agents_md.py` copies it to `web/agents.md` (repository links become GitHub links); `web/llms.txt`
  points to it; `web/vercel.json` serves `.md` as text/markdown; the For agents page and the README link it.
- Test bounty 26 (`./scripts/agent_access_test.sh bounty`). A new throwaway account followed AGENTS.md command by
  command: commit `GKPxnpw4qpkMWG2fZXpKv7QAkHaDkuWBDaCYrNmY8vtL`, reveal `YsJj7AAkiQWjgamBGFJ7NTKaYAmLaJNXAVDwgxhLZUa`
  (an earlier reveal inside the 60 s gap was refused). Four fixes to AGENTS.md came from following it
  (docs/EVIDENCE.md, "Following AGENTS.md"). Bounty 26 is labelled a test bounty and the account seeded.

## 2026-10-27: The site's Judge guide page matches JUDGE_GUIDE.md

- `scripts/gen_judge_data.py` reads JUDGE_GUIDE.md and writes `web/data/judge.json`: the intro, the 6 Level A steps
  (Do, Expect, Verify, What this proves, What it does not prove), the 7 Level B steps (what each shows, needs, download,
  memory, and the same three lines), the notes, and the 21 claims with their labels and evidence links. It stops if
  the guide's shape changes. `web/js/pages/judge.js` now only renders that file, so the page and the guide cannot
  differ; after any edit to the guide, run the script again.
- The script found that step 1 of the guide had lost its Verify line in the previous edit; restored.
- Checked locally with a headless browser at 1440 and 390 px, light and dark, every tab: all 30 Level A fields, all 21
  Level B lines and all 21 claims (text, label and evidence) equal the guide's text; no horizontal overflow; no console
  errors.

## 2026-10-27: Bounty 24 screenshot strip, threat model and limits pages, judge guide lines, For vendors page

- README: a three image strip under the 2 minute path: bounty 24's commit and reveal on the live site, the
  `submit_groth16` receipt with the contract's log `"verdict": "PASS"`, and the 0.11 NEAR transfer to the agent, both
  on testnet.nearblocks.io; light theme, taken in a headless browser on 2026-10-26, compressed to `docs/img/` (17 to 36 KB
  each). A placeholder line for the demo video, with no link yet.
- docs/THREAT_MODEL.md (vendor, agent, agent key, the public, the owner, the prover machine) and docs/LIMITS.md (every
  limit, one line each), both summarising and linking docs/SECURITY.md; linked from the README and docs/README.md.
- JUDGE_GUIDE.md: every step of Level A and Level B now has Expect, What this proves and What it does not prove.
- Site: the Security Lab tab says which attack it covers (learning the secret through many yes or no attempts) and that
  it does not cover others. New page #/vendors (`web/js/pages/vendors.js`) from docs/VENDOR.md: who it is for and
  Proof 0 first, the six steps with their commands, the preflight checks, time and cost of one proof (laptop, rented GPU,
  and the VPS marked "Measuring" from `data/numbers.json` until its proof is in), the proving modes, every command. No
  forms and no files. Home section 05's "Explore the vendor workflow" and the footer's "For vendors" open it. Checked
  locally at 1440 and 390 px in light and dark: no horizontal overflow, no console errors.

## 2026-10-27: README restyled; licence files

- README.md rewritten to about 215 lines: badges, the Vinyl lockup (light and dark), the tagline, the opening paragraph,
  a 2 minute path, a diagram and five steps, the checks, bounty kinds, what it is built on (versions and licences from
  the Cargo manifests, the cargo registry and the font files), what we changed, evidence, honest limits, links for
  vendors and agents, run it yourself, licence. The long sections moved, unchanged apart from their links, into
  docs/TRY_IT.md (the ten steps), docs/CLAIMS.md (what is shown and built, numbers, known limits), docs/OVERVIEW.md,
  docs/ROADMAP.md and docs/AGENT.md; docs/README.md indexes every document. JUDGE_GUIDE.md and
  web/agent-quickstart.txt point to the new places.
- `web/img/vinyl-lockup-{light,dark}.svg` from `scripts/logo/lockup.mjs` (the word as outlines, so GitHub needs no
  font). Checked with GitHub's Markdown API (`gh api -X POST markdown -f mode=markdown`) in a headless browser at
  830 px, light and dark: no code block or table wider than the column. Every local link exists; all 27 outside links
  answered 200; the site routes the README links to show their content.
- LICENSE-MIT, LICENSE-APACHE (the standard text, the same as apache.org's apart from blank lines) and NOTICE: MIT OR
  Apache-2.0. THIRD_PARTY_NOTICES.md and docs/VERSIONS.md now name the current fonts and the Vinyl mark.

## 2026-10-26: Per-account cap deployed (Task 5)

- Bounties 15 and 14 closed by `claim_timeout`; `./scripts/cap_deploy.sh build before deploy after captest`: wasm
  `b863487e...1024`, deploy tx `DVv7N9o1LWAAR2UJcu2vxyBAaiADECERiL7ayHG365g7`, every saved view unchanged apart from the
  new field, live cap test on bounty 25 (a second commit by one account refused). SECURITY, the judge guide and the site's
  limits now say the cap is deployed.

## 2026-10-26: History cleanup (owner's approval)

- Removed `docs/handoff/` (private handoff notes) from every commit and replaced a local path in one test output
  (first committed in the per-account cap commit, already fixed forward) with `~`, with `git filter-branch
  --index-filter` on main and ui-preview. Messages and dates are unchanged; 30 of 114 commits got new hashes (from the
  commit that first added docs/handoff); main's commits are unchanged. Checks: `git log -- docs/handoff` is empty and
  `git grep` finds the path in no commit. Files that quoted old hashes now quote the new ones; `docs/handoff/` is ignored
  from now on.

## 2026-10-26: Bounty 24 paid by proof (PASTE-10 Task 1)

- The attempt's succinct receipt from the GPU was wrapped to Groth16 on the owner's VPS in Docker (337.73 s, container
  peak 6.82 GiB, 371 MiB of swap), verified on the laptop and submitted: `9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR`,
  PASS, bounty 24 Paid. Only the succinct receipt went to the VPS; its work folder was deleted afterwards.
- Commands: `scp` of the receipt, `skarbnik-host` and `r0vm`; on the VPS `skarbnik-host compress u0_succinct.bin
  u0_groth16.bin groth16` under `/usr/bin/time -v` with a memory log; on the laptop `skarbnik-host verify`,
  `skarbnik-host groth16-args`, `MODULE=smooth ./scripts/private_bounty.sh submit 0`; then `gen_site_recorded.py`,
  `gen_feed.py`, `gen_ledger.mjs` (9 paid fixes: 3 by proof, 6 by timeout).

## 2026-10-26: The site in the final design (Panyl), and agent setup from the site (PASTE-12, PASTE-11 part D)

- Rebuilt `web/` in the final design: one theme with a dark (default, film grain) and a light appearance, a header
  toggle remembered per browser; Unbounded, DM Sans and DM Mono self-hosted; the Vinyl mark in the header, footer and
  Home hero, and as the favicon, app icons and a 1200x630 social card (`scripts/logo/build.sh`).
- Pages: Home in seven sections (Console above 700 px, Dock at 700 px and below, deep links #mechanism to #next),
  How it works (the interactive story, the "who sees what" matrix, bounties 16 and 17 read live), Bounties (every
  bounty, a status per bounty with the feed's rules in `web/js/status.js`), every bounty page on the Bounty 17 template,
  Evidence (Ledger with the Proof Ledger, Checker, Contract read live, Security Lab with the guarded and unguarded
  recording, Limits), Judge guide, For agents, Account. Old routes redirect. Home section 03's bounty is one setting
  (`home_example_bounty` in `web/site.config.json`). Titles and measured numbers come from `web/data/bounty_meta.json`
  and `web/data/numbers.json`, each with its source; every status, amount, count and transaction from the chain or
  `web/data/recorded.json`.
- Removed: the old theme, logo, the first-visit intro, the number key shortcuts and the Private toggle (not in the final
  design).
- Account page (part D): the agent limits form and the stop button, "Create an agent key" (Ed25519 in the browser,
  shown once, offered as a key file, added by the wallet as a key limited to commit and reveal; the near-cli command
  if a wallet refuses), and the dry run command.
- Checks (details and transactions in docs/EVIDENCE.md, "Site in the final design"): every SPEC section 16 value
  measured; `node scripts/contrast_check.mjs` (rewritten for the new tokens) passes in both modes; 27 keyboard, redirect,
  motion and toggle checks pass; no broken link; no sideways scroll at 1440, 1280, 1000, 768 and 390 px; no console
  error. `./scripts/agent_dry_run_test.sh`: 11 passed. Wallet run with the NEAR CLI wallet: deposit, limits, AddKey,
  agent dry run and live commit and reveal with the browser-made key, page commit and reveal, withdraw, stop.
- Fixed on the way: the credit dialog blocked the wallet's window; chain reads now go 5 at a time with up to five
  tries; when the RPC rate-limits (HTTP 429, seen after hundreds of test loads), Bounties and Evidence show the last
  feed.json and ledger.json snapshots, labelled with their time, instead of an error.
- `python3 -I scripts/gen_site_recorded.py` (now reads `docs/evidence/web/partd_transactions.tsv`), `python3 -I
  scripts/gen_feed.py` (4 open of 25 bounties), `node scripts/gen_ledger.mjs` (8 paid fixes).
- Not run: real phones, Safari, Firefox; AddKey with wallets other than NEAR CLI.

## 2026-10-26: Per-account cap (Task 5), written and tested, not deployed

- Owner's change of plan: only the per-account cap; the rule that would have sent FAIL fees to the vendor was dropped
  (a vendor could fill its own bounty with junk from other accounts, prove it FAIL and get the fees back).
- Contract: `max_commits_per_account` at creation (1 to K, refused otherwise), raw keys `ACCOUNT_CAP:` and
  `ACCOUNT_SLOTS:`, no struct change, no migration, no setter for existing bounties, every fee path unchanged.
- Tests: 135 passed (16 new). Review and deploy plan: `docs/evidence/account_cap/PLAN.md`. Site and agent check the cap
  before a commit; agent dry run 11 of 11.

## 2026-10-26: PASTE-11 part B: data for agents, the ledger and the fees

- `web/feed.json` version 2 (`scripts/gen_feed.py`): every bounty under `bounties` with its status, kind (private, demo
  or test, judge bounty), program and module description, what a fix must do and what PASS means, patch size limit,
  reward, K and attempts used, per-account cap, fee schedule and the exact next fee, the windows and expiry, image id
  and level. `open_bounties` keeps the bounties that accept a commit now (the agent reads it). Statuses: the seven asked
  for plus two the chain needs: "Open for attempts" (an open bounty with nothing to decide) and "Waiting for Proof 0"
  (closed judge bounties). The fields are documented on the For agents page.
- Ledger: per paid fix the checker image id and what PASS means (or that a timeout is a liveness rule, not a verdict);
  an earnings table per account (attempts, gross rewards, fees spent, fees returned, proof-checked passes, timeout
  payouts, rejected by a FAIL proof, released unrevealed, and a model and compute cost column that stays empty unless
  an operator supplies it in `web/data/operator_costs.json`); a Numbers block and `web/metrics.json` from the chain:
  11 decided attempts, 4 settled by a proof (36%), 7 by the timeout rule (64%); reveal to proof on chain on the laptop:
  median 1 h 23 min, slowest 1 h 25 min (4 attempts, `web/data/provers.json`); 0 outside accounts. Fees are recomputed
  from each attempt's index (the contract zeroes the stored fee of an attempt it refunds as credit).
- The owner's personal testnet account appears in the earnings by a label only: `web/data/accounts.json` lists it by
  the sha256 of its name, so no file names it.
- "Where every fee goes": a table in docs/SECURITY.md and on the How to verify page.
- Bounty page: the next attempt's exact fee (also in yoctoNEAR) and its index, time left to expiry, and each open
  attempt's next deadline (reveal by, or proof due) with the time left.
- Checked: the Ledger at 1280 and 390 px (a scoping bug in my first version, "names is not defined", was caught by the
  check and fixed), bounty 14's Attempts tab and the How to verify page: no sideways scroll, no script errors.

## 2026-10-26: Arena recording, guarded and unguarded (Task 4)

- `scripts/arena_probe.sh`: one probe agent, 12 one-bit probes. Unguarded, simulated on this machine only (no cap, no fee,
  variant check off): 12 bits, the whole secret. Guarded, real on testnet bounty 23 (K = 3, rising fee): 12 commits sent,
  3 counted, 9 ignored at no cost, 0.045 NEAR fees and 0.0029 NEAR gas, at most 3 of 12 bits (0 learned in the run: no
  reveal). EVIDENCE, "Arena: guarded and unguarded".
- Arena page: a new first tab "Guarded vs unguarded" with both runs side by side (attempts, NEAR spent, bits learned,
  share of the secret exposed), each labelled real or simulated. README step 7 reads bounty 23 from the chain.
- Checked: the Arena page at 1280 and 390 px in dark and light (no sideways scroll, no script errors). A layout bug in my
  first version (a facts table pulled into the panel's edges by an existing rule) was fixed with a more specific rule.

## 2026-10-26: Proof Ledger (Task 3)

- New page `#/ledger` (menu key 5) and `web/ledger.json`: every account the contract has paid, each paid fix with how it
  was paid (proof or timeout) and its transaction, each vendor's on-time record (decided by a proof before the deadline,
  paid by timeout, or waiting past the deadline), and the number of distinct counterparties. No scores, no ranks, nothing
  for unpaid attempts. The page reads every bounty and attempt live from the chain; `node scripts/gen_ledger.mjs` writes
  the JSON with the same rules (`web/js/ledger-core.js`). Transaction links come from the recorded evidence files.
- Every account is labelled from `web/data/accounts.json`: team-run or seeded. All of them are today; the page says so
  at the top. Result on 2026-10-26: 9 paid fixes (2 by proof: bounties 1 and 16; 7 by timeout), 5 paid accounts, 1
  vendor, 6 distinct counterparties, 0 outside the team. Bounty 8's payout went to an account that does not exist; its
  row carries that note.
- Checked: the page at 1280 and 390 px in dark and light (no sideways scroll, no script errors), and judge bounties 18
  and 22's pages.

## 2026-10-26: Judge bounties, README for judges, vendor script for any module

- Judge bounties 18 to 22 (`scripts/judge_bounties.sh`): Level 2, the same hashes as private bounty 17, created closed;
  bounty 18 opened from a throwaway account with bounty 17's stored Groth16 Proof 0 (tx
  `GhjkpLgkcwUbnWA743FezQEx8WLLXxCtvA7vT9eCfWdb`, 35.247 Tgas); a proof with the right journal and another proof's seal
  refused at the pairing check on bounty 22 (tx `5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj`, 34.856 Tgas). EVIDENCE,
  "Judge bounties". The site labels them "Judge bounty".
- README rewritten for judges: what it is, the problem, how NEAR fits, nine "do X, see Y" steps (read the chain, the
  allowlist, which judge bounties are closed, the site, open one yourself, a refusal at the proof check, the tests, the
  optional rebuild and local verify), a numbers table, honest wording (AI review passes, Level 1 not built, paid by proof
  versus paid by timeout). The step that sent an old receipt again is gone; `docs/evidence/receipts/README.md` now leads
  with the judge receipts and keeps the old ones as history.
- Checked as written: steps 1 to 3 (exact output), 5 and 6 (`file-args` reach the contract). Not yet run from a fresh
  clone: steps 7 to 9 (builds); they wait until no proof is running.
- `scripts/private_bounty.sh` (MODULE=<name>): the private bounty steps for any program, with 24 hour verdict window
  settings, an `attempt` phase for the GPU pod and a `groth16` phase that wraps a GPU succinct receipt on the laptop.
  `scripts/unpack_bounty.sh`: the succinct limit raised from 3,600 s to 21,600 s (it stopped bounty 17's evidence proof),
  and its check phase calls `skarbnik-check` (the old name was gone since the rename).
- New program `data/smooth/` (a smoothing filter, its own bug, no hint in the source) for Task 1's private bounty; the
  secret input and reference fix are in a private folder outside the repository. Native checks: six seeds, Proof 0 PASS,
  reference fix PASS, original FAIL (`docs/evidence/smooth/native_check.txt`). Its Proof 0 is running on the laptop.

## 2026-10-26: Rename finished; checker image id unchanged; skarbnik.xyz live

- The scripts that waited for the bounty 17 proof now call `skarbnik-host` (`scripts/unpack_bounty.sh`,
  `scripts/s2_measure.sh`); the checker tool's usage line says `skarbnik-check`. Old logs and the contract's test files
  keep the old name (records).
- `cargo build --release -p skarbnik-host`: 3 min 12 s, exit 0; `./target/release/skarbnik-host verify
  target/unpack/u0.bin`: VALID, PASS. `cargo build -p kintsugi-check` (the For agents command) builds
  `target/debug/skarbnik-check`; the temporary link with that name was removed first.
- `./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 17`: rebuilt, published and on-chain image id all
  `dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc`, MATCH (`docs/evidence/check_image_id_after_rename.txt`).
  The home page shows "Check the checker yourself" again.
- skarbnik.xyz answers from Vercel; www.skarbnik.xyz and http redirect to it (308), skarbnik-near.vercel.app redirects
  to it (307). Checks on the live domain (headless browser scripts in the ignored target/ folder; output in the evidence file): 44 page views fit with no script
  errors, tab titles, every icon loads, the intro plays once and Escape skips it, the wallet list and the NEAR CLI
  wallet's form, the social preview tags and image (`docs/evidence/web/live_domain_2026-10-26.txt`).

## 2026-10-26: More wallets; JS near CLI commands; bounty 17 evidence proof

- Wallets: `./scripts/wallet-vendor/fetch_wallets.sh` now takes all 14 wallets of NEAR Connect's list (hot-dao/near-selector
  `5385297f`), pins GitHub scripts to a commit and every script by sha256; `web/js/wallet.js` drops a wallet after its end
  date (MyNearWallet, "closes 31 Oct") and marks an extension that announces itself as "installed". On testnet NEAR
  Connect shows 7: Meteor, Intear, Ledger, MyNearWallet, Nightly, Ethereum Wallets, NEAR CLI. HOT, OKX, NEAR Mobile, Trezu
  and Hana say no testnet in NEAR Connect's list; WalletConnect and Unity need a WalletConnect project the site does not set.
- Checks: `node wallettest.mjs` (list, clock moved to 2026-11-01, simulated extension) and `./scripts/wallet-vendor/pin_check.sh`
  twice; output in `docs/evidence/web/wallets_2026-10-26.txt`. Every shown wallet's script loaded (HTTP 200, pin
  matched); only NEAR CLI has been clicked through to a transaction. A changed byte is refused.
- What failed: the first test runs read the list before it opened (now waits for it); a frozen page clock broke NEAR
  Connect (now shifted instead); one GitHub lookup in the fetch script failed (now retried 3 times); MyNearWallet opened no
  window in the test browser even after allowing testnet.mynearwallet.com (cause not found); pin check run 1's tampered
  case did not open the list, run 2 showed the refusal.
- For agents page: next to each near-cli-rs step, the same step with the older JS near CLI (near-cli 4.0.13), run on
  testnet with a throwaway account: deposit `Gfih6WczKnjSTi1qVUDfKDTZxHy7FDETr7HM3YNB8GST`, limited key
  `DrFJkQR2u7azULHtmCWCtTs5zvioD5nT56ZL5vfe9YRz`, limits `3mCr6UPsoc8sjvB7VZx43kY5WFG2VbqgCa3rSX35xMVd`. NEAR Connect's
  NEAR CLI wallet writes near-cli-rs commands only.
- Bounty 17 evidence proof (not submitted): `PO2=18 ./scripts/unpack_bounty.sh prove 0` proved in 6,530.99 s (102
  segments, peak 2,406 MiB); `./target/release/kintsugi-host verify target/unpack/u0.bin`: VALID, verdict PASS, journal
  matching bounty 17 on chain. Compressing to succinct stopped at its 1 hour limit, so no Groth16; not sent to the chain.
- Next: the leftover renames that waited for this proof (scripts calling kintsugi-host), rebuild, image id check.

## 2026-10-26: Paid by timeout is never shown as proven

- A paid bounty whose winning attempt timed out (outcome TimedOut, no verdict) was paid by the timeout rule, not by a
  proof. The site now shows it with a neutral "Paid by timeout" chip and a link to the claim transaction (Bounties
  table, bounty page, Account audit log); the green "✓ Paid" chip stays only for a bounty paid by an accepted proof.
  feed.json lists these bounties under `paid_by_timeout` with their claim transaction.
- The rule found six such bounties: 4, 8, 9, 11, 13 and 17 (bounty 17: claim
  `BLcWs7dpWFaiDn5BmRzr4QVCVRn4zXn4LLUgpRx3e2mh`). Before this, 4, 8, 9, 11 and 13 were shown with the green chip.
  Bounty 8's claim (`AKU4pVTm...`, named in docs/AUDIT.md, finding 8) is now in its recorded transactions.
- README and docs/EVIDENCE.md describe bounty 17 as paid by timeout, not by a proof.

## 2026-10-26: The site works on any domain; one config for the address and the chain

- `web/site.config.json` holds site_url (https://skarbnik.xyz), network, contract, RPC addresses, explorer bases and the
  transaction index; the site reads it through `web/js/config.js` (chain.js, wallet.js, account-ui.js import from it);
  `scripts/gen_feed.py` and `scripts/gen_site_recorded.py` read it; `scripts/apply_site_config.py` writes site_url into
  the files that cannot read it at load time (index.html canonical, og:url and og:image; sitemap.xml; robots.txt;
  agent-quickstart.txt; README; ARCHITECTURE). Links inside the site are relative.
- skarbnik.xyz is not live yet: its DNS points at 2.57.91.91 (Hostinger), not at Vercel, and nothing answers there.

## 2026-10-26: Kintsugi renamed to Skarbnik where safe

- Renamed: the agent (`agent/skarbnik_agent.py`), the host program (`skarbnik-host`, built at
  `target/release/skarbnik-host`), the checker's command line tool (`skarbnik-check`, built by `cargo build -p
  kintsugi-check`), the secrets folder in the agent's config (`~/.skarbnik-secrets`; the agent falls back to
  `~/.kintsugi-secrets`, so the existing files keep working; nothing was moved or opened), the wallet build package,
  and the name in comments, scripts, docs and on the site.
- Kept: on-chain names (the testnet contract and accounts, the commit domain), everything that feeds the checker guest
  (the `kintsugi-check` package and library, `kintsugi-harness`, `KINTSUGI_PREBUILT_GUESTS`, the proof domains), the
  contract crates, the private salt folders, the browser key of saved attempts, and recorded evidence.
- A note where the testnet contract's name appears on the site and in the README: "Skarbnik was built under the working
  name Kintsugi; the testnet contract keeps that name. Mainnet: skarbnik.near." (skarbnik.near exists on mainnet.)
- Commands on the For agents page run as shown: steps 2 to 5 with a throwaway account on testnet
  (`docs/evidence/web/agents_page/`), the agent's status and dry run.

## 2026-10-26: Every icon from the S12 favicon

- There was no favicon.ico (the live site answered 404), so a browser that had cached the old favicon.svg kept showing
  the old ring. Added favicon.ico (16, 32 and 48 px PNGs inside), favicon-48.png, a 180 px apple-touch-icon, 192 and 512
  px icons with site.webmanifest, all rendered from the design's logo/favicon.svg by `scripts/logo/build.sh`. Every icon
  link and the manifest's icons carry `?v=s12`, so browsers fetch the new files instead of cached ones.
- Removed `scripts/logo/extract_s.mjs` (it made an earlier mark). The light mode primary button has a 1px #7A5200 border.

## 2026-10-26: Site rebuilt from the approved design folder (branch ui-preview)

- Built to the approved design (its README, tokens and screenshots; the design folder itself is not in the repository).
  Fonts: Space Grotesk 600 for headings, IBM Plex Sans (500 body, 600 emphasis), JetBrains Mono for facts, Fraunces
  600 only for the name. Mark "S12": the Fraunces S as a path with a gold vein; favicon from the design's favicon.
- Light and dark follow the visitor's system setting by default; a manual choice is remembered; the intro follows the
  same mode. Background: dot grid, hero glow and a light that follows the cursor. The verify strip is removed.
- Deadlines are a UTC date and time ("Oct 28, 17:10") or "Closed". Bounties keep their filter tabs and the EXPLORER
  column. The bounty page has chips by the title, square step pills, a dashed secret input strip with the site's
  secrecy sentence, and a visibility tag on every fact. The Account page is the operator panel of the design (balances,
  history, agent keys with scope, spend cap, spent, status and the stop button, an audit log by signing key), real data
  only. Phone tables scroll inside their box.
- The intro shows near_bounty.json from private bounty 17 (bounty 12's reference fix is the public demo fix, so it
  could not be shown as sealed). The design's `vendor_notes` field does not exist; `reference_fix` is shown instead.
- The "Check the checker yourself" block stays hidden until the bounty 17 proof has finished and the script has run.
- Checks: `node scripts/contrast_check.mjs` (every text pair passes in both modes); every route at 1440, 1280 and 390 px
  in both modes (no sideways scroll, no script errors); 17 behaviour checks (intro mode, first visit, replay, skip, deep
  link, reduced motion, shortcuts, typing guard, Private, theme memory, fixed footer, focus);
  `./scripts/wallet-vendor/pin_check.sh` (3 of 3 cases as expected); `./scripts/agent_dry_run_test.sh` (11 of 11).

## 2026-10-26: Site restyle, "Blueprint Terminal" (branch ui-preview)

- New look on every page, same routes and features: Dark by default (Light and System kept, the choice remembered),
  IBM Plex Sans for text, JetBrains Mono for facts, Archivo ExtraBold only for the name. Gold only for actions (primary
  button, active tab, the mark), blue for data, failure as an X chip in the text colour, dashed borders only around
  sealed things.
- The mark: the S of Archivo ExtraBold as an SVG path (`scripts/logo/extract_s.mjs`), gold outline and crack; favicon SVG,
  32 and 16 px PNG and a 512 px social image from `scripts/logo/build.sh`. The old ring logo is gone.
- Header with bracket number keys, a verify strip (the checker image id read live from the contract's allowlist, the
  contract, the last saved run of `scripts/check_image_id.sh`), shortcuts (1 to 4, ?, Esc), a fixed footer with the
  intro replay, the theme switch and a Private toggle that blurs balances and account names.
- Home: hero, the check command, four steps, "What stays private", the open bounties read live. Bounties: an explorer
  link per row (the creation transaction when the repository records it). Bounty page: a visibility tag per fact and
  sealed rows for what only the vendor holds.
- Operator panel (the Account page): balances, the account's agent keys with scope and gas allowance, spend cap, fees
  spent (fees paid back to passed attempts not counted), an audit log, and a stop button (max fee 0 through the wallet),
  tested on testnet with the NEAR CLI wallet (docs/SECURITY.md, "The site").
- Intro "Handshake": bounty 12 read live with public and sealed fields, the mark drawing itself; first visit on the
  home page only, never on a direct link, skippable, reduced motion shows the end state. One deviation from the brief:
  `vendor_notes` does not exist anywhere, so the intro shows `reference_fix` (real, vendor only) in its place.
- Found and fixed while testing: leaving a slow page before it finished could replace the next page with an error.
- Checks: `node scripts/contrast_check.mjs` (every pair passes in both themes; the light gold button edge got a darker
  border to reach 3:1); every route at 1280 and 390 px in both themes and once in mobile emulation: no sideways scroll,
  no script errors; 13 behaviour checks (intro rules, reduced motion, shortcuts, typing guard, Private, focus).

## 2026-10-25: The agent's live run on test bounty 16 (PASS, paid)

- `./scripts/agent_testnet.sh bounty` made test bounty 16; the agent ran live with NEAR AI Cloud
  (`z-ai/glm-5.3-flash`), committed and revealed the model's fix with its limited key; the vendor proved it
  (`./scripts/agent_testnet.sh prove 0`, 3,644.77 s, then succinct and Groth16) and submitted it: PASS, paid.
  Transaction ids: docs/EVIDENCE.md, "Live run on test bounty 16".
- Found: the model is a reasoning model. With a 4,000 token budget it once returned no text; one answer took 403 s.
  Fixed: empty answers and timeouts count as an unused try; budget 12,000 tokens, time limit 1,200 s.

## 2026-10-25: Live site on Vercel (branch ui-preview)

- The repository is now github.com/pgreyy/skarbnik (renamed by the owner); the git remote follows it.
- The owner's Vercel project serves `web/` with no build step from branch ui-preview: https://skarbnik-near.vercel.app .
- Fixed for the live site: `.rs` sources were served as `application/rls-services+xml`; `web/vercel.json` now sends
  them as plain text. The wallet list no longer carries Intear's own localhost and .local development addresses.
- Checked on the live domain (docs/evidence/web/live_site.txt): pages, feed and quickstart load; bounty 7 reads live
  data; NEAR CLI and Intear load their scripts from the official addresses and pass the hash check; a changed byte is
  refused; the page contacts only the site, Google Fonts and the testnet RPC.

## 2026-10-25: Agent driven by a language model, dry run (branch ui-preview)

- `agent/kintsugi_agent.py` and `agent/config.toml`: feed, preflight, limits and key checks, public code checked
  against `original_hash` and `corpus_hash`, prompt, model (NEAR AI Cloud by default, a stand-in for tests), local build
  with the program's flags, public tests with the local checker, commit and reveal with the limited key (`--live`
  only), attempt records, `status`. Standard library Python; signing through near-cli-rs `sign-with-access-key-file`.
- `scripts/gen_feed.py` now publishes the public code in `web/code/demo/` and names it per bounty in the feed.
- `./scripts/agent_testnet.sh setup`: agent account `kintsugi-agent-d9410f.testnet` with credit, limits and a limited
  key (transaction ids in docs/EVIDENCE.md).
- `./scripts/agent_dry_run_test.sh`: 9 of 9 PASS (docs/evidence/agent/dry_run_tests.txt).
- Found while building: the first default model id I wrote (`deepseek-ai/DeepSeek-V3.1`) is not on NEAR AI Cloud's
  model list; the default is now `z-ai/glm-5.3-flash`, which is (checked with `GET /v1/models`).
- Research notes on NEAR AI Cloud, Intents, the Agent Market, OutLayer and others are private (not in the repo).
- Next: the owner's NEAR AI Cloud key, then `./scripts/agent_testnet.sh bounty`, a live agent run, `prove`, `submit`.

## 2026-10-25: Wallet scripts loaded from their official addresses, pinned by sha256 (branch ui-preview)

- The copies of the Intear Wallet script (AGPL-3.0) and the NEAR CLI wallet script (no licence declared) are removed from
  `web/vendor/wallets/`. The wallet list now points at each official address (wallet.intear.tech; the NEAR CLI script
  at a fixed commit on raw.githubusercontent.com) and carries each script's sha256.
- NEAR Connect 0.11.4 has no pinning option, and a subresource integrity hash only works on a script tag, so
  `web/js/wallet.js` (`pinScripts`) checks the sha256 of the bytes before NEAR Connect may keep or run them. The
  wallet's version carries the hash, so NEAR Connect's browser cache only holds checked bytes.
- Check: `CHROME=<headless shell> ./scripts/wallet-vendor/pin_check.sh`, output `docs/evidence/web/pinned_wallets.txt`:
  NEAR CLI loaded (HTTP 200) and showed its account form; Intear loaded and, after "Web" in its chooser, opened
  https://wallet.intear.tech/connect; with one byte changed in transit the site refused to run the NEAR CLI script.
- Not rerun: the full NEAR CLI deposit, commit, reveal and withdraw run; the bytes are the same as in that run.
- Known risk: Intear has no versioned address, so a new Intear release stops Intear on this site (it is refused, not
  run) until `./scripts/wallet-vendor/fetch_wallets.sh` is run again and the new pin is committed.
- THIRD_PARTY_NOTICES.md: MIT licence text for NEAR Connect and esbuild's helpers; the two scripts listed as loaded at
  run time. README known limits: one person can use many accounts; the rising fee and the cap K bound the answers.

## 2026-10-25: Hygiene fixes (owner's decisions, branch ui-preview)

- MyNearWallet removed from the site's wallets and from web/vendor/ (retired on 31 October 2026); Intear Wallet and NEAR
  CLI remain. THIRD_PARTY_NOTICES.md lists every vendored file with source, version and licence.
- "Three independent reviewers" and similar wording replaced with "AI review passes" (docs and four test comments).
- Public-on-purpose notes next to the demo secret and salt and the arena secret; the private folders are described as
  "a private folder outside the repo" in the docs and two logs (the code still names them, because it uses them).
- The seeds in docs/evidence/*/run.env checked against the chain: all are the fairness seeds the contract recorded at
  reveal (public; not keys).
- An IP address removed from this log. The README quick check is split into a fast check and an optional full rebuild.

## 2026-10-25: Judge package (branch ui-preview)

- README rewritten for judges: pitch, a key: value block, a seven step quick check with exact commands and expected
  output, what is built (with evidence), what is not built (Level 1), known limits, Roadmap.
- Stored receipts: docs/evidence/receipts/ holds the exact arguments of the accepted PASS proof (bounty 1) and of the
  same proof sent for bounty 11 (refused), read back from the chain; both replay in unit tests; sending them again today
  is refused with "bounty is closed" (transactions recorded there).
- `scripts/check_image_id.sh` compares the rebuilt image id with the published one by itself; MATCH
  (docs/evidence/judge/check_image_id.txt). docs/numbers.md lists measured numbers only.
- Clean clone test of the quick check: all seven steps passed (docs/evidence/judge/clean_clone.txt); step 7 now names
  the 7.46 GB builder image download.

## 2026-10-25: For agents page and a limited key on this contract (branch ui-preview)

- `#/agents` is back in the navigation: six steps with exact commands (feed, faucet account, deposit, limited key,
  limits, commit and reveal), agent-quickstart.txt with Copy, a link to the Account page.
- The limited key was tested on kintsugi-l2-cihdp.testnet for the first time (S7 tested it on the older contract):
  commit and reveal accepted; another payout refused by the contract; withdrawal and a limits change rejected by the
  network (EVIDENCE, "Site: wallet, credit and attempts").

## 2026-10-25: Wallets after MyNearWallet's retirement; pages split into tabs (branch ui-preview)

- kintt.testnet (the owner's MyNearWallet testnet account): 5.999 NEAR and 3.99 NEAR of contract credit, so no funding
  was needed.
- MyNearWallet is retired on 31 October 2026 (NEAR's announcement; the notice on testnet.mynearwallet.com). The NEAR docs
  now recommend NEAR Connect. Owner's decision: Intear Wallet and NEAR CLI, MyNearWallet only as an extra until then.
  Meteor was left out: its SDK prints its session key to the browser console. The site now uses NEAR Connect 0.11.4
  (bundled, pinned) with a local wallet list and local copies of the three wallets' scripts (pinned by commit or sha256).
- Testnet run through the page with the NEAR CLI wallet and the throwaway account on new test bounty 15: deposit,
  commit, reveal, withdraw (EVIDENCE, "Site: wallet, credit and attempts"). Intear and MyNearWallet only loaded.
- Tabs: bounty page (Overview, Attempts, Transactions, Proof facts, kept in the address), Arena (Recorded run, Control,
  On testnet), Account page (Attempts, Credit activity, Bounties created). How to verify is one compact panel. The credit
  panel shows the last 10 items of Recent activity with View all. Checked at 1280 and 390 px, Light and Night: no script
  errors, nothing wider than the window (tab rows scroll sideways on a phone, as intended). Not pushed.

## 2026-10-25: Site polish round (branch ui-preview)

- Account page `#/account/<name>` replaces the agent check page: credit, agent limits, a table of the account's attempts
  (bounty, attempt, state, fee, time, commit transaction from the FastNEAR transaction index, matched by bounty and
  fingerprint), bounties it created. Every account name on the site links to it; the wallet menu has "My activity".
- Tables: key facts as a two column table with shortened hashes (Copy, Show full); attempts and transactions as tables
  (What happened, Result, Transaction, Time from the evidence step files); stacked rows on a phone.
- How to verify: six steps with their commands; the rest in "More detail".
- Each bounty shows "Contract" (explorer) and "Raw data" (`#/raw/<id>`, the live get_bounty result).
- The attempt panel says what commit and reveal do, and shows the reveal and verdict deadlines in UTC and local time,
  with plain words when close or passed.
- Checked: every page at 1280 and 390 px wide in Light and Night, with reduced motion: no script errors, nothing wider
  than the window. Not pushed.

## 2026-10-25: Test bounty 14 for trying the wallet flow by hand

- `./scripts/web_testnet.sh userbounty`: bounty 14 (K = 3, 0.1 NEAR, expires 2026-10-28 17:10 UTC), same vendor account
  and calls as test bounty 13. Bounties 13 and 14 are marked "Test bounty" on the site (list and bounty page) and in
  feed.json (`test_bounty`), from `docs/evidence/web/run.env` through `scripts/gen_site_recorded.py`. Not pushed.

## 2026-10-25: Site, wallet, credit and attempts (branch ui-preview)

- Wallet: NEAR wallet selector 10.1.4 with the MyNearWallet module, testnet only, bundled once into
  `web/vendor/near-wallet.js` by `scripts/wallet-vendor/build.sh` (exact versions in its lockfile; sha256 in
  docs/VERSIONS.md). Sign in asks for no contract key, so the page holds no key; every transaction opens the wallet.
- Header: Connect wallet, connecting, connected (account menu: copy name, view credit, disconnect), not a testnet
  account, failed with a retry; the credit chip. Credit panel: credit and wallet balance, deposit and withdraw with a
  confirm step, waiting, done or failed; "No credit yet". Bounty page: Commit, Reveal, Wait for the vendor's proof, a
  confirm sheet before the commit, checks before sending, plain result states. Agent check page (#/agent), read only.
- Testnet run with a faucet throwaway account (`scripts/web_testnet.sh`): deposit, commit (fingerprint from the page's
  code), a commit past the cap (null, nothing taken), reveal (accepted), withdraw, a commit with no credit (refused), and
  the timeout of the test bounty. EVIDENCE, "Site: wallet, credit and attempts".
- Mistakes: my own test harness showed "could not read" for credit (the panels now load credit themselves); the phone
  header overflowed (the wallet control moved to a second row); I started a testnet phase twice, the second copy sent
  nothing.

## 2026-10-25: Site, first version (read only), branch ui-preview

- Built `web/` from the Gilt Arena design handoff: Light, Night and System themes, desktop and phone layouts, Young
  Serif, Archivo and Space Mono, the gold seam strips, the PASS stamp, the canvas intro. Plain HTML, CSS and JavaScript,
  no build step. Logo: the owner's "Cracked ring", one component (`web/js/logo.js`), also the favicon.
- Screens: Home, Bounties (all 13 bounties, read live), Bounty detail (slots up to each bounty's own cap, live facts,
  recorded transactions), Arena (only the recorded S8 run), How to verify. `feed.json` (open bounties) and
  `agent-quickstart.txt`. Wallet, deposits, sending attempts, creating bounties and a proof ledger are not built and
  appear only as "Planned" on the Roadmap.
- Data: live chain values come from view calls only; every transaction id comes from an evidence file in the repository
  (`scripts/gen_site_recorded.py` names the file); the intro uses the real counts of bounty 12's Proof 0.
- Differences from the handoff: no sample data, no "Sample data" tags, no named agents, slots per bounty cap (not 8),
  no Send a fix or Create a bounty screens, only Levels 0 and 2 listed, no intro sound.
- Checked locally with a headless browser: screenshots of every screen in Light and Night, desktop and 390 px wide; a
  keyboard run (Tab order, focus ring, arrow keys on tabs); the intro (app inert while it plays, Escape skips, focus on
  the heading, once per session); reduced motion (no intro). Contrast of every colour pair used: all pass in both themes.
- Mistakes found and fixed on the way: a variable that hid a helper function (the bounty page failed), a number compared
  with a text id, word breaking that split "NEAR", a free slot counted on a closed bounty, link colours on the menu.

## 2026-10-25: Owner's decisions on the hardening round

- S7 split kept; its worst case (an honest fix may get 1/K, copiers share equally, still better than the old rule) stated
  in README, SECURITY and AUDIT. Bounty 12 kept; README, EVIDENCE and SECURITY say it proves the secret stays private, uses
  the public demo bug (anyone can submit the public `fixed.wasm`), and can pay by timeout without any proof; a new original
  module with its own bug recorded as a possible later improvement.
- Groth16 memory guard set to 500 MiB: the watcher moved into the repository (`scripts/watch_mem.sh`, it was an untracked
  copy in `target/s6/`), prints a reminder to close editor windows, and `s18_live_bounty.sh`, `audit1_testnet.sh` and
  `s6c_testnet.sh` use it with `MIN_AVAIL_MIB=500`. Check: `timeout 3 scripts/watch_mem.sh <log>` printed the reminder.
  No proof was run.

## 2026-10-25: Audit hardening round (S1, S2, S3, S6, S7, S16, S18)

- Owner's decisions: S7 split the silent-vendor timeout; the protocol pool stays locked as a storage reserve (no
  withdraw); S4 pull payments not built (known limit), S16 preflight instead; S6 agent limits; the image allowlist stays
  on as an owner power; S14 (the contract account's full access key) waits for the last step before submission.
- Contract (`contract/src/lib.rs`): `claim_timeout` splits the bounty among every revealed undecided attempt (S7);
  `set_agent_limits` / `get_agent_limits` under raw storage keys, enforced in `commit` (S6); cheap binding checks before
  the pairing check in `submit_groth16` and `open_with_groth16` (S3). `groth16::verify` delegates to `verify_with_root`
  (for a test). Stored layout unchanged.
- Tests: `contract/src/tests_level2_attempts.rs` with the two real attempt proofs of the S6c run as vectors
  (`groth16_attempt_vectors.rs`, S1) and the parser and mix-up tests (S2); S6 and S7 tests in `tests.rs`. Two existing
  tests changed meaning and were rewritten: the copy of a revealed fix now shares a silent vendor's timeout, and the
  undecided attempt's fee now comes back with its share instead of as credit.
- Mistakes in my own tests on the first run: wrong return strings ("fail" instead of "final_fail"); a damaged seal made
  by flipping one byte, which is no longer a curve point and aborts the native test run (on chain the host function
  refuses it, without our message); a PASS proof sent out of order hit the ordering rule first. All three fixed in the
  tests; no contract change.
- Scripts: `scripts/agent_preflight.sh` (S16, wired into `scripts/s7_agent.sh`), `scripts/hardening_testnet.sh`,
  `scripts/s18_live_bounty.sh`; host option `--exploit <file>`.
- Testnet: redeployed in place, then S6, S7, S3 and S16 checked (EVIDENCE, "Audit hardening round").
- Final review of the code changed since `bab84c5`: no double payment or stranded funds; findings 1 and 2 are consequences of
  the chosen S7 rule, pinned as tests and stated as known limits; finding 3 (`pending` after a PASS refund) reproduced with
  the fix taken out, fixed, redeployed (`EEckT3Y7...`). 119 unit tests pass.
- S18: a new secret outside the repository and a private salt; Proof 0 alone on the CPU (prove 3,404 s, succinct 1,021 s).
  Groth16 was stopped twice by my own memory guard (the editor holds about 3 GiB); the third try with the guard at 300 MiB
  finished in 107 s. Bounty 12 created and opened on testnet; `check_image_id.sh` MATCH.
- The S18 memory monitor I set up also stopped too early once: its end check matched the measuring script's own `exit=`
  line. The job itself was not affected.

## 2026-10-25: Contract review (AI review passes), six fixes, second review

- Froze `bab84c5`; three AI review passes (money flow; proof checking; griefing and economics) got the code and the
  design docs only. Every finding reproduced on a scratch copy of the contract or on testnet (docs/AUDIT.md).
- Fixes, one commit each with regression tests: reveals leave a full verdict window and windows are capped (`dfd04c3`);
  payout cannot be a verifier, the vendor or the contract (`c8c7566`); the earliest reveal has priority (`3377348`,
  test fix `a968fa5`); Level 2 decided fees to the pool, undecided fees refunded (`5cb277c`); owner allowlist of checker
  image ids (`affaa5a`); from the second review, a tie-break for same-block reveals and a reveal gap above zero
  (`8762144`). 94 unit tests pass. Redeployed in place on `kintsugi-l2-cihdp.testnet`; bounty 7 untouched.
- Mistakes: one commit (`3377348`) went in with a test that did not compile, because my command chain took a pipeline's
  exit code; fixed forward in `a968fa5` and the chain corrected. During the testnet rerun I misread a step's `exit=0` line
  as the end of the run and started a second script against the same bounty; its extra commit is explained in the evidence.
- Docs: docs/AUDIT.md (new), README and SECURITY corrections of the overclaims the review passes found, EVIDENCE section.

## 2026-10-25: Official Level 2 demo bounty, private salt by default

- Bounty 7 on `kintsugi-l2-cihdp.testnet`: Level 2, open for 30 days (until 2026-11-24 00:19 UTC), opened with the
  reused Groth16 Proof 0; `./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 7` prints MATCH. README "Try it" and
  EVIDENCE point at it; it is labelled a demo (public demo salt).
- `kintsugi-host`: `--bounty <name>` makes and reuses a private random salt per bounty in a private folder outside the repo
  (folder mode 700, file mode 600, never printed); `--demo-salt` keeps the public demo salt; neither flag is refused.
  Every demo script passes `--demo-salt`. Tested with `execute` (7 cases).
- The first version kept the salts inside the private secrets folder; the commit gate stopped on that folder's name in
  the code, so the salts now have their own private folder outside the repo. The tests left four test salt files in a
  private folder outside the repo; not deleted.
- SECURITY known limits: the demo salt, and the reference fix requirement (a vendor with no fix is not supported yet).
- Not changed: the README Roadmap still lists "the contract checking the proof itself" as planned; that is now built
  (S6c); left for the owner, who decides roadmap changes.

## 2026-10-24 to 25: S6c Level 2 in the bounty contract (PASS), protocol fee pool, self-block test

- Owner's design choices: Level 2 bounties take only Groth16 proofs; their revealed attempts' fees go to the vendor;
  every bounty records `fuzz_count` and `variant_count` (also checked by the Level 0 verifier script now); the demo's
  Groth16 Proof 0 reused.
- `contract/src/groth16.rs` (proof check and journal reader), `open_with_groth16`, `submit_groth16`, level gates on the
  Level 0 calls; 71 contract tests pass. Deployed to the new account `kintsugi-l2-cihdp.testnet`.
- Proofs on the laptop, alone: A1 (FAIL) 345 s + 90 s + 129 s; A0 (PASS) 3,150 s + 1,017 s + 149 s; Groth16 container
  peaks 7,325 and 6,832 MiB.
- On testnet: Level 2 bounty opened by its Groth16 Proof 0; FAIL spent, PASS paid (+0.11 NEAR); nine attacks refused;
  Level 0 bounty still opens with two attestations. 35 to 36 Tgas per proof.
- Protocol fee pool (owner's rule): one function `release_to_pool`, a view `get_protocol_pool`, no withdraw; redeployed
  in place. Self-block test: vendor side lost 0.045 NEAR fees + 0.000830 NEAR gas, pool gained exactly 0.045 NEAR.
- Mistakes: my first self-block run gave the second account too little NEAR for near-cli's cost check (no junk commit
  was sent; kept in the evidence); my expectation that bounty C's fee would reach the vendor was wrong (the timeout
  refunds it).
- Found: the Level 0 verifier check did not compare the check size; closed for new bounties.

## 2026-10-24: S6b spike: a NEAR contract checks the Groth16 proof (PASS)

- New `kintsugi-host groth16-args` writes the seal, image id, journal and RISC Zero's two fixed constants from a Groth16
  receipt; `scripts/gen_groth16_vk.py` turns RISC Zero's verifying key into NEAR's byte layout.
- New spike contract `verifier/groth16-near` (`verify_groth16`), following RISC Zero's verifier; claim digest formula
  checked against RISC Zero's (equal); `cargo test -p kintsugi-groth16-spike`: 3 passed.
- On testnet, `kintsugi-g16-bkexe.testnet`: the real receipt accepted (tx `Drcc1yqp...ZSEa`); a flipped seal bit
  (call fails, "invalid g1"), a changed journal (false) and a wrong image id (false) rejected. 34.569 Tgas per call,
  about 7% above the 32.4 TGas estimate.
- Not done: no change to the bounty contract or payouts. A flipped-bit unit test is not possible natively (the host
  error aborts near-sdk's mocked environment).

## 2026-10-24: S6 feasibility: Groth16 compression on the laptop (PASS), Level 2 design note

- RISC Zero's CPU Groth16 path needs x86 and Docker; it states no memory figure (README, Dockerfile, local-proving page,
  issue #1749 checked). Pulled `risczero/risc0-groth16-prover:v2025-04-03.1` (2.40 GB, 1,858.6 s, about 1.3 MB/s).
- `kintsugi-host compress target/demo/proof0_succinct.bin target/s6/proof0_groth16.bin groth16`, alone, under
  `scripts/s2_measure.sh` and a container memory sampler: 187.91 s, 2,057 bytes, container peak 7,061 MiB, laptop
  available memory down to 801 MiB. `kintsugi-host verify`: VALID against `dd6c5f42...`.
- Design note in docs/ARCHITECTURE.md: NEAR's three BN254 host functions are enough on paper; host-charge arithmetic
  about 32.4 TGas per proof (not measured); what stays trusted. No contract change.
- `kintsugi-host tamper` does not support Groth16 receipts; no tampered Groth16 receipt tested.

## 2026-10-24: Demo bounty with the reproducible image id (MATCH); prebuilt guests and cuda-prove-only

- Proof 0 with the reproducible build: 4,312.55 s at peak 4,724 MiB, compressed in 1,388.17 s, VALID under
  `dd6c5f42...`.
- `./scripts/demo_bounty.sh create`, `open`, `check`: bounty 4 on `kintsugi-s13-tlryo.testnet` (tx
  `EozokvC2Y6UZHMXpkHzajUdJwwdop86GhzZp2wGHitf5`), Proof 0 attested by two verifiers, expires after 30 days;
  `./scripts/check_image_id.sh kintsugi-s13-tlryo.testnet 4` prints MATCH.
- `harness/build.rs` gains a prebuilt mode (`KINTSUGI_PREBUILT_GUESTS`) and `scripts/export_guests.sh` copies the guest
  files, for a GPU machine without Docker: tested on the laptop, same ids, no guest compiled, 26.72 s.
- `host/Cargo.toml` gains `cuda-prove-only`, for GPU proving only (no GPU Groth16 part); not built here (needs CUDA).
- README gains a short Roadmap section (`9af0b12`).
- Next: owner's call.

## 2026-10-24: Image id mismatch explained; reproducible checker build made official

- Plain guest builds embed the source folder and the user's home folder: the same commit `1439e37` gave `3edbc2e6...`
  at the repo root, `e4f79e00...` in another folder, `4b1947dd...` with another home folder (`dfd48a5e...` on the pod).
- RISC Zero's reproducible build (`cargo risczero build`, Docker image `r0.1.97.0`; buildx v0.38.1 installed in the
  home folder on the owner's go) gave `24c33bc5...` for `1439e37` in every folder and home tried. The default image
  `r0.1.88.0` could not build this code (needs Rust 1.90). Docker downloads ran at about 1.5 to 2.0 MB/s.
- `harness/build.rs` now builds the guests that way: the current checker's id is `dd6c5f42...` (S13's plain id was
  `043ec633...`). New `scripts/check_image_id.sh` rebuilds and compares with a bounty: for S13 bounty 0 it says
  DIFFERENT, as expected. New bounties need a new Proof 0 with this build (not done).
- Mistakes: moving only `CARGO_HOME` was not a valid "other user" test (risc0-build removes `CARGO...` variables);
  the first alt-home reproducible run failed because Docker could not find buildx with `HOME` moved (fixed with
  `DOCKER_CONFIG`). The task took about one hour (17:13 to 18:12 UTC), most of it waiting for Docker downloads.

## 2026-10-24: GPU proof, final attempt (proof in 22.65 s, image id differs, stopped)

- All build dependencies installed in one step; built `kintsugi-host` with a pod-only feature `cuda-prove-only` (the
  circuits' cuda features, without RISC Zero's GPU Groth16 part that needs `circom-witnesscalc`): 57.10 s.
- 16 input proof on the NVIDIA L40S: 22.65 s (laptop baseline 2,814.45 s), 26 segments, PASS, peak GPU memory 9,291 MiB.
- Image id `dfd48a5e...` instead of `3edbc2e6...`, so the run stopped under the owner's rule (no verify, no compression).
  Likely cause, not verified: the guest was compiled on the pod and embeds build paths. Total use of the pod: about
  25.5 minutes (16:45:12 to 17:10:42 UTC).
- Cost (owner, from RunPod): the pod ran about 30 minutes in total; balance $10.00 to $9.52, about $0.48. Pod terminated.
- Next, if the owner wants a like for like number: a reproducible guest build (`cargo risczero build`) on both machines.

## 2026-10-24: GPU proof on a rented RunPod pod (FAIL, no proof)

- Owner rented a RunPod pod (NVIDIA L40S, 46 GB, CUDA 12.8). Setup over ssh from the laptop: check, rust, rzup and the
  code archive of `1439e37` all passed in 607 s.
- `cargo build --release -p kintsugi-host --features cuda` failed three times in `circom-witnesscalc` (pulled in by
  RISC Zero's GPU Groth16 prover): twice "Could not find `protoc`" (my script's second try repeated an unchanged setup:
  fixed, a retry now needs a changed setup), then, with `protobuf-compiler` installed on the owner's go, "Unable to find
  libclang". Stopped for good under the owner's rule; no GPU number exists. About 19 minutes of use (16:45 to 17:04 UTC).
- Next: a future rental adds `libclang-dev` and `clang` before building (in the private guide, not run).

## 2026-10-24: S13 attack pass on testnet (PASS)

- Phases run with `./scripts/s13_attacks.sh <phase>`: setup, proof0, open, commit_a, prove_a, misc, bounty_b, attack_a.
- Proof A: 3,031.98 s at peak 4,725 MiB, compressed in 1,048.19 s, VALID, PASS, bound to the on-chain submission id.
- Attacks 1, 2, 4 to 11 blocked on chain or by the verifier check; attack 3 (sub-accounts fill K) is an accepted risk:
  blocking one reveal window costs 0.045 NEAR with the test fees and more each window, and the leak stays at most K bits.
- Attack 11: the vendor's false FAIL was refused by both verifiers, and the researcher was paid by timeout (+0.51 NEAR).
- Order choice (owner): bounty A's receipt was used for attack 11, not kept for an OutLayer contract test.
- Files: docs/SECURITY.md (new), README claim row, ARCHITECTURE (image id `043ec633...`), EVIDENCE section S13.
- Next: OutLayer retry when FastFS serves our file; audit only when the owner says so.

## 2026-10-24: OutLayer second try (FastFS project) and S13 Proof 0

- Proof 0 for S13 (`./scripts/s13_attacks.sh proof0`): 4,984 s at peak 4,732 MiB, compressed in 1,274 s at peak
  1,487 MiB, VALID, verdict PASS; new image id `043ec633...7f8d`.
- With the owner's go: installed `outlayer-cli` 0.2.1, logged in with a throwaway faucet account, uploaded our verifier
  to FastFS and deployed it as an OutLayer project. Direct jobs on the real S4 receipt (`./scripts/ol_job.sh`): link,
  FastFS link and project name all got no answer (requests 5618 to 5620); OutLayer's probe answered in 14 s. The FastFS
  gateway answered HTTP 502 for every file during the test, so the FastFS result is not conclusive. No proof was spent
  on the contract path and no contract change was made. Testnet cost: 0.0136 NEAR (throwaway account) plus 0.003 NEAR
  kept by OutLayer.
- Mistake: my S13 script loaded two settings files in the wrong order and picked a vendor account that does not exist;
  the first `open` run stopped at `create_bounty` before any transaction, the order is fixed in `scripts/s13_attacks.sh`.
- S13 `open` and `commit_a` phases ran; proof A is running.
- Next: retry the project job when FastFS serves our file; S13 attack phases after proof A.

## 2026-10-24: OutLayer (Level 1) diagnosis on testnet (one hour cap)

- Ran OutLayer's documented call (Project source, 10 M instructions, 128 MB, 60 s, 0.1 NEAR) against their public test
  project `connectors.outlayer.testnet/connector-probe`: answered in 13 s. So testnet workers work.
- Changed one thing at a time with `./scripts/ol_diag.sh` (requests 5610 to 5615 plus a control): the probe file by link
  (FastFS, wasip1 or wasip2) is answered, because OutLayer has it cached; our verifier from raw GitHub or jsDelivr, and a
  file from OutLayer's own GitHub repo, are never answered. Worker counters on OutLayer's public worker list do not move
  for those jobs, and do move for the control.
- Measured our verifier with wasmtime 28.0.1 fuel metering (`verifier/fuel-meter`, new): 878,730,118 instructions, 3.4 MB,
  71 ms on the real receipt. Limits and deposit were not the cause.
- Result: the cause is inside OutLayer (a job whose program must be downloaded first never reaches a worker). Level 1 stays
  "not confirmed on testnet"; Level 0 remains the working path. A ready-to-send question for OutLayer is drafted for the
  owner; nothing was sent. Details: EVIDENCE, "OutLayer (Level 1) on testnet".
- Mistake: my first worker counter readout had a quoting error, so the counters during e6 were read again right after.
- Next: S13 testnet phases.

## 2026-10-24: S4 end to end on testnet (OutLayer did not answer)

- Real proof for bounty 2 with the on-chain seed and submission id: 2,876 s, compressed to 224,786 bytes in 921 s; the
  vendor posted PASS with its journal and receipt hashes.
- `request_outlayer_check` reached OutLayer (request 5607) but the yield timed out after 201 blocks (119 s): "Execution
  promise failed". A tiny direct job to `outlayer.testnet` with the same program timed out the same way. Two failures, so
  moved on; the cause is unconfirmed. Our callback recorded nothing, as designed.
- S5 refusals on chain: private callback called by a stranger, vendor registered as verifier.
- Fallback Level 0: two verifier accounts checked the real receipt against the chain (11 checks pass) and attested;
  bounty 2 finalized PASS and researcher 1 was paid 0.5 NEAR.

## 2026-10-24: S8 arena (PASS)

- Arena module with 4,096 crashing values; the vendor's secret is which one is committed. Scripted probe agent, K = 3,
  binary search: 3 bits learned, never above the budget; secret revealed after the game, commitment and log consistent.
- With the crash-variant check on, every partial-fix probe FAILs, so the agent learns 0 bits.
- On testnet, the fourth probe commit on an arena bounty with `max_commits` 3 was ignored at no cost.
- Verdicts from the native checker, not proofs (labelled). First build failed: the no_std modules needed a panic handler.

## 2026-10-24: S7 scripted agent with a function call key (PASS, scripted fallback)

- Fallback, labelled: scripted agent, canned patch; no language model (needs a NEAR AI Cloud account from the owner).
- The agent key (methods `commit`, `reveal` on the bounty contract) committed and revealed on bounty 3 and paid the fee from
  credit. Every forbidden attempt was refused: by near-cli-rs before sending, and for a method outside the list and for a
  transfer also by the RPC node (`MethodNameMismatch`, `RequiresFullAccess`).
- Caught before commit: the first run wrote the agent key file's local path into `docs/evidence/S7/run.env`. Moved to an
  ignored file; the evidence is clean.
- The agent's submission: proved (2,996 s) and compressed (922 s); verifiers ran `scripts/verifier_check.sh` (11 of 11)
  and attested; outcome Passed, the owner +0.5 NEAR. S7 PASS as the scripted fallback.

## 2026-10-24: S4/S5 OutLayer as verifier 1 (in progress)

- Contract: `set_outlayer`, `request_outlayer_check`, private callback `on_outlayer_result`, `get_submission_id`; 48 unit
  tests pass. One test first failed because calling a callback directly in a unit test skips the `#[private]` entry check;
  the method now checks its caller itself.
- Verifier program `verifier/outlayer` (`farbox-verifier`), native tests correct on the 16 input receipt; wasm32-wasip1 build
  1,134,249 bytes, strings scan clean. Installed the wasm32-wasip1 Rust target (owner approved).
- Host: `compress`, `--submission-id`, `cuda` feature. GPU test plan written (private notes).
- Compressed the 16 input receipt to one succinct proof on the laptop: 944.27 s, r0vm peak 1,484 MiB, 224,786 bytes,
  verified in 0.027 s; the native verifier gives `ok: true` on it.
- Waiting: the owner's go to publish the verifier wasm in a separate public repository.

## 2026-10-24: S2b cutting the proving cost

- Added a cycle profile to the guest (`--profile`): 74 to 77% of the guest's cycles are interpreter setup per input, mostly
  wasmi zero-filling each new instance's 128 KiB memory. The module was already compiled once per check.
- Switched the guest to RISC Zero's freeing allocator (`heap-embedded-alloc`). Padded cycles (the work a proof must cover)
  fell 42 to 46% at 16, 64 and 128 inputs; e.g. 20,185,088 to 11,010,048 at 16 inputs and 32 variants.
- Verdicts unchanged for all 20 corpus modules, native and in the zkVM; checker tests 16 passed.
- Confirming laptop proof at 16 inputs and 32 variants: 2,814.45 s (46.9 min) instead of 5,124.96 s (85.4 min), 27 segments
  instead of 43, receipt 7.2 MB instead of 11.5 MB, verified in a separate process (VALID).

## 2026-10-24: S3b attempt fees and credit (PASS)

- Contract: `deposit_credit`, `withdraw_credit` (1 yoctoNEAR), `get_credit`; rising attempt fee per commit from credit;
  fees sent to the verifiers by `expire`. 39 unit tests pass. Wasm 243,866 bytes.
- Moved to its own account `bounty.kintsugi-djloo.testnet` (3 NEAR from the main account). Six test accounts from the
  testnet faucet. `scripts/s3b_setup.sh`, `scripts/s3b_testnet.sh`.
- Testnet run: fees 0.01 and 0.015 NEAR taken from credit, commit without credit refused, PASS paid 0.5 NEAR, empty bounty
  refunded 0.5 NEAR, 0.025 NEAR of fees split across three verifiers, credit withdrawn, second expire refused.
- Failure on the way: setup stopped with exit 141 (broken pipe in the random suffix line under pipefail); fixed and re-run.
- Found and fixed: the NEAR CLI prints its settings file path, which put a home folder path into one evidence file. All S3b
  evidence was filtered, and `scripts/s3_lib.sh` now replaces home folder paths with `~` before saving.

## 2026-10-23 to 24: S2 proving cost, S1 inside the zkVM (S1 PASS, S2 measured)

- Pushed S0, S1 and S3 to the private repository after an audit of the full history (no keys, paths, emails or
  attribution; repository still private).
- New zkVM guest `harness/check-guest` runs the same checker (`kintsugi-check`, feature `zk`) and commits a journal:
  candidate hash, original hash, exploit commitment sha256(salt || exploit), corpus hash, seed, counts, submission id and
  PASS or FAIL. Host commands `execute`, `prove`, `verify`, `tamper` (host/src/main.rs).
- Cycle counts without proving (`kintsugi-host execute`): 7,845,739 / 14,306,190 / 22,788,162 user cycles for 16 / 64 / 128
  fairness inputs (19 / 35 / 56 segments of 2^20 cycles).
- **Failure: the first proof did not fit in memory.** `prove ... --fuzz-count 16` with RISC Zero's default segment size
  (2^20 cycles) took the r0vm prover to 8,600 MiB resident memory (sampled), with only 423 to 884 MiB left available and
  3 GiB of swap in use. It was stopped by us after 180 s to protect other services on the machine. `/usr/bin/time` showed
  only 13 MB because it does not see the r0vm process; memory is now read from r0vm's own peak (VmHWM) by
  `scripts/s2_measure.sh`, which also stops r0vm if it passes 6 GiB or available memory falls under 1.5 GiB.
- Fix being tried: smaller segments with `--po2 19` (43 segments at 16 inputs) and `--po2 18` (104 segments).
- 16 inputs at `--po2 19`: proved in 5,124.96 s (85 min), r0vm peak 4,718 MiB, composite receipt 11,516,294 bytes,
  verdict PASS. Verified in a separate process (1.63 s, exit 0). Changing the verdict in the journal, or one bit of the seal,
  makes verification fail (exit 1). This finishes S1's zkVM part.
- Our mistake: we edited `scripts/s2_measure.sh` while it was running the 16 input proof; bash reads scripts as it goes, so
  the script's final lines (exit code, wall time, final memory peak) were lost. The proof itself and the host output are
  fine. Rule for ourselves: never edit a script that is running.
- 64 inputs started at 23:56 UTC with a 3 hour cap and finished: 7,993.49 s (133 min), 77 segments, r0vm peak 4,730 MiB,
  composite receipt 20,642,762 bytes, verdict PASS, verified in a separate process in 2.86 s.
- 128 inputs started at 02:10 UTC with a 4 hour cap and finished: 12,664.94 s (211 min), 123 segments, r0vm peak
  4,748 MiB, composite receipt 32,926,822 bytes, verdict PASS, verified in a separate process in 4.75 s.
- S2 verdict: FAIL against "under about 15 minutes". Executor breakdown: about 60,000 to 67,000 cycles per module run,
  almost all spent creating a fresh interpreter per input. Proposals in docs/EVIDENCE.md (reuse the loaded module per
  input; 16 fairness inputs and 8 variants; W of at least about 4.3 hours at K = 3 on this machine).

## 2026-10-23: S1 harness and S3 contract (both PASS)

- S0 committed as `2962c48` ("S0: workspace, hello contract on testnet, hello proof").
- S1 (harness outside the zkVM, cheating patches) and S3 (bounty contract on testnet) built in parallel. Heavy builds are
  serialized with `flock target/.heavy-build.lock`, so only one cargo build runs at a time. No RISC Zero proving in this block.

### S1 (native checker): PASS, with one finding

- Built `harness/checker/` (crate `kintsugi-check`, wasmi 2.0.0): validate, crash input, public tests, 64 seeded fairness
  inputs and 32 seeded variants of the crash input; verdict PASS or FAIL only. CLI commands `check`, `proof0`, `run`, `table`.
- Demo program `data/demo/original.rs` (a record parser with an off by one length check that traps), honest fix
  `data/demo/fixed.rs`, 18 cheating patches in `data/attacks/` (inert test data), built to wasm with
  `harness/checker/build_modules.sh` (plain rustc, no downloads; 556 byte modules).
- `cargo test -p kintsugi-check --offline`: 16 passed. Table: honest fix PASS, 19 of 20 as expected.
- Finding: `memory_grow` PASSes. Its memory request is refused by its own declared maximum, so it never gets extra memory;
  the expectation was wrong. Kept in the table.
- What failed on the way: the first parser build was 3,282 bytes because of Rust's bounds check panic code (replaced by a
  small trap helper); an offline build needed one online index lookup first; one test was wrong about which step catches
  `memorize_tests` and was corrected to match the checker.
- Not done: the zkVM part of S1 (receipt, journal, tampered receipt check). Limits (2,048 bytes, 50,000 fuel, 64 fairness
  inputs, 32 variants) are first choices to revisit in S2.
- Committed as `d150da2`.

### S3 (bounty contract on testnet): PASS

- Replaced the hello world contract with the smallest bounty contract (create, register verifier, commit, reveal, verdict,
  attest with two different verifiers, timeout, expire). 30 unit tests pass. near-sdk's `unit-testing` feature pulls in
  aws-lc-sys; it built with gcc, no cmake needed.
- Deployed to `kintsugi-djloo.testnet` with `#[init(ignore_state)]` (the account still held the hello world state). Wasm
  228,358 bytes; its code locks about 2.3 NEAR of storage on the account.
- Testnet: happy path paid 0.5 NEAR on the second verifier's attestation; silent vendor path paid 0.5 NEAR by
  `claim_timeout`; expiry refunded the vendor 0.5 NEAR; early and late calls were refused on chain. 500 and 1,000 TGas
  were accepted on one call. Block time median 0.591 s; finality 2 blocks, about 1.16 s.
- What failed on the way: run 1 stopped because near-cli-rs prints no transaction id for a refused call (now sent over RPC);
  run 2 ran the vendor out of testnet NEAR (topped up 1 NEAR). Details in docs/EVIDENCE.md.
- Left out for now: Proof 0 attestations, attempt fees and credit (so the K commit slots can be filled with junk commits),
  a reveal deadline, vendor storage deposits.

### Next

- S2: proving time and memory for the harness inside the zkVM (this also completes S1's zkVM part).
- Add attempt fees or credit to the contract before any demo, so commit slots cannot be filled for free.

## 2026-10-23: S0 setup (PASS)

### Done

- Repository layout created: `contract/`, `harness/` (with `harness/guest/`), `host/`, `web/`, `data/`, `docs/`, and a Rust
  workspace at the root (`Cargo.toml`).
- Hello world NEAR contract (`contract/src/lib.rs`), hello world zkVM guest (`harness/guest/src/main.rs`) and host
  (`host/src/main.rs`). The RISC Zero parts follow the `cargo risczero new` template at tag v3.0.6; the contract settings
  follow the `cargo near new` template from cargo-near 0.22.0.
- `docs/VERSIONS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/EVIDENCE.md` started.

### Problem: the first workspace build looked hung

- Command: `cargo build --release` (repository root).
- What happened: the log stopped at `Downloaded secp256k1-sys v0.8.2` and showed no new line for about 31 minutes. It was
  stopped after 1,896 s (`wall_seconds=1896.50`, exit 143 = stopped by signal 15).
- Cause, measured:
  - IPv6 to the crate download server does not connect at all:
    `curl -6 https://static.crates.io/...` failed in 0.58 s ("Could not connect to server").
  - IPv4 works but is very slow: `curl -4` received 746,671 bytes of a 2,508,613 byte crate in 40 s, about 18 KB/s.
  - While `cargo fetch` ran, `ss -tinp` showed its two connections to a download server receiving about 18 KB/s each
    (bytes_received rose from 268,600 to 1,704,969 in 75 s on one connection). So cargo was downloading, slowly, not hung.
    A large crate takes many minutes at this speed and cargo prints nothing until each file is complete.
- Fixes tried:
  1. Settings for this shell only: `CARGO_HTTP_MULTIPLEXING=false CARGO_HTTP_TIMEOUT=60 CARGO_NET_RETRY=10`.
  2. Also `CARGO_NET_GIT_FETCH_WITH_CLI=true`.
  - Attempts 1 to 3 were stopped by our own stall watchdog after 210 s each. That watchdog was wrong: it measured CPU time,
    then file read counters, and neither shows a slow network download. Our mistake, not a cargo failure.
  - Attempt 4 runs with all four settings and no automatic stop; progress is measured as bytes received on cargo's sockets
    (`ss -tinp`) once a minute. About 1 MB per minute received at the first checks.
- Lesson written into the project rules: measure download progress by socket bytes, not CPU or log lines.
- Attempt 4 was stopped on purpose after about 6 minutes (5.5 MB received). The remaining downloads included `aws-lc-sys`, a
  large C crypto library that needs `cmake` (not installed). It came in only through RISC Zero's default `bonsai` feature, the
  client for a remote proving service. We do not want that path at all: whoever proves sees the private input, and the
  vendor's secret must stay on the vendor's machine. `host/Cargo.toml` now uses
  `risc0-zkvm = { version = "=3.0.6", default-features = false, features = ["client"] }`, which proves through the local
  `r0vm`. Attempt 5 started with that change.
- Attempt 5 finished downloading (about 9.5 MB received in 10 minutes) and compiled 218 crates, then failed (exit 101,
  652 s) on a deliberate check in near-sdk 5.29.1: `compile_error!` "Use `cargo near build` instead of `cargo build` to
  compile your contract". A NEAR contract cannot be built natively with plain `cargo build`.
- Fix: the root `Cargo.toml` sets `default-members = ["harness", "host"]`, and `scripts/build_all.sh` is the one command
  that builds everything (`cargo build --release`, then `cargo near build non-reproducible-wasm` in `contract/`).

### S0 checks (details and outputs in docs/EVIDENCE.md)

- (a) `./scripts/build_all.sh`: PASS, exit 0, 25.03 s with crates cached (first run 456.13 s including downloads).
- (b) Contract deployed to `kintsugi-djloo.testnet` (tx `6nNNsGGHEVBbAJmAyU8TGEd7tfC8fEnYSxx3uoG5SVJj`), greeting read, set
  (tx `4xrdsVRocd8iEWmULFRAAHPgnPkZRZb9iDgcVm4kJby6`) and read back: PASS.
- (c) `RISC0_DEV_MODE=0 ./target/release/kintsugi-host kintsugi`: proof generated in 5.03 s and verified in 0.030 s: PASS.

### Next

- S1: the real harness (wasmi inside the guest, PASS or FAIL journal, fairness check, attack corpus).
