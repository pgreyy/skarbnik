#!/usr/bin/env python3
# The Skarbnik agent driven by a language model. It reads feed.json, picks an open bounty, downloads the bounty's public
# code and checks it against the hashes on chain, asks the model for a fix, builds the fix and runs the public tests
# locally, then commits and reveals it with a limited key (commit and reveal only), and records each attempt so it can
# watch for the verdict later. Dry run is the default: everything happens except sending transactions; --live sends.
# Safety: the key must be a function call key limited to commit and reveal on this contract; the fee must be within the
# config's max fee and the account's on-chain limits; the payout must be the fixed payout; a run stops after
# max_attempts commits. The model's API key is read from an environment variable or a file outside the repository and
# is never printed or logged. Standard library only (Python 3.11+); signing uses near-cli-rs with the key file.
# Usage, from the repo root:
#   python3 -I agent/skarbnik_agent.py run [--live] [--bounty ID] [--provider NAME] [--config FILE] [--max-attempts N]
#       [--watch-minutes M]   (after a reveal, wait up to M minutes for the verdict; after a FAIL, try the bounty again)
#   python3 -I agent/skarbnik_agent.py status [--config FILE]
import argparse
import base64
import datetime
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
import tomllib
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD_FLAGS = ["--edition", "2021", "--target", "wasm32-unknown-unknown", "--crate-type", "cdylib", "-C", "opt-level=z",
               "-C", "panic=abort", "-C", "strip=symbols", "-C", "codegen-units=1", "-C", "target-cpu=mvp",
               "-C", "link-arg=-zstack-size=8192", "-C", "link-arg=--initial-memory=131072",
               "-C", "link-arg=--max-memory=131072"]
# Source that could read local files or the environment at build time is refused: the built patch is published on
# chain at reveal, so it must not be able to carry anything from this machine.
FORBIDDEN = re.compile(r"\b(include_bytes|include_str|include|env|option_env)\s*!|\bextern\s+crate\b|\bmod\s+\w+\s*;"
                       r"|#\s*!?\s*\[\s*path\b")
YOCTO = 10 ** 24


def utc(ns=None):
    t = datetime.datetime.now(datetime.UTC) if ns is None else datetime.datetime.fromtimestamp(int(ns) / 1e9, datetime.UTC)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def near(yocto):
    return (f"{int(yocto) / YOCTO:.6f}".rstrip("0").rstrip(".")) + " NEAR"


def sha(b):
    return hashlib.sha256(b).hexdigest()


class Log:
    """The plain run log: one line per event, in <run dir>/run.log, also printed. Never given a key."""

    def __init__(self, path, redact):
        self.path, self.redact = path, redact

    def __call__(self, *parts):
        line = f"{utc()} " + " ".join(str(p) for p in parts)
        for s in self.redact:
            if s:
                line = line.replace(s, "[api key]")
        print(line, flush=True)
        with open(self.path, "a") as f:
            f.write(line + "\n")


# ---- chain (read only views, and sending a transaction signed by near-cli) ----

