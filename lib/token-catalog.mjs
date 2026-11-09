import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, unlink, link } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';

const DEFAULT_ROOT = path.resolve(process.env.DEMO_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.demo'), 'token-catalog');
const ENDPOINT = 'https://api.jup.ag/tokens/v2/search';
const TTL = 60 * 60_000;
const COLORS = ['#e6a147', '#8b9bd1', '#72b8a6', '#c88777', '#9a8ab5', '#7e9ab6'];
const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) : '';
export function normalizeQuery(input) {
  if (typeof input !== 'string' || input.length < 2 || input.length > 80 || /[\u0000-\u001f\u007f]/.test(input)) throw new Error('Search with 2–80 characters: a token name, symbol or Solana mint.');
  const query = input.trim();
  if (query.length < 2) throw new Error('Enter at least two characters.');
  try { return new PublicKey(query).toBase58(); } catch { return query.toLowerCase(); }
}
export function catalogToken(row, now = Date.now()) {
  if (!row || typeof row.id !== 'string') return null;
  let mint; try { mint = new PublicKey(row.id).toBase58(); } catch { return null; }
  if (mint !== row.id || !Number.isInteger(row.decimals) || row.decimals < 0 || row.decimals > 18) return null;
  const symbol = clean(row.symbol, 20), name = clean(row.name, 80);
  if (!symbol || !name) return null;
  const hash = createHash('sha256').update(mint).digest();
  return { id: `jup_${mint}`, sourceMint: mint, sourceDecimals: row.decimals, symbol, name, color: COLORS[hash[0] % COLORS.length], price: 0.01, source: 'jupiter', updatedAt: now, isVerified: row.isVerified === true };
}
const keyFor = query => createHash('sha256').update(query).digest('hex');
async function readJson(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, file);
}
async function files(dir) { try { return (await readdir(dir)).filter(f => /^[a-f0-9]{64}\.json$/.test(f)); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } }

