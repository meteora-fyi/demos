# Launchpad business demos

Three terminal demos for the London Hacker House session. Each branch has its own walkthrough. Start with Studio Work to show where the money comes from, then contrast two ways a token community can use fees.

| Branch | Run | Show |
| --- | --- | --- |
| [Studio Work](../../tree/demo/studio-work) | `npm run demo -- 0.5 1000` | A customer pays a freelancer and the platform takes a 10% fee |
| [Holder Rebates](../../tree/demo/holder-rebates) | `npm run demo` | A scheduled job splits collected Token-2022 fees by balance |
| [Buyback and Burn](../../tree/demo/buyback-burn) | `npm run demo` | Collected transfer fees fund a fixed-price buyback and burn |

## Ten-minute stage run

1. **0–2 min.** A freelance marketplace sells a specific deliverable, such as a short product video. Start with a 0.5 SOL job and a 10% platform fee. Ask the room who pays, what they get, and why the platform earns its cut.
2. **2–4 min.** Run Studio Work and show the two payments in one transaction. Raise the platform fee to 15% and show what that does to the contractor's payout. Platform revenue is gross, before operating costs.
3. **4–7 min.** Run `npm run curve` and `npm run curve -- high-volume`. Compare the graduation threshold, fee decay over time, creator/platform fee split, and locked LP. The SDK calculates the SOL reserve needed for migration. Graduation market cap and reserve are separate numbers.
4. **7–10 min.** Run either fee demo. Ask which incentive fits the audience and what it costs. Rebates go to existing holders. Buybacks pay sellers and lower the supply when purchased tokens are burned.

## Rehearse locally

Use Node 22.12 or newer, npm, and a Solana CLI with `solana-test-validator`. Start `solana-test-validator` in another terminal. In a demo branch, run `npm ci` once and use its command above. The scripts generate disposable wallets and transact only at `127.0.0.1:8899`. Install dependencies and start the validator before the slot.

The curve command computes Meteora DBC parameters offline. For a live launchpad, create your DBC config in [Meteora Launch](https://launch.meteora.ag), set the resulting `POOL_CONFIG_KEY` in [Fun Launch](https://docs.meteora.ag/invent/scaffold/fun-launch), and use its wallet launch/trading interface. The presets collect DBC trading fees in SOL and target DAMM v2 on graduation. The two Token-2022 demos run separately on localnet and collect transfer fees denominated in the transferred token. The presets do not enable a Token-2022 transfer fee extension.

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
