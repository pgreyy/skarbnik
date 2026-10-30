// Bounties: every bounty on the contract, newest first, read live from testnet. A "How was it paid?" key, four
// count tiles, a filter per status that is present (with counts; one line that scrolls sideways when it does not fit,
// arrow keys move between them), and one row per bounty: id, title and kind,
// reward, attempts, status with a plain line, and its evidence (the payout or creation transaction from
// data/recorded.json) with a link. On narrow screens the rows stack into cards.
import { near, utcShort, commitBy, CONTRACT } from '../chain.js';
import { $, esc, icon, chip, tx, note } from '../ui.js';
import { STATUS, kindChips } from '../status.js';
import { loadAll, fromFeed, getRecorded, getMeta, firstTx, lastTx } from '../data.js';

let filter = 'all';

// A plain line under the status, from the chain (and the bounty's own note when one is recorded).
function subLine(x, meta, rec) {
  const { b, subs, status } = x, id = String(b.id);
  if (x.snap) return x.snap.accepts_commits ? `Accepting commits until ${x.snap.windows.commit_deadline_utc.replace('T', ' ').replace(':00Z', '').replace('Z', '')} UTC (snapshot).` : (meta.notes || {})[id] || '';
  const recNote = rec.bounty_notes && rec.bounty_notes[id];
  if (recNote) return recNote.text;
  if (meta.notes && meta.notes[id] && (status === 'Proof verified' || status === 'Timeout settlement' || status === 'Refunded')) return meta.notes[id];
  const waiting = subs.filter((s) => s && s.outcome === 'Open' && s.revealed_at_ns).length;
  if (status === 'Proof verified') return 'A PASS proof was accepted by the contract.';
  if (status === 'Timeout settlement') return 'No proof arrived in the window. Paid by the timeout rule.';
  if (status === 'Refunded') return 'Refunded to the vendor.';
  if (status === 'Failed') return 'Past its expiry and not settled. Anyone can call expire to refund the vendor.';
  if (status === 'Waiting for Proof 0') return 'Created. It opens when its Proof 0 is accepted.';
  if (waiting) return `${waiting} revealed ${waiting === 1 ? 'attempt' : 'attempts'} waiting for a verdict.${x.accepting ? ` Commits accepted until ${utcShort(commitBy(b))} UTC.` : ''}`;
  if (x.accepting) return `Open until ${utcShort(commitBy(b))} UTC. ${b.commits ? `${b.commits} ${b.commits === 1 ? 'attempt' : 'attempts'} so far.` : 'No attempts yet.'}`;
  if (status === 'Proof rejected') return 'An attempt was rejected by a FAIL proof.';
  return b.state === 'Open' ? 'Not accepting new commits now.' : '';
}

function evidenceOf(x, rec) {
  const id = String(x.b.id);
  if (x.status === 'Proof verified') return ['Proof transaction', lastTx(rec, id, 'submit_groth16') || lastTx(rec, id, 'attest')];
  if (x.status === 'Timeout settlement') return ['Claim transaction', lastTx(rec, id, 'claim_timeout')];
  if (x.status === 'Refunded') return ['Expire transaction', lastTx(rec, id, 'expire')] ;
  return ['Created transaction', firstTx(rec, id, 'create_bounty')];
}

