OutLayer Level 1 spike, 2026-11-03 (testnet jobs; mainnet read only). Raw logs: ../spike_a_valid_receipt.txt,
../spike_b_flipped_receipt.txt, ../spike_c1_fastfs_upload.txt, ../spike_c1_uncached_fastfs.txt, ../spike_c2_project.txt,
../spike_c2_uncached_project.txt, ../h1_recheck_2026-11-03.txt, 00_pricing_config.txt, 01_mainnet_read_only.txt.
Paying account: kintsugi-res2-prnvm.testnet, 9.822006711 NEAR before the first recheck job, 9.790978106 NEAR after the
last job (0.031 NEAR in all, including a small project storage deposit). Reserve kept: 1 NEAR (this account holds no
open bounty; its 0.16 NEAR agent credit lives in the contract).

Jobs (OutLayer on testnet, outlayer.testnet; program = our verifier unless said):
- h1  7JK7Hbce  empty input, published program (cached)   answered 10 s  success, charged 0.0010887 NEAR
- a   CRDFPDUz  valid S4 receipt                          answered 15 s  ok=true verdict=PASS, 878,726,816 instructions,
                                                                         1,129 ms, charged 0.0011130 NEAR, 49.7 Tgas
- b   BjdgAJms  same receipt, one byte flipped (hash fixed) answered 13 s  ok=false "receipt is invalid: verification
                                                                         indicates proof is invalid", charged 0.0011304 NEAR
- c1  CCWYC2G7  variant (version string), FastFS link     answered 12 s  failed "wasm_url could not be fetched", refunded
                upload txs JCaeYzTK, 7gSuMsWd; the FastFS gateway answered 502 for 10 minutes after the upload
- c2  26eeV7Ab  variant via a project (GTeR7qmJ)          answered 11 s  failed "wasm_url could not be fetched", refunded
All four answers came with compilation_note "Cached WASM from 2026-10-26T05:34:41" for the published program.
Not run: raw GitHub and GitHub-source hosting of the variant (both need a commit, which the brief ruled out); a Level 1
attempt through our contract (OutLayer is not set on kintsugi-l2-cihdp.testnet; setting it needs owner calls, which the
brief ruled out; the old S4 contract has it set but its bounty is settled, and a new attempt needs a new proof).
Pricing (testnet and mainnet the same): base 0.001 NEAR, 0.0001 NEAR per second of run time, 1e-10 NEAR per million
instructions, plus 0.00001 NEAR per input byte above 32 KB held as a deposit and returned at settlement.
