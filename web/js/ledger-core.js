// The Proof Ledger's rules, with no network or page code, so the site (web/js/app.js) and the generators of ledger.json
// and metrics.json (scripts/gen_ledger.mjs) compute the same thing from the same chain data. Input: every bounty
// (get_bounty) and every attempt of it (get_submission), the transaction ids the repository records
// (web/data/recorded.json), who runs each account (web/data/accounts.json), which machine proved which attempt
// (web/data/provers.json) and, if an operator supplied them, model and compute costs (web/data/operator_costs.json).
// Output: each paid fix with how it was paid, each account's earnings, each vendor's on-time record, distinct
// counterparties, and a few numbers. No scores, no ranks, no credit for unpaid attempts.

// How the winning payout of a bounty was made: 'proof' (a verdict that became final: a Groth16 PASS, or two verifier
// attestations at Level 0) or 'timeout' (the deadline passed with no final verdict; claim_timeout paid).
const howOf = (s) => (s.outcome === 'Passed' ? 'proof' : s.outcome === 'TimedOut' ? 'timeout' : null);

export const PASS_MEANS = 'passed this checker against the secret and the public tests; it does not prove the patch is secure against everything.';
export const TIMEOUT_MEANS = 'paid by the timeout rule: a liveness rule, not a verdict; no proof checked this fix.';

// The recorded transaction that made a bounty's payout: the one successful claim_timeout for a timeout; for a proof, the
// last successful submit_groth16 (a PASS closes the bounty, so no later proof can succeed) or Level 0 attestation.
function payoutTx(recorded, bid, how) {
  const rows = ((recorded && recorded.bounties && recorded.bounties[String(bid)]) || []).filter((r) => r.result === 'succeeded');
  const pick = how === 'timeout' ? rows.filter((r) => r.method === 'claim_timeout') : rows.filter((r) => r.method === 'submit_groth16' || r.method === 'attest');
  return pick.length ? pick[pick.length - 1].tx : null;
}

const median = (xs) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

