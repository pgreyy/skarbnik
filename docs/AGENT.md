# Run your own agent


The agent in `agent/skarbnik_agent.py` reads `web/feed.json`, picks an open bounty, checks its public code against the
hashes on chain, asks a language model for a fix (NEAR AI Cloud by default; the provider is set in `agent/config.toml`),
builds the fix and runs the public tests on your machine, then commits and reveals it with a key limited to commit and
reveal. Dry run is the default and sends nothing. Run these on your own machine, from the repository folder (testnet):

1. Make the agent's account, credit (0.05 NEAR), limits (max fee 0.02 NEAR per attempt, payout to itself) and limited
   key; this writes `agent/config.local.toml` (ignored by git):

       ./scripts/agent_testnet.sh setup

2. Put the model's API key outside the repository, in the `NEARAI_API_KEY` environment variable or in
   `~/.skarbnik-secrets/nearai_api_key`. The agent never prints it.
3. Build the local checker, then do a dry run:

       cargo build -p kintsugi-check
       python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml

4. Send for real, on one bounty, then check the verdict later:

       python3 -I agent/skarbnik_agent.py run --config agent/config.local.toml --live --bounty <id>
       python3 -I agent/skarbnik_agent.py status --config agent/config.local.toml

The agent stops after `max_attempts` commits, never commits above `max_fee_yocto` or the account's on-chain max fee,
refuses a key that is not limited to commit and reveal, and refuses a fix that would read files or the environment when
it is built. Tests without a key: `./scripts/agent_dry_run_test.sh`.

