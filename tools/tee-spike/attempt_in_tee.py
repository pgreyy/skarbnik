#!/usr/bin/env python3
"""Part 2 of the confidential proving spike: prove one revealed attempt of a test bounty with the RISC Zero prove step
running inside a Phala Cloud TDX CVM, shrink it on a RunPod GPU, then wrap to Groth16 and submit it from the vendor
machine (the VPS).

Steps, each logged to <out>/run.log with its time:
  1. read the attempt from the chain (its patch, seed and submission id), as skarbnik-vendor's watch does
  2. deploy the CVM (phala.py deploy, tdx.xlarge by default), wait until it answers
  3. vendor.py verify: the six attestation checks; nothing is sent unless all pass
  3b. who could log in: phala.py logins (SSH keys in the user config and on the account; the gateway's SSH route
      from outside) and vendor.py probe (every TCP port of the VM, seen from inside)
  3c. vendor.py fresh: a new quote bound to a random nonce made just now, checked the same way
  4. vendor.py prove: the secret input and the bounty's salt, sealed to the attested key, plus the public job
  5. every 2 minutes: the sealed job status and the Phala balance; the CVM is deleted at once when the receipt is out,
     when the job fails, when the balance reaches the floor (the owner's cap), or on any error (always, in `finally`)
  6. shrink to succinct on a RunPod GPU pod (no secret goes there); then on the VPS: Groth16 wrap, verify, check the
     journal (the bounty's secret commitment, the attempt's submission id), and submit_groth16 from the submit account
Usage: attempt_in_tee.py <config.toml> <bounty id> <attempt index> <out dir> [instance type]
The secret and the salt are passed to the vendor tools container as read only files; they are never printed.
"""
import base64, importlib.machinery, importlib.util, json, os, re, subprocess, sys, time

HOME = os.path.expanduser('~')
TEE = f'{HOME}/skarbnik-tee'
ROOT = f'{HOME}/skarbnik'
FLOOR_USD = 1.05  # stop above the $1.00 floor ($5 credit, $4 cap), with a little room for the last minutes billed


def load_vendor_tool():
    loader = importlib.machinery.SourceFileLoader('skv', f'{ROOT}/tools/skarbnik-vendor')
    spec = importlib.util.spec_from_loader('skv', loader); m = importlib.util.module_from_spec(spec); loader.exec_module(m)
    return m


