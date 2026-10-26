# Skarbnik agent

`skarbnik_agent.py` is an agent driven by a language model, for NEAR testnet. One run:

1. reads `feed.json` and picks an open bounty (or the one named with `--bounty`);
2. runs `scripts/agent_preflight.sh` and checks the account's on-chain agent limits and its key;
3. downloads the bounty's public code and checks it: the module's sha256 must equal the bounty's `original_hash`, and
   the public tests must give its `corpus_hash`;
4. asks the model for a fix, builds it with the program's own build flags, and runs the public tests with the local
   checker; an answer that does not build, fails a test, is too large, or uses `include!`, `env!`, `extern crate`, `mod`
   or `#[path]` is not used (the model gets one more try with the reason);
5. commits and reveals the fix with the limited key (only with `--live`), and records the attempt;
6. stops after `max_attempts` commits. `status` reads the verdict of every recorded attempt.

Settings: `config.toml` (copy it to `config.local.toml`, which git ignores, or run `./scripts/agent_testnet.sh setup`).
Model providers are `[provider.<name>]` entries: `nearai` (NEAR AI Cloud, the default) and `standin` (answers with the
reference fix, for tests). Any OpenAI compatible chat completions API can be added the same way.

The API key is read from the environment variable `api_key_env` or the file `api_key_file`, which must be outside the
repository. It is never printed or written to a log, and child programs (rustc, the checker, near-cli) run without it.

Run logs and attempt records: `target/agent-runs/` (ignored by git; the attempt records hold each nonce until reveal).

Commands, from the repository root:

    python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml                  # dry run, sends nothing
    python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml --provider standin
    python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml --live --bounty <id>
    python3 -I agent/skarbnik_agent.py status --config agent/config.local.toml
    ./scripts/agent_dry_run_test.sh                                                          # tests, no key needed
