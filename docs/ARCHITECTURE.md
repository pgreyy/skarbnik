# Architecture (what exists today)

This file describes only what is in the repository now. It grows as parts are built.

## Today

| Folder | What is there | Status |
| --- | --- | --- |
| `contract/` | The bounty contract: create a bounty (with the vendor's reference fix hash and Proof 0 journal hash; a bounty needs a reference fix and a passing Proof 0 before it opens), open it after two different verifiers attest Proof 0, register verifiers, credit (deposit, withdraw), commit with a rising attempt fee from credit, reveal within a reveal window, free an unrevealed slot after it (`release_unrevealed`), verdict, attest (two different verifiers), OutLayer request and callback, timeout, expire (refund and fee sweep to verifiers); the winner's own fee is refunded; Level 2 bounties opened and decided by Groth16 proofs the contract checks (`contract/src/groth16.rs`); every bounty records its level and check size; fees of never-revealed commits go to a protocol fee pool (`get_protocol_pool`); after the AI review passes (docs/AUDIT.md): window caps, every reveal leaves a full verdict window, the earliest reveal has priority, Level 2 decided fees go to the pool and undecided fees are refunded, an owner allowlist of checker image ids; after the hardening round: a silent vendor's timeout split among all revealed undecided attempts, per-account agent limits (`set_agent_limits`, raw storage keys), cheap binding checks before the pairing check; unit tests in `contract/src/tests.rs`, `contract/src/tests_level2.rs` and `contract/src/tests_level2_attempts.rs` (real attempt proofs from testnet, `groth16_attempt_vectors.rs`) | S3b to S6c. The S6c version (Level 2, fee pool) is deployed on `kintsugi-l2-cihdp.testnet`; the S13 version on `kintsugi-s13-tlryo.testnet`; the S4/S7 version stays on `bounty.kintsugi-djloo.testnet` (bounties 0 to 4 readable as evidence) |
| `web/` | `site.config.json` is the one place for the site's address (site_url), the chain it reads (network, contract, RPC addresses, explorer, transaction index) and the bounty Home section 03 shows (home_example_bounty): the site reads it through `js/config.js`, the feed and site data generators read it, and `scripts/apply_site_config.py` writes site_url into index.html, sitemap.xml, robots.txt, agent-quickstart.txt and the README. The site, in the final "Panyl" design (dark by default with a light appearance, a header toggle remembered per browser): `index.html` (shell: icon sprite with the Vinyl mark, header, footer, dialogs), `css/panyl.css` (the design's tokens, decor, components, the Home Console and Dock layout and the page rules; contrast checked by `scripts/contrast_check.mjs`), `css/site.css` (site components on the same tokens), `fonts/` (Unbounded, DM Sans, DM Mono), `js/app.js` (routes, redirects from the old routes, the toggle, the phone menu), `js/pages/` (home: seven sections; how: the interactive story; bounties; bounty: every bounty on one template, and the raw data page; evidence: Ledger with the Proof Ledger, Checker, Contract, Security Lab, Limits; judge: the same guide as JUDGE_GUIDE.md, from `data/judge.json`, made by `python3 -I scripts/gen_judge_data.py`; agents; vendors: the vendor tool's steps, preflight, measured time per proof and proving modes, static, no forms; matrix: "who sees what"), `js/status.js` (one status per bounty, the same rules as `scripts/gen_feed.py`), `js/data.js` (recorded data, titles, measured numbers and every bounty with its attempts, read once per visit), `js/ledger-core.js` (the Proof Ledger's rules, shared with `scripts/gen_ledger.mjs`), `js/wallet.js` (wallets through NEAR Connect: NEAR Connect's own list, each wallet script pinned by sha256; on testnet Meteor, Intear, Ledger, MyNearWallet until 31 October 2026, Nightly, Ethereum Wallets and NEAR CLI are shown; AddKey for an agent key), `js/account-ui.js` (wallet control, credit dialog, attempt panel, the Account page with agent keys, the limits form, the stop button, "Create an agent key" and an audit log; transaction ids from the FastNEAR transaction index), `js/agentkey.js` (an Ed25519 key pair made in the browser, never sent or stored), `js/attempt.js` (commit fingerprint, nonce, attempt record), `js/chain.js` (view calls, 6 at a time with retries, and access keys; no keys held), `vendor/near-connect.js` (bundled by `scripts/wallet-vendor/build.sh`), `vendor/wallets/manifest.json` (each wallet's official script address and its sha256 pin), `data/recorded.json` (built by `scripts/gen_site_recorded.py`), `data/bounty_meta.json` (titles and notes), `data/numbers.json` (measured numbers with their sources), `feed.json` and `code/` (built by `scripts/gen_feed.py`), `ledger.json` and `metrics.json` (`scripts/gen_ledger.mjs`), `agent-quickstart.txt`, the favicons, app icons and the 1200x630 `social.png` (`scripts/logo/build.sh`, from the Vinyl mark; every icon link carries `?v=p1`), `vercel.json` | Live at https://skarbnik.xyz (branch `ui-preview`) |
| `scripts/` | `build_all.sh` (builds everything); testnet runs: `s3_*.sh`, `s3b_*.sh`, `s4_testnet.sh`, `s7_agent.sh`, `s8_arena.sh`, `s8_chain.sh`, `s13_attacks.sh`, `ol_diag.sh` (OutLayer test jobs); `verifier_check.sh` (a Level 0 verifier's checks); `check_image_id.sh` (rebuild the checker, compare its image id with a bounty); `export_guests.sh` (copy the reproducible guest files for another machine); `demo_bounty.sh` (the demo bounty with the reproducible id); `s6b_testnet.sh` (deploy and call the Groth16 spike); `gen_groth16_vk.py` (the Groth16 constants for it and for the contract); `s6c_testnet.sh` (Level 2 on the bounty contract, attacks, self-block test); `build_verifier_wasm.sh` (build and scan the OutLayer program); `s2_measure.sh` (proof memory and time); `agent_preflight.sh` (read-only checks of a bounty before committing); `audit1_testnet.sh`, `audit1b_testnet.sh`, `hardening_testnet.sh` (audit reruns); `s18_live_bounty.sh` (the live bounty with a secret outside the repository); `watch_mem.sh` (memory guard for Groth16 runs, 500 MiB); `gen_site_recorded.py`, `gen_feed.py` (the site's data) | S0 to S13 |
| `agent/` | `skarbnik_agent.py`: the agent driven by a language model (feed, public code checked against the bounty's hashes, model, local build and public tests, commit and reveal with a limited key, attempt records, `status`); `config.toml` (chain, limits, model providers: NEAR AI Cloud by default, a stand-in for tests). Helpers: `scripts/agent_testnet.sh` (account, limited key, test bounty, vendor proof), `scripts/agent_dry_run_test.sh` | Built, tested in dry run |
| `tools/skarbnik-mcp/` | `server.py`: an MCP server (stdio, Python standard library) with the tools list_bounties, get_bounty, get_credit, commit, reveal and status; it signs through near-cli-rs with a key file limited to commit and reveal, refuses any other key, keeps nonces next to the key (mode 600), and refuses mainnet without `SKARBNIK_ALLOW_MAINNET=1` | Tested on testnet bounty 26 with an MCP client (docs/EVIDENCE.md, "The MCP server") |
| `harness/` | Build crate that compiles the zkVM guests in `harness/guest/` and `harness/check-guest/` reproducibly (inside RISC Zero's guest builder Docker image `r0.1.97.0`) and exposes their programs and image ids; with `KINTSUGI_PREBUILT_GUESTS` set it embeds guest files built elsewhere instead (for a GPU machine without Docker) | S0, S1/S2; reproducible since 2026-10-24 |
| `harness/guest/` | A zkVM guest program that reads a name and publishes "hello, <name>" | S0 hello world |
| `harness/check-guest/` | The zkVM guest that runs the patch checker on one candidate and commits the journal (hashes, seed, counts, submission id, PASS or FAIL); the secret crash input and salt stay inside. A Proof 0 mode checks the vendor's reference fix and refuses an over-long secret | S1/S2, S2b (freeing allocator), S13 (Proof 0 mode) |
| `harness/checker/` | Native patch checker (`skarbnik-check`): runs a candidate wasm patch on the crash input, the public tests, seeded fairness inputs and seeded crash variants; verdict PASS or FAIL; `proof0` with `--reference-fix` | S1, S13; runs natively and inside the zkVM guest |
| `host/` | `skarbnik-host`: `hello`, `execute` (cycles, `--profile` for the phase split), `prove` (receipt file; `--proof0`, `--submission-id`, `--seed`), `verify` (separate process check of a receipt file), `tamper` (changed copy for tests), `compress` (succinct or Groth16 receipt), `groth16-args` (the values a contract needs to check a Groth16 receipt); `--bounty <name>` (a private random salt per bounty, the default) or `--demo-salt` (the public demo salt); build features `cuda` and `cuda-prove-only` (GPU proving only, without the GPU Groth16 part) | S0 to S13 |
| `verifier/outlayer/` | `farbox-verifier`: reads a receipt and the values it must match (image id, submission id, receipt sha256) from stdin, verifies it with RISC Zero's verify-only code, prints a short JSON answer; built for wasm32-wasip1 to run on OutLayer; published at github.com/pgreyy/farbox-verifier (v0.1.0) | S4; works locally; not answered on OutLayer testnet (EVIDENCE, "OutLayer (Level 1) on testnet") |
| `verifier/groth16-near/` | Spike S6b: a NEAR contract with one method, `verify_groth16(seal, image_id, journal)`, that checks a RISC Zero Groth16 proof with NEAR's alt_bn128 host functions; its fixed values are generated into `src/vk.rs` by `scripts/gen_groth16_vk.py` | Spike on `kintsugi-g16-bkexe.testnet`; not connected to the bounty contract |
| `verifier/fuel-meter/` | Runs a wasip1 file the way OutLayer's worker does (wasmtime 28 with fuel metering) and prints instructions, peak memory and time | OutLayer diagnosis |
| `data/demo/` | Demo parser with a hidden crash (`original`), honest fix (`fixed`), demo crash input, public tests | S1 demo data |
| `data/attacks/` | 18 cheating patches, inert test data, with expected verdicts in `manifest.txt` | S1 test data |
| `data/arena/` | Arena module with 4,096 secret values and probe templates for the bit leak test | S8 |
| `docs/` | Versions, evidence, devlog, decisions, security and this file | Kept up to date each work block |

## How the pieces connect today

- `./scripts/build_all.sh` builds everything in one command.
  - Step 1: `cargo build --release` at the root builds `harness` (which compiles the guests inside Docker, so their image
    ids do not depend on the folder or the user), `host` and the checker (the workspace's `default-members`).
  - `./scripts/check_image_id.sh <contract> <bounty>` rebuilds the checker and compares its image id with the bounty's.
  - Step 2: `cargo near build non-reproducible-wasm` inside `contract/` builds the contract for the chain (WebAssembly).
  - The contract is a workspace member but is not built by a plain `cargo build`: near-sdk 5.29.1 stops a native contract
    build with a `compile_error!` and asks for `cargo near build`.
- `skarbnik-check` reads the demo files and prints a verdict; its core is pure functions (bytes in, verdict out). The same
  core runs inside the zkVM through `harness/check-guest` (crate feature `zk` adds the shared input and journal types).
- `skarbnik-host prove` sends the bounty files and the candidate into the guest, proves locally with `r0vm`, and writes a
  receipt file; `compress` shrinks it to one succinct receipt (about 225 KB); `verify` checks a receipt against the
  checker's image id in a separate process.
- On chain (S4, S7, at Level 0): the researcher commits and reveals; the contract fixes the seed and the submission id;
  the vendor proves with them and posts the verdict with the journal and receipt hashes; two different registered
  verifiers each run `scripts/verifier_check.sh` (verify the receipt, compare every journal field with the chain) and
  call `attest`; the contract then pays. The contract itself never sees the secret or checks a receipt.
- Level 1 (built, not working on testnet): `request_outlayer_check` sends the receipt to OutLayer to run
  `farbox-verifier`, and `on_outlayer_result` accepts only an answer whose echoed values match the contract's record.

## Program versions (image ids)

A receipt verifies only against the image id of the guest program that made it. The first four ids below come from plain builds, which depend on the build folder and the user's home folder and cannot be rebuilt by anyone else; the reproducible build gives the same id everywhere (EVIDENCE, "Image id"). A changed guest gets a new image id, and
older receipts keep verifying against their own id. The published `farbox-verifier` takes the image id as input, so one
file serves every version; the S13 guest did not change it (rebuilt file identical to v0.1.0).

| Image id | Program | Receipts made with it |
| --- | --- | --- |
| `2cf67c95daf4745939443d2c3772891a0e0e02d04fb0a5196cc9508e917f31fc` | `harness/guest` (hello world) | S0 (`docs/evidence/S0/`) |
| `d3f158571bbb5af7d57751350f8f5fc3baa6e5ce155199c8186849e92ff628a3` | `harness/check-guest` at `2b41cad` (bump allocator) | S1 zk and S2 proofs (`docs/evidence/S2/`) |
| `3edbc2e6a077e5193d6d63983a97553f98b669868492e2a6965dcff25985569d` | `harness/check-guest` at `8aead8c` (freeing allocator) | S2b, S4 bounty 2, S7 bounty 3 (`docs/evidence/S2b/`, `S4/`, `S7/`) |
| `043ec633f68431f51b99cacd6a460560647a15916cdd0cb58762b61f9ede7f8d` | `harness/check-guest` with the S13 Proof 0 mode, plain build on the laptop | S13 Proof 0 and bounties on `kintsugi-s13-tlryo.testnet` (`docs/evidence/S13/`) |
| `dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc` | the same checker, reproducible build (`harness/build.rs`) | demo bounty 4 on `kintsugi-s13-tlryo.testnet` and its Proof 0 (`docs/evidence/demo/`); the main demo, Level 2 bounty 7 on `kintsugi-l2-cihdp.testnet`; the S6c attempts |

## Design note: the contract checking the proof itself (Level 2, built in S6c)

This note was written before Level 2 existed; it is kept for its reasoning and numbers. Level 2 is now built: the bounty
contract checks the Groth16 proof itself (`contract/src/groth16.rs`, section "Level 2 path in the bounty contract"
below). The spike contract that first did the check on testnet is `verifier/groth16-near` (EVIDENCE S6b).

**What would be checked.** RISC Zero can shrink a receipt into a Groth16 proof: three curve points (A, B, C) on the
BN254 curve. Its verifier checks one standard Groth16 equation with five public numbers: the control root split into
two halves, the claim digest split into two halves, and the BN254 control id (`risc0-groth16` 3.0.5,
`src/verifier.rs`, `Verifier::new`; the verifying key has six fixed points `IC0` to `IC5`). The claim digest is a
tagged SHA-256 of the run's claim; for a normal successful run (`ReceiptClaim::ok`) it is built only from the image id
and the journal (`risc0-zkvm` 3.0.6, `src/claim/receipt.rs`), so the contract can compute it from the bounty's image id
and the journal the vendor posts, using NEAR's `env::sha256`.

**What NEAR offers.** near-sdk 5.29.1 exposes three BN254 host functions: `env::alt_bn128_g1_multiexp` (sum of points
times numbers), `env::alt_bn128_g1_sum` (add or subtract points) and `env::alt_bn128_pairing_check` (is a product of
pairings equal to one) (docs.rs `near_sdk::env`; nearcore `runtime/near-vm-runner/src/logic/host.rs` and
`alt_bn128.rs`). They were stabilized in nearcore 1.28.0 (nearcore CHANGELOG; PR #6824).

**Are they enough?** Yes, on paper: the five public numbers go into one multiexp with the five `IC` points, `IC0` is
added with a G1 sum (which can also negate A), and the equation becomes one pairing check over four pairs. What the
contract must add itself: the claim digest (a few SHA-256 calls), and converting RISC Zero's big-endian encoding to
NEAR's little-endian layout (nearcore `alt_bn128.rs`). Not confirmed by any source: an official statement comparing
NEAR's encoding with Ethereum's (EIP-196/197), and an official Groth16 verifier crate for NEAR.

**Gas, estimated from NEAR's configured prices** (nearcore `core/parameters/res/runtime_configs/parameters.yaml`):
pairing check 9.686 TGas plus 5.102 TGas per pair; multiexp 0.713 TGas plus 0.32 TGas per element; G1 sum 0.003 TGas
plus 0.005 TGas per element. For one proof: 9.686 + 4 x 5.102 = 30.094 TGas, plus 0.713 + 5 x 0.32 = 2.313 TGas, plus a
small G1 sum: about 32.4 TGas for the curve work, before the cost of running the contract code and reading the input.
That is well under the 1,000 TGas a transaction may attach (docs.near.org, Gas). Measured on testnet with the spike
contract `verifier/groth16-near`: 34.569 Tgas burnt per call (EVIDENCE, S6b).

**What would stay trusted.**
- RISC Zero's Groth16 trusted setup ceremony and the verifying key built from it; RISC Zero's security model lists
  "Integrity of Groth16 Trusted Setup Ceremony" as an assumption and rates the Groth16 step 99+ bits, not quantum safe
  (dev.risczero.com, security model and trusted setup ceremony pages).
- The BN254 curve itself: NEAR's NEP-488 says recent research puts BN254 below 100-bit security.
- The two fixed constants the contract would hold: RISC Zero's control root and BN254 control id
  (`risc0-zkvm` 3.0.6, `src/receipt/groth16.rs`, `Groth16ReceiptVerifierParameters`).
- The vendor, for keeping the secret and for running the proof; the contract would no longer need verifiers to say
  whether a receipt is valid, only the math.
- That the image id names the published checker: now checkable by anyone with `./scripts/check_image_id.sh`.

## Level 2 path in the bounty contract (spike S6c)

A bounty created with `level: 2` takes no verifier attestations. `open_with_groth16` opens it with a Groth16 proof of
its Proof 0, and `submit_groth16` decides a revealed attempt with a Groth16 proof of that attempt; anyone may call
them. The contract checks the proof itself (`contract/src/groth16.rs`, the check tested in spike S6b) and then checks
that the journal belongs to this bounty and this attempt. Level 0 bounties work as before; the Level 0 calls
(`post_verdict`, `attest`, `attest_proof0`, `request_outlayer_check`) refuse a Level 2 bounty, and the Level 2 calls
refuse a Level 0 bounty. `get_bounty` shows `level`, so a page can show which rule decides each bounty.

The journal the contract reads (`harness/checker/src/zk.rs`, `Journal`, committed by the guest with `env::commit` in
`harness/check-guest/src/main.rs`). RISC Zero's serializer writes each field as 32 bit little-endian words and each
byte of a 32 byte array as one word, so the journal is 195 words (780 bytes); the layout was checked by decoding the
real Proof 0 journal and comparing every field with `skarbnik-host verify` (`contract/src/tests_level2.rs`,
`journal_layout_matches_the_real_proof0`):

| Words | Field | What the contract requires |
|---|---|---|
| 0 to 31 | `candidate_hash` | attempt: the revealed patch's sha256; Proof 0: the bounty's reference fix hash |
| 32 to 63 | `original_hash` | the bounty's original program hash |
| 64 to 95 | `exploit_commitment` | the bounty's commitment to the secret |
| 96 to 127 | `corpus_hash` | the bounty's public tests hash |
| 128 to 159 | `fuzz_seed` | attempt: the seed recorded at reveal |
| 160 | `fuzz_count` | the bounty's `fuzz_count` |
| 161 | `variant_count` | the bounty's `variant_count` |
| 162 to 193 | `submission_id` | attempt: sha256 of the contract account, bounty id, index and patch hash; Proof 0: sha256 of "kintsugi-proof0-v1" followed by the reference fix hash |
| 194 | `verdict` | 1 = PASS (pays), 0 = FAIL (spends the attempt); Proof 0 must be PASS |

For Proof 0 the contract also requires the journal's sha256 to equal the `proof0_journal_hash` fixed at creation.
