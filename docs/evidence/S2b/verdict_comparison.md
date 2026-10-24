| Module | Expected | Native before | Native after | zkVM before | zkVM after | Same? | zkVM user cycles before | after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fixed.wasm` | PASS | PASS | PASS | PASS | PASS | yes | 7,845,739 | 8,587,922 |
| `original.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 845,382 | 958,886 |
| `constant.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 646,313 | 757,453 |
| `disable_lists.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,177,282 | 1,318,433 |
| `early_return_prefix.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,438,823 | 1,592,912 |
| `imports_host.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 746,270 | 851,703 |
| `invalid_truncated.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 474,284 | 566,795 |
| `loop_forever.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 3,104,820 | 3,219,124 |
| `memorize_tests.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,979,140 | 2,218,585 |
| `memory_declared.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 730,340 | 833,414 |
| `memory_grow.wasm` | FAIL | PASS | PASS | PASS | PASS | yes | 7,864,242 | 8,609,977 |
| `memory_grow_nomax.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 854,505 | 967,897 |
| `memory_grow_use.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 859,735 | 973,314 |
| `overbroad_fix.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 2,266,206 | 2,512,489 |
| `reject_all.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 641,604 | 752,451 |
| `special_case_exploit.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 4,230,768 | 4,659,546 |
| `subtle_change.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 3,582,169 | 3,925,710 |
| `too_large.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 1,134,058 | 1,202,194 |
| `wrong_export.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 731,751 | 835,093 |
| `wrong_fix.wasm` | FAIL | FAIL | FAIL | FAIL | FAIL | yes | 849,393 | 962,985 |

20 of 20 modules give the same verdict natively and in the zkVM, before and after.
