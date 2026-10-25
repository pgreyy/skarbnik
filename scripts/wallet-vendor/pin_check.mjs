// Checks the pinned wallet scripts (run by pin_check.sh): opens Connect wallet, picks a wallet, and reports whether its
// script loaded from the official address and ran (NEAR CLI: its account form appears; Intear: after choosing "Web" in
// its own chooser, its wallet window opens). With "tamper", the browser changes one byte of the NEAR CLI script in
// transit, and the site must refuse to run it.
const [,, port, base, wallet, mode] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(250); } }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); let id = 0; const pend = new Map();
const net = []; const logs = [];
ws.onmessage = async (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); }
  if (d.method === 'Network.responseReceived' && /near-selector\.js|near-cli\.js/.test(d.params.response.url)) net.push(`${d.params.response.status} ${d.params.response.url.replace(/\?.*/, '')}`);
  if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails.exception?.description || '').slice(0, 200));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('console: ' + d.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  if (d.method === 'Fetch.requestPaused') {
    const r = await fetch(d.params.request.url); const b = Buffer.from(await r.arrayBuffer()); b[b.length - 2] ^= 1;
    send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'text/plain' }], body: b.toString('base64') });
    net.push('tampered one byte of ' + d.params.request.url.replace(/\?.*/, ''));
  }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e, ctx) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: true, ...(ctx ? { contextId: ctx } : {}) }); return r.result ? r.result.value : undefined; };
await send('Network.enable'); await send('Runtime.enable');
if (mode === 'tamper') await send('Fetch.enable', { patterns: [{ urlPattern: '*near-cli.js*' }] });
await send('Page.navigate', { url: base + '?intro=0#/' }); await sleep(5000);
await ev(`document.getElementById('connBtn').click()`); await sleep(3000);
const listed = await ev(`[...document.querySelectorAll('body *')].filter(e => e.children.length < 4 && /^(Intear Wallet|NEAR CLI)$/.test((e.textContent||'').trim())).map(e => e.textContent.trim()).filter((v,i,a) => a.indexOf(v) === i).join(', ')`);
await ev(`[...document.querySelectorAll('body *')].find(e => e.children.length < 4 && (e.textContent||'').trim() === '${wallet}').click()`); await sleep(8000);
let form = false;
const tree = await send('Page.getFrameTree'); const fr = []; const walk = (n) => { fr.push(n.frame); (n.childFrames || []).forEach(walk); }; walk(tree.frameTree);
for (const f of fr.slice(1)) {
  const w = await send('Page.createIsolatedWorld', { frameId: f.id, worldName: 'chk' + Math.random(), grantUniveralAccess: true });
  if (await ev(`!!document.querySelector('#account-id')`, w.executionContextId)) form = true;
  if (await ev(`/CONNECT INTEAR WALLET/i.test(document.body ? document.body.innerText : '')`, w.executionContextId)) {
    console.log("buttons:", await ev(`[...document.querySelectorAll("*")].filter(b => /Web/.test(b.textContent) && b.children.length < 3).map(b => b.tagName + '.' + b.className + '=' + b.textContent.trim().replace(/\\s+/g,' ')).join(' ; ')`, w.executionContextId));
    await ev(`[...document.querySelectorAll('*')].filter(b => /Web/.test(b.textContent) && !/Beta/.test(b.textContent) && b.children.length < 3).pop().click()`, w.executionContextId); await sleep(6000);
    await ev(`[...document.querySelectorAll('button, [role=button], div')].find(b => /^🌐\s*Web$/.test((b.textContent||'').trim())).click()`, w.executionContextId); await sleep(6000);
  }
  console.log('frame text:', ((await ev(`document.body ? document.body.innerText : ''`, w.executionContextId)) || '').replace(/\s+/g, ' ').slice(0, 200));
}
const t2 = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
console.log('targets:', t2.map((t) => t.type + ' ' + t.url.slice(0, 80)).join(' | '));
const windows = t2.filter((t) => /intear/.test(t.url)).map((t) => { const u = new URL(t.url); return u.origin + u.pathname; });
console.log('wallets listed:', listed);
console.log('script requests:', net.join(' | ') || 'none');
console.log('NEAR CLI account form shown:', form);
console.log('Intear windows opened:', windows.join(', ') || 'none');
console.log('header:', (await ev(`document.getElementById('walletArea').innerText`) || '').replace(/\s+/g, ' '));
console.log('page message:', (await ev(`(document.querySelector('.k-toast, #toast') || {}).innerText || ''`) || '').replace(/\s+/g, ' '));
console.log('errors:', logs.join(' || ') || 'none');
ws.close(); process.exit(0);
