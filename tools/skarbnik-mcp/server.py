#!/usr/bin/env python3
# skarbnik-mcp: an MCP server (stdio, JSON-RPC 2.0, one message per line) that lets an AI agent work on Skarbnik
# bounties with a key limited to commit and reveal. Tools: list_bounties, get_bounty, get_credit, commit, reveal,
# status. It reads the feed and the contract (view calls over RPC), builds the commit fingerprint exactly as the
# contract's commit_fingerprint, keeps each attempt's nonce in a file next to the key (mode 600), and has near-cli-rs
# sign each transaction with the key file named in SKARBNIK_KEY_FILE. It refuses any key that is not a function call
# key limited to commit and reveal on the contract. It never returns or logs the key or the nonce file's contents.
# Testnet by default; mainnet only with SKARBNIK_ALLOW_MAINNET=1. Python 3.11 or later, standard library only.
import base64
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.request

VERSION = "0.1.0"
NETWORKS = {
    "testnet": {"contract": "kintsugi-l2-cihdp.testnet", "rpc": ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
                "feed": "https://skarbnik.xyz/feed.json"},
    "mainnet": {"contract": None, "rpc": ["https://rpc.mainnet.near.org"], "feed": None},
}
PUBLISHED_IMAGE_ID = "dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc"
NONCE_FILE = "skarbnik-mcp-nonces.json"


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


def key_info(cfg):
    """The account and public key of the limited key file. The private key is never kept, returned or logged."""
    path = os.path.expanduser(cfg["key_file"] or "")
    if not cfg["key_file"] or not os.path.isfile(path):
        raise Fail("SKARBNIK_KEY_FILE must name the limited key file (a near-cli key JSON file)")
    if os.stat(path).st_mode & 0o077:
        raise Fail("the key file is readable by other users: run chmod 600 on it")
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


def sign_and_send(cfg, key_path, acct, method, args):
    """near-cli-rs signs with the key file into a temporary file; the transaction is sent over RPC and its outcome read."""
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
            b64 = json.load(f)["signed_transaction_as_base64"]
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
    if os.stat(path).st_mode & 0o077:
        raise Fail(f"{NONCE_FILE} is readable by other users: run chmod 600 on it")
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
    if not cfg["feed"]:
        raise Fail("no feed is known for this network: set SKARBNIK_FEED")
    with urllib.request.urlopen(cfg["feed"], timeout=60) as r:
        f = json.load(r)
    base = cfg["feed"].rsplit("/", 1)[0] + "/"
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
                                "Check a bounty with get_bounty before commit; reveal after the reveal gap."}
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
        except (KeyError, ValueError, OSError) as e:
            return {"content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}], "isError": True}
    if mid is None:
        return None
    raise LookupError(method)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        cfg = settings()
        path, acct, pub = key_info(cfg)
        check_key(cfg, acct, pub)
        print(f"ok: {acct}, key {pub[:20]}... limited to commit and reveal on {cfg['contract']} ({cfg['network']})")
        return
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
