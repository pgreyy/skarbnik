#!/usr/bin/env python3
"""The vendor's side of the confidential proving spike: check the sealed checker's attestation, then send it a secret
encrypted to its attested key, and read the sealed answer. Runs on the vendor machine (the project VPS), inside the
vendor tools container (tools/tee-spike/Dockerfile.vendor: cryptography and dcap-qvl, pinned with hashes).

Commands (all write their results as JSON into the output folder; no secret is ever written or printed):
  verify  <url> <compose.yaml> <deploy.json> <image ref> <out>
          1. fetches /attestation and /info from the CVM
          2. checks the TDX quote locally with dcap-qvl against Intel's certificates (collateral from Intel PCS)
          3. asks Phala's public verifier as a second opinion (POST /api/v1/attestations/verify)
          4. report_data == sha256(attested public key) followed by 32 zero bytes
          5. replays RTMR3 from the event log (each event's digest recomputed) and compares it with the quote
          6. the compose-hash event == sha256(app_compose from /info) == the compose hash Phala gave at deploy, and
             app_compose holds our compose file byte for byte, which names our image by its sha256 digest
  check   <url> <out> <secret file> <patch.wasm> <tag>     one checker run (POST /check) after a passed verify
  prove   <url> <out> <secret file> <salt file> <patch.wasm> <job.json>   start the prove step (POST /prove)
  status  <url> <out>                                      the prove job's state (POST /prove/status)
  receipt <url> <out> <path>                               download the composite receipt
"""
import asyncio, base64, hashlib, inspect, json, os, sys, time, urllib.request

import dcap_qvl
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

VERSION = 'skarbnik-tee-v1'
UA = {'User-Agent': 'skarbnik-tee-spike/1'}


