# Evidence

One section per spike: the question, the commands, the raw output (or the path to it), the verdict, and the fallback used if it
failed. Failures stay in this file. Times are wall clock on the development machine (Ubuntu 26.04.1 under WSL2, x86_64,
16 cores, 10 GiB RAM for WSL) unless stated otherwise. Raw output is in `docs/evidence/<spike>/`, with local paths replaced
by `<repo>` and `~`.

## Official demo: Level 2 bounty 7 on `kintsugi-l2-cihdp.testnet`

This is the main demo. Bounty 7 on the S6c contract `kintsugi-l2-cihdp.testnet` is a Level 2 bounty: it is opened and
decided only by Groth16 proofs the contract checks itself (section S6c). It reuses the demo's Groth16 Proof 0 (image
id `dd6c5f42...`, journal `fb7939dc...`) and is open for 30 days. **It is a demo**: Proof 0 was made with the public
fixed demo salt, so the secret's commitment (`9a1be994...`) is a plain fingerprint of the secret (docs/SECURITY.md,
known limits). The older bounties (S4, S7, S13 and demo bounty 4 on `kintsugi-s13-tlryo.testnet`) stay as history.

| Step | Command | Result |
|---|---|---|
| create (0.5 NEAR, level 2, K = 3, check size 16 / 32, expires after 30 days) | `./scripts/s6c_testnet.sh demo` | tx `CRoeYBpDgULtH32NeZNAtb3xWvswnoSRZFmYDUDFrtd3`; expires 2026-11-24 00:19 UTC (`docs/evidence/S6c/demo_bounty.json`) |
| open with the reused Groth16 Proof 0 | (same phase) | tx `DxutukERDxo3DwhgSXueD5NWpJKySbnpuhVPdHadcS8R`; opened |
| rebuild the checker and compare | `./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 7` (`docs/evidence/S6c/demo_check_image_id.txt`) | below |

```
$ ./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 7
rebuilt checker image id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
image id of bounty 7 on kintsugi-l2-cihdp.testnet: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
MATCH
```

Private salt by default (since this demo): `kintsugi-host execute` and `prove` now need `--bounty <name>` (a private
random 32 byte salt per bounty, made on first use in ~/.kintsugi-salts/<name>.salt with mode 600 and reused for
every proof of that bounty) or `--demo-salt` (the public demo salt; every demo script passes it). Tested with
`execute` (`docs/evidence/salt/salt_selftest.txt`): no flag and both flags are refused; `--demo-salt` gives the demo
commitment `9a1be994...`; a new bounty name gives a new commitment (`fe5e6cc9...`), the same name gives it again, a
second name gives another (`5c1ab049...`); folder mode 700, file mode 600, 32 bytes; a salt file readable by others
(mode 644) is refused; the salt value appears in no output.

## S6c (Level 2 in the bounty contract): proofs decide bounties, no verifier signatures

Question: can the bounty contract itself decide a bounty from a Groth16 proof, open it with a Groth16 Proof 0, refuse
every replayed or changed proof, and keep the Level 0 path working? Contract `kintsugi-l2-cihdp.testnet` (new faucet
account, tx `5u1X1pMWZZU66X6W82hJtmrbA8mMH58KnzgSLJUzrEiC`); not the S13 contract and not the S6b spike, both unchanged.
Script `./scripts/s6c_testnet.sh <phase>`; every transaction in `docs/evidence/S6c/transactions.tsv` and `steps/`.

**Verdict: PASS (2026-10-24 to 25).** With real Groth16 receipts under the reproducible image id `dd6c5f42...`: a Level 2
bounty opened from its Groth16 Proof 0; a FAIL proof spent its attempt; a PASS proof paid its researcher; all nine
attacks below were refused on chain; a Level 0 bounty still opened with two verifier attestations.

