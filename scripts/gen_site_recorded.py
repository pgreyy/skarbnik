#!/usr/bin/env python3
# Builds web/data/recorded.json for the site from files already in this repository: the transaction ids each testnet
# script saved (docs/evidence/*/transactions.tsv), the S8 probe agent runs (docs/evidence/S8/) and a few counts
# (public tests). Nothing is invented: every id and number comes from a named file, and the file name goes with it.
# Usage, from the repo root: python3 -I scripts/gen_site_recorded.py
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTRACT = "kintsugi-l2-cihdp.testnet"


def tsv(path):
    rows = []
    with open(os.path.join(ROOT, path)) as f:
        head = f.readline().rstrip("\n").split("\t")
        for line in f:
            r = dict(zip(head, line.rstrip("\n").split("\t")))
            rows.append(r)
    return rows


# What a step did, in plain words, by contract method (a few steps get their own words below)
WHAT = {"create_bounty": "Bounty created", "open_with_groth16": "Opened with its Proof 0", "attest_proof0": "Proof 0 attested by a verifier",
        "commit": "Attempt committed", "reveal": "Attempt revealed", "submit_groth16": "Proof of an attempt sent",
        "post_verdict": "Vendor posted a verdict", "attest": "Verifier attested a verdict", "claim_timeout": "Timeout claimed",
        "expire": "Expired", "release_unrevealed": "Unrevealed slot released", "deposit_credit": "Credit deposited",
        "withdraw_credit": "Credit withdrawn", "set_agent_limits": "Agent limits set", "create-account": "Test account created"}
WHAT_CLI = {"cli_deposit_credit": "Credit deposited through the site (NEAR CLI wallet)", "cli_commit": "Attempt committed through the site (NEAR CLI wallet)",
            "cli_reveal": "Attempt revealed through the site (NEAR CLI wallet)", "cli_withdraw_credit": "Credit withdrawn through the site (NEAR CLI wallet)",
            "agentkey_commit_other_payout": "Limited agent key: commit naming another payout", "agentkey_commit": "Limited agent key: attempt committed",
            "agentkey_reveal": "Limited agent key: attempt revealed"}
WHAT_STEP = {"web_commit_cap_full": "Commit with every slot in use (ignored, nothing taken)",
             "fix1_commit_too_close_to_expiry": "Commit close to expiry", "s3_proof_of_another_bounty": "Proof of another bounty sent",
             "web_commit_no_credit": "Commit with no credit", "a_attest_proof0_refused": "Verifier attestation on a Level 2 bounty",
             "a_post_verdict_refused": "Vendor verdict on a Level 2 bounty", "fix2_payout_is_a_verifier": "Commit naming a verifier as payout"}


def what(row):
    return WHAT_CLI.get(row["step"], WHAT_STEP.get(row["step"], WHAT.get(row["method"], row["method"])))


def when(path, step, rows):
    """The start time of a step from its saved output (docs/evidence/<spike>/steps/<step>.txt), as YYYY-MM-DD HH:MM UTC.
    A step name used twice in one run has one output file, so its time is not known for certain and is left out."""
    if sum(1 for r in rows if r["step"] == step) != 1:
        return None
    f = os.path.join(ROOT, os.path.dirname(path), "steps", step + ".txt")
    try:
        for ln in open(f):
            if ln.startswith("utc_start="):
                return ln[10:26].replace("T", " ") + " UTC"
    except OSError:
        return None
    return None


def ok(row):
    # exit 0 (sent by near-cli) or rpc:ok means the transaction succeeded; rpc:failed means the contract refused it.
    return row["exit"] in ("0", "rpc:ok")


def refused(row):
    return row["exit"] == "rpc:failed"


# Which bounty each step belongs to, by the step name prefixes the scripts used (see the scripts named here).
BOUNTY_STEPS = [
    ("docs/evidence/S6c/transactions.tsv", "scripts/s6c_testnet.sh", {
        0: ["l0_"], 1: ["a_", "a0_", "a1_"], 2: ["d_"], 3: ["b_", "b0_"], 4: ["c_", "c0_"], 5: ["s_"], 6: ["s2_"],
        7: ["demo_"]}),
    ("docs/evidence/audit1/transactions.tsv", "scripts/audit1_testnet.sh", {9: ["x_", "fix1_", "fix2_", "fix3_", "fix4_"]}),
    ("docs/evidence/hardening/transactions.tsv", "scripts/hardening_testnet.sh", {10: ["lim_", "s6_"], 11: ["split_", "s7_", "s3_"]}),
    ("docs/evidence/S18/transactions.tsv", "scripts/s18_live_bounty.sh", {12: ["s18_"]}),
    ("docs/evidence/web/transactions.tsv", "scripts/web_testnet.sh", {13: ["web_bounty_", "web_commit", "web_reveal", "web_claim_"],
                                                                      7: ["web_commit_no_credit"], 14: ["user_bounty_"], 15: ["cli_", "agentkey_commit", "agentkey_reveal"]}),
]
# Steps whose name starts like another bounty's prefix but belong elsewhere
EXCLUDE = {13: {"web_commit_no_credit"}}

