# Running a bounty as a vendor: `skarbnik-vendor`

A vendor should not have to be a cryptography operator. `tools/skarbnik-vendor` (Python 3.11 or later, no packages)
takes a private bounty from a config file to an open bounty, and then proves every revealed attempt by itself. A
bounty is Level 2 by default; Levels 1 and 0 are explained below.
The same guide, shorter, is on the site: https://skarbnik.xyz/#/vendors, in two ways: AI (an AI app runs these
commands through tools/skarbnik-vendor-mcp, shows the cost first and asks for a one time confirm code before any
spend) and Commands (the five steps below).
It needs Linux (on Windows, WSL), Docker and an x86 computer for the Groth16 step (Level 2), and a GPU rental account
for a rented GPU.
It calls the project's own programs (`skarbnik-host`, `skarbnik-check`), `scripts/s2_measure.sh` for timing and the
memory guard, and NEAR CLI (near-cli-rs) for transactions. Testnet only.

## Levels

`level` in the config's `[bounty]` section (0, 1 or 2, default 2) is fixed when the bounty is created.

| Level | Who decides | What you need | Trust |
| --- | --- | --- | --- |
| 2 (default) | The contract checks a Groth16 proof of each fix itself (`open_with_groth16`, `submit_groth16`) | The Groth16 step: Docker, an x86 computer, about 7.6 GiB; about 36 Tgas of gas a proof | The published checker and the contract. The only level called paid by proof |
| 1 | OutLayer runs the verifier program pinned on chain (`get_outlayer`) on the succinct proof, and the contract trusts its answer (`open_with_outlayer`, `check_with_outlayer`) | No Groth16 step. Each check: about 0.006 NEAR (OutLayer's fee about 0.0011 NEAR plus about 50 Tgas of gas), and the contract's `min_deposit` (2.8 NEAR) attached, of which about 2.67 NEAR is held while OutLayer works and returned | OutLayer and its operator, and that OutLayer can download the pinned program from GitHub or still holds it in its cache |
| 0 | Two registered verifiers sign Proof 0 and each verdict (`attest_proof0`, `post_verdict`, `attest`) | Nothing proved on chain; the verifiers must sign in time | The verifiers, today both run by the project |

The pinned Level 1 program is the build of `verifier/outlayer` committed in this repository: sha256
`e60647ec50f76f591a6994963f1394d408f516947f2fe927e389daf2166346a8`, at
https://raw.githubusercontent.com/pgreyy/skarbnik/4e6a1f634bba37189edf288a857520d3ac3b5399/verifier/outlayer/farbox-verifier.wasm
(rebuilt to the same hash by `scripts/build_verifier_wasm.sh`). At Level 1 `prove0` and `watch` stop at the succinct
proof; `publish` opens with `open_with_outlayer` and `watch` sends each proof with `check_with_outlayer`, both from an
account that can attach a deposit (an agent's limited key cannot). At every level a timeout is a timeout: no verdict
in time means the waiting attempts are paid by rule.

## Commands

| Command | What it does |
| --- | --- |
| `init --out <file> [--from <older file>]` | Asks a few questions and writes a bounty config (TOML). `--from` reuses an older config's settings: only the secret and the fix change. Refuses a path inside the repository. |
| `check --config <file>` | The preflight, then a preview (below). Refuses with a plain reason if anything fails. |
| `prove0 --config <file>` | Proof 0 of the reference fix: prove, shrink to succinct, Groth16, verify, the contract arguments. One step at a time, with a progress line and the memory guard. Its times become the bounty's measured proof time. |
| `publish --config <file>` | Shows the preview again, asks you to type `publish`, then creates and opens the bounty and prints both transactions. Refuses if the verdict window is too short for the measured proof time. |
| `watch --config <watch file> [--once]` | The auto prover. Polls the chain for revealed attempts on the bounties it watches, proves each one (oldest first) with the attempt's seed and submission id, checks the verdict, the submission id and the secret's commitment against the chain, and sends `submit_groth16`. Warns early when a window is at risk. Runs unattended. |
| `status --config <watch file>` | Every watched bounty and attempt, its state and the next action needed. |

## The config

`tools/vendor.example.toml` is the template, with placeholder paths. Real configs name your secret files, so they live
outside the repository (for example `~/skarbnik-vendor/<name>.toml`, mode 600). The sections:

- `[bounty]`: name (also names the bounty's private salt), module folder (`original.wasm`, `public_tests.txt`),
  reward, K, the fee of the first attempt and the step per later attempt, the reveal gap and window, the verdict window,
  the expiry, the patch size limit (the checker allows up to 2,048 bytes; each bounty sets its own, and the
  open bounties use 1,024), the check size and the proof segment size (`po2`: 18 needs about 2.5 GiB, 19 about
  5 GiB).
- `[secrets]`: the secret crashing input and the reference fix. Files of mode 600, outside the repository.
- `[prover]`: the mode (`cpu`), the machine's name (proof times differ by machine), the work folder.
- `[chain]`: contract, RPC addresses, the published checker image id and the vendor account that signs create and open.
- `[paths]` (optional): where the binaries are.

A watch config has `[watch]` (state file, log, work folder, poll interval), `[prover]`, `[chain]` with the account that
signs `submit_groth16`, `[paths]`, and one `[[bounties]]` block per secret: the bounty ids, the salt name, the module,
the secret file and `po2`.

## What the preflight checks

1. The module exists and is within the checker's limits; the public tests are there. Patch size: the checker allows up to 2,048 bytes; each bounty sets its own limit (the open bounties use 1,024), shown in feed.json and on the bounty page
   (`max_patch_bytes`).
2. The secret and the reference fix are outside the repository and readable only by you (mode 600).
3. The original crashes on the secret input (the checker's own run).
4. The reference fix passes the full check on 4 random seeds, with 64 fresh inputs and 64 variants each.
5. Enough memory for the prover mode: the prover at the chosen `po2`, and about 7.6 GiB of memory plus swap for the
   Groth16 wrap.
6. The checker's image id is on the contract's allowlist.
7. The vendor account holds the reward plus 0.2 NEAR for gas and storage.
8. The verdict window covers K times the measured proof time times 1.5 (`tools/proof_times.json`, or this bounty's own
   Proof 0). Attempts are proved one at a time, so K attempts revealed together must all fit in the window. Before
   Proof 0 there is no measurement yet: `check` says so and `publish` refuses until it exists.

The preview shows the reward, the fee of every attempt from 1 to K, the windows, what the timeout rule does in plain
words, the proof time and its cost per attempt, and the time to open.

## Where the secrets live

On the machine that proves, and nowhere else: the secret input and the reference fix in files of mode 600 in a folder
of mode 700; the salt in `~/.kintsugi-salts/<name>.salt` (made by `skarbnik-host --bounty <name>` at the first proof,
mode 600). They are never printed, never committed and never sent to the chain or to a researcher. Only proofs,
receipts and their hashes leave the machine.

## Proving modes

| Mode | Privacy | Speed | Status |
| --- | --- | --- | --- |
| Your own machine (`cpu`) | strongest: the secret never leaves a machine you control | slowest; measure it before choosing the windows | built |
| A GPU you rent for the job (`gpu`) | the secret sits in the rented machine's memory (RAM only) during the proof, then is wiped | prove and shrink under a minute on an L40S; the whole proof, from reveal to `submit_groth16` with the Groth16 wrap on your machine, about 17 minutes (bounty 32: 17 min 8 s; docs/numbers.md) | built into `watch` (below) |
| A Skarbnik-hosted proving service | the service would see the secret | | not offered |

The Groth16 wrap needs an x86 machine with Docker and about 7 GiB of memory, whichever mode proves.

## GPU mode

With `mode = "gpu"` in a watch config, `watch` proves each revealed attempt on a rented GPU pod
(`tools/skarbnik_gpu.py`) and wraps it to Groth16 on its own machine:

1. It refuses to start a pod once the logged GPU spend reaches the budget, and terminates pods it left behind.
2. It creates a Secure Cloud pod: the GPU types in order (L40S, then RTX 6000 Ada, then RTX A6000), the data centers in
   order, the image `runpod/pytorch:1.4.1-cu1281-torch280-ubuntu2404` (PyTorch 2.8.0, CUDA 12.8.1, Ubuntu 24.04).
3. It puts the CUDA build of `skarbnik-host` on the pod: the cached copy, or a build on the first pod (Rust, RISC Zero,
   the committed source and the reproducible guest files; the build must embed the published checker id), kept for the
   next pods.
4. It copies the secret input and the salt into the pod's RAM (`/dev/shm`) only, proves, and shreds them right after,
   whether the proof worked or not; then verifies, shrinks to a succinct receipt on the GPU and fetches it.
5. It terminates the pod, in every case. No pod lives longer than 45 minutes: every step's time limit is cut to what
   is left. The pod's cost (hourly price times its life) goes to the log and to `gpu_spend.json`.
6. It wraps to Groth16, verifies, checks the verdict, the submission id and the secret commitment, and submits.

After two failed pods for one attempt, or at the spend cap, it proves on its own CPU and writes a WARNING line, unless
`cpu_fallback = false` is set in `[gpu]`: then nothing is proved on this machine and the next scan tries again. Once a
proof exists, a failed submit is only sent again (up to 10 times); no new pod starts for that attempt. One proof cost
$0.04 on an L40S with the cached binary (docs/numbers.md). Set `network = "testnet-fastnear"` in the watch config's
`[chain]`: near-cli then signs against the regular RPC rather than the archival one, whose old block hash once made a
submit expire. The
`[gpu]` section: `api_key_file` (mode 600; never printed, logged or copied), `gpu_types`, `data_centers`, `cap_minutes`
(45), `budget_usd` (6), and optionally `image`, `spend_file`, `ssh_key`, `binary_cache`, `src_tarball`, `guests_dir`,
`po2` (19), `cloud_types` (default `["SECURE"]`; add `"COMMUNITY"` to rent from both), `max_usd_per_hr` (a price
ceiling: a pod priced above it is terminated at once and the next choice tried), `self_stop_minutes` (a timer inside the
pod removes it after this many minutes even if this machine stops watching it) and `cpu_fallback`. An empty
`data_centers` lets the GPU rental pick any data center.

## With an AI app: `tools/skarbnik-vendor-mcp`

An MCP server that runs these commands for an AI app (Claude Desktop, Claude Code, Codex), on the computer that holds
the secret. It asks for each file path and never opens the secret or the fix; `publish`, `watch_start` and `prove0` on a
rented GPU first return the cost and time with a one time confirm code, and run only when called again with it.
Setup: [tools/skarbnik-vendor-mcp/README.md](../tools/skarbnik-vendor-mcp/README.md). The project's own cycle split
the work across two machines: init, check, publish and status on the laptop that holds the vendor key; Proof 0 and
watch on the VPS that holds the GPU rental key (the public Proof 0 files were copied to the laptop for publish; no key
moved). The laptop's check refuses on memory for the Groth16 wrap, which runs on the VPS; the server's publish accepts
that one refusal once Proof 0 exists.

## The site's CSS

`web/css/panyl.css` was made once from the design package (by a private build script) and has been changed by hand since,
the fonts among other things (Chakra Petch and Fira Code, docs/DEVLOG.md). Never rebuild it from the old design package:
the live CSS in this repository is the source.

## The project's own vendor machine

The project runs `watch` on a rented VPS (4 cores, 7.8 GiB of memory, 8 GiB of swap), in GPU mode: one CPU proof there
takes 10 h 12 min (docs/numbers.md), too slow for judging. That VPS is a vendor-controlled
machine: it holds the secrets of the bounties it proves and nothing else (judge bounties 27 to 31, like the retired 18 to
22, use bounty 17's secret and salt; the test bounty its own, generated on the VPS), plus the key of a dedicated testnet account that only
sends `submit_groth16`. It runs everything as one ordinary user, in that user's home folder, with no system-wide
changes:

- the repository files it needs in `~/skarbnik` and the binaries in `~/skarbnik/bin`;
- `tools/vendor-service/run-watch.sh` in a tmux session named `skarbnik-watch`, restarting the watch 60 s after any
  stop, logging to `~/skarbnik-vendor/watch-service.log` and `~/skarbnik-vendor/watch.log`;
- an `@reboot` line in that user's crontab, so it comes back after a reboot.

A user-level systemd service would also work, but it needs "linger" turned on for the user, which is a system setting.

## Example

```
tools/skarbnik-vendor init --out ~/skarbnik-vendor/mybounty.toml
tools/skarbnik-vendor check --config ~/skarbnik-vendor/mybounty.toml
tools/skarbnik-vendor prove0 --config ~/skarbnik-vendor/mybounty.toml
tools/skarbnik-vendor publish --config ~/skarbnik-vendor/mybounty.toml
tools/skarbnik-vendor status --config ~/skarbnik-vendor/watch.toml
```

The end to end run of all of this on a new testnet bounty (bounty 32), and on judge bounty 27, is in docs/EVIDENCE.md,
"The vendor tool".
