# Builds the public files of the rule checker's bounty programs: for data/assets and data/projects, the program
# (original.wasm) and its public rule (rule.wasm) with clang (wasi-sdk 34), and the public tests from the original
# (skarbnik-check-rule expect). It writes no secret and no fix: those stay with the vendor, outside the repository.
# Usage, from the repository root: WASI_SDK=<wasi-sdk folder> python3 -I scripts/rule_bounty_make.py
import os, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CC = os.path.join(os.environ["WASI_SDK"], "bin", "clang")
CHECK = os.path.join(ROOT, "target", "release", "skarbnik-check-rule")
# One 64 KiB memory page for the program and for the rule: the proof's cost grows with module memory.
FLAGS = ["--target=wasm32", "-Oz", "-nostdlib", "-ffreestanding", "-mbulk-memory", "-Wl,--no-entry", "-Wl,--strip-all",
         "-Wl,--gc-sections", "-Wl,-z,stack-size=8192", "-Wl,--initial-memory=65536", "-Wl,--max-memory=65536"]


def call(op, args):
    args = args.encode() if isinstance(args, str) else bytes(args)
    return bytes([op, len(args)]) + args


def seq(*calls):  # a call sequence as hex
    return b"".join(calls).hex()


PROGRAMS = {
    "assets": [seq(call(0, s)) for s in ["docs/a.txt", "img\\logo.png", "a/./b", "a//b\\c", "a/b/../c", "a\\b/../c", "../x", ".",
                                        "", "x/../../y", "uploads\\2026\\report.pdf", "a/b/c/", "./notes.md"]],
    "projects": [seq(call(0, [2]), call(1, b"\x09atlas"), call(3, [9]), call(6, [9])),
                 seq(call(0, [2]), call(1, b"\x04beta"), call(2, [4, 5]), call(3, [4]), call(4, b""), call(0, [5]),
                     call(5, b"\x04beta-2"), call(6, [4])),
                 seq(call(0, [1]), call(1, b"\x01x"), call(4, b""), call(0, [3]), call(5, b"\x01y"), call(6, [1])),
                 seq(call(2, [0, 2]), call(1, b"\x00z")),
                 seq(call(0, [2]), call(1, b"\x03a"), call(1, b"\x03b"), call(2, [3, 9]), call(2, [12, 1])),
                 seq(call(3, [7]), call(6, [20]), call(0, [0])),
                 seq(call(0, [6]), call(1, b"\x0flong-project-name-x"), call(6, [15]), call(2, [15, 6]), call(3, [15]))],
}


def build(src, out):
    subprocess.run([CC, *FLAGS, "-o", out, src], check=True)


def main():
    for name, tests in PROGRAMS.items():
        d = os.path.join(ROOT, "data", name)
        build(os.path.join(d, "original.c"), os.path.join(d, "original.wasm"))
        build(os.path.join(d, "rule.c"), os.path.join(d, "rule.wasm"))
        seqs = os.path.join(d, ".sequences.txt")
        open(seqs, "w").write("\n".join(tests) + "\n")
        out = subprocess.run([CHECK, "expect", "--module", os.path.join(d, "original.wasm"), "--sequences", seqs],
                             capture_output=True, text=True, check=True).stdout
        os.remove(seqs)
        open(os.path.join(d, "public_tests.txt"), "w").write(
            f"# Public tests of data/{name}: one per line, <call sequence as hex> <the original's results as hex>.\n"
            "# Made by scripts/rule_bounty_make.py with: skarbnik-check-rule expect --module original.wasm --sequences ...\n" + out)
        sizes = {f: os.path.getsize(os.path.join(d, f)) for f in ("original.wasm", "rule.wasm")}
        print(f"{name}: original {sizes['original.wasm']} B, rule {sizes['rule.wasm']} B, {len(tests)} public tests")


if __name__ == "__main__":
    main()
