import { readFile, mkdir, open, rename, unlink, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG, validateConfig } from './model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LAUNCHPAD_MODELS = Object.freeze({
  index: { basketAllocation: 50, rebateAllocation: 25, buybackAllocation: 0, creatorAllocation: 25 },
  'holder-rewards': { basketAllocation: 50, rebateAllocation: 25, buybackAllocation: 0, creatorAllocation: 25, transferFeeBps: 100, transferFeeMode: 'rewards', transferFeeInterval: 300, transferFeeMinAmount: 0.001 },
  'fee-burn': { basketAllocation: 50, rebateAllocation: 25, buybackAllocation: 0, creatorAllocation: 25, transferFeeBps: 100, transferFeeMode: 'burn', transferFeeInterval: 300, transferFeeMinAmount: 0.001 },
  buyback: { basketAllocation: 25, rebateAllocation: 0, buybackAllocation: 50, creatorAllocation: 25 },
});
export const DEFAULT_LAUNCHPAD = Object.freeze({
  version: 1, network: 'devnet', name: 'Meteora Launchpad Lab',
  tagline: 'Build your launchpad business.', businessModel: 'index', port: 3000, defaults: {},
});
export function launchpadConfigPath() {
  return path.resolve(root, process.env.LAUNCHPAD_CONFIG_PATH || 'launchpad.config.json');
}
function text(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be plain text from 1 to ${limit} characters.`);
  }
  return value.trim();
}
export function validateLaunchpadSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Launchpad settings must be a JSON object.');
  if (Object.keys(input).some(key => !Object.hasOwn(DEFAULT_LAUNCHPAD, key))) throw new Error('Unknown launchpad setting. Store credentials only in server environment variables.');
  const c = { ...DEFAULT_LAUNCHPAD, ...input };
  if (c.version !== 1) throw new Error('Unsupported launchpad settings version.');
  if (c.network !== 'devnet') throw new Error('This scaffold supports devnet only.');
  c.name = text(c.name, 'Launchpad name', 64);
  c.tagline = text(c.tagline, 'Tagline', 160);
  if (!Object.hasOwn(LAUNCHPAD_MODELS, c.businessModel)) throw new Error('Choose index, holder-rewards, fee-burn or buyback as the business model.');
  if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) throw new Error('Port must be an integer from 1024 to 65535.');
  if (!c.defaults || typeof c.defaults !== 'object' || Array.isArray(c.defaults)) throw new Error('Launch defaults must be a JSON object.');
  // Preserve the existing model validator as the single authority for launch terms.
  const defaults = { ...DEFAULT_CONFIG, ...LAUNCHPAD_MODELS[c.businessModel], ...c.defaults };
  if (defaults.feeMode === 'fixed') defaults.endingFeeBps = defaults.feeBps;
  c.defaults = validateConfig(defaults);
  return c;
}
export async function readLaunchpadConfig(filePath = launchpadConfigPath()) {
  let content;
  try { content = await readFile(filePath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('Launchpad config is not valid JSON.'); }
  return validateLaunchpadSettings(parsed);
}
export async function loadLaunchpadSettings(filePath = launchpadConfigPath()) {
  const c = (await readLaunchpadConfig(filePath)) || validateLaunchpadSettings(DEFAULT_LAUNCHPAD);
  return {
    launchpad: { name: c.name, tagline: c.tagline, businessModel: c.businessModel, network: c.network },
    defaults: c.defaults, port: c.port,
  };
}
export async function saveLaunchpadSettings(input, { filePath = launchpadConfigPath(), replace = false } = {}) {
  const settings = validateLaunchpadSettings(input);
  await mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another setup is writing this config. Retry after it finishes.'); throw error; }
  const temp = `${filePath}.${randomUUID()}.tmp`;
  let backup;
  try {
    let exists = false;
    try { await readFile(filePath); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists && !replace) throw new Error('launchpad.config.json already exists. Use --replace to back it up and replace it, or edit it directly.');
    if (exists) {
      backup = `${filePath}.backup-${Date.now()}-${randomUUID().slice(0,8)}`;
      await copyFile(filePath, backup, constants.COPYFILE_EXCL);
    }
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(settings, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, filePath);
    return { settings, filePath, backup };
  } finally {
    await unlink(temp).catch(() => {});
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}
