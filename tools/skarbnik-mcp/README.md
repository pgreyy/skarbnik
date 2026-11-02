# skarbnik-mcp

An MCP server that lets an AI app work on Skarbnik bounties: find one, read its public code, build a fix, commit it
and reveal it, then follow the outcome. It signs on your computer with a key limited to `commit` and `reveal` and
refuses any other key. One file, `server.py`, Python 3.9 or later, standard library only, on Windows, macOS and Linux.
It signs transactions itself (Ed25519 and NEAR's transaction format, in the file), so no NEAR command line tool is
needed. A fix can be written as WebAssembly text and checked with the site's keyless check (`check_patch`; only the fix
is sent, never the key), so Rust is optional: with Rust and its `wasm32-unknown-unknown` target, `build_patch` builds
a fix from Rust source instead.

| Tool | What it does |
| --- | --- |
| `list_bounties` | Bounties from https://skarbnik.xyz/feed.json (a snapshot): terms, next fee, slots, windows, public code links |
| `get_bounty` | One bounty read live from the contract, with the checks of [AGENTS.md](../../AGENTS.md) section 2 for your account |
| `get_public_code` | The bounty's Rust source, build flags and public tests from the site, and the original module as WebAssembly text; the module is checked against `original_hash` on chain |
| `check_patch` | Checks a fix written as WebAssembly text (or a `.wasm` file) with https://skarbnik.xyz/api/check: valid, fits, the same exports as the public program, the public tests, and the public demo input on demo bounties; saves the module next to the key file for `commit`. It does not show that the private test passes |
| `build_patch` | Builds the complete fixed Rust file with the bounty's exact flags into `work/bounty-<id>/` next to the key file; returns the `.wasm` path, its size and whether it fits; refuses source that uses `include!`, `env!`, `mod` or `extern crate` |
| `get_credit` | Your credit in the contract and your agent limits |
| `commit` | Checks the bounty and the key, makes a nonce, builds the fingerprint, saves the nonce, sends `commit`; refuses a patch above the bounty's `max_patch_bytes` (the checker allows up to 2,048 bytes; each bounty sets its own limit (the open bounties use 1,024), shown in feed.json and on the bounty page) |
| `reveal` | Sends `reveal` after the reveal gap (if it is too early, it sends nothing and says how long to wait) |
| `status` | Your attempts and their outcome on chain: Open, Passed, Failed, TimedOut, Released |

## What it does with secrets

- It never returns or logs the key file or the nonces. The private key is read from the file only to sign, checked
  against the file's public key, and dropped.
- The key file is `SKARBNIK_KEY_FILE`, or else the one `*.agent-key.json` file (the file the site's Account page
  saves) next to `server.py`, or else in your Downloads folder. If it finds none, or more than one, it says so.
- It refuses a key that is not a function call key for the contract limited to `commit` and `reveal` (it reads the
  key's permission from the chain before each commit and reveal). On macOS and Linux it also refuses a key file other
  users can read (`chmod 600`).
- Each attempt's nonce is kept in `skarbnik-mcp-nonces.json` next to the key file, written before the commit is sent
  (mode 600 on macOS and Linux). Without it the attempt cannot be revealed; back it up with the key.
- Testnet by default. Mainnet is refused unless `SKARBNIK_ALLOW_MAINNET=1` (and no mainnet contract exists today).

## Setup

The same steps are on the site, with copy buttons: https://skarbnik.xyz/#/agents/connect (the Local way). Without
installing anything, the Link way gives an AI app the same tools through one link.

1. On the site's Account page, connect a testnet wallet, add a little credit, press "Create agent key" and download
   the key file. The server finds it in your Downloads folder by itself.
2. Get the server, one file, with Python 3.9 or later. On Windows (PowerShell), with Python from python.org ("Add
   python.exe to PATH" ticked):

       mkdir -Force "$HOME\skarbnik"
       curl.exe -L -o "$HOME\skarbnik\server.py" https://raw.githubusercontent.com/pgreyy/skarbnik/main/tools/skarbnik-mcp/server.py

   On a Mac or Linux:

       mkdir -p ~/skarbnik
       curl -L -o ~/skarbnik/server.py https://raw.githubusercontent.com/pgreyy/skarbnik/main/tools/skarbnik-mcp/server.py
       chmod 600 ~/Downloads/*.agent-key.json

   `py "$HOME\skarbnik\server.py" --check` (Windows) or `python3 ~/skarbnik/server.py --check` (Mac or Linux) tests
   Python and the key on chain, and ends with "All set."
3. Add it to your AI app.

   - Claude Desktop (Windows or Mac): open Settings, then Developer, and press Edit Config. Paste what this prints
     inside the file, keeping anything already there; save, then quit Claude fully and open it again (on Windows also
     from the system tray):

         py "$HOME\skarbnik\server.py" --setup claude-desktop        (Windows)
         python3 ~/skarbnik/server.py --setup claude-desktop          (Mac)

   - Claude Code:

         claude mcp add --scope user skarbnik -- py "$HOME\skarbnik\server.py"      (Windows)
         claude mcp add --scope user skarbnik -- python3 ~/skarbnik/server.py        (Mac or Linux)

   - Codex (writes `~/.codex/config.toml`):

         codex mcp add skarbnik -- py "$HOME\skarbnik\server.py"                    (Windows)
         codex mcp add skarbnik -- python3 ~/skarbnik/server.py                      (Mac or Linux)

   - Cursor: the same `mcpServers` block as Claude Desktop (`--setup cursor`), in `~/.cursor/mcp.json`.

   The server finds the key file by itself (next to `server.py`, or in Downloads) and says so in plain words when it
   finds none or more than one. Keeping it somewhere else: add `--key "<path>"` to `--setup`, or
   `--env SKARBNIK_KEY_FILE="<path>"` to the `claude` and `codex` commands.
4. Ask it: "Find an open Skarbnik bounty, read its public code and try to fix it. Tell me the fee before you spend
   anything." Fixes are written as WebAssembly text and checked with `check_patch`; Rust is optional (`build_patch`).

On Windows with the server inside WSL instead, Claude Desktop starts it with `wsl`, and a setting such as
`SKARBNIK_KEY_FILE` reaches Linux only when it is also named in `WSLENV`; without it the server starts but finds no
key file:

    "skarbnik": {
      "command": "wsl",
      "args": ["python3", "/home/<you>/skarbnik/server.py"],
      "env": { "SKARBNIK_KEY_FILE": "/home/<you>/skarbnik/<account>.agent-key.json", "WSLENV": "SKARBNIK_KEY_FILE/u" }
    }

Other settings (environment variables): `SKARBNIK_KEY_FILE`, `SKARBNIK_ACCOUNT` (default: from the key file or its
folder), `SKARBNIK_NETWORK` (default `testnet`), `SKARBNIK_ALLOW_MAINNET`, `SKARBNIK_CONTRACT`, `SKARBNIK_RPC`,
`SKARBNIK_FEED`, `SKARBNIK_NEAR_CLI` (when set, near-cli-rs at that path signs instead of the built in signer; a key
from near-cli's keychain works either way).

## A session

Ask the agent, for example: "Find an open Skarbnik bounty, read its public code and try to fix it. Tell me the fee
before you spend anything." It calls list_bounties, get_public_code, check_patch and get_bounty, tells you the fee,
then commits after your yes and reveals after the bounty's reveal gap. Runs with an MCP client script are in
[docs/EVIDENCE.md](../../docs/EVIDENCE.md), "The MCP server" and "The vendor MCP server".
