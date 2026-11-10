import {Connection,Keypair,Transaction} from '@solana/web3.js';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {DEFAULT_CONFIG} from '../lib/model.mjs';
import {getReadiness,prepare,submit,snapshot,quote} from '../lib/chain.mjs';
const rpc=process.env.SOLANA_RPC_URL||'https://solana-devnet.api.onfinality.io/public';
const connection=new Connection(rpc,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:async(...args)=>{await new Promise(r=>setTimeout(r,Number(process.env.RPC_MIN_INTERVAL_MS||1800)));return fetch(...args);}});
const ready=await getReadiness();console.log({ready:ready.ready,message:ready.message});if(!ready.ready)process.exit(1);
await mkdir('.demo',{recursive:true,mode:0o700});const keyfile='.demo/integration-devnet-key.json';let key;
try{key=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(keyfile,'utf8'))));}catch(e){if(e.code!=='ENOENT')throw e;key=Keypair.generate();await writeFile(keyfile,JSON.stringify(Array.from(key.secretKey)),{mode:0o600});}
const wallet=key.publicKey.toBase58();console.log({testWallet:wallet,balance:await connection.getBalance(key.publicKey)});
if(process.argv.includes('--airdrop')){try{const sig=await connection.requestAirdrop(key.publicKey,2e9);console.log({airdrop:sig});}catch(e){console.log({airdropError:e.message.slice(0,160)});}}
const id='devnet_integration_'+wallet.slice(0,12),requestId='creation_integration_v1';const config={...DEFAULT_CONFIG,seedAmount:0.002};
await new Promise(r=>setTimeout(r,Number(process.env.RPC_MIN_INTERVAL_MS||1800)));
let pending=await prepare('create',{index:id,config,wallet,requestId});
console.log(pending.complete?{launch:'already confirmed',signature:pending.signature}:{step:pending.step,description:pending.description,bytes:Buffer.from(pending.transaction||'','base64').length});
if(!process.argv.includes('--execute')){console.log('Prepared only. Pass --execute to use this fresh devnet test wallet.');process.exit(0);}
while(!pending.complete){const tx=Transaction.from(Buffer.from(pending.transaction,'base64'));tx.partialSign(key);const result=await submit({operation:{index:id,requestId},signedTransaction:tx.serialize().toString('base64')});console.log({confirmed:result.signature,complete:result.complete});if(result.complete)break;pending=await prepare('create',{index:id,config,wallet,requestId});}
console.log({index:id,launch:'confirmed'});
async function execute(action,args={},label=action){
  const requestId=`integration_verified_${label}`;const saved=JSON.parse(await readFile(`${process.env.DEMO_DATA_DIR||'.demo'}/chain/${id}.json`,'utf8'));if(saved.operations[requestId]?.complete){console.log({action,resumed:true,signature:saved.operations[requestId].result.signature});return saved.operations[requestId].result;}args=saved.operations[requestId]?.args||args;let pending=await prepare(action,{index:id,config,wallet,requestId,...args});
  while(!pending.complete){const tx=Transaction.from(Buffer.from(pending.transaction,'base64'));tx.partialSign(key);const result=await submit({operation:{index:id,requestId},signedTransaction:tx.serialize().toString('base64')});console.log({action,signature:result.signature,effects:result.effects});if(result.complete)return result;pending=await prepare(action,{index:id,config,wallet,requestId,...args});}return pending;
}
await execute('trade',{side:'buy',amount:'0.02',slippageBps:100},'initial_buy');
await execute('trade',{side:'sell',amount:'10',slippageBps:100},'initial_sell');
const collected=await execute('collect');
const budget=2000000n+BigInt(collected.effects.creatorRaw)/2n;
await execute('invest',{budgetRaw:String(budget),orders:config.weights.map(w=>({assetId:w.assetId,side:'buy',amountRaw:String(budget*BigInt(w.weight)/100n),price:0.01}))});
const buyback=BigInt(collected.effects.creatorRaw)/4n;
if(buyback>0n){await execute('buyback',{budgetRaw:String(buyback),slippageBps:100});await execute('burn');}

if(process.argv.includes('--extras')){
  await execute('rebalance',{orders:[{assetId:'btc',side:'sell',amountRaw:'100000',price:0.01},{assetId:'eth',side:'buy',amountRaw:'100000',price:0.01}]},'rebalance');
  let holder;const holderFile='.demo/integration-holder-key.json';try{holder=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(holderFile,'utf8'))));}catch(e){if(e.code!=='ENOENT')throw e;holder=Keypair.generate();await writeFile(holderFile,JSON.stringify(Array.from(holder.secretKey)),{mode:0o600});}
  await execute('rebate',{allocations:[{wallet:holder.publicKey.toBase58(),amountRaw:'1000'}]},'rebate');
}
if(process.argv.includes('--graduate')){
  const live=await snapshot(id,{wallet});const needed=Math.max(0,live.market.threshold-live.market.quoteReserve)*1.02;
  if(needed>0)await execute('trade',{side:'buy',amount:needed.toFixed(9),slippageBps:200},'graduation_buy');
  await execute('migrate');await execute('trade',{side:'buy',amount:'0.001',slippageBps:100},'damm_buy');await execute('collect',{},'damm_collect');
}
console.log({finished:true,index:id,state:await snapshot(id,{wallet})});
