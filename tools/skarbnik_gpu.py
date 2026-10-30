"""GPU proving for skarbnik-vendor: one RunPod pod per revealed attempt (watch), per Proof 0 (prove0 in mode gpu), or
per shrink of a receipt proved elsewhere (shrink_on_gpu: no secret goes to the pod).

For each attempt: check the spend cap, create a Secure Cloud pod (the GPU types and data centers of the config, in
order), wait for SSH, put the CUDA build of skarbnik-host on it (the VPS's cached copy, or build it there once and
keep it), copy the secret input and the bounty's salt into a RAM folder (/dev/shm) only, prove, wipe the secret right
after (whether the proof worked or not), verify, shrink to a succinct receipt on the GPU, fetch it, and terminate the
pod. The pod is terminated in every case, also on any failure, and no pod lives longer than the hard cap (45 minutes
by default): every step's time limit is cut to what is left. Pods this tool started and left behind (a crash) are
terminated at the next start. The Groth16 wrap and the submit stay on the vendor machine.

The RunPod API key is read from its file for each request and is never printed, logged, returned or copied. Each
pod's cost (its hourly price times its life from create to terminate) is logged and added to a spend file; no new pod
starts once the total reaches the budget. Python 3.11+, standard library only; ssh and scp on the PATH.
"""
import hashlib, json, os, re, shlex, subprocess, time, urllib.error, urllib.request
from datetime import datetime, timezone

API = 'https://rest.runpod.io/v1'
POD_PREFIX = 'skarbnik-watch-'
REMOTE_ENV = ('set -euo pipefail; export PATH=$HOME/.cargo/bin:$HOME/.risc0/bin:/usr/local/cuda/bin:$PATH; '
              'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:${LD_LIBRARY_PATH:-}; cd $HOME;')
WIPE = ('for f in /dev/shm/skv/exploit.hex /dev/shm/skv/salts/*.salt; do [ -f "$f" ] && shred -u -n 3 "$f"; done; '
        'rm -rf /dev/shm/skv; rm -f $HOME/.kintsugi-salts')
DEFAULTS = {
    'api_key_file': '~/.runpod_key', 'image': 'runpod/pytorch:1.4.1-cu1281-torch280-ubuntu2404',
    'gpu_types': ['NVIDIA L40S', 'NVIDIA RTX 6000 Ada Generation', 'NVIDIA RTX A6000'],
    'data_centers': ['EU-RO-1', 'EU-CZ-1', 'EU-SE-1', 'EU-NL-1', 'US-TX-3'], 'container_disk_gb': 60,
    'cap_minutes': 45, 'budget_usd': 6.0, 'spend_file': '~/skarbnik-vendor/gpu_spend.json',
    'ssh_key': '~/.skarbnik-vendor/pod_ed25519', 'binary_cache': '~/skarbnik/gpu/skarbnik-host-cuda',
    'src_tarball': '~/skarbnik/gpu/src.tar.gz', 'guests_dir': '~/skarbnik/gpu/prebuilt-guests', 'po2': 19,
    'rust': '1.99.1', 'risc0': '3.0.6',
}


class GpuError(Exception):
    """A failure of the GPU path; the attempt may fall back to CPU proving."""


class BudgetReached(GpuError):
    """The spend cap is reached: no new pod starts without the owner's say so."""


def settings(cfg):
    g = dict(DEFAULTS, **cfg.get('gpu', {}))
    for k in ('api_key_file', 'spend_file', 'ssh_key', 'binary_cache', 'src_tarball', 'guests_dir'):
        g[k] = os.path.expanduser(g[k])
    return g


