# S3 results: the bounty lifecycle on NEAR testnet

Spike S3 asks: does the full bounty lifecycle work on NEAR? Pass condition (blueprint section 14): all paths work, including the silent vendor timeout by a plain call.

**Verdict: PASS on testnet, for the minimal contract described below.** The happy path paid the payout account on the second matching attestation. The silent vendor path paid the researcher through a plain `claim_timeout` call. The expiry path refunded the vendor. Each early or late call that should be refused was refused on chain, with the error message saved. No real proofs were used: every hash posted on chain is a labelled placeholder (sha256 of a text such as `kintsugi S3 placeholder: harness image id`). Real hashes come from S1 and S2.

All times are UTC, 23 Oct 2026. Contract account: `kintsugi-djloo.testnet`. Explorer links use https://explorer.testnet.near.org/transactions/<hash>.

## 1. What was built

| Part | File |
| --- | --- |
| Bounty contract (near-sdk 5.29.1) | `contract/src/lib.rs` |
| Unit tests (30 tests) | `contract/src/tests.rs` |
| Deploy and test accounts | `scripts/s3_deploy.sh` |
| Testnet run: happy path, silent vendor, expiry, gas limit, timing | `scripts/s3_testnet.sh` |
| Shared helpers (output filter that drops private material) | `scripts/s3_lib.sh` |
| RPC measurements (block time, finality, gas per transaction) | `scripts/s3_measure.py` |

Methods: `new` (init), `register_verifier`, `create_bounty`, `commit`, `reveal`, `post_verdict`, `attest`, `claim_timeout`, `expire`, plus the free views `get_owner`, `get_next_bounty_id`, `get_bounty`, `get_submission`, `get_verifiers`.

Rules, in plain words:

- **Windows are per bounty**, in nanoseconds of block time: reveal gap F, verdict window W (reveal to latest verdict), attestation window A (verdict to latest attestation), expiry E (creation to expiry). Tests use short windows (seconds).
- **Fingerprint** = sha256 of `"kintsugi-commit-v1"`, then the patch length (4 bytes, little endian), the patch, the payout account length (4 bytes), the payout account name, then the 32 byte nonce. Binding the payout account means a copied reveal cannot redirect the money. Only the committing account can reveal.
- **Only the first K commits count.** A later commit succeeds as a call, stores nothing, logs `commit_ignored` and returns `null`.
- **Reveal** checks the gap, the size limit (at most `max_patch_bytes`, which is capped at 4096) and the fingerprint. It records `env::random_seed_array()`, the reveal time and sha256 of the patch.
- **Verdict**: only the vendor can post it, once, within W of the reveal.
- **Attest**: the caller must be a registered verifier. It must not be the vendor, the committer or the payout account. It must send the same verdict, journal hash and receipt hash, within A of the verdict. A repeat from the same verifier returns `duplicate` and counts once. The second different verifier makes the verdict final. A final PASS pays the payout account and closes the bounty. A final FAIL marks that attempt spent, and the bounty stays open.
- **Deadline** of a revealed submission: verdict time + A if a verdict was posted, otherwise reveal time + W. After it, anyone may call `claim_timeout`, which pays the payout account and closes the bounty. A verdict with fewer than two attestations by then counts as no verdict (decision D2).
- **Expire**: anyone, after E, if nothing was paid **and no revealed submission is still waiting** for its verdict or timeout. Without that last check, a vendor could wait for expiry and take back money that a silent vendor timeout owes the researcher.
- **Verifiers vs vendors**: `register_verifier` (owner only) refuses any account that has ever created a bounty, and `create_bounty` refuses a registered verifier. A vendor also cannot commit to its own bounty.
- **Registered verifier keys are registered verifier accounts.** An attestation is a call to `attest` signed by the verifier account's own access key, so NEAR's transaction signature check does the signature check. The contract checks which account called. This is the Level 0 route. The OutLayer callback route for verifier 1 is S4/S5 work.
- **Events**: every state change logs `EVENT_JSON:{"standard":"kintsugi","version":"1.0.0","event":...,"data":[...]}` (NEP-297 style). Events used: init, verifier_registered, bounty_created, committed, commit_ignored, revealed, verdict_posted, attested, attest_duplicate, paid, attempt_spent, refunded.
- **Init over the old S0 state**: `new` is `#[init(ignore_state)]` and `#[private]`. It overwrites the hello world `STATE` value, and only the contract account itself (the deploy transaction) can call it. Calling it again would wipe the bounty state, so later code updates must deploy **without** an init call.

