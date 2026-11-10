#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_LAUNCHPAD, LAUNCHPAD_MODELS, validateLaunchpadSettings, saveLaunchpadSettings } from '../lib/launchpad-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const help = `Set up your own devnet launchpad

  npm run setup
  npm run setup -- --yes --name "Orbit Indexes" --model holder-rewards --install
  npm run setup -- --yes --config ./my-settings.json

Options:
  --name TEXT                Launchpad brand name
  --tagline TEXT             Short description shown in the app
  --model MODEL              index | holder-rewards | fee-burn | buyback
  --creator-share INTEGER    Creator share of the non-protocol trading fee (0–100)
  --fee-bps INTEGER          Opening trading fee (25–1000; 100 means 1%)
  --ending-fee-bps INTEGER   Ending fee, at most the opening fee
  --fee-mode MODE            fixed | linear | exponential
  --fee-duration INTEGER    Fee schedule duration in seconds (1–86400)
  --rebate-interval INTEGER  Minimum holder payout interval, seconds (10–3600)
  --transfer-fee-bps INTEGER Transfer fee in bps for rewards/burn models
  --transfer-interval INT    Transfer-fee processing interval, seconds
  --transfer-minimum NUMBER Minimum collected index tokens before processing
  --port INTEGER            Local port (1024–65535; default 3000)
  --config PATH             Read settings from JSON; CLI flags take precedence
  --yes                     Skip prompts, use defaults for omitted choices
  --install                 Install locked npm and pnpm dependencies
  --replace                 Back up an existing launchpad.config.json before replacing
  --help                    Show this guide

