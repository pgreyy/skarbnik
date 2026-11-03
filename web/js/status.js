// One status per bounty, with the same rules as the agent feed (scripts/gen_feed.py, status_of), so the site and
// feed.json never disagree; the kind of a bounty (private, demo or test, and whether it is a judge bounty or a new
// module); whether it accepts a commit now; and the chip each status is shown with. Mint is used only for Proof
// verified, the one status where the contract checked the proof itself (Level 2); a Level 1 payment is Verified by
// OutLayer (the contract trusted OutLayer's answer), a Level 0 payment Verifiers attested; Timeout settlement and
// Refunded are neutral; Failed, Proof rejected (Level 2: a FAIL proof the contract checked) and Failed by OutLayer
// (Level 1: OutLayer answered FAIL) are coral, always with a word.
import { commitBy, nsToDate } from './chain.js';

export const STATUS = {
  'Proof verified': { cls: 'k-proof', icon: 'check', help: 'The contract checked a proof for the paid attempt (Level 2).' },
  'Verified by OutLayer': { cls: 'k-await', icon: 'seal', help: 'OutLayer ran the pinned verifier program on the proof and the contract paid on its answer. The contract did not check the proof itself (Level 1).' },
  'Verifiers attested': { cls: 'k-await', icon: 'seal', help: 'Two registered verifiers attested the verdict and the contract paid on their word (Level 0).' },
  'Proof rejected': { cls: 'k-reject', icon: 'x', help: 'No attempt slot or commit time is left and nobody was paid; a valid proof said FAIL for an attempt (Level 2).' },
  'Failed by OutLayer': { cls: 'k-reject', icon: 'x', help: 'OutLayer ran the pinned verifier program on the proof of an attempt and answered FAIL, no attempt slot or commit time is left and nobody was paid. The contract did not check the proof itself (Level 1).' },
  'Awaiting evaluation': { cls: 'k-await', icon: 'hourglass', help: 'A patch was revealed and no verdict has arrived yet.' },
  'Timeout settlement': { cls: 'k-timeout', icon: 'hourglass', help: 'No proof arrived in the window. The contract paid by rule. This is not a proof.' },
  'Refunded': { cls: 'k-refund', icon: 'undo', help: 'Nothing was paid out. The vendor got the reward back.' },
  'Failed': { cls: 'k-fail', icon: 'x', help: 'Past its expiry and not settled. Anyone can call expire to refund the vendor.' },
  'Demo or test only': { cls: 'k-test', icon: 'flask', help: 'A demo or test bounty, not settled yet. It uses a public input or a test setup.' },
  'Open for attempts': { cls: 'k-open', icon: 'clock', help: 'Opened by its Proof 0 and accepting commits now. Earlier attempts may have failed; the attempts used are shown with it.' },
  'Waiting for Proof 0': { cls: 'k-open', icon: 'clock', help: 'Created, not opened yet. It opens when its Proof 0 is accepted.' },
};

// What kind of bounty: 'test' (made for trying the site), 'demo' (the public demo input), or 'private'.
export function kindOf(b, rec) {
  if (rec && rec.test_bounties && rec.test_bounties[String(b.id)]) return 'test';
  if (rec && rec.notes && rec.notes.demo_exploit_commitment && b.exploit_commitment === rec.notes.demo_exploit_commitment.commitment) return 'demo';
  return 'private';
}
export const isJudge = (b, rec) => !!(rec && rec.judge_bounties && rec.judge_bounties[String(b.id)]);
export const isNewModule = (b, rec) => !!(rec && rec.new_module_bounties && rec.new_module_bounties[String(b.id)]);
export const isRetiredJudge = (b, rec) => !!(rec && (rec.retired_judge_bounties || []).includes(String(b.id)));

// Accepts a commit right now: open, opened, before the last commit time, and a free slot.
export const accepting = (b, now = Date.now()) => b.state === 'Open' && b.opened && nsToDate(commitBy(b)).getTime() > now && b.max_commits - b.active > 0;

export function statusOf(b, subs, kind, now = Date.now()) {
  if (b.state === 'Paid') {
    const w = b.winner !== null && b.winner !== undefined ? subs[b.winner] : null;
    if (w && w.outcome === 'TimedOut') return 'Timeout settlement';
    return b.level === 1 ? 'Verified by OutLayer' : b.level === 0 ? 'Verifiers attested' : 'Proof verified';
  }
  if (b.state === 'Refunded') return 'Refunded';
  if (kind === 'demo' || kind === 'test') return 'Demo or test only';
  if (subs.some((s) => s && s.outcome === 'Open' && s.revealed_at_ns)) return 'Awaiting evaluation';
  if (BigInt(now) * 1000000n >= BigInt(b.expires_at_ns)) return 'Failed';
  if (!b.opened) return 'Waiting for Proof 0';
  // a free slot and time left: open, even after failed attempts (the attempts used are shown with it)
  if (accepting(b, now)) return 'Open for attempts';
  if (subs.some((s) => s && s.outcome === 'Failed')) return b.level === 1 ? 'Failed by OutLayer' : 'Proof rejected';
  return 'Awaiting evaluation';
}

// The kind chips of a bounty: what its input is, and whether it is a judge or new module bounty.
export function kindChips(b, rec) {
  const k = kindOf(b, rec), out = [];
  if (k === 'test') out.push(['Test', 'k-test']);
  if (k === 'demo') out.push(['Demo', 'k-test'], ['Public input', 'k-test']);
  if (k === 'test' && b.exploit_commitment === (rec.notes.demo_exploit_commitment || {}).commitment) out.push(['Public demo input', 'k-test']);
  if (k === 'private') out.push(['Private secret', 'k-priv']);
  if (isJudge(b, rec)) out.push(['Judge bounty', 'k-test']);
  if (isRetiredJudge(b, rec)) out.push(['Retired', 'k-refund']);
  if (isNewModule(b, rec)) out.push(['New module', 'k-test']);
  return out;
}
