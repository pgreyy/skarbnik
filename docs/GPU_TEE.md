# Design: confidential proving in a GPU TEE

Status: planned, not built. Roadmap item 1.

## The problem it solves

Today the secret input sits in plain memory on whatever machine proves: the vendor's own machine, the vendor's VPS, or
a GPU the vendor rents for a few minutes (docs/VENDOR.md, docs/LIMITS.md). On a rented GPU the vendor has to trust the
cloud provider not to read that memory during the run. The proof itself never shows the secret; the prover does.

## The idea

Run the prover inside a trusted execution environment that covers both the CPU and the GPU, and release the secret to
it only after it proves, by remote attestation, that it runs our exact prover in that protected mode:

1. Rent a confidential VM with a confidential computing GPU (a CPU TEE such as AMD SEV-SNP or Intel TDX, plus an NVIDIA
   GPU in confidential computing mode, such as the H100). The VM's memory and the CPU to GPU traffic are encrypted; the
   host operator cannot read them.
2. Inside the VM, a small launcher measures the prover image (the CUDA build of `skarbnik-host` with the published
   checker id `dd6c5f42...`) and asks for attestation reports from the CPU TEE and from the GPU.
3. The vendor's `watch` checks both reports: the right hardware, confidential computing on, the expected measurement of
   the launcher and the prover. Only then does it send the secret and the salt, encrypted to a key that lives inside the
   VM.
4. The prover runs as today (prove, shrink), wipes the secret and returns the succinct receipt. Groth16 and the submit
   stay where they are.

What the contract checks does not change: the proof is the same Groth16 proof under the same image id. The TEE only
changes who could read the secret while it is being proved.

## What we must check before building it

- Which providers rent confidential computing GPUs by the hour, at what price, and with which attestation flow.
- Whether RISC Zero's CUDA prover runs in GPU confidential computing mode, and how much slower it is there.
- What exactly the attestation reports cover, so the vendor's check names the prover and not only the hardware.
- How the vendor's key release fits into `tools/skarbnik_gpu.py` (today it copies the secret over SSH into
  `/dev/shm`).

## What it will not fix

The vendor still holds the secret and still proves; a silent vendor is still handled by the timeout rule. A bug in
the attested prover or in the hardware TEE would still expose the secret.