out = {"contract": CONTRACT, "network": "testnet", "bounties": {}, "notes": {}}

for path, script, rules in BOUNTY_STEPS:
    rows_all = tsv(path)
    for row in rows_all:
        if row["tx_hash"] in ("", "-"):
            continue
        for bid, prefixes in rules.items():
            # "s_" must not catch "s2_", "s6_", "s7_", "s3_" or "s18_": match the prefix and require the next part to differ
            if any(row["step"].startswith(p) for p in prefixes) and not (
                    "s_" in prefixes and row["step"][:3] in ("s2_", "s6_", "s7_", "s3_") or
                    "s_" in prefixes and row["step"].startswith("s18_")):
                if not (ok(row) or refused(row)) or row["step"] in EXCLUDE.get(bid, set()):
                    continue
                out["bounties"].setdefault(str(bid), []).append({
                    "step": row["step"], "method": row["method"], "tx": row["tx_hash"], "what": what(row),
                    "time": when(path, row["step"], rows_all),
                    "result": "succeeded" if ok(row) else "refused by the contract", "source": path, "script": script})

# Bounty 8: its only transaction is named in docs/AUDIT.md (finding 8), not in a transactions file
import re as _re
row = next(ln for ln in open(os.path.join(ROOT, "docs/AUDIT.md")) if ln.startswith("| 8 | high |"))
out["bounty_notes"] = {"8": {
    "text": "The contract shows this bounty as Paid, but the payout went to an account that does not exist: the transfer "
            "failed and the NEAR stayed in the contract (review finding 8, a known limit).",
    "tx": _re.search(r"tx `([1-9A-HJ-NP-Za-km-z]{43,44})`", row).group(1), "source": "docs/AUDIT.md, finding 8"}}

# S6c attacks on Level 2 proofs (all refused on testnet)
ATTACK = {"atk_other_attempt": "Proof of another attempt", "atk_fail_as_pass": "A FAIL proof presented as a PASS",
          "atk_flipped_seal_bit": "Proof with one bit flipped", "atk_changed_journal": "Proof with a changed journal",
          "atk_wrong_image_id": "Proof under another checker image id", "atk_fail_second_submission": "Second proof for a decided attempt",
          "atk_other_bounty": "Proof of another bounty", "atk_second_submission": "Second proof after a PASS",
          "atk_after_expiry": "Proof after the bounty expired"}
S6C = tsv("docs/evidence/S6c/transactions.tsv")
out["attacks_s6c"] = [
    {"step": r["step"], "tx": r["tx_hash"], "result": "refused by the contract", "source": "docs/evidence/S6c/transactions.tsv",
     "what": ATTACK.get(r["step"], r["step"][4:].replace("_", " ").capitalize()), "time": when("docs/evidence/S6c/transactions.tsv", r["step"], S6C)}
    for r in S6C if r["step"].startswith("atk_") and refused(r)]

# The hardening check: a real proof bound to another bounty, refused at the cheap check
for r in tsv("docs/evidence/hardening/transactions.tsv"):
    if r["step"] == "s3_proof_of_another_bounty" and refused(r):
        out["wrong_bounty_refused"] = {"tx": r["tx_hash"], "source": "docs/evidence/hardening/transactions.tsv",
                                       "what": "the real PASS proof of bounty 1 attempt 0 sent for bounty 11 attempt 0"}
for r in tsv("docs/evidence/S6c/transactions.tsv"):
    if r["step"] == "a0_pass" and ok(r):
        out["valid_proof_accepted"] = {"tx": r["tx_hash"], "source": "docs/evidence/S6c/transactions.tsv",
                                       "what": "a real Groth16 proof of a PASS for bounty 1 attempt 0, accepted and paid"}

