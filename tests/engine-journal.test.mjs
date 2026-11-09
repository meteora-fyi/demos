import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Keypair} from '@solana/web3.js';

process.env.NODE_ENV='test';
const directory=await mkdtemp(path.join(os.tmpdir(),'index-engine-'));
process.env.DEMO_DATA_DIR=directory;
const {dispatch,getState,setChainForTests}=await import('../lib/engine.mjs');
const {DEFAULT_CONFIG}=await import('../lib/model.mjs');
const {readSession}=await import('../lib/store.mjs');
const owner=Keypair.generate().publicKey.toBase58(),other=Keypair.generate().publicKey.toBase58();
const signature='1'.repeat(88);
const operations=new Map();
let collectCalls=0,fixtureQuantity=0,creatorCashRaw='4000000';
setChainForTests({
 readiness:async()=>({ready:true,network:'devnet',rpcUrl:'https://private.example/key-secret'}),
 snapshot:async()=>({status:'trading',market:{price:0.001,supply:1000000,quoteReserve:1,threshold:10,accruedCreatorRaw:'4000000'},holders:[{id:other,balance:100,balanceRaw:'100000000'}],treasury:{cashRaw:creatorCashRaw,holdings:[{assetId:'btc',quantity:fixtureQuantity,quantityRaw:String(fixtureQuantity*1000000)}]}}),
 prepare:async(action,args)=>{
  const existing=operations.get(args.requestId);
  if(!existing)operations.set(args.requestId,{action,args});
  return {transaction:'AA==',description:action,requestId:args.requestId,indexId:args.index,step:action,blockhash:'block',lastValidBlockHeight:100};
 },
 submit:async({operation,signedTransaction})=>{
  assert.equal(signedTransaction,'AA==');
  const op=operations.get(operation.requestId);
  if(op.action==='collect')collectCalls++;
  return {complete:true,signature,effects:op.action==='collect'?{creatorRaw:'4000000',platformRaw:'4000000'}:{addresses:{mint:'mint',config:'config',pool:'pool'}}};
 },
});
const session='a'.repeat(32);
let indexId;
test('create journals pending state and exposes no private RPC',async()=>{
 const state=await dispatch({action:'create',config:DEFAULT_CONFIG,wallet:owner,requestId:'create_request_1'},session);
 assert.ok(state.pending); indexId=state.indexes[0].id;
 const stored=await readSession(session);assert.equal(stored.operations.create_request_1.status,'awaiting-signature');
 assert.equal(JSON.stringify(state).includes('key-secret'),false);
 const reloaded=await getState(session);assert.equal(reloaded.pending.operationId,'create_request_1');
});
test('second action cannot overtake an unresolved wallet operation',async()=>{
 await assert.rejects(dispatch({action:'create',config:DEFAULT_CONFIG,wallet:owner,requestId:'create_request_2'},session),/pending/);
 const state=await dispatch({action:'submit',operationId:'create_request_1',signedTransaction:'AA=='},session);
 assert.equal(state.indexes.length,1);assert.equal(state.indexes[0].status,'trading');
});
test('creator-only operations reject another wallet before preparation',async()=>{
 await assert.rejects(dispatch({action:'collect',indexId,wallet:other,requestId:'collect_wrong_1'},session),/creator wallet/);
});
test('confirmed fee effects are applied only once even if client repeats submit',async()=>{
 await dispatch({action:'collect',indexId,wallet:owner,requestId:'collect_request_1'},session);
 let state=await dispatch({action:'submit',operationId:'collect_request_1',signedTransaction:'AA=='},session);
 assert.equal(state.indexes[0].earnings.collected,0.004);
 assert.equal(state.indexes[0].earnings.basketBudget,0.002);
 assert.equal(state.indexes[0].earnings.rebateBudget,0.001);
 assert.equal(state.indexes[0].earnings.retained,0.001);
 state=await dispatch({action:'submit',operationId:'collect_request_1',signedTransaction:'AA=='},session);
 assert.equal(state.indexes[0].earnings.collected,0.004);assert.equal(collectCalls,1);
});
test('treasury chart preserves actual historical valuations across refreshes',async()=>{
 fixtureQuantity=1;const first=await getState(session);const before=first.indexes[0].history.at(-1);
 assert.equal(before.treasuryValue,0.012);
 fixtureQuantity=2;const second=await getState(session);const points=second.indexes[0].history;
 assert.equal(points.at(-2).treasuryValue,0.012);assert.equal(points.at(-1).treasuryValue,0.022);
 assert.equal(second.indexes[0].treasury.value,0.022);
});
test('external treasury withdrawals cannot silently consume another policy allocation',async()=>{
 creatorCashRaw='2000000';
 await assert.rejects(dispatch({action:'invest',indexId,wallet:owner,requestId:'invest_shortfall'},session),/below its recorded allocations/);
 creatorCashRaw='4000000';
});
test('another session cannot confirm or read the operation',async()=>{
 await assert.rejects(dispatch({action:'submit',operationId:'collect_request_1',signedTransaction:'AA=='},'b'.repeat(32)),/not found/);
 assert.deepEqual((await getState('b'.repeat(32))).indexes,[]);
});
test('session traversal fails closed',async()=>{
 await assert.rejects(getState('../outside-session'),/Invalid server session/);
});
test('interrupted multistep preparation remains visible and resumes without replaying a payment',async()=>{
 const recoverySession='d'.repeat(32);let nextStep=false,interrupt=false,submits=0;
 setChainForTests({readiness:async()=>({ready:true}),snapshot:async()=>({}),
 prepare:async()=>{if(interrupt)throw new Error('temporary RPC failure');return {transaction:'AA==',step:nextStep?1:0,description:'setup'};},
 submit:async()=>{submits++;nextStep=true;interrupt=true;return {complete:false,signature,nextStep:1};}});
 await dispatch({action:'create',config:DEFAULT_CONFIG,wallet:owner,requestId:'recover_setup'},recoverySession);
 await assert.rejects(dispatch({action:'submit',operationId:'recover_setup',signedTransaction:'AA=='},recoverySession),/temporary RPC/);
 const reloaded=await getState(recoverySession);assert.equal(reloaded.pending.requiresPreparation,true);assert.equal(reloaded.pending.transaction,undefined);
 interrupt=false;const resumed=await dispatch({action:'resume',operationId:'recover_setup'},recoverySession);
 assert.equal(resumed.pending.step,1);assert.equal(submits,1);
});
test.after(async()=>{await rm(directory,{recursive:true,force:true});});