class Chain:
    def __init__(self, rpc, contract):
        self.rpc, self.contract = rpc, contract

    def call(self, method, params, timeout=120):
        body = json.dumps({"jsonrpc": "2.0", "id": "agent", "method": method, "params": params}).encode()
        for attempt in range(4):
            try:
                req = urllib.request.Request(self.rpc, body, {"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return json.load(r)
            except OSError:
                if attempt == 3:
                    raise
                time.sleep(3)

    def view(self, method, args):
        r = self.call("query", {"request_type": "call_function", "finality": "final", "account_id": self.contract,
                                "method_name": method, "args_base64": base64.b64encode(json.dumps(args).encode()).decode()})
        if "result" not in r or "result" not in r["result"]:
            raise RuntimeError(f"view {method} failed: {json.dumps(r)[:300]}")
        return json.loads(bytes(r["result"]["result"]).decode())

    def access_key(self, account, public_key):
        r = self.call("query", {"request_type": "view_access_key", "finality": "final", "account_id": account,
                                "public_key": public_key})
        return r.get("result")

    def send(self, signed_b64):
        r = self.call("send_tx", {"signed_tx_base64": signed_b64, "wait_until": "FINAL"}, timeout=180)
        res = r.get("result") or {}
        st = res.get("status", {})
        out = {"tx": (res.get("transaction") or {}).get("hash"), "ok": bool(res) and "Failure" not in st}
        for o in res.get("receipts_outcome", []):
            if "Failure" in o["outcome"]["status"]:
                out["ok"] = False
        if "SuccessValue" in st:
            raw = base64.b64decode(st["SuccessValue"]).decode()
            out["value"] = json.loads(raw) if raw else None
        if not out["ok"]:
            m = re.search(r"Smart contract panicked: ([^\"\\]+)", json.dumps(r))
            out["error"] = m.group(1) if m else json.dumps(r.get("error") or st)[:300]
        return out


def sign(cfg, method, args, run_dir):
    """Signs one call with the limited key file through near-cli-rs, into a file; returns the base64 transaction."""
    signed = os.path.join(run_dir, f"signed_{method}.json")
    if os.path.exists(signed):
        os.remove(signed)
    cmd = ["near", "contract", "call-function", "as-transaction", cfg["contract"], method, "json-args", json.dumps(args),
           "prepaid-gas", "100 Tgas", "attached-deposit", "0 NEAR", "sign-as", cfg["account"], "network-config",
           cfg["network"], "sign-with-access-key-file", secret_file(cfg["limited_key_file"]), "save-to-file", signed]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=180, env=clean_env())
    if p.returncode != 0 or not os.path.exists(signed):
        tail = [l for l in (p.stdout + p.stderr).splitlines() if not re.search(r"private|secret|signature|[1-9A-HJ-NP-Za-km-z]{80,}", l, re.I)]
        raise RuntimeError(f"near-cli could not sign {method}: " + " | ".join(tail[-4:])[:400])
    b64 = json.load(open(signed))["signed_transaction_as_base64"]
    os.remove(signed)
    return b64


def clean_env():
    """The environment for child programs: no model API key, nothing but what they need."""
    keep = {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "TERM") if k in os.environ}
    for k in os.environ:
        if k.startswith(("RUSTUP_", "CARGO_HOME", "NEAR_CLI")):
            keep[k] = os.environ[k]
    return keep


# ---- the fingerprint, as in the contract and web/js/attempt.js ----

def fingerprint(patch, payout, nonce):
    p = payout.encode()
    return sha(b"kintsugi-commit-v1" + len(patch).to_bytes(4, "little") + patch + len(p).to_bytes(4, "little") + p + nonce)


# ---- the model ----

def secret_file(path):
    """A path for a file in the private secrets folder: ~/.skarbnik-secrets first; if that file does not exist there,
    the same file in the folder's earlier name ~/.kintsugi-secrets (the project was built as Kintsugi). Never reads it."""
    p = os.path.expanduser(path or "")
    old = os.path.expanduser("~/.kintsugi-secrets") + p[len(os.path.expanduser("~/.skarbnik-secrets")):]
    if p.startswith(os.path.expanduser("~/.skarbnik-secrets")) and not os.path.exists(p) and os.path.exists(old):
        return old
    return p


def api_key(pcfg):
    """The API key, from the environment variable or the key file named in the config. Never printed."""
    v = os.environ.get(pcfg.get("api_key_env", ""), "").strip()
    if v:
        return v
    f = secret_file(pcfg.get("api_key_file", ""))
    if f and os.path.isfile(f):
        if os.path.realpath(f).startswith(os.path.realpath(ROOT) + os.sep):
            raise RuntimeError("the API key file is inside the repository; move it outside (see agent/README.md)")
        return open(f).read().strip()
    raise RuntimeError(f"no API key: set {pcfg.get('api_key_env')} or create {pcfg.get('api_key_file')} (see agent/README.md)")