def utc(): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def get(url, raw=False, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        data = r.read(); return data if raw else json.loads(data)


def post(url, obj, timeout=900):
    req = urllib.request.Request(url, data=json.dumps(obj).encode(), headers={**UA, 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.loads(r.read())


def save(out, name, obj):
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, name), 'w') as f: json.dump(obj, f, indent=1, default=str)


# ---------------------------------------------------------------- quote fields (TDX quote v4, TD report 1.0)
HEADER = 48
FIELDS = {'mr_td': (136, 48), 'rtmr0': (328, 48), 'rtmr1': (376, 48), 'rtmr2': (424, 48), 'rtmr3': (472, 48), 'report_data': (520, 64)}


def quote_fields(q):
    return {k: q[HEADER + o:HEADER + o + n].hex() for k, (o, n) in FIELDS.items()} | {'version': int.from_bytes(q[0:2], 'little'), 'tee_type': q[4:8].hex()}


def event_digest_variants(e):
    payload = bytes.fromhex(e.get('event_payload', '') or '')
    name = (e.get('event') or '').encode()
    t = int(e.get('event_type', 0))
    return {'type_le32:name:payload': hashlib.sha384(t.to_bytes(4, 'little') + b':' + name + b':' + payload).hexdigest(),
            'name:payload': hashlib.sha384(name + b':' + payload).hexdigest(), 'payload': hashlib.sha384(payload).hexdigest()}


def replay_rtmr3(events):
    rtmr, checked, rule = bytes(48), [], None
    for e in events:
        if int(e.get('imr', -1)) != 3: continue
        d = bytes.fromhex(e['digest'])
        variants = event_digest_variants(e)
        match = [k for k, v in variants.items() if v == e['digest']]
        rule = rule or (match[0] if match else None)
        checked.append({'event': e.get('event'), 'digest_recomputed': bool(match), 'rule': match[0] if match else None})
        rtmr = hashlib.sha384(rtmr + d.ljust(48, b'\0')).digest()
    return rtmr.hex(), checked


def cmd_verify(url, compose_path, deploy_path, image_ref, out):
    url = url.rstrip('/'); res = {'at': utc(), 'url': url, 'checks': {}}
    att = get(f'{url}/attestation'); info = get(f'{url}/info')
    save(out, 'attestation.json', att); save(out, 'info.json', info)
    q = bytes.fromhex(att['quote'])
    res['quote_bytes'] = len(q); res['quote_sha256'] = hashlib.sha256(q).hexdigest()
    f = quote_fields(q); res['quote_fields'] = f
    c = res['checks']
    # 2. local check against Intel's certificates
    try:
        coll = dcap_qvl.get_collateral_from_pcs(q)
        if inspect.isawaitable(coll): coll = asyncio.run(coll)  # an async function in dcap-qvl's Python package
        rep = dcap_qvl.verify(q, coll, int(time.time()))
        if inspect.isawaitable(rep): rep = asyncio.run(rep)
        r = json.loads(rep.to_json()) if hasattr(rep, 'to_json') else {k: getattr(rep, k) for k in dir(rep) if not k.startswith('_') and not callable(getattr(rep, k))}
        save(out, 'dcap_qvl_report.json', r)
        status = r.get('status')
        c['tdx_quote_dcap_qvl'] = {'ok': status in ('UpToDate', 'SWHardeningNeeded', 'ConfigurationNeeded', 'ConfigurationAndSWHardeningNeeded'),
                                   'status': status, 'advisory_ids': r.get('advisory_ids'), 'dcap_qvl': dcap_qvl.__version__ if hasattr(dcap_qvl, '__version__') else '0.6.6'}
    except Exception as e:  # noqa: BLE001
        c['tdx_quote_dcap_qvl'] = {'ok': False, 'error': str(e)[:400]}
    # 3. Phala's public verifier
    try:
        pv = post('https://cloud-api.phala.com/api/v1/attestations/verify', {'hex': att['quote']}, timeout=120)
        save(out, 'phala_verify.json', pv)
        c['tdx_quote_phala_api'] = {'ok': bool(pv.get('quote', {}).get('verified')), 'verified': pv.get('quote', {}).get('verified')}
    except Exception as e:  # noqa: BLE001
        c['tdx_quote_phala_api'] = {'ok': False, 'error': str(e)[:400]}
    # 4. the key binding
    pub = bytes.fromhex(att['public_key'])
    want = (hashlib.sha256(pub).digest() + bytes(32)).hex()
    c['report_data_binds_key'] = {'ok': f['report_data'] == want, 'quote_report_data': f['report_data'], 'sha256_public_key_plus_zeros': want}
    # 5. RTMR3 replay
    events = json.loads(att['event_log']) if isinstance(att['event_log'], str) else att['event_log']
    rtmr3, ev = replay_rtmr3(events)
    c['rtmr3_replay'] = {'ok': rtmr3 == f['rtmr3'] and all(x['digest_recomputed'] for x in ev), 'replayed': rtmr3, 'quote': f['rtmr3'], 'events': ev}
    # 6. compose hash and image
    app_compose = info['tcb_info']['app_compose'] if isinstance(info['tcb_info'], dict) else json.loads(info['tcb_info'])['app_compose']
    calc = hashlib.sha256(app_compose.encode()).hexdigest()
    attested = next((e.get('event_payload') for e in events if e.get('event') == 'compose-hash'), None)
    dep = json.load(open(deploy_path))
    given = dep['provision'].get('compose_hash')
    ours = open(compose_path).read()
    ac = json.loads(app_compose)
    c['compose_hash'] = {'ok': calc == attested == given, 'sha256_app_compose': calc, 'event_log_compose_hash': attested, 'phala_deploy_compose_hash': given}
    c['compose_is_ours'] = {'ok': ac.get('docker_compose_file') == ours and image_ref in ours and '@sha256:' in image_ref,
                            'image': image_ref, 'compose_file_sha256': hashlib.sha256(ours.encode()).hexdigest()}
    for k in ('os_image_hash', 'compose_hash', 'app_id', 'instance_id', 'mr_aggregated', 'device_id'):
        if k in info: res.setdefault('dstack_info', {})[k] = info[k]
    res['ok'] = all(v['ok'] for v in c.values())
    res['public_key'] = att['public_key']
    save(out, 'verification.json', res)
    for k, v in c.items(): print(f'{"ok  " if v["ok"] else "FAIL"} {k}')
    print(f'{utc()} verification {"PASSED" if res["ok"] else "FAILED"}; quote sha256 {res["quote_sha256"][:16]}..., RTMR3 {f["rtmr3"][:16]}...')
    return res


# ---------------------------------------------------------------- sealed requests
def verified_key(out):
    v = json.load(open(os.path.join(out, 'verification.json')))
    if not v['ok']: sys.exit('REFUSED: the attestation did not pass; nothing is sent')
    return bytes.fromhex(v['public_key'])


def sealed_call(url, pub, path, obj, timeout=900):
    eph = X25519PrivateKey.generate()
    shared = eph.exchange(X25519PublicKey.from_public_bytes(pub))
    kdf = lambda info: HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=f'{VERSION} {info}'.encode()).derive(shared)
    nonce = os.urandom(12)
    ct = ChaCha20Poly1305(kdf('request')).encrypt(nonce, json.dumps(obj).encode(), pub)
    env = {'ephemeral_public_key': eph.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex(), 'nonce': nonce.hex(), 'ciphertext': ct.hex()}
    ans = post(url.rstrip('/') + path, env, timeout)
    plain = ChaCha20Poly1305(kdf('response')).decrypt(bytes.fromhex(ans['nonce']), bytes.fromhex(ans['ciphertext']), hashlib.sha256(ct).digest())
    return json.loads(plain), len(ct)


