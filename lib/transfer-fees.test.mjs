import test from 'node:test';import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ExtensionType} from '@solana/spl-token';
import {holderSnapshot,rewardAllocations} from './transfer-fees.mjs';
import {compileConfig,indexTokenProgram,transferFeeParameters} from './chain.mjs';
import {DEFAULT_CONFIG} from './model.mjs';
const creator=Keypair.generate().publicKey,operator=Keypair.generate().publicKey,holder=Keypair.generate().publicKey;
function record(owner,balance,withheld=0n){const tlvData=Buffer.alloc(12);tlvData.writeUInt16LE(ExtensionType.TransferFeeAmount,0);tlvData.writeUInt16LE(8,2);tlvData.writeBigUInt64LE(withheld,4);return {pubkey:Keypair.generate().publicKey,account:{owner,amount:BigInt(balance),isFrozen:false,tlvData}};}
test('holder snapshot aggregates all wallet accounts and excludes creator, operator and pool PDAs',()=>{
 const [pda]=PublicKey.findProgramAddressSync([Buffer.from('pool')],TOKEN_PROGRAM_ID);
 const records=[record(creator,100,2n),record(operator,50),record(pda,1000,3n),record(holder,3,5n),record(holder,7)];
 const s=holderSnapshot(records,{creator:creator.toBase58(),authority:operator.toBase58()});
 assert.deepEqual(s.holders,[{wallet:holder.toBase58(),balanceRaw:'10'}]);assert.equal(s.withheldRaw,'10');assert.equal(s.sources.length,3);
});
test('holder limits fail the whole scan instead of paying a partial list',()=>{
 assert.throws(()=>holderSnapshot([record(holder,1),record(holder,2)],{maxAccounts:1}),/no partial/);
 assert.throws(()=>holderSnapshot([record(holder,1),record(creator,2)],{maxHolders:1}),/no partial/);
});
test('reward plans distinguish gross allocation and net receipts after fee rounding',()=>{
 const plan=rewardAllocations(1000n,[{wallet:'a',balanceRaw:'3'},{wallet:'b',balanceRaw:'1'}],{epoch:0n,maximumFee:18446744073709551615n,transferFeeBasisPoints:250});
 assert.deepEqual(plan,[{wallet:'a',amountRaw:'750',expectedNetRaw:'731'},{wallet:'b',amountRaw:'250',expectedNetRaw:'243'}]);
});
test('enabled launches use Token2022 and immutable migration fees without giving operator treasury authority',()=>{
 const config={...DEFAULT_CONFIG,transferFeeMode:'burn',transferFeeBps:250};const compiled=compileConfig(config);
 assert.equal(compiled.tokenType,1);assert.equal(compiled.migratedPoolFee.collectFeeMode,2);assert.equal(compiled.compoundingFeeBps,0);
 assert.deepEqual(transferFeeParameters(config),{transferFeeBasisPoints:250,withheldAuthority:1,migratedTransferFeeAuthorityOption:0});
 assert.ok(indexTokenProgram({addresses:{},config}).equals(TOKEN_2022_PROGRAM_ID));assert.ok(indexTokenProgram({addresses:{},config:DEFAULT_CONFIG}).equals(TOKEN_PROGRAM_ID));
});
