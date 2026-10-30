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
  logins <cvm id> <app url>       who could log in: the SSH keys in the CVM's user config and on the account, and
                                  from outside, what Phala's gateway answers for the SSH route (<app id>-22) and the
                                  guest agent's page (<app id>-8090)
The API key is read from ~/.phala_key for each request and is never printed, logged or copied.
"""
import http.client, json, os, sys, time, urllib.error, urllib.request

API = 'https://cloud-api.phala.com/api/v1'
KEY_FILE = os.path.expanduser('~/.phala_key')
FLOOR_USD = 1.00  # $5 credit - $4 cap: nothing new starts below this balance
OS_IMAGE = 'dstack-0.6.1'


def call(method, path, body=None, ok=(200, 201, 202, 204)):
    """One API request. Reads (GET) and deletes are tried up to 5 times when Phala's API does not answer (it went quiet
    for two minutes once during the spike); a create (POST) is sent once, so it can never make two CVMs. A request that
    never got an answer returns status 0."""
    key = open(KEY_FILE).read().strip()
    tries = 1 if method == 'POST' else 5
    for n in range(tries):
        req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={'X-API-Key': key, 'Content-Type': 'application/json', 'Accept': 'application/json',
                                              'User-Agent': 'skarbnik-tee-spike/1'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                text = r.read().decode()
                return r.status, json.loads(text) if text else {}
        except urllib.error.HTTPError as e:
            text = e.read().decode()[:2000]
            try: return e.code, json.loads(text)
            except ValueError: return e.code, {'raw': text}
        except (OSError, http.client.HTTPException) as e:  # timeouts, refused or reset connections, DNS
            err = f'{type(e).__name__}: {str(e)[:150]}'
            print(f'{utc()} {method} {path}: no answer from Phala ({err}); try {n + 1} of {tries}', flush=True)
            if n + 1 < tries: time.sleep(15)
    return 0, {'error': err}


def utc(): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def balance():
    s, d = call('GET', '/auth/me')
    if s == 401: sys.exit('Phala rejected the API key (HTTP 401); check ~/.phala_key')
    if s != 200: sys.exit(f'could not read the balance (HTTP {s} {json.dumps(d)[:150]})')
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


def cmd_logins(a):
    import socket, ssl
    vm, url = a
    s1, uc = call('GET', f'/cvms/{cvm_id(vm)}/user_config')
    s2, keys = call('GET', '/user/ssh-keys')
    res = {'at': utc(), 'user_config_http': s1, 'user_config': uc, 'account_ssh_keys_http': s2,
           'account_ssh_keys_count': len(keys) if isinstance(keys, list) else None, 'outside': {}}
    host = url.split('//')[1].split('/')[0]; app, rest = host.split('-8080.', 1)
    for label, h in (('ssh route -22', f'{app}-22.{rest}'), ('ssh route -22s', f'{app}-22s.{rest}')):
        r = {'host': h}
        try:
            raw = socket.create_connection((h, 443), timeout=15)
            tls = ssl.create_default_context().wrap_socket(raw, server_hostname=h); tls.settimeout(10)
            r['tls'] = tls.version()
            try: r['first_bytes'] = tls.recv(200).decode('latin-1')
            except (socket.timeout, ssl.SSLError, OSError) as e: r['first_bytes'] = f'(none: {type(e).__name__} {e})'
            tls.close()
        except Exception as e:  # noqa: BLE001
            r['error'] = f'{type(e).__name__}: {str(e)[:200]}'
        res['outside'][label] = r
    for label, h in (('guest agent page -8090', f'https://{app}-8090.{rest}/'),):
        try:
            with urllib.request.urlopen(urllib.request.Request(h, headers={'User-Agent': 'skarbnik-tee-spike/1'}), timeout=20) as r:
                body = r.read(4000).decode(errors='replace')
                res['outside'][label] = {'url': h, 'http': r.status, 'title': (body.split('<title>')[1].split('</title>')[0] if '<title>' in body else body[:120])}
        except urllib.error.HTTPError as e:
            res['outside'][label] = {'url': h, 'http': e.code}
        except Exception as e:  # noqa: BLE001
            res['outside'][label] = {'url': h, 'error': f'{type(e).__name__}: {str(e)[:200]}'}
    json.dump(res, open('logins.json', 'w'), indent=1)
    print(f'{utc()} user config: HTTP {s1}, ssh_authorized_keys {uc.get("ssh_authorized_keys") if isinstance(uc, dict) else uc}; account SSH keys: {res["account_ssh_keys_count"]}')
    for k, v in res['outside'].items(): print(f'{utc()} outside, {k}: {json.dumps(v)[:300]}')


def cmd_list(_a):
    s, d = call('GET', '/cvms')
    items = d if isinstance(d, list) else d.get('items', d.get('data', []))
    print(f'{utc()} CVM list: HTTP {s}, {len(items)} CVM(s) {[{k: i.get(k) for k in ("id", "name", "status")} for i in items]}')


if __name__ == '__main__':
    cmd, *rest = sys.argv[1:] or ['help']
    fn = {'balance': cmd_balance, 'deploy': cmd_deploy, 'wait': cmd_wait, 'show': cmd_show, 'delete': cmd_delete, 'list': cmd_list, 'logins': cmd_logins}.get(cmd)
    if not fn: print(__doc__); sys.exit(1)
    fn(rest)
