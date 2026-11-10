import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import BN from 'bn.js';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram, TransactionInstruction } from '@solana/web3.js';
import {
  NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, MINT_SIZE, ACCOUNT_SIZE,
  createInitializeMint2Instruction, createMintToCheckedInstruction,
  createInitializeAccount3Instruction, createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
  createSyncNativeInstruction, createBurnCheckedInstruction, getMint, unpackAccount,
  createSetAuthorityInstruction, AuthorityType, getAccountLenForMint, getTransferFeeConfig, getEpochFee, calculateFee,
} from '@solana/spl-token';
import {
  DynamicBondingCurveClient, buildCurveWithMarketCap, ActivationType, BaseFeeMode,
  CollectFeeMode, MigrationFeeOption, MigrationOption, TokenAuthorityOption, TokenType,
  MigratedCollectFeeMode, DammV2DynamicFeeMode, DammV2BaseFeeMode,
  deriveDbcPoolAddress, deriveDbcPoolAuthority, deriveDbcEventAuthority,
  deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID, DAMM_V2_PROGRAM_ID, getPriceFromSqrtPrice,
  SwapMode, TransferFeeWithheldAuthority, MigratedTransferFeeAuthorityOption,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const QUOTE_DECIMALS = 9;
export const BASE_DECIMALS = 6;
const U64 = new BN('18446744073709551615');
const RPC = process.env.SOLANA_RPC_URL || process.env.RPC_URL || 'https://solana-devnet.api.onfinality.io/public';
let rpcQueue=Promise.resolve(),lastRpcAt=0;
const rpcGap=Number(process.env.RPC_MIN_INTERVAL_MS??(process.env.SOLANA_RPC_URL||process.env.RPC_URL?0:1500));
const rpcFetch=async(...args)=>{const task=rpcQueue.then(async()=>{const wait=Math.max(0,lastRpcAt+rpcGap-Date.now());if(wait)await new Promise(r=>setTimeout(r,wait));lastRpcAt=Date.now();const [url,options={}]=args;return fetch(url,{...options,signal:AbortSignal.timeout(20000)});});rpcQueue=task.then(()=>{},()=>{});return task;};
const connection = new Connection(RPC, { commitment: 'confirmed', disableRetryOnRateLimit: true,fetch:rpcFetch });
const client = new DynamicBondingCurveClient(connection, 'confirmed');
const root = path.resolve(process.env.DEMO_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)),'..','.demo'), 'chain');
const pk = (value) => new PublicKey(value);
const display = (value, decimals = QUOTE_DECIMALS) => Number(value?.toString() || 0) / 10 ** decimals;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const safe = (value) => { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(value)) throw new Error('Invalid operation identifier'); return value; };
const idOf = (index) => safe(typeof index === 'string' ? index : index.id);
const file = (id) => path.join(root, `${safe(id)}.json`);
async function load(id) { try { return JSON.parse(await readFile(file(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function save(id, value) { await mkdir(root, {recursive:true,mode:0o700}); const target=file(id); const tmp=target+'.tmp'; await writeFile(tmp,JSON.stringify(value),{mode:0o600}); await rename(tmp,target); }
export function rawAmount(value, decimals = QUOTE_DECIMALS) {
  const s=String(value); if(!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,9})?$/.test(s)) throw new Error('Enter a non-negative decimal amount');
  const [a,b='']=s.split('.'); if(b.length>decimals) throw new Error(`Use at most ${decimals} decimals`);
  return BigInt(a)*10n**BigInt(decimals)+BigInt(b.padEnd(decimals,'0'));
}
let readyCache;
export async function getReadiness() {
  if(readyCache && Date.now()-readyCache.at<(readyCache.value.ready?60000:15000)) return readyCache.value;
  try {
    const [genesis, infos]=await Promise.all([connection.getGenesisHash(),connection.getMultipleAccountsInfo([DYNAMIC_BONDING_CURVE_PROGRAM_ID,DAMM_V2_PROGRAM_ID,DAMM_V2_MIGRATION_FEE_ADDRESS[6]])]);
    if(genesis!==DEVNET_GENESIS) throw new Error('RPC is not Solana devnet. Mainnet execution is disabled.');
    if(!infos[0]?.executable || !infos[1]?.executable) throw new Error('The required Meteora programs are not executable on this RPC');
    if(!infos[2]?.owner.equals(DAMM_V2_PROGRAM_ID)) throw new Error('Meteora DAMM migration configuration is unavailable');
    const value={ready:true,cluster:'devnet',network:'devnet',genesis,quoteSymbol:'SOL',quoteDecimals:9,baseDecimals:6,dbc:DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(),damm:DAMM_V2_PROGRAM_ID.toBase58(),mode:'wallet',message:'Meteora DBC and DAMM v2 verified on Solana devnet.'};readyCache={at:Date.now(),value};return value;
  } catch(e) {const value={ready:false,cluster:'devnet',network:'devnet',message:e.message.replace(/https?:\/\/[^\s]+/g,'[RPC endpoint]')};readyCache={at:Date.now(),value};return value; }
}
export const readiness = getReadiness;
async function requireReady() { const result=await getReadiness();if(!result.ready)throw new Error(result.message); }
export function compileConfig(c) {
  const fixed=c.feeMode==='fixed',transfer=transferFeesEnabled(c);
  return buildCurveWithMarketCap({
    token:{tokenType:transfer?TokenType.Token2022:TokenType.SPLToken,tokenBaseDecimal:6,tokenQuoteDecimal:9,tokenAuthorityOption:TokenAuthorityOption.Immutable,totalTokenSupply:c.totalSupply,leftover:0},
    fee:{baseFeeParams:{baseFeeMode:c.feeMode==='exponential'?BaseFeeMode.FeeSchedulerExponential:BaseFeeMode.FeeSchedulerLinear,feeSchedulerParam:{startingFeeBps:c.feeBps,endingFeeBps:fixed?c.feeBps:c.endingFeeBps,numberOfPeriod:fixed?0:10,totalDuration:fixed?0:c.feeDuration}},dynamicFeeEnabled:Boolean(c.dynamicFees),collectFeeMode:CollectFeeMode.QuoteToken,creatorTradingFeePercentage:c.creatorShare,poolCreationFee:0,enableFirstSwapWithMinFee:false},
    migration:{migrationOption:MigrationOption.MET_DAMM_V2,migrationFeeOption:MigrationFeeOption.Customizable,migrationFee:{feePercentage:c.migrationCharge,creatorFeePercentage:c.migrationCharge?c.creatorShare:0},migratedPoolFee:{collectFeeMode:transfer?MigratedCollectFeeMode.Compounding:MigratedCollectFeeMode.QuoteToken,compoundingFeeBps:0,dynamicFee:DammV2DynamicFeeMode.Disabled,poolFeeBps:c.migrationFeeBps,baseFeeMode:DammV2BaseFeeMode.FeeTimeSchedulerLinear}},
    liquidityDistribution:{partnerLiquidityPercentage:c.partnerLiquidity,creatorLiquidityPercentage:c.creatorLiquidity,partnerPermanentLockedLiquidityPercentage:c.partnerLocked,creatorPermanentLockedLiquidityPercentage:c.creatorLocked},
    lockedVesting:{totalLockedVestingAmount:0,numberOfVestingPeriod:0,cliffUnlockAmount:0,totalVestingDuration:0,cliffDurationFromMigrationTime:0},activationType:ActivationType.Timestamp,
    initialMarketCap:c.initialMarketCap,migrationMarketCap:c.migrationMarketCap,
  });
}
export function previewConfig(c) { const compiled=compileConfig(c);return {threshold:display(compiled.migrationQuoteThreshold),startingPrice:getPriceFromSqrtPrice(compiled.sqrtStartPrice,6,9),resolved:decimalJson(compiled)}; }
async function seededAccount(owner,id,label,mint,program=TOKEN_PROGRAM_ID) {
  const seed=digest(`${id}:${label}`).slice(0,32);const address=await PublicKey.createWithSeed(owner,seed,program);
  return {address:address.toBase58(),seed,mint:mint.toBase58(),program:program.toBase58()};
}
// Every constituent receives a fresh devnet mint; sourceMint is display provenance only.
export async function createFixtureAsset(owner,id,assetId,metadata={}) {
  safe(assetId);const mint=Keypair.generate();
  const sourceMint=metadata.sourceMint?pk(metadata.sourceMint).toBase58():undefined;
  return {secret:Array.from(mint.secretKey),mint:mint.publicKey.toBase58(),reserve:await seededAccount(owner,id,`basket-${assetId}`,mint.publicKey),seller:getAssociatedTokenAddressSync(mint.publicKey,owner).toBase58(),symbol:metadata.symbol || assetId.toUpperCase(),name:metadata.name || `${assetId.toUpperCase()} fixture`,...(sourceMint?{sourceMint,sourceDecimals:metadata.sourceDecimals}:{}),decimals:6};
}
export function fixtureMintMapping(state) {
  return Object.entries(state.assets).map(([assetId,asset])=>({assetId,symbol:asset.symbol || assetId.toUpperCase(),name:asset.name || `${assetId.toUpperCase()} fixture`,mint:asset.mint,decimals:6,...(asset.sourceMint?{sourceMint:asset.sourceMint,sourceDecimals:asset.sourceDecimals}:{})}));
}
async function initialize(id,config,wallet,metadata={}) {
  let state=await load(id);if(state){if(state.wallet!==wallet)throw new Error('This index belongs to another wallet');return state;}
  const owner=pk(wallet),base=Keypair.generate(),conf=Keypair.generate();const transfer=transferFeesEnabled(config),operator=transfer?Keypair.generate():null;const baseProgram=transfer?TOKEN_2022_PROGRAM_ID:TOKEN_PROGRAM_ID;
  const assets={};for(const a of config.weights)assets[a.assetId]=await createFixtureAsset(owner,id,a.assetId,metadata[a.assetId]);
  state={id,wallet,config,baseSecret:Array.from(base.secretKey),configSecret:Array.from(conf.secretKey),assets,accounts:{creator:await seededAccount(owner,id,'creator',NATIVE_MINT),platform:await seededAccount(owner,id,'platform',NATIVE_MINT),market:await seededAccount(owner,id,'fixture-market',NATIVE_MINT),buyback:await seededAccount(owner,id,'buyback',base.publicKey,baseProgram)},addresses:{mint:base.publicKey.toBase58(),config:conf.publicKey.toBase58(),pool:deriveDbcPoolAddress(NATIVE_MINT,base.publicKey,conf.publicKey).toBase58(),quoteMint:NATIVE_MINT.toBase58(),owner:wallet,tokenProgram:baseProgram.toBase58()},...(operator?{automation:{authority:operator.publicKey.toBase58(),secret:Array.from(operator.secretKey),enabled:false,fundingLamports:'20000000'}}:{}),operations:{},createdAt:Date.now()};await save(id,state);return state;
}
async function accountInstructions(owner,info) {
  const address=pk(info.address);if(await connection.getAccountInfo(address))return [];
  const program=pk(info.program||TOKEN_PROGRAM_ID.toBase58());const size=program.equals(TOKEN_2022_PROGRAM_ID)?getAccountLenForMint(await getMint(connection,pk(info.mint),'confirmed',program)):ACCOUNT_SIZE;
  return [SystemProgram.createAccountWithSeed({fromPubkey:owner,basePubkey:owner,seed:info.seed,newAccountPubkey:address,lamports:await connection.getMinimumBalanceForRentExemption(size),space:size,programId:program}),createInitializeAccount3Instruction(address,pk(info.mint),owner,program)];
}
async function tokenBalance(address) {try{return (await connection.getTokenAccountBalance(pk(address),'confirmed')).value.amount;}catch(e){if(/could not find account|Invalid param: could not find|AccountNotFound/.test(e.message))return '0';throw e;}}
async function balances(state,wallet=state.wallet) {
  const ownBase=getAssociatedTokenAddressSync(pk(state.addresses.mint),pk(wallet),false,indexTokenProgram(state));
  const list=[ownBase,...Object.values(state.accounts).map(a=>pk(a.address)),...Object.values(state.assets).map(a=>pk(a.reserve.address))];
  const infos=await connection.getMultipleAccountsInfo(list);const vals=infos.map((info,i)=>info?unpackAccount(list[i],info,info.owner).amount.toString():'0');
  return {walletBase:vals[0],creator:vals[1],platform:vals[2],market:vals[3],buyback:vals[4],assets:Object.fromEntries(Object.keys(state.assets).map((id,i)=>[id,vals[5+i]]))};
}
async function poolState(state) { const v=await client.state.getPool(pk(state.addresses.pool)); if(!v)throw new Error('Index pool has not been confirmed');const p=v.poolState??v;const c=await client.state.getPoolConfig(pk(state.addresses.config));return {v,p,c}; }
export async function snapshot(index,{wallet,wallets=[]}={}) {
  const state=await load(idOf(index));if(!state)return null;wallet ||=state.wallet;
  if(!await connection.getAccountInfo(pk(state.addresses.pool)))return {addresses:state.addresses,assetMints:fixtureMintMapping(state),market:{status:'launching'},holders:[],treasury:{holdings:[],cashRaw:'0'},config:state.config};
  const [{p,c},b,mint]=await Promise.all([poolState(state),balances(state,wallet),getMint(connection,pk(state.addresses.mint),'confirmed',indexTokenProgram(state))]);
  const holderWallets=[...new Set([state.wallet,wallet,...wallets])];const holderAccounts=holderWallets.map(w=>getAssociatedTokenAddressSync(pk(state.addresses.mint),pk(w),false,indexTokenProgram(state)));const holderInfos=await connection.getMultipleAccountsInfo(holderAccounts);const holders=holderWallets.map((w,i)=>{const n=holderInfos[i]?unpackAccount(holderAccounts[i],holderInfos[i],indexTokenProgram(state)).amount:0n;return {id:w,wallet:w,balance:display(n,6),balanceRaw:String(n)};});
  const migrated=p.migrationProgress===3; let price=Number(getPriceFromSqrtPrice(p.sqrtPrice,6,9));
  let dammFees={creator:0n,platform:0n};if(migrated){const d=await dammContext(state);state.addresses.dammPool=d.address;price=Number(getPriceFromSqrtPrice(d.p.sqrtPrice,6,9));dammFees=await positionFees(state,d);}
  return {transferFees:await transferFeeStatus(state.id),assetMints:fixtureMintMapping(state),addresses:{...state.addresses,creatorEarnings:state.accounts.creator.address,platformEarnings:state.accounts.platform.address,treasury:state.accounts.creator.address},market:{price,quoteReserve:display(p.quoteReserve),quoteReserveRaw:p.quoteReserve.toString(),threshold:display(c.migrationQuoteThreshold),thresholdRaw:c.migrationQuoteThreshold.toString(),supply:display(mint.supply,6),supplyRaw:mint.supply.toString(),accruedCreatorRaw:String(BigInt(p.creatorQuoteFee.toString())+dammFees.creator),accruedPlatformRaw:String(BigInt(p.partnerQuoteFee.toString())+dammFees.platform),dbcAccruedCreatorRaw:p.creatorQuoteFee.toString(),dammAccruedCreatorRaw:String(dammFees.creator),status:migrated?'migrated':curveComplete(p,c)?'complete':'trading',migrationProgress:p.migrationProgress},holders,treasury:{holdings:Object.entries(b.assets).map(([assetId,quantityRaw])=>({assetId,quantityRaw,quantity:display(quantityRaw,6),mint:state.assets[assetId].mint,address:state.assets[assetId].reserve.address})),cashRaw:b.creator,buybackTokensRaw:b.buyback,platformCashRaw:b.platform},config:state.config};
}
function normalizeQuote(q,side,price,inputRaw) {
  const out=q.excludedTransferFeeAmountOut??q.outputAmount??q.amountOut;const min=q.minimumAmountOut??out;const input=q.includedTransferFeeAmountIn??q.includedFeeInputAmount??inputRaw;
  if(!out)throw new Error('SDK quote did not return an output amount');
  const inputValue=display(input,side==='sell'?6:9),output=display(out,side==='sell'?9:6);const execution=side==='sell'?output/inputValue:inputValue/output;const totalFee=(q.protocolFee??new BN(0)).add(q.tradingFee??new BN(0));const feeValue=display(totalFee,q.feeInBase?6:9);const curveExecution=side==='sell'?(q.feeInBase?output/(inputValue-feeValue):(output+feeValue)/inputValue):(inputValue-feeValue)/output;
  return {amountIn:inputValue,amountOut:output,amountInRaw:input.toString(),amountOutRaw:out.toString(),minimumAmountOutRaw:min.toString(),minAmountOut:display(min,side==='sell'?9:6),minimumReceived:display(min,side==='sell'?9:6),averagePrice:execution,priceImpact:price?Math.abs(curveExecution/price-1)*100:0,fee:feeValue,feeSymbol:q.feeSymbol||'SOL',feeRaw:totalFee.toString(),price,expiresAt:Date.now()+30000};
}
export async function quote(index,{side='buy',amount,amountRaw,slippageBps}={}) {
  await requireReady();const state=await load(idOf(index));if(!state)throw new Error('Unknown index');
  const {v,p,c}=await poolState(state);const input=new BN((amountRaw??rawAmount(amount,side==='sell'?6:9)).toString());
  if(p.migrationProgress===3)return dammQuote(state,{side,input,slippageBps:slippageBps??state.config.slippageBps});
  if(curveComplete(p,c))throw new Error('The curve is complete. Migrate the market before trading.');
  const slot=await connection.getSlot('confirmed');const time=await connection.getBlockTime(slot);const q=client.pool.swapQuote2({virtualPool:v,config:c,swapBaseForQuote:side==='sell',amountIn:input,swapMode:SwapMode.PartialFill,slippageBps:slippageBps??state.config.slippageBps,hasReferral:false,eligibleForFirstSwapWithMinFee:false,currentPoint:new BN(time??Math.floor(Date.now()/1000))});
  return normalizeQuote(q,side,Number(getPriceFromSqrtPrice(p.sqrtPrice,6,9)),input);
}

async function dammContext(state) {
  const {CpAmm}=await import('@meteora-ag/cp-amm-sdk');const cp=new CpAmm(connection);
  const address=state.addresses.dammPool || deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[6],pk(state.addresses.mint),NATIVE_MINT).toBase58();
  return {cp,address,p:await cp.fetchPoolState(pk(address))};
}
async function dammQuote(state,{side,input,slippageBps}) {
  const {cp,p}=await dammContext(state);const currentSlot=await connection.getSlot();const currentTime=await connection.getBlockTime(currentSlot)??Math.floor(Date.now()/1000);
  const baseInfo=transferFeesEnabled(state.config)?{mint:await getMint(connection,pk(state.addresses.mint),'confirmed',TOKEN_2022_PROGRAM_ID),currentEpoch:(await connection.getEpochInfo()).epoch}:undefined;
  const q=cp.getQuote({inputTokenInfo:side==='sell'?baseInfo:undefined,outputTokenInfo:side==='buy'?baseInfo:undefined,inAmount:input,inputTokenMint:side==='sell'?pk(state.addresses.mint):NATIVE_MINT,slippage:slippageBps/100,poolState:p,currentTime,currentSlot,tokenADecimal:6,tokenBDecimal:9,hasReferral:false});
  const transferConfig=baseInfo?getTransferFeeConfig(baseInfo.mint):null;const netOut=side==='buy'&&transferConfig?q.swapOutAmount.sub(new BN(calculateFee(getEpochFee(transferConfig,BigInt(baseInfo.currentEpoch)),BigInt(q.swapOutAmount.toString())).toString())):q.swapOutAmount;
  return normalizeQuote({amountOut:netOut,minimumAmountOut:q.minSwapOutAmount,includedFeeInputAmount:input,tradingFee:q.totalFee,feeInBase:Boolean(baseInfo&&side==='sell'),feeSymbol:baseInfo&&side==='sell'?state.config.symbol:'SOL'},side,Number(getPriceFromSqrtPrice(p.sqrtPrice,6,9)),input);
}
function remapProgramInstructions(tx,program,replacements) {
  return tx.instructions.filter(ix=>ix.programId.equals(program)).map(ix=>{ix.keys=ix.keys.map(k=>({...k,pubkey:replacements[k.pubkey.toBase58()]?pk(replacements[k.pubkey.toBase58()]):k.pubkey}));return ix;});
}
async function swapTransaction(state,args,buyback=false) {
  const owner=pk(args.wallet),side=buyback?'buy':args.side;const amountRaw=buyback?args.budgetRaw:args.amountRaw??rawAmount(args.amount,side==='sell'?6:9).toString();
  const q=await quote(state.id,{side,amountRaw,slippageBps:args.slippageBps});const {p}=await poolState(state);
  let tx,program,quoteVault=p.quoteVault.toBase58();
  if(p.migrationProgress===3){
    const {cp,p:d,address}=await dammContext(state);program=DAMM_V2_PROGRAM_ID;quoteVault=d.tokenBVault.toBase58();
    tx=await cp.swap({payer:owner,pool:pk(address),inputTokenMint:side==='sell'?pk(state.addresses.mint):NATIVE_MINT,outputTokenMint:side==='sell'?NATIVE_MINT:pk(state.addresses.mint),amountIn:new BN(amountRaw),minimumAmountOut:new BN(q.minimumAmountOutRaw),tokenAMint:d.tokenAMint,tokenBMint:d.tokenBMint,tokenAVault:d.tokenAVault,tokenBVault:d.tokenBVault,tokenAProgram:indexTokenProgram(state),tokenBProgram:TOKEN_PROGRAM_ID,referralTokenAccount:null,poolState:d});
  }else{
    program=DYNAMIC_BONDING_CURVE_PROGRAM_ID;tx=await client.pool.swap2({owner,payer:owner,pool:pk(state.addresses.pool),swapBaseForQuote:side==='sell',amountIn:new BN(amountRaw),minimumAmountOut:new BN(q.minimumAmountOutRaw),swapMode:SwapMode.PartialFill,referralTokenAccount:null});
  }
  if(buyback){const baseAta=getAssociatedTokenAddressSync(pk(state.addresses.mint),owner,false,indexTokenProgram(state)),quoteAta=getAssociatedTokenAddressSync(NATIVE_MINT,owner);tx=new Transaction().add(...remapProgramInstructions(tx,program,{[baseAta.toBase58()]:state.accounts.buyback.address,[quoteAta.toBase58()]:state.accounts.creator.address}));}
  return {tx,quote:q,quoteVault};
}
async function createStep(state,step) {
  const owner=pk(state.wallet);let tx=new Transaction(),signers=[],description;const assets=Object.entries(state.assets);
  if(step===0){tx=await client.partner.createConfig2({config:pk(state.addresses.config),feeClaimer:owner,leftoverReceiver:owner,payer:owner,quoteMint:NATIVE_MINT,...compileConfig(state.config),...(transferFeesEnabled(state.config)?{transferFeeParameters:transferFeeParameters(state.config)}:{})});signers=[Keypair.fromSecretKey(Uint8Array.from(state.configSecret))];description='Create this index’s unique DBC configuration';}
  else if(step===1){tx=await client.creator.createPool({baseMint:pk(state.addresses.mint),config:pk(state.addresses.config),name:state.config.name,symbol:state.config.symbol,uri:'',payer:owner,poolCreator:owner});if(state.automation)tx.add(createSetAuthorityInstruction(pk(state.addresses.mint),owner,AuthorityType.WithheldWithdraw,pk(state.automation.authority),[],TOKEN_2022_PROGRAM_ID));signers=[Keypair.fromSecretKey(Uint8Array.from(state.baseSecret))];description='Launch the index token and its DBC market';}
  else if(step<2+assets.length){
    const [assetId,asset]=assets[step-2],mint=pk(asset.mint);description=`Create ${asset.symbol || assetId.toUpperCase()} devnet fixture inventory and basket account`;
    tx.add(SystemProgram.createAccount({fromPubkey:owner,newAccountPubkey:mint,lamports:await connection.getMinimumBalanceForRentExemption(MINT_SIZE),space:MINT_SIZE,programId:TOKEN_PROGRAM_ID}),createInitializeMint2Instruction(mint,6,owner,null),createAssociatedTokenAccountIdempotentInstruction(owner,pk(asset.seller),owner,mint),createMintToCheckedInstruction(mint,pk(asset.seller),owner,1000000000000n,6),...await accountInstructions(owner,asset.reserve));signers=[Keypair.fromSecretKey(Uint8Array.from(asset.secret))];
  }else{
    description='Open separate earnings, fixture settlement and buyback accounts';for(const account of Object.values(state.accounts))tx.add(...await accountInstructions(owner,account));
    if(state.automation){tx.add(SystemProgram.transfer({fromPubkey:owner,toPubkey:pk(state.automation.authority),lamports:20000000}));description+=' and fund transfer-fee automation with 0.02 devnet SOL';}const seed=rawAmount(state.config.seedAmount||0);if(seed>0n)tx.add(SystemProgram.transfer({fromPubkey:owner,toPubkey:pk(state.accounts.creator.address),lamports:seed}),createSyncNativeInstruction(pk(state.accounts.creator.address)));
  }
  return {tx,signers,description,last:step===2+assets.length};
}
async function claimTransaction(state) {
  const owner=pk(state.wallet),{p}=await poolState(state);const tx=new Transaction();const baseAta=getAssociatedTokenAddressSync(pk(state.addresses.mint),owner,false,indexTokenProgram(state));
  tx.add(createAssociatedTokenAccountIdempotentInstruction(owner,baseAta,owner,pk(state.addresses.mint),indexTokenProgram(state)));
  const common={poolAuthority:deriveDbcPoolAuthority(),pool:pk(state.addresses.pool),tokenAAccount:baseAta,baseVault:p.baseVault,quoteVault:p.quoteVault,baseMint:p.baseMint,quoteMint:NATIVE_MINT,tokenBaseProgram:indexTokenProgram(state),tokenQuoteProgram:TOKEN_PROGRAM_ID,eventAuthority:deriveDbcEventAuthority(),program:DYNAMIC_BONDING_CURVE_PROGRAM_ID};
  const program=client.program;
  if(!p.creatorQuoteFee.isZero())tx.add(await program.methods.claimCreatorTradingFee(U64,U64).accountsPartial({...common,tokenBAccount:pk(state.accounts.creator.address),creator:owner}).instruction());
  if(!p.partnerQuoteFee.isZero())tx.add(await program.methods.claimTradingFee(U64,U64).accountsPartial({...common,tokenBAccount:pk(state.accounts.platform.address),config:pk(state.addresses.config),feeClaimer:owner}).instruction());
  if(p.migrationProgress===3){const d=await dammContext(state);for(const position of await positionEntries(state,d)){if(position.fees.feeTokenA.isZero()&&position.fees.feeTokenB.isZero())continue;const claim=await d.cp.claimPositionFee({owner,pool:pk(d.address),position:position.address,positionNftAccount:position.nftAccount,tokenAMint:d.p.tokenAMint,tokenBMint:d.p.tokenBMint,tokenAVault:d.p.tokenAVault,tokenBVault:d.p.tokenBVault,tokenAProgram:indexTokenProgram(state),tokenBProgram:TOKEN_PROGRAM_ID});tx.add(...remapProgramInstructions(claim,DAMM_V2_PROGRAM_ID,{[getAssociatedTokenAddressSync(NATIVE_MINT,owner).toBase58()]:state.accounts[position.role].address}));}}
  if(tx.instructions.length===1)throw new Error('There are no unclaimed trading fees.');
  return tx;
}
// Three constituents fit comfortably in a legacy packet. All sells precede buys.
export function basketOrderBatches(args) {
  const orders=[...(args.orders || [])].filter(order=>{const cost=BigInt(order.amountRaw),price=rawAmount(order.price);return cost>0n&&price>0n&&cost*1000000n/price>0n;}).sort((a,b)=>Number(b.side==='sell')-Number(a.side==='sell'));
  const batches=[];for(let i=0;i<orders.length;i+=3)batches.push(orders.slice(i,i+3));return batches;
}
export function accumulateBasketEffects(op,spent,received) {
  op.spentRaw=String(BigInt(op.spentRaw || '0')+spent);
  op.receivedRaw=String(BigInt(op.receivedRaw || '0')+received);
  return {spentRaw:op.spentRaw,receivedRaw:op.receivedRaw};
}
export async function basketTransaction(state,args,readBalance=tokenBalance) {
  const owner=pk(state.wallet),tx=new Transaction();const orders=[...(args.orders||[])].sort((a,b)=>a.side==='sell'?-1:b.side==='sell'?1:0);
  let cash=BigInt(await readBalance(state.accounts.creator.address)),market=BigInt(await readBalance(state.accounts.market.address));
  for(const order of orders){
    const a=state.assets[order.assetId];if(!a)throw new Error('Unknown basket asset');const cost=BigInt(order.amountRaw);const price=rawAmount(order.price);if(cost<=0n||price<=0n)continue;
    const quantity=cost*1000000n/price;if(!quantity)continue;const settled=quantity*price/1000000n;
    const buy=order.side==='buy';if(buy&&cash<settled)throw new Error('Insufficient collected treasury balance');if(!buy&&market<settled)throw new Error('The fixture market has insufficient settlement SOL at this scenario price.');
    const available=BigInt(await readBalance(buy?a.seller:a.reserve.address));if(available<quantity)throw new Error('Insufficient fixture-token inventory');
    tx.add(createTransferCheckedInstruction(pk(buy?state.accounts.creator.address:state.accounts.market.address),NATIVE_MINT,pk(buy?state.accounts.market.address:state.accounts.creator.address),owner,settled,9),createTransferCheckedInstruction(pk(buy?a.seller:a.reserve.address),pk(a.mint),pk(buy?a.reserve.address:a.seller),owner,quantity,6));cash+=buy?-settled:settled;market+=buy?settled:-settled;
  }
  if(!tx.instructions.length)throw new Error('The basket order is below one raw token unit');return tx;
}
export async function prepare(action,args) {
  await requireReady();const id=idOf(args.index??args.id),requestId=safe(args.requestId);const wallet=pk(args.wallet).toBase58();
  let state=action==='create'?await initialize(id,args.config,wallet,args.assets):await load(id);if(!state)throw new Error('Unknown index');if(action!=='trade'&&state.wallet!==wallet)throw new Error('Only the creator may operate this index');
  let op=state.operations[requestId];if(op&&(op.action!==action||op.wallet!==wallet))throw new Error('Operation identity mismatch');
  if(!op){op={action,wallet,args,step:0,confirmed:[],createdAt:Date.now()};state.operations[requestId]=op;}
  if(op.complete)return {...op.result,snapshot:await snapshot(id,{wallet})};
  if(op.pending){if(op.pending.signature){const status=(await connection.getSignatureStatuses([op.pending.signature],{searchTransactionHistory:true})).value[0];if(status&&!status.err){const recovered=await confirm({operation:{index:id,requestId},signature:op.pending.signature});return recovered.complete?recovered:prepare(action,args);}if(!status&&await connection.getBlockHeight()<=op.pending.lastValidBlockHeight){const recovered=await submit({operation:{index:id,requestId},signedTransaction:op.pending.signedTransaction});return recovered.complete?recovered:prepare(action,args);}if(status?.err||!status)op.pending=null;}else if(await connection.getBlockHeight()<=op.pending.lastValidBlockHeight)return op.pending.public;else op.pending=null;}
  let tx,signers=[],description,last=true,details={};const owner=pk(wallet);
  if(action==='create')({tx,signers,description,last}=await createStep(state,op.step));
  else if(action==='trade'||action==='buyback'){const built=await swapTransaction(state,args,action==='buyback');tx=built.tx;details.quote=built.quote;details.quoteVault=built.quoteVault;description=action==='buyback'?'Buy index tokens using the allocated earnings account':`${args.side==='sell'?'Sell':'Buy'} index tokens on Meteora`;}
  else if(action==='collect'){tx=await claimTransaction(state);description='Claim available trading fees into creator and platform accounts';}
  else if(action==='invest'||action==='rebalance'){const batches=basketOrderBatches(op.args),orders=batches[op.step];if(!orders)throw new Error('The basket order is below one raw token unit');tx=await basketTransaction(state,{...op.args,orders});last=op.step===batches.length-1;description=`Settle devnet fixture basket orders (${op.step+1}/${batches.length}) at scenario prices`;}
  else if(action==='rebate'){
    const batch=(args.allocations||[]).slice(op.step*4,(op.step+1)*4);last=(op.step+1)*4>=(args.allocations||[]).length;tx=new Transaction();for(const a of batch){const recipient=pk(a.wallet??a.id??a.address),ata=getAssociatedTokenAddressSync(NATIVE_MINT,recipient);tx.add(createAssociatedTokenAccountIdempotentInstruction(owner,ata,recipient,NATIVE_MINT),createTransferCheckedInstruction(pk(state.accounts.creator.address),NATIVE_MINT,ata,owner,BigInt(a.amountRaw),9));}description='Pay the eligible holder snapshot in wrapped devnet SOL';
  }else if(action==='burn'){
    const n=BigInt(await tokenBalance(state.accounts.buyback.address));if(!n)throw new Error('No bought-back tokens are available to burn');tx=new Transaction().add(createBurnCheckedInstruction(pk(state.accounts.buyback.address),pk(state.addresses.mint),owner,n,6,[],indexTokenProgram(state)));description='Permanently burn bought-back index tokens';
  }else if(action==='automation'){
    if(!state.automation||typeof args.enabled!=='boolean')throw new Error('This index has no transfer-fee automation policy');
    tx=new Transaction().add(new TransactionInstruction({programId:pk('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[{pubkey:owner,isSigner:true,isWritable:false}],data:Buffer.from(JSON.stringify({action,index:id,enabled:args.enabled,mode:state.config.transferFeeMode}))}));details.enabled=args.enabled;description=args.enabled?'Enable this index’s scoped devnet transfer-fee worker':'Pause this index’s transfer-fee worker';
  }else if(action==='fund-automation'){
    const amount=BigInt(args.amountRaw||0);if(!state.automation||amount<=0n||amount>100000000n)throw new Error('Automation top-up must be between 0 and 0.1 devnet SOL');
    tx=new Transaction().add(SystemProgram.transfer({fromPubkey:owner,toPubkey:pk(state.automation.authority),lamports:amount}));details.fundingRaw=String(amount);description='Top up only this index’s transfer-fee worker gas wallet';
  }else if(action==='migrate'){
    const {p,c}=await poolState(state);if(!curveComplete(p,c))throw new Error('The DBC graduation threshold has not been reached');if(p.migrationProgress===3)throw new Error('The index is already migrated');
    const result=await client.migration.migrateToDammV2({pool:pk(state.addresses.pool),dammConfig:DAMM_V2_MIGRATION_FEE_ADDRESS[6],payer:owner});tx=result.transaction;signers=[result.firstPositionNftKeypair,result.secondPositionNftKeypair];details.positions=signers.map(s=>s.publicKey.toBase58());description='Migrate the completed curve to DAMM v2 with the configured liquidity locks';
  }else throw new Error(`Unsupported chain action: ${action}`);
  if(!tx.instructions.some(ix=>ix.programId.equals(ComputeBudgetProgram.programId)))tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({units:600000}));
  const latest=await connection.getLatestBlockhash('confirmed');tx.feePayer=owner;tx.recentBlockhash=latest.blockhash;if(signers.length)tx.partialSign(...signers);
  const transaction=tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');const message=tx.serializeMessage().toString('base64');
  const publicPending={indexId:id,requestId,step:op.step,transaction,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight,description,complete:false};
  op.pending={...latest,message,public:publicPending,last,details};await save(id,state);return publicPending;
}
function operationIdentity(operation){return {id:idOf(operation.index??operation.indexId??operation.id),requestId:safe(operation.requestId)};}
export async function submit({operation,signedTransaction}) {
  await requireReady();const {id,requestId}=operationIdentity(operation),state=await load(id),op=state?.operations[requestId];if(!op)throw new Error('Unknown prepared operation');if(op.complete)return op.result;
  const pending=op.pending;if(!pending)throw new Error('No transaction is awaiting a signature');
  const tx=verifyPreparedTransaction(pending,signedTransaction);
  // Persist signed bytes before relay. A restart reuses the exact transaction, never a second payment.
  pending.signedTransaction=signedTransaction;pending.signature=base58(tx.signature);await save(id,state);
  const signature=await connection.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:3});pending.signature=signature;await save(id,state);
  return confirm({operation,signature});
}
export function tokenDelta(receipt,address){
  const keys=receipt.transaction.message.accountKeys;const i=keys.findIndex(k=>k.toBase58()===address);if(i<0)return 0n;
  const before=receipt.meta.preTokenBalances?.find(b=>b.accountIndex===i)?.uiTokenAmount.amount??'0';const after=receipt.meta.postTokenBalances?.find(b=>b.accountIndex===i)?.uiTokenAmount.amount??'0';return BigInt(after)-BigInt(before);
}
export async function confirm({operation,signature}) {
  await requireReady();const {id,requestId}=operationIdentity(operation),state=await load(id),op=state?.operations[requestId];if(!op)throw new Error('Unknown prepared operation');if(op.complete){if(op.result.signature!==signature)throw new Error('Confirmation signature does not match');return op.result;}
  const pending=op.pending;if(!pending)throw new Error('No prepared transaction');if(pending.signature&&pending.signature!==signature)throw new Error('A different transaction was already submitted');
  const status=await connection.getSignatureStatuses([signature],{searchTransactionHistory:true});if(status.value[0]?.err)throw new Error(`Transaction failed: ${JSON.stringify(status.value[0].err)}`);
  if(!['confirmed','finalized'].includes(status.value[0]?.confirmationStatus)){let confirmed=false;for(let attempt=0;attempt<5;attempt++){await new Promise(r=>setTimeout(r,900));const current=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];if(current?.err)throw new Error(`Transaction failed: ${JSON.stringify(current.err)}`);if(['confirmed','finalized'].includes(current?.confirmationStatus)){confirmed=true;break;}}if(!confirmed)throw new Error('Transaction submitted and still pending confirmation. Resume this operation to reconcile it.');}
  const receipt=await connection.getTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});if(!receipt||receipt.meta?.err)throw new Error('Confirmed transaction details are not available yet; retry confirmation');
  if(receipt.transaction.message.serialize().toString('base64')!==pending.message)throw new Error('Transaction signature belongs to a different operation');
  const creator=tokenDelta(receipt,state.accounts.creator.address),platform=tokenDelta(receipt,state.accounts.platform.address),buyback=tokenDelta(receipt,state.accounts.buyback.address);let effects={};
  if(op.action==='create'){op.seedRaw=String(BigInt(op.seedRaw||'0')+(creator>0n?creator:0n));effects={addresses:state.addresses,seedRaw:op.seedRaw};}
  if(op.action==='automation'){state.automation.enabled=pending.details.enabled;state.automation.revision=(state.automation.revision||0)+1;effects={enabled:pending.details.enabled};}
  if(op.action==='fund-automation'){state.automation.revision=(state.automation.revision||0)+1;effects={fundingRaw:pending.details.fundingRaw};}
  if(op.action==='collect')effects={creatorRaw:String(creator),platformRaw:String(platform)};
  if(op.action==='buyback')effects={spentRaw:String(-creator),acquiredRaw:String(buyback)};
  if(op.action==='burn')effects={burnedRaw:String(-buyback)};
  if(op.action==='invest'||op.action==='rebalance'){
    let spent=0n,received=0n;
    // The fixture settlement account delta is net; reconstruct signed, checked transfer amounts for gross cash flows.
    const prepared=Transaction.from(Buffer.from(pending.public.transaction,'base64'));
    for(const ix of prepared.instructions){if(!ix.programId.equals(TOKEN_PROGRAM_ID)||ix.data[0]!==12||!ix.keys[1]?.pubkey.equals(NATIVE_MINT))continue;const n=ix.data.readBigUInt64LE(1);if(ix.keys[0].pubkey.toBase58()===state.accounts.creator.address)spent+=n;if(ix.keys[2].pubkey.toBase58()===state.accounts.creator.address)received+=n;}
    if(creator!==received-spent)throw new Error('Treasury settlement delta did not reconcile');effects=accumulateBasketEffects(op,spent,received);
  }
  if(op.action==='rebate'){op.paidRaw=String(BigInt(op.paidRaw||'0')-creator);effects={paidRaw:op.paidRaw,allocations:op.args.allocations};}
  if(op.action==='trade'){
    const quoteVault=pending.details.quoteVault;
    const base=tokenDelta(receipt,getAssociatedTokenAddressSync(pk(state.addresses.mint),pk(op.wallet),false,indexTokenProgram(state)).toBase58()),quote=tokenDelta(receipt,quoteVault);effects={side:op.args.side,baseAmountRaw:String(base<0n?-base:base),quoteAmountRaw:String(quote<0n?-quote:quote)};
  }
  if(op.action==='migrate'){state.addresses.dammPool=deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[6],pk(state.addresses.mint),NATIVE_MINT).toBase58();state.positions=pending.details.positions;effects={addresses:state.addresses};}
  op.confirmed.push({signature,step:op.step});op.step++;const complete=pending.last;op.pending=null;op.complete=complete;
  if(complete){op.result={complete:true,signature,effects};if(op.action==='create'){if(state.automation)state.automation.enabled=true;delete state.baseSecret;delete state.configSecret;for(const asset of Object.values(state.assets))delete asset.secret;}}
  await save(id,state);return complete?{...op.result,snapshot:await snapshot(id,{wallet:op.wallet})}:{complete:false,signature,nextStep:op.step,effects:{}};
}

