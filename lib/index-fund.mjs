import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import {
  createMint, createMintToCheckedInstruction, createTransferCheckedInstruction,
  createBurnCheckedInstruction, getAccount, getMint, getOrCreateAssociatedTokenAccount,
  getTransferFeeAmount, mintTo,
} from '@solana/spl-token';
import { createFeeToken, decimals, feeFor, program, unit } from './fee-token.mjs';
import { fundedWallet, pay, rpc, send } from './local.mjs';

export const assets = ['Mock SOL', 'Mock BTC', 'Mock USD'];
export const entryLamportsPerShare = 1_000_000n;
const minRebate = unit / 100n;
const tokenText = (amount) => (Number(amount) / Number(unit)).toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');

export async function createFund(weights) {
  assert.equal(weights.length, assets.length);
  assert(weights.every((weight) => Number.isInteger(weight) && weight > 0));
  assert.equal(weights.reduce((sum, weight) => sum + weight, 0), 100);
  const token = await createFeeToken();
  const { payer, mint } = token;
  const [alice, bob] = await Promise.all([fundedWallet(), fundedWallet()]);
  const operator = Keypair.generate().publicKey;
  const vault = await token.account(payer.publicKey);
  const wallets = [alice, bob];
  const shares = await Promise.all(wallets.map((wallet) => token.account(wallet.publicKey)));
  const basket = await Promise.all(assets.map(async (name, index) => {
    const assetMint = await createMint(rpc, payer, payer.publicKey, null, decimals, undefined, { commitment: 'confirmed' });
    const accounts = await Promise.all([payer, ...wallets].map(async (wallet) =>
      (await getOrCreateAssociatedTokenAccount(rpc, payer, assetMint, wallet.publicKey, false, 'confirmed')).address));
    for (const holder of accounts.slice(1)) {
      await mintTo(rpc, payer, assetMint, holder, payer, 2_000n * unit, [], { commitment: 'confirmed' });
    }
    return { name, weight: BigInt(weights[index]), mint: assetMint, reserve: accounts[0], holders: accounts.slice(1) };
  }));

  const receipts = [];
  function record(label, signature) {
    receipts.unshift({ label, signature });
    if (receipts.length > 6) receipts.pop();
  }

  async function subscribe(index, count) {
    const holder = wallets[index];
    const amount = count * unit;
    const instructions = basket.map((asset) => createTransferCheckedInstruction(
      asset.holders[index], asset.mint, asset.reserve, holder.publicKey, amount * asset.weight / 100n, decimals,
    ));
    const signature = await send(payer, [
      ...instructions,
      pay(holder.publicKey, operator, count * entryLamportsPerShare),
      createMintToCheckedInstruction(mint, shares[index], payer.publicKey, amount, decimals, [], program),
    ], holder);
    record('Basket deposit and share issuance', signature);
  }

  async function redeem(index, count) {
    const holder = wallets[index];
    const amount = count * unit;
    const instructions = basket.map((asset) => createTransferCheckedInstruction(
      asset.reserve, asset.mint, asset.holders[index], payer.publicKey, amount * asset.weight / 100n, decimals,
    ));
    const signature = await send(payer, [
      createBurnCheckedInstruction(shares[index], mint, holder.publicKey, amount, decimals, [], program),
      ...instructions,
    ], holder);
    record('Share burn and basket redemption', signature);
  }

  async function transfer(index, count) {
    const holder = wallets[index];
    const signature = await send(payer, [
      token.transfer(shares[index], shares[1 - index], holder.publicKey, count * unit),
    ], holder);
    record('Share transfer with 2% withheld', signature);
  }

  const readShares = () => Promise.all(shares.map((account) => getAccount(rpc, account, 'confirmed', program)));
  const withheld = (accounts) => accounts.reduce((total, account) =>
    total + (getTransferFeeAmount(account)?.withheldAmount ?? 0n), 0n);

  async function rebate() {
    const accounts = await readShares();
    const budget = await token.balance(vault) + withheld(accounts);
    const total = accounts.reduce((sum, account) => sum + account.amount, 0n);
    if (budget < minRebate || !total) return false;
    const sources = accounts.filter((account) => getTransferFeeAmount(account)?.withheldAmount > 0n);
    const instructions = sources.length ? [token.withdraw(vault, sources.map(({ address }) => address))] : [];
    for (const account of accounts) {
      const gross = budget * account.amount / total;
      if (gross > feeFor(gross)) instructions.push(token.transfer(vault, account.address, payer.publicKey, gross));
    }
    const signature = await send(payer, instructions);
    record('Pro-rata holder rebate', signature);
    return true;
  }

  async function snapshot(notice) {
    const [mintInfo, accounts, cash, vaultBalance, reserves] = await Promise.all([
      getMint(rpc, mint, 'confirmed', program),
      readShares(),
      rpc.getBalance(operator),
      token.balance(vault),
      Promise.all(basket.map((asset) => getAccount(rpc, asset.reserve, 'confirmed'))),
    ]);
    const total = reserves.reduce((sum, reserve) => sum + reserve.amount, 0n);
    assert.equal(total, mintInfo.supply, 'The mock basket must fully back every share');
    const nav = mintInfo.supply ? Number(total) / Number(mintInfo.supply) : undefined;
    return {
      initialized: true,
      notice,
      receipts: [...receipts],
      metrics: [
        { label: 'NAV per share (mock USD)', value: nav === undefined ? 'No shares issued' : '$' + nav.toFixed(2) },
        { label: 'Reserve value (mock USD)', value: '$' + tokenText(total) },
        { label: 'Shares outstanding', value: tokenText(mintInfo.supply) },
        { label: 'Gross subscription revenue', value: cash / 1e9 + ' SOL' },
        { label: 'Pending rebate shares', value: tokenText(withheld(accounts) + vaultBalance) },
        { label: 'Share mint', value: mint.toBase58() },
        ...accounts.map((account, index) => ({ label: ['Alice shares', 'Bob shares'][index], value: tokenText(account.amount) })),
        ...basket.map((asset, index) => ({
          label: asset.name + ' reserve · ' + asset.weight + '% target',
          value: tokenText(reserves[index].amount),
        })),
      ],
    };
  }

  return { subscribe, redeem, transfer, rebate, snapshot };
}
