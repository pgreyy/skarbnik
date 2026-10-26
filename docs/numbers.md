# Numbers

Measured numbers only, each with the file it comes from. A number that was not measured says so. Times are the
`wall_seconds` line of each log (wall clock).

## Hardware

| Item | Value | Source |
| --- | --- | --- |
| Laptop CPU | 13th Gen Intel Core i7-1360P, 16 logical CPUs | `lscpu` |
| Memory for Linux (WSL2) | 10 GiB visible (11 GB configured), 8 GB swap | `free -h`; docs/EVIDENCE.md (header) |
| GPU | none on the laptop. Rented on RunPod (Secure Cloud, PyTorch 2.8.0 / CUDA 12.8.1 / Ubuntu 24.04 template, 60 GB container disk, no volume): 1x NVIDIA L40S, 46,068 MiB, driver 595.91.07, nvcc 12.8.93, 128 CPUs | docs/evidence/smooth/gpu/01_check.log |

## Proving on the laptop CPU (RISC Zero 3.0.6, check size: 16 fresh inputs, 32 variants, `--po2 19`)

| What | Prove | Prover peak memory | Compress to succinct | Groth16 wrap | Source |
| --- | --- | --- | --- | --- | --- |
| Proof 0 of live bounty 12 (reference fix) | 3,404.47 s | 4,721 MiB | 1,020.89 s, peak 1,486 MiB | 107.47 s, container peak 6,963 MiB | docs/evidence/S18/prove_proof0.log, compress_proof0.log, groth16_proof0.log, mem_groth16.log.peaks |
| Proof 0 of the demo (reference fix) | 4,312.55 s | 4,724 MiB | 1,388.17 s, peak 1,487 MiB | 189.07 s (compress 187.91 s), container peak 7,061 MiB | docs/EVIDENCE.md, "S6 (Level 2, feasibility)" and the reproducible build section (the logs are in target/, not committed) |
| Attempt A0, a passing fix (26 segments) | 3,154.24 s | 4,725 MiB | 1,019.16 s, peak 1,483 MiB | 149.88 s, container peak 6,832 MiB | docs/evidence/S6c/prove_a0.log, compress_a0.log, groth16_a0.log, mem_a0.log.peaks |
| Attempt A1, a failing patch (3 segments) | 345.66 s | 4,704 MiB | 91.96 s | 133.99 s, container peak 7,325 MiB | docs/evidence/S6c/prove_a1.log, compress_a1.log, groth16_a1.log, mem_a1.log.peaks |
| Attempt J, a failing patch (3 segments) | 511.49 s | 4,703 MiB | 123.58 s, peak 1,465 MiB | 182.87 s, container peak 7,019 MiB | docs/evidence/audit1/prove_j.log, compress_j.log, groth16_j.log, mem_j.log.peaks |

| Proof 0 of private bounty 17 (`data/unpack/`, reference fix) | 5,384.58 s | (not recorded) | 1,496.74 s | 177.04 s | docs/evidence/agent/prove_proof0_unpack.log, compress_proof0_unpack.log, groth16_p0.log |
| Bounty 17 attempt, evidence proof (`--po2 18`, 102 segments) | 6,530.99 s | 2,406 MiB | stopped at its 1 hour limit | not run | docs/evidence/agent/prove_u0.log, compress_u0.log |
| Proof 0 of private bounty 24 (`data/smooth/`, reference fix, `--po2 18`, 141 segments) | 8,679.49 s | 2,418 MiB | 5,591.59 s, peak 1,564 MiB | 252.93 s, container peak 6,201 MiB | docs/evidence/smooth/prove_proof0.log, compress_proof0.log, groth16_p0.log, mem_groth16_p0.log.peaks |
| Bounty 24 attempt, try 1 (`--po2 18`) | stopped after 3,698.61 s: "error: verify segment" | 2,386 MiB | not reached | not reached | docs/evidence/smooth/try1_prove_u0.log |

Varies run to run: the two Proof 0 runs of the same program took 3,404 s and 4,313 s; a third, earlier Proof 0 with the
plain build took 4,983.54 s (docs/EVIDENCE.md, S13). A failing patch stops early, so it needs far fewer segments. The
Groth16 container's peak was between 6,832 and 7,325 MiB; peaks are samples, so the true peak may be a little higher.

## The same kind of proof on a rented GPU and on the laptop (bounty 24, `data/smooth/`)

