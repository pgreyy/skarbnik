# Managed confidential proving

**Planned.** Roadmap item 1. The managed service is not built. A CPU spike on Phala Cloud has been run end to end
(below, with links to the raw files); a GPU spike has not.

## The goal

Skarbnik runs one shared sealed prover for many vendors: managed confidential proving. A vendor enrols its secret
input once and pays per proof. Neither we nor the machine's host can read the secret, and the hardware's certificate
(a remote attestation) shows which program holds it.

Today each vendor proves on its own machine or rents a GPU, and whoever runs that machine can read the secret while it
proves. A sealed prover removes that step, and spares a vendor from running a prover at all.

## The vendor flow

1. `init` and `check`: as today (`tools/skarbnik-vendor`); the preflight runs on the vendor's machine.
2. `enroll` (new): the vendor's tool fetches the sealed prover's attestation, checks it (genuine hardware, the key it
   publishes is bound into the quote, the program is the published one by its compose hash and image digest), and
   only then sends the secret input and the salt, encrypted to that key. The secret lives only inside the sealed VM.
3. `publish`: as today. Proof 0 can be made inside the sealed prover too.
4. Automatic proving: for each revealed attempt, the sealed prover proves inside the TEE (a trusted execution
   environment) and hands out the receipt, which holds no secret.
5. Shrink, Groth16 and `submit_groth16`: secret free, so they can run anywhere (the vendor's machine, our service, or
   anyone). The contract is unchanged: it checks the Groth16 proof exactly as now.

## Trust model

- The TEE protects the secret while proving: memory is encrypted by the CPU, and the secret is released only to a
  program whose measurement the vendor checked.
- The zero knowledge proof still decides payment. The contract pays on a valid proof of the checker's verdict; it
  never looks at the attestation.
- The attestation is not the verdict. A broken or faked TEE could leak the secret, but it could not forge a PASS: the
  proof would still have to verify against the checker's image id on chain.
- What stays trusted: the CPU vendor (Intel TDX here) and its certificates, the TEE host's OS image as measured, and
  our sealed program as published by digest.

## What the spike showed

All of it on Phala Cloud CPU confidential VMs (Intel TDX), driven from the project VPS; the write-up with every step,
time and failed try is [docs/evidence/tee_spike/README.md](evidence/tee_spike/README.md); the code is
[tools/tee-spike/](../tools/tee-spike/).

- **Attestation a vendor can check itself.** In both CVMs: the TDX quote is valid against Intel's certificates
  (dcap-qvl on the VPS, status UpToDate) and to Phala's verifier; report_data binds the key the sealed program
  publishes; RTMR3 replays from the event log; the compose hash matches the deploy and our compose file, which pins
  our image by digest. Nothing was sent before these passed (`checker_run/verification.json`, `prove_run/verification.json`).
- **A fresh quote.** Right before the secret went, the vendor sent a random nonce and got a new quote with report_data
  = sha256(key || nonce), checked the same way, with the same key and measurements, 1.88 s later
  (`prove_run/fresh_verification.json`).
- **No way to log in that we could find.** No SSH keys in the CVM's user config or on the account; no environment
  variables allowed; a scan of every TCP port from inside the VM found only our server (8080) and Phala's read only
  guest agent page (8090), and no SSH banner; the gateway's SSH route sends nothing; the OS image is a production one,
  where Phala says SSH is off (`prove_run/logins.json`, `prove_run/probe.json`).
- **The checker, sealed.** In a `tdx.small` CVM: PASS for the public demo secret with the demo fix, FAIL for a fresh
  private secret with a wrong fix; each answer sealed to its request, so only the attested program could have written
  it (`checker_run/`). Cost $0.002725.
