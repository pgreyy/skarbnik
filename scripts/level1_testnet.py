#!/usr/bin/env python3
# Drives the Level 1 testnet run: one small Level 1 bounty, opened and settled through OutLayer.
# Phases: create, open, commit, reveal, ids, check <index> <receipt>, attacks <receipt> <index>, status.
# Each NEAR call is logged (keys, signatures and home paths removed) under docs/evidence/level1/run/, and its transaction
# id is added to docs/evidence/level1/transactions.tsv. State between phases: target/level1/run.json. The secrets of this
# run are public on purpose: the demo program, the demo crashing input and the public demo salt.
# Usage, from the repo root: python3 scripts/level1_testnet.py <phase> [arguments]
import base64, hashlib, json, os, re, secrets, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
C = 'kintsugi-l2-cihdp.testnet'
VENDOR, ASKER = 'kintsugi-vendor-prnvm.testnet', 'kintsugi-res2-prnvm.testnet'
AGENTS = [('kintsugi-res2-prnvm.testnet', 'data/attacks/reject_all.wasm', 'wrong fix'), ('kintsugi-res1-prnvm.testnet', 'data/demo/fixed.wasm', 'real fix')]
OUT, STATE, TSV = 'docs/evidence/level1/run', 'target/level1/run.json', 'docs/evidence/level1/transactions.tsv'
os.makedirs(OUT, exist_ok=True)
state = json.load(open(STATE)) if os.path.exists(STATE) else {}
save = lambda: json.dump(state, open(STATE, 'w'), indent=1)
sha = lambda b: hashlib.sha256(b).hexdigest()


def clean(text):
    text = re.sub(r'\x1b\[[0-9;]*m', '', text)
    text = re.sub(r'/home/[^/ "]+', '~', text)
    lines = [l for l in text.splitlines() if not re.search(r'private.?key|secret.?key|seed.?phrase|signature', l, re.I)]
    text = '\n'.join(re.sub(r'[1-9A-HJ-NP-Za-km-z]{80,}', '(cut)', l) for l in lines)
    return re.sub(r'[A-Za-z0-9+/=]{200,}', lambda m: f'(cut: {len(m.group(0))} characters of base64)', text)  # the proof in the arguments


def near(step, what, signer, method, args, deposit='0 NEAR', gas='100 Tgas', big=False):
    """One contract call. Large arguments go through a file (file-args)."""
    if big:
        path = f'target/level1/args_{step}.json'
        open(path, 'w').write(json.dumps(args))
        a = ['file-args', path]
    else:
        a = ['json-args', json.dumps(args)]
    cmd = ['near', 'contract', 'call-function', 'as-transaction', C, method, *a, 'prepaid-gas', gas, 'attached-deposit', deposit,
           'sign-as', signer, 'network-config', 'testnet', 'sign-with-legacy-keychain', 'send']
    t = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    log = clean(r.stdout + r.stderr)
    shown = ' '.join(cmd if not big else cmd[:6] + ['file-args', a[1]] + cmd[8:])
    open(f'{OUT}/{step}.txt', 'w').write(f'{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))}\n$ {shown}\n{log}\nexit={r.returncode} wall_s={round(time.time() - t)}\n')
    tx = (re.findall(r'Transaction ID: ([1-9A-HJ-NP-Za-km-z]{43,44})', log) or [''])[0]
    ret = re.search(r'Function execution return value \(printed to stdout\):\s*\n(.*?)(?:\n\n|\Z)', log, re.S)
    ret = r.stdout.strip() or (ret.group(1).strip() if ret else '')  # near-cli-rs prints the return value alone on stdout
    events = re.findall(r'EVENT_JSON:(\{.*?\})(?:\s|$)', log)
    new = not os.path.exists(TSV)
    gas = (re.findall(r'Gas burned: ([0-9.]+ [TG]gas)', log) or [''])[0]
    with open(TSV, 'a') as f:  # the same columns as the other transactions.tsv files (scripts/gen_site_recorded.py)
        if new:
            f.write('step\tmethod\tsigner\ttx_hash\tgas_burned_cli\tfee_near\texit\twall_s\n')
        f.write(f'{step}\t{method}\t{signer}\t{tx}\t{gas}\t\t{r.returncode}\t{round(time.time() - t)}\n')
    open(f'{OUT}/steps.txt', 'a').write(f'{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))} {step}: {what}; tx {tx}; exit {r.returncode}; return {ret[:200]}\n')
    print(f'{step}: exit {r.returncode} tx {tx} return {ret[:160]} ({round(time.time() - t)} s)')
    for e in events:
        if '"kintsugi"' in e or 'near-outlayer' in e:
            print('   event', e[:260])
    return r.returncode, ret, tx