Design (owner's choices, 2026-10-24): a Level 2 bounty takes ONLY Groth16 proofs (the Level 0 calls refuse it); its
attempt fees from revealed attempts go to the vendor at expiry; every new bounty stores `fuzz_count` and
`variant_count`, which the Level 2 path requires and the Level 0 verifier script now checks too; the demo's Groth16
Proof 0 is reused (its journal does not depend on the bounty). Each method decodes the journal, checks the proof, then
checks the journal's fields, so a changed proof or journal is caught by the proof check and a valid proof used in the
wrong place by the field checks. The journal layout the contract relies on is in docs/ARCHITECTURE.md ("Level 2 path"),
confirmed from the guest source and the real Proof 0 journal.

Unit tests (`cargo test -p kintsugi-contract --offline`): 71 passed, including 10 Level 2 tests with the real Proof 0
Groth16 receipt (`contract/src/tests_level2.rs`) and the protocol fee pool tests.

Contract wasm: `cf61a43f...0121` (297,708 bytes) for the attack runs, then `396d14e0...5aad` (298,860 bytes, the fee pool)
redeployed in place (tx `DwMvVopM2BGSWFb4PH1LvXhJC7cyiWdbJY8qcAua1uhL`; the pool is its own storage entry, the stored
layout did not change; bounty A still read Paid afterwards).

Level 0 keeps working (`level0`): bounty 0, level 0, opened after two verifiers checked Proof 0 (`verifier_check.sh`,
12 of 12 checks, now including fuzz_count and variant_count) and attested (txs `4hh4VdCJ1NLnQTcMmgqacPPufAQfypv2jG8mMPrJJS7V`,
`93GAVpjnvoocwQzN8HRncSMKGz8mYd5bqjLFj9SqETqm`).

Level 2 bounty A (bounty 1, `bounty_a`): created (tx `h2LfFz5N24AezQymZ5d6mshgS7VYN1XaND6sPQFEKMg`), opened by
`open_with_groth16` with the demo's Groth16 Proof 0 (tx `E3RTxNVVVGvV2NNTFcMgwNgKagpHPmMnsNBNbu1ZoCx8`, 35.225 Tgas). A
verifier's `attest_proof0` (tx `Bv4py6KX8Cf5YaEdDBT6nELKrteuxEdB4CywRpxdAo9y`) and the vendor's `post_verdict` (tx
`631e2mRUDmLigsGB8G5DbZySZeXzWYkbKrvQhHfvkww7`) were refused: "this is a Level 2 bounty". Attempt A0 (the honest fix,
researcher 1) and A1 (`data/attacks/reject_all.wasm`, researcher 2) committed and revealed.

Proofs on the laptop, each run alone (expected times from `kintsugi-host execute` cycle counts: A0 26 segments,
A1 3 segments), Groth16 step memory sampled as in S6:

| Attempt | Prove | Compress to succinct | Groth16 | Result |
|---|---|---|---|---|
| A1, `reject_all.wasm` | 345.05 s, 3 segments, peak 4,704 MiB | 89.83 s | 129.44 s, 2,057 bytes, container peak 7,325 MiB, laptop available at lowest 884 MiB | VALID under `dd6c5f42...`, FAIL, seed and submission id equal the chain's |
| A0, `data/demo/fixed.wasm` | 3,150.11 s, 26 segments, peak 4,725 MiB | 1,016.71 s | 148.69 s, 2,057 bytes, container peak 6,832 MiB, lowest available 1,010 MiB | VALID under `dd6c5f42...`, PASS, seed and submission id equal the chain's |

The decisions and the attacks (`attacks`; gas from the RPC, `gas_level2.txt`):

| Call | Transaction | Result | Gas burnt |
|---|---|---|---|
| A1's real FAIL proof for A1 | `6B9ocDasU1BZU28fshj6D72DkA8VCmar1ePNp9m3vtca` | accepted, attempt spent (outcome Failed) | 35.603 Tgas |
| A0's real PASS proof for A0 | `CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY` | accepted, bounty Paid, researcher 1 +0.11 NEAR (0.1 NEAR bounty + own 0.01 NEAR fee) | 36.392 Tgas |
| attack: A0's PASS proof for attempt A1 (another attempt) | `3ULvszXnfJAF8sbFejCKvbxftPK2b13rT2fP8y4JEANT` | refused: "the journal belongs to another bounty or attempt (submission id)" | 34.893 Tgas |
| attack: A1's FAIL journal with the verdict set to PASS | `JDZNSTe72dqrppmqye5gnTxfQ52GNaDEBJ9Z4hZa5HT` | refused: "the Groth16 proof does not verify for this bounty's image id and this journal" | 34.877 Tgas |
| attack: one flipped bit in A0's seal | `GibfrVyGKT2ymUs6W87aF5jwyRByAZ6StDxBFscy3ET7` | refused: "AltBn128 invalid input: invalid g1" | 34.852 Tgas |
| attack: A0's journal with fuzz_count changed | `4Sde4NuTQobypV3x7uC8AgcnSNrZpuqG3NeuTVHkMYZG` | refused: the proof does not verify | 34.883 Tgas |
| attack: wrong image id (bounty D names `043ec633...`; the real Proof 0 offered) | `4N6oi9MpDii4Vdf4uDLPSVegBsqPYYs4BQP1WzprAy2C` | refused: the proof does not verify | 34.777 Tgas |
| attack: A1's FAIL proof again | `EmKG8Sm96NZ7NzrD9DDQ5fm8ouAzn6Eg8vTPV4KRHhym` | refused: "verdict already final" | 2.193 Tgas |
| attack: A0's proof for bounty B's attempt (another bounty, same patch) | `GfZXvdiG1mcRUK1NNTQxdCfBqHMMExLiFWYgoznaKFvS` | refused: "the journal belongs to another bounty or attempt (submission id)" | 34.900 Tgas |
| attack: A0's PASS proof again after payout | `GiHbmMMR7gsZNzKNbzU1eB9SSTreN4Up3JX4DSHotRGs` | refused: "bounty is closed" | 2.103 Tgas |
| attack: A0's proof for bounty C after C expired | `E5DFg1TVhtDoFQjL5GdpfsSeJRBrBobX6GprTirYnrwp` | refused: "bounty has expired" | 2.104 Tgas |

Bounty C then shows the Level 2 timeout: no proof came, so `claim_timeout` paid researcher 1 the 0.1 NEAR bounty and
refunded the fee (tx `2Ga3oSGcrgfMdbKoLCEUK8FwGrpnqMk9ex2Kp2oj6Tiq`); the following `expire` had nothing left to do
("nothing to do: bounty already closed and fees already swept", `steps/c_expire.txt`). My expectation that C's fee would
reach the vendor was wrong: the timeout refunds it to the researcher.

Protocol fee pool and the self-block test (owner's rule: fees of commits that are never revealed go to a pool that
nobody can take out of yet). The rule is one function, `release_to_pool` in `contract/src/lib.rs`, used by
`release_unrevealed` and, for commits still unreleased at the end, by `expire` before it pays out any fee; the pool is
shown by `get_protocol_pool`. The test (`selfblock2`): the vendor funds a second account it controls
(`sybil.kintsugi-vendor-prnvm.testnet`), which takes all K = 3 slots of Level 2 bounty S2 with commits it never
reveals (txs `64epreebuQam5azfeBPJorLM3rQEZmFSzxzpRmsnqcjE`, `BV8aHFzCuKWLm5Z1X1b4Qk2AnsyWCnMJnFtMcvCmzVL8`,
`3hiPvqjJ18spcVwaP5qFwKmsB3tG8mcFtqhoYD3keKQ5`); an honest commit is ignored (tx `PjQBWCTmt4nAbwAQyT3Kn8UKt18nzpCzfKtbtn9HYpn`,
commits stay 3); one junk fee goes to the pool at `release_unrevealed` (tx `mpBhiyx6w9RxjpMSbcuKVty67hFZCTX7x6K3qQd57zg`),
the other two at `expire` (tx `8LxACsYPrMQ71kHCjDhcdt9uH9ATJNn9qrjbLMRjfVW8`). Measured (`selfblock2_balances.txt`):

| | Before | After |
|---|---|---|
| vendor + second account + its credit | 4.880039 NEAR | 4.934209 NEAR (+0.054170) |
| of which | | +0.100000 bounty refunded at expiry, -0.045000 attempt fees, -0.000830 gas (vendor 0.000045, second account 0.000785) |
| protocol fee pool | 0.010000 NEAR | 0.055000 NEAR (+0.045000, equal to the attempt fees spent) |

The computed change equals the measured one (difference 0.000000 NEAR). The vendor side lost 0.045 NEAR in fees plus
0.000830 NEAR in gas, and got nothing back from the block. A first self-block run (`selfblock`) stopped before any junk
commit: I funded the second account with 0.05 NEAR and near-cli refused to send its commits ("does not have enough
balance (0.05 NEAR) to cover TX cost (0.1009... NEAR)"); in that run the honest researcher's commit took the slot and,
never revealed, was released: that is the pool's first 0.01 NEAR (tx `BSuwfFeEuFYpMNxHPAgzA4N8SK1Vo6hgnsZvDKdcewrV`).

## S6b (Level 2, spike): a NEAR contract checks the Groth16 proof itself

Question: can a NEAR contract check a RISC Zero Groth16 proof with NEAR's own alt_bn128 host functions, accept the real
proof, reject changed ones, and what does it cost in gas? A spike: a separate contract on a throwaway account, not the
bounty contract and not connected to any payout. Raw output: `docs/evidence/S6b/`.

**Verdict: PASS (2026-10-24).** On testnet, `verify_groth16` accepted the real Groth16 receipt of the demo Proof 0
(image id `dd6c5f42...`) and rejected a flipped seal bit, a changed journal and a wrong image id. The host functions
were enough. Real gas: 34.569 Tgas burnt per call (33.934 Tgas in the contract), against the design note's estimate of
about 32.4 TGas for the curve work alone.

How it works (`verifier/groth16-near/src/lib.rs`, following RISC Zero's verifier: risc0-groth16 3.0.5
`src/verifier.rs`, `src/lib.rs`, `src/types.rs`; risc0-zkvm 3.0.6 `src/claim/receipt.rs`; risc0-binfmt 3.0.5
`src/hash.rs`): the contract computes the claim digest of a normal successful run from the image id and the journal
with `env::sha256`; builds the five public numbers (control root and claim digest, each in two 128 bit halves, and the
BN254 control id); computes vk_x with one `alt_bn128_g1_multiexp` over five items and one `alt_bn128_g1_sum`; negates A
with `alt_bn128_g1_sum`; and calls `alt_bn128_pairing_check` over four pairs. The verifying key and the two fixed
constants are in `verifier/groth16-near/src/vk.rs`, generated by `scripts/gen_groth16_vk.py` from RISC Zero's
`verifier.rs` and from `kintsugi-host groth16-args`, which reads the control root and BN254 control id from RISC Zero's
library (both equal its defaults: `a54dc85a...`, `c07a6514...`, `groth16_args.json`).

Checks before the chain:
- The claim digest formula, recomputed in Python, equals RISC Zero's own (`5ffb333c...d27c`).
- `cargo test -p kintsugi-groth16-spike` (`unit_tests.txt`): 3 passed with near-sdk's native host functions: the real
  receipt is accepted, a changed journal and a wrong image id are rejected. A flipped seal bit cannot be tested
  natively: the host function's error aborts the test process (near-sdk's mocked host functions cannot unwind), so
  that case was tested on testnet only.

On testnet (`./scripts/s6b_testnet.sh setup`, `calls`, `gas`): contract `kintsugi-g16-bkexe.testnet` (new faucet
account, tx `9YyVb9bEWD4YAnHHUBnbGb6Cu4X68TiBXNxndMPSzdP6`; wasm 86,084 bytes, SHA-256 `34469c50...94b0`, deploy tx
`ERq3KynSwJknoGucZU2EZhRnSrYSFFPN3qHeMBSFdd1D`). Every call signed by `kintsugi-res2-prnvm.testnet` with 300 Tgas
attached; gas read from the RPC (`EXPERIMENTAL_tx_status`, every receipt's `gas_burnt`, `gas.txt`):

| Call | Transaction | Result | Gas burnt (total / in the contract) |
|---|---|---|---|
| the real seal, image id `dd6c5f42...`, the real journal | `Drcc1yqpnRvqNpijG7yFAnum2JL7fEC8WqN5hJL8ZSEa` | **accepted**: returns `true`, log "groth16 check: ACCEPTED" | 34.569 / 33.934 Tgas |
| the lowest bit of the last seal byte flipped (C's y) | `27apv9ycc5tusMnkNZp4fhSxKiygsRv7rvyUpFsALAon` | **rejected**: the call fails, "AltBn128 invalid input: invalid g1" (C is no longer on the curve) | 34.506 / 33.870 Tgas |
| the last journal byte changed | `8rNyroUjHytT6YBXiAVANibDWtwVS8z24vcsVPpmRKYA` | **rejected**: returns `false`, log "REJECTED" | 34.569 / 33.934 Tgas |
| S13's image id `043ec633...` instead of `dd6c5f42...` | `EstMiDDSzX6b32XSNBV6cBNc4r19qramBauAeSCPst7Q` | **rejected**: returns `false`, log "REJECTED" | 34.569 / 33.934 Tgas |

Gas against the estimate: the contract's own log (from `env::used_gas()`) splits the check into claim digest
0.156 Tgas, multiexp and sum 2.357 Tgas, pairing check 30.136 Tgas, 32.978 Tgas up to the end of the pairing check;
the estimate from NEAR's configured prices was 30.094 + 2.313 + a small sum, about 32.4 TGas. The whole call burnt
34.569 Tgas, about 2.2 Tgas (7%) more than the estimate: reading the arguments, decoding hex, building the inputs and
returning the result. That is about 3.5% of the 1,000 TGas a transaction may attach.

Not done: connecting this check to the bounty contract or its payouts; checking that the journal's fields match a
bounty and a submission (the bounty contract's job); tampered values other than these three.

## S6 (Level 2, feasibility): Groth16 compression on the laptop

Question: can this laptop shrink a receipt into a Groth16 proof (the small proof a contract could check itself), how
long does it take, how much memory does it need, and does the result verify against the reproducible image id? No
rental. Raw output: `docs/evidence/S6/`. The contract was not changed; the on-chain design is a note in
docs/ARCHITECTURE.md ("Design note: the contract checking the proof itself").

**Verdict: PASS (2026-10-24), feasibility only.** The demo Proof 0 receipt became a 2,057 byte Groth16 receipt in
187.91 s, and it verifies off chain against `dd6c5f42...` (VALID). Memory was tight: the Groth16 container reached
7,061 MiB and the laptop's available memory fell to 801 MiB.

What RISC Zero's own sources say it needs: x86 and Docker ("Proving with Groth16 is currently only supported using
Docker", `risc0-groth16` 3.0.5 `src/prove/docker.rs`; "requires an x86 architecture and Docker installed",
`risc0-groth16` README). The Docker image is `risczero/risc0-groth16-prover:v2025-04-03.1` (same file). RISC Zero states
no memory figure for it: checked the `groth16_proof` README and its `prover.Dockerfile` at v3.0.6 (copies in
`docs/evidence/S6/`), the local-proving page on dev.risczero.com (its only memory note, "less than 10 GB", is about
segment size in general), and issue #1749 ("the prover key required is rather large (many GB)"). So the number below
is measured here, not quoted.

| Step | Command | Result |
|---|---|---|
| this laptop | `free -h`, `df -h /`, `docker run --rm hello-world` | 10 GiB RAM for WSL (7.5 GiB available before the run), 8 GiB swap, 719 GB free disk, 16 CPUs, Docker 29.1.3 works |
| prover image | `docker pull risczero/risc0-groth16-prover:v2025-04-03.1` (`docker_pull_groth16.log`) | 2.40 GB in 1,858.6 s, about 1.3 MB/s; digest `sha256:a4f80ce2...64ee` |
| compress to Groth16, alone | `MIN_AVAIL_MIB=700 MAX_SECONDS=3600 scripts/s2_measure.sh target/s6/compress_groth16.log -- ./target/release/kintsugi-host compress target/demo/proof0_succinct.bin target/s6/proof0_groth16.bin groth16` (`compress_groth16.log`) | compress 187.91 s (wall 189.07 s); output 2,057 bytes (SHA-256 `06b8eac4...e003`); r0vm peak 1,410 MiB |
| container memory, sampled about every 2 to 4 s by `watch_mem.sh` (`mem_samples.log`, 28 samples) | `docker stats` on the prover container, plus the laptop's available memory | container peak 7,061 MiB; laptop available memory at its lowest 801 MiB (the run would have been stopped below 700 MiB; it was not) |
| verify off chain | `./target/release/kintsugi-host verify target/s6/proof0_groth16.bin` (`verify_groth16.txt`) | VALID, image id `dd6c5f42...`, journal SHA-256 `fb7939dc...` (the same journal as the succinct receipt), verdict PASS, 0.011 s |

Notes:
- The input was the reproducible-build Proof 0 of the demo bounty (`target/demo/proof0_succinct.bin`, 224,786 bytes).
- The memory peak is a sample, so the true peak may be somewhat higher. With 10 GiB for WSL there was about 0.8 GiB
  left; a machine with less memory, or other programs running, may not finish.
- `kintsugi-host tamper` does not handle Groth16 receipts ("unsupported receipt kind", `verify_groth16_tampered.txt`),
  so no tampered Groth16 receipt was tested.
- Not done: any on-chain verification, any contract change, any gas measurement.

## Demo bounty with the reproducible image id: anyone can rebuild the checker and get a MATCH

History: this was the first demo bounty (Level 0). The main demo is now Level 2 bounty 7 (section "Official demo").

Question: can a judge rebuild the checker from this repository and get the exact image id a bounty on the contract
holds? Raw output: `docs/evidence/demo/`.

**Verdict: PASS (2026-10-24).** Bounty 4 on `kintsugi-s13-tlryo.testnet` holds the reproducible image id
`dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc`; its Proof 0 was made with that build, two
verifiers checked it against the chain and attested it, and `./scripts/check_image_id.sh kintsugi-s13-tlryo.testnet 4`
prints MATCH.

| Step | Command | Result |
|---|---|---|
| Proof 0 with the reproducible build (`harness/build.rs`), reference fix, 16 inputs, 32 variants, `--po2 19`, S1 seed | `scripts/s2_measure.sh ... kintsugi-host prove data/demo/fixed.wasm --proof0 ...` (`prove_proof0.log`) | 4,312.55 s, prover peak 4,724 MiB |
| compress to succinct | `kintsugi-host compress ... succinct` (`compress_proof0.log`) | 1,388.17 s, peak 1,487 MiB, 224,786 bytes, SHA-256 `1175f615...f308` |
| verify | `kintsugi-host verify target/demo/proof0_succinct.bin` (`verify_proof0.txt`) | VALID, image id `dd6c5f42...`, verdict PASS, journal SHA-256 `fb7939dc...3ec5` |
| create bounty 4 (0.5 NEAR, K = 3, expires after 30 days) | `./scripts/demo_bounty.sh create` | tx `EozokvC2Y6UZHMXpkHzajUdJwwdop86GhzZp2wGHitf5`; created 2026-10-24 19:53 UTC, expires 2026-11-23 19:53 UTC (`bounty4.txt`) |
| two verifiers check Proof 0 against the chain and attest | `./scripts/demo_bounty.sh open` (`steps/proof0_check_*.txt`: ATTEST) | txs `Ax3Xrs5k6P81yWTzYB6VMTSN6eCTA9G5PscTxWKyCJL4` (`kintsugi-ver1-prnvm.testnet`), `4DiVnxn1UHoVVsT8HoNQVzHzEbi2TfYsWjTj1Ebfqcs4` (`kintsugi-ver2-prnvm.testnet`); bounty opened |
| rebuild and compare | `./scripts/demo_bounty.sh check` (`check_image_id.txt`) | below |

```
$ ./scripts/check_image_id.sh kintsugi-s13-tlryo.testnet 4
rebuilt checker image id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
image id of bounty 4 on kintsugi-s13-tlryo.testnet: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
MATCH
```

Notes:
- The journal SHA-256 is the same as S13's Proof 0 (`fb7939dc...`): the journal holds the inputs and the verdict, not
  the image id, so the same check with the same inputs gives the same journal under either build. The receipt verifies
  only against its own image id.
- This Proof 0 took 4,312.55 s; S13's (plain build) took 4,983.54 s. The cause of the difference was not measured.
- The MATCH was shown on the laptop that made the proof; a rebuild on a second machine was not done.
- Prebuilt guest mode (for a GPU machine without Docker), tested on the laptop: `./scripts/export_guests.sh` (guest file
  SHA-256 `4741ef15...eb0a`), then `KINTSUGI_PREBUILT_GUESTS=target/prebuilt-guests CARGO_TARGET_DIR=target/prebuilt-test
  cargo build --release -p kintsugi-harness` embedded the files with the same ids (`dd6c5f42...`, hello world
  `a8bf1d82...`), compiled no guest, and finished in 26.72 s (`docs/evidence/repro/prebuilt_test.log`);
  `r0vm --id --elf target/prebuilt-guests/check_guest.bin` gives `dd6c5f42...` too (`r0vm_id_check_guest.txt`). Not
  run on a GPU machine yet.

## Image id: why the GPU build differed, and a reproducible build

Question: the GPU pod's proof of commit `1439e37` had image id `dfd48a5e...`, not the laptop's `3edbc2e6...`. Does a
plain guest build depend on the folder or the user that builds it, and does RISC Zero's reproducible (Docker) build give
one stable id? Logs: `docs/evidence/repro/`. All on the laptop, no rental.

**Verdict: yes and yes (2026-10-24).** A plain build embeds the source folder and the user's home folder in the guest,
so its image id changes with either. The reproducible build gives one id regardless of folder and user. It is now the
official way to build the checker (`harness/build.rs`), and `./scripts/check_image_id.sh` rebuilds it and compares the
id with a bounty on the contract.

Plain build (`cargo build --release -p kintsugi-harness`, ids read from the generated `methods.rs` with
`python3 scripts/image_ids.py`), commit `1439e37`:

| Where it was built | Checker image id | Hello world image id |
|---|---|---|
| repository root on the laptop (S2b, S4, S7) | `3edbc2e6...` | `2cf67c95...` |
| `<repo>/target/gpu-src` on the laptop (`plain_path_b.log`) | `e4f79e003398c0d0e1b48eb35d64272cc1c188919d48630652ce62cbe274d4e3` | `2cf67c95...` |
| the same folder, with another home folder (`HOME` moved; `plain_alt_user_home.log`) | `4b1947dd04070b3d3ebe99d3a6db47edc008edb2642ab0b63bde2cfb407e3021` | `e9b7926cdb68d9d6840f4e30926ee834314275cf58b96763ac5c5fa277c37a42` |
| `/root/kintsugi` on the GPU pod | `dfd48a5e...` | not read |

Why: the compiled checker guest holds 74 strings with full paths (`strings` on the ELF): source file paths under the
build folder and paths into the user's cargo download folder (`~/.cargo/registry/...`), kept for panic messages. A
first try to imitate another user by moving only `CARGO_HOME` did not change anything, because risc0-build removes every
`CARGO...` variable before it builds a guest; moving `HOME` did (`plain_alt_home.log` is that first, invalid try).

Reproducible build: `cargo risczero build --manifest-path harness/check-guest/Cargo.toml` with
`RISC0_DOCKER_CONTAINER_TAG=r0.1.97.0` (`repro_*.log`). It needs Docker's buildx plugin (installed into the home folder,
v0.38.1, SHA-256 checked, on the owner's go). RISC Zero's default builder image for 3.0.6, `r0.1.88.0`, could not build
this code ("rustc 1.88.0-dev is not supported": `ruint` 1.21.1 needs Rust 1.90); `r0.1.97.0` matches the guest Rust
1.97.0 used on the laptop.

| Source | Folder, user | Checker image id |
|---|---|---|
| `1439e37` | `<repo>/target/gpu-src` | `24c33bc557180e894a3d2ffe3ac19b35bbe9d04ab2bcbdedf6a03723f64c66bf` |
| `1439e37` | `<repo>/target/repro/other-place/a` | `24c33bc5...` (output file SHA-256 `1fc93b50...` in both folders) |
| `1439e37` | the same, with another home folder | `24c33bc5...` |
| current code (`9a5838a`, the S13 checker) | `<repo>/target/repro/s13-src` | `dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc` |
| current code, built by `harness/build.rs` | repository root | `dd6c5f42...` (`official_build_repo.log`) |

The second and third `1439e37` builds were served from Docker's build cache: the files sent to Docker were the same,
and the folder and home are not inputs to it. The reproducible guest holds no laptop path at all (0 strings with
the laptop's home folder; only `/src` and `/root/.cargo`, fixed inside the image). Not tried: a reproducible build on a second machine.

What this changes:
- S13's checker has id `043ec633...` from a plain build on the laptop; under the reproducible build the same code has
  `dd6c5f42...`. Bounties already on chain (S4, S7, S13) keep their old ids. Their receipts can still be checked against
  those ids with `farbox-verifier` or `kintsugi-host verify` built the old way, but nobody can rebuild those ids from the
  source. `./scripts/check_image_id.sh kintsugi-s13-tlryo.testnet 0` prints the rebuilt id, the bounty's id
  `043ec633...`, and DIFFERENT (`check_image_id_s13_bounty0.log`).
- New bounties should be created with the reproducible id: the demo bounty 4 is the first (section above).
- The GPU result (22.65 s) used a plain build on the pod; a like for like number needs the reproducible build on both
  machines.
- Docker downloads were slow: the `r0.1.88.0` image (1.60 GB) took 804 s, about 2.0 MB/s, and `r0.1.97.0` (1.73 GB)
  took 1,116 s, about 1.5 MB/s (`docker_pull*.log`; sizes are unpacked, so the network speed was lower).

## S2 on a GPU: the 16 input proof on a rented RunPod pod (S6 preparation)

Question: how long does the same 16 input proof take on an NVIDIA GPU, against the laptop baseline of **2,814.45 s
(46.9 min), S2b, commit `5ba0298`**? The pod was to prove commit `1439e37` (same guest program, image id `3edbc2e6...`).

**Verdict: the proof ran on the GPU in 22.65 s (laptop baseline 2,814.45 s), but it is NOT a like for like result: its
image id is `dfd48a5e39296bf288baf8df898c8e8ab00d793a2d16ee3d9f3564f8804d7633`, not `3edbc2e6...`, so under the
owner's rule the run stopped there (no verify, no compression).** The first attempt (three builds) failed; the owner's
final attempt, with a changed build, made the proof. Details of both below.

Machine (`docs/evidence/S2/gpu/01_check.log`): RunPod pod, NVIDIA L40S with 46,068 MiB, driver 595.91.07, nvcc 12.8.93
already installed, Ubuntu 24.04.5, root. Every step was sent over ssh from the laptop and logged, stopping at the first
failure (IP address and port removed from the copies in `docs/evidence/S2/gpu/`).

| Step | Seconds since start (16:45:12 UTC) | Result |
|---|---|---|
| check | 5 | ok |
| cuda | 24 | nvcc present, nothing installed |
| apt, rust (1.99.1) | 48 | ok |
| rzup (cargo-risczero 3.0.6, r0vm 3.0.6, guest Rust 1.97.0, risc0-groth16 0.1.0) | 557 | ok |
| code (git archive of `1439e37`, scp, unpack) | 607 | ok |
| build try 1 | 667 | **failed**: `circom-witnesscalc v0.2.1` build script: "Could not find `protoc`" |
| build try 2 | 991 | **failed**, same error: my script retried without changing anything (a flaw, now fixed: a failed try saves a fingerprint of the setup and the next try refuses to start until it has changed) |
| apt with `protobuf-compiler` (owner's go) | 1,085 | ok, `libprotoc 3.21.12` |
| build try 3 (setup fingerprint changed) | 1,110 | **failed**: same crate, bindgen: "Unable to find libclang" |

### Final attempt (owner's go, hard limit 30 minutes from 17:06:55 UTC)

What changed: (1) all build dependencies installed in one step (`04_deps_all.log`: `protobuf-compiler`, `libclang-dev`,
`clang`, `cmake`, `pkg-config`, `libssl-dev`, `build-essential`; protoc 3.21.12, clang 18.1.3, cmake 3.28.3). (2) A build
WITHOUT RISC Zero's GPU Groth16 part: `risc0-zkvm`'s `cuda` feature switches on `risc0-groth16/cuda`, which pulls in
`circom-witnesscalc`; `risc0-zkvm` 3.0.6 uses its own `cuda` flag only in tests and docs, and the GPU prover is chosen in
the circuit crates. So the pod's copy of `host/Cargo.toml` got a feature `cuda-prove-only` = `risc0-zkvm/prove` plus the
`cuda` features of `risc0-zkp` 3.0.5, `risc0-circuit-rv32im` 4.0.5, `risc0-circuit-recursion` 4.0.5 and
`risc0-circuit-keccak` 4.0.6 (the exact change: `docs/evidence/S2/gpu/cuda_prove_only.patch`; it was made only on the
pod's copy of `1439e37` and is not in this repository's code). `cargo tree -p kintsugi-host --features cuda-prove-only
-i circom-witnesscalc` answered "did not match any packages" (`05_patch.log`).

| Step | Time (UTC) | Result |
|---|---|---|
| `cargo build --release -p kintsugi-host --features cuda-prove-only` | 17:08:26 to 17:09:23 | ok, 57.10 s (`06_build_prove_only.log`) |
| prove, 16 inputs, 32 variants, `--po2 19`, `RISC0_PROVER=local` (`01_prove.log`, `prove_f16.log`, `gpu_samples.csv`) | 17:09:47 to 17:10:15 | **prove seconds 22.65** (wall 23.50 s), 26 segments, composite receipt 6,971,396 bytes, journal verdict PASS, peak GPU memory 9,291 MiB (sampled every 0.5 s), host `max_rss_kb` 513,324 |
| image id check | | **`dfd48a5e...` instead of `3edbc2e6...`: stopped** |

Against the baseline: 22.65 s on the GPU against 2,814.45 s on the laptop CPU, about 124 times faster, but only if the
two proofs are of the same program, which the image id does not confirm. What does match: the journal fields
(candidate hash `42edaaf5...`, original hash, exploit commitment, corpus hash, 16 inputs, 32 variants, PASS), the segment
count (26) and the receipt size (6,971,396 bytes, the same as the laptop's S4 receipt of the same check). The likely
cause of the different id, NOT verified: the guest program was compiled on the pod, and a compiled RISC Zero guest can
embed its build paths (`/root/kintsugi` on the pod, the home folder on the laptop), which changes the image id even with
the same source. RISC Zero's reproducible guest build (`cargo risczero build`, in Docker) would settle it; not tried.
Not done because of the stop: `verify`, the succinct compression, and Groth16 (not possible in this build anyway).

The receipt is in `target/gpu-results/receipt_f16.bin` on the laptop (SHA-256 `9cc7c4a5...d8ff`, not committed).
Time on the pod for both attempts: 16:45:12 to 17:10:42 UTC, about 25.5 minutes of use by the test steps.

**Cost (reported by the owner from RunPod):** the pod ran about 30 minutes in total, from when the owner started it
until it was stopped and terminated; the RunPod balance went from $10.00 to $9.52, so the whole GPU test (both
attempts) cost about **$0.48**. The pod is terminated.

`circom-witnesscalc` comes in with RISC Zero's GPU Groth16 prover when `risc0-zkvm` is built with `cuda`. Its build needs
`protoc` and `libclang`; neither is in the CUDA template. The final attempt above installed both. Total cost of the GPU test: about $0.48 (see the final attempt).

## S13: Attack pass on the hardened contract and checker

Question: do the S13 guards hold on testnet against the attacks listed in docs/SECURITY.md? Contract
`kintsugi-s13-tlryo.testnet` (wasm SHA-256 `faddf08d...4f95`, `docs/evidence/S13/contract_wasm.txt`), checker guest image
id `043ec633...7f8d`. Script `./scripts/s13_attacks.sh <phase>`; every transaction is in
`docs/evidence/S13/transactions.tsv` and `docs/evidence/S13/steps/`.

**Verdict: PASS (2026-10-24).** Every attack below is blocked on testnet, except attack 3, which is an accepted risk
(reasoning in its own subsection). Two weaknesses found while reading the code before this pass were fixed first
(docs/SECURITY.md, changelog): an over-long secret that made every bounty unfixable, and junk commits holding the K slots
for ever.

Unit tests (`docs/evidence/S13/unit_tests.txt`): `cargo test -p kintsugi-check --offline` (6 and 13 passed, including
3 new S13 tests), `cargo test -p kintsugi-contract --offline` (59 passed, including 11 new S13 tests), and
`cargo build --release -p kintsugi-host` (exit 0).

Proofs (measured with `scripts/s2_measure.sh`, segment size 2^19, 16 fairness inputs, 32 crash variants):

| Proof | Command | Prove time, peak memory | Compress to succinct | Result |
|---|---|---|---|---|
| Proof 0 (vendor's reference fix) | `./scripts/s13_attacks.sh proof0` (`prove_proof0.log`, `compress_proof0.log`) | 4,983.54 s, 4,732 MiB | 1,273.92 s, 1,487 MiB | VALID, PASS, image id `043ec633...7f8d` (`verify_proof0.txt`) |
| Bounty A, researcher 1's fix | `./scripts/s13_attacks.sh prove_a` (`prove_a.log`, `compress_a.log`) | 3,031.98 s, 4,725 MiB | 1,048.19 s, 1,483 MiB | VALID, PASS, submission id equals `get_submission_id` (`verify_a.txt`) |

Proof 0 took longer than a researcher's proof: it is the same check, plus the guest's Proof 0 mode; why it took 64% more
time was not measured. Both receipts are 224,786 bytes after compression.

| # | Attack | Phase (log in `docs/evidence/S13/`) | What happened | Result |
|---|---|---|---|---|
| 1 | Unfixable bounty: a 300 byte secret (limit 256) makes every patch fail | `open` (`atk1_unfixable_native.txt`, `open_run.txt`) | Proof 0 with the reference fix refuses it: "exploit too long: 300 bytes, at most 256 allowed"; with the real secret, PASS. A commit before two Proof 0 attestations: "bounty is not open: Proof 0 needs two verifier attestations" (tx `EyrXqFFULpbNr1B1GjzY23Ps6hiSeL45pzs7kcynmjG6`) | blocked (guard added in S13) |
| 2 | Junk commits fill the K slots for ever | `misc` (`misc_run.txt`) | Release before the reveal window closes: "reveal window has not closed" (tx `ChBJcD4PdwyhrzXRrQnESTaYfaBjYcC9Gt6kCVUx7TSc`); after it, `release_unrevealed` freed a slot (tx `GJSN5P1dhRRK7ktaarKCY4XaPsJXdfYytsX6M1Yex1rZ`) and a new commit fitted (tx `7kBnwJH6DTAsxKfHvg46TSbhu1imiVpcxRU4r8DQgq3W`) | blocked (guard added in S13) |
| 3 | Sub-accounts of one researcher fill K | `misc` | Allowed, each pays the rising fee; see the subsection below | accepted risk |
| 4 | The vendor replays bounty A's PASS receipt for a new submission on bounty B | `bounty_b` (`bounty_b_run.txt`, `steps/atk4_check.txt`) | The verifier check fails on "journal submission id = contract submission id" and "journal seed = seed recorded at reveal"; no attestation; after the window the researcher was paid 0.5 NEAR by timeout (tx `GKBtL4nK5X5Btci4sn6mKswa7Bos1NQ2LcsLUK5MEJKr`) | blocked |
| 5 | A third verifier attests PASS while the vendor posted FAIL | `attack_a` (`attack_a_run.txt`) | "attestation does not match the posted verdict" (tx `QRaDTjR6LP25F4qXFWHftuV7jobRw4bvMnAim8NZMMK`) | blocked |
| 6 | An unregistered account attests Proof 0 | `misc` | "caller is not a registered verifier" (tx `B8bPiAkv2ScPECg2GRUDwRTzXqsUZa1f9MVoKrQhriZf`) | blocked |
| 7 | The same verifier attests Proof 0 twice | `misc` | Bounty D stays closed; one attestation recorded (txs `877nL69v68Ez5MyWgJtEgzupWofiBkoVi8abyRa8ckHW`, `B538b9MfGNGT8j8epqXoQrfXwNLY1VCF3yb8m9r1BmU8`) | blocked |
| 8 | Timeout or expire too early, or again after payout | `bounty_b`, `attack_a` | "bounty has not expired" (tx `Fooh4qPGP1LoxcACL9qQDb3DMD4SUdiKaTW3vt5qrwos`); "deadline has not passed" (tx `As3Fjbq7Tp34GXywL5SCFamCY8qUsXZHSm7S1BisRW1L`); after payout "bounty is closed" (tx `9bMb4swFQ7QaQbyHYMAMhoaYg1kv4fvapwSWc8tNKEMB`) and "nothing to do: bounty already closed and fees already swept" (`steps/atk8_expire_late_after_payout.txt`; the script used the plain call wrapper there, so no tx id was recorded) | blocked |
| 9 | A receipt made by another checker program (the S4 receipt, image id `3edbc2e6...`) | `bounty_b` (`steps/atk9_check.txt`) | Fails "receipt verifies with the checker's image id"; every later check fails with it | blocked |
| 10 | A reveal that does not match its commit | `misc` | "fingerprint does not match" (tx `CKDTYfF4gtBrtV12BbxZMpxXkhcexGmogs1ZGZctjmqV`) | blocked |
| 11 | The vendor posts FAIL for a fix whose real receipt says PASS | `attack_a` | Vendor's FAIL posted (tx `2nRfsMdmwuh63CYBZtJA3X8Wfmhchxeit9FXGyft7bRy`); both verifiers refuse on "journal verdict = posted verdict"; after the window a timeout claim (tx `Embs5uMx85QXqUHzkVMURnGcae8NBCJBb5c9Z6eaKWNN`) paid researcher 1: balance +0.51 NEAR = 0.5 NEAR bounty + own 0.01 NEAR fee refunded | blocked: the researcher is paid by default |

Mistake on the way: the first `open` run picked a vendor account that does not exist (settings files loaded in the
wrong order in `scripts/s13_attacks.sh`); it stopped at `create_bounty` before any transaction; fixed and rerun.

### Attack 3: one researcher's sub-accounts fill the K slots

Run: `./scripts/s13_attacks.sh misc` (`docs/evidence/S13/misc_run.txt`), bounty C with K = 3, `attempt_fee`
10000000000000000000000 yoctoNEAR (0.01 NEAR), `fee_step` 5000000000000000000000 (0.005 NEAR), reveal window 120 s
(read back with `get_bounty`, `docs/evidence/S13/bounty_c_after_misc.txt`).

- `kintsugi-res2-prnvm.testnet` and its sub-accounts `sa.` and `sb.` committed junk and took all 3 slots, paying 0.01,
  0.015 and 0.02 NEAR (the `fee` field of each `committed` event, `steps/atk2_junk_commit_*.txt`). A fourth commit by
  another account was ignored ("max_commits reached") and charged nothing.
- After the reveal window, `release_unrevealed` freed a slot and a new commit fitted; it paid 0.025 NEAR, because the fee
  counts all commits so far (`commits` = 4) and never goes down. `fees_collected` = 0.07 NEAR = 0.01 + 0.015 + 0.02 +
  0.025, as the formula says.
- The rule in the code (`contract/src/lib.rs`, `next_fee` and `commit`): the n-th counted commit costs
  `attempt_fee + n * fee_step`; a commit is ignored, and not charged, while `active` (slots in use) is K; only
  `release_unrevealed` lowers `active`, and only for a commit that was never revealed.

Cost to block one bounty for one full reveal window with these settings: K slots at n = 0, 1, 2 cost
0.01 + 0.015 + 0.02 = **0.045 NEAR**, all kept by the contract (swept to the verifiers). Holding the slots for the next
window costs 0.025 + 0.03 + 0.035 = 0.09 NEAR; window w (from 0) costs 0.045 + 0.045 w NEAR, so W windows in a row cost
0.0225 W (W + 1) NEAR (10 windows: 2.475 NEAR). The cost does not depend on how long the window is; the vendor sets K,
both fees and the window.

K is per bounty and counts every committer together, so sub-accounts cannot raise the total leak above K bits: at most K
submissions per bounty are ever revealed and get a verdict, and each verdict leaks at most one bit. **Verdict: accepted
risk**, for that reason and because blocking costs more with every window.

## OutLayer (Level 1) on testnet: why did no worker answer?

Question: in S4 our OutLayer jobs (requests 5607 and 5608) were accepted by `outlayer.testnet` but ended about 120 s later
with "Execution promise failed": no worker answered within NEAR's yield window. Is it our job, our program, or OutLayer?
One hour cap, 2026-10-24 12:10 to 13:10 UTC. Raw output: `docs/evidence/OL-diag/`. Each test job was sent with
`./scripts/ol_diag.sh <name> '<request_execution args>'` from the testnet account `kintsugi-res2-prnvm.testnet`, 0.1 NEAR
attached, 300 Tgas; OutLayer kept at most 0.0011 NEAR per job and refunded the rest.

**Verdict: OutLayer's testnet workers are up and answer jobs whose program file is already in OutLayer's cache. Every job
whose program file OutLayer had to download first got no answer, from two different hosts. Ours are all of that kind. The
cause is on OutLayer's side and we cannot see it; Level 1 stays "not working on testnet yet". Fallback: Level 0 (unchanged).**

1. Where the jobs went. Request 5607 (tx `FgieKEfSo2DE9WsuZSVMTBNMH4D48igNdwgEbLSnshS4`) was sent by our contract to
   `outlayer.testnet` (`docs/evidence/S4/outlayer_tx_tree.txt.txt`); the direct job 5608
   (tx `Kx7kzdPwr6hHdtEmgDGeHhirA9LNVSG6fKwtai1B255`) was sent to `outlayer.testnet` directly. Both correct.
   `outlayer.testnet` is not paused (`is_paused` = false), has no pending requests, and names `worker.outlayer.testnet` as
   its operator (`get_config`).
2. OutLayer's own documented call. Their docs call a registered project with `"source": {"Project": ...}`, limits
   10,000,000 instructions, 128 MB, 60 s, and 0.1 NEAR. We ran exactly that against OutLayer's public test project
   `connectors.outlayer.testnet/connector-probe` with `{"operation":"ping"}` (`probe_ping.txt`,
   tx `6zrCoq46Cx5WZFRsK14c2yC65oJR2B9eLwHmDZitoC8a`): answered in 13 s with
   `{"ok":true,"operation":"ping",...}`, 18,152 instructions, 0.0011053 NEAR charged. OutLayer's event says the program
   came from its cache ("Cached WASM from 2026-10-02").
3. One change at a time from that working call (all with the same small limits):

   | Test | Program file | Link | Build target | Request | Answer |
   |---|---|---|---|---|---|
   | probe_ping | OutLayer's probe, via its project | FastFS | wasip2 | (tx above) | yes, 13 s, success |
   | e1 | OutLayer's probe, same file by link | FastFS | wasip2 | 5610 | yes, 10 s (an error from the probe itself: it needs a project) |
   | e4 | OutLayer's probe, same file by link | FastFS | wasip1 | 5613 | yes, 11 s (same error) |
   | e2 | our verifier | raw GitHub | wasip1 | 5611 | **none**, 123 s, "Execution promise failed" |
   | e3 | a file from OutLayer's own GitHub repo | raw GitHub | wasip1 | 5612 | **none**, 127 s |
   | e5 | our verifier | jsDelivr (mirror of our public repo) | wasip1 | 5614 | **none**, 127 s |
   | e6 | our verifier | jsDelivr | wasip1 | 5615 | **none**, 122 s |
   | e7 | OutLayer's probe, via its project (control) | FastFS | wasip2 | tx `G6NVynGvtTkJExKSZwu1i5DKHzUFKt4LA6CiNGTkwrhh` | yes, 12 s |

   The e1 and e4 answers are in `e1_e4_answers_from_chain.txt`, read back from the testnet RPC: the evidence filter had
   dropped them from the CLI copies because OutLayer's error text contains the word "secret".
   Each link served the exact bytes named by the hash (checked with `curl -sL <url> | sha256sum`), and both hosts pass the
   URL rule in OutLayer's worker code (https, default port; our file is 1,134,249 bytes, under its 10 MB limit).
4. OutLayer's public worker list (`https://testnet-api.outlayer.ai/public/workers`, read only) shows two executor workers
   and a keystore worker online, heartbeats seconds old. During e6 neither executor's "completed" or "failed" counter moved
   (`e6_worker_counters.txt`); during the control e7 one executor's "completed" went from 180 to 181
   (`e7_control_counters.txt`). So a job whose file must be downloaded first never reaches a worker, or is dropped before
   it is counted. Which part of OutLayer does this (their coordinator holds the task queue and the program cache, and its
   code is private) we cannot tell from outside.
5. Our program's real needs, measured locally with the same wasmtime version and engine settings OutLayer's worker uses
   (wasmtime 28.0.1, fuel metering): `verifier/fuel-meter`, command
   `target/fuel-meter/release/fuel-meter target/verifier-publish/farbox-verifier.wasm target/s4-logs/succinct_input.json`
   (`verifier_fuel.txt`). On the S4 succinct receipt (input 299,987 bytes): **878,730,118 instructions, peak memory
   3.4 MB, 71 ms**, answer `PASS`, 384 bytes (OutLayer's limit for an on-chain answer is 900 bytes). On the input `{}` used
   in e2 to e6: 20,105 instructions. So the limits in e2 to e6 (10 million) and in S4 (10 and 100 billion) were not the
   cause. Limits with margin for the next try: 2,000,000,000 instructions, 64 MB, 20 s.
6. Deposit. `estimate_execution_cost` (`estimates.txt`): 2.6752 NEAR for those limits with our 299,987 byte input, of which
   about 2.67 NEAR is OutLayer's hold for input above 32 KB (returned at settlement); 2.6792 NEAR for S4's limits. S4
   attached 3.2 NEAR, so the deposit was not the cause either.
7. Not tried, and why: putting our file on FastFS and registering it as an OutLayer project (`outlayer upload`,
   `outlayer deploy`). That publishes the file in a new public place and needs OutLayer's command line tool, so it waits
   for the owner. OutLayer's HTTPS route with a payment key also waits for the owner. Nobody at OutLayer was contacted.

### Second try: our verifier published on FastFS as an OutLayer project (owner approved, 2026-10-24 14:25 to 14:36 UTC)

What changed: OutLayer's own tool, `outlayer-cli` 0.2.1 (installed with
`cargo install --git https://github.com/out-layer/outlayer-cli --tag v0.2.1 --locked`, commit `25d4e544`, into the home
folder), logged in with a new throwaway faucet account `kintsugi-ol-hfoez.testnet` (its credentials folder is kept in the
private secrets folder, never in the repository). Then:

- `outlayer upload target/verifier-publish/farbox-verifier.wasm` (`g0_fastfs_upload.txt`): 2 transactions,
  `4dfG7rmFjPpuKEAGmfTX8FTiq2J9VNsJc45ahTkuYiE4` and `FqT2JdHb1ARejoh6oQPj4FpoxW3ef9WuPJ6ssbYLAVXB`; the file is the
  published v0.1.0 (SHA-256 `e60647ec...46a8`). Both show "Failure" on chain: the tool sends them with almost no gas on
  purpose, and FastFS reads the data from the transaction. Measured cost 0.0059 testnet NEAR.
- `outlayer deploy farbox-verifier <FastFS URL> --hash e60647ec... --target wasm32-wasip1` (`g0_deploy.txt`): project
  `kintsugi-ol-hfoez.testnet/farbox-verifier`, active version `e60647ec...`. The throwaway account spent 0.0136 testnet
  NEAR in total for upload, project storage and gas (`g0_account_balance.txt`).
- The FastFS link returned HTTP 502 ("error code: 502", 16 bytes) on every try from 14:26 to 14:34 UTC, and so did
  OutLayer's own probe file on FastFS, which served fine earlier: the FastFS testnet gateway was down during this test.

Direct jobs (no contract, no new proof) with the real S4 bounty 2 receipt and its public values from the chain
(`image_id` `3edbc2e6...`, `submission_id` `fff09869...` from `get_submission_id`, `receipt_sha256` `8c316bd5...`),
limits 2,000,000,000 instructions, 64 MB, 20 s, `estimate_execution_cost` = 2.6751 NEAR, 2.8 NEAR attached, sent with
`./scripts/ol_job.sh <name> <args file> '2.8 NEAR'`:

| Test | How the verifier is named | Request | Answer |
|---|---|---|---|
| local | `target/fuel-meter/release/fuel-meter ... s4_b2_input.json` (`local_s4_bounty2.txt`) | none | PASS, journal `79b9d8a6...` (equals the chain), 878,725,371 instructions |
| f1 | link only (raw GitHub, as in S4) | 5618, tx `5CkkH6dr6x7ymCGSSdNYoK1xs4ieyJvV6dAUhCu1Zxg9` | **none**, 117 s |
| g1 | project name `kintsugi-ol-hfoez.testnet/farbox-verifier` | 5619, tx `AytFzgk96XQzSVFRU9Rpv6JFrxfDKmE3u7z2up8QCxUh` | **none**, 133 s |
| g2 | FastFS link | 5620, tx `Er5pYv8ijd7tbGVSPm9aRr2mgnbjEeJPPcCT3eesVBbT` | **none**, 127 s |
| g3 | OutLayer's probe (control) | tx `EWK8qAUTa9R3tkZpmkMAjHHHFqiFuiReUYy8GWFmAmXd` | yes, 14 s |

Each failed job kept 0.001 NEAR and refunded 2.799 NEAR. **Verdict: still no answer for our verifier, by link, by
FastFS link or as a project, while a cached program answers. Not conclusive for FastFS, because the FastFS gateway was
down during the test.** As the owner set out, no new proof was spent on the full contract path (that waits for a FastFS
job that gets an answer), and no contract change was made (neither the project name nor the link worked).

Reported to OutLayer: https://github.com/out-layer/outlayer/issues/33 ("testnet: WasmUrl programs not already cached
never get a worker answer (yield times out)", opened 2026-10-24 15:05 UTC by the project owner). Replies are recorded
here as they come; as of 2026-10-24 15:07 UTC it is open with 0 comments.

Small inconsistency in OutLayer's docs, for the record: the Pricing page says failed executions are not refunded; the NEAR
Integration page and what we saw (0.099 of 0.1 NEAR refunded on every failed job) say the unused deposit is refunded.

## S8: How many bits can a probe agent extract?

Question: in an arena bounty with a known, small secret space, how much does a scripted probe agent learn from PASS or FAIL
verdicts with a budget of K attempts? Pass (blueprint): extracted bits never exceed K; the counter matches the log.

**Verdict: PASS (2026-10-24).** Verdicts come from the native checker (the same checker code the zkVM guest runs); no proofs
were made for the arena probes. The secret was revealed only after the game, to check the log.

Arena (`data/arena/`): the module crashes on every input starting with byte `0xA5` (4,096 crashing 12 bit values). The
vendor's secret is which one of them the committed exploit is. A probe fixes the crash only for values matching a bit
pattern, so its verdict says whether the secret matches: at most one bit per attempt. Script: `./scripts/s8_arena.sh`
(full output `docs/evidence/S8/arena_run.txt`, per attempt `docs/evidence/S8/arena_log.json`).

- Proof 0 for the arena: PASS (the original crashes on the secret and passes its 14 public tests).
- Game, K = 3, crash-variant check off, binary search over the top bits:

| attempt | probe pattern (bits of v) | verdict | candidates left | bits learned | budget K |
| --- | --- | --- | --- | --- | --- |
| 1 | (v & 0x800) == 0x800 | FAIL | 2048 | 1.0 | 3 |
| 2 | (v & 0xc00) == 0x400 | FAIL | 1024 | 2.0 | 3 |
| 3 | (v & 0xe00) == 0x200 | PASS | 512 | 3.0 | 3 |

- A fourth attempt is refused (budget spent). After the game the vendor revealed exploit `a5333f` (value 831) and the salt:
  the commitment matches, and the secret lies in the set the log describes. 3 bits learned, budget 3.
- Control with the crash-variant check on (32 variants): all three probes FAIL whatever the secret, because a probe that
  fixes only part of the crash family still crashes on nearby variants of the secret. With that check on, this probe agent
  learns 0 bits. The honest fix passes with and without it.
- On testnet (`./scripts/s8_chain.sh`, `docs/evidence/S8/chain_summary.txt`): arena bounty 4 with `max_commits` 3
  (`ANCqPZzLAwdybq2qriGQhnquenC9kqqF36oyAMg13q3U`). Probe commits 1 to 3 counted, fees 0.01, 0.015 and 0.02 NEAR
  (`FpUpVqQyfYRGPtcv9ZTgaWHQMHefpXDUtsy7bAf9FEDi`, `8jMLwGnYP4w9CjYPgExt1oLXu1e3SRwWsnAvQWk6S3yU`,
  `AGSSeET6zNB1UomHumPhHD1tHroxCqfcHi8Kk6EdEDm1`); the fourth (`2NuDyLV6pX83LFZcV67fR3AMzaC2BZEwY7dRQvDvpohX`) was ignored:
  still 3 commits, credit unchanged, event `commit_ignored` with reason "max_commits reached".

Not measured: timing or other side channels; a model-driven probe agent (needs NEAR AI Cloud).

## S7: An agent that works only through a function call key

Question: can a researcher agent commit and reveal using a key that cannot move its owner's money? Pass (blueprint): the
agent's patch gets PASS and the key cannot transfer funds. Fallback used: **a scripted agent with a canned patch, labelled as
scripted** (the model-driven agent needs a NEAR AI Cloud account and key from the owner, not available).

**Verdict: PASS (2026-10-24), as the scripted fallback.** The agent's patch got PASS from a real proof, two verifiers checked
and attested it, and the owner's payout account was paid. The key could not move funds.

Script: `./scripts/s7_agent.sh setup|bounty|limits|prove|finish`. Owner account: `kintsugi-res2-prnvm.testnet`.

| Step | Transaction | Result |
| --- | --- | --- |
| owner adds the agent's function call key (receiver `bounty.kintsugi-djloo.testnet`, methods `commit, reveal`, allowance 0.25 NEAR) | `9dBx1aZpN8teuKA6b5ib7Jhq77kZX1ezNjpptyUodBSs` | public key `ed25519:2aPWxz2Yy7ZSD73pnxPRE24cbobYXF9MTvmDeJqy7U8y` |
| owner deposits 0.05 NEAR credit with its full key | `BAh9RnZVXXYFMNBheheCkzatP5Dt8yN63skQmWBLrskL` | credit 0.05 NEAR |
| vendor creates bounty 3 | `8bth7Nc6v3cTVrzxA3GtYEVUajFqRkKxfcJkpQBmAZrj` | ok |
| agent checks its canned patch on the 17 public tests with the native checker (no secret input) | (local) | 17 passed, 0 failed |
| agent commits, signed with the agent key only | `5rsexZzfttnJKwEGcS5a3TRvB3vMx6xUhT1jEpXhp3ki` | fee 0.01 NEAR from credit (0.05 to 0.04) |
| agent reveals, signed with the agent key only | `DFqQtJ2qREnAkB7tbRbNV8n1ZBv91cwZPbphyPcbv9Lz` | ok |

What the agent key must not do (`docs/evidence/S7/steps/s7_limit_*.txt`, `docs/evidence/S7/chain_refusal_*.txt`):

| Attempt with the agent key | Refused by | Message |
| --- | --- | --- |
| `withdraw_credit` with 1 yoctoNEAR attached | near-cli-rs, before sending | "Having a deposit with a function call action is not allowed with a function call access key." |
| `commit` with 0.01 NEAR attached | near-cli-rs, before sending | same as above |
| `expire` (not an allowed method) | near-cli-rs; and the chain when sent directly over RPC | CLI: "Transaction method name <expire> isn't allowed by the access key."; RPC: `InvalidTxError` / `InvalidAccessKeyError` / `MethodNameMismatch` |
| send 0.01 NEAR to another account | near-cli-rs; and the chain when sent directly over RPC | CLI: "Transaction requires a full permission access key."; RPC: `InvalidTxError` / `InvalidAccessKeyError` / `RequiresFullAccess` |

The two direct RPC attempts were signed with the agent key, saved without sending, then sent to the RPC node, which refused
them before execution (no transaction id, no gas).

The agent's submission to PASS (`./scripts/s7_agent.sh prove`, then the steps below):

| Step | Transaction or command | Result |
| --- | --- | --- |
| prove with the seed and submission id recorded on chain | `kintsugi-host prove ... --seed <seed> --submission-id <id>` | 2,995.69 s, 26 segments, r0vm peak 4,725 MiB, verdict PASS |
| compress | `kintsugi-host compress ... succinct` | 922.49 s, 224,786 bytes, r0vm peak 1,483 MiB |
| vendor posts PASS | `CuqC2X7XyczAhXa4eFoYtGLSgcVkdXXVxwsC2nyEqiSk` | ok |
| Level 0 check by the verifiers | `scripts/verifier_check.sh submission bounty.kintsugi-djloo.testnet 3 0 target/s7/receipt_succinct.bin` | 11 of 11 checks OK, ATTEST (`docs/evidence/S7/level0_check.txt`) |
| verifier 1, verifier 2 attest | `GFG81YhEFNcMBTxrrjXCszYEi8vnPdLnXpUb2arXMnHq`, `35q1VXV3XWeEbK8A9V4QA8kyLtY8guwn6qxHhDw9hSby` | outcome Passed; the owner's payout account +0.5 NEAR exactly |

## S4/S5: OutLayer as verifier 1 (Level 1)

**Verdict (2026-10-24): Level 1 FAIL on testnet, fallback Level 0 PASS.** OutLayer accepted our jobs but no worker answered
within NEAR's yield window, twice; the contract recorded nothing, as designed. Fallback as the blueprint says (stay at
Level 0): two registered verifier accounts checked the real receipt against the chain and attested; the bounty finalized
and the researcher was paid. S5's refusals work on chain.

What exists:

- `contract/src/lib.rs`: `set_outlayer` (owner sets the OutLayer contract, the verifier program's https URL and sha256, the
  build target and limits), `request_outlayer_check` (anyone; this contract sends `request_execution` to OutLayer with the
  pinned program and the receipt), `on_outlayer_result` (private callback). The callback records OutLayer's attestation only
  if the answer says `ok` and its image id, submission id, receipt sha256, journal sha256 and verdict all equal this
  contract's record; a second verifier is still needed to finalize. `get_submission_id` gives the id the journal must carry:
  sha256("kintsugi-submission-v1" || contract account || bounty id || index || sha256(patch)). The OutLayer settings use their
  own storage key, so the deployed state layout is unchanged.
- `verifier/outlayer/` (`farbox-verifier`): reads `{receipt_b64, image_id, submission_id, receipt_sha256}` from stdin,
  checks the receipt hash, verifies the receipt with RISC Zero's verify-only code, checks the journal's submission id, and
  prints one JSON answer (largest seen: 505 bytes, under OutLayer's 900 byte limit).
- `kintsugi-host`: `compress` (receipt to succinct or Groth16), `--submission-id`, and a `cuda` feature for a GPU machine.

Tests:

- `cargo test -p kintsugi-contract --offline`: 48 passed (9 new OutLayer tests: answer counts as one verifier and a second
  verifier finalizes; repeat counts once; wrong image id, submission id, receipt hash or verdict rejected; not ok, null or
  failed promise rejected; callback private; the request goes to the OutLayer account with the pinned program and input;
  OutLayer must be a registered verifier; only the owner sets OutLayer). One test first failed: calling the callback
  directly in a unit test skips near-sdk's `#[private]` entry check, so the method now also checks the caller itself.
- Native verifier on the 16 input receipt (`docs/evidence/S4/verifier_native_tests.txt`): correct values give `ok: true`,
  PASS; a wrong image id, a wrong receipt hash, a changed journal, and a wrong submission id each give `ok: false`. About
  1.2 s per check.

Wasm for OutLayer (`./scripts/build_verifier_wasm.sh`, wasm32-wasip1, paths remapped, symbols stripped):
1,134,249 bytes, SHA-256 `e60647ec50f76f591a6994963f1394d408f516947f2fe927e389daf2166346a8`. The strings scan found no home
paths, user names, project names or keys (`docs/evidence/S4/verifier_wasm_build_scan.txt`). Not run as wasm yet: no WASI
runtime is installed here.

Compression to one succinct proof (laptop CPU, alone, 2 hour cap):

```bash
MAX_SECONDS=7200 scripts/s2_measure.sh target/s4-logs/compress_succinct_f16.log -- ./target/release/kintsugi-host compress target/s2/receipt_f16_alloc.bin target/s2/receipt_f16_succinct.bin succinct
./target/release/kintsugi-host verify target/s2/receipt_f16_succinct.bin
./target/release/farbox-verifier < succinct_input.json
```

| Measure | Value |
| --- | --- |
| Input | composite receipt of the 16 input proof, 7,180,838 bytes |
| Compress time | 944.27 s (15.7 min) |
| Prover peak memory | 1,484 MiB (r0vm VmHWM) |
| Output | succinct receipt, 224,786 bytes |
| Verify in a separate process | 0.027 s, VALID, verdict PASS |
| Native verifier on it | `ok: true`, PASS, 0.03 s, 4,188 KB peak; its JSON input is 299,987 bytes |

Outputs: `docs/evidence/S4/compress_succinct_f16.txt`, `docs/evidence/S4/verify_succinct.txt`,
`docs/evidence/S4/verifier_native_succinct.txt`. So one check costs 46.9 min of proving plus 15.7 min of compression on this
laptop. The succinct receipt fits NEAR's 1.5 MiB transaction size; its 299,987 byte input to OutLayer is above OutLayer's
free 32 KB, which costs 0.00001 NEAR per extra byte, held while pending and returned (about 2.7 testnet NEAR).

Published (owner's go, 2026-10-24): public repository https://github.com/pgreyy/farbox-verifier with three files only
(`README.md`, `farbox-verifier.wasm`, `farbox-verifier.wasm.sha256`) and release v0.1.0. Before upload the file was scanned
for /home, /Users, /root, the user name, pgreyy, email addresses, the project's working name and other listed names, long
hex or base58 strings, tokens and key text: no names, paths, emails, tokens or keys; the only long hex is the public Rust
1.99.1 commit id in standard library paths, and the rest are digit tables and decimal constants
(`docs/evidence/S4/verifier_publish_scan.txt`). After upload, both
`https://github.com/pgreyy/farbox-verifier/releases/download/v0.1.0/farbox-verifier.wasm` (HTTP 200, 1 redirect) and
`https://raw.githubusercontent.com/pgreyy/farbox-verifier/main/farbox-verifier.wasm` (HTTP 200) downloaded a file with
SHA-256 `e60647ec50f76f591a6994963f1394d408f516947f2fe927e389daf2166346a8`, the same as before upload.

### End to end on testnet (`./scripts/s4_testnet.sh deploy|bounty|prove|verdict|outlayer`)

| Step | Transaction or command | Result |
| --- | --- | --- |
| update contract code (no init, state kept), 269,910 bytes, SHA-256 `a4582062...4b77` | `7m7GH5Qg6BVHeDoPd9GMFiYUUDdgERz5PSVA3hUB4gJL` | ok |
| register `outlayer.testnet` as verifier 1 ("trusts outlayer.testnet and its operator") | `CZYmfr7dGYoaYNLPnF6YF8c3GFTWiMQeJJfxTVZgGCFw` | ok |
| bounty 2 with the real image id, exploit commitment, corpus and original hashes | `B7FEeaMnQ9Wv6gfY21sSsVL6vo1PRZKM1iN38LdHieNp` | ok |
| researcher 1 commits and reveals `data/demo/fixed.wasm` | `DeothYh7Lzt3iRbpRtyCkGeE9e9YWKovkjqGJ6TXd99V`, `H3HuYThEtZb5oYWQqEgKcn8bjciNvtB8SxXLLPvA8ueR` | seed `4b102480...76b1`, submission id `fff09869...4934` |
| prove with that seed and submission id (16 inputs, 32 variants, 2^19) | `kintsugi-host prove ... --seed <seed> --submission-id <id>` | 2,876.17 s, 26 segments, r0vm peak 4,724 MiB, verdict PASS, journal carries the seed and id |
| compress to one succinct receipt | `kintsugi-host compress ... succinct` | 921.13 s, 224,786 bytes, r0vm peak 1,483 MiB; journal SHA-256 `79b9d8a6...52fc`, receipt SHA-256 `8c316bd5...cbbf` |
| vendor posts PASS with those hashes | `GgrJSagJRpptMYNHnYAnUwKSQK7gRtiiCQwQSxcsBcEy` | ok |
| owner sets OutLayer: `outlayer.testnet`, the public wasm URL and SHA-256, wasm32-wasip1 | `EZkdf6oReaV97j3a6WboJgTwbVjGZnJA5gs9uMkbYJSD` | ok |
| anyone requests the check, 3.2 testnet NEAR attached, arguments 299,761 bytes | `FgieKEfSo2DE9WsuZSVMTBNMH4D48igNdwgEbLSnshS4` | **OutLayer log: "Execution promise failed: Failed. Refunded 3199000000000000000000000 yoctoNEAR"** (0.001 NEAR base fee kept); our callback returned "rejected: no answer from OutLayer", no attestation |

The failure came 201 blocks (119 s) after OutLayer's `execution_requested` event (heights 274539805 to 274540006): the
yield timed out, meaning no worker resumed the request. Second attempt, to tell size from availability: a direct
`request_execution` to `outlayer.testnet` with the same pinned program and a tiny input `{}`
(`Kx7kzdPwr6hHdtEmgDGeHhirA9LNVSG6fKwtai1B255`) failed the same way about 2 minutes later (refund 0.099 NEAR). The
OutLayer coordinator's health endpoint answered `{"status":"ok"}`; we found no public endpoint that shows a request's status.

Fallback, Level 0: each verifier first ran `kintsugi-host verify target/s4/receipt_succinct.bin` and compared the journal
with the chain (`docs/evidence/S4/level0_check.txt`): receipt VALID; image id, submission id, seed, candidate hash, exploit
commitment, corpus hash and original hash equal the bounty and submission records; receipt and journal SHA-256 equal the
posted hashes; verdict PASS. All 11 checks passed.

| Step | Transaction | Result |
| --- | --- | --- |
| verifier 1 attests | `4LQrz15ma6qbdX5QUJprVbxicZC2fEThP7d7TtAMygm7` | recorded |
| verifier 2 attests | `F4aYNF5atUZSnxegrQFNnAnYs9Vc8HQHKVPKSmmRjX9x` | final PASS: outcome Passed, bounty Paid, event `paid` reason `final_pass`; researcher 1 balance +0.5 NEAR exactly |

Not known (UNCONFIRMED): whether testnet workers were down, whether they could not fetch or run our wasm, or whether they
only serve registered projects. Raw outputs: `docs/evidence/S4/outlayer_tx_tree.txt`, `docs/evidence/S4/steps/`.

### S5 on chain

| Attempt | Transaction | Result |
| --- | --- | --- |
| a stranger calls the private callback `on_outlayer_result` | `EAYKT9uXAnPTNqESgvJ3UDkWAMW7PBA9TWChW6Md6gWj` | refused: "Smart contract panicked: Method on_outlayer_result is private" |
| the owner registers the vendor as a verifier | `4caVWaHeWdecD5W7oQkCb3W3kGiPFZLUWwG6qoJSB6hP` | refused: "a vendor account cannot be a verifier" |

Outputs: `docs/evidence/S5/`.

## S3b: Attempt fees and credit, on a dedicated contract account

Question: does a commit pay a rising attempt fee from prepaid credit, is a commit without credit refused, do the fees reach
the verifiers at expiry, and can unspent credit be withdrawn (but not by a key that cannot attach 1 yoctoNEAR)?

**Verdict: PASS (2026-10-24).** Full run output: `docs/evidence/S3b/` (`summary.txt`, `transactions.tsv`, `steps/`).

Contract changes (`contract/src/lib.rs`): `deposit_credit` (attach NEAR, optionally for another account), `withdraw_credit`
(needs exactly 1 yoctoNEAR attached, which a function call key cannot attach), `get_credit`; `create_bounty` takes
`attempt_fee` (must be above zero) and `fee_step`; the n-th counted commit (n from 0) costs `attempt_fee + n * fee_step`,
taken from the committer's credit; a commit beyond K is ignored and costs nothing; `expire` (after expiry) refunds an unpaid
bounty and sends the collected fees to the registered verifiers in equal shares, the remainder to the first; a second
`expire` with nothing left to do is refused.

Unit tests: `cargo test -p kintsugi-contract --offline`: 39 passed, 0 failed.

Wasm: 243,866 bytes, SHA-256 `4aa8d8614b4b9e914d981ca72ea298e2fb73cca9796a380a01fb04d34a64c7a2`, the same as the code on
`bounty.kintsugi-djloo.testnet` (RPC `view_code`).

Accounts (testnet only): contract `bounty.kintsugi-djloo.testnet`, created with 3 NEAR from `kintsugi-djloo.testnet`
(`8BT7rhwtAc2cbe5cgMfocrxDc81SB9C6JJuzAnxPA6mM`), deployed with init (`72VTiMGEbBp1Hdk3AQHxgj5YznUsmqsBAb5uvHZQR32a`).
Test accounts from the testnet faucet, 10 testnet NEAR each: `kintsugi-vendor-prnvm.testnet`, `kintsugi-res1-prnvm.testnet`,
`kintsugi-res2-prnvm.testnet`, `kintsugi-ver1-prnvm.testnet`, `kintsugi-ver2-prnvm.testnet`, `kintsugi-ver3-prnvm.testnet`.

Commands, from the repository root:

```bash
cd contract && cargo near build non-reproducible-wasm && cd ..
./scripts/s3b_setup.sh
./scripts/s3b_testnet.sh
```

Fee 0.01 NEAR, step 0.005 NEAR (explorer: `https://explorer.testnet.near.org/transactions/<hash>`):

| Step | Transaction | Result |
| --- | --- | --- |
| register 3 verifiers | `8hoiajVKe6GYXNuRxm77yq7xait8MKJwW2pf6bBiqeMx`, `3GWZ3JLMpBfonwAuKMwdnoYKR39w3cj3PF1us61cFDX6`, `3jK6iQQQK8xhpC1gLyRb7HpmnZKTebYRAsQv7d2hufT2` | ok |
| researchers 1 and 2 deposit 0.1 NEAR credit | `BthTa3YsgwqMaasY1Cfw8FbMLVFAqXUbPbvTuNoJsn3W`, `Foqzj6zNCk8aaGasq7r2SXGDjDnEcFiR16aemGiVWD9e` | credit 0.1 NEAR each |
| bounty A created (0.5 NEAR) | `5aqPDbkryiLCGerajXMxpgmSyueRv5g9AtuDhD39EcU4` | ok |
| researcher 1 commits | `W8AVDvxSFr9rjGUVjLKU2DkGr7289NHyaQ1GhNNkYmh` | fee 0.01 NEAR, credit 0.09 NEAR left |
| researcher 2 commits | `HvErQztKDeAqezBKKADP8ZJA3GcWh7XHWCFmRnxJh5p3` | fee 0.015 NEAR, credit 0.085 NEAR left |
| verifier 3 commits with no credit | `8E7u8BMebiY4SUMiWHgYGHM83UYjDzDbVc87EGyobo9y` | refused: "not enough credit for the attempt fee: call deposit_credit first" |
| reveal, PASS, attest v1, attest v2 | `9HRPtPMWw9ikraFoNVGd6sJyYR8cBzMB7pAKdmQx1e4K`, `Bq35JYq9qzYHHhzcRfLJhmhvze3oSkknyGsDD79eJxzo`, `4JjzCpYCQjppcQHhQ9MEv9jj5trUunpgumAqvMtrmjEb`, `CMKG5ihUMBRsbHQG5Vj2kuaZnaaRrRk2qCdq3bZFUf4M` | researcher 1 balance +0.5 NEAR exactly |
| bounty B created, no commits | `2VLLaPpRiWg4ghVDRJNxpbv1aLURKZdMATphhXytzYng` | ok |
| researcher 2 withdraws its credit (1 yoctoNEAR attached) | `4DBFH8ZCbgtQEh984N8H369tsvUBPrDJeT3ddVj41aGe` | credit 0 |
| expire bounty B | `C3hsfHVfhSQ9xWVhQBgjWpgXA3qG6F1noFNBMPhs5gbP` | vendor +0.5 NEAR exactly |
| expire bounty A (already paid) | `EAomjDsQ41Z1Wt5XZLAZ6Abu6pGQv1nRFbeq4o9HGJew` | the 0.025 NEAR of fees to the verifiers: 8,333,333,333,333,333,333,334 / 8,333,333,333,333,333,333,333 / 8,333,333,333,333,333,333,333 yoctoNEAR |
| expire bounty A again | `FLSQZWSQYjcf6QPGk2RDs5NyMPV5xFKJe9sfdEMfFE8Q` | refused: "nothing to do: bounty already closed and fees already swept" |

Failures on the way: `scripts/s3b_setup.sh` stopped once with exit 141 after deploying: the random suffix pipe
(`tr ... | head -c 5`) ended with a broken pipe under `set -o pipefail`. Replaced by a Python one-liner and re-run with
`SKIP_DEPLOY=1`. Not tested yet: an AI agent's function call key spending credit (that is spike S7).

The S3 contract on `kintsugi-djloo.testnet` (no fees) is left as it was; its S3 evidence above still describes it.

## S2b: Cutting the proving cost

Question: where do the guest's cycles go, and can the cost drop while every input still gets a fresh instance (fresh memory,
globals and state)?

**Verdict: PASS (2026-10-24).** The work a proof must cover dropped by 42 to 46% with identical verdicts, and a real laptop
proof at 16 inputs and 32 variants took 46.9 minutes instead of 85.4 (45% less). Still above the blueprint's 15 minutes.

Confirming proof, same settings as the S2 baseline (16 fairness inputs, 32 variants, segment size 2^19, CPU only):

```bash
MAX_SECONDS=7200 scripts/s2_measure.sh target/s2b-logs/prove_f16_alloc.log -- ./target/release/kintsugi-host prove data/demo/fixed.wasm --fuzz-count 16 --variants 32 --po2 19 --out target/s2/receipt_f16_alloc.bin
./target/release/kintsugi-host verify target/s2/receipt_f16_alloc.bin
```

| | S2 baseline (default allocator) | S2b (freeing allocator) |
| --- | --- | --- |
| Prove time | 5,124.96 s (85.4 min) | **2,814.45 s (46.9 min)** |
| Segments at 2^19 | 43 | 27 |
| Total cycles | 22,282,240 | 13,664,256 |
| User cycles | 7,845,739 | 8,587,922 |
| Prover peak memory (r0vm VmHWM) | 4,718 MiB | 4,724 MiB |
| Receipt (composite) | 11,516,294 bytes | 7,180,838 bytes |
| Verify in a separate process | 1.63 s, VALID | 0.92 s, VALID |
| Journal verdict | PASS | PASS |

Outputs: `docs/evidence/S2b/prove_f16_alloc.txt`, `docs/evidence/S2b/verify_f16_alloc.txt`.

What we found:

- The checker already parsed, validated and compiled each module once per check (`Loaded::load`); every input then got a
  new wasmi store and instance. That stays: fresh memory, globals and state for every input.
- A cycle profile (`kintsugi-host execute ... --profile`, guest cycle counter around each phase, printed by the guest and
  never put in the journal) shows that 74 to 77% of the guest's cycles are interpreter setup per input. Each instance's
  memory is 2 pages (128 KiB), and wasmi fills all of it with zeros when the instance is created.
- The work a proof must cover ("padded cycles", the sum of 2^po2 over segments) was 2.6 times the guest's own cycle count.
  The guest used RISC Zero's default allocator, which never frees, so every new instance landed on memory pages the prover had
  not loaded yet in that segment, and loading pages costs cycles.
- Change: the guest now uses RISC Zero's freeing allocator (`risc0-zkvm` feature `heap-embedded-alloc`,
  `harness/check-guest/Cargo.toml`). A new instance reuses the memory the last one freed, already loaded by the prover; wasmi
  still zero-fills it, so nothing carries over between inputs.

Cycles, executor only (`docs/evidence/S2b/before_profile.txt`, `docs/evidence/S2b/after_profile.txt`):

| Fairness / variants | Padded cycles before | after | change | Segments (2^20) before | after | User cycles before | after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 16 / 32 | 20,185,088 | 11,010,048 | -45% | 20 | 11 | 7,891,548 | 8,639,064 |
| 64 / 32 | 36,700,160 | 19,922,944 | -46% | 35 | 19 | 14,384,576 | 15,754,945 |
| 128 / 32 | 58,720,256 | 31,457,280 | -46% | 56 | 30 | 22,909,934 | 25,071,218 |
| 16 / 8 | 12,582,912 | 7,340,032 | -42% | 12 | 7 | 4,989,582 | 5,454,000 |

| Phase (16 / 32) | Before | Share | After | Share |
| --- | --- | --- | --- | --- |
| reading the input | 207,950 | 3% | 212,650 | 2% |
| module load (parse, validate, compile, trial instance) | 541,848 | 7% | 611,522 | 7% |
| interpreter setup per input (fresh store, instance, 128 KiB memory, input) | 6,037,023 | 77% | 6,415,038 | 74% |
| running the patch | 928,955 | 12% | 939,633 | 11% |
| the rest of the checker (input generation, comparisons) | 139,794 | 2% | 407,663 | 5% |
| hashing for the journal | 6,122 | 0% | 10,122 | 0% |
| writing the journal | 19,280 | 0% | 22,068 | 0% |
| total (guest cycle counter) | 7,880,972 | | 8,618,696 | |

The guest's own cycle count rose 9% (the allocator's bookkeeping), but the padded cycles fell 42 to 46%.

Verdicts before and after, for the full S1 corpus (seed as in S1, 16 fairness inputs, 32 variants), native table and inside
the zkVM (`docs/evidence/S2b/`):

| Module | Expected | Native before | Native after | zkVM before | zkVM after | Same? | zkVM user cycles before | after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fixed.wasm` | PASS | PASS | PASS | PASS | PASS | yes | 7,845,739 | 8,587,922 |
| `original.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 845,382 | 958,886 |
| `constant.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 646,313 | 757,453 |
| `disable_lists.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,177,282 | 1,318,433 |
| `early_return_prefix.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,438,823 | 1,592,912 |
| `imports_host.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 746,270 | 851,703 |
| `invalid_truncated.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 474,284 | 566,795 |
| `loop_forever.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 3,104,820 | 3,219,124 |
| `memorize_tests.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,979,140 | 2,218,585 |
| `memory_declared.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 730,340 | 833,414 |
| `memory_grow.wasm` | FAIL | PASS | PASS | PASS | PASS | yes | 7,864,242 | 8,609,977 |
| `memory_grow_nomax.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 854,505 | 967,897 |
| `memory_grow_use.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 859,735 | 973,314 |
| `overbroad_fix.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 2,266,206 | 2,512,489 |
| `reject_all.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 641,604 | 752,451 |
| `special_case_exploit.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 4,230,768 | 4,659,546 |
| `subtle_change.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 3,582,169 | 3,925,710 |
| `too_large.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,134,058 | 1,202,194 |
| `wrong_export.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 731,751 | 835,093 |
| `wrong_fix.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 849,393 | 962,985 |

20 of 20 modules give the same verdict natively and in the zkVM, before and after.

Native checker tests after the change: `cargo test -p kintsugi-check --offline`: 16 passed.

Not changed: the 128 KiB zero fill per input remains the largest cost. Halving it would need modules that declare 1 memory
page instead of 2, which changes the demo program and corpus; not done.

## S2: How slow and heavy is proving?

Question: time to prove, peak memory, receipt size, cycle count and verification time for the checker inside RISC Zero at
16, 64 and 128 fairness inputs (32 crash variants each, honest patch `data/demo/fixed.wasm`). `RISC0_DEV_MODE=0` on every
run. Proving is local (`r0vm` 3.0.6, CPU only, 16 cores, about 10 GiB RAM for WSL). Outputs in `docs/evidence/S2/`.

**Verdict: FAIL against the blueprint's pass condition (under about 15 minutes per proof), measured 2026-10-24.** All three
proofs completed and verified, but the fastest (16 inputs) took 85 minutes. Fallback taken: record the real numbers, use
smaller segments for memory, and propose smaller limits and a cheaper per-run cost (below). The verdict window W must be set
from these numbers.

### Cycles (executor only, no proof)

```bash
./target/release/kintsugi-host execute data/demo/fixed.wasm --fuzz-count <N> --variants 32
```

| Fairness inputs | User cycles | Segments at 2^20 | Execute time | Verdict |
| --- | --- | --- | --- | --- |
| 16 | 7,845,739 | 19 | 1.92 s | PASS |
| 64 | 14,306,190 | 35 | 3.27 s | PASS |
| 128 | 22,788,162 | 56 | 4.99 s | PASS |

The cheat `special_case_exploit` at 64 inputs: 10,741,914 user cycles, FAIL. Output: `docs/evidence/S2/execute.txt`.
At 16 inputs, a segment limit of 2^19 gives 43 segments and 2^18 gives 104 (`docs/evidence/S2/execute_po2.txt`).

### Proofs

| Fairness inputs | Segment size | Result | Prove time | Prover peak memory | Receipt | Verify |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | 2^20 (default) | **stopped by us after 180 s**: r0vm reached 8,600 MiB resident, 423 to 884 MiB left available, 3 GiB swap in use | - | at least 8,600 MiB | - | - |
| 16 | 2^19 | **proved**, journal verdict PASS | 5,124.96 s (85.4 min) | 4,718 MiB (r0vm VmHWM, read 25 min into the run) | composite, 11,516,294 bytes (seal 11,506,616 bytes, journal 780 bytes); 43 segments, 22,282,240 total cycles | 1.63 s in a separate process |
| 64 | 2^19 | **proved** within its 3 hour cap, journal verdict PASS | 7,993.49 s (133.2 min) | 4,730 MiB (r0vm VmHWM, sampled every 5 s; lowest available 3,382 MiB) | composite, 20,642,762 bytes (seal 20,626,760 bytes, journal 780 bytes); 77 segments, 40,370,176 total cycles | 2.86 s in a separate process (VALID) |
| 128 | 2^19 | **proved** within its 4 hour cap, journal verdict PASS | 12,664.94 s (211.1 min) | 4,748 MiB (r0vm VmHWM, sampled every 5 s; lowest available 3,200 MiB) | composite, 32,926,822 bytes (seal 32,902,264 bytes, journal 780 bytes); 123 segments, 64,028,672 total cycles | 4.75 s in a separate process (VALID) |

Commands:

```bash
scripts/s2_measure.sh target/s2-logs/prove_f16_po19.log -- ./target/release/kintsugi-host prove data/demo/fixed.wasm --fuzz-count 16 --variants 32 --po2 19 --out target/s2/receipt_f16.bin
./target/release/kintsugi-host verify target/s2/receipt_f16.bin
MAX_SECONDS=10800 RUST_LOG=info scripts/s2_measure.sh target/s2-logs/prove_f64_po19.log -- ./target/release/kintsugi-host prove data/demo/fixed.wasm --fuzz-count 64 --variants 32 --po2 19 --out target/s2/receipt_f64.bin
./target/release/kintsugi-host verify target/s2/receipt_f64.bin
MAX_SECONDS=14400 scripts/s2_measure.sh target/s2-logs/prove_f128_po19.log -- ./target/release/kintsugi-host prove data/demo/fixed.wasm --fuzz-count 128 --variants 32 --po2 19 --out target/s2/receipt_f128.bin
./target/release/kintsugi-host verify target/s2/receipt_f128.bin
```

### Where the cycles go (executor, `docs/evidence/S2/execute_breakdown.txt`)

| Run | User cycles |
| --- | --- |
| no fairness inputs, no variants (validate, crash input, 17 public tests) | 1,818,418 |
| 16 fairness inputs, no variants | 3,969,905 |
| no fairness inputs, 32 variants | 5,694,449 |
| 16 fairness inputs, 8 variants | 4,959,939 |

- Each fairness input costs about 134,000 user cycles and each variant about 121,000 (each runs the original and the
  candidate). One module run costs about 60,000 to 67,000 cycles, while the module itself uses at most about 2,100 fuel: almost
  all the cost is setting up a fresh wasmi instance for every input.
- Measured proving speed on this machine, from the three proofs: 230, 198 and 198 seconds per million total cycles.

### What this means, and the proposal

- **15 minutes is out of reach on this CPU with the current harness.** Even the base run (no fairness inputs, no variants)
  is 1.8 million user cycles. No proof with fewer inputs was run, so no time for one is claimed.
- **Proposal 1 (biggest effect, code change):** stop creating a fresh interpreter for every input. Load and validate each
  module once and reset only its memory between runs. To be measured with `execute` first.
- **Proposal 2 (smaller limits, from blueprint section 7):** 16 fairness inputs and 8 variants (4,959,939 user cycles,
  measured above, about 63% of the 16/32 run). Proving time for it is not measured.
- **Proposal 3:** the verdict window W must be at least K times the slowest proof plus a margin. With the measured 85 minutes
  at 16 inputs and K = 3, W is at least about 4.3 hours on this machine.
- **Proposal 4:** a faster prover machine (more cores or an NVIDIA GPU) would change these numbers; not measured.
- Receipts here are composite (one proof per segment): 11.5 to 32.9 MB, too big to store on chain (about 1 NEAR per 100 KB).
  A succinct receipt (compressed into one proof) or Groth16 is needed before the contract can use it; not measured yet.

Notes, kept on purpose:

- The 16 input proof took 85 minutes: more than the blueprint's "under about 15 minutes" pass condition at the smallest
  setting.
- `scripts/s2_measure.sh` was edited by us while it ran this proof (to add a time limit), which broke the script's last
  lines: the exit code, wall time and final peak memory lines were not written. The host's own output (prove time, sizes,
  journal) is complete. The memory figure above is the r0vm peak (VmHWM) read by our status sampler 25 minutes into the run.
- `/usr/bin/time` cannot measure the prover's memory here: it reported 13 MB for the stopped 2^20 run because r0vm is a
  separate process it does not see.

## S1 (zkVM part): the checker inside RISC Zero, and tampered receipts

**Verdict: PASS (2026-10-24).** This finishes S1 together with the native results below.

- The zkVM guest `harness/check-guest` (image id `d3f158571bbb5af7d57751350f8f5fc3baa6e5ce155199c8186849e92ff628a3`) runs
  the same checker and commits only the journal; the crash input and salt stay inside. Inside the zkVM the honest fix gives
  PASS and the cheat `special_case_exploit` gives FAIL (executor, `docs/evidence/S2/execute.txt`).
- Journal of the 16 input proof: verdict PASS, candidate hash `42edaaf5...fdc97`, original hash `fce3c7f2...45fd8`,
  exploit commitment sha256(salt || exploit) `9a1be994...66387`, corpus hash `736d160d...a1e61b`, the S1 seed, counts 16 and
  32. Full values: `docs/evidence/S2/prove_f16_po19.txt`.
- Separate process checks (`docs/evidence/S2/verify_tamper_f16.txt`):

| Receipt file | Command | Result | Exit |
| --- | --- | --- | --- |
| the real receipt | `kintsugi-host verify target/s2/receipt_f16.bin` | VALID, verdict PASS, 1.628 s | 0 |
| verdict in the journal changed PASS to FAIL (`kintsugi-host tamper ... journal`) | `kintsugi-host verify target/s2/receipt_f16_tampered_journal.bin` | INVALID: claim digest does not match the expected digest | 1 |
| one bit flipped in the seal (`kintsugi-host tamper ... seal`) | `kintsugi-host verify target/s2/receipt_f16_tampered_seal.bin` | INVALID: verification indicates proof is invalid | 1 |

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

**Verdict: PASS for the native checker (2026-10-23), with one mismatch explained below.** The zkVM part (receipt, and
tampered receipts failing in a separate process) passed on 2026-10-24; see "S1 (zkVM part)" above.

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
- **Decision (2026-10-23): `memory_grow` stays PASS.** A memory request that the module's own declared limit refuses gives
  the module nothing: no extra memory, no different output. The checker judges what a patch does, and this patch does exactly
  what the honest fix does on every input checked. Patches that really obtain or touch extra memory still FAIL
  (`memory_grow_use`, `memory_grow_nomax`, `memory_declared`).
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