def ask_model(pcfg, messages, key):
    if pcfg["type"] == "standin":
        # A stand-in for tests: answers with a fixed file (by default the bounty's known reference fix).
        return "```rust\n" + open(os.path.join(ROOT, pcfg["response_file"])).read() + "```\n", {"model": "standin"}
    if pcfg["type"] != "openai-compatible":
        raise RuntimeError(f"unknown provider type {pcfg['type']}")
    stream = bool(pcfg.get("stream", False))
    req_body = {"model": pcfg["model"], "messages": messages, "temperature": pcfg.get("temperature", 0.2),
                "max_tokens": pcfg.get("max_tokens", 4000)}
    if stream:
        # Streamed: the answer arrives piece by piece, so a long think does not hit a gateway's idle time limit.
        req_body.update(stream=True, stream_options={"include_usage": True})
    url = pcfg["base_url"].rstrip("/") + "/chat/completions"
    req = urllib.request.Request(url, json.dumps(req_body).encode(),
                                 {"Content-Type": "application/json", "Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=pcfg.get("timeout_s", 300)) as r:
            d = read_stream(r, t_end=time.time() + pcfg.get("timeout_s", 300)) if stream else json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"the model API answered HTTP {e.code}: {e.read()[:300].decode(errors='replace')}")
    ch = d["choices"][0]
    # A reasoning model may spend its whole budget thinking and return no answer; finish_reason then says "length".
    return ch["message"].get("content") or "", {"model": d.get("model", pcfg["model"]), "usage": d.get("usage"),
                                                "finish": ch.get("finish_reason"), "raw": d}


def read_stream(r, t_end):
    """Reads a streamed chat completion (server-sent events) into the same shape as a plain answer."""
    content, reasoning, finish, usage, model = [], [], None, None, None
    for raw in r:
        if time.time() > t_end:
            raise TimeoutError("the streamed answer took longer than timeout_s")
        line = raw.decode(errors="replace").strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        ev = json.loads(data)
        model = ev.get("model") or model
        usage = ev.get("usage") or usage
        for ch in ev.get("choices") or []:
            delta = ch.get("delta") or {}
            content.append(delta.get("content") or "")
            reasoning.append(delta.get("reasoning_content") or "")
            finish = ch.get("finish_reason") or finish
    return {"model": model, "usage": usage, "choices": [{"finish_reason": finish, "message": {
        "role": "assistant", "content": "".join(content), "reasoning_content": "".join(reasoning)}}]}


def prompt(source, tests, build, b, history=()):
    system = ("You fix one crash bug in a small Rust program that is compiled to WebAssembly. The input that makes it "
              "crash is secret. Return the complete fixed source file in one ```rust code block and nothing else.")
    user = f"""This program crashes (traps) on a secret input. Find the bug and fix it.

Rules for the fix:
- Every input on which the original does not crash must give exactly the same result as before.
- Keep the interface: input_buf() -> i32 and parse(len: i32) -> i32, #![no_std], no imports, no other crates.
- Change as little as possible. The built module must be at most {b['max_patch_bytes']} bytes.
- Every public test below must still give its value.

How it is built:
{build}
Public tests:
{tests}
Source (original.rs):
```rust
{source}```
"""
    for h in history:
        # Only what the chain says: the fix was revealed and the checker's verdict on the secret input was FAIL.
        user += f"""
An earlier fix for this program was checked against the secret input and the verdict was FAIL (it still crashes on
the secret input, or it changed a result it must keep). Do not send the same fix again. That fix was:
```rust
{h['source']}```
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def extract_rust(text):
    m = re.findall(r"```(?:rust|rs)?\s*\n(.*?)```", text, re.S)
    return (max(m, key=len) if m else text).strip() + "\n"


# ---- building and testing a fix locally ----

def parse_tests(text):
    out = []
    for line in text.splitlines():
        f = line.split("#")[0].split()
        if f:
            out.append(("" if f[0] == "-" else f[0], int(f[1])))
    return out


def corpus_hash(tests):
    b = b""
    for h, v in tests:
        d = bytes.fromhex(h)
        b += len(d).to_bytes(4, "little") + d + v.to_bytes(4, "little", signed=True)
    return sha(b)


def build(src_path, out_path):
    p = subprocess.run(["rustc", *BUILD_FLAGS, "-o", out_path, src_path], capture_output=True, text=True, timeout=300,
                       env=clean_env(), cwd=os.path.dirname(src_path))
    return p.returncode == 0, (p.stderr or "")[-1500:]


def run_tests(checker, module, tests):
    fails = []
    for h, want in tests:
        p = subprocess.run([checker, "run", "--module", module, "--input", h or ""], capture_output=True, text=True,
                           timeout=60, env=clean_env(), cwd=ROOT)
        m = re.search(r"returned (-?\d+)", p.stdout)
        got = int(m.group(1)) if m else None
        if got != want:
            fails.append(f"input {h or '-'}: expected {want}, got {got if got is not None else (p.stdout + p.stderr).strip()[:80]}")
    return fails


# ---- feed and public code ----

def fetch(base, rel):
    """Reads a file from the feed's location: an http(s) address or a local path."""
    if re.match(r"https?://", base):
        with urllib.request.urlopen(urllib.parse.urljoin(base, rel), timeout=60) as r:
            return r.read()
    return open(os.path.join(os.path.dirname(os.path.join(ROOT, base)), rel), "rb").read()


def load_config(path):
    cfg = tomllib.load(open(path, "rb"))
    a = cfg["agent"]
    a["providers"] = cfg.get("provider", {})
    return a


# ---- one attempt ----

def attempt(cfg, chain, b_feed, log, run_dir, live, pname, key, k=1, history=()):
    bid = str(b_feed["bounty_id"])
    log(f"== bounty {bid}: level {b_feed['level']}, {b_feed['bounty_amount']}, next fee {b_feed['next_fee']}, "
        f"{b_feed['slots_left']} of {b_feed['max_commits']} slots free")
    b = chain.view("get_bounty", {"bounty_id": bid})
    pc = b_feed.get("public_code")
    if not pc:
        return log(f"skip bounty {bid}: the feed names no public code for it")
    # 1. checks before anything is spent: preflight (shared with people), the agent's own limits, the key
    env = dict(clean_env(), RPC=cfg["rpc"], MAX_FEE=str(cfg["max_fee_yocto"]))
    pf = subprocess.run([os.path.join(ROOT, "scripts/agent_preflight.sh"), cfg["contract"], bid, cfg["payout"],
                         cfg["account"]], capture_output=True, text=True, timeout=180, env=env, cwd=ROOT)
    for line in pf.stdout.strip().splitlines():
        log("  preflight:", line)
    if pf.returncode != 0:
        return log(f"skip bounty {bid}: preflight refused")
    fee = int(b["next_fee"])
    lim = chain.view("get_agent_limits", {"account_id": cfg["account"]})
    if cfg.get("require_onchain_limits", True) and (lim.get("max_fee_per_commit") is None or lim.get("fixed_payout") is None):
        if live:
            return log(f"stop: {cfg['account']} has no on-chain agent limits (set_agent_limits); refusing to send")
        log(f"  note: {cfg['account']} has no on-chain agent limits; a live run would refuse")
    if lim.get("fixed_payout") not in (None, cfg["payout"]):
        return log(f"stop: payout {cfg['payout']} is not the fixed payout {lim['fixed_payout']}")
    if fee > int(cfg["max_fee_yocto"]):
        return log(f"skip bounty {bid}: fee {near(fee)} is above max_fee {near(cfg['max_fee_yocto'])}")
    # 2. the public code, checked against the hashes on chain
    source = fetch(cfg["feed"], pc["source"]).decode()
    module = fetch(cfg["feed"], pc["module"])
    tests_text = fetch(cfg["feed"], pc["tests"]).decode()
    build_text = fetch(cfg["feed"], pc["build"]).decode()
    tests = parse_tests(tests_text)
    if sha(module) != b["original_hash"] or corpus_hash(tests) != b["corpus_hash"]:
        return log(f"skip bounty {bid}: the public code does not match the bounty's original_hash or corpus_hash")
    for name, data in (("original.rs", source.encode()), ("original.wasm", module), ("public_tests.txt", tests_text.encode())):
        open(os.path.join(run_dir, name), "wb").write(data)
    ok, err = build(os.path.join(run_dir, "original.rs"), os.path.join(run_dir, "original_rebuilt.wasm"))
    same = ok and sha(open(os.path.join(run_dir, "original_rebuilt.wasm"), "rb").read()) == b["original_hash"]
    log(f"  public code: module sha256 {sha(module)[:16]}... = original_hash, {len(tests)} public tests = corpus_hash, "
        f"source rebuilds to the same module: {'yes' if same else 'no'}")
    # 3. ask the model, build, test; retry with the errors, at most max_model_tries times
    pcfg = cfg["providers"][pname]
    tag = f"{bid}_a{k}"
    messages = prompt(source, tests_text, build_text, b, history)
    open(os.path.join(run_dir, f"prompt_{tag}.txt"), "w").write("\n\n".join(f"[{m['role']}]\n{m['content']}" for m in messages))
    log(f"  prompt: {len(messages[1]['content'])} characters, saved as prompt_{tag}.txt ({len(history)} earlier FAIL fix(es) included); provider {pname} ({pcfg['type']}, "
        f"model {pcfg.get('model', '-')})")
    patch = None
    for t in range(1, int(cfg["max_model_tries"]) + 1):
        t0 = time.time()
        try:
            reply, meta = ask_model(pcfg, messages, key)
        except (RuntimeError, OSError, KeyError, ValueError) as e:
            reply, meta = "", {"model": pcfg.get("model"), "finish": f"call failed: {type(e).__name__}: {e}"[:200]}
        open(os.path.join(run_dir, f"reply_{tag}_{t}.txt"), "w").write(reply)
        if "raw" in meta:
            json.dump(meta.pop("raw"), open(os.path.join(run_dir, f"response_{tag}_{t}.json"), "w"), indent=1)
        src = extract_rust(reply)
        src_path = os.path.join(run_dir, f"fix_{tag}_{t}.rs")
        open(src_path, "w").write(src)
        log(f"  model try {t}: {round(time.time() - t0, 1)} s, model {meta.get('model')}, finish {meta.get('finish') or '-'}, "
            f"usage {meta.get('usage') or '-'}")
        problem = None
        if not reply.strip():
            problem = f"the model returned no answer (finish reason {meta.get('finish')})"
        elif FORBIDDEN.search(src):
            problem = "the source uses include!, env!, extern crate, mod or #[path]; these are not allowed"
        else:
            ok, err = build(src_path, src_path[:-3] + ".wasm")
            if not ok:
                problem = "it does not compile:\n" + err
        if not problem:
            wasm = open(src_path[:-3] + ".wasm", "rb").read()
            fails = run_tests(cfg["checker"], src_path[:-3] + ".wasm", tests)
            log(f"  fix: sha256 {sha(wasm)}, {len(wasm)} bytes; public tests {len(tests) - len(fails)} of {len(tests)} pass")
            if len(wasm) > b["max_patch_bytes"]:
                problem = f"the module is {len(wasm)} bytes, above the limit of {b['max_patch_bytes']}"
            elif sha(wasm) == b["original_hash"]:
                problem = "the module is identical to the original"
            elif sha(wasm) in {h["patch_sha256"] for h in history}:
                problem = "the module is the same as an earlier fix that got FAIL on the secret input"
            elif fails:
                problem = "public tests fail:\n" + "\n".join(fails[:8])
            else:
                patch = wasm
                break
        log(f"  try {t} not used: {problem.splitlines()[0]}")
        messages = messages + [{"role": "assistant", "content": reply},
                               {"role": "user", "content": f"That fix cannot be used: {problem}\nReturn the complete fixed file again."}]
    if patch is None:
        return log(f"skip bounty {bid}: no usable fix after {cfg['max_model_tries']} tries; nothing sent")
    # 4. commit and reveal (dry run: show what would be sent)
    nonce = secrets.token_bytes(32)
    fp = fingerprint(patch, cfg["payout"], nonce)
    commit_args = {"bounty_id": bid, "fingerprint": fp, "payout": cfg["payout"]}
    rec = {"bounty_id": bid, "account": cfg["account"], "payout": cfg["payout"], "fingerprint": fp,
           "patch_sha256": sha(patch), "patch_bytes": len(patch), "fee": str(fee), "nonce": nonce.hex(),
           "patch_file": os.path.relpath(src_path[:-3] + ".wasm", ROOT),
           "source_file": os.path.relpath(src_path, ROOT), "live": live, "run_dir": os.path.relpath(run_dir, ROOT)}
    if not live:
        log(f"  DRY RUN: would commit {json.dumps(commit_args)} as {cfg['account']} with the limited key (fee {near(fee)})")
        log(f"  DRY RUN: would then reveal the {len(patch)} byte patch with its nonce; nothing sent")
        return "dry"
    log(f"  commit: fingerprint {fp}, fee {near(fee)}")
    r = chain.send(sign(cfg, "commit", commit_args, run_dir))
    log(f"  commit tx {r['tx']}: {'ok, index ' + str(r.get('value')) if r['ok'] else 'refused: ' + r.get('error', '')}")
    if not r["ok"] or r.get("value") is None:
        return log(f"  bounty {bid}: no slot taken" + ("" if r["ok"] else "; nothing more sent"))
    rec.update(index=r["value"], commit_tx=r["tx"])
    save_attempt(cfg, rec)
    time.sleep(int(b["reveal_gap_ns"]) / 1e9 + 2)
    rv = {"bounty_id": bid, "index": rec["index"], "patch": base64.b64encode(patch).decode(), "nonce": nonce.hex()}
    r = chain.send(sign(cfg, "reveal", rv, run_dir))
    log(f"  reveal tx {r['tx']}: {'ok' if r['ok'] else 'refused: ' + r.get('error', '')}")
    rec.update(reveal_tx=r["tx"], revealed=r["ok"])
    save_attempt(cfg, rec)
    return "sent" if r["ok"] else "committed"


def state_path(cfg):
    return os.path.join(ROOT, cfg["state_dir"], "attempts.json")


def load_attempts(cfg):
    try:
        return json.load(open(state_path(cfg)))
    except (OSError, ValueError):
        return []


def save_attempt(cfg, rec):
    allr = [a for a in load_attempts(cfg) if not (a["bounty_id"] == rec["bounty_id"] and a.get("index") == rec.get("index"))]
    allr.append(rec)
    os.makedirs(os.path.dirname(state_path(cfg)), exist_ok=True)
    with open(state_path(cfg), "w") as f:
        json.dump(allr, f, indent=1)
    os.chmod(state_path(cfg), 0o600)


def check_key(cfg, chain, log):
    """The key must be a function call key for this contract, limited to commit and reveal."""
    kf = secret_file(cfg["limited_key_file"])
    if not os.path.isfile(kf):
        raise RuntimeError(f"limited key file {cfg['limited_key_file']} not found (see agent/README.md)")
    pub = json.load(open(kf))["public_key"]
    ak = chain.access_key(cfg["account"], pub)
    perm = (ak or {}).get("permission")
    fc = perm.get("FunctionCall") if isinstance(perm, dict) else None
    if not fc or fc.get("receiver_id") != cfg["contract"] or not set(fc.get("method_names") or ["*"]) <= {"commit", "reveal"} \
            or not fc.get("method_names"):
        raise RuntimeError(f"the key {pub[:16]}... of {cfg['account']} is not a key limited to commit and reveal on "
                           f"{cfg['contract']} (permission: {'full access' if perm == 'FullAccess' else perm})")
    log(f"key {pub[:16]}... of {cfg['account']}: limited to {', '.join(fc['method_names'])} on {fc['receiver_id']}, "
        f"allowance {near(fc['allowance']) if fc.get('allowance') else 'none set'}")


def earlier(cfg, chain, bid):
    """This account's sent attempts on a bounty, each with its state on chain (FAIL, PASS or waiting) and its source."""
    out = []
    for a in load_attempts(cfg):
        if a.get("live") and a["bounty_id"] == bid and a["account"] == cfg["account"] and a.get("index") is not None:
            s = chain.view("get_submission", {"bounty_id": bid, "index": a["index"]})
            state = s["verdict"] or ("waiting" if s["outcome"] == "Open" else s["outcome"])
            src = os.path.join(ROOT, a.get("source_file", ""))
            out.append({"index": a["index"], "state": state, "patch_sha256": a["patch_sha256"],
                        "source": open(src).read() if a.get("source_file") and os.path.isfile(src) else "(source not kept)\n"})
    return out


def wait_verdict(cfg, chain, bid, log, minutes):
    """After a reveal: waits up to `minutes` for the verdict of this account's newest attempt; returns PASS, FAIL or None."""
    recs = [a for a in load_attempts(cfg) if a["bounty_id"] == bid and a["account"] == cfg["account"] and a.get("index") is not None]
    idx = max(a["index"] for a in recs)
    log(f"  waiting up to {minutes} min for the verdict of bounty {bid} attempt {idx} (the vendor proves it against the secret input)")
    t_end = time.time() + minutes * 60
    while time.time() < t_end:
        s = chain.view("get_submission", {"bounty_id": bid, "index": idx})
        if s["verdict"] or s["outcome"] != "Open":
            log(f"  verdict of bounty {bid} attempt {idx}: {s['verdict'] or '-'}, outcome {s['outcome']}")
            return s["verdict"]
        time.sleep(60)
    log(f"  no verdict for bounty {bid} attempt {idx} after {minutes} min; stopping")
    return None


def cmd_run(cfg, args):
    live = args.live
    pname = args.provider or cfg["provider"]
    pcfg = cfg["providers"][pname]
    key = api_key(pcfg) if pcfg["type"] != "standin" else ""
    stamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")
    run_dir = os.path.join(ROOT, cfg["state_dir"], f"run-{stamp}{'-live' if live else '-dry'}")
    os.makedirs(run_dir, exist_ok=True)
    log = Log(os.path.join(run_dir, "run.log"), [key])
    chain = Chain(cfg["rpc"], cfg["contract"])
    cap = int(args.max_attempts or cfg["max_attempts"])
    log(f"Skarbnik agent: {'LIVE' if live else 'DRY RUN (nothing is sent)'}, contract {cfg['contract']} ({cfg['network']}), "
        f"account {cfg['account']}, payout {cfg['payout']}, max fee {near(cfg['max_fee_yocto'])}, "
        f"max attempts {cap}, run folder {os.path.relpath(run_dir, ROOT)}")
    if cfg["network"] != "testnet" and not cfg.get("allow_mainnet"):
        return log("stop: this agent is set up for testnet only")
    try:
        check_key(cfg, chain, log)
    except RuntimeError as e:
        if live:
            return log(f"stop: {e}")
        log(f"note: {e}; a live run would stop here")
    feed = json.loads(fetch(cfg["feed"], os.path.basename(cfg["feed"])) if re.match(r"https?://", cfg["feed"])
                      else open(os.path.join(ROOT, cfg["feed"])).read())
    if feed["contract"] != cfg["contract"]:
        return log(f"stop: the feed is for {feed['contract']}, not {cfg['contract']}")
    log(f"feed: {len(feed['open_bounties'])} open bounties, made {feed['generated_at_utc']}")
    picks = [b for b in feed["open_bounties"] if args.bounty is None or str(b["bounty_id"]) == str(args.bounty)]
    if args.bounty is None:
        picks = [b for b in picks if not b.get("test_bounty") or cfg.get("include_test_bounties")]
        picks.sort(key=lambda b: (-float(b["bounty_amount"].split()[0]), int(b["next_fee_yocto"])))
    if not picks:
        log("no bounty to try" + (f" (bounty {args.bounty} is not open in the feed)" if args.bounty else ""))
    sent = 0
    for b in picks:
        bid = str(b["bounty_id"])
        while True:
            if sent >= cap:
                log(f"stop: max attempts {cap} reached")
                break
            history = earlier(cfg, chain, bid)
            if any(h["state"] != "FAIL" for h in history):
                log(f"skip bounty {bid}: this account has an attempt on it that passed or still waits for its verdict")
                break
            if len(history) >= cap:
                log(f"skip bounty {bid}: this account already has {len(history)} attempts on it (the cap is {cap})")
                break
            try:
                r = attempt(cfg, chain, b, log, run_dir, live, pname, key, len(history) + 1, history)
            except RuntimeError as e:
                log(f"error on bounty {bid}: {e}")
                r = None
            if r in ("dry", "sent", "committed"):
                sent += 1
            if r != "sent" or not args.watch_minutes:
                break
            if wait_verdict(cfg, chain, bid, log, int(args.watch_minutes)) != "FAIL":
                break
        if sent >= cap:
            break
    log(f"done: {sent} attempt(s) {'sent' if live else 'prepared (dry run)'}. Check verdicts later with: "
        f"python3 -I agent/skarbnik_agent.py status")


def cmd_status(cfg, args):
    chain = Chain(cfg["rpc"], cfg["contract"])
    recs = [a for a in load_attempts(cfg) if a.get("index") is not None]
    if not recs:
        print("no sent attempts recorded")
    for a in recs:
        s = chain.view("get_submission", {"bounty_id": a["bounty_id"], "index": a["index"]})
        print(f"bounty {a['bounty_id']} attempt {a['index']}: outcome {s['outcome']}, verdict {s['verdict'] or 'none yet'}, "
              f"revealed {'yes' if s['revealed_at_ns'] else 'no'}, deadline {utc(s['deadline_ns']) if s['deadline_ns'] else '-'}, "
              f"commit tx {a.get('commit_tx')}, reveal tx {a.get('reveal_tx')}")


def main():
    ap = argparse.ArgumentParser(description="Skarbnik agent driven by a language model (testnet).")
    ap.add_argument("command", choices=["run", "status"])
    ap.add_argument("--config", default=os.path.join(ROOT, "agent/config.toml"))
    ap.add_argument("--live", action="store_true", help="send transactions (default: dry run, nothing is sent)")
    ap.add_argument("--bounty", help="try only this bounty id")
    ap.add_argument("--provider", help="model provider name from the config")
    ap.add_argument("--max-attempts", type=int, help="commits in this run, at most (default: max_attempts in the config)")
    ap.add_argument("--watch-minutes", type=int, default=0,
                    help="after a reveal, wait this long for the verdict, and after a FAIL try the same bounty again")
    args = ap.parse_args()
    cfg = load_config(args.config)
    for k in ("checker",):
        cfg[k] = os.path.join(ROOT, cfg[k])
    if not shutil.which("rustc") or not os.path.isfile(cfg["checker"]):
        sys.exit("needs rustc with the wasm32-unknown-unknown target and the local checker (cargo build -p kintsugi-check)")
    try:
        (cmd_run if args.command == "run" else cmd_status)(cfg, args)
    except RuntimeError as e:
        sys.exit(f"stop: {e}")


if __name__ == "__main__":
    main()
