# Launchpad business demos

Three demos built on [Meteora Fun Launch](https://docs.meteora.ag/invent/scaffold/fun-launch) for the London Hacker House workshop. Check out one branch and follow its setup instructions. Open **Workshop** from the app header.

| Demo | What to show |
| --- | --- |
| [Conviction Index](https://github.com/meteora-fyi/launchpad-business-demos/tree/demo/index-fund-ui) | Launch a custom basket, issue and redeem shares, and distribute transfer fees to holders |
| [Buyback and Burn](https://github.com/meteora-fyi/launchpad-business-demos/tree/demo/buyback-burn-ui) | Use collected transfer fees to buy tokens in a fixed-price OTC trade and burn them |
| [Studio Work](https://github.com/meteora-fyi/launchpad-business-demos/tree/demo/studio-work-ui) | Split a freelance payment between the contractor and platform |

## Ten-minute stage run

1. **0–2 min.** Open Conviction Index and launch a basket with 50/30/20 weights. Explain how the asset mix expresses a thesis.
2. **2–4 min.** Subscribe as Alice for 100 shares and Bob for 50. Show the reserves, mock NAV, and 0.15 SOL of gross subscription revenue.
3. **4–7 min.** Transfer 10 shares from Alice to Bob. Show the pending fees, then wait for the scheduled rebate or run it on demand. Redeem five whole shares to show how the basket backs the share supply.
4. **7–10 min.** Compare the two Meteora curve presets with `npm run curve` and `npm run curve -- high-volume`. Discuss how the graduation threshold, trading fees, creator/platform split, and locked liquidity change.

The workshop UI sends transactions to Solana localnet. The index uses mock assets and fixed prices. The curve command computes DBC parameters offline. Run `npm ci` before using it.

[Workshop brief](https://lead-satellite-892.notion.site/Launchpads-Are-a-Business-Tune-Your-Pricing-Margins-and-Incentives-on-Meteora-40a12946d1328034a2a8fb561fb7bad5?pvs=74)

## Conviction Index in Fun Launch

This branch is a Poise-inspired index business demo. See [Fun Launch setup](fun-launch/README.md#workshop-fork)
and use **Workshop** in the app header. The original scaffold's DBC pool creation and trading pages
are separate from the workshop's reserve-backed localnet fund.

1. Launch a basket with 50/30/20 weights. The assets have fixed mock $1 prices and separate SPL mints and reserves.
2. Subscribe as Alice for 100 shares and as Bob for 50. The fund issues Token-2022 shares against deposits in
   one transaction per subscription. The platform collects 0.15 SOL of gross subscription revenue.
3. Transfer 10 shares from Alice to Bob. The mint withholds 0.2 shares. Click **Run rebate now**, or wait for
   the server cron and click **Refresh confirmed state**. The same transfer fee applies to payouts.
4. Redeem five whole shares. The fund burns shares and returns the weighted basket in one transaction.
   NAV stays at $1 because mock prices are fixed and the reserves stay fully backed.

Only two disposable holders can take part. The server holds demo signing keys in memory. Restarting the
app process creates a new workshop session, with a new mint on the next launch. This prototype uses
fixed mock prices and has no external custody, live pricing, rebalancing, or production fund program.
