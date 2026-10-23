# data/attacks: cheating patches (inert test data)

This folder holds inert test data only. Each file is a small WebAssembly module (and the Rust
source it is built from) that tries to get a PASS from the Kintsugi checker without really fixing
the bug in the demo parser (`data/demo/original.rs`). Nothing here runs on its own; the checker
loads these modules inside the wasmi interpreter with no access to the host.

The expected verdict for each module is in `manifest.txt`. Build them with
`bash harness/checker/build_modules.sh` and check them with
`target/debug/kintsugi-check table --manifest data/attacks/manifest.txt --seed <64 hex digits>`.
Results: `docs/evidence/S1/RESULTS.md`.

| Module | What it tries |
| --- | --- |
| `reject_all` | Returns the error -1 for every input. |
| `constant` | Returns 0 for every input. |
| `special_case_exploit` | Keeps the bug but recognises the exact secret crash input and answers -4 for it. |
| `loop_forever` | Loops forever where the original would crash, hoping a hang is not counted as a crash. |
| `memory_grow` | On the crash shape, asks for 64 more memory pages (refused by its own declared maximum) and answers -4. |
| `memory_grow_use` | Like `memory_grow`, then writes to the end of the memory it asked for. |
| `memory_grow_nomax` | Like `memory_grow`, built with no declared maximum, so the request reaches the checker's memory cap. |
| `memory_declared` | The honest fix built with 16 pages (1 MiB) of initial memory; the limit is 2 pages. |
| `early_return_prefix` | Returns 0 at once for any input that starts like the crash input (`01 02`). |
| `disable_lists` | Switches off the buggy feature: rejects every list record. |
| `memorize_tests` | No parser at all: a lookup table of the public tests, -1 for anything else. |
| `wrong_fix` | Fixes a different suspected bug (caps list counts) and leaves the real one. |
| `subtle_change` | Fixes the crash but reads only 3 of the 4 bytes of an int record. |
| `overbroad_fix` | Fixes the crash by rejecting every even length list, including valid ones. |
| `wrong_export` | The honest fix with its entry point exported under another name. |
| `imports_host` | The honest fix plus an imported host function. The checker allows no imports. |
| `too_large` | The honest fix plus 4 KiB of filler; the size limit is 2,048 bytes. |
| `invalid_truncated` | The original module cut to its first 100 bytes, so it does not parse. |
