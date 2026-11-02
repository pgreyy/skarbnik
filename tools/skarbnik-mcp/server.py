#!/usr/bin/env python3
# skarbnik-mcp: an MCP server (stdio, JSON-RPC 2.0, one message per line) that lets an AI agent work on Skarbnik
# bounties with a key limited to commit and reveal. Tools: list_bounties, get_bounty, get_public_code, check_patch, build_patch,
# get_credit, commit, reveal, status. It reads the feed and the contract (view calls over RPC), checks a fix written as
# WebAssembly text with the site's keyless check (web/api/check.js, only the fix is sent), or builds one from Rust
# source with the local rustc and the bounty's build flags, builds the commit fingerprint exactly as the
# contract's commit_fingerprint, keeps each attempt's nonce in a file next to the key, and signs each transaction
# itself (Ed25519 and NEAR's transaction format, below) with the key file: SKARBNIK_KEY_FILE, or the one
# *.agent-key.json file in this script's folder or in Downloads (the file the site's Account page saves). It refuses any key that is
# not a function call key limited to commit and reveal on the contract. It never returns or logs the key or the nonce
# file's contents. `--setup <app>` prints the exact settings for Claude Desktop, Claude Code, Codex or Cursor, with
# this computer's paths (`--key <file>` adds the key file). Testnet by default; mainnet only with SKARBNIK_ALLOW_MAINNET=1. Python 3.9 or later,
# standard library only; Windows, macOS and Linux.
import base64
import glob
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

VERSION = "0.3.0"
NETWORKS = {
    "testnet": {"contract": "kintsugi-l2-cihdp.testnet", "rpc": ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
                "feed": "https://skarbnik.xyz/feed.json"},
    "mainnet": {"contract": None, "rpc": ["https://rpc.mainnet.near.org"], "feed": None},
}
PUBLISHED_IMAGE_ID = "dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc"
NONCE_FILE = "skarbnik-mcp-nonces.json"
HERE = os.path.dirname(os.path.abspath(__file__))
POSIX = os.name == "posix"
# The flags every Skarbnik program was built with (web/code/<program>/BUILD.txt); a patch is built the same way.
BUILD_FLAGS = ["--edition", "2021", "--target", "wasm32-unknown-unknown", "--crate-type", "cdylib", "-C", "opt-level=z",
               "-C", "panic=abort", "-C", "strip=symbols", "-C", "codegen-units=1", "-C", "target-cpu=mvp",
               "-C", "link-arg=-zstack-size=8192", "-C", "link-arg=--initial-memory=131072",
               "-C", "link-arg=--max-memory=131072"]
# Source that could read local files or the environment at build time is refused: the built patch is published on
# chain at reveal, so it must not be able to carry anything from this computer (as in agent/skarbnik_agent.py).
FORBIDDEN = re.compile(r"\b(include_bytes|include_str|include|env|option_env)\s*!|\bextern\s+crate\b|\bmod\s+\w+\s*;"
                       r"|#\s*!?\s*\[\s*path\b")


def log(msg):
    """Plain progress lines on stderr (the MCP client shows them as server logs). Never keys, nonces or patches."""
    print(f"skarbnik-mcp: {msg}", file=sys.stderr, flush=True)


class Fail(Exception):
    """A refusal or error explained in plain words; returned to the client as a tool error."""


# ---------- settings ----------

def settings():
    net = os.environ.get("SKARBNIK_NETWORK", "testnet")
    if net not in NETWORKS:
        raise Fail(f"SKARBNIK_NETWORK must be testnet or mainnet, not {net!r}")
    if net == "mainnet" and os.environ.get("SKARBNIK_ALLOW_MAINNET") != "1":
        raise Fail("mainnet is refused: set SKARBNIK_ALLOW_MAINNET=1 to allow it (real money)")
    d = NETWORKS[net]
    contract = os.environ.get("SKARBNIK_CONTRACT") or d["contract"]
    if not contract:
        raise Fail(f"no Skarbnik contract is known on {net}: set SKARBNIK_CONTRACT")
    rpc = [os.environ["SKARBNIK_RPC"]] if os.environ.get("SKARBNIK_RPC") else d["rpc"]
    return {"network": net, "contract": contract, "rpc": rpc, "feed": os.environ.get("SKARBNIK_FEED") or d["feed"],
            "near": os.environ.get("SKARBNIK_NEAR_CLI", "near"), "key_file": os.environ.get("SKARBNIK_KEY_FILE")}


def site_base(cfg):
    if not cfg["feed"]:
        raise Fail("no feed is known for this network: set SKARBNIK_FEED")
    return cfg["feed"].rsplit("/", 1)[0] + "/"


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": f"skarbnik-mcp/{VERSION}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def feed(cfg):
    return json.loads(fetch(cfg["feed"]))


KEY_DIRS = [HERE, os.path.join(os.path.expanduser("~"), "Downloads")]


