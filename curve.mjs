import {
  ActivationType, BaseFeeMode, CollectFeeMode, MigrationFeeOption, MigrationOption,
  TokenAuthorityOption, TokenDecimal, TokenType, buildCurveWithMarketCap,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

const presets = {
  'studio-work': { start: 20, graduate: 600, startBps: 150, endBps: 50, creatorShare: 70, creatorLp: 60 },
  'high-volume': { start: 10, graduate: 150, startBps: 100, endBps: 25, creatorShare: 40, creatorLp: 30 },
};
const name = process.argv[2] ?? 'studio-work';
if (!Object.hasOwn(presets, name)) throw new Error('Choose studio-work or high-volume');
const preset = presets[name];
const curve = buildCurveWithMarketCap({
  token: {
    tokenType: TokenType.SPLToken, tokenBaseDecimal: TokenDecimal.SIX,
    tokenQuoteDecimal: TokenDecimal.NINE, tokenAuthorityOption: TokenAuthorityOption.Immutable,
    totalTokenSupply: 1_000_000_000, leftover: 0,
  },
  fee: {
    baseFeeParams: {
      baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: {
        startingFeeBps: preset.startBps, endingFeeBps: preset.endBps,
        numberOfPeriod: 10, totalDuration: 3600,
      },
    },
    dynamicFeeEnabled: false,
    collectFeeMode: CollectFeeMode.QuoteToken,
    creatorTradingFeePercentage: preset.creatorShare,
    poolCreationFee: 0,
    enableFirstSwapWithMinFee: false,
  },
  migration: {
    migrationOption: MigrationOption.MET_DAMM_V2,
    migrationFeeOption: MigrationFeeOption.FixedBps100,
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
  },
  liquidityDistribution: {
    partnerLiquidityPercentage: 80 - preset.creatorLp,
    creatorLiquidityPercentage: preset.creatorLp,
    partnerPermanentLockedLiquidityPercentage: 10,
    creatorPermanentLockedLiquidityPercentage: 10,
  },
  lockedVesting: {
    totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0,
    totalVestingDuration: 0, cliffDurationFromMigrationTime: 0,
  },
  activationType: ActivationType.Timestamp,
  initialMarketCap: preset.start,
  migrationMarketCap: preset.graduate,
});
console.table({
  'Initial market cap (SOL)': preset.start,
  'Graduation market cap (SOL)': preset.graduate,
  'Quote reserve to graduate (lamports)': curve.migrationQuoteThreshold.toString(10),
  'Opening trading fee (bps)': preset.startBps,
  'Trading fee after one hour (bps)': preset.endBps,
  'Creator / platform share of DBC fees (%)': `${preset.creatorShare} / ${100 - preset.creatorShare}`,
  'Creator / platform unlocked DAMM v2 liquidity (%)': `${preset.creatorLp} / ${80 - preset.creatorLp}`,
  'Permanently locked liquidity (%)': 20,
});
