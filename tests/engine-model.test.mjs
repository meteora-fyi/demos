import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CONFIG, validateConfig, allocate, raw, payoutAllocations, weightedBalances, freshAssets, digest} from '../lib/model.mjs';

test('configuration rejects ambiguous baskets and oversubscribed revenue', () => {
 assert.throws(() => validateConfig({...DEFAULT_CONFIG,weights:[{assetId:'btc',weight:50},{assetId:'btc',weight:50}]}),/unique/);
 assert.throws(() => validateConfig({...DEFAULT_CONFIG,basketAllocation:80}),/total 100/);
 assert.throws(() => validateConfig({...DEFAULT_CONFIG,partnerLocked:0,creatorLocked:0,creatorLiquidity:80}),/At least 10/);
 assert.throws(() => validateConfig({...DEFAULT_CONFIG,feeBps:0}),/Opening fee/);
 assert.throws(() => validateConfig({...DEFAULT_CONFIG,privateKey:'secret'}),/Unsupported/);
});
test('published policy normalizes input without mutating draft', () => {
 const draft = structuredClone(DEFAULT_CONFIG); draft.symbol = 'xyz'; draft.endingFeeBps = 25;
 const result=validateConfig(draft);
 assert.equal(result.symbol,'XYZ'); assert.equal(result.endingFeeBps,100); assert.equal(draft.endingFeeBps,25);
 assert.equal(digest(result),digest(validateConfig(draft)));
});
test('allocation conserves every raw unit including integer dust', () => {
 for (const budget of [0n,1n,3n,101n,999999999999999n]) {
  const split=allocate(budget,DEFAULT_CONFIG);
  assert.equal(Object.values(split).reduce((a,b)=>a+BigInt(b),0n),budget);
 }
 const split=allocate(400000n,DEFAULT_CONFIG);
 assert.deepEqual(split,{basket:'200000',rebate:'100000',buyback:'0',retained:'100000'});
});
test('amount parsing never rounds silently or accepts scientific notation', () => {
 assert.equal(raw('123.000000001'),123000000001n);
 for(const amount of ['-1','NaN','1e9','1.0000000001','Infinity',' 1']) assert.throws(()=>raw(amount));
});
test('holder weights integrate time instead of paying last-second arrivals', () => {
 const events=[{time:0,balances:{'investor-1':'100','investor-2':'0'}},{time:9,balances:{'investor-1':'100','investor-2':'100'}}];
 const weights=weightedBalances(events,0,10);
 assert.equal(weights['investor-1'],1000n); assert.equal(weights['investor-2'],100n);
 assert.deepEqual(payoutAllocations(110n,weights),[{wallet:'investor-1',amountRaw:'100'},{wallet:'investor-2',amountRaw:'10'}]);
 assert.deepEqual(payoutAllocations(110n,weightedBalances(events,0,10,{'investor-2':10})),[{wallet:'investor-1',amountRaw:'110'}]);
});
test('rounding residue is retained rather than overpaying recipients', () => {
 const allocations=payoutAllocations(1n,{'investor-1':1n,'investor-2':1n}); assert.deepEqual(allocations,[]);
});
test('stale or missing price blocks treasury execution', () => {
 assert.throws(()=>freshAssets({},['btc'],40000),/stale/);
 assert.throws(()=>freshAssets({btc:{updatedAt:0}},['btc'],40000),/stale/);
 assert.throws(()=>freshAssets({btc:{updatedAt:40000,stale:true}},['btc'],40000),/stale/);
 assert.doesNotThrow(()=>freshAssets({btc:{updatedAt:39999}},['btc'],40000));
});

test('metadata name respects the onchain UTF-8 byte bound',()=>{assert.throws(()=>validateConfig({...DEFAULT_CONFIG,name:'界'.repeat(11)}),/32 UTF-8/);assert.equal(validateConfig({...DEFAULT_CONFIG,name:'界'.repeat(10)}).name,'界'.repeat(10));});
