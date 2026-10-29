# Roadmap note: confidential proving in a GPU TEE

**Planned, not built, not tested.** Roadmap item 1.

## The idea

Today the machine that proves can read the secret input while it proves, including a GPU the vendor rents. The idea:
prove inside confidential hardware (a CPU TEE with a GPU in confidential computing mode), check that hardware by
remote attestation, and send the secret only to a prover that passed the check. The proof and what the contract checks
stay the same. Hardware attestation is a different kind of guarantee from the zero knowledge proof: it adds to it, it
does not replace it.

## Open questions

- Which providers rent confidential computing GPUs by the hour, and at what price.
- Whether RISC Zero's CUDA prover runs in that mode, and how much slower.
- What the attestation reports cover, and whether they can name our exact prover.
- How the secret would be released to the attested machine instead of being copied over SSH.

## Next step

A small spike: rent one confidential GPU machine, run one demo proof inside it, and record what attestation shows.
