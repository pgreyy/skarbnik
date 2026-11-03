#!/usr/bin/env python3
# skarbnik-vendor-mcp: an MCP server (stdio, JSON-RPC 2.0, one message per line) that lets an AI app run the vendor
# tool tools/skarbnik-vendor for the vendor, on the vendor's own computer (the secret must stay there, so this is never
# a hosted link). Tools: init, check, prove0, publish, watch_init, watch_start, watch_stop, watch_status, status, job_status.
# Tools take file PATHS only: this server never opens, reads, returns, prints or logs the secret input, the reference
# fix, a salt, a seed or a key; it passes paths to the vendor tool and filters what comes back. Spending steps are two
# step: publish (the reward and gas), watch_start and, in GPU mode, prove0 (a rented GPU) first return what will be
# spent and how long it takes, with a one time confirm code; they only run when called again with that code, after the
# vendor said yes. watch keeps the vendor tool's own GPU spend cap. Long steps run as jobs (job_status follows them).
# `--setup <app>` prints the settings for Claude Desktop, Claude Code or Codex with this computer's paths. Python 3.9
# or later, standard library only (the vendor tool itself needs Python 3.11 or later). Testnet only.
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import time

VERSION = "0.2.0"
HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.expanduser(os.environ.get("SKARBNIK_VENDOR_MCP_HOME", "~/.skarbnik-vendor-mcp"))
CODE_TTL = 900  # a confirm code lasts 15 minutes and works once


class Fail(Exception):
    """A refusal or error in plain words; returned to the client as a tool error."""


def log(msg):
    print(f"skarbnik-vendor-mcp: {msg}", file=sys.stderr, flush=True)


def vendor_tool():
    path = os.path.expanduser(os.environ.get("SKARBNIK_VENDOR_TOOL", os.path.join(os.path.dirname(HERE), "skarbnik-vendor")))
    if not os.path.isfile(path):
        raise Fail(f"the vendor tool was not found at {path}: set SKARBNIK_VENDOR_TOOL")
    return path


def vendor_python():
    """The vendor tool needs Python 3.11 or later (tomllib)."""
    if os.environ.get("SKARBNIK_VENDOR_PYTHON"):
        return os.environ["SKARBNIK_VENDOR_PYTHON"]
    return sys.executable if sys.version_info >= (3, 11) else "python3"


def state_dir():
    os.makedirs(STATE, mode=0o700, exist_ok=True)
    return STATE


# ---------- a small reader for the vendor tool's TOML files (sections, arrays of tables, strings, numbers, lists) ----------

def read_toml(path):
    data, cur = {}, None
    with open(os.path.expanduser(path)) as f:
        for raw in f:
            line = raw.split("#", 1)[0].strip() if '"' not in raw.split("#", 1)[0] else raw.strip()
            if line.startswith("#") or not line:
                continue
            m = re.fullmatch(r"\[\[([\w.-]+)\]\]", line)
            if m:
                cur = {}
                data.setdefault(m.group(1), []).append(cur)
                continue
            m = re.fullmatch(r"\[([\w.-]+)\]", line)
            if m:
                cur = data.setdefault(m.group(1), {})
                continue
            m = re.fullmatch(r'([\w-]+)\s*=\s*(.+?)\s*(#.*)?', line)
            if m and cur is not None:
                v = m.group(2)
                try:
                    cur[m.group(1)] = json.loads(v)
                except ValueError:
                    cur[m.group(1)] = v.strip('"')
    return data


def toml_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "[" + ", ".join(toml_value(x) for x in v) + "]"
    return json.dumps(str(v))


# ---------- what comes back from the vendor tool: no keys, no secrets ----------

SAFE_DROP = re.compile(r"private|secret.?key|seed.?phrase|mnemonic|signature|api.?key|BEGIN [A-Z ]*KEY", re.I)


def clean(text, limit=6000):
    out = []
    for line in re.sub(r"\x1b\[[0-9;]*m", "", text).splitlines():
        if SAFE_DROP.search(line):
            continue
        line = re.sub(r"ed25519:[1-9A-HJ-NP-Za-km-z]{60,}", "ed25519:[hidden]", line)
        line = re.sub(r"[1-9A-HJ-NP-Za-km-z]{80,}", "[hidden]", line)
        out.append(line)
    s = "\n".join(out).strip()
    return s if len(s) <= limit else "[earlier lines cut]\n" + s[-limit:]


