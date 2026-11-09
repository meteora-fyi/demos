import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction,SystemProgram} from '@solana/web3.js';
import {rawAmount,verifyPreparedTransaction,tokenDelta,previewConfig} from './chain.mjs';
import {DEFAULT_CONFIG} from './model.mjs';
const wallet=Keypair.generate(),recipient=Keypair.generate().publicKey;
function payment(){return new Transaction({feePayer:wallet.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(SystemProgram.transfer({fromPubkey:wallet.publicKey,toPubkey:recipient,lamports:1000}));}
test('signed transaction binding rejects changed destination and absent wallet signature',()=>{
  const tx=payment(),pending={message:tx.serializeMessage().toString('base64')};
  assert.throws(()=>verifyPreparedTransaction(pending,tx.serialize({requireAllSignatures:false}).toString('base64')),/signature/);
  tx.sign(wallet);assert.doesNotThrow(()=>verifyPreparedTransaction(pending,tx.serialize().toString('base64')));
  tx.instructions[0].keys[1].pubkey=Keypair.generate().publicKey;tx.sign(wallet);
  assert.throws(()=>verifyPreparedTransaction(pending,tx.serialize().toString('base64')),/differs/);
});
test('decimal amounts stay exact and reject exponent/negative/excess precision',()=>{
  assert.equal(rawAmount('0.000000001'),1n);assert.equal(rawAmount('12.123456789'),12123456789n);
  for(const amount of ['1e9','-1','0.1234567891','NaN'])assert.throws(()=>rawAmount(amount));
  assert.throws(()=>rawAmount('0.0000001',6));
});
test('confirmed token deltas include newly created accounts and use raw units',()=>{
  const receipt={transaction:{message:{accountKeys:[recipient]}},meta:{preTokenBalances:[],postTokenBalances:[{accountIndex:0,uiTokenAmount:{amount:'9007199254740993'}}]}};
  assert.equal(tokenDelta(receipt,recipient.toBase58()),9007199254740993n);
  assert.equal(tokenDelta(receipt,wallet.publicKey.toBase58()),0n);
});
test('SDK compiles all exposed fee modes and preserves decimal config evidence',()=>{
  for(const feeMode of ['fixed','linear','exponential']){const result=previewConfig({...DEFAULT_CONFIG,feeMode,endingFeeBps:50});assert.ok(result.threshold>0);assert.match(result.resolved.migrationQuoteThreshold,/^\d+$/);assert.equal(result.resolved.creatorTradingFeePercentage,DEFAULT_CONFIG.creatorShare);}
});
