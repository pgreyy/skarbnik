# Try it: ten steps from a fresh clone

Every step names the command and what it prints, with the run that produced it. The 5 to 10 minute tour with no
install is [JUDGE_GUIDE.md](../JUDGE_GUIDE.md); this is its hands-on part (Level B).

The facts the steps use:

```
site_url: https://skarbnik.xyz
contract: kintsugi-l2-cihdp.testnet
network: NEAR testnet
checker_image_id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
official_demo_bounty: 7
private_demo_bounty: 12
judge_bounties: 27, 28, 29, 30, 31 (closed at writing: 28, 29, 30, 31)
retired_judge_bounties: 18, 19, 20, 21, 22
paid_by_proof: 1, 16, 24, 27, 32
paid_by_timeout: 4, 9, 11, 13, 17 (and 8 on paper only: its transfer failed, finding 8)
feed_url: https://skarbnik.xyz/feed.json
ledger_url: https://skarbnik.xyz/#/evidence/ledger
agent_quickstart_url: https://skarbnik.xyz/agent-quickstart.txt
numbers: docs/numbers.md
receipts: docs/evidence/receipts/README.md
```

## The steps


Run these from the root of a fresh clone (`git clone https://github.com/pgreyy/skarbnik && cd skarbnik`). Steps 1 to 4
need only `curl` and `python3`. Steps 5 and 6 need near-cli-rs 0.30.1 and a testnet account. Step 8 needs the Rust
toolchain. Steps 9 and 10 are optional and need Docker.

1. **Read the official demo bounty from the chain.**

       curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kintsugi-l2-cihdp.testnet","method_name":"get_bounty","args_base64":"eyJib3VudHlfaWQiOiI3In0="}}' | python3 -c 'import json,sys; b=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(b["id"], b["level"], b["state"], b["opened"], b["image_id"], b["image_id_allowed"])'

   See: `7 2 Open True dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc True` (Level 2, open, opened by
   its Proof 0, the published checker id, on the allowlist).

2. **Check that the contract accepts only the published checker.**

       curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kintsugi-l2-cihdp.testnet","method_name":"get_allowed_image_ids","args_base64":"e30="}}' | python3 -c 'import json,sys; ids=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(ids, "MATCH" if ids == ["dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc"] else "DIFFERENT")'

   See: `['dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc'] MATCH`.