# ---------- jobs: long steps run in the background; their output goes to a file in the state folder ----------

def job_env():
    """The vendor tool's programs: the repository's bin folder (skarbnik-host, r0vm, near on a prover machine) and
    ~/.cargo/bin come first on the PATH, as tools/vendor-service/run-watch.sh does for watch."""
    root = os.path.dirname(os.path.dirname(vendor_tool()))
    extra = [d for d in (os.path.join(root, "bin"), os.path.expanduser("~/.cargo/bin")) if os.path.isdir(d)]
    return dict(os.environ, PATH=os.pathsep.join(extra + [os.environ.get("PATH", "/usr/bin:/bin")]))


def start_job(args, label):
    jid = f"{label}-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
    path = os.path.join(state_dir(), f"{jid}.log")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    p = subprocess.Popen([vendor_python(), vendor_tool()] + args, stdout=fd, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         cwd=os.path.dirname(os.path.dirname(vendor_tool())), start_new_session=True, env=job_env())
    os.close(fd)
    with open(os.path.join(state_dir(), f"{jid}.json"), "w") as f:
        json.dump({"pid": p.pid, "args": args[:1], "started": time.time()}, f)
    JOBS[jid] = p
    return jid


JOBS = {}


def job_result(jid, wait=40):
    meta_path = os.path.join(state_dir(), f"{jid}.json")
    if not re.fullmatch(r"[\w.-]+", jid or "") or not os.path.isfile(meta_path):
        raise Fail(f"no job {jid}")
    p = JOBS.get(jid)
    deadline = time.time() + wait
    while p is not None and p.poll() is None and time.time() < deadline:
        time.sleep(1)
    with open(os.path.join(state_dir(), f"{jid}.log"), errors="replace") as f:
        text = f.read()
    meta = json.load(open(meta_path))
    running = p.poll() is None if p is not None else pid_alive(meta["pid"])
    out = {"job": jid, "running": running, "minutes": round((time.time() - meta["started"]) / 60, 1), "output": clean(text)}
    if not running and p is not None:
        out["exit"] = p.returncode
        out["ok"] = p.returncode == 0 and "REFUSED" not in text
    if running:
        out["next"] = f"still running: call job_status with job {jid} in a minute or two"
    return out


def pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


# ---------- one time confirm codes for steps that spend ----------

CODES = {}


def new_code(action, key):
    code = "-".join(secrets.token_hex(2) for _ in range(2))
    CODES[code] = (action, key, time.time() + CODE_TTL)
    return code


def take_code(code, action, key):
    entry = CODES.pop(code or "", None)
    if not entry or entry[0] != action or entry[1] != key or entry[2] < time.time():
        raise Fail(f"that confirm code is not valid for this {action} (wrong, used or older than 15 minutes): call {action} again without a code for a new one")


def config_path(p):
    path = os.path.abspath(os.path.expanduser(p or ""))
    if not os.path.isfile(path):
        raise Fail(f"no config file at {path}")
    return path


# ---------- tools ----------

