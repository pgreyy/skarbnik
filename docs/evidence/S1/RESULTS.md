# Spike S1 results: does the checker give the right verdicts?

Date: 2026-10-23 (UTC). Run natively on the dev machine (x86_64, WSL2), not inside the RISC Zero
zkVM. Every number below comes from the raw output files in this folder.

## Question and what was built

Question (blueprint spike S1): given a candidate patch, does the checker answer PASS for a real
fix and FAIL for each kind of cheat, using only PASS or FAIL as the verdict?

What exists now:

- `data/demo/original.rs`: a tiny record parser (tag, length, payload records) with one hidden
  crash: an off by one length check on list records. A list record whose length is exactly
  2 × its item count reads one byte past its payload and traps. Built to a 556 byte module.
- `data/demo/fixed.rs`: the honest patch (the length check corrected). 556 bytes.
- `data/demo/exploit.hex`: the demo crash input (18 bytes). It is published only because this is
  a test fixture.
- `data/demo/public_tests.txt`: 17 public tests with the original's answers.
- `data/attacks/`: 18 cheating modules (inert test data), one line each in
  `data/attacks/README.md`, expected verdicts in `data/attacks/manifest.txt`.
- `harness/checker/` (crate `kintsugi-check`): the checker as a library plus a command line tool.
  The core is pure functions, bytes in and verdict out, with no file, network or clock access,
  so it can move into the zkVM guest later. Built modules come from
  `harness/checker/build_modules.sh` (plain rustc, no downloads).

## The checker's steps

The first step that fails decides the verdict. The verdict type has only two values, PASS and
FAIL. The command line tool can print an internal reason for our own testing.

1. **Validate**: at most 2,048 bytes; parses and validates in wasmi; no imports at all; exports
   `memory` (at most 2 pages of 64 KiB), `input_buf() -> i32` and `parse(i32) -> i32`; no start
   function, no floating point, one memory; a trial instantiation succeeds.
2. **Exploit**: on the secret crash input the candidate must return normally. A crash or running
   out of fuel is FAIL.
3. **Public tests**: each must return exactly the listed value.
4. **Fairness**: 64 fresh inputs made from a public 32 byte seed in the parser's record format
   (1 in 8 deliberately broken). Where the original returns a value, the candidate must return
   the same value. Where the original crashes, the candidate must not crash.
5. **Variants** (added in this spike): 32 copies of the secret input with one or two bytes set to
   seeded random values, judged by the same rule as step 4. A patch that only recognises the exact
   secret bytes still crashes on the variants that crash the original.

Every input runs in a brand new instance (so a module cannot remember earlier inputs) with
50,000 fuel (fuel counts executed instructions), a 2 page memory cap that traps when a memory
request goes over it, at most 64 table elements and a call depth of 64.

Proof 0 (`kintsugi-check proof0`) checks the original itself: it must really trap on the secret
input (running out of fuel does not count) and pass all public tests.

## Commands (run from the repository root)

```
bash harness/checker/build_modules.sh
cargo build -p kintsugi-check --offline
cargo test -p kintsugi-check --offline
target/debug/kintsugi-check proof0
target/debug/kintsugi-check table --manifest data/attacks/manifest.txt --seed 6b696e74737567692053312064656d6f207365656420412e2e2e2e2e2e2e2e21
target/debug/kintsugi-check table --manifest data/attacks/manifest.txt --seed 6b696e74737567692053312064656d6f207365656420412e2e2e2e2e2e2e2e21 --fuzz-count 0 --variants 0
target/debug/kintsugi-check check --candidate data/demo/fixed.wasm --seed 6b696e74737567692053312064656d6f207365656420412e2e2e2e2e2e2e2e21 --explain
```

The seed is the text "kintsugi S1 demo seed A........!" written as hex. All cargo commands were
run with `CARGO_HTTP_MULTIPLEXING=false CARGO_HTTP_TIMEOUT=60 CARGO_NET_RETRY=10
CARGO_NET_GIT_FETCH_WITH_CLI=true` and inside `flock target/.heavy-build.lock`.

## Verdict table

From `table_seed_a.txt` (seed above, 64 fairness inputs, 32 variants):

