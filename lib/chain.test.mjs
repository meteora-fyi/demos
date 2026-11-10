import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction,SystemProgram,ComputeBudgetProgram} from '@solana/web3.js';
import {rawAmount,verifyPreparedTransaction,tokenDelta,previewConfig,curveComplete} from './chain.mjs';
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

test('source identities become fresh devnet fixture mints and mapping exposes no signing secrets',async()=>{
 const {createFixtureAsset,fixtureMintMapping}=await import('./chain.mjs');
 const sourceMint=Keypair.generate().publicKey.toBase58(),assetId=`jup_${sourceMint}`;
 const first=await createFixtureAsset(wallet.publicKey,'first-index',assetId,{sourceMint,sourceDecimals:9,symbol:'SAME',name:'Source token'});
 const second=await createFixtureAsset(wallet.publicKey,'second-index',assetId,{sourceMint,sourceDecimals:9,symbol:'SAME',name:'Source token'});
 assert.notEqual(first.mint,sourceMint);assert.notEqual(first.mint,second.mint);
 assert.equal(first.reserve.mint,first.mint);assert.equal(first.decimals,6);
 const mapping=fixtureMintMapping({assets:{[assetId]:first}});
 assert.equal(mapping[0].sourceMint,sourceMint);assert.equal(mapping[0].sourceDecimals,9);assert.equal(mapping[0].decimals,6);
 assert.equal(JSON.stringify(mapping).includes('secret'),false);
 assert.equal(JSON.stringify(mapping).includes('seller'),false);
});

test('ten-constituent baskets settle in bounded packets with sells first and exact cumulative effects',async()=>{
 const {createFixtureAsset,basketOrderBatches,basketTransaction,accumulateBasketEffects}=await import('./chain.mjs');
 const state={wallet:wallet.publicKey.toBase58(),assets:{},accounts:{creator:{address:Keypair.generate().publicKey.toBase58()},market:{address:Keypair.generate().publicKey.toBase58()}}};
 const orders=[];
 for(let i=0;i<10;i++){
  const sourceMint=Keypair.generate().publicKey.toBase58(),assetId=`jup_${sourceMint}`;
  state.assets[assetId]=await createFixtureAsset(wallet.publicKey,'packet-index',assetId,{sourceMint,sourceDecimals:9,symbol:'SAME',name:'Token'});
  orders.push({assetId,side:i%2?'sell':'buy',amountRaw:'1000000',price:0.01});
 }
 const batches=basketOrderBatches({orders});assert.deepEqual(batches.map(b=>b.length),[3,3,3,1]);
 assert.deepEqual(batches.flat().map(o=>o.side),[...Array(5).fill('sell'),...Array(5).fill('buy')]);
 const sourceKeys=new Set(Object.values(state.assets).map(a=>a.sourceMint));
 for(const batch of batches){
  const tx=await basketTransaction(state,{orders:batch},async()=> '1000000000000');
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({units:600000}));
  tx.feePayer=wallet.publicKey;tx.recentBlockhash=Keypair.generate().publicKey.toBase58();
  assert.ok(tx.serialize({requireAllSignatures:false}).length<1232);
  assert.ok(tx.instructions.flatMap(ix=>ix.keys).every(k=>!sourceKeys.has(k.pubkey.toBase58())));
 }
 await assert.rejects(basketTransaction(state,{orders:[orders[0]]},async address=>address===state.accounts.creator.address?'0':'1000000000000'),/Insufficient collected/);
 const op={};assert.deepEqual(accumulateBasketEffects(op,0n,3000000n),{spentRaw:'0',receivedRaw:'3000000'});
 assert.deepEqual(accumulateBasketEffects(op,2000000n,0n),{spentRaw:'2000000',receivedRaw:'3000000'});
 assert.deepEqual(basketOrderBatches({orders:[{assetId:'dust',side:'buy',amountRaw:'1',price:10}]}),[]);
});

test('graduation follows actual SDK reserves, without an invented completion flag',()=>{
  const config={migrationQuoteThreshold:926322532n};
  assert.equal(curveComplete({quoteReserve:926322531n},config),false);
  assert.equal(curveComplete({quoteReserve:926322532n},config),true);
  assert.equal(curveComplete({quoteReserve:926322533n},config),true);
});
