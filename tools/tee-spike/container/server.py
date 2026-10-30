#!/usr/bin/env python3
"""The sealed checker and prover that runs inside a Phala Cloud confidential VM (Intel TDX), for the confidential
proving spike (docs/evidence/tee_spike/).

On start it makes an X25519 key pair in memory, asks the dstack guest agent (/var/run/dstack.sock) for a TDX quote
whose report_data is sha256(public key) followed by 32 zero bytes, and serves:
  GET  /attestation   the public key, the quote, the event log and the VM config, so a vendor can check the hardware,
                      the key binding and the compose hash before sending anything
  GET  /info          the dstack app info (tcb_info holds the app compose the compose hash is taken over)
  POST /check         an encrypted request {secret, candidate, seed, ...}: runs the native checker (skarbnik-check) on
                      the candidate patch against the demo program, and returns PASS or FAIL plus the checker's log
  POST /prove         an encrypted request {secret, salt, candidate, bounty, seed, submission id, ...}: starts the RISC
                      Zero prove step (skarbnik-host prove) in the background
  POST /prove/status  an encrypted request: the prove job's state, its time so far and the end of its log
  GET  /prove/receipt the composite receipt once the job has finished (it holds no secret, only the journal)
  POST /fresh-quote   {nonce}: a new TDX quote with report_data = sha256(public key || nonce) followed by 32 zero
                      bytes, so the vendor can tell that the quote was made just now by the holder of that key
  POST /probe         {hosts}: from inside the VM, which TCP ports answer on the VM itself (the container's default
                      gateway) and on the given private addresses, with the first bytes each port sends (an SSH
                      server says "SSH-2.0..."), and what the container can reach (sockets, capabilities)
Requests are encrypted to the attested key: the vendor makes a one time X25519 key, both sides derive a key with
HKDF-SHA256, and the body is sealed with ChaCha20-Poly1305. Answers are sealed with a second key from the same
exchange, bound to the request, so only the holder of the attested private key could have written them.
The secret input and the salt are kept in RAM only (/dev/shm, a memory file system) and erased when the run ends.
"""
import base64, hashlib, ipaddress, json, os, re, shutil, socket, subprocess, threading, time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from dstack_sdk import DstackClient

MODULE = '/opt/skarbnik/demo'   # the public demo program and its public tests, baked into the image
WORK = '/work'                  # public files of a run (patch, receipt)
RAM = '/dev/shm/skv'            # the secret and the salt, in memory only
CHECK, HOST = '/opt/skarbnik/bin/skarbnik-check', '/opt/skarbnik/bin/skarbnik-host'
VERSION = 'skarbnik-tee-v1'

KEY = X25519PrivateKey.generate()
PUB = KEY.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
REPORT_DATA = hashlib.sha256(PUB).digest() + bytes(32)
STARTED = time.time()
dstack = DstackClient(timeout=60)
q = dstack.get_quote(REPORT_DATA)
ATTESTATION = {'version': VERSION, 'public_key': PUB.hex(), 'report_data': REPORT_DATA.hex(), 'quote': q.quote,
               'event_log': q.event_log, 'vm_config': getattr(q, 'vm_config', None)}
JOB = {'state': 'idle'}
LOCK = threading.Lock()


def kdf(shared, info):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=f'{VERSION} {info}'.encode()).derive(shared)


def open_request(body):
    """Decrypts {ephemeral_public_key, nonce, ciphertext}; returns (plaintext dict, response key, request digest)."""
    env = json.loads(body)
    eph = X25519PublicKey.from_public_bytes(bytes.fromhex(env['ephemeral_public_key']))
    shared = KEY.exchange(eph)
    ct = bytes.fromhex(env['ciphertext'])
    plain = ChaCha20Poly1305(kdf(shared, 'request')).decrypt(bytes.fromhex(env['nonce']), ct, PUB)
    return json.loads(plain), kdf(shared, 'response'), hashlib.sha256(ct).digest()


def seal_response(key, bound, obj):
    nonce = os.urandom(12)
    return {'nonce': nonce.hex(), 'ciphertext': ChaCha20Poly1305(key).encrypt(nonce, json.dumps(obj).encode(), bound).hex()}


def ram_dir():
    shutil.rmtree(RAM, ignore_errors=True)
    for d in (RAM, f'{RAM}/home', f'{RAM}/home/.kintsugi-salts'): os.makedirs(d, mode=0o700)
    return RAM


def wipe():
    for root, _, files in os.walk(RAM):
        for f in files:
            p = os.path.join(root, f)
            try:
                n = os.path.getsize(p)
                with open(p, 'r+b') as fh: fh.write(bytes(n))
            except OSError:
                pass
    shutil.rmtree(RAM, ignore_errors=True)


def put_secret(req):
    """Writes the secret (hex text, spaces allowed, as the checker reads it) to RAM; returns its path and its compact
    lower case hex (for the log guard)."""
    text = req['secret_hex'].strip()
    compact = re.sub(r'\s+', '', text)
    if not re.fullmatch(r'[0-9a-fA-F]{2,2048}', compact) or len(compact) % 2:
        raise ValueError('the secret is not hex')
    path = f'{ram_dir()}/exploit.hex'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); os.write(fd, text.encode() + b'\n'); os.close(fd)
    return path, compact.lower()