| patch | expected verdict | actual verdict | reason (internal) |
| --- | --- | --- | --- |
| demo/fixed (honest patch) | PASS | PASS | - |
| demo/original (unpatched) | FAIL | FAIL | 2 exploit: trapped (unreachable) |
| reject_all | FAIL | FAIL | 3 public tests: test #0 returned -1 |
| constant | FAIL | FAIL | 3 public tests: test #0 returned 0 |
| special_case_exploit | FAIL | FAIL | 5 variants: variant #0, original and candidate both trapped |
| loop_forever | FAIL | FAIL | 2 exploit: ran out of fuel |
| **memory_grow** | **FAIL** | **PASS** | **finding, see below** |
| memory_grow_use | FAIL | FAIL | 2 exploit: trapped (out of bounds memory access) |
| memory_grow_nomax | FAIL | FAIL | 2 exploit: trapped (growth operation limited) |
| memory_declared | FAIL | FAIL | 1 validate: memory 16 pages, max 2 |
| early_return_prefix | FAIL | FAIL | 3 public tests: test #9 returned 0 |
| disable_lists | FAIL | FAIL | 3 public tests: test #6 returned -4 |
| memorize_tests | FAIL | FAIL | 4 fairness: input #0, original 562401042, candidate -1 |
| wrong_fix | FAIL | FAIL | 2 exploit: trapped (unreachable) |
| subtle_change | FAIL | FAIL | 4 fairness: input #12, original 1547238442, candidate 1027144746 |
| overbroad_fix | FAIL | FAIL | 4 fairness: input #2, original 184992596, candidate -4 |
| wrong_export | FAIL | FAIL | 1 validate: export `parse` missing |
| imports_host | FAIL | FAIL | 1 validate: 1 import |
| too_large | FAIL | FAIL | 1 validate: 4,685 bytes, max 2,048 |
| invalid_truncated | FAIL | FAIL | 1 validate: does not parse |

**19 of 20 verdicts match.** The same 19 of 20 held on five more seeds (32 bytes of 01, 02, 03,
04, 05; console output only, not saved).

### Finding: memory_grow gets PASS (expected FAIL)

Expected FAIL, actual PASS. On the crash shape the module asks for 64 more memory pages, ignores
the answer, and returns -4. The module itself declares a maximum of 2 pages, so under the
WebAssembly rules the request simply returns -1 ("refused"); it is not a crash and the checker's
memory cap is never consulted. The module never gets or touches the extra memory, and apart from
that refused request it computes exactly what the honest fix computes. So the PASS is not a hole
in the sense of a cheat getting through: the patch is a real fix with a harmless extra
instruction. The expectation in the manifest was wrong about what the module does, not the
checker. Evidence that the memory limit works when memory is really used:

- `memory_grow_use` (asks, then writes to the memory it asked for) FAILs: out of bounds access.
- `memory_grow_nomax` (same code, no declared maximum, so the request reaches the cap) FAILs:
  growth operation limited.
- `memory_declared` (16 pages declared up front) FAILs at validation.

The manifest still lists memory_grow as FAIL, so the table keeps showing the mismatch. The test
suite asserts the observed PASS under the name
`finding_memory_grow_refused_by_its_own_maximum_passes`, so any change in behaviour is noticed.
Owner decision: keep this behaviour (a refused memory request is harmless), or make the checker
stricter and FAIL any module whose memory request is refused for any reason.

### Why steps 4 and 5 are needed

With both seeded steps off (`table_seeded_steps_off.txt`, `--fuzz-count 0 --variants 0`), 15 of
20 match: `special_case_exploit`, `memorize_tests`, `subtle_change` and `overbroad_fix` all
PASS (plus `memory_grow` as above). With the steps on they all FAIL. Single check examples
(`check_examples.txt`): `special_case_exploit` PASSes with `--variants 0` and FAILs with the
default 32 variants.

### How many seeded inputs are enough (for decision D4)