def cmd_check(url, out, secret_path, patch_path, tag):
    pub = verified_key(out)
    req = {'secret_hex': open(secret_path).read().strip(), 'candidate_b64': base64.b64encode(open(patch_path, 'rb').read()).decode(),
           'seed': os.urandom(32).hex(), 'fuzz': 16, 'variants': 32}
    t0 = time.time()
    ans, n = sealed_call(url, pub, '/check', req)
    ans.update(round_trip_seconds=round(time.time() - t0, 2), request_ciphertext_bytes=n, at=utc(), patch=os.path.basename(patch_path),
               secret_sha256_prefix=hashlib.sha256(req['secret_hex'].encode()).hexdigest()[:12], answer_authenticated=True)
    del req
    save(out, f'verdict_{tag}.json', ans)
    print(f'{utc()} {tag}: verdict {ans.get("verdict")} (patch {os.path.basename(patch_path)}, sha256 {ans.get("patch_sha256", "")[:16]}...), '
          f'checker {ans.get("checker_seconds")} s, round trip {ans["round_trip_seconds"]} s, secret erased in the CVM: {ans.get("secret_erased")}')


def cmd_prove(url, out, secret_path, salt_path, patch_path, job_path):
    pub = verified_key(out); job = json.load(open(job_path))
    req = dict(job, secret_hex=open(secret_path).read().strip(), salt_b64=base64.b64encode(open(salt_path, 'rb').read()).decode(),
               candidate_b64=base64.b64encode(open(patch_path, 'rb').read()).decode())
    ans, _ = sealed_call(url, pub, '/prove', req); del req
    save(out, 'prove_started.json', dict(ans, at=utc(), job=job)); print(f'{utc()} prove: {ans}')


def cmd_status(url, out):
    ans, _ = sealed_call(url, verified_key(out), '/prove/status', {})
    save(out, 'prove_status.json', dict(ans, at=utc()))
    print(f'{utc()} status: {json.dumps({k: v for k, v in ans.items() if k != "log_tail"})}')
    if ans.get('state') in ('done', 'failed'): print(ans.get('log_tail', '')[-800:])


def cmd_receipt(url, out, path):
    st = json.load(open(os.path.join(out, 'prove_status.json')))
    data = get(url.rstrip('/') + '/prove/receipt', raw=True, timeout=1800)
    h = hashlib.sha256(data).hexdigest()
    open(path, 'wb').write(data)
    save(out, 'receipt_download.json', {'at': utc(), 'bytes': len(data), 'sha256': h, 'matches_sealed_status': h == st.get('receipt_sha256')})
    print(f'{utc()} receipt: {len(data)} bytes, sha256 {h[:16]}..., matches the sealed status: {h == st.get("receipt_sha256")}')


if __name__ == '__main__':
    cmd, *a = sys.argv[1:] or ['help']
    fn = {'verify': cmd_verify, 'check': cmd_check, 'prove': cmd_prove, 'status': cmd_status, 'receipt': cmd_receipt}.get(cmd)
    if not fn: print(__doc__); sys.exit(1)
    fn(*a)
