# Testnet cleanup, 2026-10-30

Every bounty on `kintsugi-l2-cihdp.testnet` that was past its expiry and still open was closed by the contract's own
public methods, which anyone may call. Signed by the vendor account `kintsugi-vendor-prnvm.testnet`; a refund always
goes to the bounty's vendor whoever calls. Bounties not yet expired were not touched: 7, the retired judge bounties 18
to 22 (expire 2026-12-05) and the judge bounties 28 to 31 (expire 2026-12-06).

| Bounty | Before | Call | Transaction | Where the money went | After |
| --- | --- | --- | --- | --- | --- |
| 3 | open, one revealed attempt waiting past its verdict window | `claim_timeout` index 0 | `GxEgq98bCbKGQ8rkAKpXJdAzLn6v6nBci9ThrbLcEgNU` | 0.1 NEAR reward plus the attempt's own 0.01 NEAR fee to `kintsugi-res1-prnvm.testnet` (paid by timeout, not a proof) | Paid |
| 26 | open, two revealed attempts waiting | `claim_timeout` index 0 | `AE6vgA7wr8v3TNJnYpma42K6q3GBsjxzD9nEYBHWru9P` | split equally: 0.05 NEAR plus its 0.01 fee to `skarbnik-agentsmd-960210.testnet`, 0.05 NEAR plus its 0.015 fee to `skarbnik-mcp-2fe414.testnet` (paid by timeout) | Paid |
| 0 | open, no attempts | `expire` | `4SX2Q4bCzArxUD5QzXwkPrA7wEcH7hTH2xAHvDdUv9qr` | 0.1 NEAR refunded to the vendor `kintsugi-vendor-prnvm.testnet` | Refunded |
| 2 | open (never opened), no attempts | `expire` | `8hEp6UuSiZ2aJWGFdrDMVvz6azbGwXJ7HpoCzN28MYDr` | 0.1 NEAR refunded to the vendor | Refunded |
| 10 | open, one commit never revealed | `expire` | `8HQgkXWZWHKYjaL6ESvCrqtZXns95g2vMtahjPwzkLjR` | the unrevealed commit's 0.01 NEAR fee to the protocol fee pool; 0.1 NEAR refunded to the vendor | Refunded |
| 23 | open, three probe commits never revealed | `expire` | `FmktAoGZYua2dXz5xTd15gDnzuRssiscLKttBz7mhWGZ` | the three fees (0.045 NEAR) to the protocol fee pool; 0.1 NEAR refunded to the vendor | Refunded |
| 25 | open, two commits never revealed | `expire` | `29poZLcpyMqTKEpDgAmudMeVCTjZ9wk99RBEWKKurrz2` | the two fees (0.025 NEAR) to the protocol fee pool; 0.1 NEAR refunded to the vendor | Refunded |

`expire` was not called on 3 and 26 after their claims: the claim returns every sharer's fee, which leaves no fee to
sweep, and `expire` refuses a closed bounty with nothing left to do ("nothing to do: bounty already closed and fees
already swept").

Read after the calls (view calls): bounties 0, 2, 10, 23 and 25 Refunded; 3 and 26 Paid; fees_collected 0 on all
seven; the protocol fee pool 0.17 NEAR. Files: `transactions.tsv` and `steps/` (each call's NEAR CLI output, with
signatures and long keys filtered out as in the other evidence folders). Each transaction's events (`paid`,
`refunded`, `fee_to_pool`) are on the explorer.
