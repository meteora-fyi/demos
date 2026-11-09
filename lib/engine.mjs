import { randomUUID } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { ASSETS, DEFAULT_CONFIG, InputError, validateConfig, raw, display, decimal, digest, allocate, weightedBalances, payoutAllocations } from './model.mjs';
import { exclusive, readSession, writeSession } from './store.mjs';

export { InputError } from './model.mjs';
const mutating = new Set(['create','trade','collect','invest','rebalance','rebate','buyback','burn','migrate']);
const ownerOnly = new Set(['collect','invest','rebalance','rebate','buyback','burn','migrate']);
const zeroLedger = () => ({collected:'0',platform:'0',basketBudget:'0',rebateBudget:'0',buybackBudget:'0',retained:'0',rebatesPaid:'0',buybackSpent:'0',burned:'0',basketSpent:'0',volume:'0'});
let adapter, catalogReader;
async function chain() { return adapter || import('./chain.mjs'); }
// Explicit dependency injection for arithmetic/journal tests; never selected by an HTTP request.
export function setChainForTests(value) { if (process.env.NODE_ENV !== 'test') throw new Error('Test adapter is unavailable.'); adapter = value; }
export function setCatalogForTests(value) { if (process.env.NODE_ENV !== 'test') throw new Error('Test catalog is unavailable.'); catalogReader = value; }
async function catalogAsset(id) { return catalogReader ? catalogReader(id) : (await import('./token-catalog.mjs')).getCatalogAsset(id); }
function safeJson(value) { return JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v)); }
function safeError(error) { return String(error?.message || 'Operation failed.').replace(/https?:\/\/[^\s]+/g,'[RPC endpoint]'); }
function publicKey(value) { try { return new PublicKey(value).toBase58(); } catch { throw new InputError('Connect a valid Solana wallet.'); } }
function requestId(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw new InputError('A valid request ID is required.'); return value; }
function amount(value, decimals = 9) { const n = raw(value, 'amount', decimals); if (n <= 0n) throw new InputError('Amount must be greater than zero.'); return n; }
function add(ledger,key,value) { ledger[key] = String(BigInt(ledger[key] || '0') + BigInt(value || '0')); }
function subtract(ledger,key,value) { const n=BigInt(value || '0'); if(n<0n || n>BigInt(ledger[key])) throw new Error(`Confirmed ${key} amount exceeds its recorded budget. Reconciliation is required.`); ledger[key]=String(BigInt(ledger[key])-n); }