// Web handlers call read/search/enqueue only. processNext belongs to a separate worker.
export function createTokenCatalog({ root = DEFAULT_ROOT, apiKey = process.env.JUPITER_API_KEY?.trim(), fetchImpl = fetch, now = Date.now, timeoutMs = 8000, minIntervalMs = 1000, maxResults = 500 } = {}) {
  const resultFile = key => path.join(root, 'results', `${key}.json`);
  const jobFile = key => path.join(root, 'queue', `${key}.json`);
  const assetFile = id => path.join(root, 'assets', `${keyFor(id)}.json`);
  let processing = false;
  async function lookupAsset(id) {
    if (typeof id !== 'string' || !/^jup_[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id)) return null;
    const asset = await readJson(assetFile(id));
    return asset?.id === id ? asset : null;
  }
  async function readSearch(input) {
    const query = normalizeQuery(input), key = keyFor(query);
    const [entry, queued] = await Promise.all([readJson(resultFile(key)), readJson(jobFile(key))]);
    const tokens = entry?.tokens || [];
    const fresh = !!entry?.updatedAt && now() - entry.updatedAt < (tokens.length ? TTL : 30_000);
    const status = queued ? 'pending' : fresh && !entry?.error ? 'ready' : entry?.error ? 'error' : apiKey ? 'pending' : 'unavailable';
    return { query, status, tokens, stale: tokens.length > 0 && (!fresh || !!entry?.error), updatedAt: entry?.updatedAt || null,
      ...(entry?.error ? { error: entry.error } : !apiKey ? { error: 'Token search is not configured. You can still use the starter assets.' } : {}),
      retryAfterMs: Math.max(1000, (entry?.nextRetryAt || 0) - now()) };
  }
  async function enqueue(input) {
    const query = normalizeQuery(input), key = keyFor(query);
    const entry = await readJson(resultFile(key));
    if (!apiKey || (entry?.nextRetryAt || 0) > now() || (entry?.updatedAt && !entry.error && now() - entry.updatedAt < (entry.tokens.length ? TTL : 30_000))) return readSearch(query);
    await mkdir(path.join(root, 'queue'), { recursive: true, mode: 0o700 });
    if ((await files(path.join(root, 'queue'))).length >= 100) return { ...await readSearch(query), status: 'error', error: 'Search is busy. Try again shortly.', retryAfterMs: 5000 };
    const temp = `${jobFile(key)}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify({ query, queuedAt: now() }), { mode: 0o600 });
      await link(temp, jobFile(key)); // Publish complete JSON atomically, without replacing an existing job.
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
    finally { await unlink(temp).catch(() => {}); }
    return readSearch(query);
  }
  async function processNext() {
    if (!apiKey || processing) return false;
    processing = true;
    try {
      const usageFile = path.join(root, 'worker.json');
      const prior = await readJson(usageFile) || {};
      if ((prior.nextAllowedAt || 0) > now()) return false;
      const queue = await files(path.join(root, 'queue'));
      const jobs = await Promise.all(queue.map(async file => {
        const filename = path.join(root, 'queue', file);
        try {
          const job = await readJson(filename);
          if (!job || !Number.isFinite(job.queuedAt) || normalizeQuery(job.query) !== job.query || `${keyFor(job.query)}.json` !== file) throw new SyntaxError('Invalid search job');
          return { file, job };
        } catch (error) {
          if (!(error instanceof SyntaxError) && error.code && error.code !== 'ENOENT') throw error;
          await unlink(filename).catch(e => { if (e.code !== 'ENOENT') throw e; });
          return { file, job: null };
        }
      }));
      const picked = jobs.filter(x => x.job).sort((a, b) => a.job.queuedAt - b.job.queuedAt)[0];
      if (!picked) return false;
      const { query } = picked.job, key = keyFor(query), old = await readJson(resultFile(key));
      const startedAt = now(), day = new Date(startedAt).toISOString().slice(0, 10);
      const usage = prior.day === day ? prior : { day, attempts: 0, successes: 0, failures: 0 };
      usage.attempts++; usage.lastAttemptAt = startedAt; usage.nextAllowedAt = startedAt + Math.max(1000, minIntervalMs);
      // Count attempts before sending. This ledger is scoped to the demo's share of the key.
      await writeJson(usageFile, usage);
      let error, nextRetryAt, status;
      try {
        const response = await fetchImpl(`${ENDPOINT}?query=${encodeURIComponent(query)}`, { headers: { 'x-api-key': apiKey, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
        status = response.status;
        if (response.status === 429) {
          const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
          const retry = Number(response.headers.get('retry-after')) * 1000;
          nextRetryAt = startedAt + Math.min(120_000, Math.max(10_000, reset - startedAt || 0, retry || 0));
          usage.nextAllowedAt = nextRetryAt;
          throw new Error('rate-limited');
        }
        if (!response.ok) throw new Error('provider-unavailable');
        if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('invalid-response');
        const reader = response.body.getReader(); let size = 0; const chunks = [];
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) throw new Error('invalid-response'); chunks.push(Buffer.from(value)); } }
        finally { await reader.cancel().catch(() => {}); }
        const rows = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(rows)) throw new Error('invalid-response');
        const unique = new Map(rows.map(row => catalogToken(row, now())).filter(Boolean).map(token => [token.id, token]));
        const tokens = [...unique.values()].slice(0, 20);
        if ((rows.length && !tokens.length) || (!tokens.length && old?.tokens?.length)) throw new Error('incomplete-response');
        for (const token of tokens) await writeJson(assetFile(token.id), token);
        await writeJson(resultFile(key), { query, tokens, updatedAt: now(), attempts: 0 });
        usage.successes++;
      } catch (e) {
        const attempts = (old?.attempts || 0) + 1;
        nextRetryAt ||= startedAt + Math.min(60_000, 2000 * 2 ** Math.min(attempts, 5));
        error = status === 429 ? 'Jupiter is busy. Cached results remain available; try again shortly.' : 'Token search could not refresh. Try again shortly.';
        await writeJson(resultFile(key), { query, tokens: old?.tokens || [], updatedAt: old?.updatedAt || null, attempts, error, nextRetryAt });
        usage.failures++;
      }
      usage.lastStatus = status || 'network-error';
      await writeJson(usageFile, usage);
      await unlink(path.join(root, 'queue', picked.file)).catch(e => { if (e.code !== 'ENOENT') throw e; });
      // Sessions copy selected metadata, so the shared catalog only retains cached search results.
      const results = await files(path.join(root, 'results'));
      const entries = await Promise.all(results.map(async file => ({ file, entry: await readJson(path.join(root, 'results', file)) })));
      entries.sort((a, b) => (b.entry?.updatedAt || 0) - (a.entry?.updatedAt || 0));
      for (const old of entries.slice(maxResults)) await unlink(path.join(root, 'results', old.file)).catch(() => {});
      const retained = new Set(entries.slice(0, maxResults).flatMap(({ entry }) => (entry?.tokens || []).map(token => `${keyFor(token.id)}.json`)));
      for (const file of await files(path.join(root, 'assets'))) {
        if (!retained.has(file)) await unlink(path.join(root, 'assets', file)).catch(() => {});
      }
      return true;
    } finally { processing = false; }
  }
  return { readSearch, enqueue, processNext, lookupAsset };
}
const catalog = createTokenCatalog();
export const readTokenSearch = catalog.readSearch;
export const enqueueTokenSearch = catalog.enqueue;
export const getCatalogAsset = catalog.lookupAsset;
export const processTokenSearch = catalog.processNext;
