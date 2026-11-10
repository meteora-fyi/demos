import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {PublicKey,Keypair,Transaction,ComputeBudgetProgram} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID,getMint,unpackAccount,getTransferFeeAmount,getTransferFeeConfig,getEpochFee,calculateFee,getAccountLenForMint,getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,createHarvestWithheldTokensToMintInstruction,createWithdrawWithheldTokensFromMintInstruction,createTransferCheckedInstruction,createBurnCheckedInstruction} from '@solana/spl-token';
import {automationContext,DEVNET_GENESIS,rawAmount,transferFeesEnabled} from './chain.mjs';
import {withPublicIndexLock} from './public-indexes.mjs';
const ctx=automationContext(),connection=ctx.connection,directory=path.join(path.dirname(ctx.root),'transfer-fees');
const MAX_ACCOUNTS=250,MAX_HOLDERS=100,HARVEST_BATCH=20,PAYOUT_BATCH=4;
const key=v=>new PublicKey(v),amount=v=>BigInt(v||0);
function safe(id){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,180}$/.test(id))throw new Error('Invalid index');return id;}
const target=id=>path.join(directory,`${safe(id)}.json`);
async function read(id){try{return JSON.parse(await readFile(target(id),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return {version:1,collectedRaw:'0',distributedRaw:'0',distributedGrossRaw:'0',burnedRaw:'0',receipts:[],nextRunAt:0};}}
async function save(id,value){await mkdir(directory,{recursive:true,mode:0o700});const tmp=`${target(id)}.${randomUUID()}.tmp`;await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,target(id));}
const fundingCache=new Map();
async function funding(authority,force=false){const found=fundingCache.get(authority);if(!force&&found&&Date.now()-found.at<30000)return found.raw;const raw=await connection.getBalance(key(authority),'confirmed');fundingCache.set(authority,{at:Date.now(),raw});return raw;}
export async function transferFeeStatus(index){
  const manifest=await ctx.load(safe(index));if(!manifest?.automation||!transferFeesEnabled(manifest.config))return {enabled:false,mode:'off',authority:null,fundingBalance:0,collectedRaw:'0',distributedRaw:'0',burnedRaw:'0',nextRunAt:null,receipts:[]};
  const state=await read(index);let gas=Number(state.fundingRaw||0);try{gas=await funding(manifest.automation.authority);}catch{}
  return {enabled:Boolean(manifest.automation.enabled),mode:manifest.config.transferFeeMode,authority:manifest.automation.authority,fundingBalance:gas/1e9,collectedRaw:state.collectedRaw,distributedRaw:state.distributedRaw,distributedGrossRaw:state.distributedGrossRaw,burnedRaw:state.burnedRaw,nextRunAt:state.nextRunAt||null,lastError:state.lastError||null,phase:state.cycle?.phase||'waiting',snapshotSlot:state.cycle?.snapshotSlot||state.lastSnapshotSlot||null,receipts:state.receipts.map(r=>({signature:r.signature,action:r.action,message:r.message,createdAt:r.createdAt}))};
}
export function holderSnapshot(records,{creator,authority,maxAccounts=MAX_ACCOUNTS,maxHolders=MAX_HOLDERS}={}){
  if(records.length>maxAccounts)throw new Error(`Holder scan exceeds ${maxAccounts} token accounts; no partial payout is allowed.`);
  const owners=new Map(),sources=[];let withheld=0n;
  for(const record of records){const account=record.account,owner=account.owner.toBase58();const fee=getTransferFeeAmount(account)?.withheldAmount||0n;if(fee>0n){sources.push(record.pubkey.toBase58());withheld+=fee;}
    if(account.amount===0n||owner===creator||owner===authority||!PublicKey.isOnCurve(account.owner.toBytes()))continue;
    if(account.isFrozen)throw new Error('A holder account is frozen; payout snapshot requires review.');owners.set(owner,(owners.get(owner)||0n)+account.amount);
  }
  if(owners.size>maxHolders)throw new Error(`Holder scan exceeds ${maxHolders} eligible wallets; no partial payout is allowed.`);
  return {sources,withheldRaw:String(withheld),holders:[...owners].sort(([a],[b])=>a.localeCompare(b)).map(([wallet,balance])=>({wallet,balanceRaw:String(balance)}))};
}
export function rewardAllocations(budget,holders,fee){
  const total=holders.reduce((sum,h)=>sum+amount(h.balanceRaw),0n);if(!total)return [];
  return holders.map(h=>{const gross=amount(budget)*amount(h.balanceRaw)/total;const charge=calculateFee(fee,gross);return {wallet:h.wallet,amountRaw:String(gross),expectedNetRaw:String(gross-charge)};}).filter(a=>amount(a.expectedNetRaw)>0n);
}
async function mintContext(manifest){
  const mint=await getMint(connection,key(manifest.addresses.mint),'confirmed',TOKEN_2022_PROGRAM_ID),config=getTransferFeeConfig(mint);
  if(!config?.withdrawWithheldAuthority?.equals(key(manifest.automation.authority)))throw new Error('This worker is not the mint’s withheld-fee withdrawal authority.');
  const epoch=(await connection.getEpochInfo()).epoch,fee=getEpochFee(config,BigInt(epoch));if(fee.transferFeeBasisPoints!==manifest.config.transferFeeBps)throw new Error('Live transfer fee differs from the signed launch policy.');
  return {mint,config,fee,epoch};
}
async function scan(manifest,mintInfo){
  const response=await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID,{commitment:'confirmed',withContext:true,filters:[{memcmp:{offset:0,bytes:manifest.addresses.mint}}]});
  if(!response?.context||!Array.isArray(response.value))throw new Error('Holder RPC did not return a complete contextual account scan.');
  if(response.value.length>MAX_ACCOUNTS)throw new Error(`Holder scan exceeds ${MAX_ACCOUNTS} accounts; no partial scan is accepted.`);
  const records=response.value.map(r=>({pubkey:r.pubkey,account:unpackAccount(r.pubkey,r.account,TOKEN_2022_PROGRAM_ID)}));
  for(const r of records)if(!r.account.mint.equals(mintInfo.mint.address))throw new Error('Holder scan returned another mint.');
  return {...holderSnapshot(records,{creator:manifest.wallet,authority:manifest.automation.authority}),slot:response.context.slot};
}
async function createCycle(manifest,state){
  const info=await mintContext(manifest),snapshot=await scan(manifest,info);const vault=getAssociatedTokenAddressSync(info.mint.address,key(manifest.automation.authority),false,TOKEN_2022_PROGRAM_ID);
  const vaultInfo=await connection.getAccountInfo(vault),vaultRaw=vaultInfo?unpackAccount(vault,vaultInfo,TOKEN_2022_PROGRAM_ID).amount:0n;
  const unspent=amount(state.collectedRaw)-amount(state.distributedGrossRaw)-amount(state.burnedRaw);if(unspent>vaultRaw)throw new Error('Fee-vault balance is below its confirmed accounting balance.');
  const available=amount(snapshot.withheldRaw)+info.config.withheldAmount+unspent;
  if(available<rawAmount(manifest.config.transferFeeMinAmount,6)){state.lastError=null;state.nextRunAt=Date.now()+manifest.config.transferFeeInterval*1000;return false;}
  if(manifest.config.transferFeeMode==='rewards'&&!snapshot.holders.length){state.lastError='No eligible on-chain holders yet. Creator, worker and pool authorities are excluded.';state.nextRunAt=Date.now()+manifest.config.transferFeeInterval*1000;return false;}
  const batches=[];for(let i=0;i<snapshot.sources.length;i+=HARVEST_BATCH)batches.push(snapshot.sources.slice(i,i+HARVEST_BATCH));if(!batches.length&&(info.config.withheldAmount>0n||!vaultInfo))batches.push([]);
  state.cycle={id:randomUUID(),snapshotSlot:snapshot.slot,startedAt:Date.now(),phase:batches.length?'collect':'distribute',batches,cursor:0,holders:snapshot.holders,vault:vault.toBase58(),mint:manifest.addresses.mint,mode:manifest.config.transferFeeMode};state.lastError=null;state.nextRunAt=Date.now();return true;
}
async function nextTransaction(manifest,state){
  const cycle=state.cycle,owner=key(manifest.automation.authority),mint=key(manifest.addresses.mint),vault=key(cycle.vault),tx=new Transaction();let details={kind:cycle.phase},requiredRent=0;
  const info=await mintContext(manifest),rent=await connection.getMinimumBalanceForRentExemption(getAccountLenForMint(info.mint));
  if(cycle.phase==='collect'){
    if(!await connection.getAccountInfo(vault))requiredRent+=rent;
    tx.add(createAssociatedTokenAccountIdempotentInstruction(owner,vault,owner,mint,TOKEN_2022_PROGRAM_ID));const sources=cycle.batches[cycle.cursor].map(key);
    if(sources.length)tx.add(createHarvestWithheldTokensToMintInstruction(mint,sources,TOKEN_2022_PROGRAM_ID));
    tx.add(createWithdrawWithheldTokensFromMintInstruction(mint,vault,owner,[],TOKEN_2022_PROGRAM_ID));details.action='harvest';
  }else{
    if(!cycle.allocations){const account=await connection.getAccountInfo(vault);const balance=account?unpackAccount(vault,account,TOKEN_2022_PROGRAM_ID).amount:0n;const budget=amount(state.collectedRaw)-amount(state.distributedGrossRaw)-amount(state.burnedRaw);if(budget<0n||budget>balance)throw new Error('Fee-vault accounting requires reconciliation.');
      if(budget===0n){finishCycle(manifest,state);return null;}
      cycle.budgetRaw=String(budget);cycle.allocations=cycle.mode==='burn'?[{amountRaw:String(budget)}]:rewardAllocations(budget,cycle.holders,info.fee);cycle.cursor=0;await save(manifest.id,state);
      if(!cycle.allocations.length){state.lastError='Rewards round to zero after transfer fees; retained for a later cycle.';finishCycle(manifest,state);return null;}
    }
    if(cycle.mode==='burn'){details.action='burn';details.amountRaw=cycle.budgetRaw;tx.add(createBurnCheckedInstruction(vault,mint,owner,amount(cycle.budgetRaw),6,[],TOKEN_2022_PROGRAM_ID));}
    else{details.action='rewards';details.allocations=cycle.allocations.slice(cycle.cursor,cycle.cursor+PAYOUT_BATCH).map(a=>({...a,address:getAssociatedTokenAddressSync(mint,key(a.wallet),false,TOKEN_2022_PROGRAM_ID).toBase58()}));
      const accounts=await connection.getMultipleAccountsInfo(details.allocations.map(a=>key(a.address)));details.allocations.forEach((a,i)=>{if(!accounts[i])requiredRent+=rent;tx.add(createAssociatedTokenAccountIdempotentInstruction(owner,key(a.address),key(a.wallet),mint,TOKEN_2022_PROGRAM_ID),createTransferCheckedInstruction(vault,mint,key(a.address),owner,amount(a.amountRaw),6,[],TOKEN_2022_PROGRAM_ID));});
    }
  }
  const gas=await funding(manifest.automation.authority,true);state.fundingRaw=String(gas);if(gas<requiredRent+100000)throw new Error('Worker gas is low. Top up this index’s automation wallet before the next cycle.');
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({units:300000}));const latest=await connection.getLatestBlockhash('confirmed');tx.feePayer=owner;tx.recentBlockhash=latest.blockhash;
  // Fresh chain identity and policy check immediately precede every autonomous signature.
  if(await connection.getGenesisHash()!==DEVNET_GENESIS)throw new Error('Autonomous signing is restricted to Solana devnet.');
  const current=await ctx.load(manifest.id);if(!current?.automation?.enabled)throw new Error('Automation was paused before signing.');
  const signer=Keypair.fromSecretKey(Uint8Array.from(manifest.automation.secret));if(!signer.publicKey.equals(owner))throw new Error('Worker identity does not match launch policy');tx.sign(signer);
  state.pending={...latest,signature:ctx.base58(tx.signature),transaction:tx.serialize().toString('base64'),message:tx.serializeMessage().toString('base64'),details,createdAt:Date.now()};await save(manifest.id,state);return state.pending;
}
function finishCycle(manifest,state){state.lastSnapshotSlot=state.cycle?.snapshotSlot;state.cycle=null;state.nextRunAt=Date.now()+manifest.config.transferFeeInterval*1000;}
async function settle(manifest,state){
  const pending=state.pending;let status=(await connection.getSignatureStatuses([pending.signature],{searchTransactionHistory:true})).value[0];
  if(status?.err){state.lastError=`Worker transaction failed: ${JSON.stringify(status.err)}`;state.blockedRevision=manifest.automation.revision||0;state.failedSignature=pending.signature;state.pending=null;await save(manifest.id,state);return false;}
  if(!status){if(await connection.getBlockHeight('confirmed')>pending.lastValidBlockHeight){state.expiredSignatures=[...(state.expiredSignatures||[]),pending.signature].slice(-20);state.pending=null;await save(manifest.id,state);return false;}
    if(!(await ctx.load(manifest.id))?.automation?.enabled)return false;
    await connection.sendRawTransaction(Buffer.from(pending.transaction,'base64'),{skipPreflight:false,maxRetries:2});status=(await connection.getSignatureStatuses([pending.signature],{searchTransactionHistory:true})).value[0];}
  if(!['confirmed','finalized'].includes(status?.confirmationStatus))return false;
  const receipt=await connection.getTransaction(pending.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});if(!receipt)return false;
  if(receipt.meta?.err)throw new Error('Confirmed worker transaction failed');if(receipt.transaction.message.serialize().toString('base64')!==pending.message)throw new Error('Worker transaction message does not match its durable journal');
  const change=ctx.tokenDelta(receipt,state.cycle.vault),details=pending.details;
  if(details.action==='harvest'){if(change<0n)throw new Error('Fee collection reduced the fee vault');state.collectedRaw=String(amount(state.collectedRaw)+change);state.cycle.cursor++;if(state.cycle.cursor>=state.cycle.batches.length){state.cycle.phase='distribute';state.cycle.cursor=0;}}
  else if(details.action==='burn'){if(change!==-amount(details.amountRaw))throw new Error('Burn did not reconcile with fee-vault balance');state.burnedRaw=String(amount(state.burnedRaw)-change);finishCycle(manifest,state);}
  else{const gross=details.allocations.reduce((sum,a)=>sum+amount(a.amountRaw),0n);if(change!==-gross)throw new Error('Payout did not reconcile with fee-vault balance');const net=details.allocations.reduce((sum,a)=>sum+ctx.tokenDelta(receipt,a.address),0n);if(net<0n||net>gross)throw new Error('Net recipient balances did not reconcile');state.distributedRaw=String(amount(state.distributedRaw)+net);state.distributedGrossRaw=String(amount(state.distributedGrossRaw)+gross);state.cycle.cursor+=details.allocations.length;if(state.cycle.cursor>=state.cycle.allocations.length)finishCycle(manifest,state);}
  state.receipts.unshift({signature:pending.signature,action:details.action,createdAt:Date.now(),message:details.action==='rewards'?'Index-token rewards paid; recipients received amounts after transfer fees':details.action==='burn'?'Collected transfer-fee tokens burned':'Withheld transfer fees collected'});state.receipts=state.receipts.slice(0,100);state.pending=null;state.lastError=null;await save(manifest.id,state);return true;
}
async function tickIndex(id){
  const manifest=await ctx.load(id);if(!manifest?.automation||!transferFeesEnabled(manifest.config))return;
  const state=await read(id),enabled=Boolean(manifest.automation.enabled);if(!enabled&&!state.pending)return;
  if(state.blockedRevision!==undefined&&state.blockedRevision===(manifest.automation.revision||0))return;
  if(state.blockedRevision!==undefined)delete state.blockedRevision;
  try{
    await ctx.requireReady();
    if(state.pending){await settle(manifest,state);return {indexId:id,pending:Boolean(state.pending)};}
    if(!enabled||Date.now()<(state.nextRunAt||0))return;
    if(!Object.values(manifest.operations).some(o=>o.action==='create'&&o.complete))return;
    if(!state.cycle&&!await createCycle(manifest,state)){await save(id,state);return;}
    const pending=await nextTransaction(manifest,state);if(!pending){await save(id,state);return;}
    await settle(manifest,state);return {indexId:id,signature:pending.signature,pending:Boolean(state.pending)};
  }catch(error){state.lastError=String(error.message||error).replace(/https?:\/\/[^\s]+/g,'[RPC endpoint]');state.nextRunAt=Date.now()+Math.max(30000,manifest.config.transferFeeInterval*1000);await save(id,state);return {indexId:id,error:state.lastError};}
}
let running=false;
export async function runTransferFeeTick(){
  if(running)return {running:true,results:[]};running=true;
  try{let names;try{names=await readdir(ctx.root);}catch(e){if(e.code==='ENOENT')return {results:[]};throw e;}const results=[];
    for(const name of names.filter(n=>/^[a-zA-Z0-9_-]+\.json$/.test(n))){const id=name.slice(0,-5),manifest=await ctx.load(id);if(!manifest?.automation)continue;const suffix=id.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0]||id.slice(-100);const result=await withPublicIndexLock(suffix,()=>tickIndex(id));if(result)results.push(result);}
    return {results};
  }finally{running=false;}
}