def utc(t=None):
    return datetime.fromtimestamp(t or time.time(), timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# ---------------------------------------------------------------- RunPod REST API
class RunPod:
    def __init__(self, key_file):
        self.key_file = key_file
        if not os.path.isfile(key_file):
            raise GpuError('the RunPod API key file is missing (set gpu.api_key_file)')
        if os.stat(key_file).st_mode & 0o077:
            raise GpuError('the RunPod API key file is readable by other users: chmod 600 it')

    def _redact(self, text):
        with open(self.key_file) as f:
            k = f.read().strip()
        return re.sub(r'rpa_[A-Za-z0-9]+', '<key>', text.replace(k, '<key>') if k else text)

    def call(self, method, path, body=None, timeout=60):
        with open(self.key_file) as f:
            auth = 'Bearer ' + f.read().strip()
        req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={'Authorization': auth, 'Content-Type': 'application/json', 'User-Agent': 'skarbnik-vendor/1.0'})
        del auth
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
            return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            raise GpuError(f'RunPod {method} {path}: HTTP {e.code} {self._redact(e.read().decode(errors="replace"))[:300]}') from None
        except (OSError, ValueError) as e:
            raise GpuError(f'RunPod {method} {path}: {self._redact(str(e))[:200]}') from None


# ---------------------------------------------------------------- spend
def spend_load(g):
    if not os.path.exists(g['spend_file']):
        return {'pods': []}
    with open(g['spend_file']) as f:
        return json.load(f)


def spend_total(g):
    return round(sum(p.get('cost_usd') or 0 for p in spend_load(g)['pods']), 4)


def spend_record(g, rec):
    d = spend_load(g)
    d['pods'] = [p for p in d['pods'] if p['id'] != rec['id']] + [rec]
    d['total_usd'] = round(sum(p.get('cost_usd') or 0 for p in d['pods']), 4)
    tmp = g['spend_file'] + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(d, f, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, g['spend_file'])
    return d['total_usd']


