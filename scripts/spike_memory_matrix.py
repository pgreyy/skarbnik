# Spike memory (memory safety bugs in C): runs every module that data/memsafe/build.sh wrote through the real checker
# (target/debug/skarbnik-check run: wasmi, the checker's limits, no imports allowed) and prints one row per module:
# its size, whether it loads, what it does on the secret input (trap or a returned value), how many public tests
# give the expected value, and the most fuel one run used. The secret input is read from its file and never printed.
# Usage, from the repository root: python3 -I scripts/spike_memory_matrix.py <secret hex file>
import glob, os, re, subprocess, sys

CHECK = 'target/debug/skarbnik-check'
secret = open(sys.argv[1]).read().strip()
tests = [l.split() for l in open('data/memsafe/public_tests.txt') if l.strip() and not l.startswith('#')]


def run(module, hexin):
    p = subprocess.run([CHECK, 'run', '--module', module, '--input', '' if hexin == '-' else hexin], capture_output=True, text=True)
    if p.returncode != 0 or not p.stdout:
        return 'load failed: ' + (p.stderr.strip() or p.stdout.strip())[:80], 0
    m = re.match(r'(\S+)(?: (.*?))? fuel_used=(\d+)', p.stdout.strip())
    return (m.group(1) + (' ' + m.group(2) if m.group(2) else '')), int(m.group(3))


print(f'{"module":34s} {"bytes":>5s}  {"secret input":28s} {"public tests":>12s} {"max fuel":>8s}')
for mod in sorted(glob.glob('target/memsafe/*.wasm')):
    out, fuel = run(mod, secret)
    if out.startswith('load failed'):
        print(f'{os.path.basename(mod):34s} {os.path.getsize(mod):5d}  {out}')
        continue
    ok, most = 0, fuel
    for hexin, want in tests:
        got, f = run(mod, hexin)
        most = max(most, f)
        ok += got == f'returned {want}'
    shown = 'returned a value' if out.startswith('returned') else out[:28]
    print(f'{os.path.basename(mod):34s} {os.path.getsize(mod):5d}  {shown:28s} {ok:>5d} of {len(tests):<4d} {most:8d}')
