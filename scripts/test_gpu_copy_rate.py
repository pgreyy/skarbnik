# Checks skarbnik_gpu.Pod.scp_up_checked (the copy of the cached GPU binary that stops when the link is too slow)
# against any machine you can ssh into, standing in for a pod: (a) a 2 MB copy with a low floor finishes and arrives
# whole; (b) a 60 MB copy with a floor no link meets is stopped at the first rate check and leaves no scp process.
# Usage: python3 -I scripts/test_gpu_copy_rate.py <user@host> <ssh key file> <known_hosts file>
import hashlib, os, subprocess, sys, tempfile, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
import skarbnik_gpu as gpu  # noqa: E402

target, key, known = sys.argv[1], sys.argv[2], sys.argv[3]
user, host = target.split('@')
BASE = ['-i', key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', f'UserKnownHostsFile={known}', '-o', 'ConnectTimeout=15']

class StandIn(gpu.Pod):
    def _ssh_base(self): return BASE
    def remote(self, p): return f'{user}@{self.host}:{p}'
    def ssh(self, cmd, limit=None):
        p = subprocess.run(['ssh', *BASE, f'{user}@{self.host}', cmd], capture_output=True, text=True, timeout=limit or 60)
        if p.returncode: raise gpu.GpuError(p.stderr[-200:])
        return p.stdout

pod = StandIn({'cap_minutes': 10}, None, print, 'test'); pod.host, pod.port, pod.id = host, 22, 'test'
ok = True
with tempfile.TemporaryDirectory() as d:
    small, big = f'{d}/small.bin', f'{d}/big.bin'
    open(small, 'wb').write(os.urandom(2_000_000)); open(big, 'wb').write(os.urandom(60_000_000))
    pod.ssh('mkdir -p rate-test')
    t = time.time(); pod.scp_up_checked(small, 'rate-test/small.bin', 300, 0.01, 5)
    whole = pod.ssh('sha256sum rate-test/small.bin').split()[0] == hashlib.sha256(open(small, 'rb').read()).hexdigest()
    ok &= whole; print('a) finished in', round(time.time() - t, 1), 's; whole:', whole)
    t = time.time()
    try:
        pod.scp_up_checked(big, 'rate-test/big.bin', 300, 1000.0, 5); ok = False; print('b) NOT stopped')
    except gpu.GpuError as e:
        left = subprocess.run(['pgrep', '-x', 'scp'], capture_output=True, text=True).stdout.split()
        ok &= not left; print('b) stopped after', round(time.time() - t, 1), 's:', e, '| scp processes left:', len(left))
    for wait in (0, 10):  # the host may reset one of several quick logins in a row
        time.sleep(wait)
        try: pod.ssh('rm -rf rate-test'); break
        except gpu.GpuError: pass
print('ALL PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