export async function bounties(viewEl) {
  viewEl.innerHTML = `<main id="main" class="p-bounties" tabindex="-1">
<section class="ph">
<div class="wrap ph-grid">
<div style="display:flex;flex-direction:column;gap:24px;max-width:640px">
<p class="eyebrow">Bounties on NEAR testnet</p>
<h1>Bounties</h1>
<p class="lead">Each row is one repair bounty, read from the contract. Open ones accept attempts until they close. Finished ones show how the money moved. Look at the status to see whether a payment was backed by a proof or paid by timeout.</p>
</div>
<div class="card key" role="group" aria-label="How was it paid? Reading the status column">
<p class="eyebrow" style="color:var(--tx3)">How was it paid?</p>
${['Proof verified', 'Timeout settlement', 'Refunded'].map((s) => `<div class="key-row">${chip(STATUS[s].cls, s, STATUS[s].icon)}<p>${esc(STATUS[s].help)}</p></div>`).join('')}
</div>
</div>
</section>
<section style="padding:0 0 112px">
<div class="wrap" id="blist"><p class="state">Reading every bounty from testnet…</p></div>
</section>
</main>`;
  let all, rec, meta, snapshot = null;
  try { [rec, meta] = await Promise.all([getRecorded(), getMeta()]); } catch (e) {
    if ($('#blist')) $('#blist').innerHTML = note(`Could not load the site's data: ${esc(e.message)}. Reload to try again.`, 'alert'); return;
  }
  // First the last feed snapshot (scripts/gen_feed.py), labelled with its time, so the list shows at once and survives
  // a busy RPC; then the live read from the contract replaces it.
  const live = loadAll();
  try { const f = await fromFeed(); all = f.list; snapshot = { at: f.at, err: null }; } catch { all = null; }
  const goLive = live.then((l) => { all = l; snapshot = null; }).catch((e) => { if (snapshot) snapshot.err = e.message; else throw e; });
  if (!all) { try { await goLive; } catch (e) { if ($('#blist')) $('#blist').innerHTML = note(`Could not read the contract on testnet: ${esc(e.message)}. Check your connection and reload.`, 'alert'); return; } }
  if (!$('#blist')) return;
  const row = (x) => {
    const { b } = x, id = String(b.id), st = STATUS[x.status], [txl, txid] = evidenceOf(x, rec);
    return `<div class="brow" role="listitem">
<div class="bid">#${esc(id)}</div>
<div class="bmain"><a class="h4" style="display:block;text-decoration:none;color:var(--tx)" href="#/bounties/${esc(id)}">${esc((meta.titles || {})[id] || `Bounty ${id}`)}</a>
<div class="kinds">${kindChips(b, rec).map(([t, c]) => chip(c, t)).join('')}</div></div>
<div class="bnum n1"><span class="lbl">Reward</span><b>${esc(near(b.amount).replace(' NEAR', ''))}<small>NEAR</small></b></div>
<div class="bnum n2"><span class="lbl">Attempts</span><b>${esc(b.max_commits)}<small>max</small></b>${b.commits ? `<span class="small faint">${esc(b.commits)} used</span>` : ''}</div>
<div class="bstat">${chip(st.cls, x.status, st.icon)}<p class="small">${esc(subLine(x, meta, rec))}</p></div>
<div class="bev">${txid ? `<span class="txl">${esc(txl)}</span>${tx(txid)}` : '<span class="txl">No transaction recorded</span>'}
<a class="lnk" style="min-height:30px;font-size:14px" href="${x.accepting ? '#/agents' : `#/bounties/${esc(id)}`}">${x.accepting ? 'Run an agent' : 'Open bounty'}</a></div>
</div>`;
  };
  const draw = () => {
    const list = all.slice().sort((x, y) => Number(y.b.id) - Number(x.b.id));
    const n = (st) => list.filter((x) => x.status === st).length;
    const failed8 = list.filter((x) => rec.bounty_notes && rec.bounty_notes[String(x.b.id)] && rec.bounty_notes[String(x.b.id)].transfer_failed).length;
    const present = Object.keys(STATUS).filter((st) => n(st));
    if (filter !== 'all' && !present.includes(filter)) filter = 'all';
    const rows = list.filter((x) => filter === 'all' || x.status === filter);
    $('#blist').innerHTML = `
<div class="strip" aria-label="Summary of the ${list.length} bounties on the contract">
<div><b>${list.filter((x) => x.accepting).length}</b><span>Accepting commits now</span></div>
<div><b>${n('Proof verified')}</b><span>Paid by proof</span></div>
<div><b>${n('Timeout settlement')}</b><span>Settled by timeout${failed8 ? `, ${failed8} of them paid on paper only (transfer failed)` : ''}</span></div>
<div><b>${n('Refunded')}</b><span>Refunded</span></div>
</div>
<div class="bar">
<div class="seg" role="group" aria-label="Filter bounties">${[['all', 'All', list.length], ...present.map((s) => [s, s, n(s)])].map(([k, t, c]) => `<button type="button" data-f="${esc(k)}" aria-pressed="${filter === k}">${esc(t)} <span style="color:var(--tx3)">${c}</span></button>`).join('')}</div>
<p class="small faint" aria-live="polite">Showing ${rows.length} of ${list.length} on ${esc(CONTRACT)}</p>
</div>
<div class="blist" role="list" aria-label="Bounties">
<div class="bhead" aria-hidden="true"><span>Id</span><span>Bounty</span><span>Reward</span><span>Attempts</span><span>Status</span><span>Evidence</span></div>
${rows.length ? rows.map(row).join('') : '<p class="empty">No bounties match this filter.</p>'}
</div>
${snapshot ? `<div style="margin-top:24px">${note(snapshot.err ? `The contract could not be read just now (${esc(snapshot.err)}). This list is the feed snapshot made at ${esc(snapshot.at)}: reload to read it live.` : `This list is the feed snapshot made at ${esc(snapshot.at)}. Reading the contract live…`, snapshot.err ? 'alert' : 'clock')}</div>` : ''}
<div style="margin-top:24px">${note(`Every bounty on this contract is listed, read live from testnet. Test, demo and judge bounties are labelled. Titles are short descriptions; every status, amount and count comes from the chain.`)}</div>
<div style="margin-top:12px">${note('On private bounties, researchers and the public never see the secret input. Demo bounties use a public input so anyone can check them.', 'eyeoff')}</div>`;
    $('#blist').querySelectorAll('[data-f]').forEach((btn) => btn.addEventListener('click', () => { filter = btn.dataset.f; draw(); const b = $(`[data-f="${CSS.escape(filter)}"]`); if (b) b.focus(); }));
    // The filter row scrolls sideways when it does not fit: a fade at the right edge while more is hidden; arrow keys,
    // Home and End move between the filters.
    const seg = $('#blist .seg');
    if (seg) {
      const fade = () => seg.toggleAttribute('data-more', seg.scrollWidth - seg.clientWidth - seg.scrollLeft > 2);
      seg.addEventListener('scroll', fade, { passive: true });
      if (window.ResizeObserver) new ResizeObserver(fade).observe(seg);
      fade();
      seg.addEventListener('keydown', (e) => {
        const btns = [...seg.querySelectorAll('[data-f]')], i = btns.indexOf(document.activeElement);
        const n = i < 0 ? null : e.key === 'ArrowRight' ? Math.min(btns.length - 1, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : null;
        if (n === null) return;
        e.preventDefault(); btns[n].focus();
      });
    }
  };
  draw();
  goLive.then(() => { if ($('#blist')) draw(); }, () => { if ($('#blist')) draw(); });
}
