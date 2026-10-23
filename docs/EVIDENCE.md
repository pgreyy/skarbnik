# Evidence

One section per spike: the question, the commands, the raw output (or the path to it), the verdict, and the fallback used if it
failed. Failures stay in this file. Times are wall clock on the development machine (Ubuntu 26.04.1 under WSL2, x86_64,
16 cores, 10 GiB RAM for WSL) unless stated otherwise. Raw output is in `docs/evidence/<spike>/`, with local paths replaced
by `<repo>` and `~`.

## S3: Does the full bounty lifecycle work on NEAR testnet?

Question: does the smallest bounty contract work on testnet, including the silent vendor timeout by a plain call? Also: does
testnet accept more than 300 TGas on one call, and what are block time and finality?

**Verdict: PASS (2026-10-23).** Full write-up, every command and raw output: `docs/evidence/S3/RESULTS.md`
(all transactions in `docs/evidence/S3/transactions.tsv`, gas in `docs/evidence/S3/gas.tsv`).

Contract (`contract/src/lib.rs`): `create_bounty`, `register_verifier` (owner only), `commit`, `reveal`, `post_verdict`,
`attest`, `claim_timeout`, `expire`, plus views. Verifiers are registered accounts; an attestation is an `attest` call signed
by that account's own key. A verdict is final only with matching attestations from two different registered verifiers; a
second attestation from the same verifier counts once. A vendor can never be a verifier and the reverse. Windows use block
time. `expire` waits while a revealed submission still waits for its verdict or timeout, so a vendor cannot take back a
timeout payout by letting the bounty expire. Left out for now: Proof 0 attestations, attempt fees and credit, a reveal
deadline, vendor storage deposits; all posted hashes are labelled placeholders.

Unit tests: `cargo test -p kintsugi-contract --offline`: 30 passed, 0 failed (re-run 2026-10-23 for this file).

Wasm: `target/near/kintsugi_contract/kintsugi_contract.wasm`, 228,358 bytes, SHA-256
`cac3684a6719d631eb48626e13fe1ae430a6409f512b095950766a91d62d7bb7`. The code on `kintsugi-djloo.testnet` has the same
SHA-256 (checked with the RPC `view_code` query). This replaced the S0 hello world contract on that account.

Testnet runs: `./scripts/s3_deploy.sh`, then `./scripts/s3_testnet.sh` (explorer: `https://explorer.testnet.near.org/transactions/<hash>`).

| Path | Step | Transaction | Result |
| --- | --- | --- | --- |
| Setup | deploy and init | `BxNA4Zdhs8ZRZFeYumic1hy5atkdztjb8yqs1FN5TWwA` | ok |
| Happy (bounty 0) | register verifier1, verifier2 | `91S33R933hGcaqcoGCLDgbpYaozzpWeeLcCFi8G2Gvas`, `6GDPogFokryubXgQ3uE5cLoh9UvJtHr51UYsseVeWpEU` | ok |
| Happy | create, commit, reveal | `Fq8ZFjcbhMjhe3gMWzM3xWqUZaCYC7wxsepHyn44w4Ts`, `SRaBr14w6JorNFyUswzLBkw1AHDw6aTPiHHhFwntB6j`, `HAjzWVZMpVyQUaswbRqiZsvb3qpQ5RJ7TmFYCdWRnUBq` | ok |
| Happy | vendor posts PASS | `EHJHxPdeMMaJ36g1xAQXo6v4oQsd4Pb3HAzP6YH8w6gU` | ok |
| Happy | verifier1 attests | `Yge6hA8fu1Q4CYaRsjMVxvdcNVHfZXEvqcrnmbdEjY7` | "recorded" |
| Happy | verifier1 attests again | `7kf5g3BuvMZS5NnoVtdra6LcdpDZLvMnetwXYUe57Ncy` | "duplicate", counted once |
| Happy | verifier2 attests | `9xSP37uDCWffiKrFJu5aBUEuXYZkVbnU8raKXvMVaj4t` | "final_pass", payout account +0.5 NEAR |
| Silent vendor (bounty 2) | create, commit, reveal | `GiKdntx5Z7vENY4aBHHsSz3Z33aYQ9UjGCxzuxgZ3o3y`, `AyVT9GrXmdezBZDwUv3PVYBTUhHg1myriSokvYh6dYEf`, `4R2RPPtZeWUt9VkiNdeVHa95ibqFFYZuroW4KZVNvnqx` | ok |
| Silent vendor | early `claim_timeout` | `AvdNdUt4pgkmi35JtHW4ECv9iugYqpqWCq4pbzXnBnah` | refused: "deadline has not passed" |
| Silent vendor | late verdict | `5adj3H7kzwFVtUXFZdv5QBLmi4wHs8DhUjtsYvjgR81B` | refused: "verdict window has closed" |
| Silent vendor | `claim_timeout` | `5aqYBwqVs7Z4jkGMYd71bKeQveskXoGN1qMnETC1L8kD` | paid, payout account +0.5 NEAR |
| Expiry (bounty 3) | create | `C5GxEFeEuB54QX22MsmTSM1ziNEuV7bWZrimvd67wtFe` | ok |
| Expiry | early `expire` | `4hWsEev7nEo9jQYUHfhEd39z8ixbyqjPzKCrkNq6ucoj` | refused: "bounty has not expired" |
| Expiry | `expire` | `Do3TNA8D5d6i2iy6jGk9kWVCWPJUemukMv1pxnAeqNRn` | vendor refunded +0.5 NEAR |

