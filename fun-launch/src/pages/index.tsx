import Link from 'next/link';
import { useRouter } from 'next/router';
import { Shell } from '@/components/index-launch/Shell';
import {
  AssetCoin,
  Basket,
  Icon,
  HistoryChart,
} from '@/components/index-launch/visuals';
import { useIndex } from '@/lib/index-launch/context';
import {
  DEFAULTS,
  LOCAL_ASSETS,
  number,
  price,
} from '@/lib/index-launch/types';

export default function Home() {
  const { state, loading, refresh } = useIndex();
  const assets = state?.assets || LOCAL_ASSETS;
  const router = useRouter();
  const mine = router.query.view === 'mine';
  const indexes = mine
    ? (state?.indexes || []).filter((index) => index.canManage !== false)
    : state?.exploreIndexes || state?.indexes || [];
  const volume = indexes.reduce(
    (sum, item) => sum + (item.market.volume || 0),
    0,
  );
  const basketValue = indexes.reduce(
    (sum, item) => sum + (item.treasury.value || 0),
    0,
  );
  return (
    <Shell>
      <section className="home-intro">
        <div>
          <div className="hero-protocol">
            <span className="live-dot" />
            Powered by Meteora DBC
          </div>
          <h1>
            Launch an index.
            <br />
            <em>Build a business.</em>
          </h1>
          <p>
            Choose your assets. Design your economics.
            <br />
            Turn trading activity into a working index treasury.
          </p>
          <Link href="/create" className="button primary">
            Create an index <Icon name="plus" size={18} />
          </Link>
        </div>
        <div className="hero-basket">
          <Basket assets={assets} weights={DEFAULTS.weights} empty />
          <div className="hero-basket-note">
            <span>BTC</span>
            <span>ETH</span>
            <span>SOL</span>
            <i>Your basket. Your rules.</i>
          </div>
        </div>
      </section>
      <div className="workspace-metrics" aria-label="Demo index activity">
        <div>
          <span>{mine ? 'Your indexes' : 'Indexes in this demo'}</span>
          <strong>
            {loading ? '—' : indexes.length}
            <Icon name="grid" size={18} />
          </strong>
        </div>
        <div>
          <span>Recorded trading volume</span>
          <strong>
            {loading ? '—' : number(volume)}
            <small>SOL</small>
          </strong>
        </div>
        <div>
          <span>Basket asset value</span>
          <strong>
            {loading ? '—' : number(basketValue)}
            <small>SOL</small>
          </strong>
        </div>
      </div>
      <section className="marketplace">
        <div className="section-heading">
          <div>
            <h2>
              {mine ? 'My indexes' : 'Explore indexes'}{' '}
              <span className="count">{indexes.length}</span>
            </h2>
            <p>
              {mine
                ? 'Your launches and their business activity.'
                : 'Discover the baskets launched in this devnet demo.'}
            </p>
          </div>
          <button
            className="icon-button"
            onClick={() => void refresh()}
            aria-label="Refresh indexes"
          >
            <Icon name="refresh" />
          </button>
        </div>
        {loading ? (
          <div
            className="index-grid skeleton-grid"
            role="status"
            aria-label="Loading indexes"
          >
            {[0, 1, 2].map((item) => (
              <div
                className="index-card skeleton-card"
                key={item}
                aria-hidden="true"
              >
                <span />
                <i />
                <div />
                <i />
              </div>
            ))}
            <span className="sr-only">Loading indexes…</span>
          </div>
        ) : indexes.length ? (
          <div className="index-grid">
            {indexes.map((index) => (
              <Link
                href={`/indexes/${index.id}`}
                className="index-card"
                key={index.id}
              >
                <div className="index-card-top">
                  <span className="index-symbol">
                    {index.config.symbol.slice(0, 3)}
                  </span>
                  <span className="status-pill">
                    {index.status.replaceAll('-', ' ')}
                  </span>
                </div>
                <div className="index-card-title">
                  <h3>{index.config.name}</h3>
                  <span>{index.config.symbol} / SOL</span>
                </div>
                <div className="index-card-chart">
                  <HistoryChart
                    points={index.history || []}
                    label="Token price"
                  />
                </div>
                <div className="index-card-assets">
                  {index.config.weights.map((w) => {
                    const asset = assets.find((a) => a.id === w.assetId);
                    return asset ? (
                      <span key={w.assetId}>
                        <AssetCoin asset={asset} small />
                        {asset.symbol}
                        <strong>{w.weight}%</strong>
                      </span>
                    ) : null;
                  })}
                </div>
                <div className="index-card-bottom">
                  <div>
                    <span>Market price</span>
                    <strong>{price(index.market.price)} SOL</strong>
                  </div>
                  <div>
                    <span>Basket value</span>
                    <strong>{number(index.treasury.value)} SOL</strong>
                  </div>
                  <Icon name="arrow" />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-market">
            <div className="empty-illustration">
              <span />
              <span />
              <span />
              <Icon name="basket" size={33} />
            </div>
            <div>
              <h3>
                {mine
                  ? 'Your first index starts here.'
                  : 'Be the first to launch an index.'}
              </h3>
              <p>
                Build a basket around an idea. Decide how its trading fees
                <br className="desktop-break" /> fund assets, reward holders and
                sustain the business.
              </p>
              <Link href="/create" className="text-button">
                Build your basket <Icon name="arrow" size={17} />
              </Link>
            </div>
          </div>
        )}
      </section>
      <section className="product-steps" aria-label="How the launchpad works">
        <div>
          <span className="step-number">01</span>
          <h3>Build your thesis</h3>
          <p>Select assets and set the basket’s target weights.</p>
        </div>
        <div>
          <span className="step-number">02</span>
          <h3>Shape the business</h3>
          <p>Configure your DBC curve, fees and revenue allocation.</p>
        </div>
        <div>
          <span className="step-number">03</span>
          <h3>Put it to work</h3>
          <p>Trade the index token. Turn collected fees into basket assets.</p>
        </div>
      </section>
    </Shell>
  );
}