def view(method, args):
    r = subprocess.run(['near', 'contract', 'call-function', 'as-read-only', C, method, 'json-args', json.dumps(args), 'network-config', 'testnet', 'now'],
                       capture_output=True, text=True, timeout=300)
    return json.loads(r.stdout) if r.stdout.strip() else None  # near-cli-rs prints the value alone on stdout


def receipt_parts(path, log):
    """The receipt's bytes, sha256 and its 780 byte journal, found after its length prefix and checked against the
    journal sha256 that `skarbnik-host verify` prints."""
    rb = open(path, 'rb').read()
    v = subprocess.run(['./target/release/skarbnik-host', 'verify', path], capture_output=True, text=True, timeout=600)
    jsha = re.search(r'journal sha256: ([0-9a-f]{64})', v.stdout + v.stderr).group(1)
    assert 'VALID' in v.stdout + v.stderr, 'the receipt does not verify'
    prefix = (780).to_bytes(8, 'little')
    found = [rb[i + 8:i + 8 + 780] for i in range(len(rb) - 788) if rb[i:i + 8] == prefix and sha(rb[i + 8:i + 8 + 780]) == jsha]
    assert found and len(set(found)) == 1, f'journal not found, or two different ones ({len(found)})'  # it may appear twice, identical
    open(log, 'w').write(v.stdout + v.stderr)
    return rb, sha(rb), found[0], jsha


def field(log, name):
    return re.search(rf'journal\.{name}: ([0-9a-f]+)', open(log).read()).group(1)


phase = sys.argv[1] if len(sys.argv) > 1 else 'status'
if phase == 'create':
    rb, rsha, j, jsha = receipt_parts('target/level1/p0_succinct.bin', f'{OUT}/verify_p0.txt')
    log = 'target/level1/prove_p0.log'
    image = re.search(r'image id: ([0-9a-f]{64})', open(log).read()).group(1)
    sec = 1_000_000_000
    args = {
        'original_hash': field(log, 'original_hash'), 'corpus_hash': field(log, 'corpus_hash'), 'image_id': image,
        'exploit_commitment': field(log, 'exploit_commitment'), 'proof0_receipt_hash': rsha, 'max_commits': 2, 'max_patch_bytes': 1024,
        'reveal_gap_ns': str(60 * sec), 'verdict_window_ns': str(6 * 3600 * sec), 'attest_window_ns': str(3600 * sec),
        'expiry_ns': str(30 * 3600 * sec), 'attempt_fee': str(10 ** 22), 'fee_step': str(5 * 10 ** 21),
        'reference_fix_hash': sha(open('data/demo/fixed.wasm', 'rb').read()), 'proof0_journal_hash': jsha,
        'reveal_window_ns': str(3600 * sec), 'fuzz_count': 1, 'variant_count': 1, 'level': 1, 'max_commits_per_account': None,
    }
    code, ret, tx = near('l1_create', 'create a Level 1 test bounty (demo program, check size 1 and 1)', VENDOR, 'create_bounty', args, '0.1 NEAR')
    if code == 0:
        state['bounty'] = json.loads(ret)
        save()
elif phase == 'open':
    rb, rsha, j, jsha = receipt_parts('target/level1/p0_succinct.bin', f'{OUT}/verify_p0.txt')
    args = {'bounty_id': state['bounty'], 'receipt_b64': base64.b64encode(rb).decode(), 'receipt_sha256': rsha, 'journal': base64.b64encode(j).decode()}
    near('l1_open', 'open with Proof 0 through OutLayer', ASKER, 'open_with_outlayer', args, '2.8 NEAR', '300 Tgas', big=True)
    print('opened:', view('get_bounty', {'bounty_id': state['bounty']})['opened'])
elif phase == 'commit':
    state.setdefault('attempts', [])
    for who, patch, label in AGENTS:
        nonce = secrets.token_hex(32)
        p = open(patch, 'rb').read()
        buf = b'kintsugi-commit-v1' + len(p).to_bytes(4, 'little') + p + len(who).to_bytes(4, 'little') + who.encode() + bytes.fromhex(nonce)
        code, ret, tx = near(f'l1_commit_{label.replace(" ", "_")}', f'commit the {label}', who, 'commit',
                             {'bounty_id': state['bounty'], 'fingerprint': sha(buf), 'payout': who})
        state['attempts'].append({'who': who, 'patch': patch, 'label': label, 'nonce': nonce, 'index': json.loads(ret) if ret else None})
        save()
