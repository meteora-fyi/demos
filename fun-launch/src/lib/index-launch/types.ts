import { STARTER_TOKEN_LOGOS } from '../../../../lib/token-logo.mjs';

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  color: string;
  price: number;
  updatedAt: number;
  source?: 'jupiter';
  sourceMint?: string;
  sourceDecimals?: number;
  logoURI?: string;
};
export type Config = {
  name: string;
  symbol: string;
  description: string;
  weights: { assetId: string; weight: number }[];
  initialMarketCap: number;
  migrationMarketCap: number;
  totalSupply: number;
  feeBps: number;
  endingFeeBps: number;
  feeDuration: number;
  feeMode: 'fixed' | 'linear' | 'exponential';
  dynamicFees: boolean;
  creatorShare: number;
  partnerLiquidity: number;
  creatorLiquidity: number;
  partnerLocked: number;
  creatorLocked: number;
  migrationFeeBps: number;
  migrationCharge: number;
  seedAmount: number;
  basketAllocation: number;
  rebateAllocation: number;
  buybackAllocation: number;
  creatorAllocation: number;
  rebateInterval: number;
  minRebate: number;
  minPurchase: number;
  slippageBps: number;
  rebalanceThreshold: number;
};
export type Receipt = {
  id: string;
  action: string;
  status: string;
  signature?: string;
  message?: string;
  createdAt: number | string;
};
export type IndexView = {
  id: string;
  config: Config;
  owner: string;
  createdAt: number | string;
  status: string;
  addresses: Record<string, string>;
  assetMints?: {
    assetId: string;
    symbol: string;
    name: string;
    sourceMint?: string;
    sourceDecimals?: number;
    mint: string;
    decimals: number;
  }[];
  market: {
    price: number;
    volume: number;
    quoteReserve: number;
    threshold: number;
    progress: number;
    supply: number;
  };
  treasury: {
    value: number;
    cash: number;
    holdings: {
      assetId: string;
      quantity: number;
      value: number;
      weight: number;
      target: number;
    }[];
  };
  earnings: {
    accrued: number;
    collected: number;
    platform: number;
    basketBudget: number;
    rebateBudget: number;
    buybackBudget: number;
    retained: number;
    rebatesPaid: number;
    buybackSpent: number;
    burned: number;
  };
  holders: { id: string; label: string; balance: number }[];
  history: { time: number; price: number; treasuryValue: number }[];
  receipts: Receipt[];
  policyDigest: string;
};
export type Pending = {
  operationId: string;
  wallet?: string;
  transaction: string;
  step: string;
  description: string;
  blockhash: string;
  lastValidBlockHeight: number;
};
export type Quote = {
  amountOut?: number;
  output?: number;
  minAmountOut?: number;
  minimumOut?: number;
  fee?: number;
  priceImpact?: number;
  [key: string]: unknown;
};
export type State = {
  sessionId: string;
  mode: string;
  quoteSymbol: string;
  quoteDecimals: number;
  readiness: {
    ready: boolean;
    message: string;
    rpcUrl?: string;
    network: string;
  };
  assets: Asset[];
  defaults: Config;
  indexes: IndexView[];
  wallets: { id: string; label: string; address: string }[];
  worker: { status: string };
  csrfToken?: string;
  pending?: Pending;
  quote?: Quote;
  notice?: string;
  preview?: {
    threshold: number;
    startingPrice: number | string;
    resolved: unknown;
  };
};
export const LOCAL_ASSETS: Asset[] = [
  {
    id: 'btc',
    logoURI: STARTER_TOKEN_LOGOS.btc.logoURI,
    symbol: 'BTC',
    name: 'Bitcoin basket asset',
    color: '#d2a14d',
    price: 0.01,
    updatedAt: 0,
  },
  {
    id: 'eth',
    logoURI: STARTER_TOKEN_LOGOS.eth.logoURI,
    symbol: 'ETH',
    name: 'Ethereum basket asset',
    color: '#8c98bc',
    price: 0.01,
    updatedAt: 0,
  },
  {
    id: 'sol',
    logoURI: STARTER_TOKEN_LOGOS.sol.logoURI,
    symbol: 'SOL',
    name: 'Solana basket asset',
    color: '#80a895',
    price: 0.01,
    updatedAt: 0,
  },
];
export const DEFAULTS: Config = {
  name: 'Conviction Index',
  symbol: 'CVX',
  description: 'A long-term view on crypto. One basket, three assets.',
  weights: [
    { assetId: 'btc', weight: 50 },
    { assetId: 'eth', weight: 30 },
    { assetId: 'sol', weight: 20 },
  ],
  initialMarketCap: 0.2,
  migrationMarketCap: 6,
  totalSupply: 1000000,
  feeBps: 100,
  endingFeeBps: 100,
  feeDuration: 3600,
  feeMode: 'fixed',
  dynamicFees: false,
  creatorShare: 50,
  partnerLiquidity: 20,
  creatorLiquidity: 60,
  partnerLocked: 10,
  creatorLocked: 10,
  migrationFeeBps: 100,
  migrationCharge: 0,
  seedAmount: 0,
  basketAllocation: 50,
  rebateAllocation: 25,
  buybackAllocation: 0,
  creatorAllocation: 25,
  rebateInterval: 30,
  minRebate: 0.0001,
  minPurchase: 0.0001,
  slippageBps: 100,
  rebalanceThreshold: 5,
};
export const number = (n: unknown, digits = 4) =>
  typeof n === 'number' && Number.isFinite(n)
    ? n.toLocaleString('en-GB', { maximumFractionDigits: digits })
    : '—';
export const price = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n)
    ? n === 0
      ? '0'
      : n.toLocaleString('en-GB', { maximumSignificantDigits: 6 })
    : '—';
export const shorten = (address?: string) =>
  address ? `${address.slice(0, 4)}…${address.slice(-4)}` : '—';
export const explorer = (address: string, type: 'tx' | 'address' = 'address') =>
  `https://explorer.solana.com/${type}/${encodeURIComponent(address)}?cluster=devnet`;