def find_key_file(cfg):
    """SKARBNIK_KEY_FILE, or else the one *.agent-key.json file (the file the Account page saves) next to this script,
    or else in the Downloads folder."""
    if cfg["key_file"]:
        path = os.path.abspath(os.path.expanduser(cfg["key_file"]))
        if not os.path.isfile(path):
            raise Fail(f"the key file named in the settings does not exist: {path}")
        return path
    for folder in KEY_DIRS:
        found = sorted(glob.glob(os.path.join(folder, "*.agent-key.json")))
        if len(found) == 1:
            return found[0]
        if len(found) > 1:
            raise Fail(f"found more than one key file (.agent-key.json) in {folder}: keep one there, or name yours with --key "
                       "when you print the settings (or SKARBNIK_KEY_FILE)")
    raise Fail("found no key file: download it on the Account page (\"Download as a key file\"; its name ends in .agent-key.json) "
               f"into {KEY_DIRS[1]} or {KEY_DIRS[0]}, or name it with --key when you print the settings (or SKARBNIK_KEY_FILE)")


def key_info(cfg):
    """The account and public key of the limited key file. The private key is never kept, returned or logged."""
    path = find_key_file(cfg)
    if POSIX and os.stat(path).st_mode & 0o077:
        raise Fail(f"the key file is readable by other users: run chmod 600 {path}")
    with open(path) as f:
        d = json.load(f)
    acct, pub = d.get("account_id"), d.get("public_key")
    d.clear()
    if not pub:
        raise Fail("the key file has no public_key")
    # near-cli's legacy keychain keeps extra keys as <credentials>/<network>/<account>/ed25519_<public key>.json,
    # without account_id: the folder's name is the account.
    folder = os.path.basename(os.path.dirname(path))
    acct = os.environ.get("SKARBNIK_ACCOUNT") or acct or (folder if re.fullmatch(r"[a-z0-9._-]+\.(testnet|near)", folder) else None)
    if not acct:
        raise Fail("the key file has no account_id: set SKARBNIK_ACCOUNT")
    return path, acct, pub


# ---------- chain ----------

def rpc(cfg, method, params, timeout=60):
    body = json.dumps({"jsonrpc": "2.0", "id": "mcp", "method": method, "params": params}).encode()
    last = None
    for url in cfg["rpc"]:
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, body, {"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return json.load(r)
            except OSError as e:
                last = e
                time.sleep(2 * (attempt + 1))
    raise Fail(f"no RPC answered ({last})")


def view(cfg, method, args):
    r = rpc(cfg, "query", {"request_type": "call_function", "finality": "final", "account_id": cfg["contract"],
                           "method_name": method, "args_base64": base64.b64encode(json.dumps(args).encode()).decode()})
    res = r.get("result") or {}
    if "result" not in res:
        raise Fail(f"view {method} failed: {json.dumps(r.get('error') or res)[:300]}")
    return json.loads(bytes(res["result"]).decode())


def check_key(cfg, acct, pub):
    """Refuses unless the key is a function call key for this contract limited to commit and reveal."""
    r = rpc(cfg, "query", {"request_type": "view_access_key", "finality": "final", "account_id": acct, "public_key": pub})
    perm = (r.get("result") or {}).get("permission")
    if perm is None:
        raise Fail(f"the key {pub[:20]}... is not a key of {acct} on {cfg['network']}")
    fc = perm.get("FunctionCall") if isinstance(perm, dict) else None
    names = set((fc or {}).get("method_names") or [])
    if not fc or fc.get("receiver_id") != cfg["contract"] or not names or not names <= {"commit", "reveal"}:
        kind = "a full access key" if perm == "FullAccess" else f"not limited to commit and reveal on {cfg['contract']}"
        raise Fail(f"refused: the key {pub[:20]}... of {acct} is {kind}. Use a function call key limited to commit and reveal.")


# ---------- signing: Ed25519 (RFC 8032) and NEAR's transaction format (Borsh), standard library only ----------

_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_GY = 4 * pow(5, _P - 2, _P) % _P


def _recover_x(y):
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P) % _P
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P:
        x = x * pow(2, (_P - 1) // 4, _P) % _P
    return _P - x if x & 1 else x


_G = (_recover_x(_GY), _GY, 1, _recover_x(_GY) * _GY % _P)


def _add(a, b):
    x1, y1, z1, t1 = a
    x2, y2, z2, t2 = b
    A, B = (y1 - x1) * (y2 - x2) % _P, (y1 + x1) * (y2 + x2) % _P
    C, Dd = 2 * t1 * t2 * _D % _P, 2 * z1 * z2 % _P
    E, F, G, H = B - A, Dd - C, Dd + C, B + A
    return (E * F % _P, G * H % _P, F * G % _P, E * H % _P)


def _mul(k, pt):
    q = (0, 1, 1, 0)
    while k:
        if k & 1:
            q = _add(q, pt)
        pt, k = _add(pt, pt), k >> 1
    return q


def _enc(pt):
    zi = pow(pt[2], _P - 2, _P)
    x, y = pt[0] * zi % _P, pt[1] * zi % _P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def _expand(seed):
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], "little")
    a = (a & ((1 << 254) - 8)) | (1 << 254)
    return a, h[32:]


def ed25519_public(seed):
    return _enc(_mul(_expand(seed)[0], _G))


