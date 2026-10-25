# Decisions

Each decision with the date it was made and the reason. Open decisions say "open" and the current default.

| # | Decision | Status and date | Reason |
| --- | --- | --- | --- |
| D1 | Does the first payout close the bounty? | Open. Default: yes | Bounds the vendor's loss and is easy to explain |
| D2 | What if verifiers are down after a verdict is posted? | Open. Default: counts as silence, so the researcher is paid | Anything unproven counts as no verdict |
| D3 | Public name | "Skarbnik" (owner's decision, 2026-10-25). The testnet contract and other on-chain accounts keep their original names | Polish and Ukrainian for treasurer; in folklore, the mine spirit who rewards honest miners |
| D4 | How many fresh inputs in the fairness check | Open. Set by spike S2 | Needs measured proving time |
| D5 | Attempt fee shape | Decided 2026-10-24: per bounty `attempt_fee + n * fee_step` for the n-th counted commit, paid from prepaid credit; fees go to the registered verifiers when `expire` runs after the bounty's expiry | Owner's decision; credit lets an AI agent's function call key pay fees without access to the wallet |
| D6 | Who runs the three verifiers | Open. Default: one OutLayer job, one server run by us, one machine run by an independent party; a PASS needs two different registered verifier keys; the vendor is never a verifier | OutLayer runs its own workers behind one operator, so three OutLayer jobs are not independent |
| D7 | Payout asset | Open. Default: NEAR | Simplest for a testnet demo |
| D8 | Attempt sealed mode (vendor never sees the patch) | Open. Default: only if everything else is done | Stretch goal |
| D9 | Which GitHub account and repository | Decided 2026-10-23: a new private repository on the owner's main account | Clean start |
| D10 | Where receipt files live | Open. Default: in the repository or a release, named by hash | The hash is what the contract stores |
| D11 | Machine for the Groth16 wrap (spike S6) | Decided 2026-10-23: try Docker on the development machine first (Docker 29.1.3 works); rent an x86 machine only if S6 runs out of memory | Docker now runs here; memory fit is still unmeasured |
| D12 | When building starts | Decided 2026-10-23: building starts now, not on 1 Nov. Every commit keeps its real date | Owner's decision; the hackathon rules page says nothing against it |