- **The prove step, sealed, paid on chain.** Test bounty 33: Proof 0 on a normal rented GPU (RunPod L40S, $0.0409);
  one researcher attempt; its RISC Zero prove step inside a `tdx.xlarge` CVM (8 vCPU, 16 GB): 6,226.5 s, 101 segments,
  PASS, the secret erased; the receipt (no secret) out, its hash equal to the sealed status; the CVM deleted at once;
  the shrink on a RunPod GPU ($0.0515), Groth16 on the VPS, and `submit_groth16`
  `Gg81ZZgdnjMrCFM6sZ6KuaW48e2kmKXiG2TUAp8jizmS`: Passed, bounty 33 Paid. Reveal to payout 2 h 10 min 34 s. The
  contract was not changed.
- **Cost.** Phala $0.838183 in all (the cap was $4), RunPod $0.0924.

What it did not show, and what is still open:

- **The OS image was not rebuilt.** We trusted the measured OS values (MRTD, RTMR0 to RTMR2, `os_image_hash`) as Phala's
  verifier reports them, without rebuilding Phala's dstack OS and comparing.
- **Our image is not reproducible.** It holds prebuilt binaries (their sha256 are recorded); a reader can check the
  digest, not rebuild the same bytes.
- Phala's pre-launch script is measured (inside the compose hash) but was accepted as Phala wrote it.
- The quote names no specific machine (`device_id` is empty).
- Only the CPU prover ran sealed. The GPU prover inside a GPU TEE is untested.
- The vendor's own machine still held the secret (it made and sent it). Enrolment that keeps the secret off every
  machine but the sealed one is not built.

## Providers and facts, as checked

| Provider | What | Price and terms | Checked |
| --- | --- | --- | --- |
| Phala Cloud, GPU TEE | H200 with Intel TDX (`h200.small`: 1 x H200 SXM 141 GB, 24 vCPU) | $5.50 per GPU hour (Phala's public instance list, `GET /api/v1/instance-types/gpu`, 2026-10-29); 24 hour minimum, assigned within a day | price from the API; minimum and lead time from Phala's terms as given to us, not tested |
| Phala Cloud, CPU CVM | Intel TDX VMs, `tdx.small` (1 vCPU, 2 GB) to `tdx.8xlarge` (64 vCPU, 128 GB) | $0.058 to $3.712 an hour, billed by the minute while running; disk $0.000139 per GB hour until deleted | prices from `GET /api/v1/instance-types/cpu`, 2026-10-29; used in the spike (`tdx.small`, `tdx.xlarge`) |
| Azure | Confidential VMs with an H100 (NCCadsH100v5) | not checked | to verify |
| Google Cloud | Confidential VMs with an H100 (A3) | not checked | to verify |
| NEAR AI Cloud | private inference in TEEs; custom workloads | unconfirmed | to verify |
| NEAR Shade Agents | agents hosted in TEEs | deprecated by NEAR | NEAR docs |

## Simple economics

One always-on sealed GPU at $5.50 an hour costs about $132 a day, whatever the load. Price per proof is that cost
divided by the proofs it makes:

| Proofs a day | GPU cost per proof |
| --- | --- |
| 10 | $13.20 |
| 50 | $2.64 |
| 100 | $1.32 |
| 500 | $0.26 |

On an L40S (not sealed) one prove and shrink took 50 to 60 s (docs/numbers.md), so one GPU has room for well over
1,000 a day; the sealed H200's time is not measured. For comparison, the sealed CPU prove in the spike took 1 h 44 min
on a `tdx.xlarge` ($0.826 of CVM time for one proof). The Groth16 wrap (about 5 min of CPU) is secret free and runs
elsewhere. A rented GPU per attempt (about $0.04 a proof today, not sealed) stays cheaper at every volume in the
table. What a sealed prover buys is that no host can read the secret; its price per proof comes down only when many
vendors share it.

## Open questions

- RISC Zero's CUDA prover inside a GPU TEE (an H200 in confidential computing mode): does it run, and how much slower.
- How to keep enrolled secrets across restarts (sealed storage, a key management service) without us holding them.
- How a vendor checks updates to the sealed program before it gets their secret.
- Who may ask the sealed prover to prove (only revealed attempts, read from the chain).

## Next step

A GPU spike when the budget allows: one H200 day on Phala ($132 at the listed price), the attempt's prove inside it,
the same attestation checks as the CPU spike.
