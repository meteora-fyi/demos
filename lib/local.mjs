import {
  Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram,
  Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';

export const rpc = new Connection('http://127.0.0.1:8899', 'confirmed');

export async function fundedWallet() {
  const wallet = Keypair.generate();
  const block = await rpc.getLatestBlockhash();
  const signature = await rpc.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL);
  const result = await rpc.confirmTransaction({ ...block, signature }, 'confirmed');
  if (result.value.err) throw new Error(JSON.stringify(result.value.err));
  return wallet;
}

export function send(payer, instructions, ...signers) {
  return sendAndConfirmTransaction(rpc, new Transaction().add(...instructions), [payer, ...signers], {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
}

export function pay(from, to, lamports) {
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports });
}
