# Spike A and B (the rule checker): builds the four demos and their corpora. For each demo in data/ab/<demo>/ it writes
# the fixes and cheats as small edits of original.c into data/attacks/ab/<demo>/<name>.c, builds every module and the
# rule with clang (wasi-sdk 34), writes the public tests from the original (skarbnik-check-rule expect), the public demo
# secret (data/attacks/ab/<demo>/demo_secret.txt) and the manifest of expected verdicts.
# Usage, from the repository root: WASI_SDK=<wasi-sdk folder> python3 -I scripts/spike_ab_make.py
import os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CC = os.path.join(os.environ["WASI_SDK"], "bin", "clang")
CHECK = os.path.join(ROOT, "target", "release", "skarbnik-check-rule")
BASE = ["--target=wasm32", "-Oz", "-nostdlib", "-ffreestanding", "-mbulk-memory", "-Wl,--no-entry", "-Wl,--strip-all",
        "-Wl,--gc-sections", "-Wl,-z,stack-size=8192"]
PROGRAM_MEM = ["-Wl,--initial-memory=131072", "-Wl,--max-memory=131072"]
RULE_MEM = ["-Wl,--initial-memory=262144", "-Wl,--max-memory=262144"]


def call(op, args):
    args = args.encode() if isinstance(args, str) else bytes(args)
    return bytes([op, len(args)]) + args


def seq(*calls):  # a call sequence as hex
    return b"".join(calls).hex()


# ---------------------------------------------------------------- the demos: edits, tests, secrets
XSS_ELSE = "        else OUT[n++] = c;"
PATH_CALL = """    int n = normalize(IN, len);
    if (n < 0) return -1;
    for (int i = 0; i < n; i++) P[i] = OUT[i];
    return decode(P, n, OUT);"""
IDOR_READ = """        if (f > 15 || !owner[f]) return -2;
        for (int i = 0; i < size[f]; i++) OUT[i] = data[f][i];"""
AUTHZ_SET = """        if (len < 2 || IN[0] < 1 || IN[0] > 7 || IN[1] < 1 || IN[1] > 2) return -2;
        role[IN[0]] = IN[1];"""

