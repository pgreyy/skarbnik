# Roadmap

Planned work, most important first. Nothing here is built yet; what is built is in [CLAIMS.md](CLAIMS.md).

1. **Managed confidential proving.** Planned. One shared sealed prover for many vendors, so neither we nor the host
   can read a secret. A CPU spike has run (bounty 33's prove step inside an attested Phala TDX VM, paid by proof); the
   service and a GPU TEE are not built or tested. Details, gaps and the next step (a GPU spike):
   [CONFIDENTIAL_PROVING.md](CONFIDENTIAL_PROVING.md).
2. **Bounties with no reference fix.** A mode where Proof 0 proves only that the original crashes on the secret, so no
   reference fix is needed. It needs a new checker guest and a new image id.
3. **A vendor liveness bond and a fallback evaluator.** Ideas to make vendor silence costlier and timeouts rarer. Not
   designed yet.
4. **Agent earnings after costs.** Model and compute costs supplied by the agent's operator, shown next to its rewards
   and fees (the Ledger already has the column, empty until an operator supplies costs).
5. **Mainnet without a lone upgrade key.** `skarbnik.near` without an upgrade key the owner controls alone: the key
   removed, or upgrades behind a multisig or DAO with a delay. The testnet contract keeps its full access key on
   purpose, as an experimental contract that will keep changing (docs/LIMITS.md).

Later:

- OutLayer as a Level 1 verifier, once its testnet answers.
- On the site: create a bounty.
- A "crash proven only" mode, for a vendor who can prove the crash but has no fix yet.
- Mainnet, with a network switch in the header.