def t_init(a):
    """Writes a bounty config through `skarbnik-vendor init --from <paths only> --yes`."""
    out = os.path.abspath(os.path.expanduser(a["out_path"]))
    mode = a.get("prover_mode", "gpu")
    if mode not in ("gpu", "cpu"):
        raise Fail("prover_mode is gpu or cpu")
    level = int(a.get("level", 2))
    if level not in (0, 1, 2):
        raise Fail("level is 0, 1 or 2 (default 2)")
    fuzz, variants = int(a.get("fuzz_count", 16)), int(a.get("variants", 32))
    if not (1 <= fuzz <= 64 and 1 <= variants <= 64):
        raise Fail("fuzz_count and variants are 1 to 64 (default 16 and 32); a smaller check is faster to prove and tests less")
    cfg = {
        "bounty": {"name": a["name"], "module": a.get("module", "data/demo"), "reward_near": str(a["reward_near"]), "k": int(a.get("k", 1)), "level": level,
                   "attempt_fee_near": str(a.get("attempt_fee_near", "0.01")), "fee_step_near": str(a.get("fee_step_near", "0.005")),
                   "reveal_gap_s": int(a.get("reveal_gap_s", 60)), "reveal_window_s": int(a.get("reveal_window_s", 3600)),
                   "verdict_window_h": int(a.get("verdict_window_h", 24)), "expiry_h": int(a.get("expiry_h", 96)),
                   "max_patch_bytes": int(a.get("max_patch_bytes", 1024)), "fuzz_count": fuzz, "variants": variants, "po2": int(a.get("po2", 18))},
        "secrets": {"secret": a["secret_input_path"], "reference_fix": a["reference_fix_path"]},
        "prover": {"mode": mode, "machine": a.get("machine", "this-computer"), "workdir": a.get("workdir", f"~/skarbnik-vendor/{a['name']}"), "min_avail_mib": 300},
        "chain": {"network": "testnet", "contract": "kintsugi-l2-cihdp.testnet", "rpc_urls": ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
                  "image_id": "dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc", "vendor_account": a["vendor_account"]},
    }
    paths = {k: a[f"path_{k}"] for k in ("host", "check", "near") if a.get(f"path_{k}")}
    if paths:
        cfg["paths"] = paths
    if mode == "gpu" and a.get("gpu_budget_usd") is not None:
        cfg["gpu"] = {"budget_usd": float(a["gpu_budget_usd"])}
    lines = []
    for sec, vals in cfg.items():
        lines.append(f"[{sec}]")
        lines += [f"{k} = {toml_value(v)}" for k, v in vals.items()]
        lines.append("")
    fd, tmp = tempfile.mkstemp(prefix="init-", suffix=".toml", dir=state_dir())
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines))
    try:
        p = subprocess.run([vendor_python(), vendor_tool(), "init", "--from", tmp, "--out", out, "--yes"], capture_output=True, text=True, timeout=120)
    finally:
        os.remove(tmp)
    text = clean(p.stdout + p.stderr)
    if p.returncode != 0:
        raise Fail(text or "init failed")
    return {"config": out, "output": text, "next": f"call check with config_path {out}"}


def t_check(a):
    return job_result(start_job(["check", "--config", config_path(a["config_path"])], "check"), wait=float(a.get("wait_seconds", 40)))


def gpu_note(level=2):
    """level None: a watch, whose bounties may have any level."""
    tail = ("then the Groth16 wrap on this computer, about 5 minutes" if level == 2 else
            "then, for a Level 2 bounty only, the Groth16 wrap on this computer, about 5 minutes; a Level 1 bounty's succinct proof goes to OutLayer"
            if level is None else
            "no Groth16 step at this level: the succinct proof goes to OutLayer (Level 1) or to the verifiers (Level 0)")
    return ("one rented GPU for this step: about 1 to 11 minutes (11 when the GPU build of the prover is made "
            "for the first time), about $0.04 to $0.20; " + tail)


def t_prove0(a):
    path = config_path(a["config_path"])
    cfg = read_toml(path)
    mode = cfg.get("prover", {}).get("mode", "cpu")
    if mode == "gpu":
        if not a.get("confirm_code"):
            return {"needs_yes": True, "what": f"Proof 0 of bounty {cfg['bounty']['name']} spends GPU rental: {gpu_note(int(cfg['bounty'].get('level', 2)))}",
                    "gpu_budget_usd": cfg.get("gpu", {}).get("budget_usd", 6.0),
                    "confirm_code": new_code("prove0", path),
                    "next": "ask the vendor; after a clear yes, call prove0 again with this confirm_code"}
        take_code(a["confirm_code"], "prove0", path)
        made = make_salt(cfg)
    else:
        made = None
    jid = start_job(["prove0", "--config", path], "prove0")
    out = job_result(jid, wait=float(a.get("wait_seconds", 30)))
    if made:
        out["salt"] = "made for this bounty in ~/.kintsugi-salts (never read or shown here)"
    return out


