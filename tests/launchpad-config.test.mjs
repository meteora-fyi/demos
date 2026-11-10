import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_CONFIG } from '../lib/model.mjs';
import { loadLaunchpadSettings, validateLaunchpadSettings, saveLaunchpadSettings } from '../lib/launchpad-config.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(tmpdir(), 'launchpad-setup-'));
test.after(() => rm(dir,{recursive:true,force:true}));
const cli = (args,filePath) => run(process.execPath,['scripts/setup.mjs',...args],{cwd:root,env:{...process.env,LAUNCHPAD_CONFIG_PATH:filePath}});

test('missing config preserves old token defaults and exposes only public brand settings',async()=>{
  const value = await loadLaunchpadSettings(path.join(dir,'missing.json'));
  assert.deepEqual(value.defaults,DEFAULT_CONFIG);
  assert.equal(value.port,3000);
  assert.equal(value.launchpad.network,'devnet');
  assert.deepEqual(Object.keys(value.launchpad).sort(),['businessModel','name','network','tagline']);
});

test('settings reject unsupported networks, secrets, invalid ports and inconsistent financial defaults',()=>{
  for (const input of [{network:'mainnet'},{JUPITER_API_KEY:'private'},{port:80},{port:3000.1},{name:'bad\nname'},{businessModel:'__proto__'},{defaults:{creatorShare:101}},{defaults:{basketAllocation:99}}]) {
    assert.throws(()=>validateLaunchpadSettings(input));
  }
  const safe=validateLaunchpadSettings({name:'My launchpad',defaults:{creatorShare:75}});
  assert.equal(safe.defaults.creatorShare,75);
});

test('model presets separate transfer-fee burning from trading-fee buybacks',()=>{
  const burn=validateLaunchpadSettings({businessModel:'fee-burn'});
  const rewards=validateLaunchpadSettings({businessModel:'holder-rewards'});
  const buyback=validateLaunchpadSettings({businessModel:'buyback'});
  assert.equal(burn.defaults.transferFeeMode,'burn');
  assert.equal(burn.defaults.transferFeeBps,100);
  assert.equal(burn.defaults.buybackAllocation,0);
  assert.equal(rewards.defaults.transferFeeMode,'rewards');
  assert.equal(rewards.defaults.transferFeeInterval,300);
  assert.equal(buyback.defaults.buybackAllocation,50);
  assert.equal(buyback.defaults.transferFeeMode,'off');
});

test('config saves are atomic, refuse overwrite and back up exact prior bytes on explicit replacement',async()=>{
  const filePath=path.join(dir,'atomic.json');
  await saveLaunchpadSettings({name:'First business'},{filePath});
  const before=await readFile(filePath,'utf8');
  await assert.rejects(saveLaunchpadSettings({name:'Second business'},{filePath}),/already exists/);
  assert.equal(await readFile(filePath,'utf8'),before);
  const {backup}=await saveLaunchpadSettings({name:'Second business'},{filePath,replace:true});
  assert.equal(await readFile(backup,'utf8'),before);
  assert.equal((await loadLaunchpadSettings(filePath)).launchpad.name,'Second business');
  assert.equal((await readdir(dir)).some(name=>name.endsWith('.tmp')||name.endsWith('.lock')),false);
});

test('noninteractive setup imports config, applies CLI overrides and refuses a second run',async()=>{
  const inputPath=path.join(dir,'input.json'),filePath=path.join(dir,'cli.json');
  await writeFile(inputPath,JSON.stringify({name:'Input name',defaults:{creatorShare:65,feeMode:'linear',feeBps:100,endingFeeBps:50}}));
  const first=await cli(['--yes','--config',inputPath,'--name','CLI name','--port','3109'],filePath);
  assert.match(first.stdout,/http:\/\/localhost:3109/);
  const settings=await loadLaunchpadSettings(filePath);
  assert.equal(settings.launchpad.name,'CLI name');
  assert.equal(settings.defaults.creatorShare,65);
  assert.equal(settings.defaults.feeMode,'linear');
  await assert.rejects(cli(['--yes'],filePath),error=>/already exists/.test(error.stderr));
  assert.equal((await loadLaunchpadSettings(filePath)).launchpad.name,'CLI name');
});

test('CLI handles lower fixed fees and never prints supplied config secrets on errors',async()=>{
  const filePath=path.join(dir,'fixed.json');
  await cli(['--yes','--fee-bps','25'],filePath);
  assert.equal((await loadLaunchpadSettings(filePath)).defaults.endingFeeBps,25);
  const bad=path.join(dir,'bad.json');
  await writeFile(bad,'{"JUPITER_API_KEY":"test-secret-never-echo"}');
  await assert.rejects(cli(['--yes','--config',bad],path.join(dir,'never-created.json')),error=>{
    assert.equal((error.stdout+error.stderr).includes('test-secret-never-echo'),false);
    return /credentials/.test(error.stderr);
  });
  await writeFile(bad,'{"password":"test-secret-never-echo",');
  await assert.rejects(cli(['--yes','--config',bad],path.join(dir,'never-created.json')),error=>{
    assert.equal((error.stdout+error.stderr).includes('test-secret-never-echo'),false);
    return /valid JSON/.test(error.stderr);
  });
});