# S8: the recorded probe agent run (native checker verdicts) and its testnet commits on the older S4/S7 contract
arena = json.load(open(os.path.join(ROOT, "docs/evidence/S8/arena_log.json")))
run = open(os.path.join(ROOT, "docs/evidence/S8/arena_run.txt")).read().splitlines()
control = [ln.strip() for ln in run if ln.strip().startswith("probe_")]
out["arena"] = {
    "source": "docs/evidence/S8/arena_log.json, docs/evidence/S8/arena_run.txt",
    "script": "scripts/s8_arena.sh",
    "verdicts_from": "the native checker (the same checker code the zkVM guest runs); no proofs were made for the probes",
    "attempts": [{"attempt": a["attempt"], "verdict": a["verdict"], "bits_learned": a["bits_learned"],
                  "candidates_left": a["candidates_left"], "budget": a["budget"]} for a in arena],
    "secret_space": next((int(ln.split("secret space:")[1].split()[0]) for ln in run if "secret space:" in ln), None),
    "control_variant_check_on": [{"probe": c.split(":")[0], "verdict": c.split(":")[1].strip()} for c in control],
    "control_variants": next((int(ln.split("(")[1].split()[0]) for ln in run if ln.startswith("control with the crash-variant check on")), None),
    "chain": {"contract": "bounty.kintsugi-djloo.testnet", "source": "docs/evidence/S8/transactions.tsv",
              "script": "scripts/s8_chain.sh",
              "steps": [{"step": r["step"], "tx": r["tx_hash"], "result": "succeeded",
                         "what": "Arena bounty created" if r["method"] == "create_bounty" else f"Probe commit {r['step'][-1]}" + (" (over the cap: ignored, nothing taken)" if r["step"].endswith("_4") else ""),
                         "time": when("docs/evidence/S8/transactions.tsv", r["step"], tsv("docs/evidence/S8/transactions.tsv"))}
                        for r in tsv("docs/evidence/S8/transactions.tsv") if ok(r)],
              "note": "the fourth probe commit was ignored: still 3 commits, credit unchanged (docs/evidence/S8/chain_summary.txt)"},
}

# Public tests of the demo bounty: one test per line that is not a comment or blank
tests = [ln for ln in open(os.path.join(ROOT, "data/demo/public_tests.txt")) if ln.strip() and not ln.lstrip().startswith("#")]
out["notes"]["demo_public_tests"] = {"count": len(tests), "source": "data/demo/public_tests.txt"}
# The check size of bounty 12's own Proof 0 (the intro labels use these numbers)
v = dict(ln.split(": ", 1) for ln in open(os.path.join(ROOT, "docs/evidence/S18/verify_proof0.txt")).read().splitlines() if ": " in ln)
out["notes"]["bounty12_proof0"] = {"fuzz_count": int(v["journal.fuzz_count"]), "variant_count": int(v["journal.variant_count"]),
                                   "verdict": v["journal.verdict"], "source": "docs/evidence/S18/verify_proof0.txt"}
out["notes"]["published_image_id"] = {"id": "dd6c5f42c117ce3a842dbde60cd3fd9f255c85e322317e6bff2357b20533a2fc",
                                      "source": "docs/EVIDENCE.md (reproducible checker build), scripts/check_image_id.sh"}

# The demo commitment, recomputed: sha256(demo salt || demo exploit) (harness/checker/src/zk.rs exploit_commitment_bytes).
# A bounty with this commitment uses the public demo secret input, which is in the repository.
import hashlib
import re
salt = re.search(r'const DEMO_SALT: \[u8; 32\] = \*b"([^"]{32})";', open(os.path.join(ROOT, "host/src/main.rs")).read()).group(1).encode()
exploit = bytes.fromhex("".join(open(os.path.join(ROOT, "data/demo/exploit.hex")).read().split()))
out["notes"]["demo_exploit_commitment"] = {"commitment": hashlib.sha256(salt + exploit).hexdigest(),
                                           "source": "host/src/main.rs (DEMO_SALT) and data/demo/exploit.hex"}

# Test bounties made by scripts/web_testnet.sh (TBOUNTY: the scripted run; UBOUNTY: for trying the wallet flow by hand)
runenv = dict(l.strip().split("=", 1) for l in open(os.path.join(ROOT, "docs/evidence/web/run.env")) if "=" in l)
out["test_bounties"] = {}
if "TBOUNTY" in runenv:
    out["test_bounties"][runenv["TBOUNTY"]] = "Test bounty: made for the scripted testnet run of the site's wallet features."
if "UBOUNTY" in runenv:
    out["test_bounties"][runenv["UBOUNTY"]] = "Test bounty: made for trying the wallet flow by hand. Not a demo."
if "CBOUNTY" in runenv:
    out["test_bounties"][runenv["CBOUNTY"]] = "Test bounty: made for the scripted run of the site with the NEAR CLI wallet."
# The test bounty for the model-driven agent's real run (scripts/agent_testnet.sh bounty)
agentenv = dict(l.strip().split("=", 1) for l in open(os.path.join(ROOT, "docs/evidence/agent/run.env")) if "=" in l)
if "ABOUNTY" in agentenv:
    out["test_bounties"][agentenv["ABOUNTY"]] = "Test bounty: made for the real run of the model-driven agent (agent/)."

dst = os.path.join(ROOT, "web/data/recorded.json")
with open(dst, "w") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
print(f"wrote {os.path.relpath(dst, ROOT)}: bounties with records {sorted(int(k) for k in out['bounties'])}, "
      f"{len(out['attacks_s6c'])} S6c attacks, {len(out['arena']['attempts'])} arena attempts, "
      f"{out['notes']['demo_public_tests']['count']} public tests", file=sys.stderr)