`seed_sweep.txt`: 200 seeds, 128 fairness inputs, 32 variants. Every seed caught every
fairness and variant cheat, and the honest fix passed on all 200 seeds. The latest first
mismatch was fairness input #41 (`overbroad_fix`; median #6), #21 for `subtle_change` (median #3),
#3 for `memorize_tests`, and variant #8 for `special_case_exploit` (median #0). So 64 fairness
inputs caught all four cheats on these 200 seeds, but the margin depends on the cheat: a cheat
that changes behaviour on rarer inputs would need more. On the demo seed, 19 of the 32 variants
still crash the original.

## Test counts

`cargo test -p kintsugi-check --offline` (`cargo_test.txt`): 16 tests passed, 0 failed
(6 unit tests in the library: generator determinism and limits, hex and test list parsing;
10 integration tests in `harness/checker/tests/corpus.rs`: every manifest module on three seeds,
the memory_grow finding, the honest patch on 20 seeds, the step that catches each cheat, the
special case cheat passing with variants off, the memorised tests cheat passing only with both
seeded steps off, Proof 0 on the original and on two fake originals, determinism, and that at
least 70% of fairness inputs are well formed).

## Timings and sizes

Measured with `/usr/bin/time -f 'wall_seconds=%e max_rss_kb=%M'` (raw lines in each file).

| What | Wall clock | Peak memory | File |
| --- | --- | --- | --- |
| First build of the crate with wasmi (includes the crates.io index update and one small download) | 1 min 34 s (cargo's own figure) | not measured | `cargo_build_first.txt` |
| `cargo test` (already built) | 0.17 s | 81,540 KB | `cargo_test.txt` |
| `proof0` | under 0.01 s | 4,340 KB | `proof0.txt` |
| one full `check` of the honest fix (210 module runs) | under 0.01 s | 4,592 KB | `check_examples.txt` |
| `table` of all 20 modules | under 0.01 s | 5,972 KB | `table_seed_a.txt` |

Per check time inside the table (the tool's own timer): 1.7 ms for the honest fix, 1.3 ms for
`loop_forever` (it burns the full 50,000 fuel), under 0.5 ms for most cheats.

Fuel: the honest fix used at most 2,059 fuel per input on the demo seed. A hand made 256 byte
input of 128 empty text records used 18,827 fuel in both the original and the fix
(`kintsugi-check run`, console output only, not saved), which is why the limit is 50,000 and not
the blueprint's unmeasured 6,000. This is native wasmi fuel, not zkVM cycles; S2 measures those.

Module sizes and sha256 of every module: `build_modules.txt`. Rebuilding gave identical hashes on
this machine.

## Versions

`versions.txt`: rustc 1.99.1, cargo 1.99.1. New crates (exact pins): `wasmi =2.0.0`
(`default-features = false`, features `std` and `validate`), which brings in `wasmi_core 2.0.0`,
`wasmi_ir 2.0.0`, `wasmi_collections 2.0.0`, `wasmparser 0.228.0`, `spin 0.9.9`,
`libm 0.2.16` and `bitflags 2.13.2`. `string-interner 0.19.0` was added to Cargo.lock and
downloaded but is not compiled (optional feature, off).

## Devlog

Built the demo parser, the honest fix and 18 cheating modules as plain rustc builds to
`wasm32-unknown-unknown`, and the `kintsugi-check` crate with the five step checker, Proof 0 and
a command line tool. A first build of the parser was 3,282 bytes because Rust's built in bounds
check pulls in panic message code; replacing indexing with a small helper that traps the same
way brought it to 556 bytes. The first offline build failed because cargo needed the index entry
for `string-interner`; one online build fixed that. One cheat, `memory_grow`, got PASS where
FAIL was expected; it is kept in the table and explained above, and two stronger memory cheats
were added that do FAIL. A test first assumed that turning off only the fairness step would let
`memorize_tests` pass; it failed because the variants step also catches it, and the test was
corrected to match what the checker does.

Not done in S1: nothing here ran inside the RISC Zero zkVM, so there is no receipt, no journal and
no "tampered receipt fails in a separate process" check yet; the blueprint's S1 pass condition
needs those. The fairness generator knows only the demo parser's record format.

Next: move the checker core into the zkVM guest (`harness/guest`), commit the journal fields
(candidate hash, exploit commitment, corpus hash, seed, count, submission id, verdict), check a
tampered receipt in a separate process, then S2: proving time and memory for 16, 64 and 128
fairness inputs.