The agent's fix for bounty 24 is byte for byte the vendor's reference fix, so Proof 0 (laptop) and the attempt proof
(GPU) check the same patch of the same program under the same checker image id `dd6c5f42...` (the attempt proof uses
the seed recorded at reveal and the attempt's submission id; Proof 0 uses Proof 0 mode and its own seed).

| Step | Laptop CPU (i7-1360P, `--po2 18`) | NVIDIA L40S on RunPod (`--po2 19`, `cuda-prove-only`) | Source |
| --- | --- | --- | --- |
| Prove | 8,679.49 s (141 segments), peak 2,418 MiB | **29.82 s** (33 segments), peak GPU memory 9,275 MiB, host 514,528 KB | docs/evidence/smooth/prove_proof0.log; docs/evidence/smooth/gpu/prove_u0.log, 03_prove.log |
| Compress to succinct ("shrink") | 5,591.59 s, peak 1,564 MiB | **21.71 s**, host 294,940 KB | compress_proof0.log; gpu/compress_succinct.log |
| Groth16 wrap | 252.93 s (Proof 0), container peak 6,201 MiB | not on the pod (no Docker there); the attempt was wrapped on a separate Docker machine: 337.73 s on a 4 core x86_64 VPS with 7.8 GiB RAM, container peak 6.82 GiB, lowest available memory 184 MiB, 371 MiB of swap used | groth16_p0.log; docs/evidence/smooth/vps/groth16.log, mem.log |
| Whole pod use, first check to fetch | | 706 s: setup 554 s (Rust and RISC Zero install 86 s, code 38 s, build 425 s, image id check), secret in 48 s, prove and wipe, verify, shrink, fetch | docs/evidence/smooth/gpu/*.log |
| Cost | electricity and time | **$0.60**: RunPod balance $9.46 to $8.86, reported by the owner (it may include a first pod that stayed on "Initializing" and was terminated) | owner |

## Proof sizes

| What | Size | Source |
| --- | --- | --- |
| Composite receipt, 26 segments | 6,971,396 bytes | docs/EVIDENCE.md, S2 GPU section (same size as the laptop's S4 receipt) |
| Succinct receipt | 224,786 bytes | docs/evidence/S18/compress_proof0.log; docs/EVIDENCE.md, S4 and S13 |
| Groth16 receipt file | 2,057 bytes | docs/evidence/S6c/groth16_a0.log, groth16_a1.log |
| Groth16 seal the contract checks | 256 bytes, with a 780 byte journal | docs/evidence/S6c/a0_args.json |

## Gas on NEAR testnet

| Call | Gas burnt | Source |
| --- | --- | --- |
| A real PASS proof accepted and paid (`submit_groth16`) | 36.392 Tgas | docs/evidence/S6c/gas_level2.txt (tx `CczggiUNhgiXdaVefHUrB2QEM4GZMqLLDaaRhZ8a4XeY`) |
| A real FAIL proof accepted (`submit_groth16`) | 35.603 Tgas | same file (tx `6B9ocDasU1BZU28fshj6D72DkA8VCmar1ePNp9m3vtca`) |
| A Proof 0 accepted (`open_with_groth16`) | 35.225 Tgas | same file (tx `E3RTxNVVVGvV2NNTFcMgwNgKagpHPmMnsNBNbu1ZoCx8`) |
| A proof for the wrong bounty, refused before the pairing check | 2.35 Tgas | docs/evidence/hardening/steps/s3_proof_of_another_bounty.txt |
| A judge opening bounty 18 with bounty 17's Proof 0 (`open_with_groth16`, sent by a non-vendor account) | 35.247 Tgas | docs/evidence/judge/summary.txt (tx `GhjkpLgkcwUbnWA743FezQEx8WLLXxCtvA7vT9eCfWdb`) |
| A proof refused at the pairing check (right journal, another proof's seal) | 34.856 Tgas | docs/evidence/judge/summary.txt (tx `5uKLepwwYEKUXJTavf8BXbQetFbhRpgeaYviVCaBppkj`) |
| The Groth16 check alone in the spike contract | 34.569 Tgas (pairing check 30.136 Tgas) | docs/evidence/S6b/gas.txt |

Varies: about 35 to 36.4 Tgas per accepted proof, from the work around the check (reading arguments, storage, payout).

## Not measured

- Proving time for programs other than the demo record parser, `data/unpack/` and `data/smooth/`.
- The first GPU run (NVIDIA L40S, 22.65 s prove, docs/evidence/S2/gpu/) produced a different image id than the laptop
  build, so it is not the same program and is not used as a result; the bounty 24 run above used the published image id.
- Groth16 on a GPU (the `cuda-prove-only` build has no Groth16 part).
- Timing or other side channels.