def main(cfg_path, bid, idx, out, itype='tdx.xlarge'):
    skv = load_vendor_tool()
    os.makedirs(out, exist_ok=True); log_path = f'{out}/run.log'

    def log(msg):
        line = f'{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} {msg}'
        print(line, flush=True); open(log_path, 'a').write(line + '\n')

    def run(argv, **kw):
        r = subprocess.run(argv, capture_output=True, text=True, **kw)
        text = (r.stdout + r.stderr).strip()
        open(log_path, 'a').write(f'$ {" ".join(a if not a.startswith(HOME) else "~" + a[len(HOME):] for a in argv)}\n{text}\n')
        return r.returncode, text

    def balance():
        _, t = run(['python3', f'{TEE}/vendor/phala.py', 'balance'], cwd=out)
        m = re.search(r'balance \$([\d.]+)', t); return float(m.group(1)) if m else None

    cfg = skv.load(cfg_path); e = cfg['bounties'][0]
    b, subs = skv.attempts(cfg, bid); s = subs[int(idx)]
    sid = skv.view(cfg, 'get_submission_id', {'bounty_id': bid, 'index': int(idx)})
    if s['outcome'] != 'Open' or not s.get('patch'): sys.exit(f'attempt {idx} of bounty {bid} is not a revealed open attempt')
    patch = f'{out}/patch.wasm'; open(patch, 'wb').write(base64.b64decode(s['patch']))
    job = {'bounty': e['name'], 'seed': s['seed'], 'submission_id': sid, 'fuzz': b['fuzz_count'], 'variants': b['variant_count'], 'po2': int(e.get('po2', 18))}
    json.dump(job, open(f'{out}/job.json', 'w'), indent=1)
    open(f'{out}/compose.yaml', 'w').write(open(f'{TEE}/vendor/compose.yaml').read())
    log(f'bounty {bid} attempt {idx}: patch sha256 {skv.sha_file(patch)}, seed {s["seed"]}, submission id {sid}, deadline {s["deadline_ns"]}')
    secret, salt = os.path.expanduser(e['secret']), f'{HOME}/.kintsugi-salts/{e["name"]}.salt'
    # Name lookups for Intel's certificate service fail inside the container on this VPS (they work on the VPS itself):
    # resolve them here and pass the addresses in. TLS still checks each hostname, so this changes no trust.
    import socket
    hosts = []
    for h in ('api.trustedservices.intel.com', 'pccs.phala.network', 'cloud-api.phala.com'):
        try: hosts += ['--add-host', f'{h}:{socket.gethostbyname(h)}']
        except OSError: pass
    vend = ['docker', 'run', '--rm', '--network', 'host', *hosts, '-v', f'{TEE}:/w', '-v', f'{secret}:/s/secret.hex:ro', '-v', f'{salt}:/s/salt:ro', '-w', '/w', 'skarbnik-tee-vendor:local']
    rel = os.path.relpath(out, TEE)

    b0 = balance(); log(f'Phala balance before: ${b0}')
    name = 'skarbnik-tee-prove'
    code, t = run(['python3', f'{TEE}/vendor/phala.py', 'deploy', name, f'{TEE}/vendor/compose.yaml', itype], cwd=out)
    log(f'deploy {itype}: exit {code}')
    if code: sys.exit('deploy failed; see run.log')
    dep = json.load(open(f'{out}/{name}.deploy.json')); vm = dep['vm']['vm_uuid']; created = time.time()
    t_receipt = None
    try:
        code, t = run(['python3', f'{TEE}/vendor/phala.py', 'wait', vm], cwd=out)
        urls = re.findall(r'(https://\S+-8080\.\S+?)/ answers HTTP 200', t)
        if code or not urls: raise RuntimeError('the CVM did not answer')
        url = urls[-1]; log(f'CVM running and answering at {url}, {round(time.time() - created)} s after create')
        code, t = run(vend + ['verify', url, f'{rel}/compose.yaml', f'{rel}/{name}.deploy.json', image_ref(), rel])
        log('verify: ' + ' | '.join(l for l in t.splitlines() if l[:4] in ('ok  ', 'FAIL') or 'verification' in l))
        if 'verification PASSED' not in t: raise RuntimeError('the attestation did not pass; nothing sent')
        code, t = run(['python3', f'{TEE}/vendor/phala.py', 'logins', vm, url], cwd=out)
        log('logins: ' + ' | '.join(l[21:] for l in t.splitlines()[-3:]))
        _, t = run(['python3', f'{TEE}/vendor/phala.py', 'show', vm], cwd=out)
        ips = re.findall(r'"internal_ip": "([0-9.]+)"', t)
        code, t = run(vend + ['probe', url, rel] + ips, timeout=1200)
        log('probe: ' + ' | '.join(t.splitlines()[-3:]))
        code, t = run(vend + ['fresh', url, rel])
        log('fresh quote: ' + ' | '.join(l for l in t.splitlines() if l[:4] in ('ok  ', 'FAIL') or 'fresh quote' in l))
        if 'fresh quote PASSED' not in t: raise RuntimeError('the fresh quote did not pass; nothing sent')
        code, t = run(vend + ['prove', url, rel, '/s/secret.hex', '/s/salt', f'{rel}/patch.wasm', f'{rel}/job.json'])
        log(f'prove sent: {t.splitlines()[-1] if t else code}')
        if "'started'" not in t: raise RuntimeError('the prove job did not start')
        while True:
            time.sleep(120)
            code, t = run(vend + ['status', url, rel])
            st = json.load(open(f'{out}/prove_status.json')) if os.path.exists(f'{out}/prove_status.json') else {}
            bal = balance()
            log(f'status {st.get("state")}, {st.get("elapsed_seconds")} s, memory used {st.get("mem_used_mib")} MiB (peak {st.get("peak_mem_used_mib")}), balance ${bal}')
            if bal is not None and bal <= FLOOR_USD: raise RuntimeError(f'the balance reached ${bal}, the floor: stopping (owner\'s cap)')
            if st.get('state') == 'failed': raise RuntimeError(f'the prove job failed: {st.get("error") or st.get("log_tail", "")[-300:]}')
            if st.get('state') == 'done':
                code, t = run(vend + ['receipt', url, rel, f'{rel}/u.bin'])
                log(t.splitlines()[-1] if t else f'receipt exit {code}')
                if 'matches the sealed status: True' not in t: raise RuntimeError('the receipt does not match the sealed status')
                t_receipt = time.time(); break
    finally:
        code, t = run(['python3', f'{TEE}/vendor/phala.py', 'delete', vm], cwd=out)
        log(f'CVM deleted ({round(time.time() - created)} s after create): ' + ' | '.join(l[21:] for l in t.splitlines()[-2:]))
        time.sleep(60); log(f'Phala balance after: ${balance()}')
    if not t_receipt: sys.exit('no receipt')

    # 6. secret free steps on the VPS, with skarbnik-vendor's own code
    w = out
    times = json.load(open(f'{out}/prove_status.json'))
    t0 = time.time()
    # the shrink runs on a RunPod GPU (the receipt holds no secret); the VPS proves nothing on its CPU
    gt = skv.gpu.shrink_on_gpu(cfg, f'{w}/u.bin', f'{w}/u_succinct.bin', f'b{bid}a{idx}shrink', b['image_id'], log)
    secs = gt['succinct']; json.dump(gt, open(f'{w}/gpu_shrink.json', 'w'), indent=1)
    log(f'succinct on a GPU pod: {secs} s ({gt["gpu"]}, pod {gt["pod_seconds"]} s, ${gt["cost_usd"]})')
    v, g = skv.wrap(cfg, w, 'u'); log(f'Groth16 on the VPS: {g} s; verify: {v.splitlines()[0] if v else ""}')
    if skv.journal(v, 'exploit_commitment') != b['exploit_commitment']: sys.exit('the secret commitment is not the bounty\'s: not submitting')
    if skv.journal(v, 'submission_id') != sid: sys.exit('the proof is for another submission id: not submitting')
    log(f'journal: verdict {skv.journal(v, "verdict")}, secret commitment matches the bounty, submission id matches')
    fresh = skv.view(cfg, 'get_submission', {'bounty_id': bid, 'index': int(idx)})
    if fresh['outcome'] != 'Open': sys.exit(f'already decided on chain: {fresh["outcome"]}')
    tx, ok, why = skv.send(cfg, cfg['chain']['submit_account'], 'submit_groth16', skv.proof_args(w, 'u', {'bounty_id': bid, 'index': int(idx)}), log=log_path)
    after = skv.view(cfg, 'get_submission', {'bounty_id': bid, 'index': int(idx)})
    log(f'submit_groth16 {tx} {"ok" if ok else "FAILED: " + why}; outcome on chain {after["outcome"]}')
    json.dump({'prove_in_cvm_s': times.get('prove_seconds'), 'cvm_life_s': round(t_receipt - created), 'succinct_s': secs, 'shrink_gpu': gt, 'groth16_s': g, 'tx': tx,
               'outcome': after['outcome'], 'vps_after_receipt_s': round(time.time() - t0)}, open(f'{out}/summary.json', 'w'), indent=1)


def image_ref():
    m = re.search(r'image: (\S+)', open(f'{TEE}/vendor/compose.yaml').read()); return m.group(1)


if __name__ == '__main__':
    if len(sys.argv) < 5: print(__doc__); sys.exit(1)
    main(*sys.argv[1:])
