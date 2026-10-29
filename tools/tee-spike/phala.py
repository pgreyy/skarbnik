#!/usr/bin/env python3
"""Phala Cloud CVM control for the confidential proving spike, through Phala's REST API (cloud-api.phala.com).
Python 3 standard library only; runs on the vendor machine (the project VPS).

Commands:
  balance                         the workspace's credit balance
  deploy <name> <compose.yaml> <instance type>
                                  provision (Phala checks the compose and returns its compose hash and app id), then
                                  create the CVM; saves Phala's answers to <name>.deploy.json; refuses when the
                                  balance is below the floor (the owner's $4 cap from the $5 credit)
  wait <cvm id>                   waits until the CVM is running and its public address answers
  show <cvm id>                   the CVM, its network addresses
  delete <cvm id>                 deletes the CVM (not just stops it), then waits until it is gone
  list                            every CVM in the workspace (the spike ends with this list empty)
The API key is read from ~/.phala_key for each request and is never printed, logged or copied.
"""
import json, os, sys, time, urllib.error, urllib.request

API = 'https://cloud-api.phala.com/api/v1'
KEY_FILE = os.path.expanduser('~/.phala_key')
FLOOR_USD = 1.00  # $5 credit - $4 cap: nothing new starts below this balance
OS_IMAGE = 'dstack-0.6.1'


def call(method, path, body=None, ok=(200, 201, 202, 204)):
    key = open(KEY_FILE).read().strip()
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'X-API-Key': key, 'Content-Type': 'application/json', 'Accept': 'application/json',
                                          'User-Agent': 'skarbnik-tee-spike/1'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else {}
    except urllib.error.HTTPError as e:
        text = e.read().decode()[:2000]
        try: return e.code, json.loads(text)
        except ValueError: return e.code, {'raw': text}


def utc(): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def balance():
    s, d = call('GET', '/auth/me')
    if s != 200: sys.exit(f'Phala rejected the API key (HTTP {s}); check ~/.phala_key')
    return float(d['credits']['balance'])


def cmd_balance(_a): print(f'{utc()} balance ${balance():.6f}')


def cmd_deploy(a):
    name, compose_path, itype = a
    b = balance()
    if b < FLOOR_USD + 0.2: sys.exit(f'REFUSED: balance ${b:.2f} is too close to the ${FLOOR_USD:.2f} floor')
    compose = open(compose_path).read()
    prov_req = {'name': name, 'instance_type': itype, 'image': OS_IMAGE, 'listed': False,
                'compose_file': {'name': name, 'docker_compose_file': compose, 'gateway_enabled': True, 'public_logs': True,
                                 'public_sysinfo': True, 'public_tcbinfo': True, 'kms_enabled': True}}
    t0 = utc()
    s, prov = call('POST', '/cvms/provision', prov_req)
    print(f'{utc()} provision: HTTP {s} {json.dumps(prov)[:600]}')
    if s not in (200, 201): sys.exit(1)
    s, vm = call('POST', '/cvms', {'app_id': prov['app_id'], 'compose_hash': prov['compose_hash']})
    print(f'{utc()} create: HTTP {s} {json.dumps({k: vm.get(k) for k in ("id", "vm_uuid", "app_id", "name", "status", "vcpu", "memory", "disk_size", "base_image", "teepod")} if isinstance(vm, dict) else vm)}')
    json.dump({'requested_at': t0, 'balance_before_usd': b, 'provision_request': prov_req, 'provision': prov, 'create_status': s, 'vm': vm},
              open(f'{name}.deploy.json', 'w'), indent=1)
    if s not in (200, 201): sys.exit(1)


def cvm_id(x): return x if x.startswith(('app_', 'cvm_')) or '-' in x or x.isdigit() else f'app_{x}'


def cmd_show(a):
    s, vm = call('GET', f'/cvms/{cvm_id(a[0])}')
    print(f'{utc()} cvm: HTTP {s} {json.dumps({k: vm.get(k) for k in ("id", "app_id", "name", "status", "instance_type", "vcpu", "memory", "base_image", "created_at")} if isinstance(vm, dict) else vm)}')
    s, net = call('GET', f'/cvms/{cvm_id(a[0])}/network')
    print(f'{utc()} network: HTTP {s} {json.dumps(net)[:800]}')
    return vm, net


def cmd_wait(a):
    t0 = time.time()
    while time.time() - t0 < 1800:
        s, vm = call('GET', f'/cvms/{cvm_id(a[0])}')
        s2, net = call('GET', f'/cvms/{cvm_id(a[0])}/network')
        urls = [u['app'] for u in (net.get('public_urls') or [])] if isinstance(net, dict) else []
        print(f'{utc()} +{int(time.time() - t0)} s status {vm.get("status") if isinstance(vm, dict) else s} online {net.get("is_online") if isinstance(net, dict) else s2} urls {urls}', flush=True)
        if isinstance(vm, dict) and vm.get('status') == 'running' and urls:
            for u in urls:
                base = u.rstrip('/')
                try:
                    with urllib.request.urlopen(urllib.request.Request(base + '/', headers={'User-Agent': 'skarbnik-tee-spike/1'}), timeout=20) as r:
                        print(f'{utc()} {base}/ answers HTTP {r.status}: {r.read()[:200].decode(errors="replace")}'); return
                except Exception as e:  # noqa: BLE001
                    print(f'{utc()} {base}/ not yet: {str(e)[:120]}')
        time.sleep(20)
    sys.exit('not running after 30 min')


def cmd_delete(a):
    s, d = call('DELETE', f'/cvms/{cvm_id(a[0])}')
    print(f'{utc()} delete: HTTP {s} {json.dumps(d)[:300]}')
    for _ in range(60):
        s, vm = call('GET', f'/cvms/{cvm_id(a[0])}')
        if s == 404 or (isinstance(vm, dict) and vm.get('status') in ('deleted',)):
            print(f'{utc()} gone: HTTP {s} {vm.get("status") if isinstance(vm, dict) else ""}'); break
        print(f'{utc()} still there: status {vm.get("status") if isinstance(vm, dict) else s}', flush=True); time.sleep(10)
    cmd_list([])


def cmd_list(_a):
    s, d = call('GET', '/cvms')
    items = d if isinstance(d, list) else d.get('items', d.get('data', []))
    print(f'{utc()} CVM list: HTTP {s}, {len(items)} CVM(s) {[{k: i.get(k) for k in ("id", "name", "status")} for i in items]}')


if __name__ == '__main__':
    cmd, *rest = sys.argv[1:] or ['help']
    fn = {'balance': cmd_balance, 'deploy': cmd_deploy, 'wait': cmd_wait, 'show': cmd_show, 'delete': cmd_delete, 'list': cmd_list}.get(cmd)
    if not fn: print(__doc__); sys.exit(1)
    fn(rest)
