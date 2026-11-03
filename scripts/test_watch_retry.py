#!/usr/bin/env python3
# Tests the vendor watch's retry rules with no GPU, no chain and no money: it loads tools/skarbnik-vendor, fakes the GPU
# rental (tools/skarbnik_gpu.py prove_on_gpu), the chain calls and the clock, and runs the real watch loop (cmd_watch,
# scan, prove_attempt, failed_round) on one revealed Level 1 attempt. Cases: no GPU free for two rounds, then one
# frees up; no GPU ever free; a card that crashes every round. Prints the watch log of each case and checks the result.
# Usage, from the repo root: python3 -I scripts/test_watch_retry.py
import contextlib, importlib.machinery, importlib.util, os, sys, tempfile, types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
loader = importlib.machinery.SourceFileLoader('skv', os.path.join(ROOT, 'tools', 'skarbnik-vendor'))
m = importlib.util.module_from_spec(importlib.util.spec_from_loader('skv', loader)); loader.exec_module(m)
gpu = m.gpu
T0 = 1_793_800_000.0  # 2026-11-04 13:46 UTC, a fixed start for readable times


class Clock:
    """A fake clock: sleep moves it forward; time() reads it. Stops the watch after `limit` sleeps (a stop or restart)."""
    def __init__(self, t=T0, limit=400): self.t, self.sleeps, self.limit = t, 0, limit
    def time(self): return self.t
    def sleep(self, s):
        self.sleeps += 1; self.t += s
        if self.sleeps > self.limit: raise StopIteration('the watch is still looping')


def run(name, verdict_window_h, outcomes, d=None, start=T0, limit=400, calls=None):
    """outcomes: what each GPU proving try does, in order: 'nogpu', 'crash' or 'ok' (the last one repeats). d, start and
    calls let a second run continue the first one's state file, clock and tries (a restart)."""
    d = d or tempfile.mkdtemp(prefix='watchtest-')
    clock = Clock(start, limit); calls = [] if calls is None else calls
    deadline_ns = int((T0 + verdict_window_h * 3600) * 1e9)
    sub = {'outcome': 'Open', 'revealed_at_ns': str(int(T0 * 1e9)), 'deadline_ns': str(deadline_ns), 'seed': 'ab' * 32,
           'patch': 'AGFzbQEAAAA='}
    bounty = {'state': 'Open', 'level': 1, 'fuzz_count': 1, 'variant_count': 1, 'image_id': 'dd' * 32, 'exploit_commitment': 'ec' * 32}
    wcfg = {'watch': {'state': f'{d}/state.json', 'log': f'{d}/watch.log', 'workdir': f'{d}/work', 'poll_s': 60},
            'prover': {'mode': 'gpu', 'machine': 'test'},
            'chain': {'submit_account': 'tester.testnet'},
            'gpu': {'spend_file': f'{d}/spend.json', 'budget_usd': 1.0, 'cpu_fallback': False},
            'bounties': [{'name': 'test', 'ids': [99], 'module': f'{d}/module', 'secret': f'{d}/secret.hex'}]}

    def prove_on_gpu(cfg, job, log):
        k = outcomes[min(len(calls), len(outcomes) - 1)]; calls.append(k)
        if k == 'nogpu': raise gpu.NoGpuFree('no GPU could be rented within the limits (RunPod POST /pods: HTTP 500 no instances currently available)')
        if k == 'crash': raise gpu.GpuError('pod step failed (exit 134): named symbol not found')
        open(f'{job["workdir"]}/u_succinct.bin', 'wb').write(b'receipt')
        return f'{job["workdir"]}/u_succinct.bin', {'prove': 10.2, 'succinct': 7.7, 'gpu': 'NVIDIA L40S', 'pod_seconds': 189, 'cost_usd': 0.0572}

    def view(cfg, method, args=None):
        if method == 'get_submission_id': return 'aa' * 32
        if method == 'get_submission': return sub
        if method == 'get_outlayer': return {'min_deposit': str(28 * 10 ** 23)}
        raise AssertionError(method)

    def send(cfg, signer, method, args_file, deposit='0 NEAR', gas='300 Tgas', log=None):
        sub['outcome'] = 'Passed'; return 'FakeTxHash', True, ''

    fake = types.SimpleNamespace(time=clock.time, sleep=clock.sleep)
    patches = {'load': lambda p: wcfg, 'attempts': lambda cfg, bid: (bounty, [sub] if sub['outcome'] == 'Open' else []),
               'view': view, 'send': send, 'ProverLock': contextlib.nullcontext,
               'verify_succinct': lambda cfg, w, tag: 'VALID\njournal.verdict: PASS\njournal.exploit_commitment: ' + 'ec' * 32 + '\njournal.submission_id: ' + 'aa' * 32,
               'outlayer_args': lambda w, tag, extra: f'{w}/args.json', 'time': fake}
    saved = {k: getattr(m, k) for k in patches}; saved_gpu = gpu.prove_on_gpu
    for k, v in patches.items(): setattr(m, k, v)
    gpu.prove_on_gpu = prove_on_gpu
    real_time = gpu.time; gpu.time = fake
    try:
        with contextlib.redirect_stdout(open(os.devnull, 'w')):
            try: m.cmd_watch(types.SimpleNamespace(config='test.toml', once=False))
            except StopIteration: pass
    finally:
        for k, v in saved.items(): setattr(m, k, v)
        gpu.prove_on_gpu = saved_gpu; gpu.time = real_time
    log = open(wcfg['watch']['log']).read()
    st = m.state_load(wcfg).get('99:0', {})
    print(f'===== {name} (verdict window {verdict_window_h} h, GPU tries: {", ".join(calls)})')
    for line in log.splitlines():
        print('   ', line.split(' ', 1)[1])  # without the real time stamp of the line; the times inside come from the fake clock
    print(f'    -> state: {st.get("state")}; GPU tries {len(calls)}; fake time passed {round((clock.t - T0) / 60)} min')
    return st, calls, log, d, clock.t


ok = True
st, calls, log, *_ = run('no GPU free twice, then one frees up', 24, ['nogpu', 'nogpu', 'ok'])
ok &= st.get('state') == 'submitted' and len(calls) == 3 and log.count('WAITING for a GPU') == 2 and 'ALERT' not in log
st, calls, log, *_ = run('no GPU ever free', 4, ['nogpu'])
ok &= st.get('state') == 'gave up' and 'ALERT' in log and 'GAVE UP' in log and bool(st.get('alert'))
st, calls, log, *_ = run('a card that crashes every round', 24, ['crash'])
ok &= st.get('state') == 'gave up' and len(calls) == 4 and 'STOPPED after 2 failed rounds' in log and 'WAITING' not in log
# a restart while waiting: the first watch stops during its wait; a new one on the same state file keeps the count and
# does not try before the saved next try time
calls = []
st1, _, _, d, t1 = run('restart while waiting: first watch (stopped while it waits)', 24, ['nogpu', 'nogpu', 'ok'], limit=2, calls=calls)
st2, _, log2, *_ = run('restart while waiting: second watch on the same state', 24, ['nogpu', 'nogpu', 'ok'], d=d, start=t1, calls=calls)
ok &= st1.get('gpu_wait', {}).get('tries') == 1 and st2.get('state') == 'submitted' and len(calls) == 3 and 'try 2,' in log2
print('ALL PASS' if ok else 'FAILED')
sys.exit(0 if ok else 1)
