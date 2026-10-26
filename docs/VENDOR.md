# Running a bounty as a vendor: `skarbnik-vendor`

A vendor should not have to be a cryptography operator. `tools/skarbnik-vendor` (Python 3.11 or later, no packages)
takes a private Level 2 bounty from a config file to an open bounty, and then proves every revealed attempt by itself.
The same guide, shorter, is on the site: https://skarbnik.xyz/#/vendors
It calls the project's own programs (`skarbnik-host`, `skarbnik-check`), `scripts/s2_measure.sh` for timing and the
memory guard, and NEAR CLI (near-cli-rs) for transactions. Testnet only.

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
  the expiry, the patch size limit, the check size and the proof segment size (`po2`: 18 needs about 2.5 GiB, 19 about
  5 GiB).
- `[secrets]`: the secret crashing input and the reference fix. Files of mode 600, outside the repository.
- `[prover]`: the mode (`cpu`), the machine's name (proof times differ by machine), the work folder.
- `[chain]`: contract, RPC addresses, the published checker image id and the vendor account that signs create and open.
- `[paths]` (optional): where the binaries are.

A watch config has `[watch]` (state file, log, work folder, poll interval), `[prover]`, `[chain]` with the account that
signs `submit_groth16`, `[paths]`, and one `[[bounties]]` block per secret: the bounty ids, the salt name, the module,
the secret file and `po2`.

## What the preflight checks

1. The module exists and is within the checker's limits (2,048 bytes); the public tests are there.
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
| A GPU you rent for the job | the secret sits in the rented machine's memory during the proof, then is wiped | under a minute for bounty 24's attempt (docs/numbers.md) | measured by hand once (notes in docs/EVIDENCE.md, "Bounty 24"); not yet built into `watch` |
| A Skarbnik-hosted proving service | the service would see the secret | | not offered |

The Groth16 wrap needs an x86 machine with Docker and about 7 GiB of memory, whichever mode proves.

## The project's own vendor machine

The project runs `watch` on a rented VPS (4 cores, 7.8 GiB of memory, 8 GiB of swap). That VPS is a vendor-controlled
machine: it holds the secrets of the bounties it proves and nothing else (judge bounties 18 to 22 use bounty 17's
secret and salt; the test bounty its own, generated on the VPS), plus the key of a dedicated testnet account that only
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

The end to end run of all of this on a new testnet bounty is in docs/EVIDENCE.md, "The vendor tool".