def ed25519_sign(seed, msg):
    a, prefix = _expand(seed)
    pub = _enc(_mul(a, _G))
    r = int.from_bytes(hashlib.sha512(prefix + msg).digest(), "little") % _L
    R = _enc(_mul(r, _G))
    k = int.from_bytes(hashlib.sha512(R + pub + msg).digest(), "little") % _L
    return R + ((r + k * a) % _L).to_bytes(32, "little")


_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58decode(s):
    n = 0
    for c in s:
        n = n * 58 + _B58.index(c)
    body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\0" * (len(s) - len(s.lstrip("1"))) + body


def b58encode(b):
    n, out = int.from_bytes(b, "big"), ""
    while n:
        n, r = divmod(n, 58)
        out = _B58[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + out


def _bstr(s):
    b = s.encode()
    return len(b).to_bytes(4, "little") + b


def function_call_tx(signer, pub, nonce, receiver, block_hash, method, args_json, gas, deposit=0):
    """A NEAR transaction (version 0) with one FunctionCall action, in Borsh."""
    action = (b"\x02" + _bstr(method) + len(args_json).to_bytes(4, "little") + args_json
              + gas.to_bytes(8, "little") + deposit.to_bytes(16, "little"))
    return (_bstr(signer) + b"\x00" + pub + nonce.to_bytes(8, "little") + _bstr(receiver) + block_hash
            + (1).to_bytes(4, "little") + action)


def read_seed(key_path, pub_text):
    """The 32 byte seed of the key file's private key, checked against its public key. Never returned to the client."""
    with open(key_path) as f:
        d = json.load(f)
    sk = d.get("private_key") or d.get("secret_key") or ""
    d.clear()
    if not sk.startswith("ed25519:"):
        raise Fail("the key file has no ed25519 private_key")
    seed = b58decode(sk.split(":", 1)[1])[:32]
    if "ed25519:" + b58encode(ed25519_public(seed)) != pub_text:
        raise Fail("the key file's private key does not match its public_key")
    return seed


def sign_builtin(cfg, key_path, acct, method, args):
    """Signs one call with the key file's private key: nonce from the access key, a recent final block hash."""
    _, _, pub_text = key_info(cfg)
    seed = read_seed(key_path, pub_text)
    ak = rpc(cfg, "query", {"request_type": "view_access_key", "finality": "final", "account_id": acct, "public_key": pub_text})
    if "result" not in ak or "nonce" not in ak["result"]:
        raise Fail(f"could not read the key's nonce: {json.dumps(ak.get('error') or ak)[:200]}")
    blk = rpc(cfg, "block", {"finality": "final"})["result"]["header"]["hash"]
    tx = function_call_tx(acct, b58decode(pub_text.split(":", 1)[1]), ak["result"]["nonce"] + 1, cfg["contract"],
                          b58decode(blk), method, json.dumps(args, separators=(",", ":")).encode(), 100 * 10 ** 12)
    sig = ed25519_sign(seed, hashlib.sha256(tx).digest())
    seed = None
    return base64.b64encode(tx + b"\x00" + sig).decode()


def sign_and_send(cfg, key_path, acct, method, args):
    """Signs (built in, or with near-cli-rs when SKARBNIK_NEAR_CLI is set), sends over RPC and reads the outcome."""
    if os.environ.get("SKARBNIK_NEAR_CLI"):
        b64 = sign_near_cli(cfg, key_path, acct, method, args)
    else:
        b64 = sign_builtin(cfg, key_path, acct, method, args)
    return send(cfg, b64)


def sign_near_cli(cfg, key_path, acct, method, args):
    """near-cli-rs signs with the key file into a temporary file."""
    with tempfile.TemporaryDirectory(prefix="skarbnik-mcp-") as d:
        signed = os.path.join(d, "signed.json")
        cmd = [cfg["near"], "contract", "call-function", "as-transaction", cfg["contract"], method, "json-args", json.dumps(args),
               "prepaid-gas", "100 Tgas", "attached-deposit", "0 NEAR", "sign-as", acct, "network-config", cfg["network"],
               "sign-with-access-key-file", key_path, "save-to-file", signed]
        env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG", "TERM") or k.startswith("NEAR_CLI")}
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=180, env=env)
        if p.returncode != 0 or not os.path.exists(signed):
            tail = [l for l in (p.stdout + p.stderr).splitlines() if l.strip() and not re.search(r"private|secret|signature|[1-9A-HJ-NP-Za-km-z]{80,}", l, re.I)]
            raise Fail(f"near-cli could not sign {method}: " + " | ".join(tail[-3:])[:300])
        with open(signed) as f:
            return json.load(f)["signed_transaction_as_base64"]


def send(cfg, b64):
    r = rpc(cfg, "send_tx", {"signed_tx_base64": b64, "wait_until": "FINAL"}, timeout=120)
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


# ---------- the fingerprint and the nonce file ----------

def fingerprint(patch, payout, nonce):
    """As commit_fingerprint in contract/src/lib.rs: sha256("kintsugi-commit-v1" || u32 LE len(patch) || patch ||
    u32 LE len(payout) || payout as UTF-8 || 32 byte nonce)."""
    p = payout.encode()
    return hashlib.sha256(b"kintsugi-commit-v1" + len(patch).to_bytes(4, "little") + patch + len(p).to_bytes(4, "little") + p + nonce).hexdigest()


