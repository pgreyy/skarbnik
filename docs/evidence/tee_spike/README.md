# Confidential proving spike: Phala Cloud CPU CVM (Intel TDX)

Question: can a vendor check that a rented machine runs our exact program in genuine confidential hardware, send it
the secret input encrypted so only that program can read it, and get back a verdict that only that program could have
written? And can the RISC Zero prove step itself run there?

Everything ran from the project VPS. The source is in `tools/tee-spike/`:

| File | What it does |
| --- | --- |
| `container/server.py`, `container/Dockerfile`, `container/requirements.txt` | the sealed checker and prover (runs inside the CVM) |
| `compose.yaml` | what Phala runs: our image pinned by digest, the dstack socket, port 8080 |
| `vendor.py`, `Dockerfile.vendor`, `vendor-requirements.txt` | the vendor's side: verify, encrypt, send, read the sealed answer |
| `phala.py` | deploy, wait, show, delete and list CVMs through Phala's REST API |
| `make_secret.py` | makes a fresh private crashing input for the demo program (written mode 600, never printed) |
| `attempt_in_tee.py` | part 2's driver: one revealed attempt, proved inside a CVM, shrunk on a RunPod GPU, wrapped and submitted from the VPS |
| `cvm_watchdog.sh` | the safety net beside the driver: deletes every CVM if the driver dies or the balance reaches the floor |

## The image

- `ghcr.io/pgreyy/skarbnik-tee@sha256:9a425458da58606807b6bf3028eaa9f26acf830b6a70cd3bd4bf701160fd7261` (tag
  `spike-2`, public). Base `python:3.12-slim-trixie@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159`;
  Python packages pinned with hashes (cryptography 50.0.1, dstack-sdk 0.5.4 and their dependencies).
- Binaries copied in from the VPS (the same ones the VPS proves with), sha256:
  `skarbnik-check` 5357671c873bf1f91d86c6f6c75af8c9f9e8c556f4c79e45abcbf13a48ae5b9b,
  `skarbnik-host` 9963514aa1993f0a1d6651d7d9b4984ee8589b5c0f656b52689531fdd6e4e147,
  `r0vm` 751b9b188d341e8bec5e02060086b7b1dc3f7289e90f726c38589bb6735dd6d7. The image is not a reproducible build:
  these are prebuilt binaries, so a reader can check the digest and the hashes, not rebuild the same bytes.
- Part 2 used `spike-3` (`sha256:60f6bcf3862b67e91bb92858831c1279f28e6167131ee5eae94793933fabeb3d`): the same plus
  `POST /fresh-quote` and `POST /probe`.
- `spike-1` (`sha256:9a8fec8b...`) was pushed first and never deployed: the server refused hex with spaces (the
  public demo input has spaces), found in a local test on the VPS with a stand-in for the quote service.

## Part 1: the checker in the smallest CVM (2026-10-29)

CVM `cvm_mjb4ZVKM`, `tdx.small` (1 vCPU, 2 GB, $0.058 an hour), OS image `dstack-0.6.1`, node prod5 (US-WEST-1),
app id `b7fb9416331f716bf2d3551aae6165f19610ba7d`. Files in `checker_run/`.

