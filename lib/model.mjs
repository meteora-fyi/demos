import { createHash } from 'node:crypto';
import { STARTER_TOKEN_LOGOS } from './token-logo.mjs';

export const SCALE = 1_000_000_000n;
export const ASSETS = [
  { id: 'btc', symbol: 'BTC', name: 'Devnet Bitcoin fixture', color: '#e6a147', price: 0.01 },
  { id: 'eth', symbol: 'ETH', name: 'Devnet Ethereum fixture', color: '#8b9bd1', price: 0.01 },
  { id: 'sol', symbol: 'SOL', name: 'Devnet Solana fixture', color: '#72b8a6', price: 0.01 },
].map(asset => ({ ...asset, logoURI: STARTER_TOKEN_LOGOS[asset.id].logoURI }));
export const DEFAULT_CONFIG = Object.freeze({
  name: 'Conviction Index', symbol: 'CVX', description: 'A basket of crypto majors, funded by trading activity.',
  weights: [{ assetId: 'btc', weight: 50 }, { assetId: 'eth', weight: 30 }, { assetId: 'sol', weight: 20 }],
  initialMarketCap: 0.2, migrationMarketCap: 6, totalSupply: 1_000_000,
  feeBps: 100, endingFeeBps: 100, feeDuration: 3600, feeMode: 'fixed', dynamicFees: false,
  creatorShare: 50, partnerLiquidity: 20, creatorLiquidity: 60, partnerLocked: 10, creatorLocked: 10,
  migrationFeeBps: 100, migrationCharge: 0, seedAmount: 0,
  basketAllocation: 50, rebateAllocation: 25, buybackAllocation: 0, creatorAllocation: 25,
  rebateInterval: 30, minRebate: 0.0001, minPurchase: 0.0001, slippageBps: 100, rebalanceThreshold: 5,
});
export class InputError extends Error { constructor(message) { super(message); this.name = 'InputError'; } }

