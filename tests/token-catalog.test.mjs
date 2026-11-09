import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTokenCatalog, catalogToken, normalizeQuery } from '../lib/token-catalog.mjs';

const mint = 'So11111111111111111111111111111111111111112';
const row = { id: mint, symbol: 'SOL', name: 'Wrapped SOL', decimals: 9, usdPrice: 99999, icon: 'http://localhost/private', isVerified: true };
async function setup(t, fetchImpl, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'index-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let now = 1_800_000_000_000;
  return { root, advance: ms => { now += ms; }, catalog: createTokenCatalog({ root, apiKey: 'unit-test-only', now: () => now, fetchImpl, ...options }) };
}
test('metadata is identified by mint; real prices, icons and unsafe fields never enter fixtures', () => {
  const asset = catalogToken({ ...row, symbol: '\u202eSOL\n', name: ' Wrapped SOL ' }, 50);
  assert.equal(asset.id, `jup_${mint}`); assert.equal(asset.sourceMint, mint); assert.equal(asset.sourceDecimals, 9);
  assert.equal(asset.symbol, 'SOL'); assert.equal(asset.price, 0.01); assert.equal(asset.updatedAt, 50);
  assert.equal(asset.icon, undefined); assert.equal(asset.usdPrice, undefined);
  assert.equal(catalogToken({ ...row, id: '../../etc/passwd' }), null);
  assert.equal(catalogToken({ ...row, decimals: -1 }), null);
  assert.equal(normalizeQuery(mint), mint); assert.equal(normalizeQuery(' BONK '), 'bonk');
  assert.throws(() => normalizeQuery('x')); assert.throws(() => normalizeQuery(['SOL']));
});
test('request path only enqueues; worker deduplicates and persists trusted assets and attempt usage', async t => {
  let calls = 0;
  const { catalog, root } = await setup(t, async (url, options) => {
    calls++; assert.equal(new URL(url).origin, 'https://api.jup.ag');
    assert.equal(options.headers['x-api-key'], 'unit-test-only');
    return Response.json([row, row]);
  });
  assert.equal((await catalog.enqueue('sol')).status, 'pending');
  await catalog.enqueue('SOL'); await catalog.readSearch('sol'); assert.equal(calls, 0);
  assert.equal(await catalog.processNext(), true); assert.equal(calls, 1);
  const result = await catalog.readSearch('sol'); assert.equal(result.status, 'ready'); assert.equal(result.tokens.length, 1);
  assert.deepEqual(await catalog.lookupAsset(`jup_${mint}`), result.tokens[0]);
  assert.equal(await catalog.lookupAsset('../../secret'), null);
  await catalog.enqueue('sol'); assert.equal(await catalog.processNext(), false); assert.equal(calls, 1);
  assert.equal((await readFile(path.join(root, 'worker.json'), 'utf8')).includes('unit-test-only'), false);
  const usage = JSON.parse(await readFile(path.join(root, 'worker.json'), 'utf8')); assert.equal(usage.attempts, 1); assert.equal(usage.successes, 1);
});
test('429 backs off the whole worker and retains stale last-good results', async t => {
  let rateLimited = false, calls = 0;
  const { catalog, advance } = await setup(t, async () => { calls++; return rateLimited ? new Response('', { status: 429, headers: { 'retry-after': '30' } }) : Response.json([row]); });
  await catalog.enqueue('sol'); await catalog.processNext(); advance(3_600_001); rateLimited = true;
  await catalog.enqueue('sol'); await catalog.processNext();
  const cached = await catalog.readSearch('sol'); assert.equal(cached.status, 'error'); assert.equal(cached.stale, true); assert.equal(cached.tokens.length, 1); assert.equal(cached.retryAfterMs, 30_000);
  await catalog.enqueue('other'); assert.equal(await catalog.processNext(), false); assert.equal(calls, 2);
});
for (const failure of ['empty', 'malformed', 'network', 'timeout']) test(`${failure} refresh retains last-good and returns a retry state`, async t => {
  let fail = false;
  const { catalog, advance } = await setup(t, async (_url, options) => {
    if (!fail) return Response.json([row]);
    if (failure === 'empty') return Response.json([]);
    if (failure === 'malformed') return Response.json({ error: 'unexpected' });
    if (failure === 'timeout') return new Promise((_, reject) => { const timer = setTimeout(() => {}, 100); options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('timeout with secret endpoint')); }, { once: true }); });
    throw new Error('network containing secret');
  }, { timeoutMs: 10 });
  await catalog.enqueue('sol'); await catalog.processNext(); advance(3_600_001); fail = true;
  await catalog.enqueue('sol'); await catalog.processNext();
  const result = await catalog.readSearch('sol'); assert.equal(result.tokens.length, 1); assert.equal(result.stale, true); assert.equal(result.status, 'error'); assert.doesNotMatch(result.error, /secret/);
});
test('unconfigured search makes zero provider calls and offers starter assets', async t => {
  const { catalog } = await setup(t, () => { throw new Error('must not call'); }, { apiKey: '' });
  assert.equal((await catalog.enqueue('sol')).status, 'unavailable'); assert.equal(await catalog.processNext(), false);
});

test('a malformed persisted job does not block valid queued searches', async t => {
  const { catalog, root } = await setup(t, async () => Response.json([row]));
  await mkdir(path.join(root, 'queue'), { recursive: true });
  const broken = path.join(root, 'queue', `${'0'.repeat(64)}.json`);
  await writeFile(broken, '{');
  await catalog.enqueue('sol');
  assert.equal(await catalog.processNext(), true);
  assert.equal((await catalog.readSearch('sol')).status, 'ready');
  await assert.rejects(readFile(broken), { code: 'ENOENT' });
});
test('catalog retention removes unreferenced assets while keeping recent results usable', async t => {
  const secondMint = '11111111111111111111111111111111';
  let second = false;
  const { catalog, advance } = await setup(t, async () => Response.json([{ ...row, id: second ? secondMint : mint }]), { maxResults: 1 });
  await catalog.enqueue('first'); await catalog.processNext();
  advance(1001); second = true;
  await catalog.enqueue('second'); await catalog.processNext();
  assert.equal(await catalog.lookupAsset(`jup_${mint}`), null);
  assert.equal((await catalog.lookupAsset(`jup_${secondMint}`)).sourceMint, secondMint);
  assert.equal((await catalog.readSearch('second')).status, 'ready');
});