elif phase == 'reveal':
    for a in state['attempts']:
        near(f'l1_reveal_{a["label"].replace(" ", "_")}', f'reveal the {a["label"]}', a['who'], 'reveal',
             {'bounty_id': state['bounty'], 'index': a['index'], 'patch': base64.b64encode(open(a['patch'], 'rb').read()).decode(), 'nonce': a['nonce']})
elif phase == 'ids':
    for a in state['attempts']:
        s = view('get_submission', {'bounty_id': state['bounty'], 'index': a['index']})
        a['seed'], a['submission_id'] = s['seed'], view('get_submission_id', {'bounty_id': state['bounty'], 'index': a['index']})
        print(a['label'], 'index', a['index'], 'seed', a['seed'], 'submission id', a['submission_id'])
    save()
elif phase == 'check':
    index, path = int(sys.argv[2]), sys.argv[3]
    a = [x for x in state['attempts'] if x['index'] == index][0]
    rb, rsha, j, jsha = receipt_parts(path, f'{OUT}/verify_a{index}.txt')
    args = {'bounty_id': state['bounty'], 'index': index, 'receipt_b64': base64.b64encode(rb).decode(), 'receipt_sha256': rsha, 'journal': base64.b64encode(j).decode()}
    near(f'l1_check_{a["label"].replace(" ", "_")}', f'check the {a["label"]} through OutLayer', ASKER, 'check_with_outlayer', args, '2.8 NEAR', '300 Tgas', big=True)
    print(json.dumps(view('get_submission', {'bounty_id': state['bounty'], 'index': index}), indent=0)[:600])
elif phase == 'private_callback':
    # the private callback called by a stranger, alone (the first attacks run lost its refusal text to the log filter)
    near('l1_attack_private_callback_2', 'a stranger calls the private callback (repeat with the full refusal text)', ASKER,
         'on_outlayer_check', {'bounty_id': state['bounty'], 'index': 0})
elif phase == 'attacks':
    # cheap refusals on chain (gas only; a refused call returns its deposit): each must fail
    bid = state['bounty']
    near('l1_attack_private_callback', 'a stranger calls the private callback with a made up PASS', ASKER, 'on_outlayer_check',
         {'bounty_id': bid, 'index': 0})
    rb, rsha, j, jsha = receipt_parts('target/level1/p0_succinct.bin', f'{OUT}/verify_p0.txt')
    near('l1_attack_proof0_as_attempt', 'Proof 0 sent as the proof of attempt 0', ASKER, 'check_with_outlayer',
         {'bounty_id': bid, 'index': 0, 'receipt_b64': base64.b64encode(rb).decode(), 'receipt_sha256': rsha, 'journal': base64.b64encode(j).decode()},
         '2.8 NEAR', '300 Tgas', big=True)
    rb, rsha, j, jsha = receipt_parts(sys.argv[2], f'{OUT}/verify_attack.txt')
    # the same attempt's real receipt with one bit of its seal flipped and its journal unchanged: every check in the
    # contract passes, so only OutLayer's verification can refuse it; expected: ok false, nothing recorded
    bad = 'target/level1/attack_flipped.bin'
    t = subprocess.run(['./target/release/skarbnik-host', 'tamper', sys.argv[2], bad, 'seal'], capture_output=True, text=True)
    v = subprocess.run(['./target/release/skarbnik-host', 'verify', bad], capture_output=True, text=True)
    open(f'{OUT}/verify_attack_flipped.txt', 'w').write(clean(t.stdout + t.stderr + v.stdout + v.stderr) + f'\nverify exit={v.returncode}\n')
    fb = open(bad, 'rb').read()
    near('l1_attack_flipped_seal', 'the real attempt receipt with one seal bit flipped, journal unchanged', ASKER, 'check_with_outlayer',
         {'bounty_id': bid, 'index': int(sys.argv[3]), 'receipt_b64': base64.b64encode(fb).decode(), 'receipt_sha256': sha(fb), 'journal': base64.b64encode(j).decode()},
         '2.8 NEAR', '300 Tgas', big=True)
    print(json.dumps(view('get_submission', {'bounty_id': bid, 'index': int(sys.argv[3])}))[:400])
    near('l1_attack_low_deposit', 'a real attempt proof with less than min_deposit attached', ASKER, 'check_with_outlayer',
         {'bounty_id': bid, 'index': int(sys.argv[3]), 'receipt_b64': base64.b64encode(rb).decode(), 'receipt_sha256': rsha, 'journal': base64.b64encode(j).decode()},
         '0.5 NEAR', '300 Tgas', big=True)
else:
    print(json.dumps(state, indent=1))
    if 'bounty' in state:
        print(json.dumps(view('get_bounty', {'bounty_id': state['bounty']}), indent=0)[:900])
