#!/usr/bin/env bash
# Tests the model-driven agent (agent/skarbnik_agent.py) in dry run: nothing is sent to the chain and no real model
# key is used. Each case runs the agent once with a test config (in target/agent-test/) and checks its log:
#   1 reference fix   the stand-in answers with the known reference fix: public code checked, fix built, 17 of 17
#                     public tests pass, commit and reveal prepared but not sent; one attempt, then it stops
#   2 model API       (and 2b, streamed) the default provider code talks to a local stand-in of an OpenAI compatible API: the request
#                     carries the key from the environment, and the key appears in no log or file of the run
#   3 broken answer   an answer that does not compile is not used, and nothing is prepared
#   4 wrong answer    an answer that fails public tests (data/attacks/reject_all.rs) is not used
#   5 file reading    an answer that tries to read a local file at build time (include_str!) is refused
#   6 fee limit       a max fee below the next fee: the bounty is skipped
#   7 key check       a full access key in place of the limited key: refused (the dry run notes a live run would stop)
#   8 fingerprint     the agent's fingerprint equals the site's (scripts/web_fingerprint.mjs)
#   9 after a FAIL    the next prompt carries the earlier fix and its FAIL verdict
# Needs: agent/config.local.toml from ./scripts/agent_testnet.sh setup, rustc with wasm32-unknown-unknown, the local
# checker (cargo build -p kintsugi-check), node. Usage, from the repo root: ./scripts/agent_dry_run_test.sh
set -uo pipefail
cd "$(dirname "$0")/.."
T=target/agent-test; mkdir -p "$T"; BASE=agent/config.local.toml
[ -f "$BASE" ] || { echo "run ./scripts/agent_testnet.sh setup first"; exit 2; }
pass=0; fail=0
ok() { if [ "$1" = 0 ]; then echo "PASS $2"; pass=$((pass + 1)); else echo "FAIL $2"; fail=$((fail + 1)); fi; }
# conf <name> <python statements editing the text s>: a test config from the local one
conf() { python3 -I - "$BASE" "$T/$1.toml" "$2" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
s = s.replace('state_dir = "target/agent-runs"', 'state_dir = "target/agent-test/runs"')
exec(sys.argv[3])
open(sys.argv[2], "w").write(s)
PY
}
agent() { python3 -I agent/skarbnik_agent.py run --config "$T/$1.toml" "${@:2}" > "$T/$1.out" 2>&1; }
has() { grep -q -E -- "$2" "$T/$1.out"; }
rm -rf "$T/runs"

# 1 reference fix
conf ref ''
agent ref --provider standin
has ref 'DRY RUN \(nothing is sent\)' && has ref 'public code: module sha256 [0-9a-f]{16}\.\.\. = original_hash, 17 public tests = corpus_hash, source rebuilds to the same module: yes' \
  && has ref 'fix: sha256 42edaaf57b1b428baba4cf7a8ec7d578daae82037ca9a2670dc02c636bcfdc97, 556 bytes; public tests 17 of 17 pass' \
  && has ref 'DRY RUN: would commit' && has ref 'done: 1 attempt\(s\) prepared' \
  && ! has ref 'commit tx|reveal tx'
ok $? "1 reference fix: checked, built, 17/17 public tests, commit prepared, not sent, stops after 1"

