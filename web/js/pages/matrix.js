// The "who sees what" matrix, used on Home and on How it works: four parties (vendor, agent, public observer, NEAR
// contract) and what each holds, sees, sees only as a hash, or cannot see. Pick a party and its column lights up and
// the summary says what it knows and what it cannot do. Four states, four icons, four words: never colour alone.
import { esc, icon } from '../ui.js';

const P = [
  { name: 'Vendor', icon: 'user', role: 'Holds the secret', text: 'Holds the private input, prepares the bounty and the reference fix, and runs the evaluation in the current workflow. That also means carrying the proving cost.', cannot: 'Block a payout by going silent. After the verdict window, the timeout rule pays.' },
  { name: 'Agent', icon: 'cpu', role: 'Writes the fix', text: 'Sees the public task and code, submits a candidate patch, and takes part within the fee and attempt limits.', cannot: 'See the secret input. Its limited key can commit and reveal, not withdraw.' },
  { name: 'Public observer', icon: 'eye', role: 'Checks the record', text: 'Can inspect bounty data, revealed patches, proofs and settlement records on chain, and rebuild the checker.', cannot: 'See the secret input on a private bounty.' },
  { name: 'NEAR contract', icon: 'cube', role: 'Enforces the rules', text: 'Enforces the configured rules and verifies the proof. It holds the money and the deadlines.', cannot: 'Run the private evaluation, or judge a fix by reading it.' },
];
const ICON = { holds: 'key', sees: 'eye', hash: 'hash', hidden: 'eyeoff' };
const R = [
  ['Secret input and salt', [['holds', 'Holds'], ['hidden', 'Hidden'], ['hidden', 'Hidden'], ['hash', 'Hash only']]],
  ['Reference fix, private bounties', [['holds', 'Holds'], ['hidden', 'Hidden'], ['hidden', 'Hidden'], ['hash', 'Hash only']]],
  ['Public task, code and tests', [['holds', 'Publishes'], ['sees', 'Sees'], ['sees', 'Sees'], ['hash', 'Stores hashes']]],
  ['Patch before reveal', [['hash', 'Fingerprint'], ['holds', 'Holds'], ['hash', 'Fingerprint'], ['hash', 'Fingerprint']]],
  ['Patch after reveal', [['sees', 'Sees'], ['holds', 'Holds'], ['sees', 'Sees'], ['holds', 'Stores']]],
  ['Proof and journal', [['holds', 'Produces'], ['sees', 'Sees'], ['sees', 'Sees'], ['holds', 'Verifies']]],
  ['Verdict, PASS or FAIL', [['sees', 'Sees'], ['sees', 'Sees'], ['sees', 'Sees'], ['holds', 'Applies']]],
  ['Payout', [['sees', 'Funds it'], ['sees', 'Receives'], ['sees', 'Sees'], ['holds', 'Enforces']]],
];

const html = (sel) => `<div class="mech">
<div>
<div class="pick" role="group" aria-label="Choose a party">${P.map((p, i) => `<button class="pbtn" type="button" data-party="${i}" aria-pressed="${i === sel}"><span class="pico">${icon(p.icon)}</span><span><b class="h4" style="display:block">${esc(p.name)}</b><span class="small faint">${esc(p.role)}</span></span></button>`).join('')}</div>
<div class="card" style="padding:24px;margin-top:16px;display:flex;flex-direction:column;gap:14px" aria-live="polite">
<p class="eyebrow">${esc(P[sel].name)}</p>
<p class="body" style="color:var(--tx)">${esc(P[sel].text)}</p>
<p class="small" style="padding-top:14px;border-top:1px solid var(--ln)"><b style="color:var(--tx)">Cannot:</b> ${esc(P[sel].cannot)}</p>
</div>
</div>
<div class="card" style="overflow:hidden">
<div class="scroll-x">
<table class="mx">
<caption class="sr-only">What each party sees and holds</caption>
<thead><tr><th class="first" scope="col">Item</th>${P.map((p, i) => `<th scope="col" class="${i === sel ? 'sel' : ''}">${esc(p.name)}</th>`).join('')}</tr></thead>
<tbody>${R.map(([label, cells]) => `<tr><td class="rowh">${esc(label)}</td>${cells.map(([k, t], i) => `<td class="${i === sel ? 'sel' : ''}"><span class="cell t-${k}">${icon(ICON[k])}${esc(t)}</span></td>`).join('')}</tr>`).join('')}</tbody>
</table>
</div>
<div class="legend"><span><span class="cell t-holds" style="min-height:28px;padding:0 8px">${icon('key')} Holds</span> holds or produces it</span><span><span class="cell t-sees" style="min-height:28px;padding:0 8px">${icon('eye')} Sees</span> can read it</span><span><span class="cell t-hash" style="min-height:28px;padding:0 8px">${icon('hash')} Hash only</span> a fingerprint, not the thing</span><span><span class="cell t-hidden" style="min-height:28px;padding:0 8px">${icon('eyeoff')} Hidden</span> cannot see it</span></div>
</div>
</div>`;

// Renders the matrix into el and keeps it interactive; party 0 (the vendor) is selected first.
export function matrix(el, sel = 0) {
  el.innerHTML = html(sel);
  el.querySelectorAll('[data-party]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.party);
    matrix(el, i);
    el.querySelector(`[data-party="${i}"]`).focus();
  }));
}