# ---------------------------------------------------------------- one pod
class Pod:
    def __init__(self, g, rp, log, label):
        self.g, self.rp, self.log, self.label = g, rp, log, label
        self.id = self.host = self.port = None
        self.t0 = time.time()
        self.deadline = self.t0 + 60 * float(g['cap_minutes'])
        self.rec = None

    def left(self):
        return self.deadline - time.time()

    def create(self):
        pub = open(self.g['ssh_key'] + '.pub').read().strip()
        body = {'name': f'{POD_PREFIX}{self.label}-{int(self.t0)}', 'imageName': self.g['image'], 'cloudType': 'SECURE',
                'computeType': 'GPU', 'gpuCount': 1, 'gpuTypeIds': list(self.g['gpu_types']), 'gpuTypePriority': 'custom',
                'containerDiskInGb': int(self.g['container_disk_gb']), 'volumeInGb': 0, 'ports': ['22/tcp'],
                'supportPublicIp': True, 'env': {'PUBLIC_KEY': pub}}
        if self.g['data_centers']:  # an empty list lets RunPod pick any data center
            body.update(dataCenterIds=list(self.g['data_centers']), dataCenterPriority='custom')
        self.t0 = time.time()
        self.deadline = self.t0 + 60 * float(self.g['cap_minutes'])
        p = self.rp.call('POST', '/pods', body, timeout=120)
        self.id = p.get('id')
        if not self.id:
            raise GpuError(f'RunPod created no pod: {json.dumps(p)[:200]}')
        self.rec = {'id': self.id, 'label': self.label, 'created_utc': utc(self.t0), 'gpu': ((p.get('gpu') or {}).get('displayName') or (p.get('machine') or {}).get('gpuTypeId') or ((p.get('machine') or {}).get('gpuType') or {}).get('displayName')),
                    'data_center': (p.get('machine') or {}).get('dataCenterId'), 'cost_per_hr': p.get('adjustedCostPerHr') or p.get('costPerHr'),
                    'image': self.g['image'], 'terminated_utc': None, 'seconds': None, 'cost_usd': None}
        spend_record(self.g, self.rec)
        self.log(f'pod {self.id} created: {self.rec["gpu"]} in {self.rec["data_center"]}, ${self.rec["cost_per_hr"]}/h, hard cap {self.g["cap_minutes"]} min')

    def wait_ssh(self):
        while self.left() > 0:
            p = self.rp.call('GET', f'/pods/{self.id}')
            if not self.rec['gpu'] or not self.rec['cost_per_hr']:
                self.rec.update(gpu=self.rec['gpu'] or ((p.get('gpu') or {}).get('displayName') or (p.get('machine') or {}).get('gpuTypeId') or ((p.get('machine') or {}).get('gpuType') or {}).get('displayName')), cost_per_hr=self.rec['cost_per_hr'] or p.get('adjustedCostPerHr') or p.get('costPerHr'),
                                data_center=self.rec['data_center'] or (p.get('machine') or {}).get('dataCenterId'))
            ports = p.get('portMappings') or {}
            if p.get('publicIp') and ports.get('22'):
                self.host, self.port = p['publicIp'], int(ports['22'])
                try:
                    name = self.ssh('nvidia-smi --query-gpu=name --format=csv,noheader | head -1', 30).strip()
                    if name:
                        self.rec['gpu'] = name
                        spend_record(self.g, self.rec)
                    self.log(f'pod {self.id}: ssh ready after {round(time.time() - self.t0)} s, GPU {self.rec["gpu"]}')
                    return
                except GpuError:
                    pass
            time.sleep(10)
        raise GpuError('the pod did not come up within the hard cap')

    def _ssh_base(self):
        kh = os.path.join(os.path.dirname(self.g['ssh_key']), f'pod_known_hosts_{self.id}')
        return ['-i', self.g['ssh_key'], '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
                '-o', f'UserKnownHostsFile={kh}', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30', '-o', 'LogLevel=ERROR']

    def ssh(self, cmd, limit=None):
        t = min(limit or self.left(), self.left())
        if t <= 5:
            raise GpuError('the hard cap per pod is reached')
        try:
            p = subprocess.run(['ssh', *self._ssh_base(), '-p', str(self.port), f'root@{self.host}', REMOTE_ENV + ' ' + cmd],
                               capture_output=True, text=True, timeout=t)
        except subprocess.TimeoutExpired:
            raise GpuError(f'a pod step ran past its time limit ({round(t)} s)') from None
        if p.returncode != 0:
            raise GpuError(f'pod step failed (exit {p.returncode}): {(p.stdout + p.stderr).strip()[-300:]}')
        return p.stdout

    def scp(self, src, dst, limit=600):
        t = min(limit, self.left())
        if t <= 5:
            raise GpuError('the hard cap per pod is reached')
        try:
            p = subprocess.run(['scp', '-q', *self._ssh_base(), '-P', str(self.port), src, dst], capture_output=True, text=True, timeout=t)
        except subprocess.TimeoutExpired:
            raise GpuError('a copy to or from the pod ran past its time limit') from None
        if p.returncode != 0:
            raise GpuError(f'copy failed: {p.stderr.strip()[-200:]}')

    def remote(self, path):
        return f'root@{self.host}:{path}'

    def terminate(self):
        if not self.id:
            return
        try:
            self.ssh(WIPE, 30)
        except GpuError:
            pass
        err = None
        for _ in range(5):
            try:
                self.rp.call('DELETE', f'/pods/{self.id}')
                break
            except GpuError as e:
                err = e
                time.sleep(5)
        gone = False
        for _ in range(12):
            try:
                p = self.rp.call('GET', f'/pods/{self.id}')
                if (p.get('desiredStatus') or '').upper() in ('TERMINATED',) or not p:
                    gone = True
                    break
            except GpuError as e:
                if 'HTTP 404' in str(e):
                    gone = True  # the pod no longer exists
                    break
            time.sleep(5)
        t1 = time.time()
        secs = round(t1 - self.t0)
        cost = round(float(self.rec.get('cost_per_hr') or 0) * secs / 3600, 4)
        self.rec.update(terminated_utc=utc(t1), seconds=secs, cost_usd=cost, terminate_confirmed=gone)
        total = spend_record(self.g, self.rec)
        self.log(f'pod {self.id} terminated{"" if gone else " (NOT CONFIRMED: check the RunPod console)"}: {secs} s, ${cost} '
                 f'(${self.rec.get("cost_per_hr")}/h); GPU spend so far ${total}' + (f'; delete error: {err}' if err and not gone else ''))
        kh = os.path.join(os.path.dirname(self.g['ssh_key']), f'pod_known_hosts_{self.id}')
        if os.path.exists(kh):
            os.remove(kh)


def ensure_ssh_key(g):
    if not os.path.exists(g['ssh_key']):
        os.makedirs(os.path.dirname(g['ssh_key']), mode=0o700, exist_ok=True)
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'skarbnik-watch-pods', '-f', g['ssh_key']], check=True)
        os.chmod(g['ssh_key'], 0o600)


