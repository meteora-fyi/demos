import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Keypair, Transaction, SystemProgram } from '@solana/web3.js';
process.env.NODE_ENV='test';
const directory=await mkdtemp(path.join(os.tmpdir(),'public-indexes-'));
process.env.DEMO_DATA_DIR=directory;
const {dispatch,getState,setChainForTests,bootstrapPublicDirectory}=await import('../lib/engine.mjs');
const {DEFAULT_CONFIG}=await import('../lib/model.mjs');
const {readSession,writeSession}=await import('../lib/store.mjs');
const {verifyPreparedTransaction}=await import('../lib/chain.mjs');
const owner=Keypair.generate(),buyer=Keypair.generate(),other=Keypair.generate();
const ownerSession='public_owner_session_123',buyerSession='public_buyer_session_123',otherSession='public_other_session_123';
const operations=new Map();
let indexId,snapshots=0,preparing=0,maxPreparing=0,sequence=0,snapshotFailure=false;
const addresses={pool:Keypair.generate().publicKey.toBase58(),mint:Keypair.generate().publicKey.toBase58(),config:Keypair.generate().publicKey.toBase58()};
setChainForTests({
  readiness:async()=>({ready:true,network:'devnet'}),
  snapshot:async(_id,{wallets=[]}={})=>{
    snapshots++;
    if(snapshotFailure)throw new Error('private_owner_refresh_trace');
    return {addresses,market:{status:'trading',price:0.01,supply:1000000},treasury:{cashRaw:'0',holdings:[]},holders:wallets.map(id=>({id,balanceRaw:'1000000',balance:1}))};
  },
  prepare:async(action,args)=>{
    preparing++;maxPreparing=Math.max(maxPreparing,preparing);
    try {
      await new Promise(resolve=>setTimeout(resolve,5));
      let item=operations.get(args.requestId);
      if(!item){
        const tx=new Transaction({feePayer:new (owner.publicKey.constructor)(args.wallet),recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(SystemProgram.transfer({fromPubkey:new (owner.publicKey.constructor)(args.wallet),toPubkey:owner.publicKey,lamports:0}));
        item={action,args,message:tx.serializeMessage().toString('base64'),transaction:tx.serialize({requireAllSignatures:false}).toString('base64'),signature:`confirmed_${++sequence}`};operations.set(args.requestId,item);
      }
      return {transaction:item.transaction,indexId:args.index,requestId:args.requestId,description:action,step:0};
    }finally{preparing--;}
  },
  submit:async({operation,signedTransaction})=>{
    const item=operations.get(operation.requestId);
    verifyPreparedTransaction(item,signedTransaction);
    return {complete:true,signature:item.signature,effects:item.action==='trade'?{quoteAmountRaw:'250000000',baseAmountRaw:'1000000'}:{addresses}};
  },
  quote:async()=>({amountOut:1}),
});
function signed(pending,wallet){const tx=Transaction.from(Buffer.from(pending.transaction,'base64'));tx.sign(wallet);return tx.serialize().toString('base64');}

test('only completed demo launches appear across sessions, without pending or private identifiers',async()=>{
  const draft=await dispatch({action:'create',config:DEFAULT_CONFIG,wallet:owner.publicKey.toBase58(),requestId:'launch_public_1'},ownerSession);
  indexId=draft.indexes[0].id;
  assert.deepEqual((await getState(buyerSession)).exploreIndexes,[]);
  await dispatch({action:'submit',operationId:'launch_public_1',signedTransaction:signed(draft.pending,owner)},ownerSession);
  const before=snapshots,guest=await getState(buyerSession);
  assert.equal(snapshots,before,'directory listing must not refresh other pools');
  assert.equal(guest.exploreIndexes.length,1);
  assert.deepEqual(guest.indexes,[]);assert.equal(guest.pending,null);
  const listing=guest.exploreIndexes[0];assert.equal(listing.canManage,false);
  for(const privateText of [ownerSession,'chainId','operations','signedTransaction','baseSecret'])assert.equal(JSON.stringify(listing).includes(privateText),false);
  assert.ok(guest.launchpad.name);assert.deepEqual(guest.defaults,DEFAULT_CONFIG);
});

test('guest open refreshes one selected index and owner address spoof cannot manage it',async()=>{
  const before=snapshots,opened=await dispatch({action:'open-index',indexId},buyerSession);
  assert.equal(snapshots-before,1);assert.equal(opened.indexes[0].canManage,false);
  assert.equal(JSON.stringify(opened).includes(ownerSession),false);
  for(const action of ['collect','invest','rebalance','rebate','buyback','burn','migrate','automation','fund-automation']){
    await assert.rejects(dispatch({action,indexId,wallet:owner.publicKey.toBase58(),enabled:true,amount:'0.02',requestId:`forbidden_${action}`},buyerSession),/creator wallet/);
  }
  await assert.rejects(dispatch({action:'scenario',indexId,wallet:owner.publicKey.toBase58(),assetId:'btc',price:2},buyerSession),/creator/);
  assert.equal((await getState(ownerSession)).indexes[0].canManage,true);
});

test('visitor trades serialize by index, namespace request ids, and keep operations private',async()=>{
  await dispatch({action:'open-index',indexId},otherSession);
  maxPreparing=0;
  const [first,second]=await Promise.all([
    dispatch({action:'trade',indexId,wallet:buyer.publicKey.toBase58(),requestId:'shared_trade_id',side:'buy',amount:'0.25'},buyerSession),
    dispatch({action:'trade',indexId,wallet:other.publicKey.toBase58(),requestId:'shared_trade_id',side:'buy',amount:'0.25'},otherSession),
  ]);
  assert.equal(maxPreparing,1);
  assert.notEqual(first.pending.requestId,second.pending.requestId);
  assert.equal(first.pending.wallet,buyer.publicKey.toBase58());
  assert.equal(second.pending.wallet,other.publicKey.toBase58());
  const changed=Transaction.from(Buffer.from(first.pending.transaction,'base64'));
  changed.instructions[0].keys[1].pubkey=other.publicKey;changed.sign(buyer);
  await assert.rejects(dispatch({action:'submit',operationId:'shared_trade_id',signedTransaction:changed.serialize().toString('base64')},buyerSession),/differs/);
  await assert.rejects(dispatch({action:'submit',operationId:'shared_trade_id',signedTransaction:signed(first.pending,buyer)},ownerSession),/not found/);
  const original=await readSession(buyerSession),pending=structuredClone(original.operations.shared_trade_id);
  await dispatch({action:'submit',operationId:'shared_trade_id',signedTransaction:signed(first.pending,buyer)},buyerSession);
  let canonical=await readSession(ownerSession);
  assert.equal(canonical.indexes[0].ledger.volume,'250000000');
  assert.ok(canonical.indexes[0].registeredWallets.includes(buyer.publicKey.toBase58()));
  assert.ok(canonical.indexes[0].holderEvents.at(-1).balances[buyer.publicKey.toBase58()]);
  assert.equal(canonical.indexes[0].ledger.basketBudget,'0');
  // Simulate a crash after the canonical write but before the visitor journal completes.
  const recovery=await readSession(buyerSession);recovery.operations.shared_trade_id=pending;await writeSession(buyerSession,recovery);
  await dispatch({action:'submit',operationId:'shared_trade_id',signedTransaction:signed(first.pending,buyer)},buyerSession);
  canonical=await readSession(ownerSession);assert.equal(canonical.indexes[0].ledger.volume,'250000000');
  await dispatch({action:'submit',operationId:'shared_trade_id',signedTransaction:signed(second.pending,other)},otherSession);
  canonical=await readSession(ownerSession);assert.equal(canonical.indexes[0].ledger.volume,'500000000');
  const fresh=await getState('fresh_public_session_123');assert.equal(fresh.exploreIndexes[0].market.volume,0.5);assert.equal(fresh.pending,null);
  assert.equal((await dispatch({action:'quote',indexId,wallet:buyer.publicKey.toBase58(),side:'buy',amount:'0.1'},buyerSession)).quote.amountOut,1);
});

test('bounded background bootstrap backfills older confirmed sessions without RPC calls',async()=>{
  await unlink(path.join(directory,'public-indexes',`${indexId}.json`));
  const stored=await readSession(ownerSession);delete stored.indexes[0].publicListed;await writeSession(ownerSession,stored);
  const before=snapshots;
  let last;
  do{last=await bootstrapPublicDirectory({limit:1});assert.ok(last.processed<=1);}while(!last.done);
  assert.equal(snapshots,before);
  const result=await getState('backfill_reader_session');
  assert.equal(result.exploreIndexes.length,1);
});

test('external detail strips private failed owner receipts and raw refresh errors',async()=>{
  const canonical=await readSession(ownerSession);
  canonical.indexes[0].receipts.unshift({id:'private-owner-operation-id',action:'collect',status:'failed',signature:null,message:'private_owner_failure_trace',createdAt:Date.now()});
  await writeSession(ownerSession,canonical);
  let opened;
  snapshotFailure=true;
  try{opened=await dispatch({action:'open-index',indexId},buyerSession);}finally{snapshotFailure=false;}
  const external=opened.indexes.find(i=>i.id===indexId);
  assert.equal(external.canManage,false);
  assert.equal(external.receipts.some(r=>r.status==='failed'),false);
  assert.match(external.syncError,/last confirmed snapshot/);
  for(const privateText of ['private-owner-operation-id','private_owner_failure_trace','private_owner_refresh_trace'])assert.equal(JSON.stringify(external).includes(privateText),false);
  const refreshed=(await getState(buyerSession)).indexes.find(i=>i.id===indexId);
  assert.equal(JSON.stringify(refreshed).includes('private_owner'),false);
  assert.equal((await readSession(ownerSession)).indexes[0].receipts[0].message,'private_owner_failure_trace');
});

test('two owners can concurrently confirm trades in each other’s public index without deadlock',{timeout:3000},async()=>{
  const firstSession='reciprocal_owner_session_a',secondSession='reciprocal_owner_session_b';
  async function launch(session,wallet){
    const draft=await dispatch({action:'create',config:DEFAULT_CONFIG,wallet:wallet.publicKey.toBase58(),requestId:'reciprocal_launch'},session);
    const id=draft.indexes[0].id;
    await dispatch({action:'submit',operationId:'reciprocal_launch',signedTransaction:signed(draft.pending,wallet)},session);
    return id;
  }
  const firstId=await launch(firstSession,owner),secondId=await launch(secondSession,buyer);
  await dispatch({action:'open-index',indexId:secondId},firstSession);
  await dispatch({action:'open-index',indexId:firstId},secondSession);
  const [firstTrade,secondTrade]=await Promise.all([
    dispatch({action:'trade',indexId:secondId,wallet:owner.publicKey.toBase58(),requestId:'reciprocal_trade',side:'buy',amount:'0.25'},firstSession),
    dispatch({action:'trade',indexId:firstId,wallet:buyer.publicKey.toBase58(),requestId:'reciprocal_trade',side:'buy',amount:'0.25'},secondSession),
  ]);
  await Promise.all([
    dispatch({action:'submit',operationId:'reciprocal_trade',signedTransaction:signed(firstTrade.pending,owner)},firstSession),
    dispatch({action:'submit',operationId:'reciprocal_trade',signedTransaction:signed(secondTrade.pending,buyer)},secondSession),
  ]);
  const first=await readSession(firstSession),second=await readSession(secondSession);
  assert.equal(first.indexes.find(i=>i.id===firstId).ledger.volume,'250000000');
  assert.equal(second.indexes.find(i=>i.id===secondId).ledger.volume,'250000000');
  assert.equal(first.operations.reciprocal_trade.status,'complete');
  assert.equal(second.operations.reciprocal_trade.status,'complete');
});
test.after(()=>rm(directory,{recursive:true,force:true}));
