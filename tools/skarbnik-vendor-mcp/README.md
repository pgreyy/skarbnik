# skarbnik-vendor-mcp

An MCP server that lets an AI app host a private Skarbnik bounty for you with the vendor tool
([tools/skarbnik-vendor](../../docs/VENDOR.md)): it asks you for each detail, runs the steps, and waits for your yes
before anything is spent. It runs on your own computer, because the secret input must stay there; it is never a
hosted link. One file, `server.py`, Python 3.9 or later, standard library only. The vendor tool it runs needs Python
3.11 or later, the project's programs (`skarbnik-host`, `skarbnik-check`), NEAR CLI with your vendor account, and for
the Groth16 wrap an x86 computer with Docker and about 7.6 GiB of memory plus swap (docs/VENDOR.md).

## Tools

| Tool | What it does | Asks for a yes |
| --- | --- | --- |
| `init` | Writes a bounty config from your answers (paths only) | no |
| `check` | The preflight and the preview of fees, windows and time | no, spends nothing |
| `prove0` | Proof 0 of your reference fix | on a rented GPU, yes: the first call returns the cost and a confirm code |
| `publish` | Creates and funds the bounty on testnet | yes: the first call runs the preflight, returns the preview, what is spent and a confirm code |
| `watch_init` | Writes the watch config for a published bounty | no |
| `watch_start` | Starts the auto prover (proves each revealed attempt, submits the proof) | yes: the first call returns the GPU cost per attempt, the spend cap and a confirm code |
| `watch_stop`, `watch_status`, `status` | Stop it, read its log, see each attempt's state | no |
| `job_status` | Follows a long step (check, prove0, publish) | no |

A confirm code works once, for that one step and config, for 15 minutes. `watch` keeps the vendor tool's GPU spend
cap (`budget_usd` in the config's `[gpu]` section): at the cap no new GPU starts.

## What it does with secrets

- Tools take file paths only. The server never opens, reads, returns, prints or logs the secret input, the reference
  fix, a salt, a seed or a key; it passes paths to the vendor tool and filters what comes back (lines about keys,
  secrets, seeds and signatures are dropped; long key-like strings are hidden).
- Transactions are signed by NEAR CLI with your vendor account, as the vendor tool always does; the server never asks
  for a key.
- Testnet only.

## Setup

Get the repository and the vendor tool working first (docs/VENDOR.md), then print the settings for your app with
this computer's paths and follow what it prints:

    git clone https://github.com/pgreyy/skarbnik.git
    python3 skarbnik/tools/skarbnik-vendor-mcp/server.py --setup claude-desktop

Claude Desktop: Settings, Developer, Edit Config opens the settings file; paste what was printed inside it, keeping
anything already there; save, then quit Claude fully and open it again. The printed block looks like this, with your
own paths:

    {
      "mcpServers": {
        "skarbnik-vendor": {
          "command": "/usr/bin/python3",
          "args": ["-I", "/home/you/skarbnik/tools/skarbnik-vendor-mcp/server.py"]
        }
      }
    }

Claude Code, from the folder where you ran git clone:

    claude mcp add --scope user skarbnik-vendor -- python3 "$PWD/skarbnik/tools/skarbnik-vendor-mcp/server.py"

Codex: `python3 skarbnik/tools/skarbnik-vendor-mcp/server.py --setup codex` prints the lines for
`~/.codex/config.toml`.

On Windows the vendor tool runs inside WSL (it needs Linux and Docker). Claude Desktop on Windows then starts the
server through `wsl`: `"command": "wsl"`, `"args": ["python3", "/home/<you>/skarbnik/tools/skarbnik-vendor-mcp/server.py"]`.
Settings in `env` reach Linux only when they are also named in `WSLENV` (for example
`"WSLENV": "SKARBNIK_VENDOR_TOOL/u"`); the server starts without any.

## Then ask

"Host a private Skarbnik bounty for me with the Skarbnik vendor tool. Ask me for each file path you need. Never open,
read out or print my secret input file, only use its path. Show me the cost and the time first, and wait for my yes
before you publish or spend on a GPU."
