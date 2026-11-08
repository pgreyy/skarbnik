# Spike A and B, cost: runs the rule checker's guest in the zkVM executor (no proving) and prints a table of cycles and
# segments. For each demo: Proof 0 (the reference fix) and a second correct fix, with the demo secret's one sweep
# position and with none. For the IDOR demo (B) also secrets of 5, 20 and 50 calls: benign calls by the owner first,
# the cross user read last, the sweep on the attacker's login byte. Public demo salt, segment size po2 19, 64 fairness
# inputs and 64 variants. Raw output: docs/evidence/spike_ab/executor.txt.
# Usage, from the repository root: python3 -I scripts/spike_ab_cost.py
import os, re, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = os.path.join(ROOT, "target/release/skarbnik-host")
WORK = os.path.join(ROOT, "target/spike-ab-cost")
SEED = "73706b2d61622d636f7374".ljust(64, "0")
os.makedirs(WORK, exist_ok=True)


def call(op, args):
    return bytes([op, len(args)]) + bytes(args)


def run(demo, candidate, secret_file, proof0, label, raw):
    a = f"{ROOT}/data/attacks/ab/{demo}"
    ref = open(f"{a}/manifest.txt").read().split("PASS")[0].split()[-1]
    cmd = [HOST, "execute", candidate, "--rule", f"{ROOT}/data/ab/{demo}/rule.wasm", "--original", f"{ROOT}/data/ab/{demo}/original.wasm",
           "--tests", f"{ROOT}/data/ab/{demo}/public_tests.txt", "--secret", secret_file, "--reference-fix", f"{a}/{ref}", "--demo-salt",
           "--fuzz-count", "64", "--variants", "64", "--seed", SEED, "--po2", "19"]
    if proof0:
        cmd.append("--proof0")
    else:
        cmd += ["--submission-id", "11" * 32]
    out = subprocess.run(cmd, capture_output=True, text=True, env=dict(os.environ, RISC0_DEV_MODE="0")).stdout
    raw.append(f"### {demo}: {label}\n" + "\n".join(l for l in out.splitlines() if re.match(r"(image id|user cycles|segments|execute seconds|journal.verdict)", l)))
    g = lambda k: (re.search(rf"^{k}: (\S+)", out, re.M) or [None, "?"])[1]
    print(f"| {demo} | {label} | {g('journal.verdict')} | {int(g('user cycles')) / 1e6:.1f} M | {g('segments')} |")


def secret(name, seq_hex, sweep):
    p = os.path.join(WORK, name)
    open(p, "w").write(seq_hex + (f" sweep={sweep}" if sweep is not None else "") + "\n")
    return p


raw = ["# Spike A and B, zkVM executor (no proving): rule guest, po2 19, 64 fairness inputs, 64 variants, public demo salt.",
       f"# $ RISC0_DEV_MODE=0 target/release/skarbnik-host execute <candidate> --rule data/ab/<demo>/rule.wasm ... --seed {SEED} --po2 19 [--proof0]"]
print("| demo | run | verdict | user cycles | segments |\n| --- | --- | --- | --- | --- |")
second = {"xss": "fix_apos", "path": "fix_refuse_escapes", "idor": "fix_hide", "authz": "fix_promote"}
for demo in ("xss", "path", "idor", "authz"):
    a = f"{ROOT}/data/attacks/ab/{demo}"
    line = [l for l in open(f"{a}/demo_secret.txt") if not l.startswith("#")][0].split()
    ref = open(f"{a}/manifest.txt").read().split("PASS")[0].split()[-1]
    with_sweep, no_sweep = secret(f"{demo}_sweep.txt", line[0], line[1][6:]), secret(f"{demo}_nosweep.txt", line[0], None)
    run(demo, f"{a}/{ref}", no_sweep, True, "Proof 0, no sweep", raw)
    run(demo, f"{a}/{ref}", with_sweep, True, "Proof 0, 1 sweep position", raw)
    run(demo, f"{a}/{second[demo]}.wasm", with_sweep, False, f"check {second[demo]}, 1 sweep position", raw)
# B with longer secrets: benign owner calls, then the attack (user 3 reads user 2's file 5)
for n in (5, 20, 50):
    calls = [call(0, [2]), call(1, [5] + list(b"alice-diary"))]
    k = 0
    while len(calls) < n - 3:
        calls.append(call(1, [6 + k % 8] + list(b"note")) if k < 8 else call(3, [5 + (k % 2)]))
        k += 1
    calls += [call(4, []), call(0, [3]), call(3, [5])]
    pos = sum(len(c) for c in calls[:-2]) + 2
    s = secret(f"idor_{n}.txt", b"".join(calls).hex(), pos)
    a = f"{ROOT}/data/attacks/ab/idor"
    run("idor", f"{a}/fix_owner.wasm", s, True, f"Proof 0, {len(calls)} calls, 1 sweep position", raw)
    run("idor", f"{a}/fix_hide.wasm", s, False, f"check fix_hide, {len(calls)} calls, 1 sweep position", raw)
os.makedirs(os.path.join(ROOT, "docs/evidence/spike_ab"), exist_ok=True)
open(os.path.join(ROOT, "docs/evidence/spike_ab/executor.txt"), "w").write("\n".join(raw) + "\n")