3. **See which judge bounties are still closed.** Judge bounties 27 to 31 have the same hashes as private bounty 17 and
   were created closed, so anyone can open one with a real proof (step 5). Each can be opened once. They take K = 2
   attempts, at most 1 per account, with a 41 hour verdict window; the vendor's watch proves their attempts on a rented
   GPU. Judge bounties 18 to 22 (round 1) are retired: they stay on chain for the record.

       for i in 27 28 29 30 31; do curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"kintsugi-l2-cihdp.testnet\",\"method_name\":\"get_bounty\",\"args_base64\":\"$(printf '{"bounty_id":"%s"}' $i | base64)\"}}" | python3 -c 'import json,sys; b=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(b["id"], "opened" if b["opened"] else "closed")'; done

   See, as of 2026-10-27: `27 opened` (opened by our test from a throwaway account, tx
   [`FPuvqMBp6Kao3GB46p9FDP2hEmS59pCtiLxv4fQdeSnV`](https://testnet.nearblocks.io/txns/FPuvqMBp6Kao3GB46p9FDP2hEmS59pCtiLxv4fQdeSnV),
   35.251 Tgas), then `28 closed`, `29 closed`, `30 closed`, `31 closed`. A bounty another judge opened shows `opened`.
   (Round 1's test opened 18: [`GhjkpLgkcwUbnWA743FezQEx8WLLXxCtvA7vT9eCfWdb`](https://testnet.nearblocks.io/txns/GhjkpLgkcwUbnWA743FezQEx8WLLXxCtvA7vT9eCfWdb), 35.247 Tgas.)

4. **Open the live site.** https://skarbnik.xyz/#/bounties/7 shows "Bounty 7: official demo" with the chips "Demo",
   "Public input" and "Level 2", read live from testnet. https://skarbnik.xyz/#/bounties/17 shows "Timeout settlement"
   and "Why this is not “Proof verified”", with the claim transaction.
   The same site runs from this clone with `python3 -m http.server 8000 --directory web` and http://localhost:8000/#/bounties/7 .

5. **Open a closed judge bounty with a real proof, from your own account.** Make a testnet account from the faucet, then
   send bounty 17's stored Groth16 Proof 0 to one bounty that step 3 shows as closed (here 28; use 29, 30 or 31 if 28 is
   already open). The contract checks the proof on chain and opens the bounty.

       near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
       near contract call-function as-transaction kintsugi-l2-cihdp.testnet open_with_groth16 file-args docs/evidence/receipts/judge_open_28.json prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as <you>.testnet network-config testnet sign-with-legacy-keychain send

   See: the log line `EVENT_JSON:{"standard":"kintsugi","version":"1.0.0","event":"bounty_opened","data":[{"bounty_id":"28","by":"groth16","caller":"<you>.testnet"}]}`
   and the return value `"opened"`; about 35 Tgas burned in total (the pairing check alone is about 30 Tgas). Step 3 then
   shows `28 opened`. Sent again, the same call is refused: "bounty is already open" (our run on 27: tx
   [`FehQ8siwReoi46uCgQjTgZwRUyGnbryjNuqTjZNMnRMp`](https://testnet.nearblocks.io/txns/FehQ8siwReoi46uCgQjTgZwRUyGnbryjNuqTjZNMnRMp)).

6. **See the contract refuse a proof at the proof check itself.** `judge_refuse_<id>.json` holds bounty 17's real Proof 0
   journal (so every cheaper check passes) with the seal of another real Groth16 proof (the demo's Proof 0). Send it to a
   closed judge bounty; it stays closed, so this step can be repeated.

       near contract call-function as-transaction kintsugi-l2-cihdp.testnet open_with_groth16 file-args docs/evidence/receipts/judge_refuse_31.json prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as <you>.testnet network-config testnet sign-with-legacy-keychain send

   See: `Smart contract panicked: the Groth16 proof does not verify for this bounty's image id and this journal`. Our run (on
   bounty 22, round 1, with the same journal and seal): tx [`5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj`](https://testnet.nearblocks.io/txns/5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj),
   34.856 Tgas burned: the pairing check ran (refusals from the earlier state checks cost about 2 Tgas).

7. **See the attempt cap stop a probe agent.** A seeded probe account sent 12 probe commits to bounty 23 (the real cap
   K = 3 and rising fee); the contract counted 3 and ignored 9 at no cost, so at most 3 of the 12 bits of the probe's
   target could ever be learned. The same probe with no cap, simulated on our machine only, learned all 12.

       curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"kintsugi-l2-cihdp.testnet","method_name":"get_bounty","args_base64":"eyJib3VudHlfaWQiOiIyMyJ9"}}' | python3 -c 'import json,sys; b=json.loads(bytes(json.load(sys.stdin)["result"]["result"])); print(b["id"], b["commits"], b["max_commits"], b["fees_collected"])'

   See: `23 3 3 45000000000000000000000` (3 commits counted of a cap of 3, 0.045 NEAR of fees: 0.01, 0.015 and 0.02). Both
   runs side by side, labelled real and simulated: https://skarbnik.xyz/#/evidence/lab (docs/evidence/arena_probe/).

8. **Run the contract's tests** (cargo downloads the contract's crates, about 3 minutes the first time). They include the
   two real attempt proofs of bounty 1 from testnet, checked natively.

       cargo test -p kintsugi-contract

   See: `test result: ok. 135 passed; 0 failed` (steps 8 to 10 from a fresh clone at 469b288:
   docs/evidence/judge/fresh_clone_2026-10-26b.txt).

9. **Optional: rebuild the checker and compare its image id.** Downloads RISC Zero's guest builder image
   `risczero/risc0-guest-builder:r0.1.97.0` (7.46 GB) and needs Docker with buildx, RISC Zero's toolchain
   (docs/VERSIONS.md) and about 10 GB of free disk.

       ./scripts/check_image_id.sh kintsugi-l2-cihdp.testnet 17

   See, after the build:

       rebuilt checker image id:   dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
       published checker image id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
       image id of bounty 17 on kintsugi-l2-cihdp.testnet: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
       MATCH

   (docs/evidence/check_image_id_after_rename.txt)

10. **Optional: check the stored receipt on your machine.** After step 9:

       cargo build --release -p skarbnik-host
       ./target/release/skarbnik-host verify docs/evidence/receipts/bounty17_proof0_groth16.bin

   See (first lines; full output in docs/evidence/judge/verify_bounty17_proof0.txt):

       receipt file: docs/evidence/receipts/bounty17_proof0_groth16.bin (2057 bytes)
       image id: dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc
       VALID
       journal sha256: cc7aeb44e12433964ba9ff1b76a0207a5c78d3e3b5e46d8dc2d3c462554efaef
       journal.verdict: PASS

   The journal sha256 equals bounty 17's `proof0_journal_hash` on chain (`get_bounty`).