### Left out on purpose (minimal S3)

- `attest_proof0`: bounties open at once. The Proof 0 receipt hash is stored but nobody attests it yet.
- Attempt fees, `deposit_credit` and the fee sweep to verifiers. Without fees, anyone can fill the K commit slots with junk commits. Fees exist to stop that.
- No reveal deadline. A commit that is never revealed keeps its slot, but it does not block `expire`.
- A failed payout transfer has no callback. If the payout account does not exist, the transfer fails and the money returns to the contract while the bounty shows Paid. A callback that re-opens the payout is the fix.
- Storage is paid from the contract account's balance. The 0.1 NEAR minimum bounty and the caps (K at most 16, patch at most 4096 bytes) are the only limits.
- The OutLayer callback verifier (S4/S5), function call keys with credit (S7), and on-chain receipt checks (S6).
- The patch is not checked to be WebAssembly. The contract only stores bytes and hashes.

## 2. Unit tests

Command (repo root; the lock keeps it from running alongside the other heavy build):

```
CARGO_HTTP_MULTIPLEXING=false CARGO_HTTP_TIMEOUT=60 CARGO_NET_RETRY=10 CARGO_NET_GIT_FETCH_WITH_CLI=true \
  flock target/.heavy-build.lock cargo test -p kintsugi-contract --offline
```

Result: **30 passed, 0 failed** (`unit_tests.txt`). They cover the happy path, silent vendor timeout, timeout before the deadline refused, a verdict with one attestation timing out, expire refunds, expire too early, expire waiting for a revealed submission, no expire after a payout, the same verifier twice counting once, vendor refused as verifier, verifier refused as vendor, only the owner registering, an unregistered attester refused, wrong patch, wrong nonce, fingerprint bound to the payout account, reveal before the gap, an oversized patch, only the committer revealing, a late verdict, only the vendor posting a verdict, a late attestation, a mismatched attestation, commits beyond K ignored, a FAIL spending the attempt and a later PASS paying, no second payout, a researcher attesting its own submission, a tiny bounty refused, init over the hello world state, and the pinned fingerprint layout.

The near-sdk `unit-testing` feature pulls in near-crypto 0.37.4 → aws-lc-rs 1.16.2 → aws-lc-sys 0.39.1. aws-lc-sys built **without cmake**. Its build script uses its `cc` builder (gcc) by default on x86_64 Linux and only needs cmake for FIPS or no-asm builds. No setting was changed. The first test build took 1 min 28 s, from crates already in the local cache.

## 3. Wasm

Command (in `contract/`): `flock ../target/.heavy-build.lock cargo near build non-reproducible-wasm` (cargo-near 0.22.0, `wasm_build.txt`).

| | |
| --- | --- |
| File | `target/near/kintsugi_contract/kintsugi_contract.wasm` |
| Size | 228,358 bytes (S0 hello world: about 86 KB of account storage) |
| SHA-256 (hex) | `cac3684a6719d631eb48626e13fe1ae430a6409f512b095950766a91d62d7bb7` |
| SHA-256 (base58, as shown by the deploy) | `EeWB77MDSHLYBLYHpoPdqNmtWno6HVdSqaZc9dGdnnyC` |

At 1e19 yoctoNEAR per byte (`protocol_config_gas.txt`), the code alone locks about 2.28 NEAR of storage on the contract account.

## 4. Testnet run

Commands (repo root):

```
./scripts/s3_deploy.sh                                   # deploy + new, create 5 sub-accounts
./scripts/s3_testnet.sh                                  # run 1 (stopped early, see devlog)
PHASES="silent expire gas measure" ./scripts/s3_testnet.sh          # run 2
PHASES="expire gas measure gasreport" ./scripts/s3_testnet.sh       # run 3
```

Sub-accounts created from `kintsugi-djloo.testnet` (keys saved to the legacy keychain, in the secrets folder outside the repo): `vendor` (2 NEAR, topped up with 1 NEAR later), `researcher`, `verifier1`, `verifier2` (0.5 NEAR each), `payout` (0.1 NEAR), all `.kintsugi-djloo.testnet`.