DEMOS = {
    "xss": {
        "edits": {
            "fix_entity": ("PASS", "a correct fix: ' becomes &#39;", [(XSS_ELSE, "        else if (c == '\\'') n = put(n, \"&#39;\");\n" + XSS_ELSE)]),
            "fix_apos": ("PASS", "a correct fix written another way: ' becomes &apos;", [(XSS_ELSE, "        else if (c == 39) { const char *e = \"&apos;\"; n = put(n, e); }\n" + XSS_ELSE)]),
            "cheat_empty": ("FAIL", "returns an empty output", [("    }\n    return n;\n}", "    }\n    return 0;\n}")]),
            "cheat_deny": ("FAIL", "refuses every call", [("    if (op != 0) return -1;", "    return -1;")]),
            "cheat_strip": ("FAIL", "drops quotes instead of escaping them", [(XSS_ELSE, "        else if (c == '\\'') {}\n" + XSS_ELSE)]),
            "cheat_special": ("FAIL", "escapes quotes only when the input starts like the demo secret", [(XSS_ELSE, "        else if (c == '\\'' && IN[0] == 'x' && IN[1] == '\\'' && len == 25) n = put(n, \"&#39;\");\n" + XSS_ELSE)]),
            "cheat_payload": ("FAIL", "escapes quotes only when the input holds the word onmouseover", [("    int n = 0;", "    int n = 0, hit = 0;\n    for (int i = 0; i + 11 <= len; i++) { int k = 0; while (k < 11 && IN[i + k] == (u8)\"onmouseover\"[k]) k++; if (k == 11) hit = 1; }"), (XSS_ELSE, "        else if (c == '\\'' && hit) n = put(n, \"&#39;\");\n" + XSS_ELSE)]),
            "cheat_benign": ("FAIL", "escapes quotes and also spaces, which breaks normal text", [(XSS_ELSE, "        else if (c == '\\'') n = put(n, \"&#39;\");\n        else if (c == ' ') n = put(n, \"&#32;\");\n" + XSS_ELSE)]),
        },
        "reference": "fix_entity",
        "tests": [seq(call(0, s)) for s in ["hello", "a<b>&c", 'say "hi"', "", "<script>x</script>", "tab\tand space", "100% & more",
                                            "&amp; already", "a\"b\"c", "<img src=x>"]],
        "secret": ([call(0, "x' onmouseover='alert(1)'")], [(0, 1)]),
    },
    "path": {
        "edits": {
            "fix_decode_first": ("PASS", "a correct fix: decode first, then normalize", [(PATH_CALL, "    int m = decode(IN, len, P);\n    return normalize(P, m);")]),
            "fix_refuse_escapes": ("PASS", "a correct fix written another way: refuse an escape that decodes to . or /", [(PATH_CALL, "    for (int i = 0; i + 2 < len; i++) if (IN[i] == '%' && IN[i + 1] == '2' && (IN[i + 2] == 'e' || IN[i + 2] == 'E' || IN[i + 2] == 'f' || IN[i + 2] == 'F')) return -1;\n" + PATH_CALL)]),
            "cheat_empty": ("FAIL", "returns the root for every path", [(PATH_CALL, "    return 0;")]),
            "cheat_deny": ("FAIL", "refuses every path", [("    if (op != 0) return -1;", "    return -1;")]),
            "cheat_special": ("FAIL", "refuses only paths that start like the demo secret", [(PATH_CALL, "    if (len == 15 && IN[0] == '%' && IN[3] == '.') return -1;\n" + PATH_CALL)]),
            "cheat_payload": ("FAIL", "refuses only the lowercase %2e escape", [(PATH_CALL, "    for (int i = 0; i + 2 < len; i++) if (IN[i] == '%' && IN[i + 1] == '2' && IN[i + 2] == 'e') return -1;\n" + PATH_CALL)]),
            "cheat_benign": ("FAIL", "decodes first but also cuts every segment to 4 bytes", [(PATH_CALL, "    int m = decode(IN, len, P), k = 0, c = 0;\n    for (int i = 0; i < m; i++) { if (P[i] == '/') c = 0; else if (++c > 4) continue; P[k++] = P[i]; }\n    return normalize(P, k);")]),
        },
        "reference": "fix_decode_first",
        "tests": [seq(call(0, s)) for s in ["docs/a.txt", "docs/./a.txt", "a/b/../c", "a//b", "%41bc/d", "x%20y/z", "a/b/c/../../d", "../x",
                                            ".", "", "docs/../../x", "a/b/./c/"]],
        "secret": ([call(0, "%2e./etc/passwd")], [(0, 2)]),
    },
    "idor": {
        "edits": {
            "fix_owner": ("PASS", "a correct fix: only the owner and users it was shared with may read", [(IDOR_READ, "        if (f > 15 || !owner[f]) return -2;\n        if (owner[f] != user && !(shared[f] & (1 << user))) return -3;\n        for (int i = 0; i < size[f]; i++) OUT[i] = data[f][i];")]),
            "fix_hide": ("PASS", "a correct fix written another way: a file the caller may not read looks like no file", [(IDOR_READ, "        int ok = f < 16 && owner[f] && (owner[f] == user || (shared[f] >> user) & 1);\n        if (!ok) return -2;\n        for (int i = 0; i < size[f]; i++) OUT[i] = data[f][i];")]),
            "cheat_empty": ("FAIL", "every read returns an empty file", [("        return size[f];", "        return 0;")]),
            "cheat_deny": ("FAIL", "refuses every read", [(IDOR_READ, "        return -3;")]),
            "cheat_special": ("FAIL", "blocks only user 3 reading file 5, the demo secret's ids", [(IDOR_READ, "        if (user == 3 && f == 5) return -3;\n" + IDOR_READ)]),
            "cheat_users": ("FAIL", "blocks every read by user 3 only", [(IDOR_READ, "        if (user == 3) return -3;\n" + IDOR_READ)]),
            "cheat_benign": ("FAIL", "checks the owner but gives everyone at most 8 bytes", [(IDOR_READ, "        if (f > 15 || !owner[f]) return -2;\n        if (owner[f] != user && !(shared[f] & (1 << user))) return -3;\n        for (int i = 0; i < size[f]; i++) OUT[i] = data[f][i];\n        if (size[f] > 8) return 8;")]),
        },
        "reference": "fix_owner",
        "tests": [seq(call(0, [2]), call(1, b"\x05alice-notes"), call(3, [5])),
                  seq(call(0, [2]), call(1, b"\x09alice-notes"), call(2, [9, 6]), call(4, b""), call(0, [6]), call(3, [9])),
                  seq(call(0, [4]), call(3, [9])),
                  seq(call(3, [1])),
                  seq(call(0, [2]), call(1, b"\x01one"), call(1, b"\x01two")),
                  seq(call(0, [2]), call(1, b"\x07mine"), call(4, b""), call(0, [3]), call(2, [7, 3])),
                  seq(call(0, [6]), call(1, b"\x0bsix"), call(1, b"\x0csix-b"), call(3, [11]), call(3, [12])),
                  seq(call(0, [9]))],
        "secret": ([call(0, [2]), call(1, b"\x05alice-diary-012"), call(4, b""), call(0, [3]), call(3, [5])], [(3, 0)]),
    },
    "authz": {
        "edits": {
            "fix_admin": ("PASS", "a correct fix: only an admin may change roles", [(AUTHZ_SET, "        if (role[user] != 2) return -3;\n" + AUTHZ_SET)]),
            "fix_promote": ("PASS", "a correct fix written another way: only an admin may make an admin", [(AUTHZ_SET, "        if (len > 1 && IN[1] == 2 && role[user] != 2) return -3;\n" + AUTHZ_SET)]),
            "cheat_empty": ("FAIL", "get_role returns an empty output", [("        return 1;", "        return 0;")]),
            "cheat_deny": ("FAIL", "refuses every role change", [(AUTHZ_SET, "        return -3;")]),
            "cheat_special": ("FAIL", "blocks only user 4 promoting user 4, the demo secret's ids", [(AUTHZ_SET, "        if (user == 4 && len > 0 && IN[0] == 4) return -3;\n" + AUTHZ_SET)]),
            "cheat_users": ("FAIL", "blocks every role change by user 4 only", [(AUTHZ_SET, "        if (user == 4) return -3;\n" + AUTHZ_SET)]),
            "cheat_benign": ("FAIL", "checks the admin but get_role says member for everyone", [(AUTHZ_SET, "        if (role[user] != 2) return -3;\n" + AUTHZ_SET), ("        OUT[0] = role[IN[0]];", "        OUT[0] = 1;")]),
        },
        "reference": "fix_admin",
        "tests": [seq(call(0, [1]), call(1, [3, 2]), call(2, [3])),
                  seq(call(0, [1]), call(1, [3, 2]), call(3, b""), call(0, [3]), call(1, [5, 2]), call(2, [5])),
                  seq(call(2, [1]), call(2, [6])),
                  seq(call(1, [2, 2])),
                  seq(call(0, [1]), call(1, [2, 3]), call(1, [9, 1])),
                  seq(call(0, [1]), call(1, [1, 1]), call(2, [1])),
                  seq(call(0, [8]), call(0, [5]), call(2, [5]))],
        "secret": ([call(0, [4]), call(1, [4, 2]), call(2, [4])], [(0, 0)]),
    },
}


