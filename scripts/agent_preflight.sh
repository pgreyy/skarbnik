#!/usr/bin/env bash
# Checks a bounty before an agent (or a person) commits to it (audit hardening S16). Read only: it sends no transaction.
# It refuses (exit 1) unless all of these hold:
#   - the payout account exists on chain (a payout to a missing account is lost, see docs/AUDIT.md finding 8)
#   - the bounty is open, not expired, and a commit now still leaves the reveal window and the verdict window before expiry
#   - the bounty's image id is on the owner's allowlist, and the allowlist is not empty (an empty list allows any id)
#   - with EXPECTED_IMAGE_ID set, the image id is exactly that (from scripts/check_image_id.sh, which must print MATCH)
#   - the next attempt fee is at most MAX_FEE, and within the committer's own max_fee_per_commit if it set one
#   - the committer's fixed payout, if it set one, is the payout account given here
#   - the windows are long enough (MIN_REVEAL_WINDOW_S, MIN_VERDICT_WINDOW_S, MIN_ATTEST_WINDOW_S for Level 0)
#   - K (max_commits) is at most MAX_K and a slot is free
# Usage, from the repo root: ./scripts/agent_preflight.sh <contract> <bounty id> <payout account> [committer account]
# Limits come from the environment; the defaults are below. Testnet RPC unless RPC is set.
set -euo pipefail
[ $# -ge 3 ] || { echo "usage: $0 <contract> <bounty id> <payout account> [committer account]"; exit 2; }
RPC="${RPC:-https://test.rpc.fastnear.com}" \
MAX_FEE="${MAX_FEE:-50000000000000000000000}" \
MIN_REVEAL_WINDOW_S="${MIN_REVEAL_WINDOW_S:-60}" \
MIN_VERDICT_WINDOW_S="${MIN_VERDICT_WINDOW_S:-7200}" \
MIN_ATTEST_WINDOW_S="${MIN_ATTEST_WINDOW_S:-3600}" \
MAX_K="${MAX_K:-16}" \
EXPECTED_IMAGE_ID="${EXPECTED_IMAGE_ID:-}" \
python3 -I - "$@" <<'PY'
import base64, json, os, sys, time, urllib.request
contract, bounty_id, payout = sys.argv[1], sys.argv[2], sys.argv[3]
committer = sys.argv[4] if len(sys.argv) > 4 else None
env = os.environ
def rpc(params):
    body = json.dumps({"jsonrpc": "2.0", "id": "p", "method": "query", "params": dict(finality="final", **params)}).encode()
    req = urllib.request.Request(env["RPC"], body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)
def view(method, args):
    r = rpc({"request_type": "call_function", "account_id": contract, "method_name": method,
             "args_base64": base64.b64encode(json.dumps(args).encode()).decode()})
    if "result" not in r or "result" not in r["result"]:
        sys.exit(f"FAIL view {method} failed (an older contract?): {json.dumps(r)[:300]}")
    return json.loads(bytes(r["result"]["result"]).decode())
fails = []
def check(ok, what):
    print(("PASS " if ok else "FAIL ") + what)
    if not ok:
        fails.append(what)
b = view("get_bounty", {"bounty_id": bounty_id})
if b is None:
    sys.exit(f"FAIL bounty {bounty_id} does not exist on {contract}")
acct = rpc({"request_type": "view_account", "account_id": payout})
check("result" in acct, f"payout account {payout} exists")
now = time.time_ns()
sec = 1_000_000_000
check(b["state"] == "Open", f"bounty state is Open (is {b['state']})")
check(b["opened"], "the bounty is opened (Proof 0 accepted)")
reveal, verdict, attest = int(b["reveal_window_ns"]), int(b["verdict_window_ns"]), int(b["attest_window_ns"])
check(now + reveal + verdict <= int(b["expires_at_ns"]),
      f"a commit now leaves the reveal and verdict windows before expiry ({(int(b['expires_at_ns']) - now) // sec} s left)")
allowed = view("get_allowed_image_ids", {})
check(len(allowed) > 0 and b["image_id"] in allowed and b.get("image_id_allowed") is True,
      f"image id {b['image_id'][:16]}... is on a non-empty allowlist ({len(allowed)} ids)")
if env["EXPECTED_IMAGE_ID"]:
    check(b["image_id"] == env["EXPECTED_IMAGE_ID"], "image id equals EXPECTED_IMAGE_ID (from check_image_id.sh MATCH)")
fee = int(b["next_fee"])
check(fee <= int(env["MAX_FEE"]), f"next attempt fee {fee / 1e24:.4f} NEAR is at most MAX_FEE {int(env['MAX_FEE']) / 1e24:.4f} NEAR")
if committer:
    lim = view("get_agent_limits", {"account_id": committer})
    if lim.get("max_fee_per_commit") is not None:
        check(fee <= int(lim["max_fee_per_commit"]), f"next fee is within {committer}'s max_fee_per_commit")
    else:
        print(f"NOTE {committer} has no max_fee_per_commit set (set_agent_limits)")
    if lim.get("fixed_payout") is not None:
        check(lim["fixed_payout"] == payout, f"payout equals {committer}'s fixed payout {lim['fixed_payout']}")
    else:
        print(f"NOTE {committer} has no fixed payout set (set_agent_limits)")
    credit = int(view("get_credit", {"account_id": committer}))
    check(credit >= fee, f"{committer}'s credit {credit / 1e24:.4f} NEAR covers the fee")
check(reveal >= int(env["MIN_REVEAL_WINDOW_S"]) * sec, f"reveal window {reveal // sec} s >= {env['MIN_REVEAL_WINDOW_S']} s")
check(verdict >= int(env["MIN_VERDICT_WINDOW_S"]) * sec, f"verdict window {verdict // sec} s >= {env['MIN_VERDICT_WINDOW_S']} s")
if b["level"] == 0:
    check(attest >= int(env["MIN_ATTEST_WINDOW_S"]) * sec, f"attest window {attest // sec} s >= {env['MIN_ATTEST_WINDOW_S']} s")
check(b["max_commits"] <= int(env["MAX_K"]), f"K = {b['max_commits']} is at most MAX_K {env['MAX_K']}")
check(b["active"] < b["max_commits"], f"a slot is free ({b['active']} of {b['max_commits']} in use)")
print(f"level {b['level']}, bounty {int(b['amount']) / 1e24:.4f} NEAR, fee step {int(b['fee_step']) / 1e24:.4f} NEAR")
if fails:
    print(f"PREFLIGHT REFUSED: {len(fails)} check(s) failed")
    sys.exit(1)
print("PREFLIGHT OK")
PY
