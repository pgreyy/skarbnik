# Spike output (wrong output bugs): proves one run of the output checker on a rented GPU pod with tools/skarbnik_gpu.py
# and prints its times as JSON. It runs on the machine that holds the RunPod key, from a folder of its own, with its own
# GPU settings (pod name prefix, spend file, budget, binary cache), so it never touches the running watches' pods or
# files. Before it rents a pod it lets the running watches go first: it waits while a watch pod exists on the RunPod
# account or while one of the watched bounties has a revealed attempt that is not settled yet.
# Usage: python3 -I scripts/spike_output_gpu.py <gpu config json> <job json>
#   gpu config: {"gpu": {...settings of tools/skarbnik_gpu.py...}, "watched": [40, 41], "contract": ..., "rpc": ...}
#   job: the job of skarbnik_gpu.prove_on_gpu (name, module, patch, secret, salt, reference_fix, seed, sid, fuzz,
#        variants, image_id, workdir, bounty_id, index, proof0)
import base64, json, os, sys, time, urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
import skarbnik_gpu as gpu  # noqa: E402

WAIT_MAX_S = 3600


def log(m):
    print(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), m, flush=True)


def view(cfg, method, args):
    body = {'jsonrpc': '2.0', 'id': 's', 'method': 'query', 'params': {'request_type': 'call_function', 'finality': 'final',
            'account_id': cfg['contract'], 'method_name': method, 'args_base64': base64.b64encode(json.dumps(args).encode()).decode()}}
    req = urllib.request.Request(cfg['rpc'], data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(bytes(json.load(r)['result']['result']).decode())


def watches_busy(cfg, g):
    """Why the running watches need the GPU account now, or None."""
    pods = gpu.RunPod(g['api_key_file']).call('GET', '/pods')
    for p in pods if isinstance(pods, list) else pods.get('pods', []):
        if str(p.get('name', '')).startswith(gpu.POD_PREFIX):
            return f'watch pod {p.get("name")} is running'
    for bid in cfg.get('watched', []):
        b = view(cfg, 'get_bounty', {'bounty_id': str(bid)})
        if b and int(b.get('pending') or 0) > 0:
            return f'bounty {bid} has {b["pending"]} revealed attempt(s) waiting for a verdict'
    return None


def main():
    cfg, job = (json.load(open(p)) for p in sys.argv[1:3])
    g = gpu.settings(cfg)
    assert g['pod_prefix'] != gpu.POD_PREFIX, 'the spike needs its own pod name prefix'
    t0 = time.time()
    while (why := watches_busy(cfg, g)):
        if time.time() - t0 > WAIT_MAX_S:
            sys.exit(f'the watches stayed busy for {WAIT_MAX_S} s ({why}); no pod was started')
        log(f'waiting: {why}')
        time.sleep(60)
    os.makedirs(job['workdir'], mode=0o700, exist_ok=True)
    _, times = gpu.prove_on_gpu(cfg, job, log)
    times['waited_for_watches_s'] = round(time.time() - t0) if time.time() - t0 > 5 else 0
    json.dump(times, open(os.path.join(job['workdir'], 'times.json'), 'w'), indent=1)
    print(json.dumps(times))


if __name__ == '__main__':
    main()
