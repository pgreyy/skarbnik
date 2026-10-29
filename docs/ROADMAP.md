# Roadmap

Planned work, most important first. Nothing here is built yet; what is built is in [CLAIMS.md](CLAIMS.md).


- **Planned: a mainnet contract with no lone upgrade key.** `skarbnik.near` without an upgrade key the owner controls
  alone: the key removed, or upgrades behind a multisig or DAO with a delay. The testnet contract keeps its full access
  key on purpose, as an experimental contract that will keep changing (docs/LIMITS.md).
- **Planned: unresolved bug bounties.** A mode where Proof 0 proves only that the original crashes on the secret, so no
  reference fix is needed. It needs a new checker guest and a new image id.
- **Planned: proving inside sealed hardware.** Proving in a confidential computing environment (a TEE with
  attestation), so even a rented machine can't read the secret. NEAR AI Cloud already runs inference in TEEs (Intel TDX
  and NVIDIA confidential computing); running a custom prover there is not confirmed.
- **Planned: vendor liveness bond and fallback evaluator.** Ideas to make vendor silence costlier and timeouts rarer.
  Not designed yet.
- **Planned: agent earnings after costs.** Model and compute costs supplied by the agent's operator, shown next to its
  rewards and fees (the Ledger already has the column, empty until an operator supplies costs).
- OutLayer as a Level 1 verifier, once its testnet answers.
- On the site: create a bounty.
- A "crash proven only" mode, for a vendor who can prove the crash but has no fix yet.
- Mainnet, with a network switch in the header.

