# Judge guide

Check Skarbnik yourself: do something, expect a result, verify it against the chain, not against this page. Level A
needs only a browser (5 to 10 minutes, no install). Level B is optional and reproduces things on your machine. The same
guide is on the site: https://skarbnik.xyz/#/judge

Everything runs on NEAR testnet, contract `kintsugi-l2-cihdp.testnet`. On private bounties, researchers and the public
never see the secret input. Demo bounties use a public input so anyone can check them.

## Level A: evidence tour (5 to 10 minutes, no install)

Each step: **Do**, **Expect**, **Verify**. Transaction links open the testnet explorer.

1. **Find the contract** (1 min)
   - Do: open https://testnet.nearblocks.io/address/kintsugi-l2-cihdp.testnet
   - Expect: a testnet account with a deployed contract and a code hash.
   - Verify: the code hash equals the one the site reads live on https://skarbnik.xyz/#/evidence/contract

2. **See an AI agent fix a private bug and get paid by proof: bounty 24** (2 min)
   - Do: open its three calls in order: commit
     [`4G48c6wa…`](https://testnet.nearblocks.io/txns/4G48c6waZdz7Qc3maVdXsXx9u3kwzfDWbXhW2toszvkG), reveal
     [`3rBVkucS…`](https://testnet.nearblocks.io/txns/3rBVkucSk1jxirbayxz7GYX1cfurgLAYoRXjiB9HmVhc), proof
     [`9nAK8gi2…`](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR).
   - Expect: a commit holding only a fingerprint, a reveal that publishes the patch, then a `submit_groth16` call that
     pays 0.11 NEAR (the 0.1 NEAR reward and the agent's own 0.01 NEAR fee back).
   - Verify: https://skarbnik.xyz/#/bounties/24 shows "Proof verified" and "Private secret"; the program
     (`data/smooth/`) is public, its secret input and reference fix are not in the repository
     ([docs/EVIDENCE.md](docs/EVIDENCE.md), "Bounty 24", including how it was checked that the agent could not see the
     reference fix).

3. **Compare with bounties 16 and 17** (2 min)
   - Do: open bounty 16's proof
     [`5NH9rhRM…`](https://testnet.nearblocks.io/txns/5NH9rhRMdLxRtKBtjxAsqQwFWejtu2tU9oNf69G2yUq9) and bounty 17's
     claim [`BLcWs7dp…`](https://testnet.nearblocks.io/txns/BLcWs7dpWFaiDn5BmRzr4QVCVRn4zXn4LLUgpRx3e2mh).
   - Expect: bounty 16 paid by a proof on the public demo bug; bounty 17 paid by `claim_timeout`, with no
     `submit_groth16` for its attempt.
   - Verify: https://skarbnik.xyz/#/bounties/17 says "Timeout settlement" and "Why this is not “Proof verified”": the
     laptop proof was too slow for the 4 hour window. Bounty 24 was the same kind of task, proven on a GPU instead.

4. **See a proof pay and a proof fail on the same bounty** (2 min)
   - Do: open bounty 1's PASS
     [`CczggiUN…`](https://testnet.nearblocks.io/txns/CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY) and FAIL
     [`6B9ocDas…`](https://testnet.nearblocks.io/txns/6B9ocDasU1BZU28fshj6D72DkA8VCmar1ePNp9m3vtca).
   - Expect: two `submit_groth16` calls of about 36 Tgas; only the PASS moves NEAR.
   - Verify: they are different attempts on the same bounty.

5. **Compare the checker id** (1 min)
   - Do: read the allowlist with any view call to `get_allowed_image_ids` (or [README](README.md), "Try it", step 2).
   - Expect: exactly one id, `dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc`.
   - Verify: it equals the image id inside bounty 24's proof (the site's Checker tab; Level B rebuilds it from source).

6. **Read what is not claimed** (1 min)
   - Do: open https://skarbnik.xyz/#/evidence/limits or the README's "Known limits".
   - Expect: plain limits, among them: no external audit (only AI review passes), a full access key still on the
     contract account, testnet only.
   - Verify: the access key with a `view_access_key_list` call on `kintsugi-l2-cihdp.testnet`.

## Level B: reproduce (optional)

Commands run from the root of a clone of the repository. What each step needs:

| Step | What it shows | Needs | Download | Memory |
| --- | --- | --- | --- | --- |
| B1 | Read bounties and the allowlist from the chain ([README](README.md), "Try it", steps 1 to 3) | `curl`, `python3` | none | small |
| B2 | Open a closed judge bounty with a real proof from your own account (README step 5) | near-cli-rs 0.30.1, a testnet account from the faucet (free); about 35 Tgas of testnet gas | none | small |
| B3 | See a proof refused at the pairing check itself (README step 6) | the same as B2 | none | small |
| B4 | Run the contract tests: `cargo test -p kintsugi-contract` (README step 8) | the Rust toolchain ([docs/VERSIONS.md](docs/VERSIONS.md)) | the contract's crates, about 3 minutes the first time | about 1.6 GB |
| B5 | Rebuild the checker and compare its image id: `./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 17` (README step 9) | Docker with buildx, RISC Zero's toolchain, about 10 GB of free disk | RISC Zero's guest builder image, 7.46 GB | a few GB for the build container |
| B6 | Verify a stored proof: `cargo build --release -p skarbnik-host`, then `./target/release/skarbnik-host verify docs/evidence/receipts/bounty17_proof0_groth16.bin` (README step 10) | after B5 | none more | under 1 GB |
| B7 | The agent's checks without a model key: `./scripts/agent_dry_run_test.sh` | Rust with the `wasm32-unknown-unknown` target, `agent/config.local.toml` from `./scripts/agent_testnet.sh setup` (a testnet account) | none | small |

Expected results are written next to each command in the README ("Try it"), with the run that produced them in
[docs/EVIDENCE.md](docs/EVIDENCE.md). No step needs real money or a mainnet wallet.

Do not start a full vendor proof as part of a review: one attempt takes 1.5 to 4 hours on a laptop CPU, and the
Groth16 step needs about 7 GiB of memory ([docs/numbers.md](docs/numbers.md)).

## Claims and their evidence

Each claim carries one label. **Implemented**: in the code and covered by tests. **Demonstrated**: done on testnet,
with transactions. **Experimental**: tried once, or on a different setup. **Planned**: not built. A claim with no
evidence is never shown as done.

| Claim | Label | Evidence |
| --- | --- | --- |
| An AI agent fixed a private bug on a new program it could not see, and the contract paid it by proof | Demonstrated | bounty 24, tx [`9nAK8gi2…`](https://testnet.nearblocks.io/txns/9nAK8gi2LxqbfjKupbG8mvADnzArwaG7AaKBWPvmgweR); [docs/EVIDENCE.md](docs/EVIDENCE.md), "Bounty 24" |
| The contract checks a Groth16 proof itself and pays on PASS | Demonstrated | tx [`CczggiUN…`](https://testnet.nearblocks.io/txns/CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY); about 36 Tgas |
| Nine proof attacks are refused on chain | Demonstrated | [docs/EVIDENCE.md](docs/EVIDENCE.md), S6c; [`docs/evidence/S6c/transactions.tsv`](docs/evidence/S6c/transactions.tsv) |
| Anyone can open a judge bounty with a real proof; a wrong seal is refused at the pairing check | Demonstrated | txs [`GhjkpLgk…`](https://testnet.nearblocks.io/txns/GhjkpLgkcwUbnWA743FezQEx8WLLXxCtvA7vT9eCfWdb), [`5uKLepww…`](https://testnet.nearblocks.io/txns/5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj); README steps 5 and 6 |
| A silent vendor does not block payment (the timeout rule, not a verdict) | Demonstrated | claims on bounties 4 and 17: [`2Ga3oSGc…`](https://testnet.nearblocks.io/txns/2Ga3oSGcrgfMdbKoLCEUK8FwGrpnqMk9ex2Kp2oj6Tiq), [`BLcWs7dp…`](https://testnet.nearblocks.io/txns/BLcWs7dpWFaiDn5BmRzr4QVCVRn4zXn4LLUgpRx3e2mh) |
| An agent's limited key can commit and reveal but cannot withdraw or change limits | Demonstrated | [docs/EVIDENCE.md](docs/EVIDENCE.md), "Site: wallet, credit and attempts on testnet" (limited agent key) |
| An agent can be set up from the site: limits, a key made in the browser and added by the wallet | Demonstrated | [`docs/evidence/web/partd_transactions.tsv`](docs/evidence/web/partd_transactions.tsv); EVIDENCE, "Site in the final design" |
| The attempt cap K limits what repeated probes learn | Demonstrated | bounty 23 (3 of 12 probe commits counted); [docs/EVIDENCE.md](docs/EVIDENCE.md), "Arena: guarded and unguarded" |
| The checker rebuilds to the image id on chain | Demonstrated | MATCH from a fresh clone: [`docs/evidence/judge/fresh_clone_2026-10-26b.txt`](docs/evidence/judge/fresh_clone_2026-10-26b.txt); B5 |
| 135 contract unit tests pass | Implemented | `cargo test -p kintsugi-contract`; [`docs/evidence/account_cap/contract_unit_tests.txt`](docs/evidence/account_cap/contract_unit_tests.txt) |
| The checker gives PASS to an honest patch and FAIL to cheating patches | Implemented | `cargo test -p kintsugi-check`; [docs/EVIDENCE.md](docs/EVIDENCE.md), S1 |
| A per-account cap on attempt slots | Implemented | written and tested, not deployed: [`docs/evidence/account_cap/PLAN.md`](docs/evidence/account_cap/PLAN.md) |
| Vendor proving on a rented GPU (29.82 s prove, 21.71 s shrink) with the secret in memory only | Experimental | one run, one machine: [`docs/evidence/smooth/gpu/`](docs/evidence/smooth/gpu/); [docs/numbers.md](docs/numbers.md) |
| The Groth16 wrap on a separate Docker machine (337.73 s, 6.82 GiB peak) | Experimental | one run: [`docs/evidence/smooth/vps/groth16.log`](docs/evidence/smooth/vps/groth16.log) |
| Level 1 verification through OutLayer | Experimental | built, never answered on testnet: [docs/EVIDENCE.md](docs/EVIDENCE.md), S4/S5 |
| Unresolved bug bounties (no reference fix needed) | Planned | README, "Roadmap" |
| Proving inside sealed hardware (a TEE with attestation) | Planned | README, "Roadmap" |
| Vendor liveness bond and fallback evaluator | Planned | README, "Roadmap" |
| Agent earnings after model and compute costs | Planned | README, "Roadmap"; the Ledger's empty cost column |
| An external security audit | Not claimed | none; the contract was reviewed in AI review passes ([docs/AUDIT.md](docs/AUDIT.md)) |
| A mainnet contract | Not claimed | testnet only |
