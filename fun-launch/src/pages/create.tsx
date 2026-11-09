import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Shell } from '@/components/index-launch/Shell';
import { TokenSearch } from '@/components/index-launch/TokenSearch';
import {
  AllocationBar,
  AssetCoin,
  Basket,
  FeeFlow,
  Icon,
} from '@/components/index-launch/visuals';
import { useIndex } from '@/lib/index-launch/context';
import {
  DEFAULTS,
  LOCAL_ASSETS,
  type Config,
  type Asset,
  number,
  price,
} from '@/lib/index-launch/types';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export default function Create() {
  const { state, run, busy, wallet, connect } = useIndex();
  const router = useRouter();
  const [config, setConfig] = useState<Config>(structuredClone(DEFAULTS));
  const [step, setStep] = useState(0);
  const [issue, setIssue] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState<{
    threshold: number;
    startingPrice: number | string;
  } | null>(null);
  useEffect(() => {
    setPreview(null);
  }, [config]);
  useEffect(() => {
    if (step === 3) {
      let active = true;
      void run('preview', { config }).then((result) => {
        if (active && result?.preview) setPreview(result.preview);
      });
      return () => {
        active = false;
      };
    }
  }, [step, config, run]);
  const [tradeAmount, setTradeAmount] = useState(1);
  const assets = state?.assets || LOCAL_ASSETS;
  const addAsset = async (asset: Asset) => {
    if (
      config.weights.length >= 10 ||
      config.weights.some((w) => w.assetId === asset.id)
    )
      return;
    const response = await run('add-asset', { assetId: asset.id });
    if (response?.assets.some((a) => a.id === asset.id)) {
      setConfig((current) =>
        current.weights.some((w) => w.assetId === asset.id) ||
        current.weights.length >= 10
          ? current
          : {
              ...current,
              weights: [...current.weights, { assetId: asset.id, weight: 0 }],
            },
      );
    }
  };
  useEffect(() => {
    if (!loaded && state) {
      let draft = state.defaults || DEFAULTS;
      try {
        const stored = sessionStorage.getItem('index-launch-draft');
        if (stored) {
          draft = JSON.parse(stored);
          sessionStorage.removeItem('index-launch-draft');
        }
      } catch {}
      setConfig(structuredClone(draft));
      setLoaded(true);
    }
  }, [state, loaded]);
  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig((c) => ({
      ...c,
      [key]: value,
      ...(key === 'feeBps'
        ? {
            endingFeeBps:
              c.feeMode === 'fixed'
                ? Number(value)
                : Math.min(c.endingFeeBps, Number(value)),
          }
        : {}),
    }));
  const numeric = (
    key: keyof Config,
    label: string,
    options: {
      min?: number;
      max?: number;
      step?: number;
      hint?: string;
      suffix?: string;
    } = {},
  ) => (
    <Field label={label} hint={options.hint}>
      <span className="input-unit">
        <input
          type="number"
          value={Number(config[key])}
          min={options.min ?? 0}
          max={options.max}
          step={options.step ?? 1}
          onChange={(e) => set(key, Number(e.target.value) as never)}
        />
        {options.suffix && <span>{options.suffix}</span>}
      </span>
    </Field>
  );
  const allocations =
    config.basketAllocation +
    config.rebateAllocation +
    config.buybackAllocation +
    config.creatorAllocation;
  const weights = config.weights.reduce((s, w) => s + w.weight, 0);
  const liq =
    config.partnerLiquidity +
    config.creatorLiquidity +
    config.partnerLocked +
    config.creatorLocked;
  const validate = () => {
    if (step === 0) {
      if (config.name.trim().length < 2) return 'Give your index a name.';
      if (new TextEncoder().encode(config.name.trim()).length > 32)
        return 'Use an index name of 32 bytes or fewer.';
      if (!/^[A-Za-z0-9]{2,10}$/.test(config.symbol))
        return 'Use 2–10 letters or digits for the symbol.';
      if (config.weights.length < 2) return 'Add at least two assets.';
      if (config.weights.length > 10) return 'Choose up to ten assets.';
      if (config.weights.some((w) => !assets.some((a) => a.id === w.assetId)))
        return 'Choose each basket asset again in this workspace.';
      if (weights !== 100 || config.weights.some((w) => w.weight <= 0))
        return 'Positive basket weights must add up to 100%.';
    }
    if (step === 1) {
      if (config.migrationMarketCap <= config.initialMarketCap)
        return 'Graduation valuation must be higher than opening valuation.';
      if (config.endingFeeBps > config.feeBps)
        return 'The ending fee cannot be higher than the opening fee.';
      if (liq !== 100) return 'Liquidity ownership must add up to 100%.';
      if (config.partnerLocked + config.creatorLocked < 10)
        return 'Permanently lock at least 10% of liquidity.';
    }
    if (step === 2 && allocations !== 100)
      return 'Creator revenue allocations must add up to 100%.';
    return '';
  };
  const next = () => {
    const error = validate();
    setIssue(error);
    if (!error) setStep((s) => s + 1);
  };
  const launch = async () => {
    if (!wallet) {
      connect();
      return;
    }
    const response = await run('create', { config });
    if (response && !response.pending) {
      const latest =
        response.indexes.find(
          (i) => !state?.indexes.some((old) => old.id === i.id),
        ) ||
        [...response.indexes]
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          .find(
            (i) =>
              i.config.name === config.name &&
              i.config.symbol === config.symbol,
          );
      if (latest) void router.push(`/indexes/${latest.id}`);
    }
  };
  const preset = (name: string) => {
    if (!config.weights.length) return;
    if (name === 'equal') {
      const weight = Math.floor(100 / config.weights.length);
      const remainder = 100 % config.weights.length;
      set(
        'weights',
        config.weights.map((w, i) => ({
          assetId: w.assetId,
          weight: weight + (i < remainder ? 1 : 0),
        })),
      );
    } else if (config.weights.length === 3) {
      set(
        'weights',
        config.weights.map((w, i) => ({ ...w, weight: [50, 30, 20][i] })),
      );
    }
  };
  return (
    <Shell title="Create an index">
      <div className="create-header">
        <Link href="/" className="back-link">
          <Icon name="back" size={16} />
          Explore
        </Link>
        <h1>Build your index.</h1>
        <p>A basket is an idea. The terms make it a business.</p>
      </div>
      <div className="wizard-steps" aria-label="Creation steps">
        {['The basket', 'The market', 'The business', 'Review & launch'].map(
          (label, i) => (
            <button
              type="button"
              key={label}
              className={i === step ? 'active' : i < step ? 'complete' : ''}
              disabled={i > step}
              onClick={() => {
                setIssue('');
                setStep(i);
              }}
            >
              <span>{i < step ? <Icon name="check" size={13} /> : i + 1}</span>
              {label}
            </button>
          ),
        )}
      </div>
      <div className="creation-layout">
        <div className="wizard-panel">
          {step === 0 && (
            <>
              <div className="panel-heading">
                <h2>What belongs in your basket?</h2>
                <p>Choose the assets behind your thesis.</p>
              </div>
              <div className="form-grid">
                <Field label="Index name">
                  <input
                    value={config.name}
                    maxLength={32}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Conviction Index"
                  />
                </Field>
                <Field label="Token symbol">
                  <input
                    value={config.symbol}
                    maxLength={10}
                    onChange={(e) =>
                      set('symbol', e.target.value.toUpperCase())
                    }
                    placeholder="CVX"
                  />
                </Field>
              </div>
              <Field label="Your thesis">
                <textarea
                  value={config.description}
                  maxLength={400}
                  rows={2}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="What does this basket believe in?"
                />
              </Field>
              <TokenSearch
                csrfToken={state?.csrfToken}
                selected={config.weights.map((w) => w.assetId)}
                disabled={!!busy}
                onAdd={addAsset}
              />
              <div className="asset-picker">
                {assets
                  .filter(
                    (asset) =>
                      !asset.sourceMint ||
                      config.weights.some((w) => w.assetId === asset.id),
                  )
                  .map((asset) => {
                    const selected = config.weights.some(
                      (w) => w.assetId === asset.id,
                    );
                    return (
                      <button
                        key={asset.id}
                        className={selected ? 'selected' : ''}
                        aria-pressed={selected}
                        disabled={
                          !!busy || (!selected && config.weights.length >= 10)
                        }
                        title={
                          asset.sourceMint
                            ? `${asset.name} · Source mint: ${asset.sourceMint}`
                            : asset.name
                        }
                        onClick={() =>
                          set(
                            'weights',
                            selected
                              ? config.weights.filter(
                                  (w) => w.assetId !== asset.id,
                                )
                              : [
                                  ...config.weights,
                                  { assetId: asset.id, weight: 0 },
                                ],
                          )
                        }
                      >
                        <AssetCoin asset={asset} />
                        <span className="asset-picker-label">
                          {asset.symbol}
                          {asset.sourceMint && <small>Devnet copy</small>}
                        </span>
                        <Icon name={selected ? 'check' : 'plus'} size={16} />
                      </button>
                    );
                  })}
              </div>
              <div className="allocation-heading">
                <h3>Target allocation</h3>
                <span className={weights === 100 ? 'positive' : 'negative'}>
                  {weights}% of 100%
                </span>
              </div>
              <div className="weight-list">
                {config.weights.map((w) => {
                  const asset = assets.find((a) => a.id === w.assetId);
                  if (!asset) return null;
                  return (
                    <div className="weight-row" key={w.assetId}>
                      <AssetCoin asset={asset} small />
                      <label htmlFor={`weight-${w.assetId}`}>
                        {asset.symbol}
                        {asset.sourceMint && (
                          <small title={asset.sourceMint}>
                            {asset.sourceMint.slice(0, 4)}…
                            {asset.sourceMint.slice(-4)}
                          </small>
                        )}
                      </label>
                      <input
                        id={`weight-${w.assetId}`}
                        aria-label={`${asset.symbol} weight`}
                        type="range"
                        min={1}
                        max={99}
                        value={w.weight}
                        style={{ accentColor: asset.color }}
                        onChange={(e) =>
                          set(
                            'weights',
                            config.weights.map((x) =>
                              x.assetId === w.assetId
                                ? { ...x, weight: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                      />
                      <span className="weight-input">
                        <input
                          aria-label={`${asset.symbol} allocation percent`}
                          type="number"
                          min={1}
                          max={99}
                          value={w.weight}
                          onChange={(e) =>
                            set(
                              'weights',
                              config.weights.map((x) =>
                                x.assetId === w.assetId
                                  ? { ...x, weight: Number(e.target.value) }
                                  : x,
                              ),
                            )
                          }
                        />
                        %
                      </span>
                      <button
                        type="button"
                        className="icon-button remove-asset"
                        aria-label={`Remove ${asset.symbol}${asset.sourceMint ? ` ${asset.sourceMint}` : ''}`}
                        disabled={!!busy}
                        onClick={() =>
                          set(
                            'weights',
                            config.weights.filter(
                              (item) => item.assetId !== w.assetId,
                            ),
                          )
                        }
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="preset-actions">
                <button
                  className="text-button"
                  disabled={config.weights.length !== 3}
                  onClick={() => preset('balanced')}
                >
                  50 / 30 / 20
                </button>
                <button className="text-button" onClick={() => preset('equal')}>
                  Equal weight
                </button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div className="panel-heading">
                <h2>Shape the launch.</h2>
                <p>Your index token gets its own DBC configuration.</p>
              </div>
              <div className="form-grid">
                {numeric('initialMarketCap', 'Opening valuation', {
                  min: 0.01,
                  step: 0.01,
                  suffix: 'SOL',
                })}
                {numeric('migrationMarketCap', 'Graduation valuation', {
                  min: 0.02,
                  step: 0.01,
                  suffix: 'SOL',
                })}
                {numeric('totalSupply', 'Token supply', {
                  min: 1000,
                  max: 1000000000,
                  step: 1000,
                })}
                {numeric('slippageBps', 'Slippage limit', {
                  min: 1,
                  max: 500,
                  suffix: 'bps',
                })}
              </div>
              <div className="price-range">
                <div>
                  <span>Opening token price</span>
                  <strong>
                    {price(config.initialMarketCap / config.totalSupply)} SOL
                  </strong>
                </div>
                <Icon name="arrow" />
                <div>
                  <span>Target graduation price</span>
                  <strong>
                    {price(config.migrationMarketCap / config.totalSupply)} SOL
                  </strong>
                </div>
              </div>
              <div className="form-divider" />
              <h3>Trading fees</h3>
              <div className="segmented">
                {(['fixed', 'linear', 'exponential'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={config.feeMode === mode ? 'active' : ''}
                    onClick={() => {
                      set('feeMode', mode);
                      if (mode === 'fixed') set('endingFeeBps', config.feeBps);
                    }}
                  >
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              <div className="form-grid">
                {numeric('feeBps', 'Opening fee', {
                  min: 25,
                  max: 1000,
                  suffix: 'bps',
                  hint: '100 bps = 1%',
                })}
                {config.feeMode !== 'fixed' &&
                  numeric('endingFeeBps', 'Ending fee', {
                    min: 25,
                    max: config.feeBps,
                    suffix: 'bps',
                  })}
                {config.feeMode !== 'fixed' &&
                  numeric('feeDuration', 'Schedule duration', {
                    min: 1,
                    max: 86400,
                    suffix: 'seconds',
                  })}
              </div>
              <label className="switch-row">
                <span>
                  <strong>Volatility-responsive fees</strong>
                  <small>Add a dynamic fee when the market is volatile.</small>
                </span>
                <input
                  type="checkbox"
                  checked={config.dynamicFees}
                  onChange={(e) => set('dynamicFees', e.target.checked)}
                />
              </label>
              <details className="advanced">
                <summary>
                  Graduation & liquidity ownership{' '}
                  <Icon name="chevron" size={16} />
                </summary>
                <div className="form-grid">
                  {numeric('migrationFeeBps', 'DAMM trading fee', {
                    min: 10,
                    max: 1000,
                    suffix: 'bps',
                  })}
                  {numeric('migrationCharge', 'One-time migration charge', {
                    max: 10,
                    suffix: '%',
                  })}
                  {numeric('creatorLiquidity', 'Creator unlocked liquidity', {
                    max: 100,
                    suffix: '%',
                  })}
                  {numeric('partnerLiquidity', 'Platform unlocked liquidity', {
                    max: 100,
                    suffix: '%',
                  })}
                  {numeric('creatorLocked', 'Creator permanent lock', {
                    max: 100,
                    suffix: '%',
                  })}
                  {numeric('partnerLocked', 'Platform permanent lock', {
                    max: 100,
                    suffix: '%',
                  })}
                </div>
                <div className="inline-total">
                  Liquidity allocation{' '}
                  <strong className={liq === 100 ? 'positive' : 'negative'}>
                    {liq}% / 100%
                  </strong>
                </div>
              </details>
            </>
          )}
          {step === 2 && (
            <>
              <div className="panel-heading">
                <h2>Make the economics yours.</h2>
                <p>Decide where collected trading fees go.</p>
              </div>
              <div className="creator-split">
                <div>
                  <h3>Creator & platform</h3>
                  <span>Split of the non-protocol fee allocation</span>
                </div>
                <strong>
                  {config.creatorShare}% / {100 - config.creatorShare}%
                </strong>
              </div>
              <input
                className="full-range"
                type="range"
                min={0}
                max={100}
                value={config.creatorShare}
                aria-label="Creator share of non-protocol fees"
                onChange={(e) => set('creatorShare', Number(e.target.value))}
              />
              <div className="range-labels">
                <span>More to platform</span>
                <span>More to creator</span>
              </div>
              <div className="form-divider" />
              <h3>Allocate the creator’s earnings</h3>
              <div className="policy-inputs">
                {[
                  {
                    key: 'basketAllocation',
                    label: 'Build the basket',
                    description: 'Purchase the selected assets.',
                    color: '#7f9c83',
                  },
                  {
                    key: 'rebateAllocation',
                    label: 'Reward holders',
                    description: 'Fund eligible holder rebates.',
                    color: '#cba672',
                  },
                  {
                    key: 'buybackAllocation',
                    label: 'Buy back & burn',
                    description: 'Buy the index token from its market.',
                    color: '#8e91b7',
                  },
                  {
                    key: 'creatorAllocation',
                    label: 'Retain earnings',
                    description: 'Keep revenue for operations.',
                    color: '#bc6955',
                  },
                ].map((p) => (
                  <label className="policy-row" key={p.key}>
                    <i style={{ background: p.color }} />
                    <span>
                      <strong>{p.label}</strong>
                      <small>{p.description}</small>
                    </span>
                    <span className="input-unit">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={Number(config[p.key as keyof Config])}
                        onChange={(e) =>
                          set(
                            p.key as keyof Config,
                            Number(e.target.value) as never,
                          )
                        }
                      />
                      <span>%</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="inline-total">
                Allocated creator earnings
                <strong
                  className={allocations === 100 ? 'positive' : 'negative'}
                >
                  {allocations}% / 100%
                </strong>
              </div>
              <details className="advanced">
                <summary>
                  Operating limits <Icon name="chevron" size={16} />
                </summary>
                <div className="form-grid">
                  {numeric('seedAmount', 'Starting basket contribution', {
                    min: 0,
                    step: 0.001,
                    suffix: 'SOL',
                  })}
                  {numeric('minPurchase', 'Minimum basket purchase', {
                    min: 0.000001,
                    step: 0.0001,
                    suffix: 'SOL',
                  })}
                  {numeric('rebateInterval', 'Rebate interval', {
                    min: 10,
                    max: 3600,
                    suffix: 'seconds',
                  })}
                  {numeric('minRebate', 'Minimum rebate budget', {
                    min: 0.000001,
                    step: 0.0001,
                    suffix: 'SOL',
                  })}
                  {numeric('rebalanceThreshold', 'Rebalance drift threshold', {
                    min: 1,
                    max: 50,
                    suffix: '%',
                  })}
                </div>
                <p className="field-note">
                  Operations request the creator’s wallet signature. No
                  unattended spending.
                </p>
              </details>
            </>
          )}
          {step === 3 && (
            <>
              <div className="panel-heading">
                <h2>Your index, ready to launch.</h2>
                <p>
                  These terms are fixed for this launch. A new configuration
                  creates a new index.
                </p>
              </div>
              <div className="review-identity">
                <span className="index-symbol">
                  {config.symbol.slice(0, 3)}
                </span>
                <div>
                  <h3>{config.name}</h3>
                  <span>{config.symbol} / SOL · Solana devnet</span>
                </div>
              </div>
              <p className="review-description">{config.description}</p>
              <div className="review-table">
                {[
                  [
                    'Opening valuation',
                    `${number(config.initialMarketCap)} SOL`,
                  ],
                  [
                    'Graduation valuation',
                    `${number(config.migrationMarketCap)} SOL`,
                  ],
                  [
                    'Graduation reserve target',
                    preview
                      ? `${number(preview.threshold, 9)} SOL`
                      : 'Calculating from your curve…',
                  ],
                  [
                    'Supply',
                    `${number(config.totalSupply, 0)} ${config.symbol}`,
                  ],
                  [
                    'Opening fee',
                    `${config.feeBps / 100}% · ${config.feeMode}`,
                  ],
                  [
                    'Creator / platform',
                    `${config.creatorShare}% / ${100 - config.creatorShare}%`,
                  ],
                  ['DAMM fee', `${config.migrationFeeBps / 100}%`],
                  [
                    'Permanently locked liquidity',
                    `${config.creatorLocked + config.partnerLocked}%`,
                  ],
                  [
                    'Initial basket contribution',
                    `${number(config.seedAmount)} SOL`,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <AllocationBar
                parts={[
                  {
                    label: 'Basket',
                    value: config.basketAllocation,
                    color: '#7f9c83',
                  },
                  {
                    label: 'Holders',
                    value: config.rebateAllocation,
                    color: '#cba672',
                  },
                  {
                    label: 'Buyback',
                    value: config.buybackAllocation,
                    color: '#8e91b7',
                  },
                  {
                    label: 'Retained',
                    value: config.creatorAllocation,
                    color: '#bc6955',
                  },
                ]}
              />
              {!preview && !busy && (
                <button
                  className="button"
                  onClick={() =>
                    void run('preview', { config }).then((result) => {
                      if (result?.preview) setPreview(result.preview);
                    })
                  }
                >
                  Calculate launch terms <Icon name="refresh" size={16} />
                </button>
              )}
              <div className="launch-explanation">
                <Icon name="wallet" />
                <p>
                  Your wallet signs each setup step. The launch creates a unique
                  DBC config, index token and pool. Basket purchases use
                  separately allocated funds.
                </p>
              </div>
            </>
          )}
          {issue && (
            <p className="form-error" role="alert">
              {issue}
            </p>
          )}
          <div className="wizard-actions">
            {step > 0 ? (
              <button
                className="button"
                disabled={!!busy}
                onClick={() => {
                  setStep((s) => s - 1);
                  setIssue('');
                }}
              >
                <Icon name="back" size={16} />
                Back
              </button>
            ) : (
              <Link href="/" className="button">
                Cancel
              </Link>
            )}
            {step < 3 ? (
              <button className="button primary" onClick={next}>
                Continue <Icon name="arrow" size={17} />
              </button>
            ) : (
              <button
                className="button primary"
                disabled={!!busy || !state?.readiness.ready || !preview}
                onClick={() => void launch()}
              >
                {busy ? (
                  <span className="loading-ring" />
                ) : (
                  <Icon name="plus" size={17} />
                )}{' '}
                {wallet ? 'Launch index' : 'Connect & launch'}
              </button>
            )}
          </div>
        </div>
        <aside className="creation-preview">
          {step < 2 ? (
            <>
              <Basket assets={assets} weights={config.weights} empty />
              <div className="preview-name">
                <h3>{config.name || 'Your index'}</h3>
                <span>{config.symbol || 'INDEX'}</span>
              </div>
              <AllocationBar
                parts={config.weights.map((w) => ({
                  label:
                    assets.find((a) => a.id === w.assetId)?.symbol || w.assetId,
                  value: w.weight,
                  color:
                    assets.find((a) => a.id === w.assetId)?.color || '#aaa',
                }))}
              />
              <div className="preview-note">
                Target weights for devnet test tokens. Holdings grow when
                collected revenue is invested.
              </div>
            </>
          ) : (
            <>
              <div className="preview-title">
                <h3>Follow the fee</h3>
                <label>
                  Example trade{' '}
                  <span className="input-unit">
                    <input
                      aria-label="Example trade amount"
                      type="number"
                      min={0.001}
                      step={0.1}
                      value={tradeAmount}
                      onChange={(e) => setTradeAmount(Number(e.target.value))}
                    />
                    <span>SOL</span>
                  </span>
                </label>
              </div>
              <FeeFlow config={config} amount={tradeAmount} />
            </>
          )}
        </aside>
      </div>
    </Shell>
  );
}
