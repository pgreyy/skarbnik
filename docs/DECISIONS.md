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
| D13 | The testnet contract's full access key | Decided 2026-10-27: kept on `kintsugi-l2-cihdp.testnet` on purpose; the mainnet contract (`skarbnik.near`) is planned without an upgrade key the owner controls alone (key removed, or upgrades behind a multisig or DAO with a delay) | The testnet contract is an experimental contract the owner keeps changing; the live code hash and every deploy are published so a silent change can be seen (EVIDENCE, "Contract code and every deploy") |
| D14 | Level 1 (OutLayer) | Decided 2026-11-03: built as a level chosen at creation; OutLayer runs the owner pinned verifier program, downloaded from a commit pinned raw.githubusercontent.com address in this repository; the older "OutLayer as one of two verifiers" path is removed; the site offers Level 1 only after one full Level 1 bounty settled on testnet; Level 2 stays the default | Owner's decision; OutLayer answered every job naming a GitHub file (EVIDENCE, "Level 1 through OutLayer"), and a vendor without the Groth16 step's Docker machine still gets a verdict |
| D15 | Which levels an agent may take | Decided 2026-11-03: Levels 2 and 1; Level 0 only when the user explicitly asks. The agent states the bounty's level and its meaning in the same message as the fee and waits for a yes | Owner's decision; the user should know who decides the verdict before paying a fee |
