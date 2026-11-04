# skarbnik-vendor-mcp

An MCP server that lets an AI app host a private Skarbnik bounty for you with the vendor tool
([tools/skarbnik-vendor](../../docs/VENDOR.md)): it asks you for each detail, runs the steps, and waits for your yes
before anything is spent. It runs on your own computer, because the secret input must stay there; it is never a
hosted link. One file, `server.py`, Python 3.9 or later, standard library only. The vendor tool it runs needs Python
3.11 or later, the project's programs (`skarbnik-host`, `skarbnik-check`), NEAR CLI with your vendor account, and for
the Groth16 wrap (Level 2, the default) an x86 computer with Docker and about 7.6 GiB of memory plus swap (docs/VENDOR.md).
The prover build runs only on NVIDIA Ada generation GPUs (shown working: L40S, RTX 6000 Ada, L4, RTX 4090; shown failing: RTX A6000, RTX 3090, A40), so the tool skips other types.

## Tools

| Tool | What it does | Asks for a yes |
| --- | --- | --- |
| `init` | Writes a bounty config from your answers (paths only), including the level: 2 (default, the contract checks a Groth16 proof itself), 1 (the contract trusts OutLayer running the pinned verifier program; about 0.011 NEAR a check and about 2.8 NEAR held and returned) or 0 (registered verifiers, run by the project) | no |
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

### 1. Build Skarbnik

You need Linux or WSL, git, Python 3.11 or later, near CLI, Rust and Docker. In your terminal:

    git clone https://github.com/pgreyy/skarbnik.git
    cd skarbnik
    curl -L https://risczero.com/install | bash
    source ~/.bashrc
    rzup install rust 1.97.0
    rzup install cargo-risczero 3.0.6
    rzup install r0vm 3.0.6
    cargo risczero --version
    r0vm --version
    cargo build --release -p skarbnik-host
    cargo build -p kintsugi-check
    ls target/release/skarbnik-host target/debug/skarbnik-check
    near account create-account sponsor-by-faucet-service <you>-vendor.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
    pwd

The near line makes a testnet account with test NEAR and keeps its key in NEAR CLI. The reward is at least 0.1 test
NEAR. More test NEAR: the [official faucet](https://docs.near.org/getting-started/faucet) or
[near-faucet.io](https://near-faucet.io/).

`pwd` prints your folder path, something like `/home/you/skarbnik`. You need it in part 2.

### 2. Run it: AI

Do step 1 first. The other way, Terminal (you type each step), is in docs/VENDOR.md, Commands.

**Windows (Claude Desktop)**

1. **Open the settings file.** Open Claude Desktop, then Settings, Local MCP servers, and
   press Edit config. A folder opens. Open claude_desktop_config.json in it. Press Edit config, then quit Claude
   Desktop fully before you change the file.

2. **Add Skarbnik.** Replace everything in the file with this. Put your folder path from step 1 in place of
   `<folder path>`. If you already have other MCP servers, add only the mcpServers part instead. To print it with
   your folder path filled in, run `python3 tools/skarbnik-vendor-mcp/server.py --setup claude-desktop` in your
   terminal, inside the skarbnik folder.

       {
         "mcpServers": {
           "skarbnik-vendor": {
             "command": "wsl",
             "args": ["python3", "-I", "<folder path>/tools/skarbnik-vendor-mcp/server.py"]
           }
         }
       }

3. **Ask it to host your bounty.** Open Claude Desktop first. If skarbnik-vendor is not listed under Settings,
   Local MCP servers, check that mcpServers is still in the file. Still not listed? The app
   may read another copy of the file: look in %LOCALAPPDATA%\Packages\ (the folder that starts with
   AnthropicPBC.Claude, then LocalCache, Roaming, Claude) or in %APPDATA%\Claude. Your secret input,
   reference fix, public module and tests file must be inside WSL, with paths like /home/you/... It shows the cost
   and waits for your yes before it spends anything. Send the prompt below.

**Mac (Claude Desktop)**

1. **Check ssh to your Linux computer.** The tool runs on Linux, so Claude Desktop on the Mac starts it there over
   ssh. It must finish without asking anything.

       ssh you@linux-host true

2. **Add Skarbnik.** Quit Claude Desktop fully (Claude menu, Quit Claude) before you change the file, because it
   rewrites its settings when it quits. Open ~/Library/Application Support/Claude/claude_desktop_config.json in
   TextEdit and replace everything in it with this. Use your ssh login and the folder path from step 1. If you
   already have other MCP servers, add only the mcpServers part instead. To print it, run the `--setup
   claude-desktop` line above on the Linux computer.

       {
         "mcpServers": {
           "skarbnik-vendor": {
             "command": "ssh",
             "args": ["you@linux-host", "python3 -I <folder path>/tools/skarbnik-vendor-mcp/server.py"]
           }
         }
       }

3. **Ask it to host your bounty.** Open Claude Desktop first. If skarbnik-vendor is not listed under Settings,
   Local MCP servers, check that mcpServers is still in the file. The log is
   ~/Library/Logs/Claude/mcp.log. It shows the cost and waits for your yes before it spends anything. Send the
   prompt below.

**Claude Code or Codex**

Works on Windows through WSL, on a Mac and on Linux. Run both commands in your terminal, inside the skarbnik folder.

1. **Add Skarbnik to your AI app.** In your terminal, inside the skarbnik folder. Claude Code, then Codex:

       claude mcp add --scope user skarbnik-vendor -- python3 -I "$PWD/tools/skarbnik-vendor-mcp/server.py"
       codex mcp add skarbnik-vendor -- python3 -I "$PWD/tools/skarbnik-vendor-mcp/server.py"

2. **Ask it to host your bounty.** It shows the cost and waits for your yes before it spends anything. Send the
   prompt below.

**The prompt**

> Host a private Skarbnik bounty for me with the Skarbnik vendor tool. Ask me which level to use, Level 2 unless I
> choose otherwise, and explain the three levels in plain words. Ask me for each file path you need. Never open, read
> out or print my secret input file, only use its path. Show me the cost and the time first, and wait for my yes before
> you publish or spend on a GPU.

**When it asks you**

| Step | When it asks you |
| --- | --- |
| Set up (`init`) | Asks you for each file path and detail. Spends nothing. |
| Check (`check`) | Nothing to approve: the preflight spends nothing. |
| Proof 0 (`prove0`) | On your own computer, nothing to approve. On a rented GPU, a clear yes: it shows the cost and a one time code first. |
| Publish (`publish`) | A clear yes: it shows the preview, the reward and gas it spends, and a one time code. |
| Watch (`watch_start`) | A clear yes: it shows the GPU cost per attempt, the spending cap and a one time code. |

Settings in `env` reach Linux only when they are also named in `WSLENV` (for example
`"WSLENV": "SKARBNIK_VENDOR_TOOL/u"`); the server starts without any.