Test accounts (sub-accounts of `kintsugi-djloo.testnet`, testnet NEAR only): vendor, researcher, verifier1, verifier2, payout.

Gas per call (total over the transaction and its receipts, read from RPC):

| Call | TGas |
| --- | --- |
| deploy and init | 18.58 |
| create_bounty | 2.58 |
| commit | 2.49 |
| reveal | 2.61 |
| post_verdict | 2.42 |
| attest | 2.57 (3.43 for the final one that pays) |
| claim_timeout | 3.20 |
| expire | 2.95 |
| a refused call | about 1.8 to 2.0 |

The "Gas burned" figure near-cli-rs prints (about 0.31 TGas) leaves out the contract's execution and is not used here.

More than 300 TGas on one call: 500 TGas accepted (`n6ptdLi4pbhxdmb2oEk8DFTBrqaw1ibudibcYds6dNQ`), 1,000 TGas accepted
(`EthQyLec4q8KQ9gfL9bEqWx47i4vu4fmWNrHyPF5Lo5a`, re-checked by RPC: prepaid 1000.0 TGas, status success). 1,001 TGas was
refused by near-cli-rs before sending, so the chain's own answer to that was not tested. Testnet runtime config (protocol
version 88) sets both limits to 1,000 TGas. Mainnet not checked.

Block time and finality (`scripts/s3_measure.py`, RPC):

| Measure | Result |
| --- | --- |
| Block time, 121 consecutive blocks (274457951 to 274458071, none skipped) | mean 0.579 s, median 0.591 s, range 0.18 to 1.18 s |
| Finality lag | the latest block names a final block exactly 2 blocks back, about 1.16 s on average (0.82 to 1.35 s, 20 samples) |
| Send to FINAL, 10 transactions | median 3.63 s (3.55 to 3.77), including about 0.57 s network round trip from this machine |
| Send to executed (not yet final) | median 1.66 s |

Failures on the way (kept on purpose):

1. Run 1 stopped after the bounty 1 reveal: near-cli-rs prints no transaction id for a call the contract refuses, and the
   script stopped there. Fix: expected refusals are sent over RPC so they get an id. Bounty 1 was closed later by a second
   on-chain timeout (`CxasRTaCcLej6pUCNGG42FmBzVTnj9PshgG3EtADQ4fc`).
2. Run 2 did not create the expiry bounty: the vendor had 0.499 NEAR left. Fix: a 1 NEAR top-up
   (`CL44USsbM9hQWeuTPx8FuDQeA5vnH5rU42MFauYQtB3y`) and a stop if a bounty is not created. Run 3 completed it.

## S1: Does the harness give the right verdicts? (native run, outside the zkVM)

Question: does the checker give PASS to an honest patch and FAIL to every cheating patch, publishing only PASS or FAIL?

**Verdict: PASS for the native checker (2026-10-23), with one mismatch explained below.** The blueprint's full S1 also needs
the same checks inside the RISC Zero zkVM with a receipt, and a tampered receipt failing in a separate process. That part is
not done yet, so S1 as a whole is partial.

Full write-up, all commands and raw outputs: `docs/evidence/S1/RESULTS.md`.

What the checker does (`harness/checker/`, wasmi 2.0.0 interpreter, each input in a fresh instance, 50,000 fuel per input,
2 memory pages, call depth 64):

1. Validate: at most 2,048 bytes, no imports, the `parse` export, at most 2 memory pages, no start function, no floats.
2. The secret crash input (`data/demo/exploit.hex`, demo data only) must not trap or run out of fuel.
3. All 17 public tests (`data/demo/public_tests.txt`) must return the listed value.
4. Fairness: 64 inputs from the seed must give the same output as the original.
5. Variants: 32 seeded one or two byte changes of the crash input; where the original traps the candidate must not, where
   the original returns a value the candidate must return the same.