def put_patch(req):
    data = base64.b64decode(req['candidate_b64'])
    if len(data) > 4096: raise ValueError('the patch is larger than 4 KiB')
    os.makedirs(WORK, exist_ok=True)
    path = f'{WORK}/patch.wasm'; open(path, 'wb').write(data)
    return path, hashlib.sha256(data).hexdigest()


def scrub(text, secret):
    """The checker's log never names input bytes; this is a second guard that removes the secret's hex if it ever did."""
    for form in (secret, secret.upper()):
        if len(form) >= 8: text = text.replace(form, '<secret>')
    return text


def do_check(req):
    seed = req['seed']
    if not re.fullmatch(r'[0-9a-f]{64}', seed): raise ValueError('seed: 64 hex characters')
    with LOCK:
        try:
            exploit, secret = put_secret(req)
            patch, patch_sha = put_patch(req)
            t0 = time.time()
            r = subprocess.run([CHECK, 'check', '--candidate', patch, '--original', f'{MODULE}/original.wasm', '--tests', f'{MODULE}/public_tests.txt',
                                '--exploit', exploit, '--seed', seed, '--fuzz-count', str(int(req.get('fuzz', 16))), '--variants', str(int(req.get('variants', 32))),
                                '--explain'], capture_output=True, text=True, timeout=600)
            secs = round(time.time() - t0, 3)
            log = scrub(r.stdout + r.stderr, secret)
        finally:
            wipe()
    verdict = 'PASS' if r.returncode == 0 and log.startswith('PASS') else 'FAIL'
    return {'verdict': verdict, 'exit': r.returncode, 'log': log, 'patch_sha256': patch_sha, 'seed': seed, 'checker_seconds': secs,
            'secret_erased': not os.path.exists(RAM), 'public_key': PUB.hex()}


def prove_job(req, exploit, secret, patch):
    log_path = f'{WORK}/prove.log'
    argv = [HOST, 'prove', patch, '--bounty', req['bounty'], '--exploit', exploit, '--original', f'{MODULE}/original.wasm',
            '--tests', f'{MODULE}/public_tests.txt', '--fuzz-count', str(int(req['fuzz'])), '--variants', str(int(req['variants'])),
            '--po2', str(int(req['po2'])), '--seed', req['seed'], '--submission-id', req['submission_id'], '--out', f'{WORK}/u.bin']
    env = dict(os.environ, HOME=f'{RAM}/home', PATH=f'/opt/skarbnik/bin:{os.environ["PATH"]}', RISC0_DEV_MODE='0')
    t0 = time.time(); peak = 0
    try:
        with open(log_path, 'w') as log:
            p = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, env=env)
            JOB.update(state='proving', started=t0, pid=p.pid)
            while p.poll() is None:
                time.sleep(5)
                peak = max(peak, mem_used_mib()); JOB['peak_mem_used_mib'] = peak
        ok = p.returncode == 0 and os.path.exists(f'{WORK}/u.bin')
        JOB.update(state='done' if ok else 'failed', exit=p.returncode, prove_seconds=round(time.time() - t0, 1),
                   receipt_bytes=os.path.getsize(f'{WORK}/u.bin') if ok else 0,
                   receipt_sha256=hashlib.sha256(open(f'{WORK}/u.bin', 'rb').read()).hexdigest() if ok else None)
    except Exception as e:  # noqa: BLE001
        JOB.update(state='failed', error=str(e)[:300])
    finally:
        wipe()
        JOB['secret_erased'] = not os.path.exists(RAM)
        text = scrub(open(log_path).read(), secret) if os.path.exists(log_path) else ''
        open(log_path, 'w').write(text)


def mem_used_mib():
    m = {l.split(':')[0]: int(l.split()[1]) for l in open('/proc/meminfo')}
    return (m['MemTotal'] - m['MemAvailable']) // 1024


def do_prove(req):
    for k, pat in (('bounty', r'[A-Za-z0-9._-]{1,64}'), ('seed', r'[0-9a-f]{64}'), ('submission_id', r'[0-9a-f]{64}'), ('salt_b64', r'[A-Za-z0-9+/=]{44}')):
        if not re.fullmatch(pat, str(req.get(k, ''))): raise ValueError(f'{k}: bad format')
    if JOB['state'] in ('starting', 'proving'): raise ValueError('a prove job is already running')
    try:
        exploit, secret = put_secret(req)
        salt = base64.b64decode(req['salt_b64'])
        if len(salt) != 32: raise ValueError('salt: 32 bytes')
        fd = os.open(f'{RAM}/home/.kintsugi-salts/{req["bounty"]}.salt', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); os.write(fd, salt); os.close(fd)
        patch, patch_sha = put_patch(req)
    except Exception:
        wipe(); raise
    JOB.clear(); JOB.update(state='starting', patch_sha256=patch_sha, seed=req['seed'], submission_id=req['submission_id'], bounty=req['bounty'])
    threading.Thread(target=prove_job, args=(req, exploit, secret, patch), daemon=True).start()
    return {'state': 'started', 'patch_sha256': patch_sha}


