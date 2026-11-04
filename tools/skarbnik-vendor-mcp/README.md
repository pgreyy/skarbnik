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

### 1. Install on your computer

Nothing in these steps goes into an AI chat. Each command says where it goes: in your terminal, or paste into the
file. The install is the same for both ways of running the tool.

#### Windows

1. Install WSL once. Open PowerShell and run this, then restart the computer.

   In your terminal (PowerShell):

       wsl --install

   After the restart, open Ubuntu from the Start menu. Every command from here on runs in this Ubuntu terminal.

2. Install what the tool needs. Each check command prints a version.

   Basic tools and Python 3.11 or later. In your terminal (Ubuntu):

       sudo apt update && sudo apt install -y git python3 curl build-essential pkg-config libssl-dev
       git --version
       python3 --version

   Rust, to build the project's two programs. In your terminal (Ubuntu):

       curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
       source "$HOME/.cargo/env"
       cargo --version

   RISC Zero, at the versions in docs/VERSIONS.md. In your terminal (Ubuntu):

       curl -L https://risczero.com/install | bash
       source ~/.bashrc
       rzup install rust 1.97.0
       rzup install cargo-risczero 3.0.6
       rzup install r0vm 3.0.6
       cargo risczero --version
       r0vm --version

   NEAR CLI (near-cli-rs 0.30.1). In your terminal (Ubuntu):

       curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/download/v0.30.1/near-cli-rs-installer.sh | sh
       near --version

   Docker. The build of the two programs needs it once at every level, because the checker inside them is built in
   Docker. Level 2 also needs it for the Groth16 step. In your terminal (Ubuntu):

       sudo apt install -y docker.io docker-buildx
       sudo usermod -aG docker $USER

   Close Ubuntu and open it again. Then, in your terminal (Ubuntu):

       docker --version
       docker buildx version