# 2 model API: a local stand-in of an OpenAI compatible API, with a throwaway key made here
KEY="test-$(python3 -c 'import secrets;print(secrets.token_hex(16))')"
cat > "$T/mock_api.py" <<'PY'
# A local stand-in of an OpenAI compatible chat completions API: answers with the reference fix and records whether
# the request carried the expected bearer key (it writes yes or no, never the key).
import http.server, json, sys
want = open(sys.argv[2]).read().strip()
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        open(sys.argv[3], "a").write(f"path {self.path} model {body['model']} key_ok {'yes' if self.headers.get('Authorization') == 'Bearer ' + want else 'no'} messages {len(body['messages'])}\n")
        fix = open("data/demo/fixed.rs").read()
        if body.get("stream"):
            # Streamed answer: server-sent events, the fix split into pieces, usage in the last event.
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
            text = "Here is the fix.\n```rust\n" + fix + "```"
            for i in range(0, len(text), 200):
                self.wfile.write(("data: " + json.dumps({"model": body["model"], "choices": [{"delta": {"reasoning_content": "thinking ", "content": text[i:i + 200]}}]}) + "\n\n").encode())
            self.wfile.write(("data: " + json.dumps({"model": body["model"], "choices": [{"delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 1, "completion_tokens": 1}}) + "\n\ndata: [DONE]\n\n").encode())
            return
        out = json.dumps({"model": body["model"], "choices": [{"message": {"role": "assistant", "content": "Here is the fix.\n```rust\n" + fix + "```"}}],
                          "usage": {"prompt_tokens": 1, "completion_tokens": 1}}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
umask 077; echo "$KEY" > "$T/mock_key"; rm -f "$T/mock_api.log"
python3 -I "$T/mock_api.py" 8799 "$T/mock_key" "$T/mock_api.log" & M=$!; sleep 1
conf api 's = s.replace("https://cloud-api.near.ai/v1", "http://127.0.0.1:8799/v1").replace("stream = true", "stream = false")'
NEARAI_API_KEY="$KEY" agent api
kill $M
grep -q 'path /v1/chat/completions .* key_ok yes messages 2' "$T/mock_api.log" && has api 'public tests 17 of 17 pass' && has api 'DRY RUN: would commit' \
  && ! grep -r -q -F "$KEY" "$T/runs" "$T/api.out"
ok $? "2 model API: request to /v1/chat/completions with the key from the environment; key in no log or file"

# 2b the same, streamed (stream = true): the answer arrives in pieces and is put back together
python3 -I "$T/mock_api.py" 8799 "$T/mock_key" "$T/mock_api.log" & M=$!; sleep 1
conf apistream 's = s.replace("https://cloud-api.near.ai/v1", "http://127.0.0.1:8799/v1")'
NEARAI_API_KEY="$KEY" agent apistream
kill $M
has apistream 'finish stop' && has apistream 'public tests 17 of 17 pass' && has apistream 'DRY RUN: would commit' \
  && ! grep -r -q -F "$KEY" "$T/runs" "$T/apistream.out"
ok $? "2b model API, streamed: the pieces are put back together; 17/17 public tests; key in no log or file"

rm -f "$T/mock_key"

# 3 broken answer
printf '#![no_std]\nthis is not rust\n' > "$T/broken.rs"
conf broken 's = s.replace("response_file = \"data/demo/fixed.rs\"", "response_file = \"target/agent-test/broken.rs\"")'
agent broken --provider standin
has broken 'try 1 not used: it does not compile' && has broken 'no usable fix after 2 tries; nothing sent' && ! has broken 'would commit'
ok $? "3 broken answer: not used, nothing prepared"

# 4 wrong answer
conf wrong 's = s.replace("response_file = \"data/demo/fixed.rs\"", "response_file = \"data/attacks/reject_all.rs\"")'
agent wrong --provider standin
has wrong 'try 1 not used: public tests fail' && has wrong 'nothing sent' && ! has wrong 'would commit'
ok $? "4 wrong answer (reject_all): public tests fail, not used"

# 5 file reading at build time
{ echo '#![no_std]'; echo 'static K: &str = include_str!("/etc/hostname");'; sed '/#!\[no_std\]/d' data/demo/fixed.rs; } > "$T/leak.rs"
conf leak 's = s.replace("response_file = \"data/demo/fixed.rs\"", "response_file = \"target/agent-test/leak.rs\"")'
agent leak --provider standin
has leak 'try 1 not used: the source uses include!, env!' && ! has leak 'would commit'
ok $? "5 include_str! in the answer: refused before building"

# 6 fee limit
conf fee 's = s.replace("max_fee_yocto = \"20000000000000000000000\"", "max_fee_yocto = \"1000000000000000000000\"")'
agent fee --provider standin
has fee 'preflight refused|is above max_fee' && ! has fee 'would commit'
ok $? "6 max fee 0.001 NEAR below the next fee: skipped"

# 7 key check: the account's full access key file in place of the limited key
FULL="$(sed -n 's/^credentials_home_dir = "\(.*\)"$/\1/p' "$HOME/.config/near-cli/config.toml")/testnet/$(sed -n 's/^AGENT=//p' docs/evidence/agent/run.env).json"
conf key "s = re.sub(r'limited_key_file = \"[^\"]*\"', 'limited_key_file = \"$FULL\"', s)"
agent key --provider standin
has key 'is not a key limited to commit and reveal .* \(permission: full access\); a live run would stop here'
ok $? "7 full access key: refused"
has ref 'limited to commit, reveal on kintsugi-l2-cihdp.testnet'
ok $? "7b the real limited key: accepted (commit, reveal on the contract)"

# 8 fingerprint against the site's code
N=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
A=$(python3 -I -c "import sys; sys.path.insert(0, 'agent'); import skarbnik_agent as k; print(k.fingerprint(open('data/demo/fixed.wasm','rb').read(), 'payee.testnet', bytes.fromhex('$N')))")
B=$(node scripts/web_fingerprint.mjs data/demo/fixed.wasm payee.testnet "$N")
[ "$A" = "$B" ]; ok $? "8 fingerprint equals the site's ($A)"

# 9 after a FAIL: the next prompt carries the earlier fix and its FAIL verdict
python3 -I - <<'PY9'
import sys; sys.path.insert(0, "agent"); import skarbnik_agent as k
m = k.prompt("src", "tests", "build", {"max_patch_bytes": 1024}, [{"source": "EARLIER FIX SOURCE\n"}])
assert "the verdict was FAIL" in m[1]["content"] and "EARLIER FIX SOURCE" in m[1]["content"]
PY9
ok $? "9 after a FAIL: the next prompt holds the earlier fix and its FAIL verdict"

echo "agent dry run tests: $pass passed, $fail failed"
[ "$fail" = 0 ]