Commands (from the repository root):

```bash
cargo test -p kintsugi-check --offline
target/debug/kintsugi-check table --manifest data/attacks/manifest.txt --seed 6b696e74737567692053312064656d6f207365656420412e2e2e2e2e2e2e2e21
```

Results: `cargo test`: 16 passed, 0 failed (6 unit, 10 integration). Table (seed above, 64 fairness inputs, 32 variants):

| Patch | Expected | Actual | Caught at |
| --- | --- | --- | --- |
| `data/demo/fixed.wasm` (honest fix) | PASS | PASS | - |
| `data/demo/original.wasm` (unpatched) | FAIL | FAIL | 2 crash input: trap |
| `reject_all` | FAIL | FAIL | 3 public tests |
| `constant` | FAIL | FAIL | 3 public tests |
| `special_case_exploit` | FAIL | FAIL | 5 variants |
| `loop_forever` | FAIL | FAIL | 2 crash input: out of fuel |
| `memory_grow` | FAIL | **PASS** | mismatch, see below |
| `memory_grow_use` | FAIL | FAIL | 2 crash input: out of bounds |
| `memory_grow_nomax` | FAIL | FAIL | 2 crash input: growth limited |
| `memory_declared` | FAIL | FAIL | 1 validate: memory too large |
| `early_return_prefix` | FAIL | FAIL | 3 public tests |
| `disable_lists` | FAIL | FAIL | 3 public tests |
| `memorize_tests` | FAIL | FAIL | 4 fairness |
| `wrong_fix` | FAIL | FAIL | 2 crash input: trap |
| `subtle_change` | FAIL | FAIL | 4 fairness |
| `overbroad_fix` | FAIL | FAIL | 4 fairness |
| `wrong_export` | FAIL | FAIL | 1 validate |
| `imports_host` | FAIL | FAIL | 1 validate |
| `too_large` | FAIL | FAIL | 1 validate |
| `invalid_truncated` | FAIL | FAIL | 1 validate |

19 of 20 match. Re-run on 2026-10-23 for this file with the same command: same 19 of 20.

- **The mismatch, `memory_grow`:** on the crash input it asks for 64 more memory pages and ignores the answer. Its own declared
  maximum is 2 pages, so WebAssembly refuses the request (returns -1) without a trap, and the module then behaves like the
  honest fix. It never gets or uses extra memory. The expectation was wrong, not the checker; the variants that really use the
  memory fail. Kept in the table on purpose. A test pins this behaviour.
- **The seeded steps matter:** with fairness and variants turned off (`--fuzz-count 0 --variants 0`), `special_case_exploit`,
  `memorize_tests`, `subtle_change` and `overbroad_fix` all PASS (15 of 20 match). Output: `docs/evidence/S1/table_seeded_steps_off.txt`.
- **Seed sweep:** 200 seeds with 128 fairness inputs: every fairness and variant cheat failed on every seed and the honest fix
  passed on all 200; the latest first mismatch was fairness input #41. Output: `docs/evidence/S1/seed_sweep.txt`.
- **Timings:** a full check of one candidate (210 module runs) takes 0.1 to 2.3 ms; the whole 20-module table runs in under
  0.01 s wall time. Highest fuel used by one input on this seed: 2,100 (limit 50,000), apart from `loop_forever`, which hits the limit.

## S0: Can we build everything?

Question: does the workspace build with one command, does a hello world NEAR contract build and deploy to testnet, and does a
hello world RISC Zero proof get generated and verified locally?

Pass condition (blueprint): hello world contract deploys, hello world proof verifies.

**Verdict: PASS** (2026-10-23), after two failures recorded below.

### (a) Everything builds with one command: PASS

Command, from the repository root:

```bash
./scripts/build_all.sh
```

It runs `cargo build --release` (harness, zkVM guest, host), then `cargo near build non-reproducible-wasm` in `contract/`.

| Run | Result | Wall time | Peak memory | Output |
| --- | --- | --- | --- | --- |
| First run (contract crates downloaded during the run) | Both parts built; the script's last line checked a wrong path and exited 2 | 456.13 s | 752,080 KB | `docs/evidence/S0/a_build_all_first_run.txt` |
| Second run (path fixed, all crates cached) | exit 0 | 25.03 s | 752,464 KB | `docs/evidence/S0/a_build_all_cached_run.txt` |

- Contract wasm: `target/near/kintsugi_contract/kintsugi_contract.wasm`, 85,755 bytes, SHA-256
  `5acf78cf300418ce7cf51119949af734b0e2baca54f6d26162596c887a322d15` (same value in both runs).
