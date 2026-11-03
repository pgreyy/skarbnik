# Judge guide

Check Skarbnik in five minutes.

Everything here is live on NEAR testnet, and every claim can be checked on chain. The first path needs only a browser.

The same guide is on the site: https://skarbnik.xyz/#/judge . The contract is `kintsugi-l2-cihdp.testnet` on NEAR
testnet. On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so
anyone can check them.

## Quick (5 min)

Four steps. Steps 1 to 3 need only a browser; step 4 needs a testnet wallet. Each step says what you should see, what it
shows and what it does not show, and links the chain, so you check it there and not on this page.

### 1. Open a bounty paid by proof

Open bounty 24 on the site. An AI agent fixed a private bug on a program it could not see, and the contract paid it
after checking a proof.

- Button: [Open bounty 24](https://skarbnik.xyz/#/bounties/24)
- You should see: "Proof verified" and "Private secret", a 0.1 NEAR reward, and its commit, reveal and proof under
  Transactions.
- This shows: a private repair paid by a proof the contract checked. The program (`data/smooth/`) is public; its secret
  input and reference fix are not in the repository ([docs/EVIDENCE.md](docs/EVIDENCE.md), "Bounty 24").
- Does not show: that the patch is secure beyond this checker's tests, or that nothing could have read the private
  folder (the agent ran on the same machine, as the same user).

### 2. Read its payment on the explorer

Open bounty 24's proof transaction on the NEAR explorer.

- Button: [Open the proof transaction](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR)
- You should see: one `submit_groth16` call to `kintsugi-l2-cihdp.testnet` of about 36 Tgas, and in it a transfer of
  0.11 NEAR to the agent's account `kintsugi-agent-d9410f.testnet`: the 0.1 NEAR reward plus its own 0.01 NEAR fee back.
- This shows: the contract checked the proof and paid in the same call, on chain.
- Does not show: the patch itself. It is public in the reveal,
  [`3rBVkucS…`](https://testnet.nearblocks.io/txns/3rBVkucSk1jxirbayxz7GYX1cfurgLAYoRXjiB9HmVhc).

### 3. Compare with a timeout

Open bounty 17: the same kind of task, but the vendor's proof finished after the 4 hour window.

- Button: [Open bounty 17](https://skarbnik.xyz/#/bounties/17)
- You should see: "Timeout settlement" and "Why this is not “Proof verified”", a payment by a `claim_timeout` call
  ([`BLcWs7dp…`](https://testnet.nearblocks.io/txns/BLcWs7dpWFaiDn5BmRzr4QVCVRn4zXn4LLUgpRx3e2mh)), and no
  `submit_groth16` call for its attempt.
- This shows: a silent vendor cannot block payment, and a timeout is shown as a timeout, never as a pass.
- Does not show: that bounty 17's patch passed. No proof was checked for that attempt.

### 4. Try a judge bounty yourself

Judge bounties 28 to 31 have the same hashes as bounty 17 and were created closed, so anyone can open one with a real
proof. Each can be opened once: send bounty 17's stored Proof 0 to one that is still closed (28; use 29, 30 or 31 if 28
is already open). Each judge bounty takes K = 2 attempts, at most 1 per account, with a 41 hour verdict window. Make a
testnet account from the faucet with near-cli-rs 0.30.1, then, from a clone of the repository:

    near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
    near contract call-function as-transaction kintsugi-l2-cihdp.testnet open_with_groth16 file-args docs/evidence/receipts/judge_open_28.json prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as <you>.testnet network-config testnet sign-with-legacy-keychain send

- Button: [Open bounty 28](https://skarbnik.xyz/#/bounties/28)
- Note: Needs a testnet wallet, about 2 minutes, test NEAR only.
- You should see: the return value `"opened"`, a `bounty_opened` event naming your account, and about 35 Tgas burned.
  Bounty 28's page then shows it open. Sent again, the same call is refused: "bounty is already open".
- This shows: any account can make the contract check a real Groth16 proof on chain.
- Does not show: anything about attempts. It reuses bounty 17's Proof 0.

## Verify (30 min)

What you need: Linux (on Windows, use WSL), Docker with buildx, an x86 computer, about 8 GB of free memory and about
10 GB of free disk, the Rust toolchain and RISC Zero's toolchain ([docs/VERSIONS.md](docs/VERSIONS.md)). The first
checker build downloads RISC Zero's guest builder image, 7.46 GB: it took 5 min 12 s with that download and 2 min 20 s
with the image cached ([docs/numbers.md](docs/numbers.md)).

Judges never need to run the expensive proof. A full vendor proof takes 1.5 to 4 hours on a laptop CPU and its Groth16
step needs about 7 GiB of memory; the proofs these steps check are already on chain.

### 1. Get the code

    git clone https://github.com/pgreyy/skarbnik.git && cd skarbnik

- You should see: a `skarbnik` folder with `README.md`, `contract/`, `harness/` and `scripts/`.
- This shows: the public source the checker and the contract are built from.
- Does not show: that this source is what runs on chain. Step 2 shows it for the checker; "Rebuild the contract" below
  shows it for the contract.

### 2. Rebuild the checker and compare its id

    ./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 17

- You should see: the rebuilt id, the published id and bounty 17's id on chain, all
  `dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc`, then `MATCH` on the last line.
- This shows: the checker id on chain, the only one on the contract's allowlist, is built from this source.
- Does not show: that the checker is free of bugs, or that its checks are enough.

### 3. Run the public tests

    cargo test -p kintsugi-contract

- You should see: `test result: ok. 135 passed; 0 failed`. Cargo downloads the contract's crates first, about 3 minutes.
- This shows: the contract's rules behave as the tests say, including bounty 1's two real proofs checked natively.
- Does not show: behaviour on chain (the Quick steps show that), and the tests were written by the same team.

#### Something failed?

- `check_image_id.sh` stops during the build: it needs Docker with the buildx plugin, RISC Zero's toolchain
  (cargo-risczero 3.0.6, [docs/VERSIONS.md](docs/VERSIONS.md)) and about 10 GB of free disk.
- It prints `not found` for bounty 17's id: the testnet RPC did not answer. Run it again, or name another testnet RPC
  with `RPC=<address> ./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 17`.
- `cargo test` is slow the first time: it downloads the contract's crates, about 3 minutes.
- A judge bounty answers "bounty is already open": another judge opened it first. Use 29, 30 or 31.
- The agent's dry run (B7 below) needs `agent/config.local.toml`, made by `./scripts/agent_testnet.sh setup` with a
  testnet account.

#### Rebuild the contract

Rebuild the deployed contract from its commit and compare it with the code on chain. Needs Docker and cargo-near 0.22.0;
the build image `sourcescan/cargo-near:0.22.0-rust-1.99.1` is about 0.5 GB
([docs/TRY_IT.md](docs/TRY_IT.md), step 11).

    git checkout c74bd5c820c1ce684f81e3f794a8e3e804b3d2b5
    (cd contract && cargo near build reproducible-wasm)
    sha256sum target/near/kintsugi_contract/kintsugi_contract.wasm

Expect sha256 `ecf697be619d5dc730de58853ae3daa65bff3ac1a23804a1c390663ca059421e`, whose base58 form
`Gx1JfW7GdpD7sgWf2JwvQhQzfrGy5CnMZyTW2bvFBX6u` equals the contract's code hash on chain. This shows the code running on
chain is built from the published commit `c74bd5c`. It does not show that the source is free of bugs, or that the owner
will not deploy other code later (the testnet contract keeps its full access key on purpose; every deploy is listed in
[docs/EVIDENCE.md](docs/EVIDENCE.md)).

#### Every reproduction step (B1 to B8)

Commands run from the root of a clone. What each step needs:

| Step | What it shows | Needs | Download | Memory |
| --- | --- | --- | --- | --- |
| B1 | Read bounties and the allowlist from the chain ([docs/TRY_IT.md](docs/TRY_IT.md), steps 1 to 3) | `curl`, `python3` | none | small |
| B2 | Open a closed judge bounty with a real proof from your own account (Quick step 4; docs/TRY_IT.md, step 5) | near-cli-rs 0.30.1, a testnet account from the faucet (free); about 35 Tgas of testnet gas | none | small |
| B3 | See a proof refused at the pairing check itself (docs/TRY_IT.md, step 6) | the same as B2 | none | small |
| B4 | Run the contract tests: `cargo test -p kintsugi-contract` (Verify step 3; docs/TRY_IT.md, step 8) | the Rust toolchain ([docs/VERSIONS.md](docs/VERSIONS.md)) | the contract's crates, about 3 minutes the first time | about 1.6 GB |
| B5 | Rebuild the checker and compare its image id (Verify step 2; docs/TRY_IT.md, step 9) | Docker with buildx, RISC Zero's toolchain, about 10 GB of free disk | RISC Zero's guest builder image, 7.46 GB | a few GB for the build container |
| B6 | Verify a stored proof: `cargo build --release -p skarbnik-host`, then `./target/release/skarbnik-host verify docs/evidence/receipts/bounty17_proof0_groth16.bin` (docs/TRY_IT.md, step 10) | after B5 | none more | under 1 GB |
| B7 | The agent's checks without a model key: `./scripts/agent_dry_run_test.sh` | Rust with the `wasm32-unknown-unknown` target, `agent/config.local.toml` from `./scripts/agent_testnet.sh setup` (a testnet account) | none | small |
| B8 | Verify the contract yourself ("Rebuild the contract" above; docs/TRY_IT.md, step 11) | Docker, cargo-near 0.22.0 | the build image, about 0.5 GB | about 2 GB |

- **B1.** Expect: bounty 7 is Level 2, open and opened by its Proof 0; the allowlist holds one id; the judge bounties
  show opened or closed. Shows: the chain holds what the documents say. Does not show: anything about a proof.
- **B3.** Expect: "the Groth16 proof does not verify for this bounty's image id and this journal", about 34.9 Tgas.
  Shows: a wrong seal is refused by the pairing check itself, after every cheaper check passed. Does not show: that
  every other kind of forgery is refused (the attacks tried are in [docs/SECURITY.md](docs/SECURITY.md)).
- **B6.** Expect: `VALID`, and a journal sha256 equal to bounty 17's `proof0_journal_hash` on chain. Shows: the stored
  proof verifies on your machine for the published id, and its journal is the one recorded on chain. Does not show:
  anything about the secret input or about later attempts.
- **B7.** Expect: 11 of 11 checks pass, and nothing is sent. Shows: the agent refuses a key not limited to commit and
  reveal, overspending, and a fix that reads files or the environment. Does not show: that a model writes good fixes.

Expected results are written next to each command in [docs/TRY_IT.md](docs/TRY_IT.md), with the run that produced them
in [docs/EVIDENCE.md](docs/EVIDENCE.md). No step needs real money or a mainnet wallet.

#### More browser checks

- **Find the contract.** Open https://testnet.nearblocks.io/address/kintsugi-l2-cihdp.testnet : a testnet account
  with a deployed contract and the code hash `Gx1JfW7GdpD7sgWf2JwvQhQzfrGy5CnMZyTW2bvFBX6u`, the same as on the site's
  Evidence page, Contract tab (https://skarbnik.xyz/#/evidence/contract), read live. Shows: the contract is real,
  deployed on NEAR testnet, and the site reads it. Does not show: that the code has no bugs; it has not been externally
  audited.
- **A proof pays and a proof fails on the same bounty.** Bounty 1's PASS
  [`CczggiUN…`](https://testnet.nearblocks.io/txns/CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY) and FAIL
  [`6B9ocDas…`](https://testnet.nearblocks.io/txns/6B9ocDasU1BZU28fshj6D72DkA8VCmar1ePNp9m3vtca): two `submit_groth16`
  calls of about 36 Tgas on two attempts; only the PASS pays the agent. Shows: the contract applies the verdict inside
  the proof. Does not show: that every forged proof is refused ([docs/SECURITY.md](docs/SECURITY.md#2-attacks-we-tried)).
- **Bounty 16, paid by a proof on the public demo bug.** Its proof
  [`5NH9rhRM…`](https://testnet.nearblocks.io/txns/5NH9rhRMdLxRtKBtjxAsqQwFWejtu2tU9oNf69G2yUq9), next to bounty 17's
  timeout claim (Quick step 3).
- **Compare the checker id.** Read the allowlist with any view call to `get_allowed_image_ids` (or
  [docs/TRY_IT.md](docs/TRY_IT.md), step 2): exactly one id,
  `dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc`, the image id inside bounty 24's proof (the site's
  Evidence page, Proofs tab). Shows: only this one approved checker can open or settle a new bounty, and bounty 24 was
  decided by it. Does not show: that the id is built from this source (Verify step 2 shows that) or that the checker is
  free of bugs.
- **Read what is not claimed.** https://skarbnik.xyz/#/evidence/limits or the README's "Trust assumptions" (every limit:
  [docs/CLAIMS.md](docs/CLAIMS.md), "Known limits"): fifteen limits in plain words on the site, among them no external
  audit (only AI review passes), a full access key kept on purpose on the testnet contract, and testnet only. Check the
  access key with a `view_access_key_list` call on `kintsugi-l2-cihdp.testnet`, and the live code hash against the last
  deploy in [docs/EVIDENCE.md](docs/EVIDENCE.md), "Contract code and every deploy". Does not show: that no other limits
  exist.

## Claims

Each claim, where to see it, and what it does not prove.

| Claim | See it | Does not prove |
| --- | --- | --- |
| A private bug was repaired by an AI agent and paid by proof | bounty 24 (https://skarbnik.xyz/#/bounties/24), proof and payment [`9nAK8gi2…`](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR); [docs/EVIDENCE.md](docs/EVIDENCE.md), "Bounty 24" | that the patch is secure beyond this checker's tests, or that nothing could have read the private folder |
| The contract checks the proof itself | bounty 1's PASS [`CczggiUN…`](https://testnet.nearblocks.io/txns/CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY) pays and its FAIL [`6B9ocDas…`](https://testnet.nearblocks.io/txns/6B9ocDasU1BZU28fshj6D72DkA8VCmar1ePNp9m3vtca) does not, about 36 Tgas each | that every forged proof is refused; the attacks tried are in [docs/SECURITY.md](docs/SECURITY.md) |
| The vendor side proves on its own | bounty 32 (https://skarbnik.xyz/#/bounties/32): the vendor's `watch` proved on a rented GPU and sent the proof 17 minutes after the reveal, with no one at the keyboard, [`9B7FPyju…`](https://testnet.nearblocks.io/txns/9B7FPyju4FpmwCLGfkzoccrTfbxdfhpn7EC1uu3UpM7y) | more than a few runs; bounty 32 uses the public demo program, so its fix was known |
| One attempt was proved inside sealed hardware | bounty 33 (https://skarbnik.xyz/#/bounties/33): the prove step ran in an Intel TDX confidential VM on Phala Cloud, then the contract checked the proof and paid, [`Gg81ZZgd…`](https://testnet.nearblocks.io/txns/Gg81ZZgdnjMrCFM6sZ6KuaW48e2kmKXiG2TUAp8jizmS); [docs/evidence/tee_spike/README.md](docs/evidence/tee_spike/README.md) | a managed service: it was one run, on a CPU, and sealed proving as a service is planned ([docs/CONFIDENTIAL_PROVING.md](docs/CONFIDENTIAL_PROVING.md)) |
| A timeout is never shown as a pass | bounty 17 (https://skarbnik.xyz/#/bounties/17): paid by `claim_timeout` [`BLcWs7dp…`](https://testnet.nearblocks.io/txns/BLcWs7dpWFaiDn5BmRzr4QVCVRn4zXn4LLUgpRx3e2mh), labelled "Timeout settlement" | that its patch passed; no proof was checked for that attempt |
| A wrong fix is not paid | bounty 35 (https://skarbnik.xyz/#/bounties/35): a deliberately wrong fix sent by an agent, proved FAIL, [`FPE1uRi4…`](https://testnet.nearblocks.io/txns/FPE1uRi4HE1p7iRNRfcC3qRDLCt3JbkENRELdG5b8nKp); the agent was paid nothing | that every wrong fix fails: this is one fix, sent by the team's own test agent |

#### Every claim, with its label

Each claim carries one label. **Implemented**: in the code and covered by tests. **Demonstrated**: done on testnet, with
transactions. **Experimental**: tried once, or on a different setup. **Planned**: not built. A claim with no evidence is
never shown as done.

| Claim | Label | Evidence |
| --- | --- | --- |
| An AI agent fixed a private bug on a new program it could not see, and the contract paid it by proof | Demonstrated | bounty 24, tx [`9nAK8gi2…`](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR); [docs/EVIDENCE.md](docs/EVIDENCE.md), "Bounty 24" |
| The contract checks a Groth16 proof itself and pays on PASS | Demonstrated | tx [`CczggiUN…`](https://testnet.nearblocks.io/txns/CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY); about 36 Tgas |
| Nine proof attacks are refused on chain | Demonstrated | [docs/EVIDENCE.md](docs/EVIDENCE.md), S6c; [`docs/evidence/S6c/transactions.tsv`](docs/evidence/S6c/transactions.tsv) |
| Anyone can open a judge bounty with a real proof; a wrong seal is refused at the pairing check | Demonstrated | txs [`FPuvqMBp…`](https://testnet.nearblocks.io/txns/FPuvqMBp6Kao3GB46p9FDP2hEmS59pCtiLxv4fQdeSnV) (bounty 27), [`GhjkpLgk…`](https://testnet.nearblocks.io/txns/GhjkpLgkcwUbnWA743FezQEx8WLLXxCtvA7vT9eCfWdb) (18, retired), [`5uKLepww…`](https://testnet.nearblocks.io/txns/5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj); docs/TRY_IT.md, steps 5 and 6 |
| A silent vendor does not block payment (the timeout rule, not a verdict) | Demonstrated | claims on bounties 4 and 17: [`2Ga3oSGc…`](https://testnet.nearblocks.io/txns/2Ga3oSGcrgfMdbKoLCEUK8FwGrpnqMk9ex2Kp2oj6Tiq), [`BLcWs7dp…`](https://testnet.nearblocks.io/txns/BLcWs7dpWFaiDn5BmRzr4QVCVRn4zXn4LLUgpRx3e2mh) |
| An agent's limited key can commit and reveal but cannot withdraw or change limits | Demonstrated | [docs/EVIDENCE.md](docs/EVIDENCE.md), "Site: wallet, credit and attempts on testnet" (limited agent key) |
| An agent can be set up from the site: limits, a key made in the browser and added by the wallet | Demonstrated | [`docs/evidence/web/partd_transactions.tsv`](docs/evidence/web/partd_transactions.tsv); EVIDENCE, "Site in the final design" |
| The attempt cap K limits what repeated probes learn | Demonstrated | bounty 23 (3 of 12 probe commits counted); [docs/EVIDENCE.md](docs/EVIDENCE.md), "Arena: guarded and unguarded" |
| The checker rebuilds to the image id on chain | Demonstrated | MATCH from a fresh clone: [`docs/evidence/judge/fresh_clone_2026-10-26b.txt`](docs/evidence/judge/fresh_clone_2026-10-26b.txt); B5 |
| The contract on chain is a reproducible build of a published commit | Demonstrated | code hash `Gx1JfW7G…` = the base58 sha256 of `cargo near build reproducible-wasm` at commit `c74bd5c` (two builds, the same hash); deploy tx [`83biMoi8…`](https://testnet.nearblocks.io/txns/83biMoi8vbfr2Mj9zCpTDEj93qHBZMmxjpnja4KPTrTP); [docs/EVIDENCE.md](docs/EVIDENCE.md), "Contract code and every deploy, and the reproducible build"; B8 |
| 135 contract unit tests pass | Implemented | `cargo test -p kintsugi-contract`; [`docs/evidence/account_cap/contract_unit_tests.txt`](docs/evidence/account_cap/contract_unit_tests.txt) |
| The checker gives PASS to an honest patch and FAIL to cheating patches | Implemented | `cargo test -p kintsugi-check`; [docs/EVIDENCE.md](docs/EVIDENCE.md), S1 |
| A per-account cap on attempt slots | Demonstrated | deployed 2026-10-26 (tx [`DVv7N9o1…`](https://testnet.nearblocks.io/txns/DVv7N9o1LWAAR2UJcu2vxyBAaiADECERiL7ayHG365g7)); bounty 25: a second commit by one account refused ([`docs/evidence/account_cap/deploy_summary.txt`](docs/evidence/account_cap/deploy_summary.txt)) |
| The vendor's `watch` proves revealed attempts on a rented GPU (secret in the pod's RAM only, pod always terminated) and submits with no one's help | Demonstrated | bounty 32, tx [`9B7FPyju…`](https://testnet.nearblocks.io/txns/9B7FPyju4FpmwCLGfkzoccrTfbxdfhpn7EC1uu3UpM7y), and judge bounty 27, tx [`73xzLn4v…`](https://testnet.nearblocks.io/txns/73xzLn4vmLyma5wF7qm9KY7qJoJz7ZkNJ2sAR4bTfipG); [docs/EVIDENCE.md](docs/EVIDENCE.md), "The vendor tool"; [docs/numbers.md](docs/numbers.md) |
| The Groth16 wrap on a separate Docker machine (337.73 s, 6.82 GiB peak) | Experimental | one run: [`docs/evidence/smooth/vps/groth16.log`](docs/evidence/smooth/vps/groth16.log) |
| Level 1 verification through OutLayer | Experimental | built, never answered on testnet: [docs/EVIDENCE.md](docs/EVIDENCE.md), S4/S5 |
| No upgrade key the owner controls alone (key removed, or upgrades behind a multisig or DAO with a delay) | Planned (mainnet) | the mainnet contract `skarbnik.near`; the testnet contract keeps its full access key on purpose ([docs/LIMITS.md](docs/LIMITS.md)); its live code hash and every deploy: [docs/EVIDENCE.md](docs/EVIDENCE.md), "Contract code and every deploy" |
| Unresolved bug bounties (no reference fix needed) | Planned | [docs/ROADMAP.md](docs/ROADMAP.md) |
| One attempt's prove step ran sealed in a CPU TEE (Phala Cloud, Intel TDX) after the vendor checked the attestation and a fresh nonce quote; paid by proof | Experimental | one testnet spike: bounty 33, tx [`Gg81ZZgd…`](https://testnet.nearblocks.io/txns/Gg81ZZgdnjMrCFM6sZ6KuaW48e2kmKXiG2TUAp8jizmS); [docs/evidence/tee_spike/README.md](docs/evidence/tee_spike/README.md) |
| Managed confidential proving (one shared sealed prover for many vendors; a GPU TEE) | Planned | [docs/CONFIDENTIAL_PROVING.md](docs/CONFIDENTIAL_PROVING.md); [docs/ROADMAP.md](docs/ROADMAP.md), item 1 |
| Vendor liveness bond and fallback evaluator | Planned | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Agent earnings after model and compute costs | Planned | [docs/ROADMAP.md](docs/ROADMAP.md); the Ledger's empty cost column |
| An external security audit | Not claimed | none; the contract was reviewed in AI review passes ([docs/AUDIT.md](docs/AUDIT.md)) |
| A mainnet contract | Not claimed | testnet only |

## Limits

The short list. Every limit, in plain words, is on the Evidence page.

- Testnet only. No mainnet contract exists.
- Small programs only: crash bugs in small WebAssembly modules, with a patch inside each bounty's size limit (1,024
  bytes on the open bounties).
- A working fix is needed: the vendor must already have a reference fix, and its Proof 0 must pass before the bounty
  opens.
- No external audit. The contract was reviewed in AI review passes.
- The testnet contract keeps its full access key on purpose; removing it is planned for the mainnet contract.
- Run by the team, not outside customers.

[Every limit, on the Evidence page](https://skarbnik.xyz/#/evidence/limits)
