#!/usr/bin/env python3
# Builds web/data/recorded.json for the site from files already in this repository: the transaction ids each testnet
# script saved (docs/evidence/*/transactions.tsv), the S8 probe agent runs (docs/evidence/S8/) and a few counts
# (public tests). Nothing is invented: every id and number comes from a named file, and the file name goes with it.
# Usage, from the repo root: python3 -I scripts/gen_site_recorded.py
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = json.load(open(os.path.join(ROOT, "web/site.config.json")))  # the one site config
CONTRACT = SITE["contract"]


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
    # exit 0 (sent by near-cli), rpc:ok, or agent:ok (sent by agent/skarbnik_agent.py, outcome ok) means it succeeded; rpc:failed means the contract refused it.
    return row["exit"] in ("0", "rpc:ok", "agent:ok")


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
    ("docs/evidence/agent/transactions.tsv", "scripts/agent_testnet.sh, scripts/unpack_bounty.sh, agent/skarbnik_agent.py",
     {16: ["agent_bounty_", "agent_live_", "agent_submit_groth16_"], 17: ["unpack_bounty_", "unpack_live_", "unpack_submit_groth16_", "unpack_claim_timeout_"]}),
    # Agent setup from the site (PASTE-11 part D, run through the page with the NEAR CLI wallet): its attempts on test bounty 14
    # The per-account cap deploy's live test (scripts/cap_deploy.sh captest): a throwaway bounty with a cap of 1
    ("docs/evidence/account_cap/transactions.tsv", "scripts/cap_deploy.sh", {25: ["cap_test_create", "cap_test_open", "cap_test_commit_"], 15: ["cap_claim_timeout_b15_"], 14: ["cap_claim_timeout_b14_"]}),
    ("docs/evidence/web/partd_transactions.tsv", "the site's Account and bounty pages, NEAR CLI wallet; agent/skarbnik_agent.py",
     {14: ["partd_commit_", "partd_reveal_"]}),
    # The agent access test bounty (scripts/agent_access_test.sh): AGENTS.md followed literally, then the MCP server
    ("docs/evidence/agent_access/transactions.tsv", "scripts/agent_access_test.sh; AGENTS.md followed by hand; tools/skarbnik-mcp",
     {26: ["access_create", "access_open", "agentsmd_commit", "agentsmd_reveal", "mcp_commit", "mcp_reveal"]}),
]
# Judge bounties (scripts/judge_bounties.sh): same hashes as bounty 17, created closed, opened by anyone with its Proof 0.
_jenv = os.path.join(ROOT, "docs/evidence/judge/run.env")
JUDGE_IDS = []
if os.path.exists(_jenv):
    JUDGE_IDS = [int(x) for x in dict(l.strip().split("=", 1) for l in open(_jenv) if "=" in l).get("JUDGE_IDS", "").strip('"').split()]
    BOUNTY_STEPS.append(("docs/evidence/judge/transactions.tsv", "scripts/judge_bounties.sh",
                         {j: [f"judge_create_{i + 1}", f"judge_open_{j}", f"judge_open_again_{j}", f"judge_refusal_other_seal_{j}"]
                          for i, j in enumerate(JUDGE_IDS)}))
# Round 2 (JUDGE_ROUND=2): K = 2, a cap of 1 per account, the window from the measured proof time; round 1 is retired.
_jenv2 = os.path.join(ROOT, "docs/evidence/judge2/run.env")
JUDGE_IDS_2 = []
if os.path.exists(_jenv2):
    JUDGE_IDS_2 = [int(x) for x in dict(l.strip().split("=", 1) for l in open(_jenv2) if "=" in l).get("JUDGE_IDS", "").strip('"').split()]
    BOUNTY_STEPS.append(("docs/evidence/judge2/transactions.tsv", "JUDGE_ROUND=2 scripts/judge_bounties.sh",
                         {j: [f"judge_create_{i + 1}", f"judge_open_{j}", f"judge_open_again_{j}", f"judge_refusal_other_seal_{j}"]
                          for i, j in enumerate(JUDGE_IDS_2)}))
# The arena's guarded probe run (scripts/arena_probe.sh guarded): one bounty with the real cap and fee.
_aenv = os.path.join(ROOT, "docs/evidence/arena_probe/run.env")
ARENA_BOUNTY = dict(l.strip().split("=", 1) for l in open(_aenv) if "=" in l).get("GBOUNTY") if os.path.exists(_aenv) else None
if ARENA_BOUNTY:
    BOUNTY_STEPS.append(("docs/evidence/arena_probe/transactions.tsv", "scripts/arena_probe.sh", {int(ARENA_BOUNTY): ["arena_guarded_", "arena_probe_commit_"]}))
# Private bounties on other new modules (scripts/private_bounty.sh, MODULE=<name>): their own evidence folder and run.env.
NEW_MODULES = ["smooth"]
for _m in NEW_MODULES:
    _env = os.path.join(ROOT, f"docs/evidence/{_m}/run.env")
    if os.path.exists(_env):
        _n = dict(l.strip().split("=", 1) for l in open(_env) if "=" in l).get("NBOUNTY")
        if _n:
            BOUNTY_STEPS.append((f"docs/evidence/{_m}/transactions.tsv", "scripts/private_bounty.sh, agent/skarbnik_agent.py",
                                 {int(_n): [f"{_m}_bounty_", f"{_m}_live_", f"{_m}_submit_groth16_", f"{_m}_claim_timeout_"]}))
# Steps whose name starts like another bounty's prefix but belong elsewhere
EXCLUDE = {13: {"web_commit_no_credit"}}

