import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { Shell } from '@/components/index-launch/Shell';
import {
  AllocationBar,
  AssetCoin,
  Basket,
  FeeFlow,
  HistoryChart,
  Icon,
} from '@/components/index-launch/visuals';
import { useIndex } from '@/lib/index-launch/context';
import {
  explorer,
  LOCAL_ASSETS,
  number,
  price,
  shorten,
  type IndexView,
  type Quote,
} from '@/lib/index-launch/types';

function Detail() {
  const router = useRouter();
  const { state, loading, busy, run, wallet, connect, refresh } = useIndex();
  const index = state?.indexes.find((i) => i.id === router.query.id);
  const [tab, setTab] = useState('Overview');
  const [chart, setChart] = useState<'price' | 'treasuryValue'>('price');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('0.01');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [scenario, setScenario] = useState(false);
  useEffect(() => setQuote(null), [amount, side, wallet, router.query.id]);
  if (!index)
    return (
      <Shell title="Index">
        <Link className="back-link" href="/">
          <Icon name="back" size={16} />
          Explore
        </Link>
        <div className="loading-state">
          {loading ? (
            <>
              <span className="loading-ring" />
              Loading index…
            </>
          ) : (
            <>
              <h2>This index is not in your workspace.</h2>
              <p>
                Return to Explore to open an index from this browser session.
              </p>
              <Link href="/" className="button">
                Explore indexes
              </Link>
            </>
          )}
        </div>
      </Shell>
    );
  const assets = state?.assets || LOCAL_ASSETS;
  const owner = wallet === index.owner;
  const market = index.market;
  const earnings = index.earnings;
  const marketStatus = /damm|graduated|migrated/i.test(index.status)
    ? 'DAMM v2'
    : /migrat|complete/i.test(index.status)
      ? 'Migration pending'
      : index.status === 'draft'
        ? 'Setup pending'
        : 'DBC';
  const mint =
    index.addresses?.mint ||
    index.addresses?.baseMint ||
    index.addresses?.tokenMint;
  const getQuote = async () => {
    const result = await run('quote', { indexId: index.id, side, amount });
    if (result?.quote) setQuote(result.quote);
  };
  const trade = async () => {
    if (!wallet) {
      connect();
      return;
    }
    const result = await run('trade', { indexId: index.id, side, amount });
    if (result) setQuote(null);
  };
  const operation = (action: string) => run(action, { indexId: index.id });
  const duplicate = () => {
    sessionStorage.setItem(
      'index-launch-draft',
      JSON.stringify({ ...index.config, name: `${index.config.name} II` }),
    );
    void router.push('/create');
  };
  const output = quote?.amountOut ?? quote?.output;
  const minOut =
    quote?.minAmountOut ?? quote?.minimumOut ?? quote?.minimumReceived;
  return (
    <Shell title={index.config.name}>
      <div className="detail-breadcrumb">
        <Link href="/" className="back-link">
          <Icon name="back" size={16} />
          All indexes
        </Link>
        <div>
          <button className="text-button" onClick={duplicate}>
            Duplicate configuration <Icon name="copy" size={14} />
          </button>
          <button
            className="icon-button"
            onClick={() => void refresh()}
            aria-label="Refresh index"
          >
            <Icon name="refresh" size={17} />
          </button>
        </div>
      </div>
      <section className="index-heading">
        <span className="index-symbol large">
          {index.config.symbol.slice(0, 3)}
        </span>
        <div>
          <div className="index-title-row">
            <h1>{index.config.name}</h1>
            <span className="status-pill">{marketStatus}</span>
          </div>
          <div className="index-subtitle">
            <span>{index.config.symbol} / SOL</span>
            {mint && (
              <a href={explorer(mint)} target="_blank" rel="noreferrer">
                {shorten(mint)}
                <Icon name="external" size={12} />
              </a>
            )}
          </div>
        </div>
      </section>
      <nav className="detail-tabs" aria-label="Index sections">
        {[
          'Overview',
          'Treasury',
          'Earnings',
          'Operations',
          'Configuration',
        ].map((t) => (
          <button
            key={t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === 'Overview' && (
        <div className="detail-grid">
          <div>
            <section className="market-panel">
              <div className="chart-heading">
                <div>
                  <span>
                    {chart === 'price'
                      ? 'Token market price'
                      : 'Basket asset value'}
                  </span>
                  <h2>
                    {price(
                      chart === 'price' ? market.price : index.treasury.value,
                    )}
                    <small>SOL</small>
                  </h2>
                </div>
                <div className="segmented small">
                  <button
                    className={chart === 'price' ? 'active' : ''}
                    onClick={() => setChart('price')}
                  >
                    Market price
                  </button>
                  <button
                    className={chart === 'treasuryValue' ? 'active' : ''}
                    onClick={() => setChart('treasuryValue')}
                  >
                    Basket value
                  </button>
                </div>
              </div>
              <HistoryChart
                points={index.history || []}
                label={
                  chart === 'price'
                    ? 'Token market price'
                    : 'Basket asset value'
                }
                valueKey={chart}
              />
              <div className="market-stat-row">
                <div>
                  <span>Trading volume</span>
                  <strong>{number(market.volume)} SOL</strong>
                </div>
                <div>
                  <span>Quote reserve</span>
                  <strong>{number(market.quoteReserve)} SOL</strong>
                </div>
                <div>
                  <span>Tokens outstanding</span>
                  <strong>{number(market.supply, 0)}</strong>
                </div>
              </div>
            </section>
            <section className="overview-basket">
              <div>
                <h2>The thesis</h2>
                <p>{index.config.description}</p>
                <AllocationBar
                  parts={index.config.weights.map((w) => ({
                    label:
                      assets.find((a) => a.id === w.assetId)?.symbol ||
                      w.assetId,
                    value: w.weight,
                    color:
                      assets.find((a) => a.id === w.assetId)?.color || '#888',
                  }))}
                />
                <button
                  className="text-button"
                  onClick={() => setTab('Treasury')}
                >
                  Inspect basket holdings <Icon name="arrow" size={16} />
                </button>
              </div>
              <Basket assets={assets} weights={index.config.weights} compact />
            </section>
          </div>
          <aside>
            <section className="trade-panel">
              <div className="trade-side">
                <button
                  className={side === 'buy' ? 'active' : ''}
                  onClick={() => setSide('buy')}
                >
                  Buy
                </button>
                <button
                  className={side === 'sell' ? 'active sell' : ''}
                  onClick={() => setSide('sell')}
                >
                  Sell
                </button>
              </div>
              <label className="trade-input">
                <span>You pay</span>
                <div>
                  <input
                    aria-label={`${side === 'buy' ? 'SOL' : 'Token'} amount to ${side}`}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <strong>
                    {side === 'buy' ? 'SOL' : index.config.symbol}
                  </strong>
                </div>
              </label>
              <div className="quick-amounts">
                {(side === 'buy'
                  ? ['0.01', '0.05', '0.1', '0.5']
                  : ['100', '1000', '10000', '100000']
                ).map((value) => (
                  <button key={value} onClick={() => setAmount(value)}>
                    {value}
                  </button>
                ))}
              </div>
              <div className="trade-output">
                <span>Expected receive</span>
                <strong>
                  {output === undefined ? 'Get a quote' : price(Number(output))}
                  <small>
                    {output === undefined
                      ? ''
                      : side === 'buy'
                        ? index.config.symbol
                        : 'SOL'}
                  </small>
                </strong>
              </div>
              {quote && (
                <div className="quote-details">
                  {minOut !== undefined && (
                    <div>
                      <span>Minimum received</span>
                      <strong>{price(Number(minOut))}</strong>
                    </div>
                  )}
                  {quote.fee !== undefined && (
                    <div>
                      <span>Trading fee</span>
                      <strong>{price(Number(quote.fee))} SOL</strong>
                    </div>
                  )}
                  {quote.priceImpact !== undefined && (
                    <div>
                      <span>Price impact</span>
                      <strong>{number(Number(quote.priceImpact), 2)}%</strong>
                    </div>
                  )}
                </div>
              )}
              <button
                className="button full"
                disabled={!!busy || !amount || Number(amount) <= 0}
                onClick={() => void getQuote()}
              >
                Refresh quote <Icon name="refresh" size={15} />
              </button>
              <button
                className={`button full primary ${side === 'sell' ? 'sell-button' : ''}`}
                disabled={
                  !!busy || !state?.readiness.ready || Number(amount) <= 0
                }
                onClick={() => void trade()}
              >
                {busy ? (
                  <span className="loading-ring" />
                ) : (
                  <Icon name="wallet" size={16} />
                )}{' '}
                {wallet
                  ? `${side === 'buy' ? 'Buy' : 'Sell'} ${index.config.symbol}`
                  : 'Connect wallet'}
              </button>
              <p className="trade-network">
                Solana devnet · Wallet-signed transaction
              </p>
            </section>
            <section className="launch-progress">
              <div>
                <h3>Launch progress</h3>
                <strong>{number(market.progress, 1)}%</strong>
              </div>
              <div className="progress-track">
                <span
                  style={{
                    width: `${Math.min(100, Math.max(0, market.progress || 0))}%`,
                  }}
                />
              </div>
              <p>
                {number(market.quoteReserve)} / {number(market.threshold)} SOL
                in the curve
              </p>
              <div className="lifecycle">
                <span className={marketStatus === 'DBC' ? 'current' : ''}>
                  DBC
                </span>
                <i />
                <span
                  className={
                    marketStatus === 'Migration pending' ? 'current' : ''
                  }
                >
                  Migration
                </span>
                <i />
                <span className={marketStatus === 'DAMM v2' ? 'current' : ''}>
                  DAMM v2
                </span>
              </div>
            </section>
          </aside>
        </div>
      )}
      {tab === 'Treasury' && (
        <>
          <div className="treasury-layout">
            <section className="treasury-main">
              <div className="section-heading">
                <div>
                  <h2>Inside the basket</h2>
                  <p>Devnet test tokens · Fixture prices</p>
                </div>
                <button
                  className="button"
                  disabled={!!busy || !owner}
                  onClick={() => void operation('invest')}
                >
                  Invest available fees <Icon name="arrow" size={16} />
                </button>
              </div>
              <div className="treasury-total">
                <strong>
                  {price(index.treasury.value)} <span>SOL</span>
                </strong>
                <span>Test holdings at fixture prices</span>
              </div>
              <div className="holdings-table-wrap">
                <table className="holdings-table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Quantity</th>
                      <th>Value / SOL</th>
                      <th>Actual</th>
                      <th>Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {index.config.weights.map((w) => {
                      const asset = assets.find((a) => a.id === w.assetId)!;
                      const holding = index.treasury.holdings.find(
                        (h) => h.assetId === w.assetId,
                      );
                      return (
                        <tr key={w.assetId}>
                          <td>
                            <span className="table-asset">
                              <AssetCoin asset={asset} small />
                              <strong>{asset.symbol}</strong>
                            </span>
                          </td>
                          <td>{number(holding?.quantity ?? 0)}</td>
                          <td>{number(holding?.value ?? 0)}</td>
                          <td>{number(holding?.weight ?? 0, 1)}%</td>
                          <td>{w.weight}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="treasury-bottom">
                <div>
                  <span>Waiting to be invested</span>
                  <strong>{price(earnings.basketBudget)} SOL</strong>
                </div>
                <div>
                  <span>Minimum purchase</span>
                  <strong>{price(index.config.minPurchase)} SOL</strong>
                </div>
                <button
                  className="text-button"
                  disabled={!!busy || !owner}
                  onClick={() => void operation('rebalance')}
                >
                  Rebalance basket <Icon name="refresh" size={15} />
                </button>
              </div>
            </section>
            <aside className="treasury-visual">
              <Basket
                assets={assets}
                weights={index.config.weights}
                empty={index.treasury.value === 0}
              />
              <p>
                Trading reserves and basket holdings
                <br />
                are separate accounts.
              </p>
            </aside>
          </div>
          <div className="scenario-toggle">
            <button
              className="text-button"
              onClick={() => setScenario(!scenario)}
            >
              <Icon name="settings" size={16} />
              {scenario ? 'Close scenarios' : 'Explore price scenarios'}
            </button>
          </div>
          {scenario && (
            <section className="scenario-panel">
              <div>
                <h3>Change a fixture price</h3>
                <p>
                  These controls change the basket’s demo valuation. They do not
                  change the DBC token price.
                </p>
              </div>
              <div className="scenario-assets">
                {assets.map((asset) => (
                  <div key={asset.id}>
                    <AssetCoin asset={asset} small />
                    <span>
                      {asset.symbol}
                      <small>{price(asset.price)} SOL / unit</small>
                    </span>
                    <button
                      className="button"
                      disabled={!!busy || !owner}
                      onClick={() =>
                        void run('scenario', {
                          indexId: index.id,
                          assetId: asset.id,
                          price: Number((asset.price * 0.8).toFixed(9)),
                        })
                      }
                    >
                      −20%
                    </button>
                    <button
                      className="button"
                      disabled={!!busy || !owner}
                      onClick={() =>
                        void run('scenario', {
                          indexId: index.id,
                          assetId: asset.id,
                          price: Number((asset.price * 1.2).toFixed(9)),
                        })
                      }
                    >
                      +20%
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {tab === 'Earnings' && (
        <div className="earnings-layout">
          <section>
            <div className="section-heading">
              <div>
                <h2>Follow the revenue</h2>
                <p>Only collected earnings can fund an operation.</p>
              </div>
              <button
                className="button primary"
                disabled={!!busy || !owner}
                onClick={() => void operation('collect')}
              >
                Collect fees <Icon name="arrow" size={16} />
              </button>
            </div>
            <div className="earnings-summary">
              <div>
                <span>Accrued creator fees</span>
                <strong>
                  {price(earnings.accrued)}
                  <small>SOL</small>
                </strong>
              </div>
              <Icon name="arrow" />
              <div>
                <span>Collected creator fees</span>
                <strong>
                  {price(earnings.collected)}
                  <small>SOL</small>
                </strong>
              </div>
            </div>
            <div className="balance-ledger">
              {[
                {
                  label: 'Basket funding available',
                  value: earnings.basketBudget,
                  color: '#7f9c83',
                },
                {
                  label: 'Holder rebates available',
                  value: earnings.rebateBudget,
                  color: '#cba672',
                },
                {
                  label: 'Buyback budget available',
                  value: earnings.buybackBudget,
                  color: '#8e91b7',
                },
                {
                  label: 'Creator retention',
                  value: earnings.retained,
                  color: '#bc6955',
                },
                {
                  label: 'Platform earnings',
                  value: earnings.platform,
                  color: '#817a6e',
                },
              ].map((row) => (
                <div key={row.label}>
                  <i style={{ background: row.color }} />
                  <span>{row.label}</span>
                  <strong>{price(row.value)} SOL</strong>
                </div>
              ))}
            </div>
            <div className="form-divider" />
            <h3>Paid and executed</h3>
            <div className="market-stat-row">
              <div>
                <span>Holder rebates paid</span>
                <strong>{price(earnings.rebatesPaid)} SOL</strong>
              </div>
              <div>
                <span>Buyback spend</span>
                <strong>{price(earnings.buybackSpent)} SOL</strong>
              </div>
              <div>
                <span>Tokens burned</span>
                <strong>
                  {number(earnings.burned)} {index.config.symbol}
                </strong>
              </div>
            </div>
          </section>
          <aside className="policy-preview">
            <h3>Policy per 1 SOL trade</h3>
            <FeeFlow config={index.config} />
          </aside>
        </div>
      )}
      {tab === 'Operations' && (
        <>
          <div className="section-heading">
            <div>
              <h2>Run the business</h2>
              <p>
                {owner
                  ? 'Operations are prepared for your wallet signature.'
                  : 'Connect the creator wallet to execute operations.'}
              </p>
            </div>
            <span className="status-pill">Wallet signatures required</span>
          </div>
          <div className="operations-grid">
            {[
              {
                action: 'collect',
                title: 'Collect trading fees',
                description:
                  'Move claimable creator fees into the operating balance.',
                label: `${price(earnings.accrued)} SOL accrued`,
              },
              {
                action: 'invest',
                title: 'Fund the basket',
                description:
                  'Purchase the selected assets using allocated earnings.',
                label: `${price(earnings.basketBudget)} SOL available`,
              },
              {
                action: 'rebalance',
                title: 'Rebalance holdings',
                description:
                  'Bring actual holdings toward the published target weights.',
                label: `${index.config.rebalanceThreshold}% drift threshold`,
              },
              {
                action: 'rebate',
                title: 'Pay eligible holders',
                description:
                  'Prepare the due cycle’s payouts from its recorded budget.',
                label: `${price(earnings.rebateBudget)} SOL available`,
              },
              {
                action: 'buyback',
                title: 'Buy back index tokens',
                description:
                  'Use the buyback budget in the token’s current market.',
                label: `${price(earnings.buybackBudget)} SOL available`,
              },
              {
                action: 'burn',
                title: 'Burn acquired tokens',
                description:
                  'Burn already purchased tokens. Basket assets stay in place.',
                label: `${number(earnings.burned)} tokens burned so far`,
              },
              {
                action: 'migrate',
                title: 'Graduate to DAMM v2',
                description:
                  'Complete the handoff once the curve reaches its threshold.',
                label: index.status.replaceAll('-', ' '),
              },
            ].map((item) => (
              <article className="operation-card" key={item.action}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <div>
                  <span>{item.label}</span>
                  <button
                    className="button"
                    disabled={!!busy || !owner}
                    onClick={() => void operation(item.action)}
                  >
                    Prepare <Icon name="arrow" size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          <Receipts index={index} />
        </>
      )}
      {tab === 'Configuration' && (
        <>
          <div className="section-heading">
            <div>
              <h2>The published terms</h2>
              <p>One token. One DBC configuration. One independent basket.</p>
            </div>
            <button className="button" onClick={duplicate}>
              Duplicate as new index <Icon name="copy" size={15} />
            </button>
          </div>
          <div className="configuration-grid">
            <section>
              <h3>Launch</h3>
              <dl className="terms-list">
                {[
                  [
                    'Opening valuation',
                    `${number(index.config.initialMarketCap)} SOL`,
                  ],
                  [
                    'Graduation valuation',
                    `${number(index.config.migrationMarketCap)} SOL`,
                  ],
                  ['Token supply', number(index.config.totalSupply, 0)],
                  [
                    'Base fee',
                    `${index.config.feeBps / 100}% · ${index.config.feeMode}`,
                  ],
                  [
                    'Dynamic fees',
                    index.config.dynamicFees ? 'Enabled' : 'Disabled',
                  ],
                  [
                    'Creator share',
                    `${index.config.creatorShare}% of non-protocol fees`,
                  ],
                  [
                    'DAMM trading fee',
                    `${index.config.migrationFeeBps / 100}%`,
                  ],
                  [
                    'Permanent liquidity lock',
                    `${index.config.creatorLocked + index.config.partnerLocked}%`,
                  ],
                  ['Slippage limit', `${index.config.slippageBps / 100}%`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3>Creator revenue policy</h3>
              <AllocationBar
                parts={[
                  {
                    label: 'Basket',
                    value: index.config.basketAllocation,
                    color: '#7f9c83',
                  },
                  {
                    label: 'Holders',
                    value: index.config.rebateAllocation,
                    color: '#cba672',
                  },
                  {
                    label: 'Buyback',
                    value: index.config.buybackAllocation,
                    color: '#8e91b7',
                  },
                  {
                    label: 'Retained',
                    value: index.config.creatorAllocation,
                    color: '#bc6955',
                  },
                ]}
              />
              <dl className="terms-list">
                <div>
                  <dt>Rebate interval</dt>
                  <dd>{index.config.rebateInterval} seconds</dd>
                </div>
                <div>
                  <dt>Minimum rebate</dt>
                  <dd>{price(index.config.minRebate)} SOL</dd>
                </div>
                <div>
                  <dt>Creator wallet</dt>
                  <dd>
                    <a
                      href={explorer(index.owner)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shorten(index.owner)} <Icon name="external" size={12} />
                    </a>
                  </dd>
                </div>
              </dl>
              <p className="terms-note">
                The basket is a separate treasury. Holding the token does not
                grant redemption of basket assets.
              </p>
            </section>
          </div>
          <section className="address-section">
            <h3>Onchain addresses</h3>
            <div className="address-list">
              {Object.entries(index.addresses || {})
                .filter(([, v]) => typeof v === 'string' && v.length > 20)
                .map(([key, value]) => (
                  <div key={key}>
                    <span>{key.replace(/([A-Z])/g, ' $1')}</span>
                    <a href={explorer(value)} target="_blank" rel="noreferrer">
                      {value}
                      <Icon name="external" size={13} />
                    </a>
                  </div>
                ))}
            </div>
          </section>
          {!!index.assetMints?.length && (
            <section className="address-section">
              <h3>Basket token identities</h3>
              <p className="terms-note">
                Each devnet fixture is a separate six-decimal token. Source
                mints identify the mainnet reference; they are not assets held
                by this basket.
              </p>
              <div className="fixture-identities">
                {index.assetMints.map((asset) => (
                  <article key={asset.assetId}>
                    <h4>
                      {asset.symbol} <span>{asset.name}</span>
                    </h4>
                    <dl>
                      <div>
                        <dt>Mainnet reference</dt>
                        <dd>
                          {asset.sourceMint ? (
                            <a
                              href={`https://explorer.solana.com/address/${encodeURIComponent(asset.sourceMint)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {asset.sourceMint}
                              <Icon name="external" size={13} />
                            </a>
                          ) : (
                            'Built-in workshop fixture'
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Devnet fixture mint</dt>
                        <dd>
                          <a
                            href={explorer(asset.mint)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {asset.mint}
                            <Icon name="external" size={13} />
                          </a>
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </section>
          )}
          <details className="advanced">
            <summary>
              Resolved business configuration <Icon name="chevron" size={16} />
            </summary>
            <pre className="config-code">
              {JSON.stringify(index.config, null, 2)}
            </pre>
            <p className="digest">Policy digest: {index.policyDigest}</p>
          </details>
        </>
      )}
      {tab === 'Overview' && <Receipts index={index} compact />}
    </Shell>
  );
}
function Receipts({
  index,
  compact = false,
}: {
  index: IndexView;
  compact?: boolean;
}) {
  const receipts = compact ? index.receipts.slice(0, 6) : index.receipts;
  return (
    <section className="receipts-section">
      <div className="section-heading">
        <h2>Activity</h2>
        <span>
          {compact && index.receipts.length > 6
            ? `Latest 6 of ${index.receipts.length} · All records in Operations`
            : `${index.receipts.length} records`}
        </span>
      </div>
      {!receipts.length ? (
        <div className="empty-receipts">
          Confirmed transactions will appear here.
        </div>
      ) : (
        <div className="receipt-list">
          {receipts.map((receipt) => (
            <div className="receipt-row" key={receipt.id}>
              <span className={`receipt-status ${receipt.status}`}>
                <Icon
                  name={receipt.status === 'failed' ? 'close' : 'check'}
                  size={15}
                />
              </span>
              <div>
                <strong>
                  {receipt.action.replaceAll('-', ' ').replaceAll('_', ' ')}
                </strong>
                <span>{receipt.message || receipt.status}</span>
              </div>
              <time>
                {new Date(receipt.createdAt).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
              {receipt.signature ? (
                <a
                  href={explorer(receipt.signature, 'tx')}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`View ${receipt.action} transaction`}
                >
                  <Icon name="external" size={16} />
                </a>
              ) : (
                <span className="receipt-label">{receipt.status}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
export default Detail;
