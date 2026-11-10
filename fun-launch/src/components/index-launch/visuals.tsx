import { useId, useState } from 'react';
import { safeLogoURI } from '../../../../lib/token-logo.mjs';
import {
  type Asset,
  type Config,
  number,
  price,
} from '@/lib/index-launch/types';

export function Icon({
  name,
  size = 20,
}: {
  name:
    | 'plus'
    | 'arrow'
    | 'back'
    | 'close'
    | 'check'
    | 'external'
    | 'refresh'
    | 'wallet'
    | 'basket'
    | 'settings'
    | 'chevron'
    | 'copy'
    | 'grid'
    | 'book'
    | 'menu'
    | 'info';
  size?: number;
}) {
  const paths = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    book: (
      <>
        <path d="M12 5C8 2 4 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-2-1-6-2-10 1Z" />
        <path d="M12 5v16" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v1" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    back: <path d="M20 12H5m6-6-6 6 6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    external: (
      <>
        <path d="M14 4h6v6m0-6L10 14" />
        <path d="M10 4H4v16h16v-6" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M5.1 8a7 7 0 0 1 11.6-3L20 8M4 16l3.3 3A7 7 0 0 0 18.9 16" />
      </>
    ),
    wallet: (
      <>
        <path d="M3 6h16v14H3zM3 6l13-3v3" />
        <path d="M15 11h6v5h-6z" />
      </>
    ),
    basket: (
      <>
        <path d="M3 9h18l-2 11H5L3 9Zm3 0 4-6m8 6-4-6M9 13v3m6-3v3" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 2 4-1 1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-2Z" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V4H4v12h4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function AssetCoin({
  asset,
  small = false,
}: {
  asset: Asset;
  small?: boolean;
}) {
  const [failedLogo, setFailedLogo] = useState<string | undefined>();
  const logoURI = safeLogoURI(asset.logoURI);
  const showLogo = logoURI && failedLogo !== logoURI;
  return (
    <span
      className={`asset-coin ${small ? 'small' : ''} ${asset.sourceMint ? 'asset-monogram' : ''}`}
      style={{ '--asset-color': asset.color } as React.CSSProperties}
      aria-label={asset.symbol}
      role="img"
    >
      {showLogo ? (
        // External token artwork loads in the browser, without an image proxy or referrer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoURI}
          alt=""
          width={64}
          height={64}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedLogo(logoURI)}
        />
      ) : asset.id === 'btc' ? (
        '₿'
      ) : asset.id === 'eth' ? (
        'Ξ'
      ) : asset.id === 'sol' ? (
        '≋'
      ) : (
        asset.symbol.slice(0, 2)
      )}
    </span>
  );
}
export function Basket({
  assets,
  weights,
  compact = false,
  empty = false,
}: {
  assets: Asset[];
  weights: Config['weights'];
  compact?: boolean;
  empty?: boolean;
}) {
  const selected = weights
    .map((w) => ({
      asset: assets.find((a) => a.id === w.assetId),
      weight: w.weight,
    }))
    .filter((x) => x.asset);
  const id = useId().replaceAll(':', '');
  return (
    <div
      className={`basket-visual ${compact ? 'compact' : ''} ${empty ? 'unfunded' : ''} ${selected.length > 3 ? 'basket-many' : ''}`}
      aria-label={`Basket allocation: ${selected.map((x) => `${x.asset!.symbol} ${x.weight}%`).join(', ')}`}
    >
      <svg
        className="basket-frame"
        viewBox="0 0 460 310"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id={`grid${id}`}
            width="19"
            height="19"
            patternUnits="userSpaceOnUse"
          >
            <path d="M19 0H0v19" stroke="var(--basket-grid)" strokeWidth=".6" />
          </pattern>
        </defs>
        <ellipse
          cx="230"
          cy="278"
          rx="157"
          ry="13"
          fill="var(--basket-shadow)"
        />
        <path
          d="m75 140 154-57 155 57-28 113-127 36-126-36-28-113Z"
          fill="var(--basket-fill)"
          stroke="var(--basket-edge)"
          strokeWidth="1.3"
        />
        <path
          d="m75 140 154 50 155-50M229 190v99"
          stroke="var(--basket-edge)"
          strokeWidth="1.3"
        />
        <path
          d="m85 150 144 46v82l-120-34-24-94Zm155 46 134-43-24 91-110 31v-79Z"
          fill={`url(#grid${id})`}
        />
        <path
          d="m111 126 28-55 54-19m72 0 54 19 28 55"
          stroke="var(--basket-edge)"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="m111 126 28-55 54-19m72 0 54 19 28 55"
          stroke="var(--basket-fill)"
          strokeWidth="2"
        />
        <path
          d="m75 140 154 50 155-50"
          stroke="var(--basket-edge)"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="m75 140 154 50 155-50"
          stroke="var(--basket-highlight)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <div className="basket-coins">
        {selected.map((x, i) => (
          <div
            className={`basket-item item-${i}`}
            key={x.asset!.id}
            style={{
              animationDelay: `${i * 80}ms`,
              ...(selected.length > 3
                ? {
                    left: `${16 + (i % (selected.length > 6 ? 5 : 3)) * (60 / ((selected.length > 6 ? 5 : 3) - 1))}%`,
                    top: `${18 + Math.floor(i / (selected.length > 6 ? 5 : 3)) * 23}%`,
                    transform: `rotate(${((i % 3) - 1) * 7}deg)`,
                  }
                : {}),
            }}
          >
            <AssetCoin asset={x.asset!} />
            <span>{x.weight}%</span>
          </div>
        ))}
      </div>
      {!compact && (
        <div className="basket-caption">
          {empty ? 'Target composition' : 'Your basket'}
          <span>
            {selected.length} assets ·{' '}
            {weights.reduce((s, w) => s + w.weight, 0)}% allocated
          </span>
        </div>
      )}
    </div>
  );
}
export function AllocationBar({
  parts,
}: {
  parts: { label: string; value: number; color: string }[];
}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 100;
  return (
    <div className="allocation-block">
      <div
        className="allocation-bar"
        role="img"
        aria-label={parts.map((p) => `${p.label} ${p.value}%`).join(', ')}
      >
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span
              key={p.label}
              style={{
                width: `${(p.value / total) * 100}%`,
                background: p.color,
              }}
            />
          ))}
      </div>
      <div className="allocation-legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label}
            <strong>{number(p.value, 2)}%</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
