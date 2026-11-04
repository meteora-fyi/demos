import { Cron } from 'croner';
import { assets, createFund } from '../../../../lib/index-fund.mjs';
import { WorkshopInputError, workshopHandler } from '@/lib/workshop/api';

type Fund = Awaited<ReturnType<typeof createFund>>;
type Sandbox = { fund?: Fund; busy: boolean; task?: Cron };
const globals = globalThis as typeof globalThis & { workshopFund?: Sandbox };
const sandbox = (globals.workshopFund ??= { busy: false });

async function exclusively<T>(callback: () => Promise<T>) {
  if (sandbox.busy) throw new WorkshopInputError('A transaction is already running. Try again in a moment.');
  sandbox.busy = true;
  try {
    return await callback();
  } finally {
    sandbox.busy = false;
  }
}

function whole(value: unknown, max: number) {
  if (typeof value !== 'string' || !/^\d{1,4}$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw new WorkshopInputError(`Enter a whole number from 1 to ${max}.`);
  }
  return Number(value);
}

function startCron(fund: Fund) {
  sandbox.task = new Cron('*/30 * * * * *', { protect: true }, async () => {
    if (sandbox.busy) return;
    try {
      await exclusively(() => fund.rebate());
    } catch (error) {
      console.error('Scheduled holder rebate failed', error);
    }
  });
}

export default workshopHandler((body) => exclusively(async () => {
  const fields = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const { action } = fields;
  if (action === 'status') {
    return sandbox.fund?.snapshot('Fund state read from the local validator.') ??
      { initialized: false, metrics: [], receipts: [], notice: 'Choose weights and launch a basket.' };
  }
  if (action === 'launch') {
    if (sandbox.fund) throw new WorkshopInputError('This workshop process already has an active basket.');
    const weights = assets.map((_, index) => whole(fields['weight' + index], 98));
    if (weights.reduce((sum, weight) => sum + weight, 0) !== 100) {
      throw new WorkshopInputError('Weights must add up to 100%.');
    }
    const fund = await createFund(weights);
    sandbox.fund = fund;
    startCron(fund);
    return fund.snapshot('Basket launched. Subscribe as Alice and Bob to issue shares.');
  }
  const fund = sandbox.fund;
  if (!fund) throw new WorkshopInputError('Launch a basket first.');
  if (action === 'rebate') {
    const paid = await fund.rebate();
    return fund.snapshot(paid ? 'Holder rebates confirmed.' : 'No payable rebate above 0.01 shares.');
  }
  if (action !== 'subscribe' && action !== 'redeem' && action !== 'transfer') {
    throw new WorkshopInputError('Unknown fund action.');
  }
  if (fields.holder !== 'alice' && fields.holder !== 'bob') {
    throw new WorkshopInputError('Choose a workshop holder.');
  }
  const holder = fields.holder === 'alice' ? 0 : 1;
  await fund[action](holder, BigInt(whole(fields.shares, 1_000)));
  return fund.snapshot('Transaction confirmed.');
}));