def store_path(key_path):
    return os.path.join(os.path.dirname(key_path), NONCE_FILE)


def load_store(key_path):
    path = store_path(key_path)
    if not os.path.exists(path):
        return {}
    if POSIX and os.stat(path).st_mode & 0o077:
        raise Fail(f"{NONCE_FILE} is readable by other users: run chmod 600 {path}")
    with open(path) as f:
        return json.load(f)


def save_store(key_path, store):
    path = store_path(key_path)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".skarbnik-mcp-")
    with os.fdopen(fd, "w") as f:
        json.dump(store, f, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def public_record(rec):
    """An attempt record without its nonce."""
    return {k: v for k, v in rec.items() if k != "nonce"}


# ---------- tools ----------

def ns_utc(ns):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(ns) / 1e9))


def bounty_checks(cfg, b, acct=None):
    """The checks of AGENTS.md section 2 that can be read from the chain; each says ok or why not."""
    now = time.time_ns()
    out = {
        "open": b["state"] == "Open" and b["opened"],
        "level_2": b["level"] == 2,
        "published_checker": b["image_id_allowed"] and b["image_id"] == PUBLISHED_IMAGE_ID,
        "free_slot": b["active"] < b["max_commits"],
        "time_left": now + int(b["reveal_window_ns"]) + int(b["verdict_window_ns"]) <= int(b["expires_at_ns"]),
    }
    if acct:
        credit = int(view(cfg, "get_credit", {"account_id": acct}))
        limits = view(cfg, "get_agent_limits", {"account_id": acct})
        fee = int(b["next_fee"])
        out["credit_covers_fee"] = credit >= fee
        out["fee_within_limit"] = limits.get("max_fee_per_commit") is None or fee <= int(limits["max_fee_per_commit"])
        if b.get("max_commits_per_account") is not None:
            out["account_below_cap"] = view(cfg, "get_account_slots", {"bounty_id": str(b["id"]), "account_id": acct}) < b["max_commits_per_account"]
    out["ok_to_commit"] = all(out.values())
    return out


def t_list_bounties(cfg, a):
    base = site_base(cfg)
    f = feed(cfg)
    rows = [b for b in f["bounties"] if b.get("accepts_commits") or not a.get("only_open", True)]
    return {"feed": cfg["feed"], "generated_at_utc": f.get("generated_at_utc"),
            "note": "A snapshot; get_bounty reads the live state before you commit.",
            "bounties": [{"bounty_id": b["bounty_id"], "status": b["status"], "kind": b.get("kind"), "accepts_commits": b.get("accepts_commits"),
                          "reward": b.get("reward"), "next_fee": b.get("next_fee"), "max_commits": b.get("max_commits"),
                          "slots_in_use": b.get("slots_in_use"), "max_commits_per_account": b.get("max_commits_per_account"),
                          "max_patch_bytes": b.get("max_patch_bytes"), "windows": b.get("windows"), "target": b.get("target"),
                          "public_code": {k: base + v for k, v in (b.get("public_code") or {}).items() if k in ("source", "module", "tests", "build")}}
                         for b in rows]}


def t_get_bounty(cfg, a):
    b = view(cfg, "get_bounty", {"bounty_id": str(a["bounty_id"])})
    if b is None:
        raise Fail(f"no bounty {a['bounty_id']}")
    acct = None
    if cfg["key_file"]:
        acct = key_info(cfg)[1]
    keep = ("id", "state", "opened", "level", "amount", "max_commits", "active", "commits", "pending", "max_commits_per_account",
            "next_fee", "max_patch_bytes", "reveal_gap_ns", "reveal_window_ns", "verdict_window_ns", "expires_at_ns",
            "image_id", "image_id_allowed", "original_hash", "corpus_hash", "winner")
    return {"bounty": {k: b.get(k) for k in keep}, "expires_at_utc": ns_utc(b["expires_at_ns"]),
            "checks": bounty_checks(cfg, b, acct), "checks_for_account": acct}


def t_get_public_code(cfg, a):
    """The bounty's public code from the site, checked against the hashes on chain: source, build flags, public tests."""
    bid = str(a["bounty_id"])
    base = site_base(cfg)
    row = next((b for b in feed(cfg)["bounties"] if str(b["bounty_id"]) == bid), None)
    if not row or not row.get("public_code"):
        raise Fail(f"bounty {bid} has no public code in the feed")
    pc = row["public_code"]
    b = view(cfg, "get_bounty", {"bounty_id": bid})
    module = fetch(base + pc["module"])
    if hashlib.sha256(module).hexdigest() != b["original_hash"]:
        raise Fail(f"the public module of bounty {bid} does not match original_hash on chain; do not use it")
    tests = fetch(base + pc["tests"]).decode()
    try:
        wat = remote_check({"bounty_id": bid, "want": "original_wat"}).get("original_wat")
    except (Fail, OSError, ValueError):
        wat = None
    return {"bounty_id": bid, "program": pc.get("program"), "description": pc.get("description"), "target": row.get("target"),
            "max_patch_bytes": b["max_patch_bytes"], "original_module_bytes": len(module),
            "module_matches_chain": True, "source_file": base + pc["source"], "source": fetch(base + pc["source"]).decode(),
            "build": fetch(base + pc["build"]).decode(), "public_tests": tests, "original_wat": wat,
            "next": "change original_wat (the same program as WebAssembly text) to fix the bug the Rust source describes, then call "
                    "check_patch with the whole module as wat; keep the exports and every public test's answer. With Rust installed "
                    "you may write the fixed Rust file and call build_patch instead"}


