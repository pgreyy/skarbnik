// The keyless patch check at /api/check, for the local MCP server (tools/skarbnik-mcp) and anyone else: POST a JSON
// body {bounty_id, wat} (the whole fixed module as WebAssembly text) or {bounty_id, patch_base64}; the answer is the
// assembled module in base64 and the same checks as the hosted connector's check_patch (size, exports against the
// public program, the public tests, the public demo input on demo bounties; on a rule checker bounty each public call
// sequence and its exact results). No key, nothing sent to the chain, nothing stored, no logging; rate limited per
// address. It does not show that a fix passes the private test.
// {bounty_id, want: "original_wat"} returns the bounty's public code with the original module as WebAssembly text
// (and on a rule checker bounty the public rule as C and as WebAssembly text).
'use strict';
const { checkPatch, patchBytes, patchOk, bounty, Fail, TOOLS } = require('./_lib/agent.js');

const hits = new Map();
function limited(addr) {
  const now = Date.now(), h = hits.get(addr);
  if (!h || now - h.t > 60000) { hits.set(addr, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return false; }
  h.n += 1;
  return h.n > 30;
}
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
const MAX_BODY = 300000; // bytes; a fix is at most 2,048 bytes, its WebAssembly text far below this
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    // already parsed by the platform: measure it and refuse anything above the cap
    const raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > MAX_BODY) throw new Error('too large');
    return typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(raw);
  }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new Error('too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}

module.exports = async function handler(req, res) {
  try {
    const addr = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (limited(addr)) return send(res, 429, { error: 'too many requests: wait a minute' });
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method !== 'POST') return send(res, 405, { error: 'POST {bounty_id, wat} or {bounty_id, patch_base64}' });
    let a;
    try { a = await readBody(req); } catch (e) { return send(res, /too large/.test(String(e && e.message)) ? 413 : 400, { error: /too large/.test(String(e && e.message)) ? 'the body is larger than 300,000 bytes' : 'the body must be JSON' }); }
    if (!a || !/^\d{1,9}$/.test(String(a.bounty_id || ''))) return send(res, 400, { error: 'bounty_id is required' });
    const bid = String(a.bounty_id);
    if (a.want === 'original_wat') return send(res, 200, await TOOLS.get_public_code.run(null, { bounty_id: bid }));
    const b = await bounty(bid);
    const bytes = await patchBytes(a);
    const c = await checkPatch(bid, bytes, b);
    return send(res, 200, { ...c, ready_to_commit: patchOk(c), patch_base64: Buffer.from(bytes).toString('base64') });
  } catch (e) {
    return send(res, e instanceof Fail ? 400 : 500, { error: e instanceof Fail ? e.message : 'the check failed; try again' });
  }
};
