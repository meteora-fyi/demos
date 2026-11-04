import { Keypair, SystemProgram } from '@solana/web3.js';
import {
  ExtensionType, TOKEN_2022_PROGRAM_ID, createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction, createTransferCheckedWithFeeInstruction,
  createWithdrawWithheldTokensFromAccountsInstruction, getAccount, getMintLen,
  getOrCreateAssociatedTokenAccount, mintTo,
} from '@solana/spl-token';
import { fundedWallet, rpc, send } from './local.mjs';

export const program = TOKEN_2022_PROGRAM_ID;
export const decimals = 6;
export const unit = 1_000_000n;
const feeBps = 200n;
const maxFee = 100n * unit;

export function feeFor(amount) {
  const fee = (amount * feeBps + 9_999n) / 10_000n;
  return fee < maxFee ? fee : maxFee;
}

export async function createFeeToken() {
  const payer = await fundedWallet();
  const mint = Keypair.generate();
  const space = getMintLen([ExtensionType.TransferFeeConfig]);
  const lamports = await rpc.getMinimumBalanceForRentExemption(space);
  await send(payer, [
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey,
      space, lamports, programId: program,
    }),
    createInitializeTransferFeeConfigInstruction(
      mint.publicKey, null, payer.publicKey, Number(feeBps), maxFee, program,
    ),
    createInitializeMintInstruction(mint.publicKey, decimals, payer.publicKey, null, program),
  ], mint);
  const address = mint.publicKey;

  async function account(owner, amount = 0n) {
    const { address: tokenAccount } = await getOrCreateAssociatedTokenAccount(
      rpc, payer, address, owner, false, 'confirmed', undefined, program,
    );
    if (amount) {
      await mintTo(rpc, payer, address, tokenAccount, payer, amount, [], {
        commitment: 'confirmed',
      }, program);
    }
    return tokenAccount;
  }

  return {
    payer, mint: address, account,
    balance: async (tokenAccount) => (await getAccount(rpc, tokenAccount, 'confirmed', program)).amount,
    transfer: (from, to, owner, amount) => createTransferCheckedWithFeeInstruction(
      from, address, to, owner, amount, decimals, feeFor(amount), [], program,
    ),
    withdraw: (vault, sources) => createWithdrawWithheldTokensFromAccountsInstruction(
      address, vault, payer.publicKey, [], sources, program,
    ),
  };
}