async function session(id) {
  let s=await readSession(id);
  if (!s) { s={version:1,sessionId:id,createdAt:Date.now(),indexes:[],operations:{},assets:Object.fromEntries(ASSETS.map(a=>[a.id,{...a,updatedAt:Date.now(),stale:false}]))}; await writeSession(id,s); }
  return s;
}
function indexFor(s,id) { const i=s.indexes.find(i=>i.id===id); if(!i) throw new InputError('Index not found in this session.'); return i; }
function record(index,operation,status,signature,message) {
  const existing=index.receipts.find(r=>r.id===`${operation.id}:${signature || status}`);
  if(existing) return;
  index.receipts.unshift({id:`${operation.id}:${signature || status}`,action:operation.action,status,signature:signature || null,message,createdAt:Date.now()});
  index.receipts=index.receipts.slice(0,150);
}
function holderCheckpoint(index, snapshot, now=Date.now()) {
  const holders=snapshot.holders || [];
  const balances=Object.fromEntries(holders.map(h=>[h.id || h.address, h.balanceRaw ?? String(Math.round((h.balance || 0)*1e6))]).filter(([id])=>id));
  if(!Object.keys(balances).length) return;
  for(const id of Object.keys(balances)) {
    if(!index.eligibleAfter[id]) {
      const interval=index.config.rebateInterval*1000;
      index.eligibleAfter[id]=index.createdAt+(Math.floor((now-index.createdAt)/interval)+1)*interval;
    }
  }
  const last=index.holderEvents.at(-1);
  if(!last || JSON.stringify(last.balances)!==JSON.stringify(balances)) index.holderEvents.push({time:now,balances});
}
async function sync(index,wallet,s) {
  if(index.status==='draft' && !index.snapshot) return;
  try {
    const next=safeJson(await (await chain()).snapshot(index.chainId,{wallet, wallets:index.registeredWallets}));
    if(next) {
      index.snapshot=next;
      index.status=next.status || next.market?.status || index.status;
      index.addresses={...index.addresses,...next.addresses};
      index.syncError=null; index.updatedAt=Date.now();
      holderCheckpoint(index,next);
      const last=index.history.at(-1), price=next.market?.price ?? 0;
      const treasuryValue=display(index.ledger.basketBudget)+(next.treasury?.holdings || []).reduce((sum,h)=>sum+(h.quantity ?? display(h.quantityRaw || '0',6))*(s.assets[h.assetId]?.price || 0),0);
      if(!last || last.price!==price || last.treasuryValue!==treasuryValue || Date.now()-last.time>30000) index.history.push({time:Date.now(),price,treasuryValue});
      index.history=index.history.slice(-500);
    }
  } catch(error) { index.syncError=safeError(error); }
}
function view(index,s) {
  const snapshot=index.snapshot || {}, market=snapshot.market || {};
  const rawHoldings=snapshot.treasury?.holdings || [];
  const holdings=index.config.weights.map(w=>{
    const held=rawHoldings.find(h=>h.assetId===w.assetId);
    const quantity=held?.quantity ?? (held?.quantityRaw ? display(held.quantityRaw,6) : 0);
    const price=s.assets[w.assetId].price;
    return {...s.assets[w.assetId],assetId:w.assetId,quantity,price,value:quantity*price,target:w.weight};
  });
  const cash=display(index.ledger.basketBudget);
  const value=holdings.reduce((sum,h)=>sum+h.value,0)+cash;
  for(const h of holdings) h.weight=value>0?h.value/value*100:0;
  const ledger=Object.fromEntries(Object.entries(index.ledger).map(([key,val])=>[key,display(val,key==='burned'?6:9)]));
  const accrued=display(market.accruedCreatorRaw || snapshot.accruedCreatorRaw || '0');
  const now=Date.now(),interval=index.config.rebateInterval*1000;
  const dueAt=index.lastRebateEnd+interval;
  const supply=market.supply ?? (market.supplyRaw?display(market.supplyRaw,6):index.config.totalSupply);
  return {
    id:index.id,name:index.config.name,symbol:index.config.symbol,owner:index.owner,config:index.config,createdAt:index.createdAt,updatedAt:index.updatedAt,status:index.status,
    addresses:index.addresses,assetMints:snapshot.assetMints || [],policyDigest:index.policyDigest,
    market:{...market,price:market.price || 0,volume:ledger.volume,quoteReserve:market.quoteReserve || 0,threshold:market.threshold || 0,progress:market.progress ?? (market.threshold?Math.min(100,(market.quoteReserve||0)/market.threshold*100):0),supply},
    treasury:{value,cash,holdings,valuePerToken:supply?value/supply:null,valuationStatus:holdings.some(h=>h.stale)?'stale':'fixture'},
    earnings:{...ledger,accrued},holders:snapshot.holders || [],history:index.history,
    receipts:index.receipts,syncError:index.syncError || null,
    rebate:{dueAt,due:now>=dueAt,interval:index.config.rebateInterval,eligibility:'Registered wallets, observed time-weighted balances',status:now>=dueAt?'Awaiting wallet signature':'Accruing'},
  };
}
async function readiness() {
  try { const a=await chain(); const r=safeJson(await (a.readiness || a.getReadiness)()); return {ready:Boolean(r.ready),network:r.network || 'devnet',message:r.message ? safeError({message:r.message}) : 'Connected to Solana devnet.',programs:r.programs}; }
  catch(error) {return {ready:false,network:'devnet',message:safeError(error)};}
}
async function state(s,wallet,{refresh=true}={}) {
  const ready=await readiness();
  if(refresh && ready.ready) for(const index of s.indexes) await sync(index,wallet,s);
  const indexes=s.indexes.map(index=>view(index,s));
  return {sessionId:s.sessionId,mode:'devnet',quoteSymbol:'SOL',quoteDecimals:9,readiness:ready,assets:Object.values(s.assets),defaults:structuredClone(DEFAULT_CONFIG),indexes,pending:Object.values(s.operations).find(o=>['awaiting-signature','preparing'].includes(o.status))?pendingView(Object.values(s.operations).find(o=>['awaiting-signature','preparing'].includes(o.status))):null,wallets:wallet?[{id:wallet,label:'Connected wallet',address:wallet}]:[],worker:{status:'wallet-signatures-required',message:'Due operations wait for the owner’s wallet signature.'}};
}
export async function getState(sessionId,wallet) {
  return exclusive(sessionId,async()=>{const s=await session(sessionId); const result=await state(s,wallet?publicKey(wallet):undefined);await writeSession(sessionId,s);return result;});
}
function pendingView(op) { return {operationId:op.id,...(op.status==='awaiting-signature'?op.pending:{}),requiresPreparation:op.status==='preparing',wallet:op.wallet,action:op.action,indexId:op.indexId}; }
async function prepareOperation(s,op,index) {
  const a=await chain();
  const prepared=safeJson(await a.prepare(op.action,{index:index.chainId,id:index.chainId,config:index.config,assets:index.assetMetadata || Object.fromEntries(index.config.weights.map(w=>[w.assetId,s.assets[w.assetId]])),wallet:op.wallet,requestId:op.id,...op.args}));
  if(prepared.complete && prepared.signature && prepared.effects) {
    applyEffects(index,op,prepared.effects);op.status='complete';op.completedAt=Date.now();op.pending=null;
    if(!op.signatures.includes(prepared.signature))op.signatures.push(prepared.signature);
    record(index,op,'confirmed',prepared.signature,'Recovered confirmed operation.');
    if(!index.registeredWallets.includes(op.wallet))index.registeredWallets.push(op.wallet);
    await sync(index,op.wallet,s);await writeSession(s.sessionId,s);
    return {...await state(s,op.wallet,{refresh:false}),notice:'Recovered the confirmed operation.'};
  }
  if(!prepared.transaction) throw new Error('The chain adapter did not produce a signable transaction.');
  op.pending=prepared;op.status='awaiting-signature';op.updatedAt=Date.now();
  await writeSession(s.sessionId,s);
  return {...await state(s,op.wallet,{refresh:false}),pending:pendingView(op)};
}
function applyEffects(index,op,effects={}) {
  for(const key of ['seedRaw','creatorRaw','platformRaw','spentRaw','receivedRaw','paidRaw','acquiredRaw','burnedRaw','quoteAmountRaw','baseAmountRaw']) {
    if(effects[key]!==undefined && !/^\d+$/.test(String(effects[key])))throw new Error('Confirmed operation returned an invalid balance delta. Reconciliation is required.');
  }
  const ledger=index.ledger;
  if(op.action==='create') {
    index.status='trading'; index.addresses={...index.addresses,...effects.addresses};
    // Seed funds must have an independently confirmed transfer in the chain result.
    if(effects.seedRaw) add(ledger,'basketBudget',effects.seedRaw);
  }
  if(op.action==='trade') add(ledger,'volume',effects.quoteAmountRaw);
  if(op.action==='collect') {
    add(ledger,'collected',effects.creatorRaw); add(ledger,'platform',effects.platformRaw);
    const shares=allocate(effects.creatorRaw || '0',index.config);
    add(ledger,'basketBudget',shares.basket);add(ledger,'rebateBudget',shares.rebate);add(ledger,'buybackBudget',shares.buyback);add(ledger,'retained',shares.retained);
  }
  if(op.action==='invest') {subtract(ledger,'basketBudget',effects.spentRaw);add(ledger,'basketSpent',effects.spentRaw);}
  if(op.action==='rebalance') {
    if(effects.receivedRaw) add(ledger,'basketBudget',effects.receivedRaw);
    if(effects.spentRaw) subtract(ledger,'basketBudget',effects.spentRaw);
  }
  if(op.action==='rebate') {subtract(ledger,'rebateBudget',effects.paidRaw);add(ledger,'rebatesPaid',effects.paidRaw);index.lastRebateEnd=op.args.cycleEnd;}
  if(op.action==='buyback') {subtract(ledger,'buybackBudget',effects.spentRaw);add(ledger,'buybackSpent',effects.spentRaw);}
  if(op.action==='burn') add(ledger,'burned',effects.burnedRaw);
  if(op.action==='migrate') index.status='migrated';
}
function trustedArgs(action,body,index,s,wallet) {
  if(['invest','rebalance','rebate','buyback'].includes(action)) {
    if(index.syncError || index.snapshot?.treasury?.cashRaw===undefined)throw new InputError('Refresh the confirmed treasury balance before spending.');
    const committed=['basketBudget','rebateBudget','buybackBudget','retained'].reduce((sum,key)=>sum+BigInt(index.ledger[key]),0n);
    if(BigInt(index.snapshot.treasury.cashRaw)<committed)throw new InputError('The live earnings account is below its recorded allocations. Restore the withdrawn funds before spending.');
  }
  if(action==='trade') {
    if(!['buy','sell'].includes(body.side))throw new InputError('Choose buy or sell.');
    const units=amount(body.amount,body.side==='buy'?9:6);
    if(body.side==='buy' && units>raw('10'))throw new InputError('The workshop limits one buy to 10 devnet SOL.');
    return {side:body.side,amount:decimal(units,body.side==='buy'?9:6),slippageBps:index.config.slippageBps};
  }
  if(action==='invest') {
    const budget=BigInt(index.ledger.basketBudget);
    if(budget<raw(index.config.minPurchase))throw new InputError('Collected basket budget is below the purchase minimum.');
    const selected=index.config.weights.map(w=>s.assets[w.assetId]);
    if(selected.some(a=>a.stale))throw new InputError('A basket price is marked stale. Refresh it before investing.');
    const orders=index.config.weights.map(w=>({assetId:w.assetId,side:'buy',amountRaw:String(budget*BigInt(w.weight)/100n),price:s.assets[w.assetId].price}));
    return {budgetRaw:String(budget),orders,prices:Object.fromEntries(selected.map(a=>[a.id,a.price])),slippageBps:index.config.slippageBps};
  }
  if(action==='rebalance') {
    const current=view(index,s).treasury;
    if(!current.value)throw new InputError('Fund the basket before rebalancing.');
    if(current.holdings.some(h=>h.stale))throw new InputError('A basket price is marked stale. Refresh it before rebalancing.');
    if(current.holdings.every(h=>Math.abs(h.weight-h.target)<index.config.rebalanceThreshold))throw new InputError('The basket is within the configured rebalance threshold.');
    const values=Object.fromEntries((index.snapshot.treasury.holdings || []).map(h=>[h.assetId,BigInt(h.quantityRaw)*raw(s.assets[h.assetId].price)/1000000n]));
    const total=BigInt(index.ledger.basketBudget)+Object.values(values).reduce((sum,n)=>sum+n,0n);
    const orders=current.holdings.map(h=>{const target=total*BigInt(h.target)/100n,currentRaw=values[h.assetId] || 0n,diff=target-currentRaw;return {assetId:h.assetId,side:diff>=0n?'buy':'sell',amountRaw:String(diff>=0n?diff:-diff),price:h.price};}).filter(o=>BigInt(o.amountRaw)>0n);
    return {orders,budgetRaw:index.ledger.basketBudget,prices:Object.fromEntries(current.holdings.map(h=>[h.assetId,h.price])),slippageBps:index.config.slippageBps};
  }
  if(action==='rebate') {
    const budget=BigInt(index.ledger.rebateBudget),interval=index.config.rebateInterval*1000;
    const end=index.createdAt+Math.floor((Date.now()-index.createdAt)/interval)*interval;
    if(end<=index.lastRebateEnd)throw new InputError('The next rebate interval is not due yet.');
    if(budget<raw(index.config.minRebate))throw new InputError('Collected rebate budget is below the payout minimum.');
    const weights=weightedBalances(index.holderEvents,index.lastRebateEnd,end,index.eligibleAfter);
    delete weights[index.owner]; // The operating creator is not an eligible public holder.
    const allocations=payoutAllocations(budget,weights);
    if(!allocations.length)throw new InputError('No registered holder was eligible during this interval.');
    return {allocations,budgetRaw:String(allocations.reduce((sum,a)=>sum+BigInt(a.amountRaw),0n)),cycleStart:index.lastRebateEnd,cycleEnd:end};
  }
  if(action==='buyback') {
    const budget=BigInt(index.ledger.buybackBudget);if(!budget)throw new InputError('No collected revenue is allocated to buybacks.');
    return {budgetRaw:String(budget),amount:decimal(budget),slippageBps:index.config.slippageBps};
  }
  if(action==='burn') return {};
  if(action==='collect' || action==='migrate')return {};
  return {};
}
export async function dispatch(body,sessionId) {
  if(!body || typeof body!=='object' || Array.isArray(body))throw new InputError('JSON action required.');
  return exclusive(sessionId,async()=>{
    const s=await session(sessionId),action=body.action;
    if(action==='status')return state(s,body.wallet?publicKey(body.wallet):undefined);
    if(action==='add-asset') {
      const id=body.assetId;
      if(typeof id!=='string'||!/^jup_[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id))throw new InputError('Select a token from Jupiter search.');
      if(s.assets[id])return state(s,undefined,{refresh:false});
      if(Object.keys(s.assets).length>=50)throw new InputError('This session supports up to fifty available assets.');
      const found=await catalogAsset(id);
      let sourceMint;try{sourceMint=new PublicKey(found?.sourceMint).toBase58();}catch{}
      if(!found||found.id!==id||found.source!=='jupiter'||id!==`jup_${sourceMint}`||
        typeof found.symbol!=='string'||!found.symbol.trim()||found.symbol.length>32||
        typeof found.name!=='string'||!found.name.trim()||found.name.length>100||
        /[\u0000-\u001f\u007f]/.test(found.symbol+found.name)||
        !Number.isInteger(found.sourceDecimals)||found.sourceDecimals<0||found.sourceDecimals>18||
        !/^#[0-9a-f]{6}$/i.test(found.color || ''))throw new InputError('This token is not available in the search catalog. Search again.');
      s.assets[id]={id,source:'jupiter',sourceMint,sourceDecimals:found.sourceDecimals,symbol:found.symbol,name:found.name,color:found.color,price:0.01,updatedAt:Date.now(),stale:false,isVerified:found.isVerified===true};
      await writeSession(sessionId,s);
      return state(s,undefined,{refresh:false});
    }

    if(action==='resume') {
      const op=s.operations[body.operationId];if(!op)throw new InputError('Operation not found in this session.');
      if(op.status==='complete')return {...await state(s,op.wallet),notice:'This operation was already completed.'};
      return prepareOperation(s,op,indexFor(s,op.indexId));
    }
    if(action==='preview') {
      const config=validateConfig(body.config,s.assets); const a=await chain();
      return {...await state(s,undefined,{refresh:false}),preview:safeJson(a.previewConfig(config))};
    }
    if(action==='quote') {
      const index=indexFor(s,body.indexId),wallet=publicKey(body.wallet);
      if(!['buy','sell'].includes(body.side))throw new InputError('Choose buy or sell.');
      const units=amount(body.amount,body.side==='buy'?9:6);
      const quote=safeJson(await (await chain()).quote(index.chainId,{wallet,side:body.side,amount:decimal(units,body.side==='buy'?9:6),slippageBps:index.config.slippageBps}));
      return {...await state(s,wallet,{refresh:false}),quote};
    }
    if(action==='scenario') {
      const index=indexFor(s,body.indexId);if(publicKey(body.wallet)!==index.owner)throw new InputError('Only the index creator can set this session’s fixture prices.');
      const asset=s.assets[body.assetId];if(!asset)throw new InputError('Unknown constituent.');
      if(body.price!==undefined){const n=Number(body.price);if(!Number.isFinite(n)||n<0.000001||n>10)throw new InputError('Fixture price must be from 0.000001 to 10 SOL.');asset.price=n;}
      asset.stale=Boolean(body.stale);asset.updatedAt=Date.now();await writeSession(sessionId,s);return state(s,index.owner,{refresh:false});
    }
    if(action==='confirm' || action==='submit') {
      const op=s.operations[body.operationId];if(!op)throw new InputError('Operation not found in this session.');
      const index=indexFor(s,op.indexId);
      if(op.status==='complete')return {...await state(s,op.wallet),notice:'This operation was already confirmed.'};
      if(action==='confirm' && (typeof body.signature!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(body.signature)))throw new InputError('A valid transaction signature is required.');
      if(action==='submit' && (typeof body.signedTransaction!=='string'||body.signedTransaction.length>4000||!/^[A-Za-z0-9+/=]+$/.test(body.signedTransaction)))throw new InputError('A signed transaction is required.');
      const a=await chain();
      const operation={...op.pending,index:index.chainId,indexId:index.chainId,id:index.chainId,requestId:op.id};
      const result=safeJson(action==='submit' ? await a.submit({operation,signedTransaction:body.signedTransaction}) : await a.confirm({operation,signature:body.signature}));
      const signature=result.signature || body.signature;
      if(!signature)throw new Error('No confirmed transaction signature was returned.');
      if(!op.signatures.includes(signature))op.signatures.push(signature);
      record(index,op,'confirmed',signature,op.pending.description || `${op.action} confirmed`);
      if(result.complete===false){op.status='preparing';await writeSession(sessionId,s);return prepareOperation(s,op,index);}
      if(!result.complete)throw new Error('Confirmation did not establish a completed operation.');
      applyEffects(index,op,result.effects);op.status='complete';op.completedAt=Date.now();op.pending=null;
      if(!index.registeredWallets.includes(op.wallet))index.registeredWallets.push(op.wallet);
      if(result.snapshot){index.snapshot=result.snapshot;holderCheckpoint(index,result.snapshot);}
      await sync(index,op.wallet,s);await writeSession(sessionId,s);
      return {...await state(s,op.wallet,{refresh:false}),notice:`${op.action[0].toUpperCase()+op.action.slice(1)} confirmed.`};
    }
    if(!mutating.has(action))throw new InputError('Unsupported action.');
    const id=requestId(body.requestId),wallet=publicKey(body.wallet);
    let op=s.operations[id],index;
    if(op) {
      if(op.action!==action||op.wallet!==wallet||(body.indexId&&body.indexId!==op.indexId))throw new InputError('A request ID cannot be reused for another operation.');
      index=indexFor(s,op.indexId);
      if(action==='create' && body.config && digest(validateConfig(body.config,s.assets))!==index.policyDigest)throw new InputError('This launch request already belongs to a different configuration.');
      if(op.status==='complete')return {...await state(s,wallet),notice:'This operation was already completed.'};
      return prepareOperation(s,op,index);
    }
    if(Object.values(s.operations).some(o=>!['complete','failed'].includes(o.status)))throw new InputError('Finish the pending wallet operation before starting another.');
    if(Object.keys(s.operations).length>=500)throw new InputError('This workshop session reached its operation limit.');
    if(action==='create') {
      if(s.indexes.length>=5)throw new InputError('This session supports up to five indexes.');
      const config=validateConfig(body.config,s.assets),indexId=randomUUID();
      index={id:indexId,chainId:`${sessionId}_${indexId}`,owner:wallet,config,assetMetadata:Object.fromEntries(config.weights.map(w=>[w.assetId,structuredClone(s.assets[w.assetId])])),policyDigest:digest(config),createdAt:Date.now(),updatedAt:Date.now(),status:'draft',addresses:{},ledger:zeroLedger(),registeredWallets:[],holderEvents:[],eligibleAfter:{},lastRebateEnd:Date.now(),history:[],receipts:[]};
      s.indexes.push(index);
    } else {
      index=indexFor(s,body.indexId);
      if(ownerOnly.has(action)&&wallet!==index.owner)throw new InputError('Only the creator wallet can sign this operation.');
      if(index.status==='draft')throw new InputError('Complete the index launch first.');
      await sync(index,wallet,s);
    }
    const args=trustedArgs(action,body,index,s,wallet);
    op={id,action,indexId:index.id,wallet,args,createdAt:Date.now(),status:'preparing',signatures:[]};s.operations[id]=op;
    await writeSession(sessionId,s);
    try {return await prepareOperation(s,op,index);}catch(error){op.status='failed';op.error=safeError(error);record(index,op,'failed',null,safeError(error));await writeSession(sessionId,s);throw error;}
  });
}
// Cron reports due work; wallet custody means the worker cannot sign or spend.
export async function runWorker(sessionId) { return getState(sessionId); }