def clean_orphans(g, rp, log):
    """Terminates pods this tool started earlier and left behind (for example after a crash)."""
    try:
        pods = rp.call('GET', '/pods')
    except GpuError as e:
        log(f'could not list RunPod pods to look for leftovers: {e}')
        return
    for p in pods if isinstance(pods, list) else pods.get('pods', []):
        if str(p.get('name', '')).startswith(POD_PREFIX):
            log(f'leftover pod {p.get("id")} ({p.get("name")}) found: terminating it')
            pod = Pod(g, rp, log, 'leftover')
            pod.id = p.get('id')
            prev = next((x for x in spend_load(g)['pods'] if x['id'] == pod.id), None)
            pod.rec = prev or {'id': pod.id, 'label': 'leftover', 'cost_per_hr': p.get('adjustedCostPerHr') or p.get('costPerHr')}
            if prev and prev.get('created_utc'):
                pod.t0 = datetime.strptime(prev['created_utc'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()
            pod.terminate()


# ---------------------------------------------------------------- the binary
def put_binary(pod, g, expect_image_id, log):
    """Puts the CUDA build of skarbnik-host on the pod: the cached copy if it runs there, otherwise a build on this pod
    (Rust, RISC Zero, the committed source and the reproducible guest files), whose result is kept for the next pods."""
    cache, meta = g['binary_cache'], g['binary_cache'] + '.json'
    if os.path.exists(cache) and os.path.exists(meta):
        want = json.load(open(meta))['sha256']
        if hashlib.sha256(open(cache, 'rb').read()).hexdigest() != want:
            raise GpuError('the cached GPU binary does not match its recorded sha256')
        pod.scp(cache, pod.remote('skarbnik-host'), 900)
        try:
            out = pod.ssh('chmod +x skarbnik-host && sha256sum skarbnik-host | cut -c1-64 && '
                          '{ ldd skarbnik-host | grep -q "not found" && echo LIBS_MISSING || echo LIBS_OK; }', 120)
            if want in out and 'LIBS_OK' in out:
                log(f'pod {pod.id}: cached GPU binary in place (sha256 {want[:16]}...)')
                return 'cached'
        except GpuError as e:
            log(f'pod {pod.id}: the cached GPU binary did not run here ({e}); building on this pod')
    t = time.time()
    pod.ssh('apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq protobuf-compiler libclang-dev clang cmake pkg-config libssl-dev build-essential git curl time >/dev/null', 900)
    pod.ssh(f'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y -q --default-toolchain {g["rust"]} >/dev/null && rustc --version', 600)
    pod.ssh(f'curl -sL https://risczero.com/install | bash >/dev/null && rzup install cargo-risczero {g["risc0"]} >/dev/null && rzup install r0vm {g["risc0"]} >/dev/null && r0vm --version', 900)
    pod.scp(g['src_tarball'], pod.remote('src.tar.gz'), 600)
    pod.ssh('rm -rf skb && mkdir skb && tar -xzf src.tar.gz -C skb && mkdir -p skb/prebuilt-guests', 120)
    for n in ('hello_guest.bin', 'check_guest.bin'):
        pod.scp(os.path.join(g['guests_dir'], n), pod.remote(f'skb/prebuilt-guests/{n}'), 300)
    pod.ssh('cd skb && KINTSUGI_PREBUILT_GUESTS=$HOME/skb/prebuilt-guests cargo build --release -q -p skarbnik-host --features cuda-prove-only 2>&1 | tail -5', 1800)
    out = pod.ssh('cd skb && r0vm --id --elf prebuilt-guests/check_guest.bin | tail -1; grep -h "prebuilt guest check_guest" target/release/build/kintsugi-harness-*/output | tail -1', 120)
    if expect_image_id not in out:
        raise GpuError(f'the GPU build embeds another checker image id than {expect_image_id[:16]}...: {out.strip()[-200:]}')
    pod.ssh('cp skb/target/release/skarbnik-host skarbnik-host && ldd skarbnik-host | grep -i -E "cuda|not found" || true', 120)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    pod.scp(pod.remote('skarbnik-host'), cache + '.part', 900)
    sha = hashlib.sha256(open(cache + '.part', 'rb').read()).hexdigest()
    os.replace(cache + '.part', cache)
    json.dump({'sha256': sha, 'built_utc': utc(), 'image': g['image'], 'gpu': pod.rec.get('gpu'), 'image_id': expect_image_id,
               'build_seconds': round(time.time() - t)}, open(meta, 'w'), indent=1)
    log(f'pod {pod.id}: built the GPU binary in {round(time.time() - t)} s (sha256 {sha[:16]}...), kept for the next pods')
    return 'built'


# ---------------------------------------------------------------- one attempt
def prove_on_gpu(cfg, job, log):
    """Proves one attempt on a new pod and returns (path of the succinct receipt, times and cost). Always terminates
    the pod. job: name, module (folder with original.wasm and public_tests.txt), patch, secret, salt, seed, sid, fuzz,
    variants, image_id, workdir."""
    g = settings(cfg)
    rp = RunPod(g['api_key_file'])
    total = spend_total(g)
    if total >= float(g['budget_usd']):
        raise BudgetReached(f'GPU spend ${total} has reached the budget of ${g["budget_usd"]}: no new pod without the owner\'s say so')
    ensure_ssh_key(g)
    clean_orphans(g, rp, log)
    pod = Pod(g, rp, log, f'b{job["bounty_id"]}a{job["index"]}')
    w, times = job['workdir'], {}
    try:
        pod.create()
        pod.wait_ssh()
        times['pod_ready'] = round(time.time() - pod.t0)
        times['binary'] = put_binary(pod, g, job['image_id'], log)
        times['setup'] = round(time.time() - pod.t0)
        pod.ssh('mkdir -p run', 60)
        pod.scp(job['patch'], pod.remote('run/patch.wasm'), 120)
        pod.scp(os.path.join(job['module'], 'original.wasm'), pod.remote('run/original.wasm'), 120)
        pod.scp(os.path.join(job['module'], 'public_tests.txt'), pod.remote('run/public_tests.txt'), 120)
        # The secret and the salt: a RAM folder only; ~/.kintsugi-salts on the pod points into it.
        pod.ssh('umask 077; rm -rf /dev/shm/skv; mkdir -p /dev/shm/skv/salts && chmod 700 /dev/shm/skv /dev/shm/skv/salts && '
                'rm -rf $HOME/.kintsugi-salts && ln -s /dev/shm/skv/salts $HOME/.kintsugi-salts', 60)
        pod.scp(job['salt'], pod.remote(f'/dev/shm/skv/salts/{job["name"]}.salt'), 60)
        pod.scp(job['secret'], pod.remote('/dev/shm/skv/exploit.hex'), 60)
        args = (f'--bounty {shlex.quote(job["name"])} --exploit /dev/shm/skv/exploit.hex --original run/original.wasm '
                f'--tests run/public_tests.txt --fuzz-count {job["fuzz"]} --variants {job["variants"]} --po2 {g["po2"]} '
                f'--seed {job["seed"]}' + (f' --submission-id {job["sid"]}' if job.get('sid') else ''))
        if job.get('proof0'):
            args = '--proof0 ' + args  # Proof 0 of the vendor's reference fix: no submission id
        t = time.time()
        # No /usr/bin/time here: a pod with the cached binary has no apt step, and this step is timed from the VPS.
        out = pod.ssh('set +e; RISC0_DEV_MODE=0 RISC0_PROVER=local '
                      f'./skarbnik-host prove run/patch.wasm {args} --out run/u.bin > run/prove.log 2>&1; rc=$?; {WIPE}; '
                      'test ! -e /dev/shm/skv && echo SECRET_WIPED; grep -E "^(segments|prove seconds|journal.verdict|wall_seconds)" run/prove.log; exit $rc')
        times['prove'] = round(time.time() - t, 2)
        if 'SECRET_WIPED' not in out:
            raise GpuError('could not confirm the secret was wiped from the pod')
        log(f'pod {pod.id}: proved in {times["prove"]} s, secret wiped; ' + ' '.join(l.strip() for l in out.splitlines() if l.startswith(('segments', 'journal.verdict'))))
        pod.ssh('./skarbnik-host verify run/u.bin | grep -q "^VALID"', 300)
        t = time.time()
        pod.ssh('RISC0_DEV_MODE=0 RISC0_PROVER=local ./skarbnik-host compress run/u.bin run/u_succinct.bin succinct > run/succinct.log 2>&1', 1800)
        times['succinct'] = round(time.time() - t, 2)
        pod.scp(pod.remote('run/u_succinct.bin'), os.path.join(w, 'u_succinct.bin'), 300)
        pod.scp(pod.remote('run/prove.log'), os.path.join(w, 'gpu_prove.log'), 60)
        pod.scp(pod.remote('run/succinct.log'), os.path.join(w, 'gpu_succinct.log'), 60)
    finally:
        pod.terminate()
    times.update(pod_seconds=pod.rec['seconds'], cost_usd=pod.rec['cost_usd'], gpu=pod.rec.get('gpu'), pod=pod.id)
    return os.path.join(w, 'u_succinct.bin'), times


def shrink_on_gpu(cfg, receipt, out_path, label, image_id, log):
    """Shrinks a composite receipt made elsewhere (for example inside a confidential VM) to a succinct receipt on a new
    pod. The receipt holds no secret, so nothing secret goes to the pod. Always terminates the pod. Returns times."""
    g = settings(cfg)
    rp = RunPod(g['api_key_file'])
    total = spend_total(g)
    if total >= float(g['budget_usd']):
        raise BudgetReached(f'GPU spend ${total} has reached the budget of ${g["budget_usd"]}: no new pod without the owner\'s say so')
    ensure_ssh_key(g)
    clean_orphans(g, rp, log)
    pod = Pod(g, rp, log, label)
    times = {}
    try:
        pod.create()
        pod.wait_ssh()
        times['pod_ready'] = round(time.time() - pod.t0)
        times['binary'] = put_binary(pod, g, image_id, log)
        pod.ssh('mkdir -p run', 60)
        t = time.time()
        pod.scp(receipt, pod.remote('run/u.bin'), 900)
        times['upload'] = round(time.time() - t, 2)
        pod.ssh('./skarbnik-host verify run/u.bin | grep -q "^VALID"', 300)
        t = time.time()
        pod.ssh('RISC0_DEV_MODE=0 RISC0_PROVER=local ./skarbnik-host compress run/u.bin run/u_succinct.bin succinct > run/succinct.log 2>&1', 1800)
        times['succinct'] = round(time.time() - t, 2)
        pod.scp(pod.remote('run/u_succinct.bin'), out_path, 300)
        pod.scp(pod.remote('run/succinct.log'), out_path + '.gpu_succinct.log', 60)
        log(f'pod {pod.id}: shrank the receipt in {times["succinct"]} s')
    finally:
        pod.terminate()
    times.update(pod_seconds=pod.rec['seconds'], cost_usd=pod.rec['cost_usd'], gpu=pod.rec.get('gpu'), pod=pod.id)
    return times