CHECK_URL = os.environ.get("SKARBNIK_CHECK_URL", "https://skarbnik.xyz/api/check")


def remote_check(body):
    """The site's keyless check (web/api/check.js): assembles WebAssembly text and runs the public checks. Only the
    fix is sent, never the key."""
    req = urllib.request.Request(CHECK_URL, json.dumps(body).encode(), {"Content-Type": "application/json", "User-Agent": f"skarbnik-mcp/{VERSION}"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            msg = json.load(e).get("error")
        except ValueError:
            msg = None
        raise Fail(msg or f"the check service answered {e.code}")


def t_check_patch(cfg, a):
    """Checks a fix (WebAssembly text, or a .wasm file) with the site's check and saves the module next to the key."""
    bid = str(a["bounty_id"])
    if a.get("wat"):
        body = {"bounty_id": bid, "wat": a["wat"]}
    elif a.get("patch_path"):
        with open(os.path.expanduser(a["patch_path"]), "rb") as f:
            body = {"bounty_id": bid, "patch_base64": base64.b64encode(f.read()).decode()}
    else:
        raise Fail("give the whole fixed module as wat (WebAssembly text), or patch_path")
    r = remote_check(body)
    mod = base64.b64decode(r.pop("patch_base64"))
    try:
        folder = os.path.dirname(find_key_file(cfg))
    except Fail:
        folder = HERE
    work = os.path.join(folder, "work", f"bounty-{bid}")
    os.makedirs(work, exist_ok=True)
    path = os.path.join(work, f"patch-{hashlib.sha256(mod).hexdigest()[:10]}.wasm")
    with open(path, "wb") as f:
        f.write(mod)
    r["patch_path"] = path
    r["next"] = (f"tell the user the fee (get_bounty) and wait for a yes, then commit with patch_path {path}" if r.get("ready_to_commit")
                 else "fix the problems above and check again")
    return r


def rustc_path():
    """rustc on the PATH, or in ~/.cargo/bin (desktop apps often start without the user's PATH)."""
    exe = shutil.which("rustc")
    if exe:
        return exe
    home = os.path.join(os.path.expanduser("~"), ".cargo", "bin", "rustc.exe" if os.name == "nt" else "rustc")
    return home if os.path.isfile(home) else None


def t_build_patch(cfg, a):
    """Builds a patch from Rust source with the bounty's build flags; the .wasm is saved in work/ next to the key file."""
    bid, src = str(a["bounty_id"]), a["rust_source"]
    if FORBIDDEN.search(src):
        raise Fail("refused: the source uses include!, env!, extern crate, mod or #[path], which could put files from "
                   "this computer into a patch that becomes public; write the whole fix in one file without them")
    rustc = rustc_path()
    if not rustc:
        raise Fail("rustc was not found: install Rust from https://rustup.rs, then run: rustup target add wasm32-unknown-unknown")
    b = view(cfg, "get_bounty", {"bounty_id": bid})
    if b is None:
        raise Fail(f"no bounty {bid}")
    try:
        folder = os.path.dirname(find_key_file(cfg))
    except Fail:
        folder = HERE
    work = os.path.join(folder, "work", f"bounty-{bid}")
    os.makedirs(work, exist_ok=True)
    tag = hashlib.sha256(src.encode()).hexdigest()[:10]
    rs, wasm = os.path.join(work, f"patch-{tag}.rs"), os.path.join(work, f"patch-{tag}.wasm")
    with open(rs, "w", encoding="utf-8") as f:
        f.write(src)
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TEMP", "TMP", "LANG")
           or k.startswith(("RUSTUP_", "CARGO_HOME"))}
    env["PATH"] = os.path.dirname(rustc) + os.pathsep + env.get("PATH", "")
    p = subprocess.run([rustc] + BUILD_FLAGS + ["-o", wasm, rs], capture_output=True, text=True, timeout=300, env=env, cwd=work)
    if p.returncode != 0 or not os.path.isfile(wasm):
        err = p.stderr.strip()
        if "wasm32-unknown-unknown" in err and ("target may not be installed" in err or "can't find crate for `core`" in err):
            raise Fail("Rust cannot build for WebAssembly yet: run  rustup target add wasm32-unknown-unknown  once, then try again")
        return {"built": False, "errors": err[-3000:], "source_path": rs}
    with open(wasm, "rb") as f:
        mod = f.read()
    out = {"built": True, "patch_path": wasm, "bytes": len(mod), "sha256": hashlib.sha256(mod).hexdigest(),
           "max_patch_bytes": b["max_patch_bytes"], "fits": len(mod) <= b["max_patch_bytes"],
           "same_as_original": hashlib.sha256(mod).hexdigest() == b["original_hash"], "source_path": rs}
    out["next"] = ("too big for this bounty: make the fix smaller" if not out["fits"] else
                   "identical to the original module: change the code" if out["same_as_original"] else
                   f"check the fee with get_bounty, tell the user, then commit with patch_path {wasm}")
    return out


def t_get_credit(cfg, a):
    acct = a.get("account_id") or key_info(cfg)[1]
    return {"account_id": acct, "credit_yocto": view(cfg, "get_credit", {"account_id": acct}),
            "agent_limits": view(cfg, "get_agent_limits", {"account_id": acct})}


def t_commit(cfg, a):
    key_path, acct, pub = key_info(cfg)
    check_key(cfg, acct, pub)
    bid = str(a["bounty_id"])
    patch_path = os.path.abspath(os.path.expanduser(a["patch_path"]))
    with open(patch_path, "rb") as f:
        patch = f.read()
    b = view(cfg, "get_bounty", {"bounty_id": bid})
    if b is None:
        raise Fail(f"no bounty {bid}")
    if not patch or len(patch) > b["max_patch_bytes"]:
        raise Fail(f"the patch is {len(patch)} bytes; this bounty takes 1 to {b['max_patch_bytes']}")
    checks = bounty_checks(cfg, b, acct)
    if not checks["ok_to_commit"]:
        raise Fail("refused before sending: " + ", ".join(k for k, v in checks.items() if not v and k != "ok_to_commit"))
    payout = a.get("payout") or acct
    nonce = secrets.token_bytes(32)
    fp = fingerprint(patch, payout, nonce)
    store = load_store(key_path)
    rec = {"contract": cfg["contract"], "network": cfg["network"], "bounty_id": bid, "index": None, "account": acct, "payout": payout,
           "patch_path": patch_path, "patch_sha256": hashlib.sha256(patch).hexdigest(), "patch_len": len(patch),
           "fingerprint": fp, "nonce": nonce.hex(), "fee_yocto": b["next_fee"], "committed_at_utc": None, "commit_tx": None}
    store[f"pending:{fp}"] = rec
    save_store(key_path, store)          # the nonce is on disk before the commit is sent
    log(f"commit on bounty {bid}: fingerprint {fp[:12]}..., fee {b['next_fee']} yocto")
    r = sign_and_send(cfg, key_path, acct, "commit", {"bounty_id": bid, "fingerprint": fp, "payout": payout})
    store = load_store(key_path)
    rec = store.pop(f"pending:{fp}")
    if not r["ok"] or r.get("value") is None:
        save_store(key_path, store)
        return {"sent": True, "tx": r["tx"], "committed": False,
                "reason": r.get("error") or "the bounty had no free slot (the commit was ignored and cost nothing)"}
    rec.update(index=r["value"], committed_at_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), commit_tx=r["tx"])
    store[f"{cfg['contract']}/{bid}/{r['value']}"] = rec
    save_store(key_path, store)
    gap, win = int(b["reveal_gap_ns"]) / 1e9, int(b["reveal_window_ns"]) / 1e9
    return {"committed": True, "tx": r["tx"], "bounty_id": bid, "index": r["value"], "fingerprint": fp, "payout": payout,
            "fee_yocto": b["next_fee"], "reveal_after_seconds": gap, "reveal_within_seconds": win,
            "next": f"call reveal with bounty_id {bid} and index {r['value']} after {gap:.0f} s and within {win:.0f} s"}


