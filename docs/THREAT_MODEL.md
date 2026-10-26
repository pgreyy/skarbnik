# Threat model

Who can do what in a Skarbnik bounty, and what stops them. This page summarises; every guard, with its code and its
test or transaction, is in [SECURITY.md](SECURITY.md#1-guards), and every attack we tried is in
[SECURITY.md, section 2](SECURITY.md#2-attacks-we-tried). Testnet only; no external security audit.

| Who | What they could try | What stops it | What does not stop it |
| --- | --- | --- | --- |
| **The vendor** (holds the secret, proves each attempt) | Refuse to pay a good fix; pay a weaker check than promised; use its own checker program; take the reward back | Proof 0 before the bounty opens; the contract checks each proof itself and the journal must match this bounty's original, secret commitment, tests and check size; only allowlisted checker image ids; the timeout rule pays if the vendor stays silent; expiry refunds only when no revealed attempt waits | A silent vendor that reveals junk from its own accounts can keep up to (K - 1)/K of the reward under the timeout split; the vendor sees every patch before it proves |
| **An agent or researcher** | Learn the secret by many tries; copy someone else's revealed fix; flood or block the slots; fake a PASS | One yes or no per verdict and at most K counted attempts, with a rising fee; commit then reveal, and the earliest reveal goes first; a proof must name this attempt's patch, seed and submission id; the per-account cap (optional per bounty) | One person can use many accounts; anyone can hold all K slots with junk commits for one reveal window, at a growing cost |
| **An agent's key** (if stolen) | Move its owner's money; spend without limit | A function call key limited to `commit` and `reveal`; withdrawing credit needs 1 yoctoNEAR, which that key cannot attach; `set_agent_limits` caps the fee per attempt and fixes the payout account; the stop button | It can still spend the credit one limited fee at a time; keep credit small |
| **The public** (anyone watching or calling) | Read the secret from the chain; send forged, replayed or late proofs | Only a salted commitment of the secret is public; 9 forged, replayed or late proofs were refused on testnet; cheap binding checks run before the pairing check | Revealed patches are public by design |
| **The owner** (the contract account) | Change which checkers are allowed; replace the contract code | The allowlist is public (`get_allowed_image_ids`), and an id can be added but not removed | The contract account still has a full access key, so its code can still be replaced (to be removed last) |
| **The prover machine** (the vendor's own machine, a rented GPU, or the project's VPS) | Read or leak the secret; skip or delay proofs | Nothing technical: the vendor chooses where proving runs; secrets in files of mode 600, never printed or committed; only a succinct receipt goes to a separate wrap machine | A machine that proves sees the secret; a rented GPU holds it in memory for the run; a prover that stops lets the timeout rule pay |

What a prover machine cannot do: make the contract pay a FAIL as a PASS. A proof that does not verify for the
bounty's image id and journal is refused. What Level 2 still trusts (the BN254 curve, RISC Zero's Groth16 setup, two
fixed constants): [SECURITY.md, section 3](SECURITY.md#3-known-limits). Every limit in one list: [LIMITS.md](LIMITS.md).
