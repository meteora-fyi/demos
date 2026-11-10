import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CONFIG, validateConfig} from '../lib/model.mjs';

test('transfer-fee models validate rate, cadence and exact token minimums',()=>{
  const base=validateConfig({...DEFAULT_CONFIG});
  assert.equal(base.transferFeeMode,'off');assert.equal(base.transferFeeBps,0);
  assert.equal(validateConfig({...DEFAULT_CONFIG,transferFeeMode:'rewards',transferFeeBps:100}).transferFeeBps,100);
  for(const patch of [{transferFeeMode:'burn',transferFeeBps:0},{transferFeeMode:'burn',transferFeeBps:1001},{transferFeeMode:'rewards',transferFeeBps:100,transferFeeInterval:1},{transferFeeMode:'rewards',transferFeeBps:100,transferFeeMinAmount:0.0000001}])assert.throws(()=>validateConfig({...DEFAULT_CONFIG,...patch}));
});
