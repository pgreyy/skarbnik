// The Proof Ledger's rules, with no network or page code, so the site (web/js/app.js) and the generator of ledger.json
// (scripts/gen_ledger.mjs) compute the same thing from the same chain data. Input: every bounty (get_bounty) and every
// attempt of it (get_submission), the transaction ids the repository records (web/data/recorded.json) and who runs each
// account (web/data/accounts.json). Output: each paid fix with how it was paid, one row per paid account, each vendor's
// on-time record, and the number of distinct counterparties. No scores, no ranks, nothing for unpaid attempts.

// How the winning payout of a bounty was made: 'proof' (a verdict that became final: a Groth16 PASS, or two verifier
// attestations at Level 0) or 'timeout' (the deadline passed with no final verdict; claim_timeout paid).
const howOf = (s) => (s.outcome === 'Passed' ? 'proof' : s.outcome === 'TimedOut' ? 'timeout' : null);

// The recorded transaction that made a bounty's payout: the one successful claim_timeout for a timeout; for a proof, the
// last successful submit_groth16 (a PASS closes the bounty, so no later proof can succeed) or Level 0 attestation.
function payoutTx(recorded, bid, how) {
  const rows = ((recorded && recorded.bounties && recorded.bounties[String(bid)]) || []).filter((r) => r.result === 'succeeded');
  const pick = how === 'timeout' ? rows.filter((r) => r.method === 'claim_timeout') : rows.filter((r) => r.method === 'submit_groth16' || r.method === 'attest');
  return pick.length ? pick[pick.length - 1].tx : null;
}

export function buildLedger(bounties, subsByBounty, recorded, accounts, nowMs = Date.now()) {
  const kind = (a) => (accounts && accounts.accounts && accounts.accounts[a]) || 'not known';
  const fixes = [];
  const vendors = new Map();
  for (const b of bounties) {
    const subs = subsByBounty[String(b.id)] || [];
    const v = vendors.get(b.vendor) || { vendor: b.vendor, kind: kind(b.vendor), bounties: 0, proved_on_time: 0, not_proved_in_time: 0, waiting_past_deadline: 0 };
    v.bounties += 1;
    // The amount each paid attempt received: the whole bounty for a proof; for a timeout an equal share of the bounty
    // among all attempts paid by that timeout, the remainder of the division to the claimed (winning) attempt.
    const timed = subs.map((s, i) => [s, i]).filter(([s]) => s.outcome === 'TimedOut');
    const n = BigInt(timed.length || 1), amount = BigInt(b.amount), share = amount / n;
    subs.forEach((s, i) => {
      if (s.outcome === 'Passed' || s.outcome === 'Failed') v.proved_on_time += 1;  // a final verdict, always before its deadline
      else if (s.outcome === 'TimedOut') v.not_proved_in_time += 1;
      else if (s.outcome === 'Open' && s.revealed_at_ns && s.deadline_ns && BigInt(s.deadline_ns) / 1000000n < BigInt(nowMs) && b.state === 'Open') v.waiting_past_deadline += 1;
      const how = howOf(s);
      if (!how) return;
      const paid = how === 'proof' ? amount : (b.winner === i ? amount - share * (n - 1n) : share);
      const note = recorded && recorded.bounty_notes && recorded.bounty_notes[String(b.id)];
      // A payout the contract marked as paid but whose transfer failed (bounty 8: the account does not exist) moved no
      // NEAR: it is listed, labelled, and counted nowhere as paid.
      const failed = !!(note && note.transfer_failed);
      fixes.push({ bounty_id: String(b.id), attempt: i, payout_account: s.payout, kind: kind(s.payout), how,
        status: failed ? 'paid on paper, transfer failed (audit finding 8)' : how === 'proof' ? 'paid by proof' : 'paid by timeout',
        transfer_failed: failed, paid_yocto: failed ? '0' : paid.toString(), on_paper_yocto: paid.toString(),
        fee_refunded_yocto: failed ? '0' : s.fee, tx: payoutTx(recorded, b.id, how), note: (note && note.text) || null });
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
  const vend = [...vendors.values()].filter((v) => v.proved_on_time + v.not_proved_in_time + v.waiting_past_deadline > 0 || v.bounties > 0);
  const counterparties = new Set([...acc.keys(), ...vend.map((v) => v.vendor)]);
  return {
    paid_fixes: fixes,
    paid_accounts: [...acc.values()],
    vendors: vend,
    counts: { paid_fixes: fixes.filter((f) => !f.transfer_failed).length, paid_by_proof: fixes.filter((f) => f.how === 'proof' && !f.transfer_failed).length,
      paid_by_timeout: fixes.filter((f) => f.how === 'timeout' && !f.transfer_failed).length, paid_on_paper_transfer_failed: fixes.filter((f) => f.transfer_failed).length,
      paid_accounts: acc.size, vendors: vend.length, distinct_counterparties: counterparties.size,
      outside_the_team: [...counterparties].filter((a) => kind(a) === 'not known').length },
  };
}