def t_reveal(cfg, a):
    key_path, acct, pub = key_info(cfg)
    check_key(cfg, acct, pub)
    bid, idx = str(a["bounty_id"]), int(a["index"])
    rec = load_store(key_path).get(f"{cfg['contract']}/{bid}/{idx}")
    if not rec:
        raise Fail(f"no attempt {bid}/{idx} committed by this server for {acct}")
    with open(rec["patch_path"], "rb") as f:
        patch = f.read()
    if hashlib.sha256(patch).hexdigest() != rec["patch_sha256"]:
        raise Fail(f"the patch file {rec['patch_path']} changed since the commit; the reveal would not match the fingerprint")
    s = view(cfg, "get_submission", {"bounty_id": bid, "index": idx})
    b = view(cfg, "get_bounty", {"bounty_id": bid})
    if s.get("revealed_at_ns"):
        return {"revealed": True, "already": True, "revealed_at_utc": ns_utc(s["revealed_at_ns"])}
    wait = (int(s["committed_at_ns"]) + int(b["reveal_gap_ns"]) - time.time_ns()) / 1e9
    if wait > 0:
        return {"revealed": False, "wait_seconds": round(wait + 5), "reason": "the reveal gap has not passed yet; nothing was sent"}
    log(f"reveal on bounty {bid} attempt {idx}")
    r = sign_and_send(cfg, key_path, acct, "reveal", {"bounty_id": bid, "index": idx, "patch": base64.b64encode(patch).decode(),
                                                       "nonce": rec["nonce"]})
    if not r["ok"]:
        return {"revealed": False, "tx": r["tx"], "reason": r.get("error")}
    store = load_store(key_path)
    store[f"{cfg['contract']}/{bid}/{idx}"].update(reveal_tx=r["tx"])
    save_store(key_path, store)
    return {"revealed": True, "tx": r["tx"], "bounty_id": bid, "index": idx,
            "next": "the vendor now proves the patch; call status to see the outcome (PASS pays, FAIL spends the attempt, "
                    "a timeout splits the reward among waiting attempts)"}