Balance checks, read over RPC at final finality before and after:

- Happy path: payout account +500000000000000000000000 yoctoNEAR (exactly 0.5 NEAR) (`happy_balance.txt`).
- Silent vendor path: payout account +0.5 NEAR exactly (`silent_balance.txt`).
- Expiry path: vendor +0.5 NEAR exactly (`expire_balance.txt`). The researcher paid the gas for the `expire` call, not the vendor.
- Final balances: `balances_after.txt`. The payout account holds 1.6 NEAR: 0.1 start + 3 × 0.5 payouts.

Final views: `happy_bounty_view.json` (state Paid, attestations verifier1 and verifier2, outcome Passed, seed recorded), `silent_submission_view.json` (outcome TimedOut, no verdict), `expire_bounty_view.json` (state Refunded).

### Every transaction

Gas comes from `gas.tsv`, made by `python3 -I scripts/s3_measure.py gas docs/evidence/S3/transactions.tsv docs/evidence/S3/gas.tsv`. That command reads `EXPERIMENTAL_tx_status` from the archival RPC and sums gas burned over the transaction and all its receipts. The "Gas burned" line that near-cli-rs prints (in `transactions.tsv` and `steps/*.txt`) is lower, about 0.31 TGas for every call. It counts only the transaction-to-receipt step, not the contract execution. Use `gas.tsv`.

