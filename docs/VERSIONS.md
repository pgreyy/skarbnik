# Versions

Exact versions of every tool used to build and run Skarbnik, checked on 2026-10-23 on the development machine
(Ubuntu 26.04.1 LTS under WSL2, x86_64). Each line names the command that printed it.

## Operating system

| Item | Version | Command |
| --- | --- | --- |
| OS | Ubuntu 26.04.1 LTS | `grep PRETTY /etc/os-release` |
| CPU architecture | x86_64 | `uname -m` |

## Rust

| Tool | Version | Command |
| --- | --- | --- |
| rustup | 1.29.2 (d8c92c676 2026-10-21) | `rustup --version` |
| rustc (stable) | 1.99.1 (58cf8f9c3 2026-10-13) | `rustc --version` |
| cargo (stable) | 1.99.1 (5f94df478 2026-08-27) | `cargo --version` |
| wasm target | wasm32-unknown-unknown installed | `rustup target list --installed` |
| wasm target for OutLayer (S4) | wasm32-wasip1 installed 2026-10-24 | `rustup target list --installed` |

## NEAR

| Tool | Version | Command |
| --- | --- | --- |
| near-cli-rs | 0.30.1 | `near --version` |
| cargo-near | 0.22.0 | `cargo near --version` |
| near-sdk (crate) | 5.29.1 | `contract/Cargo.toml`, `Cargo.lock` |

## RISC Zero

| Tool | Version | Command |
| --- | --- | --- |
| rzup | 0.5.0 | `rzup --version` |
| cargo-risczero | 3.0.6 | `cargo risczero --version` |
| r0vm | 3.0.6 | `r0vm --version` |
| RISC Zero Rust toolchain (for the guest) | 1.97.0 | `rzup show` |
| risc0-zkvm, risc0-build (crates) | =3.0.6 | `host/Cargo.toml`, `harness/Cargo.toml`, `harness/guest/Cargo.toml` |
| risc0-zkp, risc0-groth16 (pulled in by risc0-zkvm) | 3.0.5 | `Cargo.lock` |

All crate versions are locked in `Cargo.lock` (workspace) and `harness/guest/Cargo.lock` (guest); both are committed.
Builds of S0 used no extra flags beyond `CARGO_HTTP_MULTIPLEXING=false CARGO_HTTP_TIMEOUT=60 CARGO_NET_RETRY=10
CARGO_NET_GIT_FETCH_WITH_CLI=true`, which only change how crates are downloaded.

## Patch checker (S1)

| Crate | Version | Where |
| --- | --- | --- |
| wasmi (default features off; `std`, `validate`) | =2.0.0 | `harness/checker/Cargo.toml` |
| wasmi_core, wasmi_ir, wasmi_collections | 2.0.0 | `Cargo.lock` |
| wasmparser | 0.228.0 | `Cargo.lock` |
| serde (checker feature `zk`, shared guest and host types) | =1.0.229 | `harness/checker/Cargo.toml` |
| bincode (receipt files) | =1.3.3 | `host/Cargo.toml` |

The demo program and patches in `data/` are built to wasm32-unknown-unknown with plain `rustc` 1.99.1 by
`harness/checker/build_modules.sh`.

## OutLayer fuel meter (`verifier/fuel-meter`, standalone crate with its own `Cargo.lock`)

| Crate | Version | Why this version |
| --- | --- | --- |
| wasmtime | 28.0.1 (pinned `=28.0.1`) | OutLayer's worker pins wasmtime 28 (`worker/Cargo.toml` at out-layer/outlayer `aaf60a2`) |
| wasmtime-wasi | 28.0.1 (pinned `=28.0.1`) | same |
| tokio | 1.54.1 (from `Cargo.lock`) | async runner |

## OutLayer command line tool (used for the FastFS upload and project deploy only)

