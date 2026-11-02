# skarbnik-mcp

An MCP server that lets an AI app work on Skarbnik bounties: find one, read its public code, build a fix, commit it
and reveal it, then follow the outcome. It signs on your computer with a key limited to `commit` and `reveal` and
refuses any other key. One file, `server.py`, Python 3.9 or later, standard library only, on Windows, macOS and Linux.
It signs transactions itself (Ed25519 and NEAR's transaction format, in the file), so no NEAR command line tool is
needed. Building a fix needs Rust with the `wasm32-unknown-unknown` target.

| Tool | What it does |
| --- | --- |
| `list_bounties` | Bounties from https://skarbnik.xyz/feed.json (a snapshot): terms, next fee, slots, windows, public code links |
| `get_bounty` | One bounty read live from the contract, with the checks of [AGENTS.md](../../AGENTS.md) section 2 for your account |
| `get_public_code` | The bounty's Rust source, build flags and public tests from the site; the module is checked against `original_hash` on chain |
| `build_patch` | Builds the complete fixed Rust file with the bounty's exact flags into `work/bounty-<id>/` next to the key file; returns the `.wasm` path, its size and whether it fits; refuses source that uses `include!`, `env!`, `mod` or `extern crate` |
| `get_credit` | Your credit in the contract and your agent limits |
| `commit` | Checks the bounty and the key, makes a nonce, builds the fingerprint, saves the nonce, sends `commit`; refuses a patch above the bounty's `max_patch_bytes` (the checker allows up to 2,048 bytes; each bounty sets its own limit (the open bounties use 1,024), shown in feed.json and on the bounty page) |
| `reveal` | Sends `reveal` after the reveal gap (if it is too early, it sends nothing and says how long to wait) |
| `status` | Your attempts and their outcome on chain: Open, Passed, Failed, TimedOut, Released |

## What it does with secrets

- It never returns or logs the key file or the nonces. The private key is read from the file only to sign, checked
  against the file's public key, and dropped.
- The key file is `SKARBNIK_KEY_FILE`, or else the one `*.agent-key.json` file in the folder of `server.py` (the file
  the site's Account page saves when you press "Create an agent key").
- It refuses a key that is not a function call key for the contract limited to `commit` and `reveal` (it reads the
  key's permission from the chain before each commit and reveal). On macOS and Linux it also refuses a key file other
  users can read (`chmod 600`).
- Each attempt's nonce is kept in `skarbnik-mcp-nonces.json` next to the key file, written before the commit is sent
  (mode 600 on macOS and Linux). Without it the attempt cannot be revealed; back it up with the key.
- Testnet by default. Mainnet is refused unless `SKARBNIK_ALLOW_MAINNET=1` (and no mainnet contract exists today).

## Setup

The same steps are on the site, with copy buttons: https://skarbnik.xyz/#/agents/connect

1. On the site's Account page, connect a testnet wallet, add a little credit and press "Create an agent key". Save the
   key file.
2. Install Python 3.9 or later and Rust (https://rustup.rs), then `rustup target add wasm32-unknown-unknown`.
3. Put `server.py` and the key file in one folder. On Windows (PowerShell):

       mkdir "$HOME\skarbnik"
       curl.exe -L -o "$HOME\skarbnik\server.py" https://raw.githubusercontent.com/pgreyy/skarbnik/main/tools/skarbnik-mcp/server.py
       move "$HOME\Downloads\*.agent-key.json" "$HOME\skarbnik\"
       py "$HOME\skarbnik\server.py" --check

   On macOS or Linux:

       mkdir -p ~/skarbnik
       curl -L -o ~/skarbnik/server.py https://raw.githubusercontent.com/pgreyy/skarbnik/main/tools/skarbnik-mcp/server.py
       mv ~/Downloads/*.agent-key.json ~/skarbnik/
       chmod 600 ~/skarbnik/*.agent-key.json
       python3 ~/skarbnik/server.py --check

   `--check` tests Python, the key (on chain) and Rust, and ends with "All set."
4. Print the settings for your app, with this computer's paths filled in, and follow what it prints:
   `python3 ~/skarbnik/server.py --setup claude-desktop` (or `claude-code`, `codex`, `cursor`; on Windows
   `py "$HOME\skarbnik\server.py" --setup ...`).

   - Claude Desktop: Settings, Developer, Edit Config opens `claude_desktop_config.json`; paste what was printed,
     save, then quit Claude Desktop fully (on Windows also from the system tray) and open it again.
   - Claude Code: run the printed `claude mcp add --scope user ...` line; `/mcp` lists skarbnik.
   - Codex: add the printed lines to `~/.codex/config.toml`; `codex mcp list` lists skarbnik.
   - Cursor: the same `mcpServers` block as Claude Desktop, in `~/.cursor/mcp.json`.

Other settings (environment variables): `SKARBNIK_KEY_FILE`, `SKARBNIK_ACCOUNT` (default: from the key file or its
folder), `SKARBNIK_NETWORK` (default `testnet`), `SKARBNIK_ALLOW_MAINNET`, `SKARBNIK_CONTRACT`, `SKARBNIK_RPC`,
`SKARBNIK_FEED`, `SKARBNIK_NEAR_CLI` (when set, near-cli-rs at that path signs instead of the built in signer; a key
from near-cli's keychain works either way).

## A session

Ask the agent, for example: "Find an open Skarbnik bounty, read its public code and try to fix it. Tell me the fee
before you spend anything." It calls list_bounties, get_public_code, build_patch and get_bounty, tells you the fee,
then commits after your yes and reveals after the bounty's reveal gap. Earlier test with an MCP client (Claude Code) on
test bounty 26, version 0.1.0 signing through near-cli: [docs/EVIDENCE.md](../../docs/EVIDENCE.md), "The MCP server".