| # | Step | What it did | Signer | Result | Gas burned (TGas, tx + all receipts) | Transaction |
|---|---|---|---|---|---|---|
| 1 | deploy | deploy the S3 wasm and run `new` (replaces the S0 hello state) | kintsugi-djloo.testnet | ok | 18.579 | [BxNA4Zdhs8ZRZFeYumic1hy5atkdztjb8yqs1FN5TWwA](https://explorer.testnet.near.org/transactions/BxNA4Zdhs8ZRZFeYumic1hy5atkdztjb8yqs1FN5TWwA) |
| 2 | create_vendor | create vendor sub-account, 2 NEAR | kintsugi-djloo.testnet | ok | 8.573 | [AKqTvcdFcAKQtEn6ieq6e974xhwF1k7bkWo4aZxYjuyL](https://explorer.testnet.near.org/transactions/AKqTvcdFcAKQtEn6ieq6e974xhwF1k7bkWo4aZxYjuyL) |
| 3 | create_researcher | create researcher sub-account, 0.5 NEAR | kintsugi-djloo.testnet | ok | 8.573 | [BELjGGghxBUfw8KmX2qe8ReBwaeEp5D1cWVwFjMKuUpT](https://explorer.testnet.near.org/transactions/BELjGGghxBUfw8KmX2qe8ReBwaeEp5D1cWVwFjMKuUpT) |
| 4 | create_verifier1 | create verifier1 sub-account, 0.5 NEAR | kintsugi-djloo.testnet | ok | 8.573 | [CbaDuN5x8GBxLjLdZSW4CUsXERN2j3tskajQqN4Dsy4T](https://explorer.testnet.near.org/transactions/CbaDuN5x8GBxLjLdZSW4CUsXERN2j3tskajQqN4Dsy4T) |
| 5 | create_verifier2 | create verifier2 sub-account, 0.5 NEAR | kintsugi-djloo.testnet | ok | 8.573 | [F6nQpWyuXjKPKQVYMcQ7FR5ATiLHhHG6sootJVBwLJnu](https://explorer.testnet.near.org/transactions/F6nQpWyuXjKPKQVYMcQ7FR5ATiLHhHG6sootJVBwLJnu) |
| 6 | create_payout | create payout sub-account, 0.1 NEAR | kintsugi-djloo.testnet | ok | 8.573 | [52Amz8en2X7kpTAy4HcFScNAb6MXWKVV5KDqkkEJZS3W](https://explorer.testnet.near.org/transactions/52Amz8en2X7kpTAy4HcFScNAb6MXWKVV5KDqkkEJZS3W) |
| 7 | happy_register_verifier1 | owner registers verifier1 | kintsugi-djloo.testnet | ok | 2.360 | [91S33R933hGcaqcoGCLDgbpYaozzpWeeLcCFi8G2Gvas](https://explorer.testnet.near.org/transactions/91S33R933hGcaqcoGCLDgbpYaozzpWeeLcCFi8G2Gvas) |
| 8 | happy_register_verifier2 | owner registers verifier2 | kintsugi-djloo.testnet | ok | 2.371 | [6GDPogFokryubXgQ3uE5cLoh9UvJtHr51UYsseVeWpEU](https://explorer.testnet.near.org/transactions/6GDPogFokryubXgQ3uE5cLoh9UvJtHr51UYsseVeWpEU) |
| 9 | happy_create_bounty | bounty 0, 0.5 NEAR attached | vendor | ok | 2.575 | [Fq8ZFjcbhMjhe3gMWzM3xWqUZaCYC7wxsepHyn44w4Ts](https://explorer.testnet.near.org/transactions/Fq8ZFjcbhMjhe3gMWzM3xWqUZaCYC7wxsepHyn44w4Ts) |
| 10 | happy_commit | commit fingerprint to bounty 0 | researcher | ok | 2.486 | [SRaBr14w6JorNFyUswzLBkw1AHDw6aTPiHHhFwntB6j](https://explorer.testnet.near.org/transactions/SRaBr14w6JorNFyUswzLBkw1AHDw6aTPiHHhFwntB6j) |
| 11 | happy_reveal | reveal patch and nonce, seed recorded | researcher | ok | 2.603 | [HAjzWVZMpVyQUaswbRqiZsvb3qpQ5RJ7TmFYCdWRnUBq](https://explorer.testnet.near.org/transactions/HAjzWVZMpVyQUaswbRqiZsvb3qpQ5RJ7TmFYCdWRnUBq) |
| 12 | happy_post_verdict | vendor posts PASS | vendor | ok | 2.416 | [EHJHxPdeMMaJ36g1xAQXo6v4oQsd4Pb3HAzP6YH8w6gU](https://explorer.testnet.near.org/transactions/EHJHxPdeMMaJ36g1xAQXo6v4oQsd4Pb3HAzP6YH8w6gU) |
| 13 | happy_attest_v1 | verifier1 attests, returns "recorded" | verifier1 | ok | 2.591 | [Yge6hA8fu1Q4CYaRsjMVxvdcNVHfZXEvqcrnmbdEjY7](https://explorer.testnet.near.org/transactions/Yge6hA8fu1Q4CYaRsjMVxvdcNVHfZXEvqcrnmbdEjY7) |
| 14 | happy_attest_v1_again | verifier1 again, returns "duplicate" (counts once) | verifier1 | ok | 2.574 | [7kf5g3BuvMZS5NnoVtdra6LcdpDZLvMnetwXYUe57Ncy](https://explorer.testnet.near.org/transactions/7kf5g3BuvMZS5NnoVtdra6LcdpDZLvMnetwXYUe57Ncy) |
| 15 | happy_attest_v2 | verifier2 attests, returns "final_pass"; 0.5 NEAR paid to payout | verifier2 | ok | 3.429 | [9xSP37uDCWffiKrFJu5aBUEuXYZkVbnU8raKXvMVaj4t](https://explorer.testnet.near.org/transactions/9xSP37uDCWffiKrFJu5aBUEuXYZkVbnU8raKXvMVaj4t) |
| 16 | run1_silent_create_bounty | bounty 1 (run 1, script stopped after this path step, see devlog) | vendor | ok | 2.584 | [411FUNStgVEuTU2gy7Fgjs8iVC9ks7oPphkiqvgCLt61](https://explorer.testnet.near.org/transactions/411FUNStgVEuTU2gy7Fgjs8iVC9ks7oPphkiqvgCLt61) |
| 17 | run1_silent_commit | commit to bounty 1 | researcher | ok | 2.492 | [CG9YEutq5fhT9whSaEspy1urgevxfWHdBTWSQsTLUqLh](https://explorer.testnet.near.org/transactions/CG9YEutq5fhT9whSaEspy1urgevxfWHdBTWSQsTLUqLh) |
| 18 | run1_silent_reveal | reveal to bounty 1 | researcher | ok | 2.613 | [CeEELmGQV8rmMvafjVR2nBWgintHhcAeZ5ff7uCypfwo](https://explorer.testnet.near.org/transactions/CeEELmGQV8rmMvafjVR2nBWgintHhcAeZ5ff7uCypfwo) |
| 19 | silent_create_bounty | bounty 2, windows W=20 s, A=20 s | vendor | ok | 2.586 | [GiKdntx5Z7vENY4aBHHsSz3Z33aYQ9UjGCxzuxgZ3o3y](https://explorer.testnet.near.org/transactions/GiKdntx5Z7vENY4aBHHsSz3Z33aYQ9UjGCxzuxgZ3o3y) |
| 20 | silent_commit | commit to bounty 2 | researcher | ok | 2.495 | [AyVT9GrXmdezBZDwUv3PVYBTUhHg1myriSokvYh6dYEf](https://explorer.testnet.near.org/transactions/AyVT9GrXmdezBZDwUv3PVYBTUhHg1myriSokvYh6dYEf) |
| 21 | silent_reveal | reveal to bounty 2 | researcher | ok | 2.613 | [4R2RPPtZeWUt9VkiNdeVHa95ibqFFYZuroW4KZVNvnqx](https://explorer.testnet.near.org/transactions/4R2RPPtZeWUt9VkiNdeVHa95ibqFFYZuroW4KZVNvnqx) |
| 22 | silent_timeout_too_early | claim_timeout before the deadline: refused "deadline has not passed" | researcher | failed | 1.948 | [AvdNdUt4pgkmi35JtHW4ECv9iugYqpqWCq4pbzXnBnah](https://explorer.testnet.near.org/transactions/AvdNdUt4pgkmi35JtHW4ECv9iugYqpqWCq4pbzXnBnah) |
| 23 | silent_late_verdict | vendor verdict after window W: refused "verdict window has closed" | vendor | failed | 1.978 | [5adj3H7kzwFVtUXFZdv5QBLmi4wHs8DhUjtsYvjgR81B](https://explorer.testnet.near.org/transactions/5adj3H7kzwFVtUXFZdv5QBLmi4wHs8DhUjtsYvjgR81B) |
| 24 | silent_claim_timeout | claim_timeout after the deadline: 0.5 NEAR paid to payout | researcher | ok | 3.203 | [5aqYBwqVs7Z4jkGMYd71bKeQveskXoGN1qMnETC1L8kD](https://explorer.testnet.near.org/transactions/5aqYBwqVs7Z4jkGMYd71bKeQveskXoGN1qMnETC1L8kD) |
| 25 | run2_expire_too_early_no_such_bounty | expire on bounty 3 before it existed (its create was refused by the CLI for low vendor balance): refused "no such bounty" | researcher | failed | 1.837 | [BaFDwWLTfD6N92f8uf863NcK7FS1soJ1NvmiEdrHdNHY](https://explorer.testnet.near.org/transactions/BaFDwWLTfD6N92f8uf863NcK7FS1soJ1NvmiEdrHdNHY) |
| 26 | topup_vendor | main account sends 1 NEAR to vendor | kintsugi-djloo.testnet | ok | 0.670 | [CL44USsbM9hQWeuTPx8FuDQeA5vnH5rU42MFauYQtB3y](https://explorer.testnet.near.org/transactions/CL44USsbM9hQWeuTPx8FuDQeA5vnH5rU42MFauYQtB3y) |
| 27 | run1_cleanup_bounty1_claim_timeout | claim_timeout on bounty 1 left open by run 1: 0.5 NEAR paid to payout | researcher | ok | 3.203 | [CxasRTaCcLej6pUCNGG42FmBzVTnj9PshgG3EtADQ4fc](https://explorer.testnet.near.org/transactions/CxasRTaCcLej6pUCNGG42FmBzVTnj9PshgG3EtADQ4fc) |
| 28 | expire_create_bounty | bounty 3, expiry 30 s | vendor | ok | 2.586 | [C5GxEFeEuB54QX22MsmTSM1ziNEuV7bWZrimvd67wtFe](https://explorer.testnet.near.org/transactions/C5GxEFeEuB54QX22MsmTSM1ziNEuV7bWZrimvd67wtFe) |
| 29 | expire_too_early | expire before expiry: refused "bounty has not expired" | researcher | failed | 1.859 | [4hWsEev7nEo9jQYUHfhEd39z8ixbyqjPzKCrkNq6ucoj](https://explorer.testnet.near.org/transactions/4hWsEev7nEo9jQYUHfhEd39z8ixbyqjPzKCrkNq6ucoj) |
| 30 | expire_refund | expire after expiry: 0.5 NEAR refunded to vendor | researcher | ok | 2.951 | [Do3TNA8D5d6i2iy6jGk9kWVCWPJUemukMv1pxnAeqNRn](https://explorer.testnet.near.org/transactions/Do3TNA8D5d6i2iy6jGk9kWVCWPJUemukMv1pxnAeqNRn) |
| 31 | gas_500_tgas | view method called as a transaction with 500 TGas prepaid: accepted | kintsugi-djloo.testnet | ok | 1.755 | [n6ptdLi4pbhxdmb2oEk8DFTBrqaw1ibudibcYds6dNQ](https://explorer.testnet.near.org/transactions/n6ptdLi4pbhxdmb2oEk8DFTBrqaw1ibudibcYds6dNQ) |
| 32 | gas_1000_tgas | same with 1000 TGas prepaid: accepted | kintsugi-djloo.testnet | ok | 1.755 | [EthQyLec4q8KQ9gfL9bEqWx47i4vu4fmWNrHyPF5Lo5a](https://explorer.testnet.near.org/transactions/EthQyLec4q8KQ9gfL9bEqWx47i4vu4fmWNrHyPF5Lo5a) |

`steps/<step>.txt` has the full filtered near-cli-rs output for each step: arguments, logs with the `EVENT_JSON` lines, and the return value. The refused calls were signed with near-cli-rs (`save-to-file`) and sent over RPC (`send_tx`, wait_until FINAL), because near-cli-rs prints no transaction id for a failed call. Their steps files hold the RPC reply with the panic message.

### Gas per method (successful calls, TGas, transaction + all receipts)

| Method | Calls | Total gas burned | Of which the contract call receipt |
| --- | --- | --- | --- |
| deploy + `new` | 1 | 18.579 | 16.307 |
| `register_verifier` | 2 | 2.360 to 2.371 | 1.828 to 1.840 |
| `create_bounty` | 4 | 2.575 to 2.586 | 2.015 to 2.027 |
| `commit` | 3 | 2.486 to 2.495 | 1.947 to 1.956 |
| `reveal` (61 to 63 byte patch) | 3 | 2.603 to 2.613 | 2.061 to 2.071 |
| `post_verdict` | 1 | 2.416 | 1.875 |
| `attest` (first, duplicate) | 2 | 2.574 to 2.591 | 2.032 to 2.049 |
| `attest` (final, with payout transfer) | 1 | 3.429 | 2.442 |
| `claim_timeout` (with payout transfer) | 2 | 3.203 | 2.223 |
| `expire` (with refund transfer) | 1 | 2.951 | 1.973 |
| refused calls (panic) | 4 | 1.837 to 1.978 | 1.305 to 1.436 |

Every method burns under 3.5 TGas, far below any limit.

## 5. More than 300 TGas on one call

| Prepaid gas | Result | Transaction |
| --- | --- | --- |
| 500 TGas | **Accepted** and executed. On-chain prepaid gas 500000000000000 | [n6ptdLi4pbhxdmb2oEk8DFTBrqaw1ibudibcYds6dNQ](https://explorer.testnet.near.org/transactions/n6ptdLi4pbhxdmb2oEk8DFTBrqaw1ibudibcYds6dNQ) |
| 1000 TGas | **Accepted** and executed. On-chain prepaid gas 1000000000000000 | [EthQyLec4q8KQ9gfL9bEqWx47i4vu4fmWNrHyPF5Lo5a](https://explorer.testnet.near.org/transactions/EthQyLec4q8KQ9gfL9bEqWx47i4vu4fmWNrHyPF5Lo5a) |
| 1001 TGas | Not sent. near-cli-rs refused before sending: "The total prepaid gas (1001.0 Tgas) for all given actions exceeded the limit (1000.0 Tgas)" (`steps/gas_1001_tgas.txt`). The chain's own reply to 1001 TGas was not tested. | none |

The testnet protocol config (protocol version 88) gives `max_total_prepaid_gas` = `max_gas_burnt` = 1000000000000000 (1,000 TGas) (`protocol_config_gas.txt`). So the per-call limit on testnet is **1,000 TGas, not 300**. The docs page that says 300 TGas is out of date for testnet. Mainnet was not checked.

## 6. Block time and finality

All measured against `https://test.rpc.fastnear.com` over IPv4. The RPC round trip from the dev machine is 0.37 to 0.83 s, median 0.57 s, over 10 `gas_price` calls (`rpc_rtt.json`, `python3 -I scripts/s3_measure.py rtt 10`).

**Block time**: `python3 -I scripts/s3_measure.py blocktime 120 docs/evidence/S3/blocktime.json` fetched every block from height 274457951 to 274458071: 121 consecutive heights, none skipped. Header timestamps span 69.43 s.

| | Seconds |
| --- | --- |
| Mean per block | **0.579** |
| Median interval | 0.591 |
| Min / p95 / max interval | 0.183 / 0.694 / 1.182 |

This matches the 0.6 s figure on the NEAR docs pages, not the 1 s on the gas page.

**Finality lag**: `python3 -I scripts/s3_measure.py finality 20 docs/evidence/S3/finality_lag.json`, 20 samples.

| Method | Height lag | Time lag (s) |
| --- | --- | --- |
| Structural: newest block vs the `last_final_block` named in its own header | always 2 blocks (min 2, max 2) | mean 1.159, median 1.165, min 0.818, max 1.347 |
| Two RPC queries, `finality=optimistic` then `finality=final` | mean 0.8, 0 to 2 | mean 0.47, max 1.18 |

The structural number is the reliable one: a block is final about 2 blocks, or about 1.2 s, after it is produced. The two-query number is lower because the head moves on between the two calls.

**Send to FINAL, wall clock** (`send_to_final.jsonl`). A tiny function call was signed by near-cli-rs (`save-to-file`), then sent with RPC `send_tx` and timed until the reply. Five of each:

| wait_until | min | median | max | mean (s) |
| --- | --- | --- | --- | --- |
| FINAL | 3.549 | 3.630 | 3.770 | 3.643 |
| EXECUTED_OPTIMISTIC | 1.328 | 1.655 | 1.882 | 1.612 |

These include one RPC round trip of about 0.4 to 0.8 s from this machine. A function call takes two blocks (transaction, then receipt) before it executes, and finality adds about two more.

| wait_until | wall seconds | Transaction |
|---|---|---|
| FINAL | 3.587 | [9mH939ynQRP8oMGVVGGGkZirz9RKZFANvU6uNJjfYE66](https://explorer.testnet.near.org/transactions/9mH939ynQRP8oMGVVGGGkZirz9RKZFANvU6uNJjfYE66) |
| EXECUTED_OPTIMISTIC | 1.747 | [5hrxSwygY7hkE1PoF7HLUz85ogpjJARgmwN5uEsp1fvm](https://explorer.testnet.near.org/transactions/5hrxSwygY7hkE1PoF7HLUz85ogpjJARgmwN5uEsp1fvm) |
| FINAL | 3.549 | [GrjPaPViQLBZNa7c5Vgvptqq8Grok8qMqNkaCdX2Fk8x](https://explorer.testnet.near.org/transactions/GrjPaPViQLBZNa7c5Vgvptqq8Grok8qMqNkaCdX2Fk8x) |
| EXECUTED_OPTIMISTIC | 1.882 | [BDX3PjnQYFtPoPa3txoLTc4GCsgwvhZ5ovxjJWjn8fX7](https://explorer.testnet.near.org/transactions/BDX3PjnQYFtPoPa3txoLTc4GCsgwvhZ5ovxjJWjn8fX7) |
| FINAL | 3.77 | [CFdtdmEggTNK4ocvzdSS2QqHRBbSRpDFRbHMt6ADUoiT](https://explorer.testnet.near.org/transactions/CFdtdmEggTNK4ocvzdSS2QqHRBbSRpDFRbHMt6ADUoiT) |
| EXECUTED_OPTIMISTIC | 1.328 | [6cU7gEXppCkbWs1XP6SiDiEEJ1VwET3qrdd2FKjPJvqX](https://explorer.testnet.near.org/transactions/6cU7gEXppCkbWs1XP6SiDiEEJ1VwET3qrdd2FKjPJvqX) |
| FINAL | 3.68 | [5PZWYB9wuLXvnW7s8PF1LxxEZdEeS9ywnBo37jShJF93](https://explorer.testnet.near.org/transactions/5PZWYB9wuLXvnW7s8PF1LxxEZdEeS9ywnBo37jShJF93) |
| EXECUTED_OPTIMISTIC | 1.655 | [ShzChYm9bJT6mhWaPyNeMxBySxqS8fbvbaVuFN7pF1M](https://explorer.testnet.near.org/transactions/ShzChYm9bJT6mhWaPyNeMxBySxqS8fbvbaVuFN7pF1M) |
| FINAL | 3.63 | [3Wi1NfXddPEzfaKPdMqnSYVQACJEb8CdN5vhBXbULyru](https://explorer.testnet.near.org/transactions/3Wi1NfXddPEzfaKPdMqnSYVQACJEb8CdN5vhBXbULyru) |
| EXECUTED_OPTIMISTIC | 1.446 | [GmkVtdEHMKAgjf5Rz99SM837QXPGYhLjMqpmY3eSFAU6](https://explorer.testnet.near.org/transactions/GmkVtdEHMKAgjf5Rz99SM837QXPGYhLjMqpmY3eSFAU6) |

**What this means for the windows**: a reveal gap F of 2 s already covers finality of the commit (about 1.2 s). The S3 run used F = 2 s. In practice the gap between the commit and the reveal transactions was over 10 s, because each near-cli-rs call takes 5 to 7 s from this machine. W and A must still be set from the proving time in S2, not from block time.

## 7. Devlog

**Done.** Replaced the S0 hello world contract with the minimal bounty contract and 30 unit tests, all passing. Built the wasm (228,358 bytes) and deployed it over the hello world state with `new` (`ignore_state`, `private`). Created five sub-accounts. On testnet, ran the happy path (bounty 0), the silent vendor path (bounty 2), the expiry path (bounty 3) and the gas limit probe, then measured block time and finality.

**What failed and how it was fixed.**

1. The first run stopped right after the bounty 1 reveal. The intended early `claim_timeout` was refused by the contract (correct), but near-cli-rs prints no transaction id for a failed call, and the script's `grep` for the id then stopped the script under `set -e`. Fix: expected refusals now go through `call_expect_fail` (sign with near-cli-rs, send over RPC, record the id and the failure). Bounty 1 was left open with a revealed submission. It was closed later by a plain `claim_timeout` (row `run1_cleanup_bounty1_claim_timeout`), which is a second silent vendor timeout on chain.
2. In run 2, the expiry bounty could not be created. The vendor had 0.499 NEAR left after three 0.5 NEAR bounties (one from the stopped run 1), and near-cli-rs refused the call before sending. The following `expire` then hit "no such bounty" on chain. Fix: 1 NEAR top-up to the vendor, and the script now stops if a `create_bounty` did not create a bounty. Run 3 completed the expiry path.
3. The near-cli-rs "Gas burned" line undercounts. Gas numbers here come from the RPC instead.

**Surprises.** The per-call gas limit on testnet is 1,000 TGas. aws-lc-sys needed no cmake. The wasm is 228 KB, larger than expected: the code alone locks about 2.3 NEAR of storage on the contract account.

**Next.** Set W and A from S2's proving times. Add `attest_proof0`, attempt fees with credit, and a payout callback. Replace the placeholder hashes with real S1/S2 receipts. S4/S5 decide whether verifier 1 becomes the OutLayer callback route.

## 8. Files in this folder

`RESULTS.md` (this file), `unit_tests.txt`, `wasm_build.txt`, `wasm.txt`, `transactions.tsv` (every step in order with the CLI's figures), `gas.tsv` (on-chain gas per transaction), `steps/*.txt` (one per step), `run1.log`, `run2.log`, `run3.log`, `*_balance.txt`, `balances_after.txt`, `*_view.json`, `blocktime.json` and `blocktime_summary.json`, `finality_lag.json` and `finality_lag_summary.json`, `send_to_final.jsonl`, `rpc_rtt.json`, `protocol_config_gas.txt`. Before saving, output was filtered by `filter_private` in `scripts/s3_lib.sh`. It drops lines that mention private keys, secrets, seed phrases or signatures, and any line holding a base58 string of 80 or more characters. Absolute local paths were removed from the build logs.