| Tool | Version | Command |
| --- | --- | --- |
| outlayer-cli | 0.2.1 (tag `v0.2.1`, commit `25d4e5448e630c73c700ecba92fe4bbe8778165f`), installed with `cargo install --git https://github.com/out-layer/outlayer-cli --tag v0.2.1 --locked` | `outlayer --version` |

## Reproducible guest build

| Tool | Version | Command |
| --- | --- | --- |
| Docker buildx plugin | v0.38.1 (commit `0dbe87f3`), in `~/.docker/cli-plugins/docker-buildx`, binary SHA-256 `e25d5cd675092bb5d1d03632fdc46cdf3fede7b514dc5f023a105e00d3ce5ad4` (matches the release's checksums.txt) | `docker buildx version` |
| RISC Zero guest builder image | `risczero/risc0-guest-builder:r0.1.97.0`, digest `sha256:7ae0a27fa72b10fb5c1066005bd949ae43dc4ead8a284f2d6572b99c82ab4468` (Rust 1.97.0) | `docker image inspect risczero/risc0-guest-builder:r0.1.97.0` |
| RISC Zero Groth16 prover image (Docker, CPU path) | `risczero/risc0-groth16-prover:v2025-04-03.1`, digest `sha256:a4f80ce2e0b8e2bb7637a93c37136a6776ac00ec843a3fdf1c67b1d5ffea64ee` (the tag `risc0-groth16` 3.0.5 runs) | `docker image inspect risczero/risc0-groth16-prover:v2025-04-03.1` |
| risc0-binfmt (build dependency of `harness`, prebuilt guest mode) | 3.0.5 (pinned `=3.0.5`, the version risc0-build 3.0.6 uses) | `harness/Cargo.toml` |

## Site wallet (NEAR Connect, bundled into web/vendor/near-connect.js by scripts/wallet-vendor/build.sh)

| Item | Version or source | sha256 |
| --- | --- | --- |
| @hot-labs/near-connect | 0.11.4 (`scripts/wallet-vendor/package.json`, `package-lock.json`) | `c9a291ddf0e8e4fdc2732fb6a54584bd76ee7ebe2bbbe373b25ca2a140f2b36e` (bundle) |
| esbuild (bundler, build time only) | 0.25.10 | |
| Wallet list `web/vendor/wallets/manifest.json` | entries from hot-dao/near-selector at commit `6766ea5e71864e5cbcbf5b70d2aeae23b20b60e9`, script addresses and pins added, the wallets' localhost and .local development addresses removed | `1ca169ef591abe072950e1aca41e0523953218657584975e483ed2832707337c` |
| Intear Wallet script (not stored; loaded from https://wallet.intear.tech/near-selector.js, no versioned address; checked 2026-10-25) | pinned by sha256 in the wallet list | `6decc283352af197feff4988628899d19e05f4168a4277fe699bd8a0d6178e34` |
| NEAR CLI script (not stored; loaded from raw.githubusercontent.com, near/near-cli-connect at commit `dc5cb123e3a8e42ed095739f4ea058b767a80ad2`, `dist/near-cli.js`) | pinned by sha256 in the wallet list | `522f2a52403f6da84384a409718c54b49ed4432cdfd583363d35109be8c8e318` |

## Agent model provider (agent/config.toml)

| Item | Value | Checked |
| --- | --- | --- |
| NEAR AI Cloud base URL | `https://cloud-api.near.ai/v1` (chat completions, `Authorization: Bearer`) | docs.near.ai/cloud/quickstart, 2026-10-25 |
| Default model | `z-ai/glm-5.3-flash` | listed by `curl -s https://cloud-api.near.ai/v1/models`, 2026-10-25 (61 models) |
| Python (the agent, standard library only) | 3.14.4 | `python3 --version` |

## Other

| Tool | Version | Command |
| --- | --- | --- |
| Node | v22.23.4 | `node --version` |
| npm | 10.9.9 | `npm --version` |
| Docker | 29.1.3, build 29.1.3-0ubuntu4.1 | `docker --version` |
| git | 2.53.0 | `git --version` |
| gh | 2.46.0 | `gh --version` |
