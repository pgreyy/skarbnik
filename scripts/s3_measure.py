#!/usr/bin/env python3
"""Spike S3 measurements over NEAR testnet JSON-RPC (read only, no keys).

Subcommands:
  blocktime N OUT.json     fetch the last N+1 final blocks by height, report block intervals
  finality SAMPLES OUT.json sample the newest (optimistic) and the final block, report the lag
  gas TSV OUT.tsv          look up every transaction hash in TSV and sum the gas burned per receipt
  sendfinal SIGNED.json WAIT   send one signed transaction with wait_until=WAIT, print wall seconds
  sendtx SIGNED.json WAIT  send one signed transaction, print its id, outcome, failure and gas
  rtt N                    time N tiny RPC calls (network round trip baseline)

All requests go through `curl -4` because IPv6 does not connect on the dev machine.
"""
import json
import statistics
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

RPC = "https://test.rpc.fastnear.com"
ARCHIVAL_RPC = "https://archival-rpc.testnet.fastnear.com"


def rpc(method, params, url=RPC, timeout=120):
    body = json.dumps({"jsonrpc": "2.0", "id": "s3", "method": method, "params": params})
    for attempt in range(5):
        p = subprocess.run(
            ["curl", "-4", "-s", "--max-time", str(timeout), url, "-H", "Content-Type: application/json", "-d", body],
            capture_output=True, text=True,
        )
        if p.returncode == 0 and p.stdout:
            r = json.loads(p.stdout)
            if "result" in r or attempt == 4:
                return r
        time.sleep(2)
    return {"error": "no response"}


def summary(xs):
    xs = sorted(xs)
    return {
        "count": len(xs),
        "mean": statistics.mean(xs),
        "median": statistics.median(xs),
        "min": xs[0],
        "max": xs[-1],
        "p95": xs[min(len(xs) - 1, int(round(0.95 * (len(xs) - 1))))],
    }