def t_status(cfg, a):
    key_path, acct, _ = key_info(cfg)
    store = load_store(key_path)
    out = []
    for k, rec in store.items():
        if k.startswith("pending:") or rec.get("contract") != cfg["contract"]:
            continue
        if a.get("bounty_id") is not None and rec["bounty_id"] != str(a["bounty_id"]):
            continue
        s = view(cfg, "get_submission", {"bounty_id": rec["bounty_id"], "index": rec["index"]}) or {}
        out.append({**public_record(rec), "outcome": s.get("outcome"), "verdict": s.get("verdict"),
                    "revealed_at_utc": ns_utc(s["revealed_at_ns"]) if s.get("revealed_at_ns") else None,
                    "deadline_utc": ns_utc(s["deadline_ns"]) if s.get("deadline_ns") else None})
    return {"account": acct, "attempts": out,
            "meaning": {"Open": "waiting (not revealed, or revealed and waiting for the vendor's proof)", "Passed": "PASS: paid by proof",
                        "Failed": "FAIL: attempt spent", "TimedOut": "paid by the timeout rule (not a verdict)",
                        "Released": "not revealed in time; slot freed"}}


TOOLS = {
    "list_bounties": (t_list_bounties, "Bounties from the Skarbnik feed (a snapshot): terms, next fee, slots, windows and the public code links.",
                      {"only_open": {"type": "boolean", "description": "only bounties accepting commits (default true)"}}, []),
    "get_bounty": (t_get_bounty, "The live state of one bounty from the contract, and the checks to pass before committing (for the key's account when a key is set).",
                   {"bounty_id": {"type": "string", "description": "the bounty id"}}, ["bounty_id"]),
    "get_public_code": (t_get_public_code, "The public code of a bounty: the Rust source with its known bug, the build flags, the public tests (input as hex and the value the original returns) and what a fix must do. The module is checked against the hash on chain.",
                        {"bounty_id": {"type": "string"}}, ["bounty_id"]),
    "check_patch": (t_check_patch, "Check a fix before spending anything: the whole fixed module as WebAssembly text (wat), or a .wasm file (patch_path). The site's check turns the text into a module, confirms it is valid, fits, and has the same exports as the public program, and runs the public tests (and the public demo input on demo bounties). The module is saved next to the key file for commit. Only the fix is sent, never the key. It does not show that the fix passes the private test.",
                    {"bounty_id": {"type": "string"}, "wat": {"type": "string"}, "patch_path": {"type": "string"}}, ["bounty_id"]),
    "build_patch": (t_build_patch, "Build a patch from the complete fixed Rust source file, with the bounty's exact build flags (needs rustc with the wasm32-unknown-unknown target on this computer). Returns the .wasm path to commit, its size and whether it fits the bounty's limit. Source that uses include!, env!, mod or extern crate is refused.",
                    {"bounty_id": {"type": "string"}, "rust_source": {"type": "string", "description": "the complete fixed .rs file"}}, ["bounty_id", "rust_source"]),
    "get_credit": (t_get_credit, "Credit in the contract and agent limits of an account (default: the key's account).",
                   {"account_id": {"type": "string"}}, []),
    "commit": (t_commit, "Commit a patch (a .wasm file) to a bounty: checks the bounty and the key, makes a nonce, builds the fingerprint, saves the nonce next to the key (mode 600), then sends commit with the limited key. Takes the attempt fee from credit.",
               {"bounty_id": {"type": "string"}, "patch_path": {"type": "string", "description": "path of the patched .wasm module"},
                "payout": {"type": "string", "description": "payout account (default: the key's account)"}}, ["bounty_id", "patch_path"]),
    "reveal": (t_reveal, "Reveal a committed patch (after the bounty's reveal gap, within its reveal window). The patch becomes public.",
               {"bounty_id": {"type": "string"}, "index": {"type": "integer", "description": "the attempt index commit returned"}}, ["bounty_id", "index"]),
    "status": (t_status, "This key's attempts with their outcome on chain (Open, Passed, Failed, TimedOut, Released).",
               {"bounty_id": {"type": "string", "description": "only this bounty (optional)"}}, []),
}


