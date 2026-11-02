// The hosted agent connector: an MCP server (Streamable HTTP, stateless, JSON responses) at /api/mcp/<token>, for AI
// apps that add a tool by pasting one link (Claude custom connectors, ChatGPT developer mode). The token in the path
// carries an agent key limited to commit and reveal (made on the Account page). Every request checks that key on chain
// first; a missing, malformed, unknown or deleted key gets a plain 404 with no detail. No vendor tools, testnet only.
// Never logs, caches or echoes the token: no console calls, Cache-Control no-store, Referrer-Policy no-referrer.
// Rate limits per token and per address are kept in this instance's memory only. The tools are in ../_lib/agent.js.
'use strict';
const crypto = require('node:crypto');
const { decodeToken, keyAllowed, handleMessage } = require('../_lib/agent.js');

const WINDOW_MS = 60000;
const LIMITS = { token: 60, addr: 120 };
const hits = new Map();
function limited(kind, id) {
  const now = Date.now(), key = `${kind}:${id}`;
  const h = hits.get(key);
  if (!h || now - h.t > WINDOW_MS) { hits.set(key, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return false; }
  h.n += 1;
  return h.n > LIMITS[kind];
}

function send(res, status, body, type) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (status === 405) res.setHeader('Allow', 'POST, OPTIONS');
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', type || 'application/json');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
const notFound = (res) => send(res, 404, 'Not found\n', 'text/plain; charset=utf-8');

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
    const proto = req.headers['x-forwarded-proto'];
    if (proto && proto !== 'https') return notFound(res);
    const addr = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (limited('addr', addr)) return send(res, 429, 'Too many requests\n', 'text/plain; charset=utf-8');
    if (req.method === 'OPTIONS') return send(res, 204);
    const token = req.query && req.query.token;
    const k = decodeToken(Array.isArray(token) ? token[0] : token);
    if (!k) return notFound(res);
    if (limited('token', crypto.createHash('sha256').update(k.seed).digest('hex').slice(0, 24))) return send(res, 429, 'Too many requests\n', 'text/plain; charset=utf-8');
    if (!(await keyAllowed(k))) return notFound(res);
    if (req.method !== 'POST') return send(res, 405, 'Use POST\n', 'text/plain; charset=utf-8');
    let body;
    try { body = await readBody(req); } catch (e) { return /too large/.test(String(e && e.message)) ? send(res, 413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'the request is larger than 300,000 bytes' } }) : send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    const batch = Array.isArray(body);
    const msgs = (batch ? body : [body]).slice(0, 20);
    const out = [];
    for (const m of msgs) {
      if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || !m.method) { if (m && m.id != null && !('result' in m) && !('error' in m)) out.push({ jsonrpc: '2.0', id: m.id, error: { code: -32600, message: 'invalid request' } }); continue; }
      const r = await handleMessage(k, m);
      if (r) out.push(r);
    }
    if (!out.length) return send(res, 202);
    return send(res, 200, batch ? out : out[0]);
  } catch {
    return send(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'internal error' } });
  }
};