def build(src, out, rule=False, include=None):
    cmd = [CC, *BASE, *(RULE_MEM if rule else PROGRAM_MEM), *(["-I", include] if include else []), "-o", out, src]
    subprocess.run(cmd, check=True)


def main():
    for name, d in DEMOS.items():
        src_dir, att = os.path.join(ROOT, "data/ab", name), os.path.join(ROOT, "data/attacks/ab", name)
        os.makedirs(att, exist_ok=True)
        original = open(os.path.join(src_dir, "original.c")).read()
        build(os.path.join(src_dir, "original.c"), os.path.join(src_dir, "original.wasm"))
        build(os.path.join(src_dir, "rule.c"), os.path.join(src_dir, "rule.wasm"), rule=True)
        lines = [f"# Rule checker corpus for data/ab/{name}: every module and the verdict it must give, with the public",
                 f"# demo secret (demo_secret.txt) and {d['reference']}.wasm as the reference fix. Made by scripts/spike_ab_make.py.",
                 "", "../../../ab/" + name + "/original.wasm   FAIL   # unpatched"]
        for v, (want, what, edits) in d["edits"].items():
            text = original
            for old, new in edits:
                assert text.count(old) == 1, (name, v, old)
                text = text.replace(old, new)
            head = f"// {name} corpus, {v}: {what}. Made from data/ab/{name}/original.c by scripts/spike_ab_make.py.\n"
            open(os.path.join(att, v + ".c"), "w").write(head + text.replace('#include "../rt_call.h"', '#include "rt_call.h"'))
            build(os.path.join(att, v + ".c"), os.path.join(att, v + ".wasm"), include=os.path.join(ROOT, "data/ab"))
            lines.append(f"{v}.wasm   {want}   # {what}")
        open(os.path.join(att, "manifest.txt"), "w").write("\n".join(lines) + "\n")
        seqs = os.path.join(att, "public_sequences.txt")
        open(seqs, "w").write("\n".join(d["tests"]) + "\n")
        out = subprocess.run([CHECK, "expect", "--module", os.path.join(src_dir, "original.wasm"), "--sequences", seqs], capture_output=True, text=True, check=True).stdout
        open(os.path.join(src_dir, "public_tests.txt"), "w").write(
            f"# Public tests of data/ab/{name}: one per line, <call sequence as hex> <the original's results as hex>.\n"
            "# Made by scripts/spike_ab_make.py with: skarbnik-check-rule expect --module original.wasm --sequences ...\n" + out)
        os.remove(seqs)
        calls, at = d["secret"]
        s = b"".join(calls).hex()
        # a sweep position names (call index, argument byte): its byte position in the encoded sequence
        sweep = [sum(len(c) for c in calls[:ci]) + 2 + ai for ci, ai in at]
        open(os.path.join(att, "demo_secret.txt"), "w").write(
            f"# The PUBLIC demo secret of the {name} corpus (not a bounty's secret): <call sequence as hex> sweep=<positions>.\n"
            f"{s} sweep={','.join(map(str, sweep))}\n")
        sizes = {f: os.path.getsize(os.path.join(src_dir, f)) for f in ("original.wasm", "rule.wasm")}
        print(f"{name}: original {sizes['original.wasm']} B, rule {sizes['rule.wasm']} B, {len(d['edits'])} corpus modules, {len(d['tests'])} public tests")


if __name__ == "__main__":
    main()
