# Spike A and B: one GPU pod that (1) builds the CUDA prover for the rule checker from the committed source and the
# reproducible guest files, and keeps it for the proving pods (tools/skarbnik_gpu.py put_binary); (2) builds the plain
# CPU host from the same source and brings it back, for the Groth16 step on the vendor machine; (3) runs the zkVM
# executor (no proving) on a worst case: a 64 call secret, a 4 page rule and 2 page programs. The pod is terminated in
# every case. Runs on the machine with the RunPod key, after letting the running watches go first.
# Usage: python3 -I scripts/spike_ab_buildpod.py <gpu config json> <worst case folder> <cpu host output path>
import json, os, sys, time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skarbnik_gpu as gpu  # noqa: E402
from spike_output_gpu import watches_busy  # noqa: E402

RULE_ID = '2c7b601aeae96b0df295d2f7f7be842792637883148ec2cd26226b6018bfe6aa'
SEED = '776f7273742d63617365'.ljust(64, '0')


def log(m):
    print(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), m, flush=True)


def main():
    cfg, worst, cpu_out = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
    g = gpu.settings(cfg)
    assert g['pod_prefix'] != gpu.POD_PREFIX
    t0 = time.time()
    while (why := watches_busy(cfg, g)):
        if time.time() - t0 > 3600:
            sys.exit(f'the watches stayed busy ({why}); no pod was started')
        log(f'waiting: {why}')
        time.sleep(60)
    rp = gpu.RunPod(g['api_key_file'])
    if gpu.spend_total(g) >= float(g['budget_usd']):
        sys.exit('the spend cap is reached')
    gpu.ensure_ssh_key(g)
    gpu.clean_orphans(g, rp, log)
    pod = gpu.Pod(g, rp, log, 'build')
    try:
        pod.create()
        pod.wait_ssh()
        t = time.time()
        log(f'pod {pod.id}: CUDA prover: {gpu.put_binary(pod, g, RULE_ID, log)} in {round(time.time() - t)} s')
        t = time.time()
        pod.ssh('cd skb && KINTSUGI_PREBUILT_GUESTS=$HOME/skb/prebuilt-guests cargo build --release -q -p skarbnik-host 2>&1 | tail -3', 1800)
        pod.scp(pod.remote('skb/target/release/skarbnik-host'), cpu_out + '.part', 900)
        os.replace(cpu_out + '.part', cpu_out)
        os.chmod(cpu_out, 0o755)
        log(f'pod {pod.id}: CPU host built and fetched in {round(time.time() - t)} s')
        pod.ssh('mkdir -p run/worst', 60)
        for f in ('original.wasm', 'fix_owner.wasm', 'fix_hide.wasm', 'rule.wasm', 'public_tests.txt', 'secret.txt'):
            pod.scp(os.path.join(worst, f), pod.remote(f'run/worst/{f}'), 120)
        common = (f'--rule run/worst/rule.wasm --original run/worst/original.wasm --tests run/worst/public_tests.txt '
                  f'--secret run/worst/secret.txt --reference-fix run/worst/fix_owner.wasm --demo-salt --fuzz-count 64 '
                  f'--variants 64 --seed {SEED} --po2 19')
        for label, cand, extra in (('Proof 0', 'fix_owner', '--proof0'), ('check fix_hide', 'fix_hide', '--submission-id ' + '11' * 32)):
            out = pod.ssh(f'RISC0_DEV_MODE=0 ./skarbnik-host execute run/worst/{cand}.wasm {common} {extra} '
                          '| grep -E "^(image id|user cycles|segments|execute seconds|journal.verdict)"', 1200)
            log(f'worst case (64 calls, 4 page rule, 2 page programs), {label}: ' + ' | '.join(l.strip() for l in out.splitlines()))
    finally:
        pod.terminate()
    log(f'pod {pod.id}: {pod.rec["seconds"]} s, ${pod.rec["cost_usd"]}; spend so far ${gpu.spend_total(g)}')


if __name__ == '__main__':
    main()