def make_salt(cfg):
    """GPU Proof 0 needs the bounty's salt on this computer; skarbnik-host makes it on first use. One run of the checker
    without proving (execute) makes it. The salt is never opened here."""
    name = cfg["bounty"]["name"]
    if os.path.exists(os.path.expanduser(f"~/.kintsugi-salts/{name}.salt")):
        return False
    root = os.path.dirname(os.path.dirname(vendor_tool()))
    module = cfg["bounty"]["module"] if os.path.isabs(cfg["bounty"]["module"]) else os.path.join(root, cfg["bounty"]["module"])
    host = os.path.expanduser(cfg.get("paths", {}).get("host", os.path.join(root, "target/release/skarbnik-host")))
    p = subprocess.run([host, "execute", os.path.expanduser(cfg["secrets"]["reference_fix"]), "--proof0", "--exploit", os.path.expanduser(cfg["secrets"]["secret"]),
                        "--bounty", name, "--original", f"{module}/original.wasm", "--tests", f"{module}/public_tests.txt", "--fuzz-count", "4", "--variants", "4"],
                       capture_output=True, text=True, timeout=900, cwd=root)
    # skarbnik-host makes the salt before it runs the checker; on a machine without the guest files (one that only
    # wraps proofs) the run itself then stops, which is fine here: only the salt is needed.
    if not os.path.exists(os.path.expanduser(f"~/.kintsugi-salts/{name}.salt")):
        raise Fail("could not make the bounty's salt: " + clean(p.stdout + p.stderr, 600))
    return True


def t_publish(a):
    path = config_path(a["config_path"])
    if not a.get("confirm_code"):
        r = job_result(start_job(["check", "--config", path], "publish-preview"), wait=240)
        cfg = read_toml(path)
        b = cfg.get("bounty", {})
        out = {"needs_yes": True, "preview": r["output"],
               "spends": f"the reward ({b.get('reward_near')} NEAR, locked in the contract) plus a little gas, from {cfg.get('chain', {}).get('vendor_account')}; testnet only"
                         + ("; Level 1 also holds the contract's min_deposit (about 2.8 NEAR) while OutLayer checks Proof 0, returned less OutLayer's fee (about 0.0011 NEAR)" if int(b.get("level", 2)) == 1 else ""),
               "time": "two transactions, under a minute"}
        refusals = [l.strip()[2:] for l in r.get("output", "").split("REFUSED:", 1)[-1].splitlines() if l.strip().startswith("- ")] if "REFUSED:" in r.get("output", "") else []
        work = os.path.expanduser(cfg.get("prover", {}).get("workdir", ""))
        memory_only = bool(refusals) and all("not enough memory here" in x for x in refusals) and os.path.isfile(os.path.join(work, "verify_p0.txt"))
        if memory_only:
            # The memory check is for the Groth16 wrap. Proof 0 is already made (on another machine, as in the
            # project's own setup), and publishing needs no proving here, so this refusal does not apply to it.
            out["note"] = ("the preflight's only refusal is this computer's memory for the Groth16 wrap; Proof 0 is already made, "
                           "and publishing proves nothing here, so it can go ahead. Prove attempts on a machine with enough memory.")
        elif r.get("running") or not r.get("ok"):
            out.update(needs_yes=False, note="the preflight did not pass (or is still running): no confirm code until it passes", job=r["job"])
            return out
        out["confirm_code"] = new_code("publish", path)
        out["next"] = "show the preview to the vendor; after a clear yes, call publish again with this confirm_code"
        return out
    take_code(a["confirm_code"], "publish", path)
    return job_result(start_job(["publish", "--config", path, "--yes"], "publish"), wait=120)


