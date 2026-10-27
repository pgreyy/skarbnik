# skarbnik-mcp

An MCP server that lets an AI agent work on Skarbnik bounties: find one, check it, commit a fix and reveal it, then
follow the outcome. It signs with a key limited to `commit` and `reveal` and refuses any other key. One file,
`server.py`, Python 3.11 or later, standard library only; it calls near-cli-rs (`near`, tested with 0.30.1) to sign.

| Tool | What it does |
| --- | --- |
| `list_bounties` | Bounties from https://skarbnik.xyz/feed.json (a snapshot): terms, next fee, slots, windows, public code links |
| `get_bounty` | One bounty read live from the contract, with the checks of [AGENTS.md](../../AGENTS.md) section 2 for your account |
| `get_credit` | Your credit in the contract and your agent limits |
| `commit` | Checks the bounty and the key, makes a nonce, builds the fingerprint, saves the nonce, sends `commit` |
| `reveal` | Sends `reveal` after the reveal gap (if it is too early, it sends nothing and says how long to wait) |
| `status` | Your attempts and their outcome on chain: Open, Passed, Failed, TimedOut, Released |

## What it does with secrets

- It never returns or logs the key file or the nonces. The private key is read only by near-cli, from the file you name.
- It refuses a key that is not a function call key for the contract limited to `commit` and `reveal` (it reads the
  key's permission from the chain before each commit and reveal), and a key file other users can read.
- Each attempt's nonce is kept in `skarbnik-mcp-nonces.json` next to the key file, mode 600, written before the
  commit is sent. Without it the attempt cannot be revealed; back it up with the key.
- Testnet by default. Mainnet is refused unless `SKARBNIK_ALLOW_MAINNET=1` (and no mainnet contract exists today).

## Setup

1. Your owner makes the account, deposits credit, sets limits and adds the limited key: [AGENTS.md](../../AGENTS.md)
   section 3. The limited key file is `$CREDS/testnet/<you>.testnet/ed25519_<public key>.json`, mode 600.
2. Check it: `SKARBNIK_KEY_FILE=<that file> python3 -I tools/skarbnik-mcp/server.py --check` prints `ok: ... limited to
   commit and reveal`.

Settings (environment variables): `SKARBNIK_KEY_FILE` (required for commit, reveal, status), `SKARBNIK_ACCOUNT`
(default: from the key file or its folder), `SKARBNIK_NETWORK` (default `testnet`), `SKARBNIK_ALLOW_MAINNET`,
`SKARBNIK_CONTRACT`, `SKARBNIK_RPC`, `SKARBNIK_FEED`, `SKARBNIK_NEAR_CLI` (default `near`). Use absolute paths below.

### Claude Code

    claude mcp add skarbnik --env SKARBNIK_KEY_FILE=/abs/path/to/ed25519_<public key>.json -- python3 -I /abs/path/to/skarbnik/tools/skarbnik-mcp/server.py

Or, for one project, a `.mcp.json` in its folder (the same shape as below). `/mcp` in Claude Code shows the server
and its six tools.

### Claude Desktop

In `claude_desktop_config.json` (Settings, Developer, Edit Config), then restart Claude Desktop:

    {
      "mcpServers": {
        "skarbnik": {
          "command": "python3",
          "args": ["-I", "/abs/path/to/skarbnik/tools/skarbnik-mcp/server.py"],
          "env": { "SKARBNIK_KEY_FILE": "/abs/path/to/ed25519_<public key>.json" }
        }
      }
    }

If `near` is not on the PATH Claude Desktop sees, add `"SKARBNIK_NEAR_CLI": "/abs/path/to/near"` to `env`.

### Cursor

In `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project), the same `mcpServers` block as for Claude
Desktop. Cursor lists it under Settings, MCP.

## A session

Ask the agent, for example: "List the open Skarbnik bounties, check bounty 26 for my account, and commit
`/abs/path/fix.wasm` to it." Then, after the bounty's reveal gap: "Reveal it and show the status." The run on test
bounty 26 with Claude Code as the client is in [docs/EVIDENCE.md](../../docs/EVIDENCE.md), "The MCP server".
