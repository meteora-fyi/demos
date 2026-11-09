# Index Launch

A DBC-native index launchpad built from Meteora’s Fun Launch scaffold. Create an index token, choose its basket and commercial terms, trade its bonding curve, and use collected creator fees to build the basket, reward holders, or buy back and burn the index token.

The hosted workshop runs on **Solana devnet** at **https://meteora.fyi/demo**. Use a wallet set to devnet and test SOL from https://faucet.solana.com. Mainnet execution is rejected by the server’s genesis check.

## What you can configure

Every launch creates a separate DBC configuration and pool. Before signing, set:

- Basket constituents and weights, index name, symbol and description.
- Supply, opening valuation and graduation valuation. The SDK derives the curve and actual graduation reserve threshold; valuation is not the amount raised.
- Fixed, linear or exponential opening fees, schedule duration and optional dynamic fees.
- Creator/platform division of the non-protocol trading fee.
- Post-graduation DAMM fee, one-time migration charge and creator/platform liquidity allocations, including permanent locks.
- Allocation of collected creator fees to basket purchases, holder rebates, buybacks and retained earnings.
- Optional seed contribution, purchase and rebate minimums, rebate interval, rebalance drift threshold and trade slippage limit.

DBC terms are fixed when the config is created. Duplicate an index into a new draft to compare another business model.

## Workshop flow

1. Connect a devnet wallet and select **Create index**. Add two or three constituents and make their weights total 100%.
2. Configure the market and revenue policy. Review the fee-flow visualization and sign each launch step. Config, token, market and test basket accounts are created separately; resume an interrupted operation from the pending transaction panel.
3. Buy or sell the index token. The quote comes from the live Meteora pool. Market price, pool reserve and basket value are separate measures.
4. Collect fees. Creator and platform fees go to separate token accounts. The creator allocation becomes the available basket, rebate, buyback and retained budgets only after confirmation.
5. Invest the basket budget. Use scenario prices to demonstrate drift, then rebalance. The basket visualization reflects confirmed constituent holdings.
6. Switch to a second wallet in the same browser session and trade to demonstrate a holder rebate. The operating creator is excluded. After an eligible interval, reconnect the creator and sign the payout.
7. With a nonzero buyback allocation, collect fees, buy back index tokens, then sign the separate burn transaction. Purchasing tokens and burning them are separate recorded actions.
8. When the reserve reaches the graduation threshold, sign migration to DAMM v2. Subsequent swaps use that pool’s fee and liquidity settings.

## What is real, and what is a workshop fixture

**Real devnet transactions:** DBC config and token creation, DBC/DAMM swaps, fee claims, dedicated token accounts, constituent transfers, holder payments, migration, buyback and SPL token burn. Receipts include transaction signatures. The server checks the exact prepared transaction message before relaying a signed transaction and applies financial effects only after confirmed reconciliation.

**Test basket:** BTC, ETH and SOL labels represent newly created devnet fixture tokens, not real BTC, ETH or wrapped SOL investments. Prices are controlled scenario inputs, not oracle feeds. Basket trades transfer those tokens against wrapped devnet SOL through accounts controlled by the creator. This demonstrates the business flow without claiming real asset backing or external market execution. A price increase can leave the fixture settlement account unable to fund a sale; the transaction then fails instead of inventing cash.

**Custody:** The connected wallet controls the index and its treasury accounts. DBC enforces its own config. The app records the offchain revenue policy and budgets; it is not a permissionless treasury program enforcing that policy against the wallet owner. The creator also serves as the platform fee authority in this workshop deployment so participants can inspect both sides of the economics.

**Rebates:** Only wallets observed trading in this browser session are registered. The app uses observed balance checkpoints and elapsed holding time, excludes the creator and delays new entrants until a subsequent interval. It is not a complete transfer indexer. Payments require the creator’s signature and are made in wrapped devnet SOL.

**Operations:** Due intervals are shown in the UI. The hosted server does not hold a spending key or autonomously sign cron transactions. Every financial operation requires a wallet signature.

**Session scope:** Each browser has an isolated persisted workspace, with up to five indexes and 500 operations. Onchain pools remain public, but this scaffold’s dashboard is not a global pool directory. Clearing the session cookie loses access to its offchain workspace; it does not destroy the wallet’s onchain assets. Use the same browser session for the workshop.

## Run locally

Requires Node 22.12+ and pnpm 10.18.2.

```sh
npm ci
corepack enable
pnpm --dir fun-launch install --frozen-lockfile
npm run dev
```

Open http://localhost:3000. A paced public devnet RPC is the fallback. For workshop concurrency, configure an authenticated **devnet** RPC with `SOLANA_RPC_URL`. Never point this app at mainnet.

Server environment variables:

| Variable | Purpose |
| --- | --- |
| `SOLANA_RPC_URL` | Optional authenticated devnet endpoint. Kept server-side. |
| `RPC_MIN_INTERVAL_MS` | Optional minimum interval between RPC requests with a custom endpoint. |
| `DEMO_DATA_DIR` | Persistent workspace and operation-journal directory. Railway uses `/data`. |
| `SESSION_SECRET` | Stable random signing secret for hosted session cookies. |
| `APP_ORIGIN` | Exact public origin accepted for mutations, e.g. `https://meteora.fyi`. |
| `APP_EXTRA_ORIGINS` | Optional comma-separated additional public origins, e.g. `https://www.meteora.fyi`. |
| `NEXT_PUBLIC_BASE_PATH` | Build-time mount path; Docker uses `/demo`, local development defaults to the root. |
| `PORT` | HTTP port; defaults to 3000 in the container. |

Put local values in `fun-launch/.env.local`, which is ignored by Git. Do not expose an RPC key through `NEXT_PUBLIC_*` variables.

## Checks and deployment

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run check:devnet
```

The devnet check verifies the deployed programs and prepares a config transaction using a fresh local test wallet. `node scripts/check-devnet.mjs --execute` requires funding that fresh wallet and sends actual devnet setup transactions. It never uses the connected browser wallet.

The root Dockerfile builds the app for Railway. Attach one persistent volume at `/data`, use one replica, configure the server environment above, and use `/demo/api/health` as the healthcheck. Its response reports `RAILWAY_GIT_COMMIT_SHA` so the deployed revision can be verified without a browser. `/demo/api/index-launch` reports chain readiness separately.

## Code map

- `fun-launch/src/pages` — dashboard, creation flow, index details and HTTP endpoints.
- `fun-launch/src/components/index-launch` — basket, allocation, fee-flow and history visuals.
- `lib/model.mjs` — configuration validation and integer financial arithmetic.
- `lib/engine.mjs` — operation journal, confirmed accounting and rebate eligibility.
- `lib/chain.mjs` — Meteora SDK integration and exact-message signed transaction relay.
- `lib/store.mjs` — persisted session state and serialization.
- `lib/http.mjs` — signed cookies, CSRF/origin checks and request limits.

Derived from the Fun Launch scaffold in `MeteoraAg/meteora-invent`. The upstream license is retained in `fun-launch/LICENSE.md`.