- zkVM guest built at `target/riscv-guest/kintsugi-harness/hello_guest`; host binary `target/release/kintsugi-host`.

Failures on the way (kept on purpose):

1. **Plain `cargo build` of the whole workspace fails by design.** near-sdk 5.29.1 stops a native contract build with
   `compile_error!` "Use `cargo near build` instead of `cargo build` to compile your contract" (attempt 5, exit 101, 652 s).
   Output: `docs/evidence/S0/a_attempt5_near_sdk_error.txt`. Fix: `default-members = ["harness", "host"]` in the root
   `Cargo.toml`, and `scripts/build_all.sh` for everything.
2. **Slow network looked like a hang.** Crate downloads ran at about 18 KB/s per connection over IPv4; IPv6 to the crate
   server does not connect. Details and measurements in `docs/DEVLOG.md` (2026-10-23). Cargo was set, for the build shell only,
   to `CARGO_HTTP_MULTIPLEXING=false CARGO_HTTP_TIMEOUT=60 CARGO_NET_RETRY=10 CARGO_NET_GIT_FETCH_WITH_CLI=true`.

### (b) Hello world contract deploys to testnet and runs: PASS

Account: `kintsugi-djloo.testnet` (NEAR testnet; no real money).

```bash
near contract deploy kintsugi-djloo.testnet use-file target/near/kintsugi_contract/kintsugi_contract.wasm without-init-call network-config testnet sign-with-legacy-keychain send
near contract call-function as-read-only kintsugi-djloo.testnet get_greeting json-args '{}' network-config testnet now
near contract call-function as-transaction kintsugi-djloo.testnet set_greeting json-args '{"greeting":"hello from S0"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as kintsugi-djloo.testnet network-config testnet sign-with-legacy-keychain send
near contract call-function as-read-only kintsugi-djloo.testnet get_greeting json-args '{}' network-config testnet now
```

| Step | Result | Transaction | Gas burned | Wall time |
| --- | --- | --- | --- | --- |
| Deploy | "Contract code has been successfully deployed." Code hash on chain `77VBZH68nvpkTCqTsckjAoZu8vTS5jYZ5A44qUCBhpXn` = the wasm's bs58 SHA-256 printed by cargo-near | [`6nNNsGGHEVBbAJmAyU8TGEd7tfC8fEnYSxx3uoG5SVJj`](https://explorer.testnet.near.org/transactions/6nNNsGGHEVBbAJmAyU8TGEd7tfC8fEnYSxx3uoG5SVJj) | 0.878 Tgas | 6.39 s |
| View `get_greeting` | `"hello from kintsugi"` | (view, no transaction) | | 8.13 s |
| Call `set_greeting` | Log: `greeting set by kintsugi-djloo.testnet at block 274454082` | [`4xrdsVRocd8iEWmULFRAAHPgnPkZRZb9iDgcVm4kJby6`](https://explorer.testnet.near.org/transactions/4xrdsVRocd8iEWmULFRAAHPgnPkZRZb9iDgcVm4kJby6) | 0.309 Tgas | 5.75 s |
| View `get_greeting` | `"hello from S0"` | (view, no transaction) | | 2.03 s |

Output: `docs/evidence/S0/b_deploy.txt`, `docs/evidence/S0/b_calls.txt`. On the same day the S3 bounty contract replaced this
hello world contract on the same account, so these calls no longer work today; the transactions above remain on chain. The
wall times include the CLI's own network round
trips; they are not block times (block time is measured in S3).

### (c) Hello world proof is generated and verified locally: PASS

```bash
RISC0_DEV_MODE=0 ./target/release/kintsugi-host kintsugi
```

`RISC0_DEV_MODE=0` is set on purpose: RISC Zero's dev mode makes fake receipts, and this run must not use it. Proving runs on
this machine through the installed `r0vm` 3.0.6; the host is built without the remote proving feature.

| Field | Value |
| --- | --- |
| Journal (public output) | `hello, kintsugi` |
| Image id (guest fingerprint) | `2cf67c95daf4745939443d2c3772891a0e0e02d04fb0a5196cc9508e917f31fc` |
| Total cycles | 32,768 |
| Segments | 1 |
| Prove time | 5.03 s |
| Verify time | 0.030 s |
| Verified | true |
| Whole run | 5.05 s, peak memory 318,004 KB (`/usr/bin/time -f %M`) |

Output: `docs/evidence/S0/c_prove.txt`. This is a tiny program; it says nothing yet about the harness's proving time (S2).