| Time (UTC) | Step |
| --- | --- |
| 23:07:49 | `phala.py deploy skarbnik-tee-check compose.yaml tdx.small`: provision (compose hash `cadab313...`), create |
| 23:08:56 | running; 23:08:57 the server answers through Phala's gateway (about 65 s from create) |
| 23:09:15 | verify, try 1: the local Intel check failed, a bug in our tool (dcap-qvl's collateral call is async; `verification_try1_tool_bug.json`) |
| 23:09:53 | verify, try 2: the vendor container could not resolve Intel's address on Docker's default network (`verification_try2_dns.json`); fixed with `--network host` |
| 23:10:41 | verify, try 3: **all six checks passed** (`verification.json`) |
| 23:10:59 | check 1: public demo secret, `data/demo/fixed.wasm`: **PASS** (`verdict_1_demo_secret_fixed.json`) |
| 23:11:03 | check 2: a fresh private secret (made on the VPS with `make_secret.py`), `data/attacks/wrong_fix.wasm`: **FAIL**, "exploit: trapped" (`verdict_2_private_secret_wrong_fix.json`) |
| 23:11:21 | `phala.py delete`: deleted (HTTP 204), gone (404) at 23:11:44; CVM list empty (`delete.log`) |

The six checks (`vendor.py verify`), each in `verification.json`:

1. `tdx_quote_dcap_qvl`: the 5,010 byte TDX quote (v4, sha256 `4a65c31c...`) checked on the VPS with dcap-qvl 0.6.6
   against Intel's certificates fetched from Intel PCS: status **UpToDate**, no advisories (`dcap_qvl_report.json`).
   TD attributes `0000001000000000`: the debug bit is off.
2. `tdx_quote_phala_api`: Phala's public verifier says `verified: true` (`phala_verify.json`). A second opinion only.
3. `report_data_binds_key`: report_data is sha256 of the X25519 public key the server serves, then 32 zero bytes.
4. `rtmr3_replay`: RTMR3 replayed from the event log equals the quote's RTMR3 (`75d3be65...`); all 11 events' digests
   recomputed as sha384(event type, little endian u32 : name : payload).
5. `compose_hash`: sha256 of the app compose from `/info` = the compose-hash event in the log = the compose hash Phala
   returned at deploy (`cadab313685b897513650042278b2fd767bed8f865f1133b8fe74cc236afeb43`).
6. `compose_is_ours`: that app compose holds our `compose.yaml` byte for byte, which names the image by digest.

Only after these passed did `vendor.py check` send anything: the secret and the patch, sealed with ChaCha20-Poly1305
under a key from an X25519 exchange with the attested key. The answer is sealed under a second key from the same
exchange and bound to the request, so only the holder of the attested private key could have written the verdict.
Round trips 0.76 s and 0.97 s through the gateway; the checker itself 0.008 s and 0.005 s. The server reported the
secret erased from its RAM folder after each run. The private secret's hex appears in no file in `checker_run/`
(checked with grep on the VPS).

Cost: balance $5.000000 before, $4.997275 after: **$0.002725**.

## Part 2: the RISC Zero prove step of a real attempt, inside a 16 GB CVM (2026-10-29 and 30)

Test bounty 33 (`teespike`): the public demo program with a fresh private secret made on the VPS (`make_secret.py`),
reward 0.1 NEAR, K = 1. Only the attempt's prove step ran sealed. Proof 0 ran on a normal rented GPU.

**Proof 0, on a normal GPU (RunPod L40S, not sealed).** A first Proof 0 on the VPS CPU was started at 22:36 UTC and
stopped at 23:28 UTC on the owner's order (all proving now runs on RunPod GPUs; `proof0_cpu_stopped/`). The first GPU
try found no free GPU of the three listed types in the five listed data centers (`gpu_try1_no_instances.out`, no pod
made, no cost); with more GPU types and any data center: pod `bhdjz0kzp5godo`, L40S in US-MO-1, prove 30.21 s (32
segments), shrink 21.85 s, pod 135 s, $0.0409, secret wiped from the pod; Groth16 on the VPS 387.44 s; VALID, PASS
(`proof0_gpu/`). Published from the laptop with `tools/skarbnik-vendor publish`: create
`5kDG7MMat1VtLcLJibSafMSfzpqS87fCXZ3jKVuG9tnN`, open `2c5HgCeL9jTHRJTAPeWXcYSkBUxPmecLViZzVdy7dJD7` (a first create
with a 0.05 NEAR reward was refused by the contract: the minimum is 0.1).

**The attempt.** A researcher account with a key limited to commit and reveal, through `tools/skarbnik-mcp`:
commit `8Bs9mYwhw7JusbXyLaPkQN86ekc3sRHB6gnrToWWiYnQ`, reveal `6hxzXjgaJC8yREyBvfAem9d6u2AZL9YqPwhonYo48i2d` at
23:44:17 UTC (patch `data/demo/fixed.wasm`).

**The sealed prove.** `tools/tee-spike/attempt_in_tee.py` on the VPS, with `cvm_watchdog.sh` beside it (deletes every
CVM if the driver dies or the balance reaches the $1.05 floor). Image `spike-3`,
`ghcr.io/pgreyy/skarbnik-tee@sha256:60f6bcf3862b67e91bb92858831c1279f28e6167131ee5eae94793933fabeb3d` (adds the
fresh quote and the probe). Files in `prove_run/`.

| Time (UTC) | Step |
| --- | --- |
| 23:46:38 | try 1, `tdx.xlarge`: the Intel check could not reach Intel's certificate service (its name did not resolve on the VPS); nothing sent; CVM deleted 127 s after create (`prove_try1_intel_dns/`). Fix: three tries, then Phala's mirror of Intel's collateral (signed by Intel, so no added trust) |
| 23:51:47 | try 2: Phala's API did not answer for two minutes; our wait step crashed on the timeout; CVM deleted 146 s after create (`prove_try2_phala_api_timeout/`). Fix: reads and deletes are retried, a create never is |
| 23:56:23 | try 3: CVM `cvm_AjWvzlwb`, `tdx.xlarge` (8 vCPU, 16 GB, $0.464 an hour), node prod5; answering 118 s after create |
| 23:58:28 | the six checks passed (`verification.json`; Intel collateral from Intel PCS; quote `607ebd28...`; compose hash `f873d33c...`) |
| 23:58:33 | who could log in (`logins.json`, below) |
| 23:59:18 | port scan from inside the VM (`probe.json`, below) |
| 23:59:20 | fresh quote: nonce made 23:59:20, answered in 1.88 s, all checks passed (`fresh_verification.json`, below) |
| 23:59:27 | the secret and the salt sent sealed to the attested key; the prove step started inside the CVM |
| 01:44:01 | prove done: 6,226.5 s (1 h 43 min 47 s), 101 segments at po2 18, peak 3,288 MiB used in the VM, verdict PASS, the secret erased (sealed status in `prove_status.json`) |
| 01:44:09 | composite receipt out: 25,841,722 bytes, sha256 `4e949347eb3315aa3936d53adf6e5fc32fbc7831221ca33d9ae80490b240b841`, equal to the hash in the sealed status (not committed: too large) |
| 01:44:34 | CVM deleted (6,491 s after create); CVM list empty |
| 01:48:23 | shrink on a RunPod L40S (no secret goes there): 58.63 s, pod 170 s, $0.0515 (`gpu_shrink.json`) |
| 01:54:45 | Groth16 on the VPS 379.81 s; VALID; journal: verdict PASS, the bounty's secret commitment, the attempt's submission id |
| 01:54:51 | `submit_groth16` `Gg81ZZgdnjMrCFM6sZ6KuaW48e2kmKXiG2TUAp8jizmS` (36.4 Tgas): outcome Passed, bounty 33 Paid, 0.1 NEAR to the researcher |
| 01:57:41 | the watchdog saw the driver end with no CVM left and stopped |

Reveal to `submit_groth16`: 2 h 10 min 34 s. The same prove step on the 4 core VPS took 22,228 s for a Proof 0 of the
same program (112 segments, 2026-10-27); this one took 6,226.5 s on 8 vCPUs (101 segments). The two inputs differ, so
this is a rough comparison, not a benchmark.

**Fresh quote with a vendor nonce.** Right before sending the secret the vendor made a random 32 byte nonce
(`3eb43d64...`) and asked for a new quote (`POST /fresh-quote`). Its report_data is sha256(public key || nonce)
followed by 32 zero bytes, it is valid with Intel's certificates (UpToDate) and to Phala's verifier, its RTMR3
replays, and its key, MRTD, RTMR0 to RTMR3 and compose hash equal the first quote's. So the quote was made after the
nonce existed, by the holder of the attested key, in the same measured VM.

**Who could log in.**
- SSH keys: the CVM's user config (`GET /api/v1/cvms/{id}/user_config`) has `ssh_authorized_keys: []`; the account's
  SSH key list (`GET /api/v1/user/ssh-keys`) is empty; the compose allows no environment variables, so the
  pre-launch script's SSH variables cannot be set.
- From inside the VM (`POST /probe`): every TCP port, 1 to 65,535, on the VM's Docker gateway (172.18.0.1) and on its
  internal address (10.4.65.100). Open: 8080 (our server) and 8090 (Phala's guest agent page). Nothing else; no port
  sends an SSH banner. The container has no Docker socket, only the dstack socket.
- From outside: the gateway's SSH route (`<app id>-22`, the route Phala documents for dev images) completes TLS but
  sends no bytes; `-22s` closes the connection; `-8090` serves Phala's read only "Worker Information" page.
- Phala's docs say SSH works only on dev OS images and production images have it turned off; we ran `dstack-0.6.1`,
  a production image.
- Answer: no SSH server or other remote shell answered, and no keys were supplied. Limits: the scan sees services on
  TCP only, from the container's network namespace; we did not read every page of the guest agent's site; a
  service bound only to the VM's loopback would not show.

## What this does not show

- The OS image (`os_image_hash` `ec43cb8c...`, MRTD `2a674327...`, RTMR0 to RTMR2) was not checked against a build of
  Phala's dstack OS: we trusted Phala's verifier and the measured values as given. A vendor who wants that must
  rebuild the dstack OS image or compare against published measurements.
- The image is not a reproducible build: its binaries are prebuilt copies from the VPS (their sha256 above).
- Phala adds a pre-launch script (17,569 characters) to the app compose. It is inside the compose hash we checked, so
  it is measured, but we accepted it as Phala wrote it.
- `device_id` is sha256 of nothing (`e3b0c442...`), so the quote does not name a specific machine.
- Part 1's checker runs used the start quote only; the fresh nonce quote was added for part 2.
- The secret was made on the VPS and sent from there; the VPS (the vendor's machine) can read it, by design.

## Cost

| Item | Cost | How measured |
| --- | --- | --- |
| Phala, part 1 (`tdx.small`, about 4 min) | $0.002725 | balance $5.000000 before, $4.997275 after |
| Phala, part 2 tries 1 and 2 (`tdx.xlarge`, 127 s and 146 s) | $0.009180 | balance $4.997275 to $4.988095 |
| Phala, part 2 try 3 (`tdx.xlarge`, 6,491 s) | $0.826278 | balance $4.988095 to $4.161817 |
| **Phala, total** | **$0.838183** | $5.000000 to $4.161817; the cap was $4 |
| RunPod, Proof 0 (L40S, 135 s) | $0.0409 | `proof0_gpu/proof0_times.json` |
| RunPod, shrink of the sealed receipt (L40S, 170 s) | $0.0515 | `prove_run/gpu_shrink.json` |
| **RunPod, total for the spike** | **$0.0924** | `~/skarbnik-vendor/gpu_spend.json` on the VPS (all GPU spend so far $0.3954) |

Phala's balance moved about once an hour while the CVM ran ($4.97238 from 00:01, $4.5056 from 01:02, $4.161817
after the delete), so a balance floor alone reacts up to an hour late; the floor ($1.05) was never near.
