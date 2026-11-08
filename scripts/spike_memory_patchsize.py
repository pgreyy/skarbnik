# Spike memory: how big a patch is when sent as a diff instead of a whole module. For each pair (published
# instrumented original, instrumented fix) it prints: the whole fixed module's size; a byte level diff (copy and insert
# operations from Python's difflib, each copy as offset and length in LEB128, each insert as length and bytes: the
# same idea as bsdiff or VCDIFF without compression); and a function level diff (the indexes and new bodies of the
# functions whose code changed, plus any other section that changed, sent whole).
# Usage, from the repository root: python3 -I scripts/spike_memory_patchsize.py <original.wasm> <fixed.wasm> ...
import difflib, sys


def leb(n):
    out = bytearray()
    while True:
        b = n & 0x7f; n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n: return bytes(out)


def rleb(b, i):
    r = s = 0
    while True:
        x = b[i]; i += 1; r |= (x & 0x7f) << s; s += 7
        if x < 0x80: return r, i


def sections(b):
    out, i = {}, 8
    while i < len(b):
        sid = b[i]; size, j = rleb(b, i + 1)
        out.setdefault(sid, []).append(b[j:j + size]); i = j + size
    return out


def bodies(code):
    n, i = rleb(code, 0); out = []
    for _ in range(n):
        size, j = rleb(code, i); out.append(code[j:j + size]); i = j + size
    return out


def byte_diff(a, b):
    size = 0
    for op, a0, a1, b0, b1 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        size += 1 + (len(leb(a0)) + len(leb(a1 - a0)) if op == 'equal' else len(leb(b1 - b0)) + (b1 - b0) if op != 'delete' else 0)
    return size


def func_diff(a, b):
    sa, sb = sections(a), sections(b)
    fa, fb = bodies(sa[10][0]), bodies(sb[10][0])
    changed = [k for k in range(len(fb)) if k >= len(fa) or fa[k] != fb[k]]
    size = len(leb(len(changed))) + sum(len(leb(k)) + len(leb(len(fb[k]))) + len(fb[k]) for k in changed)
    other = [sid for sid in sb if sid != 10 and sa.get(sid) != sb[sid]]
    size += sum(1 + len(leb(sum(map(len, sb[s])))) + sum(map(len, sb[s])) for s in other)
    return size, changed, len(fb), other


args = sys.argv[1:]
print(f'{"fixed module":34s} {"whole":>6s} {"byte diff":>9s} {"function diff":>13s}  changed functions')
for o, f in zip(args[::2], args[1::2]):
    a, b = open(o, 'rb').read(), open(f, 'rb').read()
    fs, changed, total, other = func_diff(a, b)
    print(f'{f.split("/")[-1]:34s} {len(b):6d} {byte_diff(a, b):9d} {fs:13d}  {len(changed)} of {total} (index {changed})' + (f', other sections changed: {other}' if other else ''))