def fresh_quote(req):
    nonce = bytes.fromhex(req['nonce'])
    if len(nonce) != 32: raise ValueError('nonce: 32 bytes as hex')
    rd = hashlib.sha256(PUB + nonce).digest() + bytes(32)
    t0 = time.time(); fq = dstack.get_quote(rd)
    return {'version': VERSION, 'public_key': PUB.hex(), 'nonce': nonce.hex(), 'report_data': rd.hex(), 'quote': fq.quote,
            'event_log': fq.event_log, 'quote_seconds': round(time.time() - t0, 3), 'uptime_seconds': round(time.time() - STARTED)}


def default_gateway():
    for line in open('/proc/net/route').read().splitlines()[1:]:
        f = line.split()
        if f[1] == '00000000': return socket.inet_ntoa(bytes.fromhex(f[2])[::-1])


def port_open(host, port):
    try:
        with socket.create_connection((host, port), timeout=0.5) as c:
            if c.getsockname() == c.getpeername(): return None  # a TCP self-connect on loopback, not a listener
            c.settimeout(1.5)
            try: banner = c.recv(120)
            except OSError: banner = b''
            return port, banner.decode('latin-1')
    except OSError:
        return None


def probe(req):
    gw = default_gateway(); hosts = [gw] if gw else []
    for h in req.get('hosts', []):
        if ipaddress.ip_address(h).is_private and h not in hosts: hosts.append(h)
    t0 = time.time(); found = {}
    with ThreadPoolExecutor(max_workers=256) as ex:
        for h in hosts:
            found[h] = [{'port': p, 'first_bytes': b} for r in ex.map(lambda p: port_open(h, p), range(1, 65536)) if r for p, b in [r]]
    status = dict(l.split(':\t', 1) for l in open('/proc/self/status').read().splitlines() if ':\t' in l)
    return {'scanned': hosts, 'ports_1_to_65535_open': found, 'scan_seconds': round(time.time() - t0, 1),
            'container_sockets': {p: os.path.exists(p) for p in ('/var/run/dstack.sock', '/var/run/docker.sock', '/var/run/tappd.sock')},
            'container_capabilities_effective': status.get('CapEff', '').strip(), 'container_user': os.getuid()}


def job_status(_req):
    s = {k: v for k, v in JOB.items() if k != 'pid'}
    if 'started' in s: s['elapsed_seconds'] = round((s.get('prove_seconds') or time.time() - s['started']), 1)
    if os.path.exists(f'{WORK}/prove.log'):
        s['log_tail'] = open(f'{WORK}/prove.log').read()[-1500:] if JOB['state'] != 'proving' else '(hidden while the secret is in use)'
    s['mem_used_mib'] = mem_used_mib(); s['uptime_seconds'] = round(time.time() - STARTED)
    return s


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, obj, ctype='application/json'):
        data = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(data))); self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *a):  # one line per request, no bodies
        print(f'{time.strftime("%H:%M:%S")} {self.command} {self.path} {a[1] if len(a) > 1 else ""}', flush=True)

    def do_GET(self):
        if self.path == '/attestation': return self.reply(200, ATTESTATION)
        if self.path == '/info':
            info = dstack.info()
            return self.reply(200, info.model_dump() if hasattr(info, 'model_dump') else info)
        if self.path == '/prove/receipt':
            if JOB.get('state') != 'done': return self.reply(409, {'error': f'no receipt (job {JOB.get("state")})'})
            return self.reply(200, open(f'{WORK}/u.bin', 'rb').read(), 'application/octet-stream')
        if self.path == '/': return self.reply(200, {'service': VERSION, 'endpoints': ['/attestation', '/info', '/check', '/prove', '/prove/status', '/prove/receipt', '/fresh-quote', '/probe']})
        return self.reply(404, {'error': 'not found'})

    def do_POST(self):
        plain = {'/fresh-quote': fresh_quote, '/probe': probe}.get(self.path)
        if plain:  # public requests: no secret goes in or out
            try: return self.reply(200, plain(json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')))
            except Exception as e:  # noqa: BLE001
                return self.reply(400, {'error': str(e)[:300]})
        fn = {'/check': do_check, '/prove': do_prove, '/prove/status': job_status}.get(self.path)
        if not fn: return self.reply(404, {'error': 'not found'})
        try:
            req, rkey, bound = open_request(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        except Exception:  # noqa: BLE001
            return self.reply(400, {'error': 'could not open the request (wrong key or damaged)'})
        try:
            out = fn(req)
        except Exception as e:  # noqa: BLE001
            out = {'error': str(e)[:300]}
        return self.reply(200, seal_response(rkey, bound, out))


if __name__ == '__main__':
    print(f'{VERSION}: public key {PUB.hex()}, report_data {REPORT_DATA.hex()[:64]}..., quote {len(q.quote) // 2} bytes', flush=True)
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
