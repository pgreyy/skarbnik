# Stored receipts

Real Groth16 proofs, saved exactly as the contract `kintsugi-l2-cihdp.testnet` reads them (a 256 byte seal and a 780 byte
journal, base64 in the argument files), all under the published checker image id
`dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc`. None of them holds a secret input: a journal holds
only hashes, the seed, counts, the submission id and the verdict.

## For judges: open a judge bounty with a real proof

| File | What it is |
| --- | --- |
| `bounty17_proof0_groth16.bin` | private bounty 17's Groth16 Proof 0 receipt (2,057 bytes), from `scripts/unpack_bounty.sh proof0`; journal sha256 `cc7aeb44...efaef`, equal to bounty 17's `proof0_journal_hash` on chain |
| `bounty17_proof0_args.json` | the same proof as hex (`skarbnik-host groth16-args`) |
| `judge_open_<id>.json` | `open_with_groth16` arguments for judge bounty `<id>` (18 to 22): that proof, unchanged |
| `judge_refuse_<id>.json` | the refusal case for judge bounty `<id>` (19 to 22): bounty 17's Proof 0 journal with the seal of another real proof (`demo_proof0_args.json`, the demo's Proof 0), so it passes every cheap check and fails at the pairing check |
| `demo_proof0_args.json` | the demo's Groth16 Proof 0 (the proof that opened bounties 1, 7 and the test bounties) |

Judge bounties 18 to 22 (`scripts/judge_bounties.sh`) have the same hashes as bounty 17, the smallest reward (0.1 NEAR),
a 24 hour verdict window and an expiry 40 days after 2026-10-26. They were created closed. Each can be opened once, by
anyone, with `judge_open_<id>.json`; the README's "Try it" steps 3, 5 and 6 give the commands and the expected output.
Results so far (`docs/evidence/judge/summary.txt`):

- bounty 18 opened by a throwaway account that is not the vendor: tx `GhjkpLgkcwUbnWA743FezQEx8WLLXxCtvA7vT9eCfWdb`,
  35.247 Tgas; the same call again was refused, "bounty is already open" (tx `BVMoi97TTU9bZDqNukW8Loor6dcBocyWHdtVff9Kx1dg`);
- the refusal case on closed bounty 22: tx `5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj`, "the Groth16 proof does not
  verify for this bounty's image id and this journal", 34.856 Tgas (the pairing check ran); bounty 22 stayed closed.

Local check (after building the host, README step 9): `./target/release/skarbnik-host verify
docs/evidence/receipts/bounty17_proof0_groth16.bin` prints `VALID` and the journal (`docs/evidence/judge/verify_bounty17_proof0.txt`).

## History: receipts of decided attempts (cannot be sent again)

These two files are the PASS proof of bounty 1, attempt 0 (the honest fix `data/demo/fixed.wasm`, spike S6c), read back
from the chain. They are kept as a record. Sending them to the chain again is refused before the proof check ("bounty is
closed"), because both bounties are closed, so they are not a check a judge can run on chain.

- `valid_pass_bounty1_attempt0.json`: accepted and paid, tx `CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY` (36.392 Tgas).
- `wrong_bounty_11_attempt0.json`: the same proof sent for bounty 11, refused "the journal belongs to another bounty or
  attempt (submission id)", tx `8fYiFjirrv8N2XKdxzWJA7y8d9izXUwPJ5d5r4NKMahM` (2.35 Tgas, refused before the pairing check).

The same bytes run in the contract's unit tests (`contract/src/groth16_attempt_vectors.rs`):
`cargo test -p kintsugi-contract --offline s1_` (5 tests).