def blocktime(n, out):
    top = rpc("block", {"finality": "final"})["result"]["header"]
    h_top = top["height"]
    heights = list(range(h_top - n, h_top + 1))

    def get(h):
        r = rpc("block", {"block_id": h})
        if "result" not in r:
            return h, None
        hd = r["result"]["header"]
        return h, {"height": hd["height"], "ts": int(hd["timestamp_nanosec"]), "hash": hd["hash"]}

    with ThreadPoolExecutor(6) as ex:
        got = dict(ex.map(get, heights))
    blocks = [got[h] for h in heights if got[h]]
    missing = [h for h in heights if not got[h]]
    gaps = [(b["ts"] - a["ts"]) / 1e9 for a, b in zip(blocks, blocks[1:])]
    span_s = (blocks[-1]["ts"] - blocks[0]["ts"]) / 1e9
    res = {
        "rpc": RPC,
        "method": "block by height for every height from final_height-N to final_height",
        "measured_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "first_height": blocks[0]["height"],
        "last_height": blocks[-1]["height"],
        "blocks_fetched": len(blocks),
        "heights_without_block": missing,
        "span_seconds": span_s,
        "seconds_per_height": span_s / (blocks[-1]["height"] - blocks[0]["height"]),
        "seconds_per_produced_block": span_s / (len(blocks) - 1),
        "interval_seconds": summary(gaps),
        "blocks": blocks,
    }
    json.dump(res, open(out, "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "blocks"}, indent=1))


def finality(samples, out):
    rows = []
    for _ in range(samples):
        t0 = time.time()
        opt = rpc("block", {"finality": "optimistic"})["result"]["header"]
        fin = rpc("block", {"finality": "final"})["result"]["header"]
        # Structural lag, independent of query timing: the newest block names its last final block.
        lfb = rpc("block", {"block_id": opt["last_final_block"]})["result"]["header"]
        rows.append({
            "wall_utc": t0,
            "optimistic_height": opt["height"],
            "final_height": fin["height"],
            "height_lag": opt["height"] - fin["height"],
            "time_lag_s": (int(opt["timestamp_nanosec"]) - int(fin["timestamp_nanosec"])) / 1e9,
            "head_last_final_height": lfb["height"],
            "head_to_last_final_height_lag": opt["height"] - lfb["height"],
            "head_to_last_final_time_lag_s": (int(opt["timestamp_nanosec"]) - int(lfb["timestamp_nanosec"])) / 1e9,
        })
        time.sleep(1.5)
    res = {
        "rpc": RPC,
        "method": ("(a) query block finality=optimistic then finality=final (two calls, so the head may move "
                   "between them); (b) structural: the optimistic head's header field last_final_block, looked "
                   "up by hash; lag = difference of heights and header timestamps"),
        "height_lag": summary([r["height_lag"] for r in rows]),
        "time_lag_s": summary([r["time_lag_s"] for r in rows]),
        "head_to_last_final_height_lag": summary([r["head_to_last_final_height_lag"] for r in rows]),
        "head_to_last_final_time_lag_s": summary([r["head_to_last_final_time_lag_s"] for r in rows]),
        "samples": rows,
    }
    json.dump(res, open(out, "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "samples"}, indent=1))


def gas(tsv, out):
    lines = [l.rstrip("\n").split("\t") for l in open(tsv)][1:]
    rows = []
    for step, method, signer, h, *_ in lines:
        if h == "-":
            continue
        r = rpc("EXPERIMENTAL_tx_status", {"tx_hash": h, "sender_account_id": signer, "wait_until": "FINAL"}, url=ARCHIVAL_RPC)
        if "result" not in r:
            rows.append([step, method, signer, h, "lookup_failed", "", "", "", ""])
            continue
        res = r["result"]
        tx_gas = res["transaction_outcome"]["outcome"]["gas_burnt"]
        rec = [o["outcome"]["gas_burnt"] for o in res["receipts_outcome"]]
        status = res["status"]
        ok = "SuccessValue" in status or "SuccessReceiptId" in status
        fail = json.dumps(status.get("Failure"))[:200] if "Failure" in status else ""
        prepaid = None
        for a in res["transaction"]["actions"]:
            if isinstance(a, dict) and "FunctionCall" in a:
                prepaid = a["FunctionCall"]["gas"]
        rows.append([step, method, signer, h, "ok" if ok else "failed", str(tx_gas + sum(rec)),
                     str(rec[0] if rec else 0), str(prepaid or ""), fail])
        time.sleep(0.3)
    with open(out, "w") as f:
        f.write("step\tmethod\tsigner\ttx_hash\tstatus\ttotal_gas_burnt\tfirst_receipt_gas_burnt\tprepaid_gas\tfailure\n")
        for row in rows:
            f.write("\t".join(row) + "\n")
    for row in rows:
        tg = int(row[5]) / 1e12 if row[5] else 0
        print(f"{row[0]:28s} {row[1]:22s} {row[4]:7s} total={tg:.4f} Tgas  {row[8][:80]}")


def sendfinal(signed_path, wait):
    signed = json.load(open(signed_path))["signed_transaction_as_base64"]
    t0 = time.time()
    r = rpc("send_tx", {"signed_tx_base64": signed, "wait_until": wait}, timeout=120)
    t1 = time.time()
    res = r.get("result", {})
    tx = res.get("transaction", {})
    print(json.dumps({
        "wait_until": wait,
        "wall_seconds": round(t1 - t0, 3),
        "tx_hash": tx.get("hash"),
        "final_execution_status": res.get("final_execution_status"),
        "error": r.get("error"),
    }))


def sendtx(signed_path, wait):
    signed = json.load(open(signed_path))["signed_transaction_as_base64"]
    t0 = time.time()
    r = rpc("send_tx", {"signed_tx_base64": signed, "wait_until": wait}, timeout=120)
    t1 = time.time()
    res = r.get("result", {})
    status = res.get("status", {})
    failure = ""
    if "Failure" in status:
        failure = json.dumps(status["Failure"])
    gas = res.get("transaction_outcome", {}).get("outcome", {}).get("gas_burnt", 0) + sum(
        o["outcome"]["gas_burnt"] for o in res.get("receipts_outcome", []))
    logs = [l for o in res.get("receipts_outcome", []) for l in o["outcome"]["logs"]]
    print(json.dumps({
        "tx_hash": res.get("transaction", {}).get("hash"),
        "outcome": "failed" if failure else ("ok" if res else "no_result"),
        "failure": failure.replace('"', "'"),
        "total_gas_burnt": gas,
        "logs": logs,
        "wall_seconds": round(t1 - t0, 3),
        "rpc_error": r.get("error"),
    }, indent=1))


def rtt(n):
    xs = []
    for _ in range(n):
        t0 = time.time()
        rpc("gas_price", [None])
        xs.append(time.time() - t0)
    print(json.dumps({"rpc": RPC, "call": "gas_price", "round_trip_seconds": summary(xs)}))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "blocktime":
        blocktime(int(sys.argv[2]), sys.argv[3])
    elif cmd == "finality":
        finality(int(sys.argv[2]), sys.argv[3])
    elif cmd == "gas":
        gas(sys.argv[2], sys.argv[3])
    elif cmd == "sendfinal":
        sendfinal(sys.argv[2], sys.argv[3])
    elif cmd == "sendtx":
        sendtx(sys.argv[2], sys.argv[3])
    elif cmd == "rtt":
        rtt(int(sys.argv[2]))
    else:
        sys.exit(__doc__)