def t_watch_init(a):
    """Writes a watch config for one published bounty from its bounty config (paths only, nothing is opened)."""
    src = read_toml(config_path(a["bounty_config_path"]))
    out = os.path.abspath(os.path.expanduser(a["out_path"]))
    if os.path.exists(out):
        raise Fail(f"{out} exists already; choose another out_path")
    b, pr, ch = src["bounty"], src.get("prover", {}), src.get("chain", {})
    base = os.path.splitext(out)[0]
    w = {"watch": {"state": base + "_state.json", "log": base + ".log", "workdir": base + "-work", "poll_s": 60},
         "prover": {"mode": pr.get("mode", "cpu"), "machine": pr.get("machine", "this-computer"), "min_avail_mib": 300},
         "chain": {"network": a.get("network", "testnet-fastnear"), "contract": ch.get("contract", "kintsugi-l2-cihdp.testnet"),
                   "rpc_urls": ch.get("rpc_urls", ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"]),
                   "image_id": ch.get("image_id"), "submit_account": a["submit_account"]}}
    if pr.get("mode") == "gpu":
        w["gpu"] = dict(src.get("gpu", {}))
    if src.get("paths"):
        w["paths"] = src["paths"]
    lines = []
    for sec, vals in w.items():
        lines.append(f"[{sec}]")
        lines += [f"{k} = {toml_value(v)}" for k, v in vals.items()]
        lines.append("")
    lines += ["[[bounties]]", f"name = {toml_value(b['name'])}", f"ids = [{int(a['bounty_id'])}]", f"module = {toml_value(b['module'])}",
              f"secret = {toml_value(src['secrets']['secret'])}", f"po2 = {int(b.get('po2', 18))}", ""]
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("# skarbnik-vendor watch config, written by skarbnik-vendor-mcp. Keep it outside the repository.\n" + "\n".join(lines))
    return {"watch_config": out, "bounty_id": str(a["bounty_id"]), "next": f"call watch_start with config_path {out}"}


def watch_files(path):
    w = read_toml(path)
    sw = w.get("watch", {})
    return w, os.path.expanduser(sw.get("log", "~/skarbnik-vendor/watch.log")), os.path.join(state_dir(), "watch-" + re.sub(r"\W", "_", path) + ".pid")


def t_watch_start(a):
    path = config_path(a["config_path"])
    w, logf, pidf = watch_files(path)
    if os.path.exists(pidf) and pid_alive(int(open(pidf).read() or 0)):
        return {"running": True, "note": "watch already runs for this config", "pid_file": pidf}
    ids = [str(i) for e in w.get("bounties", []) for i in e.get("ids", [])]
    if not a.get("confirm_code"):
        g = w.get("gpu", {})
        spend_file = os.path.expanduser(g.get("spend_file", "~/skarbnik-vendor/gpu_spend.json"))
        spent = 0.0
        if os.path.exists(spend_file):
            spent = round(sum(float(x.get("cost_usd") or 0) for x in json.load(open(spend_file)).get("pods", [])), 4)
        mode = w.get("prover", {}).get("mode", "cpu")
        return {"needs_yes": True, "watches_bounties": ids, "prover_mode": mode,
                "spends": (f"for each revealed attempt, {gpu_note(None)}. Spend cap: ${g.get('budget_usd', 6.0)} in all; spent so far ${spent}. "
                           "At the cap no new GPU starts" if mode == "gpu" else "this computer's time; no rental")
                          + ". On a Level 1 bounty each check also holds the contract's min_deposit (about 2.8 NEAR) from the submit account while OutLayer works, returned less about 0.011 NEAR",
                "time": ("from a reveal to the submitted proof, about 17 minutes in the measured GPU run (bounty 32)" if mode == "gpu" else
                         "this computer's proving time for each attempt (the check's preview shows the measured time); one attempt at a time"),
                "confirm_code": new_code("watch_start", path),
                "next": "ask the vendor; after a clear yes, call watch_start again with this confirm_code"}
    take_code(a["confirm_code"], "watch_start", path)
    out_path = os.path.join(state_dir(), "watch-" + re.sub(r"\W", "_", path) + ".out")
    fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    p = subprocess.Popen([vendor_python(), vendor_tool(), "watch", "--config", path], stdout=fd, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         cwd=os.path.dirname(os.path.dirname(vendor_tool())), start_new_session=True, env=job_env())
    os.close(fd)
    with open(pidf, "w") as f:
        f.write(str(p.pid))
    time.sleep(3)
    return {"running": p.poll() is None, "pid": p.pid, "watches_bounties": ids, "log": logf,
            "next": "watch proves each revealed attempt and submits the proof; follow it with watch_status, stop it with watch_stop"}


def t_watch_stop(a):
    path = config_path(a["config_path"])
    _, _, pidf = watch_files(path)
    if not os.path.exists(pidf):
        return {"stopped": False, "note": "no watch was started for this config by this server"}
    pid = int(open(pidf).read() or 0)
    try:
        cmdline = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="replace")
    except OSError:
        cmdline = ""
    if pid and pid_alive(pid) and "watch" in cmdline and path in cmdline:
        os.killpg(pid, signal.SIGTERM)
        for _ in range(20):
            if not pid_alive(pid):
                break
            time.sleep(0.5)
    os.remove(pidf)
    return {"stopped": not pid_alive(pid), "pid": pid}