def handle(msg):
    method, mid = msg.get("method"), msg.get("id")
    if method == "initialize":
        return {"protocolVersion": (msg.get("params") or {}).get("protocolVersion", "2025-06-18"),
                "capabilities": {"tools": {}}, "serverInfo": {"name": "skarbnik", "version": VERSION},
                "instructions": "Skarbnik bounties on NEAR (testnet by default). Read AGENTS.md at https://skarbnik.xyz/agents.md. "
                                "Work order: list_bounties, get_public_code, check_patch (WebAssembly text; or build_patch from Rust), get_bounty (tell the user the fee and "
                                "wait for a yes), commit, then reveal after the reveal gap, then status."}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": [{"name": n, "description": d, "inputSchema": {"type": "object", "properties": p, "required": r}}
                          for n, (_, d, p, r) in TOOLS.items()]}
    if method == "tools/call":
        p = msg.get("params") or {}
        name = p.get("name")
        if name not in TOOLS:
            return {"content": [{"type": "text", "text": f"unknown tool {name}"}], "isError": True}
        try:
            cfg = settings()
            res = TOOLS[name][0](cfg, p.get("arguments") or {})
            return {"content": [{"type": "text", "text": json.dumps(res, indent=1)}], "isError": False}
        except Fail as e:
            return {"content": [{"type": "text", "text": str(e)}], "isError": True}
        except (KeyError, ValueError, OSError, subprocess.SubprocessError) as e:
            return {"content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}], "isError": True}
    if mid is None:
        return None
    raise LookupError(method)


def rust_ready():
    """Whether rustc and its wasm32-unknown-unknown target are installed, in plain words."""
    rustc = rustc_path()
    if not rustc:
        return False, "rustc not found: install Rust from https://rustup.rs"
    try:
        root = subprocess.run([rustc, "--print", "sysroot"], capture_output=True, text=True, timeout=60).stdout.strip()
        ver = subprocess.run([rustc, "--version"], capture_output=True, text=True, timeout=60).stdout.strip()
    except (OSError, subprocess.SubprocessError) as e:
        return False, f"rustc did not run: {e}"
    if not os.path.isdir(os.path.join(root, "lib", "rustlib", "wasm32-unknown-unknown")):
        return False, f"{ver} found, but not its WebAssembly target: run  rustup target add wasm32-unknown-unknown"
    return True, f"{ver} with the wasm32-unknown-unknown target"


def setup_text(app, key=None):
    """The settings for one app, with this computer's Python and this script's path (and the key file, if given)."""
    py, me = sys.executable, os.path.abspath(__file__)
    env = {}
    note = ""
    if key:
        env["SKARBNIK_KEY_FILE"] = os.path.abspath(os.path.expanduser(key))
    else:
        try:
            note = f"Key file found: {find_key_file(settings())} (the server finds it by itself each time it starts).\n\n"
        except Fail as e:
            note = f"Note: {e}\n\n"
    entry = {"command": py, "args": ["-I", me]}
    if env:
        entry["env"] = env
    block = json.dumps({"mcpServers": {"skarbnik": entry}}, indent=2)
    if app in ("claude-desktop", "cursor"):
        where = ("Claude Desktop: Settings, Developer, Edit Config. That opens claude_desktop_config.json."
                 if app == "claude-desktop" else "Cursor: the file .cursor/mcp.json in your home folder.")
        return (f"{note}{where}\nIf the file is empty or holds only {{}}, replace everything in it with this:\n\n{block}\n\n"
                "If it already has \"mcpServers\", add only the \"skarbnik\": {...} part inside it, with a comma between it "
                "and the entry before it. Save the file, then quit the app fully and open it again.")
    if app == "claude-code":
        envs = "".join(f' --env {k}="{v}"' for k, v in env.items())
        return f'{note}Run this once in a terminal:\n\nclaude mcp add --scope user{envs} skarbnik -- "{py}" -I "{me}"\n\nThen start claude; /mcp lists skarbnik.'
    if app == "codex":
        lines = ["[mcp_servers.skarbnik]", f"command = '{py}'", f"args = ['-I', '{me}']"]
        if env:
            lines.append("env = { " + ", ".join(f"{k} = '{v}'" for k, v in env.items()) + " }")
        return (note + "Add this to the file .codex/config.toml in your home folder (make the file if it does not exist), "
                "then start Codex again:\n\n" + "\n".join(lines))
    raise Fail("--setup takes one of: claude-desktop, claude-code, codex, cursor")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--setup":
        rest = sys.argv[2:]
        key = rest[rest.index("--key") + 1] if "--key" in rest and rest.index("--key") + 1 < len(rest) else None
        print(setup_text(rest[0] if rest and rest[0] != "--key" else "", key))
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        ok = True
        print(f"Python {sys.version.split()[0]}: {'ok' if sys.version_info >= (3, 9) else 'too old, install 3.9 or later'}")
        cfg = settings()
        try:
            path, acct, pub = key_info(cfg)
            check_key(cfg, acct, pub)
            read_seed(path, pub)
            print(f"Key: ok, {acct}, key {pub[:20]}... limited to commit and reveal on {cfg['contract']} ({cfg['network']})")
        except Fail as e:
            ok = False
            print(f"Key: {e}")
        good, msg = rust_ready()
        print(f"Rust: {'ok, ' if good else ''}{msg}")
        print("All set." if ok and good else "Not ready yet: fix the lines above and run --check again.")
        sys.exit(0 if ok and good else 1)
    log(f"started (version {VERSION})")
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            res = handle(msg)
            if msg.get("id") is not None and res is not None:
                out = {"jsonrpc": "2.0", "id": msg["id"], "result": res}
            else:
                continue
        except LookupError:
            out = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32601, "message": f"method not found: {msg.get('method')}"}}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Fail as e:
        print(f"skarbnik-mcp: {e}", file=sys.stderr)
        sys.exit(1)
