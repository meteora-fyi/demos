import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Keypair} from '@solana/web3.js';
import {ASSETS,DEFAULT_CONFIG,validateConfig} from '../lib/model.mjs';

process.env.NODE_ENV='test';
const directory=await mkdtemp(path.join(os.tmpdir(),'custom-assets-'));
process.env.DEMO_DATA_DIR=directory;
const {dispatch,getState,setChainForTests,setCatalogForTests}=await import('../lib/engine.mjs');
const {readSession,writeSession}=await import('../lib/store.mjs');
const owner=Keypair.generate().publicKey.toBase58();
const sources=Array.from({length:11},()=>Keypair.generate().publicKey.toBase58());
const entries=sources.map(sourceMint=>({id:`jup_${sourceMint}`,sourceMint,sourceDecimals:9,symbol:'SAME',name:'A Jupiter token',source:'jupiter',color:'#123abc',price:1000}));
const metadata=new Map(entries.map(asset=>[asset.id,asset]));
setCatalogForTests(async id=>metadata.get(id));
let captured;
setChainForTests({readiness:async()=>({ready:true,network:'devnet'}),previewConfig:config=>({threshold:1,config}),prepare:async(action,args)=>{captured=args;return {transaction:'AA==',description:action,step:0};}});

test('old default basket works while custom tokens require server registration',()=>{
 assert.deepEqual(validateConfig(DEFAULT_CONFIG),DEFAULT_CONFIG);
 const weights=[{assetId:entries[0].id,weight:50},{assetId:'sol',weight:50}];
 assert.throws(()=>validateConfig({...DEFAULT_CONFIG,weights}),/supported/);
 assert.equal(validateConfig({...DEFAULT_CONFIG,weights},[...ASSETS,entries[0]]).weights[0].assetId,entries[0].id);
 assert.throws(()=>validateConfig({...DEFAULT_CONFIG,weights:[weights[0],weights[0]]},entries),/unique/);
 assert.throws(()=>validateConfig({...DEFAULT_CONFIG,weights:[{assetId:entries[0].id,weight:50},{assetId:'alias',weight:50}]},[entries[0],{...entries[0],id:'alias'}]),/unique/);
});

test('basket supports ten identities even with colliding display symbols, rejects eleven',()=>{
 const weights=entries.slice(0,10).map(asset=>({assetId:asset.id,weight:10}));
 assert.equal(validateConfig({...DEFAULT_CONFIG,weights},entries).weights.length,10);
 assert.throws(()=>validateConfig({...DEFAULT_CONFIG,weights:[...weights,{assetId:entries[10].id,weight:1}]},entries),/two and ten/);
});

test('adding a Jupiter asset trusts catalog identity, not client metadata or prices',async()=>{
 const session='custom_assets_session_1';
 const state=await dispatch({action:'add-asset',assetId:entries[0].id,sourceMint:sources[1],price:10,name:'Spoof'},session);
 const asset=state.assets.find(a=>a.id===entries[0].id);
 assert.equal(asset.sourceMint,sources[0]);assert.equal(asset.name,'A Jupiter token');assert.equal(asset.price,0.01);
 assert.equal(asset.sourceDecimals,9);
 const again=await dispatch({action:'add-asset',assetId:entries[0].id},session);
 assert.equal(again.assets.length,4);
 assert.equal((await getState(session)).assets.length,4);
 const second=await dispatch({action:'add-asset',assetId:entries[1].id},session);
 assert.equal(second.assets.filter(a=>a.symbol==='SAME').length,2);
});

test('unknown ids, path keys and invalid catalog source identity fail closed',async()=>{
 const session='custom_assets_session_2';
 await assert.rejects(dispatch({action:'add-asset',assetId:'__proto__'},session),/Select a token/);
 await assert.rejects(dispatch({action:'add-asset',assetId:'jup_'+Keypair.generate().publicKey.toBase58()},session),/not available/);
 metadata.set(entries[2].id,{...entries[2],sourceMint:sources[3]});
 await assert.rejects(dispatch({action:'add-asset',assetId:entries[2].id},session),/not available/);
 metadata.set(entries[2].id,{...entries[2],name:'bad\nname'});
 await assert.rejects(dispatch({action:'add-asset',assetId:entries[2].id},session),/not available/);
 assert.equal((await readSession(session)).indexes.length,0);
});

test('launch snapshots source metadata and config preview accepts only registered ids',async()=>{
 const session='custom_assets_session_1';
 const config={...DEFAULT_CONFIG,weights:[{assetId:entries[0].id,weight:50},{assetId:entries[1].id,weight:50}]};
 assert.equal((await dispatch({action:'preview',config},session)).preview.config.weights.length,2);
 await assert.rejects(dispatch({action:'preview',config},'another_custom_session'),/supported/);
 await dispatch({action:'create',config,wallet:owner,requestId:'custom_launch_01',assets:{[entries[0].id]:{sourceMint:sources[5]}}},session);
 assert.equal(captured.assets[entries[0].id].sourceMint,sources[0]);
 assert.equal(captured.assets[entries[0].id].price,0.01);
 const persisted=await readSession(session);
 assert.equal(persisted.indexes[0].assetMetadata[entries[1].id].sourceMint,sources[1]);
 assert.equal(persisted.indexes[0].config.assetMetadata,undefined);
});

test('full sessions retain existing assets but refuse further catalog imports',async()=>{
 const session='custom_asset_limit_session';
 await getState(session);
 const saved=await readSession(session);
 saved.assets={};
 for(let i=0;i<50;i++){
  const sourceMint=Keypair.generate().publicKey.toBase58();
  const asset={...entries[0],id:`jup_${sourceMint}`,sourceMint,price:0.01};
  saved.assets[asset.id]=asset;
 }
 await writeSession(session,saved);
 const existing=Object.keys(saved.assets)[0];
 assert.equal((await dispatch({action:'add-asset',assetId:existing},session)).assets.length,50);
 await assert.rejects(dispatch({action:'add-asset',assetId:entries[0].id},session),/fifty/);
 assert.equal(Object.keys((await readSession(session)).assets).length,50);
});

test.after(async()=>rm(directory,{recursive:true,force:true}));
