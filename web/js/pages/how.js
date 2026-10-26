// How it works: "Inside a private repair challenge", four steps (the secret, the agent, the proof, the contract) shown
// as three stations (the vendor's machine, the NEAR contract, the agent) and what moves between them. Play, pause,
// previous, next, replay, the step tabs (arrow keys, Home and End), a "Try it" control per step, the technical detail
// toggle, and a proof path and a timeout path at step 4 (the timeout path says "This is not a proof"). An illustrative
// walkthrough, not connected to the contract; the same story is written out in plain text below it, then the "who
// sees what" matrix and two real bounties, read live: 16 (paid by proof) and 17 (paid by timeout).
import { $, esc, icon, chip, note } from '../ui.js';
import { STATUS } from '../status.js';
import { loadSome } from '../data.js';
import { matrix } from './matrix.js';
import { PUBLISHED_IMAGE_ID } from '../chain.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');

const STEPS = (proof) => [
  { num: '01', label: 'The secret', title: 'A bug exists. The exploit cannot be shared.',
    p1: 'The vendor has a private input that crashes its program. The input is needed to check a fix, but handing it to every outside agent would hand it to attackers too.',
    p2: 'So it stays with the vendor and only a fingerprint goes on chain. The vendor first proves its own reference fix passes, called Proof 0. The bounty opens only after that.' },
  { num: '02', label: 'The agent', title: 'An agent fixes it without seeing it.',
    p1: 'The agent reads the public task and code, writes a patch, and tests it against the public tests only. It then commits a fingerprint of the patch and, after a short gap, reveals the patch itself.',
    p2: 'It acts through a key limited to commit and reveal, and pays a rising attempt fee from credit prepaid into the contract.' },
  { num: '03', label: 'The proof', title: 'The patch is checked, and only the result comes out.',
    p1: 'The vendor’s evaluator runs the revealed patch against the secret input inside a zero knowledge machine. What leaves the machine is a proof and a short public record: hashes and a verdict, PASS or FAIL.',
    p2: 'The secret input is not in that record. The proof is a separate object from the secret, and it covers one patch against one defined check.' },
  { num: '04', label: 'The contract', title: 'The contract applies the rule.',
    p1: proof ? 'The contract checks the proof itself, at about 35 Tgas, and confirms every field in the record belongs to this bounty and this attempt. PASS pays the bounty and returns the winner’s own fee. FAIL spends the attempt.' : 'If the vendor stays silent past the verdict window (set per bounty when it is funded), anyone can call claim_timeout. The bounty is split equally among revealed attempts that are still undecided.',
    p2: proof ? 'The contract does not run the private evaluation. It trusts only a proof from the one approved checker.' : 'A late proof is refused. The contract does not look at the fix, so this path pays whatever was revealed.' },
];
const SEQ = [{ step: 0, lens: 'agent' }, { step: 0, lens: 'eval' }, { step: 1, phase: 'commit' }, { step: 1, phase: 'reveal' }, { step: 2, tech: false }, { step: 2, tech: true }, { step: 3, path: 'proof' }, { step: 3, path: 'timeout' }];

