import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,utimes,unlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const directory=await mkdtemp(path.join(os.tmpdir(),'index-lock-'));
process.env.DEMO_DATA_DIR=directory;
const {exclusive,sessionDirectory}=await import('../lib/store.mjs');
const session='c'.repeat(32),dir=sessionDirectory(session),lock=path.join(dir,'engine.lock');
await mkdir(dir,{recursive:true});
test('a crashed empty lock expires by filesystem mtime and a new owner can proceed',async()=>{
 await writeFile(lock,'');const old=new Date(Date.now()-180000);await utimes(lock,old,old);
 let ran=false;await exclusive(session,async()=>{ran=true;assert.ok(JSON.parse(await readFile(lock,'utf8')).token);});
 assert.ok(ran);await assert.rejects(readFile(lock),{code:'ENOENT'});
});
test('a newly created empty lock remains protected',async()=>{
 await writeFile(lock,'');await assert.rejects(exclusive(session,async()=>assert.fail('must not enter')),/busy/);await unlink(lock);
});
test('fresh heartbeat mtime protects a lease with an older creation timestamp',async()=>{
 await writeFile(lock,JSON.stringify({token:'alive',updatedAt:Date.now()-180000}));
 await assert.rejects(exclusive(session,async()=>assert.fail('must not enter')),/busy/);await unlink(lock);
});
test('an old callback never removes a replacement owner lock',async()=>{
 await exclusive(session,async()=>{await unlink(lock);await writeFile(lock,JSON.stringify({token:'replacement',updatedAt:Date.now()}));});
 assert.equal(JSON.parse(await readFile(lock,'utf8')).token,'replacement');await unlink(lock);
});
test.after(async()=>rm(directory,{recursive:true,force:true}));
