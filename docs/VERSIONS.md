# Versions

Exact versions of every tool used to build and run Kintsugi, checked on 2026-10-23 on the development machine
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

## Other

| Tool | Version | Command |
| --- | --- | --- |
| Node | v22.23.4 | `node --version` |
| npm | 10.9.9 | `npm --version` |
| Docker | 29.1.3, build 29.1.3-0ubuntu4.1 | `docker --version` |
| git | 2.53.0 | `git --version` |
| gh | 2.46.0 | `gh --version` |
