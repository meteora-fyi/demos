import {Connection,Keypair,Transaction} from '@solana/web3.js';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {DEFAULT_CONFIG} from '../lib/model.mjs';
import {getReadiness,prepare,submit,snapshot,quote} from '../lib/chain.mjs';
const rpc=process.env.SOLANA_RPC_URL||'https://solana-devnet.api.onfinality.io/public';
const connection=new Connection(rpc,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:async(...args)=>{await new Promise(r=>setTimeout(r,1800));return fetch(...args);}});
const ready=await getReadiness();console.log({ready:ready.ready,message:ready.message});if(!ready.ready)process.exit(1);
await mkdir('.demo',{recursive:true,mode:0o700});const keyfile='.demo/integration-devnet-key.json';let key;
try{key=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(keyfile,'utf8'))));}catch(e){if(e.code!=='ENOENT')throw e;key=Keypair.generate();await writeFile(keyfile,JSON.stringify(Array.from(key.secretKey)),{mode:0o600});}
const wallet=key.publicKey.toBase58();console.log({testWallet:wallet,balance:await connection.getBalance(key.publicKey)});
if(process.argv.includes('--airdrop')){try{const sig=await connection.requestAirdrop(key.publicKey,2e9);console.log({airdrop:sig});}catch(e){console.log({airdropError:e.message.slice(0,160)});}}
const id='devnet_integration_'+wallet.slice(0,12),requestId='creation_integration_v1';const config={...DEFAULT_CONFIG,seedAmount:0.002};
await new Promise(r=>setTimeout(r,1800));
let pending=await prepare('create',{index:id,config,wallet,requestId});
console.log({step:pending.step,description:pending.description,bytes:Buffer.from(pending.transaction||'','base64').length});
if(!process.argv.includes('--execute')){console.log('Prepared only. Pass --execute to use this fresh devnet test wallet.');process.exit(0);}
while(!pending.complete){const tx=Transaction.from(Buffer.from(pending.transaction,'base64'));tx.partialSign(key);const result=await submit({operation:{index:id,requestId},signedTransaction:tx.serialize().toString('base64')});console.log({confirmed:result.signature,complete:result.complete});if(result.complete)break;pending=await prepare('create',{index:id,config,wallet,requestId});}
console.log(await snapshot(id,{wallet}));console.log(await quote(id,{side:'buy',amount:'0.01'}));
async function execute(action,args={}){
  const requestId=`integration_${action}_${Date.now()}`;let pending=await prepare(action,{index:id,config,wallet,requestId,...args});
  while(!pending.complete){const tx=Transaction.from(Buffer.from(pending.transaction,'base64'));tx.partialSign(key);const result=await submit({operation:{index:id,requestId},signedTransaction:tx.serialize().toString('base64')});console.log({action,signature:result.signature,effects:result.effects});if(result.complete)return result;pending=await prepare(action,{index:id,config,wallet,requestId,...args});}return pending;
}
await execute('trade',{side:'buy',amount:'0.02',slippageBps:100});
await execute('trade',{side:'sell',amount:'10',slippageBps:100});
const collected=await execute('collect');
const budget=2000000n+BigInt(collected.effects.creatorRaw)/2n;
await execute('invest',{budgetRaw:String(budget),orders:config.weights.map(w=>({assetId:w.assetId,side:'buy',amountRaw:String(budget*BigInt(w.weight)/100n),price:0.01}))});
const buyback=BigInt(collected.effects.creatorRaw)/4n;
if(buyback>0n){await execute('buyback',{budgetRaw:String(buyback),slippageBps:100});await execute('burn');}
if(process.argv.includes('--graduate')){
  const live=await snapshot(id,{wallet});const needed=Math.max(0,live.market.threshold-live.market.quoteReserve)*1.02;
  if(needed>0)await execute('trade',{side:'buy',amount:needed.toFixed(9),slippageBps:200});
  await execute('migrate');await execute('trade',{side:'buy',amount:'0.001',slippageBps:100});await execute('collect');
}
console.log({finished:true,index:id,state:await snapshot(id,{wallet})});
