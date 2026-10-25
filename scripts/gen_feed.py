#!/usr/bin/env python3
# Writes web/feed.json: the bounties of the testnet contract that accept commits right now, read live from the chain
# with read only calls (get_next_bounty_id, get_bounty). The file is a snapshot: it says when it was made, and an agent
# should read get_bounty itself before committing. No key is used and nothing is sent.
# It also publishes the public code of each known program in web/code/<name>/ (copied from data/), and names it in the
# feed for every bounty whose original_hash and corpus_hash match those files, so an agent can download and check it.
# Usage, from the repo root: python3 -I scripts/gen_feed.py   (RPC=... to use another testnet RPC)
import base64
import datetime
import hashlib
import json
import os
import shutil
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTRACT = "kintsugi-l2-cihdp.testnet"
RPC = os.environ.get("RPC", "https://test.rpc.fastnear.com")
YOCTO = 10 ** 24


def view(method, args):
    body = json.dumps({"jsonrpc": "2.0", "id": "f", "method": "query", "params": {
        "request_type": "call_function", "finality": "final", "account_id": CONTRACT, "method_name": method,
        "args_base64": base64.b64encode(json.dumps(args).encode()).decode()}}).encode()
    req = urllib.request.Request(RPC, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.load(r)
    if "result" not in res or "result" not in res["result"]:
        sys.exit(f"view {method} failed: {json.dumps(res)[:300]}")
    return json.loads(bytes(res["result"]["result"]).decode())


def near(yocto):
    s = f"{int(yocto) / YOCTO:.6f}".rstrip("0").rstrip(".")
    return f"{s} NEAR"


def utc(ns):
    return datetime.datetime.fromtimestamp(int(ns) / 1e9, datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# Public code packages: the program's source, its compiled module, its public tests and how to build a patch.
PACKAGES = {"demo": {"dir": "data/demo", "source": "original.rs", "module": "original.wasm", "tests": "public_tests.txt"}}
BUILD_TXT = """How to build a patch for this program (the same flags the vendor used for the original):
rustc --edition 2021 --target wasm32-unknown-unknown --crate-type cdylib -C opt-level=z -C panic=abort -C strip=symbols \\
  -C codegen-units=1 -C target-cpu=mvp -C link-arg=-zstack-size=8192 -C link-arg=--initial-memory=131072 \\
  -C link-arg=--max-memory=131072 -o patch.wasm patch.rs
Keep the interface: input_buf() -> i32 and parse(len: i32) -> i32. The patch must be at most the bounty's max_patch_bytes.
Public tests: one per line, <input as hex, or - for empty> <value the original returns>. corpus_hash is sha256 over, for
each test in order: input length (u32 little endian), input bytes, expected value (i32 little endian).
"""


def corpus_hash(text):
    out = b""
    for line in text.splitlines():
        line = line.split("#")[0].split()
        if not line:
            continue
        data = b"" if line[0] == "-" else bytes.fromhex(line[0])
        out += len(data).to_bytes(4, "little") + data + int(line[1]).to_bytes(4, "little", signed=True)
    return hashlib.sha256(out).hexdigest()


public_code = {}
for name, pk in PACKAGES.items():
    dst_dir = os.path.join(ROOT, "web/code", name)
    os.makedirs(dst_dir, exist_ok=True)
    for key in ("source", "module", "tests"):
        shutil.copyfile(os.path.join(ROOT, pk["dir"], pk[key]), os.path.join(dst_dir, pk[key]))
    with open(os.path.join(dst_dir, "BUILD.txt"), "w") as f:
        f.write(BUILD_TXT)
    module = open(os.path.join(dst_dir, pk["module"]), "rb").read()
    tests = open(os.path.join(dst_dir, pk["tests"])).read()
    public_code[(hashlib.sha256(module).hexdigest(), corpus_hash(tests))] = {
        "source": f"code/{name}/{pk['source']}", "module": f"code/{name}/{pk['module']}",
        "tests": f"code/{name}/{pk['tests']}", "build": f"code/{name}/BUILD.txt"}

now_ns = int(datetime.datetime.now(datetime.UTC).timestamp() * 1e9)
# Test bounties (made for trying the site), from web/data/recorded.json (scripts/gen_site_recorded.py)
try:
    test_ids = set(json.load(open(os.path.join(ROOT, "web/data/recorded.json"))).get("test_bounties", {}))
except (OSError, ValueError):
    test_ids = set()
n = int(view("get_next_bounty_id", {}))
allowed = view("get_allowed_image_ids", {})
open_bounties = []
for i in range(n):
    b = view("get_bounty", {"bounty_id": str(i)})
    if not b or b["state"] != "Open" or not b["opened"]:
        continue
    # the contract refuses a commit that leaves less than the reveal window and the verdict window before expiry
    commit_by = int(b["expires_at_ns"]) - int(b["reveal_window_ns"]) - int(b["verdict_window_ns"])
    slots_left = b["max_commits"] - b["active"]
    if now_ns >= commit_by or slots_left <= 0:
        continue
    open_bounties.append({
        "bounty_id": int(b["id"]),
        "level": b["level"],
        "next_fee_yocto": b["next_fee"],
        "next_fee": near(b["next_fee"]),
        "slots_left": slots_left,
        "max_commits": b["max_commits"],
        "commit_deadline_utc": utc(commit_by),
        "expires_at_utc": utc(b["expires_at_ns"]),
        "bounty_amount": near(b["amount"]),
        "image_id": b["image_id"],
        "image_id_allowed": b["image_id_allowed"],
        "test_bounty": str(b["id"]) in test_ids,
        "max_patch_bytes": b["max_patch_bytes"],
        "original_hash": b["original_hash"],
        "corpus_hash": b["corpus_hash"],
        "public_code": public_code.get((b["original_hash"], b["corpus_hash"])),
    })

feed = {
    "name": "Skarbnik",
    "contract": CONTRACT,
    "network": "testnet",
    "generated_at_utc": utc(now_ns),
    "note": "Snapshot made by scripts/gen_feed.py. Read get_bounty on the contract for the current state before you commit.",
    "allowed_image_ids": allowed,
    "test_bounty_ids": sorted(int(x) for x in test_ids),
    "test_bounty_note": "Test bounties are for trying the site and the wallet flow, not demos.",
    "open_bounties": open_bounties,
    "public_code_note": "public_code paths are relative to this file. Check sha256(module) == original_hash and the tests' corpus_hash before you use them.",
    "quickstart": "/agent-quickstart.txt",
}
dst = os.path.join(ROOT, "web/feed.json")
with open(dst, "w") as f:
    json.dump(feed, f, indent=1)
    f.write("\n")
print(f"wrote web/feed.json: {len(open_bounties)} open of {n} bounties", file=sys.stderr)