out = {"contract": CONTRACT, "network": SITE["network"], "bounties": {}, "notes": {}}

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
    "tx": _re.search(r"tx `([1-9A-HJ-NP-Za-km-z]{43,44})`", row).group(1), "source": "docs/AUDIT.md, finding 8",
    "transfer_failed": True}}
# That transaction is bounty 8's timeout claim (claim_timeout, checked with the FastNEAR transaction index).
out["bounties"].setdefault("8", []).append({"step": "audit8_claim_timeout", "method": "claim_timeout", "tx": out["bounty_notes"]["8"]["tx"],
    "what": "Timeout claimed (the payout transfer then failed, review finding 8)", "time": None, "result": "succeeded",
    "source": "docs/AUDIT.md, finding 8", "script": "scripts/hardening_testnet.sh"})

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

# The last run of scripts/check_image_id.sh saved in the repository: its time and result, for the site's verify strip.
_checks = []
for _f in ("docs/evidence/judge/check_image_id.txt", "docs/evidence/judge/check_image_id_home.txt"):
    _p = os.path.join(ROOT, _f)
    if os.path.exists(_p):
        _t = open(_p).read()
        _m = _re.search(r"^run (\d{4}-\d\d-\d\dT\d\d:\d\dZ)", _t, re.M)
        _r = _re.search(r"^(MATCH|DIFFERENT)$", _t, re.M)
        if _m and _r:
            _checks.append({"utc": _m.group(1).replace("T", " ").replace("Z", " UTC"), "result": _r.group(1), "source": _f})
if _checks:
    out["last_image_check"] = max(_checks, key=lambda c: c["utc"])
if "TBOUNTY" in runenv:
    out["test_bounties"][runenv["TBOUNTY"]] = "Test bounty: made for the scripted testnet run of the site's wallet features."
if "UBOUNTY" in runenv:
    out["test_bounties"][runenv["UBOUNTY"]] = "Test bounty: made for trying the wallet flow by hand. Not a demo."
if "CBOUNTY" in runenv:
    out["test_bounties"][runenv["CBOUNTY"]] = "Test bounty: made for the scripted run of the site with the NEAR CLI wallet."
# The test bounty for the model-driven agent's real run (scripts/agent_testnet.sh bounty)
agentenv = dict(l.strip().split("=", 1) for l in open(os.path.join(ROOT, "docs/evidence/agent/run.env")) if "=" in l)
out["new_module_bounties"] = {}
out["new_module_programs"] = {}
if "NBOUNTY" in agentenv:
    out["new_module_bounties"][agentenv["NBOUNTY"]] = "Private bounty, new module: the secret input and the reference fix are not in the repository, and the program (data/unpack/) is new, with no hint at its bug."
    out["new_module_programs"][agentenv["NBOUNTY"]] = "data/unpack/"
for _m in NEW_MODULES:
    _env = os.path.join(ROOT, f"docs/evidence/{_m}/run.env")
    _n = dict(l.strip().split("=", 1) for l in open(_env) if "=" in l).get("NBOUNTY") if os.path.exists(_env) else None
    if _n:
        out["new_module_bounties"][_n] = f"Private bounty, new module: the secret input and the reference fix are not in the repository, and the program (data/{_m}/) is new, with no hint at its bug."
        out["new_module_programs"][_n] = f"data/{_m}/"
if "ABOUNTY" in agentenv:
    out["test_bounties"][agentenv["ABOUNTY"]] = "Test bounty: made for the real run of the model-driven agent (agent/)."

out["test_bounties"]["25"] = "Test bounty: made for the live test of the per-account cap (max_commits_per_account 1). Not a demo."
out["test_bounties"]["26"] = "Test bounty: made for the agent access tests (AGENTS.md followed literally, and the MCP server). Not a demo."
out["test_bounties"]["32"] = "Test bounty: made for the vendor tool's end to end test (tools/skarbnik-vendor watch proves its attempt on a rented GPU with no one's help). Its secret is private, made on the vendor's VPS, but the program is the public demo."
if ARENA_BOUNTY:
    out["test_bounties"][ARENA_BOUNTY] = "Test bounty: made for the arena's guarded probe run (a seeded probe account sent 12 commits; the cap counted 3). Not a demo."
out["judge_bounties"] = {str(j): "Judge bounty: the same hashes as private bounty 17, created closed; anyone can open it once with bounty 17's stored Proof 0 (docs/evidence/receipts/), and the contract checks that proof itself." for j in JUDGE_IDS}
out["judge_bounties"].update({str(j): "Retired judge bounty (round 1, K = 3, 24 h window): the same hashes as private bounty 17. Use judge bounties " + (f"{JUDGE_IDS_2[0]} to {JUDGE_IDS_2[-1]}" if JUDGE_IDS_2 else "of round 2") + " instead. After its expiry anyone can call expire, which refunds the vendor." for j in JUDGE_IDS})
out["judge_bounties"].update({str(j): "Judge bounty (round 2): the same hashes as private bounty 17, created closed, K = 2 with at most 1 attempt per account, a 41 h verdict window; anyone can open it once with bounty 17's stored Proof 0 (docs/evidence/receipts/), and the contract checks that proof itself. The vendor's watch proves its attempts on a rented GPU." for j in JUDGE_IDS_2})
out["retired_judge_bounties"] = [str(j) for j in JUDGE_IDS]

dst = os.path.join(ROOT, "web/data/recorded.json")
with open(dst, "w") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
print(f"wrote {os.path.relpath(dst, ROOT)}: bounties with records {sorted(int(k) for k in out['bounties'])}, "
      f"{len(out['attacks_s6c'])} S6c attacks, {len(out['arena']['attempts'])} arena attempts, "
      f"{out['notes']['demo_public_tests']['count']} public tests", file=sys.stderr)
