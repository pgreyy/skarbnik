# Architecture (what exists today)

This file describes only what is in the repository now. It grows as parts are built.

## Today (spike S0)

| Folder | What is there | Status |
| --- | --- | --- |
| `contract/` | A hello world NEAR contract that stores one greeting (`get_greeting`, `set_greeting`) | Hello world only. No bounty logic yet |
| `harness/` | Build crate that compiles the zkVM guest in `harness/guest/` and exposes its program and image id | Hello world guest only |
| `harness/guest/` | A zkVM guest program that reads a name and publishes "hello, <name>" | Hello world only |
| `host/` | A program that proves one run of the guest on this machine and verifies the receipt | Hello world only |
| `web/` | Empty placeholder for the dashboard | Not started |
| `data/` | Empty placeholder for test data | Not started |
| `docs/` | Versions, evidence, devlog, decisions and this file | Kept up to date each work block |

## How the pieces connect today

- `./scripts/build_all.sh` builds everything in one command.
  - Step 1: `cargo build --release` at the root builds `harness` (which compiles the guest) and `host` (the workspace's
    `default-members`).
  - Step 2: `cargo near build non-reproducible-wasm` inside `contract/` builds the contract for the chain (WebAssembly).
  - The contract is a workspace member but is not built by a plain `cargo build`: near-sdk 5.29.1 stops a native contract
    build with a `compile_error!` and asks for `cargo near build`.
- `host` proves the guest locally with the installed RISC Zero prover (`r0vm`) and checks the receipt against the guest's image id.

Nothing yet connects the proof to the contract.