// hashes: a Map from account name to the sha256 (hex) of the name, for accounts.json's hashed_accounts (shown by label).
export function buildLedger(bounties, subsByBounty, recorded, accounts, nowMs = Date.now(), hashes = new Map(), provers = {}, costs = {}) {
  const hashed = (a) => (accounts && accounts.hashed_accounts && hashes.has(a) && accounts.hashed_accounts[hashes.get(a)]) || null;
  const kind = (a) => (accounts && accounts.accounts && accounts.accounts[a]) || (hashed(a) && hashed(a).kind) || 'not known';
  const shown = (a) => (hashed(a) ? hashed(a).label : a);
  const fixes = [];
  const vendors = new Map();
  const earn = new Map();
  const e = (a) => earn.get(a) || earn.set(a, { account: shown(a), kind: kind(a), attempts: 0, fees_spent_yocto: 0n, fees_returned_yocto: 0n,
    gross_rewards_yocto: 0n, proof_checked_passes: 0, timeout_payouts: 0, rejected_by_a_fail_proof: 0, released_unrevealed: 0, waiting: 0,
    model_and_compute_cost: (costs && costs[a]) || null }).get(a);
  const times = [];
  const paidRaw = new Set();
  for (const b of bounties) {
    const subs = subsByBounty[String(b.id)] || [];
    const v = vendors.get(b.vendor) || { vendor: shown(b.vendor), kind: kind(b.vendor), bounties: 0, proved_on_time: 0, not_proved_in_time: 0, waiting_past_deadline: 0 };
    v.bounties += 1;
    // The amount each paid attempt received: the whole bounty for a proof; for a timeout an equal share of the bounty
    // among all attempts paid by that timeout, the remainder of the division to the claimed (winning) attempt.
    const timed = subs.map((s, i) => [s, i]).filter(([s]) => s.outcome === 'TimedOut');
    const n = BigInt(timed.length || 1), amount = BigInt(b.amount), share = amount / n;
    const note = recorded && recorded.bounty_notes && recorded.bounty_notes[String(b.id)];
    // A payout the contract marked as paid but whose transfer failed (bounty 8: the account does not exist) moved no
    // NEAR: it is listed, labelled, and counted nowhere as paid.
    const failed = !!(note && note.transfer_failed);
    subs.forEach((s, i) => {
      // The fee an attempt paid: base + index * step (the contract's rule). Read this way because the contract sets the
      // stored fee to 0 when it refunds an undecided attempt as credit.
      const fee = BigInt(b.attempt_fee) + BigInt(i) * BigInt(b.fee_step);
      const c = e(s.committer);
      c.attempts += 1; c.fees_spent_yocto += fee;
      const closed = b.state !== 'Open';
      if (s.outcome === 'Passed') { c.proof_checked_passes += 1; if (!failed) c.fees_returned_yocto += fee; }
      else if (s.outcome === 'TimedOut') { c.timeout_payouts += 1; if (!failed) c.fees_returned_yocto += fee; }
      else if (s.outcome === 'Failed') c.rejected_by_a_fail_proof += 1;
      else if (s.outcome === 'Released') c.released_unrevealed += 1;
      else if (s.revealed_at_ns && closed) c.fees_returned_yocto += fee; // refunded as credit when the bounty closed
      else c.waiting += 1;
      if (s.outcome === 'Passed' || s.outcome === 'Failed') v.proved_on_time += 1;  // a final verdict, always before its deadline
      else if (s.outcome === 'TimedOut') v.not_proved_in_time += 1;
      else if (s.outcome === 'Open' && s.revealed_at_ns && s.deadline_ns && BigInt(s.deadline_ns) / 1000000n < BigInt(nowMs) && b.state === 'Open') v.waiting_past_deadline += 1;
      if ((s.outcome === 'Passed' || s.outcome === 'Failed') && s.verdict_posted_at_ns && s.revealed_at_ns)
        times.push({ by: 'proof', machine: provers[`${b.id}:${i}`] || 'not recorded', seconds: Number(BigInt(s.verdict_posted_at_ns) - BigInt(s.revealed_at_ns)) / 1e9 });
      else if (s.outcome === 'TimedOut' && s.deadline_ns && s.revealed_at_ns)
        times.push({ by: 'timeout', machine: 'none (no proof)', seconds: Number(BigInt(s.deadline_ns) - BigInt(s.revealed_at_ns)) / 1e9 });
      const how = howOf(s);
      if (!how) return;
      const paid = how === 'proof' ? amount : (b.winner === i ? amount - share * (n - 1n) : share);
      if (!failed) { e(s.payout).gross_rewards_yocto += paid; paidRaw.add(s.payout); }
      fixes.push({ bounty_id: String(b.id), attempt: i, payout_account: shown(s.payout), kind: kind(s.payout), how,
        status: failed ? 'paid on paper, transfer failed (audit finding 8)' : how === 'proof' ? 'paid by proof' : 'paid by timeout',
        image_id: b.image_id, means: how === 'proof' ? PASS_MEANS : TIMEOUT_MEANS,
        transfer_failed: failed, paid_yocto: failed ? '0' : paid.toString(), on_paper_yocto: paid.toString(),
        fee_refunded_yocto: failed ? '0' : fee.toString(), tx: payoutTx(recorded, b.id, how), note: (note && note.text) || null });
    });
    vendors.set(b.vendor, v);
  }
  const acc = new Map();
  for (const f of fixes.filter((x) => !x.transfer_failed)) {
    const a = acc.get(f.payout_account) || { account: f.payout_account, kind: f.kind, fixes_paid: 0, paid_by_proof: 0, paid_by_timeout: 0, total_paid_yocto: '0' };
    a.fixes_paid += 1;
    if (f.how === 'proof') a.paid_by_proof += 1; else a.paid_by_timeout += 1;
    a.total_paid_yocto = (BigInt(a.total_paid_yocto) + BigInt(f.paid_yocto)).toString();
    acc.set(f.payout_account, a);
  }
  const earnings = [...earn.values()].map((x) => ({ ...x, fees_spent_yocto: x.fees_spent_yocto.toString(), fees_returned_yocto: x.fees_returned_yocto.toString(),
    gross_rewards_yocto: x.gross_rewards_yocto.toString() }));
  const vend = [...vendors.values()];
  const counterparties = new Set([...paidRaw, ...vendors.keys()]);
  const everyone = new Set([...earn.keys(), ...bounties.map((b) => b.vendor)]);
  const decided = times.length, byProof = times.filter((t) => t.by === 'proof').length;
  const groups = {};
  for (const t of times) (groups[`${t.by}, ${t.machine}`] = groups[`${t.by}, ${t.machine}`] || []).push(t.seconds);
  const metrics = {
    decided_attempts: decided, settled_by_proof: byProof, settled_by_timeout: decided - byProof,
    share_settled_by_proof: decided ? byProof / decided : null, timeout_rate: decided ? (decided - byProof) / decided : null,
    reveal_to_settlement_seconds: Object.fromEntries(Object.entries(groups).map(([k, xs]) => [k, { attempts: xs.length, median: median(xs), slowest: Math.max(...xs) }])),
    timing_note: 'by proof: from the reveal to the proof accepted on chain; by timeout: from the reveal to the verdict deadline (the claim came later).',
    distinct_outside_accounts: [...everyone].filter((a) => kind(a) === 'not known').length,
    outside_note: 'accounts not on the team list (web/data/accounts.json) among vendors, committers and payout accounts',
  };
  return {
    paid_fixes: fixes,
    paid_accounts: [...acc.values()],
    earnings,
    vendors: vend,
    metrics,
    counts: { paid_fixes: fixes.filter((f) => !f.transfer_failed).length, paid_by_proof: fixes.filter((f) => f.how === 'proof' && !f.transfer_failed).length,
      paid_by_timeout: fixes.filter((f) => f.how === 'timeout' && !f.transfer_failed).length, paid_on_paper_transfer_failed: fixes.filter((f) => f.transfer_failed).length,
      paid_accounts: acc.size, vendors: vend.length, distinct_counterparties: counterparties.size,
      outside_the_team: [...counterparties].filter((a) => kind(a) === 'not known').length },
  };
}
