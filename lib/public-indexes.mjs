import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { exclusive } from './store.mjs';

const root=path.resolve(process.env.DEMO_DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.demo'));
const directory=path.join(root,'public-indexes');
function validId(id){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(id))throw new Error('Invalid public index ID.');return id;}
export function withPublicIndexLock(id,callback){return exclusive(`public_index_${createHash('sha256').update(validId(id)).digest('hex').slice(0,40)}`,callback);}
export function publicIndexView(value){
  // This allowlist is the public boundary. Never serialize a session, chain manifest or operation.
  const fields=['id','name','symbol','owner','config','createdAt','updatedAt','status','addresses','assetMints','policyDigest','market','treasury','earnings','holders','history','rebate','transferFees'];
  const result=Object.fromEntries(fields.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
  result.canManage=false;
  result.receipts=(value.receipts || []).filter(r=>r.status==='confirmed'&&r.signature).map(r=>({id:r.signature,signature:r.signature,action:r.action,status:'confirmed',createdAt:r.createdAt,message:`${r.action} confirmed`}));
  result.syncError=value.syncError?'Latest chain refresh is unavailable. Showing the last confirmed snapshot.':null;
  return structuredClone(result);
}
export async function publishPublicIndex(index,ownerSession,publicView){
  validId(index.id);
  await mkdir(directory,{recursive:true,mode:0o700});
  const target=path.join(directory,`${index.id}.json`),temp=`${target}.${randomUUID()}.tmp`;
  const record={version:1,indexId:index.id,ownerSession,publicView:publicIndexView(publicView)};
  await writeFile(temp,JSON.stringify(record),{mode:0o600});await rename(temp,target);
}
export async function getPublicIndex(id){
  validId(id);
  try{return JSON.parse(await readFile(path.join(directory,`${id}.json`),'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function listPublicIndexes(){
  let names;try{names=await readdir(directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const result=[];
  // Small batches bound filesystem pressure; reads never trigger provider work.
  for(let i=0;i<names.length;i+=20){
    const records=await Promise.all(names.slice(i,i+20).filter(n=>/^[a-zA-Z0-9_-]+\.json$/.test(n)).map(async name=>{
      try{return JSON.parse(await readFile(path.join(directory,name),'utf8'));}catch{return null;}
    }));
    for(const record of records)if(record?.publicView)result.push(publicIndexView(record.publicView));
  }
  return result.sort((a,b)=>b.createdAt-a.createdAt);
}

// Process a bounded number of legacy session files per tick; the caller provides the safe publisher.
let scanNames,scanCursor=0,scanRunning=false;
export async function backfillPublicIndexes(publishSession,{limit=25}={}){
  if(scanRunning)return {processed:0,done:false};scanRunning=true;
  try{
    if(!scanNames){try{scanNames=await readdir(path.join(root,'sessions'));}catch(error){if(error.code==='ENOENT')return {processed:0,done:true};throw error;}}
    const selected=scanNames.slice(scanCursor,scanCursor+limit);scanCursor+=selected.length;
    for(const name of selected){
      if(!/^[a-zA-Z0-9_-]{16,80}$/.test(name)||name.startsWith('public_index_'))continue;
      try{await exclusive(name,async()=>{
        const s=JSON.parse(await readFile(path.join(root,'sessions',name,'state.json'),'utf8'));
        if(s.sessionId===name)await publishSession(s);
      });}catch{/* A damaged or actively leased session is retried when its owner next opens it. */}
    }
    return {processed:selected.length,done:scanCursor>=scanNames.length};
  }finally{scanRunning=false;}
}
