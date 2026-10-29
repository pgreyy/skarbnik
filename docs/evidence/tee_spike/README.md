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

## The image

- `ghcr.io/pgreyy/skarbnik-tee@sha256:9a425458da58606807b6bf3028eaa9f26acf830b6a70cd3bd4bf701160fd7261` (tag
  `spike-2`, public). Base `python:3.12-slim-trixie@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159`;
  Python packages pinned with hashes (cryptography 50.0.1, dstack-sdk 0.5.4 and their dependencies).
- Binaries copied in from the VPS (the same ones the VPS proves with), sha256:
  `skarbnik-check` 5357671c873bf1f91d86c6f6c75af8c9f9e8c556f4c79e45abcbf13a48ae5b9b,
  `skarbnik-host` 9963514aa1993f0a1d6651d7d9b4984ee8589b5c0f656b52689531fdd6e4e147,
  `r0vm` 751b9b188d341e8bec5e02060086b7b1dc3f7289e90f726c38589bb6735dd6d7. The image is not a reproducible build:
  these are prebuilt binaries, so a reader can check the digest and the hashes, not rebuild the same bytes.
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

## What this does not show

- The OS image (`os_image_hash` `ec43cb8c...`, MRTD `2a674327...`, RTMR0 to RTMR2) was not checked against a build of
  Phala's dstack OS: we trusted Phala's verifier and the measured values as given. A vendor who wants that must
  rebuild the dstack OS image or compare against published measurements.
- Phala adds a pre-launch script (17,569 characters) to the app compose. It is inside the compose hash we checked,
  so it is measured, but we accepted it as Phala wrote it. Among other things it installs SSH keys for root when a
  deployer passes them (the `DSTACK_ROOT_PUBLIC_KEY` or `DSTACK_AUTHORIZED_KEYS` variables, or `ssh_authorized_keys` in
  the user config). We allowed no variables (`allowed_envs` is empty) and gave no user config; we did not check
  whether the user config is measured or whether the OS image runs an SSH server. A vendor should require both.
- `device_id` is sha256 of nothing (`e3b0c442...`), so the quote does not name a specific machine.
- The quote is made once at start, without a nonce from the vendor. A replayed quote would not help an attacker
  (the secret is sealed to a key only the attested program holds), but the vendor cannot tell an old instance from
  a new one.
- The image's binaries are prebuilt (see above).

## Part 2: the RISC Zero prove step inside a 16 GB CVM

Running. A new small test bounty with a fresh private secret; its Proof 0 is made on the VPS CPU first (about 10 h,
free). The first start of that Proof 0 failed in 5 s because the prover's `r0vm` was not on the PATH
(`proof0_failed_start.log`); restarted at 22:36 UTC with it on the PATH.