def t_watch_status(a):
    path = config_path(a["config_path"])
    _, logf, pidf = watch_files(path)
    pid = int(open(pidf).read() or 0) if os.path.exists(pidf) else 0
    tail = ""
    if os.path.exists(logf):
        with open(logf, errors="replace") as f:
            tail = "".join(f.readlines()[-int(a.get("lines", 25)):])
    return {"running": bool(pid) and pid_alive(pid), "pid": pid or None, "log_tail": clean(tail)}


def t_status(a):
    path = config_path(a["config_path"])
    p = subprocess.run([vendor_python(), vendor_tool(), "status", "--config", path], capture_output=True, text=True, timeout=300,
                       cwd=os.path.dirname(os.path.dirname(vendor_tool())), env=job_env())
    return {"output": clean(p.stdout + p.stderr)}


def t_job_status(a):
    return job_result(a["job"], wait=float(a.get("wait_seconds", 20)))


S = {"type": "string"}
TOOLS = {
    "init": (t_init, "Write a new bounty config from the vendor's answers. Takes file PATHS only: the secret input and the reference fix are never opened. Ask the vendor for each detail.",
             {"out_path": {"type": "string", "description": "where to write the config (outside the repository)"}, "name": {"type": "string", "description": "short bounty name (also names its salt)"},
              "module": {"type": "string", "description": "folder with original.wasm and public_tests.txt (default data/demo)"}, "secret_input_path": S, "reference_fix_path": S,
              "vendor_account": S, "reward_near": S, "k": {"type": "integer"}, "attempt_fee_near": S, "fee_step_near": S, "reveal_gap_s": {"type": "integer"},
              "reveal_window_s": {"type": "integer"}, "verdict_window_h": {"type": "integer"}, "expiry_h": {"type": "integer"}, "prover_mode": {"type": "string", "description": "gpu or cpu"},
              "level": {"type": "integer", "description": "2 (default): the contract checks a Groth16 proof itself; 1: the contract trusts OutLayer running the pinned verifier program, no Groth16 step, about 0.011 NEAR per check and about 2.8 NEAR held and returned; 0: registered verifiers, run by the project"},
              "fuzz_count": {"type": "integer", "description": "fresh inputs from the fairness seed in each check, 1 to 64 (default 16)"},
              "variants": {"type": "integer", "description": "near copies of the secret input in each check, 1 to 64 (default 32)"},
              "machine": S, "workdir": S, "gpu_budget_usd": {"type": "number"}, "path_host": S, "path_check": S, "path_near": S},
             ["out_path", "name", "secret_input_path", "reference_fix_path", "vendor_account", "reward_near"]),
    "check": (t_check, "The preflight (skarbnik-vendor check): module, tests, that the original crashes on the secret, that the fix passes, memory, the checker id, the balance and the window rule, then a preview of fees, windows and time. Spends nothing.",
              {"config_path": S, "wait_seconds": {"type": "number"}}, ["config_path"]),
    "prove0": (t_prove0, "Proof 0: proves the reference fix passes the secret test, so agents know the bounty can be fixed. On a GPU this spends rental money: the first call returns what it costs and a confirm code; call again with the code after the vendor says yes.",
               {"config_path": S, "confirm_code": S, "wait_seconds": {"type": "number"}}, ["config_path"]),
    "publish": (t_publish, "Create and fund the bounty on testnet. Two steps: the first call runs the preflight and returns the preview, what is spent and a confirm code; call again with the code only after the vendor says yes.",
                {"config_path": S, "confirm_code": S}, ["config_path"]),
    "watch_init": (t_watch_init, "Write the watch config for a published bounty, from its bounty config (paths only). The submit account signs submit_groth16 with its own key on this computer.",
                   {"out_path": S, "bounty_config_path": S, "bounty_id": {"type": "string"}, "submit_account": S, "network": {"type": "string", "description": "near-cli connection for signing (default testnet-fastnear)"}},
                   ["out_path", "bounty_config_path", "bounty_id", "submit_account"]),
    "watch_start": (t_watch_start, "Start the auto prover for a watch config: it proves each revealed attempt and submits the proof. Two steps: the first call returns the GPU cost per attempt, the spend cap and a confirm code; call again with the code after the vendor says yes.",
                    {"config_path": S, "confirm_code": S}, ["config_path"]),
    "watch_stop": (t_watch_stop, "Stop the auto prover started for this watch config.", {"config_path": S}, ["config_path"]),
    "watch_status": (t_watch_status, "Whether the auto prover runs, and the last lines of its log (filtered).", {"config_path": S, "lines": {"type": "integer"}}, ["config_path"]),
    "status": (t_status, "Each watched bounty and attempt, its state and the next action (skarbnik-vendor status).", {"config_path": S}, ["config_path"]),
    "job_status": (t_job_status, "Follow a long step (check, prove0, publish) by its job id.", {"job": S, "wait_seconds": {"type": "number"}}, ["job"]),
}
SPENDS = {"publish", "watch_start", "prove0"}


