# data

Test data for the Skarbnik checker.

- `demo/`: the demo program for spike S1. `original.rs` is a tiny record parser with one hidden
  crash, `fixed.rs` is the honest patch, and the `.wasm` files are built from them by
  `harness/checker/build_modules.sh`. `public_tests.txt` holds the public tests. `exploit.hex` is
  the demo's crash input. In a real bounty that input is the vendor's secret and never published;
  here it is a test fixture so anyone can rerun the checks.
- `attacks/`: inert test data only: cheating patches the checker must reject, with a manifest of
  expected verdicts. See `attacks/README.md`.