3. Get the project, build its two programs and make your vendor account. The first build downloads RISC Zero's
   guest builder image (about 7.5 GB) and takes a while. In your terminal (Ubuntu):

       git clone https://github.com/pgreyy/skarbnik.git
       cd skarbnik
       cargo build --release -p skarbnik-host
       cargo build -p kintsugi-check
       ls target/release/skarbnik-host target/debug/skarbnik-check
       near account create-account sponsor-by-faucet-service <you>-vendor.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create

   The last command makes a testnet account with test NEAR and keeps its key in NEAR CLI. The reward is at least 0.1
   test NEAR. More test NEAR: the [official faucet](https://docs.near.org/getting-started/faucet) or
   [near-faucet.io](https://near-faucet.io/). A faucet can run out; then ask in the
   [NEAR dev Telegram](https://t.me/neardev).

4. Get the folder path. In your terminal (Ubuntu), inside the skarbnik folder:

       pwd

   It prints something like `/home/you/skarbnik`. You need it when you add the tool to your AI app.

#### Mac

The vendor tool needs Linux: it reads the computer's memory from `/proc`, which a Mac does not have. So the tool runs
on a Linux computer (a server, or a Linux virtual machine), and Claude Desktop on the Mac starts it there over ssh.

1. On the Linux computer, do Windows steps 2 to 4: install what the tool needs, get the project, build it and get the
   folder path. Run them in your terminal on the Linux computer.

2. Check that the Mac reaches the Linux computer with ssh, with a key and no password question. In your terminal
   (Mac):

       ssh you@linux-host true

   It must finish without asking anything.

#### Linux

Do Windows steps 2 to 4 on the computer where the tool runs (on Windows, inside Ubuntu).

### 2. Run it

Two ways, the same result: in your AI app (you chat, it runs the steps), below, or in your terminal (you type
each step: [docs/VENDOR.md](../../docs/VENDOR.md), Commands).

### In your AI app

Do the install first. Nothing here goes into an AI chat until the last step.

#### Windows, with Claude Desktop

1. Quit Claude Desktop fully before you edit its settings file. Closing the window is not enough: right click its
   icon near the clock and choose Quit, or end it in Task Manager. Claude Desktop rewrites the file when it quits, so
   an edit made while it is open is lost.

2. Open Claude Desktop, then Settings, Desktop app, Extensions, Local MCP servers, and press Edit config. A folder
   opens. Quit Claude Desktop again, the same way as in step 1. Then open `claude_desktop_config.json` from that folder
   in Notepad. Installed from the Microsoft Store? Then the file is in
   `%LOCALAPPDATA%\Packages\Claude_...\LocalCache\Roaming\Claude\` instead of `%APPDATA%\Claude\`. Edit config
   opens the right folder either way.

3. Add the skarbnik-vendor block. Put your folder path from the install, step 4, in place of `<folder path>`. Paste into the file,
   next to the other settings, with a comma after the item before it:

       "mcpServers": {
         "skarbnik-vendor": {
           "command": "wsl",
           "args": ["python3", "-I", "<folder path>/tools/skarbnik-vendor-mcp/server.py"]
         }
       }

   A file that already has other settings looks like this afterwards. See the comma after the item before it, and
   the braces around everything:

       {
         "preferences": {
           "sidebarMode": "chat"
         },
         "mcpServers": {
           "skarbnik-vendor": {
             "command": "wsl",
             "args": ["python3", "-I", "/home/you/skarbnik/tools/skarbnik-vendor-mcp/server.py"]
           }
         }
       }

   If the file already has `"mcpServers"`, add only the `"skarbnik-vendor": {...}` part inside it, with a comma after
   the server before it. To get the block with your folder path filled in, run this in your terminal (Ubuntu), inside
   the skarbnik folder: `python3 tools/skarbnik-vendor-mcp/server.py --setup claude-desktop`. It prints the block.

4. Save the file, then open Claude Desktop. Check Settings, Desktop app, Extensions, Local MCP servers:
   skarbnik-vendor is listed.

5. Not listed? Open the file again and check that `"mcpServers"` is still in it. It is lost if Claude Desktop was
   open while you edited. The logs are in the `logs` folder next to `claude_desktop_config.json`: `mcp.log`.

#### Mac, with Claude Desktop

1. Print the block. In your terminal on the Linux computer, inside the skarbnik folder:

       python3 tools/skarbnik-vendor-mcp/server.py --setup claude-desktop

   It prints a block with the folder path. You need that path in step 3.

2. Quit Claude Desktop fully: Claude menu, Quit Claude. It rewrites its settings file when it quits, so an edit made
   while it is open is lost. Then open `~/Library/Application Support/Claude/claude_desktop_config.json` in TextEdit.

3. Paste into the file, next to the other settings, with a comma after the item before it (the same rule as Windows
   step 3). Put your ssh login in place of `you@linux-host` and the folder path in place of `<folder path>`:

       "mcpServers": {
         "skarbnik-vendor": {
           "command": "ssh",
           "args": ["you@linux-host", "python3 -I <folder path>/tools/skarbnik-vendor-mcp/server.py"]
         }
       }

4. Save the file, then open Claude Desktop. Check Settings, Desktop app, Extensions, Local MCP servers:
   skarbnik-vendor is listed. Not listed? Check that `"mcpServers"` is still in the file. The log is
   `~/Library/Logs/Claude/mcp.log`.

#### Linux, and anyone using Claude Code or Codex

Run one command in your terminal, inside the skarbnik folder.

Claude Code. In your terminal:

    claude mcp add --scope user skarbnik-vendor -- python3 -I "$PWD/tools/skarbnik-vendor-mcp/server.py"

Codex. In your terminal:

    codex mcp add skarbnik-vendor -- python3 -I "$PWD/tools/skarbnik-vendor-mcp/server.py"

`python3 tools/skarbnik-vendor-mcp/server.py --setup claude-code` (or `--setup codex`) prints the same with this
computer's paths. Claude Desktop on Linux: `--setup claude-desktop` prints the block; quit the app, paste it into the
file as in Windows step 3, save, open the app.

#### Check it

Type this into your AI chat. It should answer with the tool's status:

> Show me the status of my Skarbnik vendor tool.

#### Ask your AI to host your bounty

This is the one thing you type into your AI chat:

> Host a private Skarbnik bounty for me with the Skarbnik vendor tool. Ask me which level to use, Level 2 unless I
> choose otherwise, and explain the three levels in plain words. Ask me for each file path you need. Never open, read
> out or print my secret input file, only use its path. Show me the cost and the time first, and wait for my yes before
> you publish or spend on a GPU.

What your AI does, and when it asks you:

| Step | When it asks you |
| --- | --- |
| Set up (`init`) | Asks you for each file path and detail. Spends nothing. |
| Check (`check`) | Nothing to approve: the preflight spends nothing. |
| Proof 0 (`prove0`) | On your own computer, nothing to approve. On a rented GPU, a clear yes: it shows the cost and a one time code first. |
| Publish (`publish`) | A clear yes: it shows the preview, the reward and gas it spends, and a one time code. |
| Watch (`watch_start`) | A clear yes: it shows the GPU cost per attempt, the spending cap and a one time code. |

Settings in `env` reach Linux only when they are also named in `WSLENV` (for example
`"WSLENV": "SKARBNIK_VENDOR_TOOL/u"`); the server starts without any.