export async function how(viewEl) {
  const st = { step: 0, lens: 'agent', phase: 'commit', path: 'proof', tech: false, playing: false };
  let timer = null, tick = 0;
  viewEl.innerHTML = `<main id="main" class="p-how" tabindex="-1">
<section style="background:radial-gradient(900px 400px at 85% 0%,rgba(var(--am-rgb),.06),transparent 70%),var(--bg)">
<div class="wrap" style="padding-top:40px;padding-bottom:36px">
<div style="display:flex;flex-direction:column;gap:22px;max-width:860px">
<h1 class="h1" style="font-size:clamp(40px,5.4cqw,76px)">Inside a private repair challenge</h1>
<p class="lead">Four steps and a timeout branch, about a minute. Press play, or click through at your own pace. Skip any time. Everything shown is also written out below it.</p>
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center"><button class="btn btn-p" type="button" data-play></button><a class="lnk" href="#/bounties">Skip the intro, browse bounties ${icon('right')}</a></div>
<p class="small faint">An illustrative walkthrough. It is not connected to the contract. Real bounties are linked at the end.</p>
</div></div></section>
<section style="padding-bottom:96px"><div class="wrap"><div class="card story" id="story"></div></div></section>
<section class="sec rule" aria-labelledby="plain-h"><div class="wrap"><div style="max-width:760px;display:flex;flex-direction:column;gap:18px"><p class="eyebrow">The same story in plain text</p><h2 class="h2" id="plain-h">Four steps, written out</h2>
${STEPS(true).map((s, i) => `<div><h3 class="h4" style="margin-top:8px">${i + 1}. ${esc(s.title)}</h3><p class="body" style="margin-top:6px">${esc(s.p1)} ${esc(s.p2)}</p></div>`).join('')}
<div><h3 class="h4" style="margin-top:8px">4b. If the vendor goes silent</h3><p class="body" style="margin-top:6px">${esc(STEPS(false)[3].p1)} ${esc(STEPS(false)[3].p2)} This is not a proof: a timeout payment shows only that the vendor did not answer in time.</p></div>
</div></div></section>
<section class="sec rule" aria-labelledby="who-h" style="background:var(--bg2)"><div class="wrap">
<div style="max-width:720px;display:flex;flex-direction:column;gap:18px"><p class="eyebrow">Who knows what</p><h2 class="h2" id="who-h">What can each party see?</h2><p class="lead">The same story as a table. The contract enforces rules and checks the proof. It does not run the private evaluation.</p></div>
<div id="howMatrix"></div></div></section>
<section class="sec rule" aria-labelledby="real-h"><div class="wrap" style="display:flex;flex-direction:column;gap:28px;align-items:flex-start">
<p class="eyebrow">See it for real</p><h2 class="h2" id="real-h" style="max-width:760px">Two real bounties, two different endings</h2>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr));gap:24px;width:100%" id="real"></div>
</div></section></main>`;
  matrix($('#howMatrix'));

  const story = $('#story');
  const station = (name, vis, visIcon, cls, items) => `<div class="stn ${cls}"><div class="stn-h"><b>${name}</b><span class="vis">${icon(visIcon)} ${vis}</span></div>${items.map((o) => `<div class="ob ${o.cls}"><span class="obi">${icon(o.icon)}</span><span>${o.masked ? '<span class="redact" style="display:block;width:64%;margin:5px 0 9px"></span>' : `<b>${esc(o.title)}</b>`}<span class="s">${esc(o.sub)}</span></span></div>`).join('')}</div>`;
  const lane = (L) => `<div class="lane ${L.on ? 'on ' : 'off '}${L.d === 'r' ? 'r' : L.d === 'l' ? 'l' : 'x'}${L.warn ? ' warn' : ''}" aria-label="${esc(L.t || 'No transfer at this step')}"><span class="ih">${icon(L.d === 'r' ? 'right' : L.d === 'l' ? 'left' : L.warn ? 'x' : 'dash')}</span><span class="iv">${icon(L.d === 'r' ? 'down' : L.d === 'l' ? 'up' : L.warn ? 'x' : 'dash')}</span><span class="lt">${esc(L.t)}</span></div>`;

  function draw(focusTab = false) {
    const S = st.step, proof = st.path === 'proof', cur = STEPS(proof)[S];
    const code = { o: 'on', s: 'seen', i: 'idle' };
    let V = [['o', 'o', 'i', 'i'], ['s', 's', 'i', 'i'], ['o', 's', 'o', 'o'], proof ? ['s', 's', 's', 'o'] : ['s', 's', 'i', 'i']][S];
    let A = [['o', 'i', 'i', 'i'], ['s', 'o', 'o', 'i'], ['s', 's', 's', 'i'], ['s', 's', 's', 'o']][S];
    const N = [['o', 'o', 'i', 'i'], ['s', 's', 'o', 'i'], ['s', 's', 's', 'i'], ['o', 's', 's', 'o']][S];
    let masked = [false, false, false, false];
    if (S === 0) { if (st.lens === 'agent') { V = ['i', 'i', 'i', 'i']; A = ['o', 'i', 'i', 'i']; masked = [true, true, false, false]; } else { V = ['o', 'o', 'i', 'i']; A = ['i', 'i', 'i', 'i']; } }
    const end = S === 3 ? (proof ? 'mint' : 'neutral') : '';
    const mk = (arr, items, m = []) => arr.map((c, i) => ({ cls: code[c] + (items[i].kind && c === 'o' ? ` ${items[i].kind}` : ''), icon: items[i].icon, title: items[i].title, sub: m[i] ? items[i].maskSub : items[i].sub, masked: !!m[i] }));
    const vendor = mk(V, [{ icon: 'eyeoff', title: 'Secret input', sub: 'Held here. Never sent to the agent or to NEAR.', maskSub: 'Hidden from the agent' }, { icon: 'shield', title: 'Reference fix and Proof 0', sub: 'Proves the vendor’s own fix passes first.', maskSub: 'Hidden from the agent' }, { icon: 'cpu', title: 'Evaluator, zkVM', sub: 'Runs the patch against the secret.' }, { icon: 'seal', title: 'PASS or FAIL, with a proof', sub: 'A public output. It does not contain the secret.', kind: end }], masked);
    const chain = mk(N, [{ icon: 'coin', title: S === 3 ? 'Reward released' : 'Reward locked', sub: S === 3 ? (proof ? 'Paid under the proof rule.' : 'Paid under the timeout rule.') : 'Held by the contract until a rule releases it.', kind: end }, { icon: 'hash', title: 'Secret fingerprint', sub: 'A hash of salt and secret. Not the secret.' }, { icon: 'doc', title: S === 1 && st.phase === 'commit' ? 'Patch fingerprint' : S === 0 ? 'Patch' : 'patch.wasm', sub: S === 0 ? 'Waiting for an agent.' : S === 1 && st.phase === 'commit' ? 'Sealed. Only a hash is on chain.' : 'Public after the reveal.' }, { icon: 'cube', title: S === 3 ? (proof ? 'Proof check and rule' : 'claim_timeout') : 'Proof check and rule', sub: S === 3 ? (proof ? 'Groth16 check. PASS pays, FAIL spends the attempt.' : 'Pays revealed attempts. It does not look at the fix.') : 'Runs when a proof or a deadline arrives.', kind: end }]);
    const agent = mk(A, [{ icon: 'book', title: 'Public task and code', sub: 'Original module, public tests and their hashes.' }, { icon: 'doc', title: 'Writes patch.wasm', sub: 'Tested against the public tests only.' }, { icon: 'key', title: 'Limited key and credit', sub: 'Commit and reveal only. Fees come from credit.' }, { icon: 'coin', title: 'Reward', sub: S === 3 ? (proof ? 'Paid by proof.' : 'Paid by timeout. Not a proof.') : 'Not paid yet.', kind: end }]);
    const L1 = [{ d: 'r', t: 'Reward locked. Only a fingerprint of the secret is posted.', on: true }, { d: 'x', t: '', on: false }, { d: 'l', t: 'The revealed patch is read from the chain.', on: true }, proof ? { d: 'r', t: 'Groth16 proof submitted. Anyone may send it.', on: true } : { d: 'x', t: 'No proof arrived inside the verdict window.', on: true, warn: true }][S];
    const L2 = [{ d: 'r', t: 'Public task and code published.', on: true }, { d: 'l', t: st.phase === 'commit' ? 'A fingerprint of the patch.' : 'The patch itself, now public.', on: true }, { d: 'x', t: '', on: false }, { d: 'r', t: proof ? 'Reward paid by proof.' : 'Reward paid by timeout.', on: true }][S];
    const segBtn = (key, val, label) => `<button type="button" data-set="${key}:${val}" aria-pressed="${st[key] === val}">${label}</button>`;
    let side = '';
    if (S === 0) side = `<div class="ipanel"><p class="eyebrow" style="color:var(--tx3)">Try it</p><div class="seg" role="group" aria-label="View">${segBtn('lens', 'agent', 'What the agent sees')}${segBtn('lens', 'eval', 'What the evaluator keeps')}</div><p class="body txt">${st.lens === 'agent' ? 'The agent gets the public task: the original module, the public tests and their hashes. The secret input, the salt and the reference fix are not available to it.' : 'The evaluator is the vendor’s own prover. It keeps the secret input and the salt. Only a fingerprint of the secret and a hash of the reference fix are published.'}</p></div>`;
    if (S === 1) side = `<div class="ipanel"><p class="eyebrow" style="color:var(--tx3)">Try it</p><div class="seg" role="group" aria-label="Phase">${segBtn('phase', 'commit', 'Commit')}${segBtn('phase', 'reveal', 'Reveal')}</div><p class="body txt">${st.phase === 'commit' ? 'Sealed. The agent posts a hash over the patch, its payout account and a random nonce, and pays the attempt fee. Nobody can read the patch yet.' : 'Public. After a short gap the agent posts the patch and the nonce. The contract checks the fingerprint, then records a block seed that picks the hidden fairness inputs, so the patch cannot be tailored to them.'}</p>${note('Two different claims. The agent never sees the secret. Its own patch does not stay secret: it is public once revealed.')}</div>`;
    if (S === 2) side = `<div class="ipanel"><p class="eyebrow" style="color:var(--tx3)">What gets checked</p><p class="body txt">The proof says one patch passed or failed the defined check. It does not say the patch is safe against every other input.</p>
      <button class="btn btn-g btn-s" type="button" aria-expanded="${st.tech}" aria-controls="techBody" data-tech style="align-self:flex-start">${st.tech ? 'Hide the technical detail' : 'Show the technical detail'} <span class="chev${st.tech ? ' rot' : ''}" style="width:24px;height:24px;border:0">${icon('chev')}</span></button>
      <div class="tech" id="techBody"${st.tech ? '' : ' hidden'}><p class="small">The checker runs inside RISC Zero, a zero knowledge virtual machine, on a machine the vendor controls. It checks the module is valid, that the secret input no longer crashes it, that every public test matches the original, that fairness inputs drawn from the reveal seed match, and that small changes to the secret behave like the original.</p><p class="small">What comes out is a journal of hashes and a verdict, plus a Groth16 proof of 2,057 bytes. Checker image id:</p><p class="code">${esc(PUBLISHED_IMAGE_ID)}</p></div></div>`;
    if (S === 3) side = `<div class="ipanel"><p class="eyebrow" style="color:var(--tx3)">Two ways a bounty settles</p><div class="seg" role="group" aria-label="Settlement path">${segBtn('path', 'proof', 'Proof path')}${segBtn('path', 'timeout', 'Timeout path')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">${proof ? chip('k-proof', 'Proof verified', 'check') : chip('k-timeout', 'Timeout settlement', 'hourglass')}</div>
      <p class="body txt">${proof ? 'A proof arrives inside the verdict window. The contract checks it, applies PASS or FAIL, and the evidence trail links the transaction.' : 'No proof arrives inside the verdict window. Anyone can claim the timeout, and the contract pays under that rule. The outcome is labelled Timeout settlement everywhere.'}</p>
      ${proof ? '' : `<div class="warnbox">${icon('alert')}<p><b>This is not a proof.</b> The contract never looks at the fix, so a timeout payment shows only that the vendor did not answer in time.</p></div>`}</div>`;
    story.innerHTML = `<div class="stabs" role="tablist" aria-label="Story steps">${STEPS(proof).map((s, i) => `<button class="stab ${i === S ? 'cur' : i < S ? 'done' : ''}" type="button" role="tab" id="stab-${i}" aria-selected="${i === S}" aria-controls="storyPanel" tabindex="${i === S ? 0 : -1}" data-go="${i}"><span class="sn">${i + 1}</span><span>${esc(s.label)}</span></button>`).join('')}</div>
<div id="storyPanel" role="tabpanel" aria-labelledby="stab-${S}" aria-live="polite" style="margin-top:36px">
<p class="eyebrow">${cur.num} / ${esc(cur.label)}</p>
<h2 class="h2" style="margin-top:12px;max-width:900px">${esc(cur.title)}</h2>
<div class="stage" role="group" aria-label="Where each object is at this step">${station('Vendor’s machine', 'Private', 'eyeoff', 'priv', vendor)}${lane(L1)}${station('NEAR contract', 'Public', 'eye', '', chain)}${lane(L2)}${station('Agent', 'Outside', 'eye', '', agent)}</div>
<div class="txgrid"><div style="display:flex;flex-direction:column;gap:16px;max-width:560px"><p class="body" style="color:var(--tx);font-size:18px;line-height:1.55">${esc(cur.p1)}</p><p class="body">${esc(cur.p2)}</p></div><div>${side}</div></div>
</div>
<div class="ctl"><div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center"><button class="btn btn-g" type="button" data-go="${S - 1}"${S === 0 ? ' disabled' : ''}>${icon('left')} Previous</button><button class="btn btn-p" type="button" data-go="${S + 1}"${S === 3 ? ' disabled' : ''}>Next step ${icon('right')}</button></div>
<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center"><span class="pgs" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<i class="${i <= S ? 'f' : ''}"></i>`).join('')}</span><button class="btn btn-g btn-s" type="button" data-play></button><button class="btn btn-g btn-s" type="button" data-replay>${icon('replay')} Replay</button></div></div>`;
    document.querySelectorAll('[data-play]').forEach((b) => { b.innerHTML = `${icon(st.playing ? 'pause' : 'play')}${st.playing ? 'Pause' : 'Play the story'}`; });
    story.querySelectorAll('.stab').forEach((b, i) => b.addEventListener('keydown', (e) => {
      const n = e.key === 'ArrowRight' ? Math.min(3, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? 3 : null;
      if (n !== null) { e.preventDefault(); go(n, true); }
    }));
    if (focusTab) { const t = $(`#stab-${S}`); if (t) t.focus(); }
  }
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } st.playing = false; };
  const go = (n, focus = false) => { stop(); st.step = Math.max(0, Math.min(3, n)); draw(focus); };
  const play = (from = 0) => {
    stop(); tick = from; Object.assign(st, SEQ[tick]); st.playing = true; draw();
    timer = setInterval(() => {
      if (!document.body.contains(story)) { stop(); return; }
      tick += 1;
      if (tick > 7) { stop(); draw(); return; }
      Object.assign(st, SEQ[tick]); draw();
    }, reduce.matches ? 4000 : 9000);
  };
  viewEl.querySelector('main').addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g && !g.disabled) { go(Number(g.dataset.go), g.classList.contains('stab')); return; }
    if (e.target.closest('[data-play]')) { if (st.playing) { stop(); draw(); } else play(0); return; }
    if (e.target.closest('[data-replay]')) { Object.assign(st, { step: 0, lens: 'agent', phase: 'commit', path: 'proof', tech: false }); play(0); return; }
    const s = e.target.closest('[data-set]'); if (s) { stop(); const [k, v] = s.dataset.set.split(':'); st[k] = v; draw(); const again = story.querySelector(`[data-set="${k}:${v}"]`); if (again) again.focus(); return; }
    if (e.target.closest('[data-tech]')) { stop(); st.tech = !st.tech; draw(); const t = story.querySelector('[data-tech]'); if (t) t.focus(); }
  });
  draw();

  // the two real bounties, with their status read live
  try {
    const all = await loadSome(['16', '17']);
    const card = (id, text, link) => {
      const x = all.find((e) => String(e.b.id) === id); if (!x) return '';
      const s = STATUS[x.status];
      return `<a class="card" href="#/bounties/${id}" style="padding:28px;display:flex;flex-direction:column;gap:14px;text-decoration:none"><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><span class="eyebrow" style="color:var(--tx3)">Bounty ${id}</span>${chip(s.cls, x.status, s.icon)}${x.kind === 'test' ? chip('k-test', 'Test bounty', 'flask') : ''}</div><p class="body">${esc(text)}</p><span class="lnk" style="align-self:flex-start">${esc(link)} ${icon('right')}</span></a>`;
    };
    if ($('#real')) $('#real').innerHTML = card('16', 'The contract checked a proof and paid the agent. The shortest path through everything above.', 'See the transactions') + card('17', 'A private bounty. The proof finished after the window, so the timeout rule paid. Not a proof.', 'Read the full account');
  } catch (e) { if ($('#real')) $('#real').innerHTML = note(`Could not read the two bounties from testnet: ${esc(e.message)}`, 'alert'); }
}