def handle(msg):
    method, mid = msg.get("method"), msg.get("id")
    if method == "initialize":
        return {"protocolVersion": (msg.get("params") or {}).get("protocolVersion", "2025-06-18"), "capabilities": {"tools": {}},
                "serverInfo": {"name": "skarbnik-vendor", "version": VERSION},
                "instructions": "Hosts a private Skarbnik repair bounty on NEAR testnet with the vendor tool, on the vendor's own computer. Ask the vendor for each file path; never open, read out or print the secret input or the fix, only pass their paths. Order: init, check, prove0, publish, then watch_start. publish, watch_start and GPU prove0 return a confirm code first: show the cost and time, wait for a clear yes, then call again with the code."}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": [{"name": n, "description": d, "inputSchema": {"type": "object", "properties": p, "required": r},
                           "annotations": {"readOnlyHint": n in ("watch_status", "status", "job_status", "check"), "destructiveHint": False}}
                          for n, (_, d, p, r) in TOOLS.items()]}
    if method == "tools/call":
        p = msg.get("params") or {}
        name = p.get("name")
        if name not in TOOLS:
            return {"content": [{"type": "text", "text": f"unknown tool {name}"}], "isError": True}
        try:
            res = TOOLS[name][0](p.get("arguments") or {})
            return {"content": [{"type": "text", "text": json.dumps(res, indent=1)}], "isError": False}
        except Fail as e:
            return {"content": [{"type": "text", "text": str(e)}], "isError": True}
        except (KeyError, ValueError, OSError, subprocess.SubprocessError) as e:
            return {"content": [{"type": "text", "text": clean(f"{type(e).__name__}: {e}", 400)}], "isError": True}
    if mid is None:
        return None
    raise LookupError(method)


def setup_text(app):
    py, me = sys.executable, os.path.abspath(__file__)
    entry = {"command": py, "args": ["-I", me]}
    if app == "claude-desktop":
        return ("Claude Desktop: Settings, Developer, Edit Config opens claude_desktop_config.json. Paste this inside it, keeping "
                "anything already there (if it already has \"mcpServers\", add only the \"skarbnik-vendor\": {...} part, with a comma "
                "between it and the entry before it). Save, then quit Claude fully and open it again.\n\n"
                + json.dumps({"mcpServers": {"skarbnik-vendor": entry}}, indent=2))
    if app == "claude-code":
        return f'Run this once in a terminal:\n\nclaude mcp add --scope user skarbnik-vendor -- "{py}" -I "{me}"\n\nThen start claude; /mcp lists skarbnik-vendor.'
    if app == "codex":
        return ("Add this to the file .codex/config.toml in your home folder, then start Codex again:\n\n"
                f"[mcp_servers.skarbnik-vendor]\ncommand = '{py}'\nargs = ['-I', '{me}']")
    raise Fail("--setup takes one of: claude-desktop, claude-code, codex")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--setup":
        print(setup_text(sys.argv[2] if len(sys.argv) > 2 else ""))
        return
    log(f"started (version {VERSION})")
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        try:
            res = handle(msg)
            if msg.get("id") is None or res is None:
                continue
            out = {"jsonrpc": "2.0", "id": msg["id"], "result": res}
        except LookupError:
            out = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32601, "message": f"method not found: {msg.get('method')}"}}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Fail as e:
        print(f"skarbnik-vendor-mcp: {e}", file=sys.stderr)
        sys.exit(1)