export function raw(value, label = 'amount', decimals = 9) {
  const text = String(value);
  if (!new RegExp(`^(?:0|[1-9]\\d{0,12})(?:\\.\\d{1,${decimals}})?$`).test(text)) throw new InputError(`Enter a non-negative ${label} with at most ${decimals} decimals.`);
  const [whole, decimal = ''] = text.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(decimal.padEnd(decimals, '0'));
}
export function display(value, decimals = 9) { return Number(BigInt(value)) / 10 ** decimals; }
export function decimal(value, decimals = 9) {
  const scale = 10n ** BigInt(decimals);
  const n = BigInt(value); const sign = n < 0n ? '-' : ''; const absolute = n < 0n ? -n : n;
  return `${sign}${absolute / scale}.${String(absolute % scale).padStart(decimals, '0')}`;
}
export function integer(value, min, max, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new InputError(`${label} must be an integer from ${min} to ${max}.`);
  return n;
}
function number(value, min, max, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${label} must be from ${min} to ${max}.`);
  raw(n, label); return n;
}
export function validateConfig(input, assets = ASSETS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('An index configuration is required.');
  for (const key of Object.keys(input)) if (!(key in DEFAULT_CONFIG)) throw new InputError(`Unsupported configuration field: ${key}`);
  const c = structuredClone({ ...DEFAULT_CONFIG, ...input });
  c.name = String(c.name).trim(); c.symbol = String(c.symbol).trim().toUpperCase(); c.description = String(c.description).trim();
  if (c.name.length < 2 || Buffer.byteLength(c.name,'utf8') > 32) throw new InputError('Name must have at least 2 characters and fit within 32 UTF-8 bytes.');
  if (!/^[A-Z0-9]{2,10}$/.test(c.symbol)) throw new InputError('Symbol must have 2–10 letters or digits.');
  if (c.description.length > 400) throw new InputError('Description must have at most 400 characters.');
  const available = Array.isArray(assets) ? assets : Object.values(assets || {});
  if (!Array.isArray(c.weights) || c.weights.length < 2 || c.weights.length > 10) throw new InputError('Choose between two and ten supported assets.');
  const ids = new Set(), sourceMints = new Set();
  c.weights = c.weights.map(w => {
    const asset = w && available.find(a => a.id === w.assetId);
    if (!asset || ids.has(w.assetId) || (asset.sourceMint && sourceMints.has(asset.sourceMint))) throw new InputError('Basket assets must be supported and unique.');
    if (asset.sourceMint) sourceMints.add(asset.sourceMint);
    ids.add(w.assetId); return { assetId: w.assetId, weight: integer(w.weight, 1, 99, 'Asset weight') };
  });
  if (c.weights.reduce((s, w) => s + w.weight, 0) !== 100) throw new InputError('Basket allocations must total 100%.');
  c.initialMarketCap = number(c.initialMarketCap, 0.01, 10000, 'Opening valuation');
  c.migrationMarketCap = number(c.migrationMarketCap, c.initialMarketCap + 0.01, 100000, 'Graduation valuation');
  c.totalSupply = integer(c.totalSupply, 1000, 1_000_000_000, 'Token supply');
  c.feeBps = integer(c.feeBps, 25, 1000, 'Opening fee'); c.endingFeeBps = integer(c.endingFeeBps, 25, c.feeBps, 'Ending fee');
  if (!['fixed', 'linear', 'exponential'].includes(c.feeMode)) throw new InputError('Choose a fixed, linear or exponential fee.');
  if (c.feeMode === 'fixed') c.endingFeeBps = c.feeBps;
  c.feeDuration = integer(c.feeDuration, 1, 86400, 'Fee schedule duration');
  if (typeof c.dynamicFees !== 'boolean') throw new InputError('Dynamic-fee choice must be boolean.');
  for (const key of ['creatorShare','partnerLiquidity','creatorLiquidity','partnerLocked','creatorLocked','basketAllocation','rebateAllocation','buybackAllocation','creatorAllocation']) c[key] = integer(c[key], 0, 100, key);
  if (c.partnerLiquidity + c.creatorLiquidity + c.partnerLocked + c.creatorLocked !== 100) throw new InputError('Liquidity ownership must total 100%.');
  if (c.partnerLocked + c.creatorLocked < 10) throw new InputError('At least 10% of migrated liquidity must remain permanently locked in this preset.');
  if (c.basketAllocation + c.rebateAllocation + c.buybackAllocation + c.creatorAllocation !== 100) throw new InputError('Creator revenue allocations must total 100%.');
  c.migrationFeeBps = integer(c.migrationFeeBps, 10, 1000, 'DAMM fee'); c.migrationCharge = integer(c.migrationCharge, 0, 10, 'Migration charge');
  c.seedAmount = number(c.seedAmount, 0, 1000, 'Seed amount');
  c.rebateInterval = integer(c.rebateInterval, 10, 3600, 'Rebate interval');
  c.minRebate = number(c.minRebate, 0.000001, 1000, 'Minimum rebate'); c.minPurchase = number(c.minPurchase, 0.000001, 1000, 'Minimum basket purchase');
  c.slippageBps = integer(c.slippageBps, 1, 500, 'Slippage limit'); c.rebalanceThreshold = integer(c.rebalanceThreshold, 1, 50, 'Rebalance threshold');
  return c;
}
export function digest(config) { return createHash('sha256').update(JSON.stringify(config)).digest('hex'); }
export function allocate(amount, config) {
  const n = BigInt(amount);
  const basket = n * BigInt(config.basketAllocation) / 100n;
  const rebate = n * BigInt(config.rebateAllocation) / 100n;
  const buyback = n * BigInt(config.buybackAllocation) / 100n;
  // The last bucket receives integer dust so no value is invented or lost.
  return { basket: String(basket), rebate: String(rebate), buyback: String(buyback), retained: String(n - basket - rebate - buyback) };
}
export function weightedBalances(events, start, end, eligibleAfter = {}) {
  const result = {}; const ordered = [...events].sort((a,b) => a.time - b.time);
  for (const wallet of new Set(ordered.flatMap(event => Object.keys(event.balances)))) {
    let balance = 0n; let cursor = start; let weight = 0n;
    for (const event of ordered) {
      if (event.time <= start) { balance = BigInt(event.balances[wallet] || '0'); continue; }
      if (event.time >= end) break;
      const from = Math.max(cursor, eligibleAfter[wallet] || 0);
      if (event.time > from) weight += balance * BigInt(event.time - from);
      balance = BigInt(event.balances[wallet] || '0'); cursor = event.time;
    }
    const from = Math.max(cursor, eligibleAfter[wallet] || 0);
    if (end > from) weight += balance * BigInt(end - from);
    result[wallet] = weight;
  }
  return result;
}
export function payoutAllocations(budget, weights) {
  const sum = Object.values(weights).reduce((a,b) => a + b, 0n);
  if (!sum) return [];
  return Object.entries(weights).map(([wallet, weight]) => ({wallet, amountRaw: String(BigInt(budget) * weight / sum)})).filter(x => BigInt(x.amountRaw) > 0n);
}
export function freshAssets(assets, ids, now = Date.now()) {
  if (ids.some(id => !assets[id] || assets[id].stale || now - assets[id].updatedAt > 30000)) throw new InputError('A constituent price is stale. Refresh the scenario prices before execution.');
}