function base58(bytes){const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=BigInt('0x'+Buffer.from(bytes).toString('hex')),out='';while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}for(const byte of bytes){if(byte!==0)break;out='1'+out;}return out;}

async function positionEntries(state,d) {
  if(!state.positions?.length)return [];
  const {derivePositionAddress,derivePositionNftAccount,getUnClaimLpFee}=await import('@meteora-ag/cp-amm-sdk');
  // DBC gives the larger configured share the first position; ties put creator first.
  const partnerFirst=state.config.partnerLiquidity+state.config.partnerLocked>state.config.creatorLiquidity+state.config.creatorLocked;
  const entries=[];for(let i=0;i<state.positions.length;i++){
    const mint=pk(state.positions[i]),address=derivePositionAddress(mint);if(!await connection.getAccountInfo(address))continue;
    const position=await d.cp.fetchPositionState(address);entries.push({address,nftAccount:derivePositionNftAccount(mint),role:(i===0)===partnerFirst?'platform':'creator',fees:getUnClaimLpFee(d.p,position)});
  }return entries;
}
async function positionFees(state,d){const result={creator:0n,platform:0n};for(const p of await positionEntries(state,d))result[p.role]+=BigInt(p.fees.feeTokenB.toString());return result;}

function decimalJson(value){if(BN.isBN(value)||typeof value==='bigint')return value.toString();if(Array.isArray(value))return value.map(decimalJson);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decimalJson(v)]));return value;}
export function verifyPreparedTransaction(pending,signedTransaction){
  const tx=Transaction.from(Buffer.from(signedTransaction,'base64'));
  if(tx.serializeMessage().toString('base64')!==pending.message)throw new Error('Signed transaction differs from the prepared operation');
  if(!tx.verifySignatures())throw new Error('A required transaction signature is missing or invalid');return tx;
}

export function curveComplete(pool,config){return BigInt(pool.quoteReserve.toString())>=BigInt(config.migrationQuoteThreshold.toString());}

export function transferFeesEnabled(config){return ['burn','rewards'].includes(config.transferFeeMode)&&Number(config.transferFeeBps)>0;}
export function indexTokenProgram(state){return pk(state.addresses.tokenProgram||(transferFeesEnabled(state.config)?TOKEN_2022_PROGRAM_ID:TOKEN_PROGRAM_ID));}
export function transferFeeParameters(config){if(!transferFeesEnabled(config))return null;return {transferFeeBasisPoints:config.transferFeeBps,withheldAuthority:TransferFeeWithheldAuthority.Creator,migratedTransferFeeAuthorityOption:MigratedTransferFeeAuthorityOption.Immutable};}
export async function transferFeeStatus(index){return (await import('./transfer-fees.mjs')).transferFeeStatus(idOf(index));}
export async function runTransferFeeTick(){return (await import('./transfer-fees.mjs')).runTransferFeeTick();}
// Internal worker interface; never returned through an HTTP API.
export function automationContext(){return {connection,root,load,requireReady,tokenDelta,base58};}