No wallet keys, transactions or deployments are created. All launchpad terms are
defaults for future drafts; existing launches keep their original agreements.
RPC and Jupiter credentials belong in fun-launch/.env.local, never this config.`;
const bools = new Set(['yes','install','replace','help']);
const values = new Set(['name','tagline','model','creator-share','fee-bps','ending-fee-bps','fee-mode','fee-duration','rebate-interval','transfer-fee-bps','transfer-interval','transfer-minimum','port','config']);
function argumentsOf(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error('Expected a --option. Use --help for supported options.');
    const key = arg.slice(2);
    if (bools.has(key)) result[key] = true;
    else if (values.has(key) && argv[i+1] !== undefined && !argv[i+1].startsWith('--')) result[key] = argv[++i];
    else throw new Error('Unknown option or missing value. Use --help for supported options.');
  }
  return result;
}
async function command(executable, args) {
  await new Promise((resolve,reject) => {
    const child = spawn(executable,args,{cwd:root,stdio:'inherit',shell:false});
    child.once('error',reject);
    child.once('exit',code => code === 0 ? resolve() : reject(new Error('Dependency installation failed. Your settings are saved; retry npm ci and the pnpm install command in README.')));
  });
}
async function main() {
  const flags = argumentsOf(process.argv.slice(2));
  if (flags.help) { console.log(help); return; }
  let supplied = {};
  if (flags.config) {
    let content;
    try { content = await readFile(path.resolve(flags.config),'utf8'); } catch { throw new Error('Could not read the --config JSON file.'); }
    try { supplied = JSON.parse(content); } catch { throw new Error('The --config file must contain valid JSON.'); }
    validateLaunchpadSettings(supplied);
  }
  let input = { ...DEFAULT_LAUNCHPAD, ...supplied };
  input.businessModel = flags.model ?? input.businessModel;
  // A model flag deliberately starts that model's allocation preset; explicit defaults still win.
  input.defaults = { ...(flags.model ? LAUNCHPAD_MODELS[flags.model] : {}), ...supplied.defaults };
  for (const key of ['name','tagline']) if (flags[key] !== undefined) input[key] = flags[key];
  if (flags.port !== undefined) input.port = Number(flags.port);
  const mapping = { 'creator-share':'creatorShare','fee-bps':'feeBps','ending-fee-bps':'endingFeeBps','fee-mode':'feeMode','fee-duration':'feeDuration','rebate-interval':'rebateInterval','transfer-fee-bps':'transferFeeBps','transfer-interval':'transferFeeInterval','transfer-minimum':'transferFeeMinAmount' };
  for (const [flag,key] of Object.entries(mapping)) if (flags[flag] !== undefined) input.defaults[key] = flag === 'fee-mode' ? flags[flag] : Number(flags[flag]);
  let install = !!flags.install;
  if (!flags.yes) {
    if (!process.stdin.isTTY) throw new Error('Interactive setup needs a terminal. Use --yes for reproducible setup.');
    const rl = createInterface({ input:process.stdin, output:process.stdout });
    const ask = async (label,fallback) => (await rl.question(`${label} [${fallback}]: `)).trim() || String(fallback);
    try {
      console.log('\nYour launchpad business · Solana devnet\n');
      input.name = await ask('Launchpad name',input.name);
      input.tagline = await ask('Tagline',input.tagline);
      console.log('\nIndex: trading fees fund a basket and holder rebates.\nHolder rewards: also collect a 1% token transfer fee for holders.\nFee burn: also collect a 1% token transfer fee and burn collected tokens.\nBuyback: allocate 50% of creator trading revenue to index buybacks.\n');
      const chosen = await ask('Business model: index, holder-rewards, fee-burn, buyback',input.businessModel);
      if (chosen !== input.businessModel) input.defaults = { ...input.defaults, ...LAUNCHPAD_MODELS[chosen] };
      input.businessModel = chosen;
      const current = validateLaunchpadSettings(input).defaults;
      input.defaults.creatorShare = Number(await ask('Creator share of non-protocol fee (%)',current.creatorShare));
      input.defaults.feeMode = await ask('Fee schedule: fixed, linear, exponential',current.feeMode);
      input.defaults.feeBps = Number(await ask('Opening trading fee in bps (100 = 1%)',current.feeBps));
      input.defaults.endingFeeBps = input.defaults.feeMode === 'fixed' ? input.defaults.feeBps : Number(await ask('Ending trading fee in bps',Math.min(current.endingFeeBps,input.defaults.feeBps)));
      input.defaults.feeDuration = Number(await ask('Fee schedule duration in seconds',current.feeDuration));
      input.defaults.rebateInterval = Number(await ask('Minimum holder payout interval in seconds',current.rebateInterval));
      if (['holder-rewards','fee-burn'].includes(input.businessModel)) {
        input.defaults.transferFeeBps = Number(await ask('Token transfer fee in bps (100 = 1%)',current.transferFeeBps));
        input.defaults.transferFeeInterval = Number(await ask('Transfer-fee processing interval in seconds',current.transferFeeInterval));
        input.defaults.transferFeeMinAmount = Number(await ask('Minimum collected index tokens before processing',current.transferFeeMinAmount));
      }
      input.port = Number(await ask('Local web port',input.port));
      if (!flags.install) install = ['y','yes'].includes((await ask('Install dependencies now? yes/no','yes')).toLowerCase());
    } finally { rl.close(); }
  }
  // Fixed fees have one rate, including when a lower opening fee is supplied alone.
  if ((input.defaults.feeMode || 'fixed') === 'fixed') input.defaults.endingFeeBps = input.defaults.feeBps ?? 100;
  const result = await saveLaunchpadSettings(input,{replace:!!flags.replace});
  console.log(`\nSaved ${result.settings.name} on devnet.\nBusiness model: ${result.settings.businessModel}\nConfig: launchpad.config.json`);
  if (result.backup) console.log(`Previous config backed up to ${path.basename(result.backup)}`);
  if (install) {
    await command(process.platform === 'win32' ? 'npm.cmd' : 'npm',['ci']);
    await command(process.platform === 'win32' ? 'npm.cmd' : 'npm',['exec','--yes','--package=pnpm@10.18.2','--','pnpm','--dir','fun-launch','install','--frozen-lockfile']);
  }
  console.log(`\nNext: ${install ? 'npm run dev' : 'install dependencies (README), then npm run dev'}\nOpen http://localhost:${result.settings.port}\nConnect a devnet wallet and launch your first index.\n\nOptional: add JUPITER_API_KEY and a devnet SOLANA_RPC_URL in\nfun-launch/.env.local. Setup never reads or prints these secrets.\nPayout intervals are eligibility rules; operations still need wallet signatures.`);
}
main().catch(error => { console.error(`Setup failed: ${error.message}`); process.exitCode = 1; });