export function HistoryChart({
  points,
  label,
  unit = 'SOL',
  valueKey = 'price',
}: {
  points: { time: number; price: number; treasuryValue: number }[];
  label: string;
  unit?: string;
  valueKey?: 'price' | 'treasuryValue';
}) {
  const rows = points.filter((p) => Number.isFinite(p[valueKey]));
  const w = 840,
    h = 245,
    pad = 20;
  if (rows.length < 2)
    return (
      <div className="chart-empty">
        <svg viewBox="0 0 840 245" aria-hidden="true">
          <path
            d="M20 60H820M20 120H820M20 180H820"
            stroke="var(--line)"
            strokeDasharray="3 6"
          />
          <path d="M20 205H820" stroke="var(--line-strong)" />
        </svg>
        <div>
          <strong>
            {rows.length === 1
              ? `${price(rows[0][valueKey])} ${unit}`
              : 'Waiting for the first confirmed activity'}
          </strong>
          <span>{label} history appears as transactions are confirmed.</span>
        </div>
      </div>
    );
  const vals = rows.map((p) => p[valueKey]);
  const min = Math.min(...vals),
    max = Math.max(...vals);
  const spread = Math.max(max - min, Math.abs(max) * 0.1, 0.000000001);
  const lo = min - spread * 0.15,
    hi = max + spread * 0.15;
  const coords = rows.map((p, i) => [
    pad + (i * (w - pad * 2)) / (rows.length - 1),
    h - pad - ((p[valueKey] - lo) / (hi - lo)) * (h - pad * 2),
  ]);
  const path = coords
    .map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`)
    .join(' ');
  const end = coords[coords.length - 1];
  return (
    <div className="history-chart">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`${label}, ${rows.length} observations from ${price(vals[0])} to ${price(vals[vals.length - 1])} ${unit}`}
      >
        {[0.2, 0.5, 0.8].map((v) => (
          <line
            key={v}
            x1={pad}
            y1={h * v}
            x2={w - pad}
            y2={h * v}
            stroke="var(--line)"
            strokeDasharray="3 6"
          />
        ))}
        <path
          d={`${path} L ${w - pad} ${h - pad} L ${pad} ${h - pad} Z`}
          fill="var(--chart-fill)"
          opacity=".48"
        />
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <circle cx={end[0]} cy={end[1]} r="4" fill="var(--accent)" />
      </svg>
      <div className="chart-axis">
        <span>
          {new Date(rows[0].time).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span>
          {label} · {unit}
        </span>
        <span>
          {new Date(rows[rows.length - 1].time).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
}
export function FeeFlow({
  config,
  amount = 1,
}: {
  config: Config;
  amount?: number;
}) {
  const fee = (amount * config.feeBps) / 10000,
    creator = (fee * 0.8 * config.creatorShare) / 100,
    platform = fee * 0.8 - creator;
  return (
    <div className="fee-flow">
      <div className="flow-source">
        <span>Trade amount</span>
        <strong>{number(amount)} SOL</strong>
      </div>
      <div className="flow-connector" />
      <div className="flow-fee">
        <span>{number(config.feeBps / 100, 2)}% trading fee</span>
        <strong>{price(fee)} SOL</strong>
      </div>
      <div className="flow-branches">
        <div>
          <span>Protocol</span>
          <strong>{price(fee * 0.2)}</strong>
        </div>
        <div>
          <span>Platform</span>
          <strong>{price(platform)}</strong>
        </div>
        <div className="flow-creator">
          <span>Creator earnings</span>
          <strong>{price(creator)}</strong>
        </div>
      </div>
      <div className="creator-flow">
        {[
          { label: 'Basket', key: 'basketAllocation', color: '#7f9c83' },
          { label: 'Holders', key: 'rebateAllocation', color: '#cba672' },
          { label: 'Buyback', key: 'buybackAllocation', color: '#8e91b7' },
          { label: 'Retained', key: 'creatorAllocation', color: '#bc6955' },
        ].map((p) => (
          <div key={p.key}>
            <i style={{ background: p.color }} />
            <span>{p.label}</span>
            <strong>
              {price((creator * Number(config[p.key as keyof Config])) / 100)}
            </strong>
          </div>
        ))}
      </div>
      <div className="flow-unit">Amounts in SOL · before execution costs</div>
    </div>
  );
}
