import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { SOL_MINT } from '../src/constants.js';

function env(overrides = {}) { return { CORS_ORIGINS: 'https://app.example', SNAPSHOTS: { get: async () => null }, ...overrides }; }

test('health preserves its request ID envelope without a snapshot', async () => {
  const response = await worker.fetch(new Request('https://api.example/health'), env(), {});
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.data.status, 'ok'); assert.ok(body.meta.requestId);
});

test('protected refresh rejects requests without its token', async () => {
  const response = await worker.fetch(new Request('https://api.example/internal/refresh', { method: 'POST' }), env({ REFRESH_TOKEN: 'expected' }), {});
  assert.equal(response.status, 401); assert.equal((await response.json()).error.code, 'REFRESH_UNAUTHORIZED');
});

test('protected refresh publishes the snapshot when the optional dashboard cache is unavailable', async () => {
  const originalWarn = console.warn; console.warn = () => {};
  try {
    const response = await worker.fetch(new Request('https://api.example/internal/refresh', { method: 'POST', headers: { authorization: 'Bearer expected' } }), env({ REFRESH_TOKEN: 'expected' }), {});
    assert.equal(response.status, 200); assert.equal((await response.json()).data.status, 'refreshed');
  } finally { console.warn = originalWarn; }
});

test('v2 is canonical and v1 remains an asset route alias', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ prices: [[1_760_000_000_000, 150]] }) });
  try {
    const v2 = await worker.fetch(new Request('https://api.example/v2/assets/mint/' + SOL_MINT), env({ COINGECKO_DEMO_API_KEY: 'demo-key' }), {});
    const v1 = await worker.fetch(new Request('https://api.example/v1/assets/id/' + SOL_MINT), env({ COINGECKO_DEMO_API_KEY: 'demo-key' }), {});
    const asset = (await v2.json()).data;
    assert.equal(v2.status, 200); assert.equal(v1.status, 200);
    assert.equal(asset.chain, 'solana'); assert.equal(asset.mint, SOL_MINT); assert.equal(asset.contractId, SOL_MINT);
    assert.equal(asset.priceHistory[0].price, 150);
  } finally { globalThis.fetch = originalFetch; }
});

test('fixture responses preserve cache, CORS, and snapshot envelopes', async () => {
  const response = await worker.fetch(new Request('https://api.example/v2/assets', { headers: { origin: 'https://app.example' } }), env(), {});
  const body = await response.json();
  assert.equal(body.meta.snapshotState, 'fixture'); assert.equal(body.data.length, 3);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example');
});

test('v3 catalogs returns the snapshot-backed Jupiter list shape', async () => {
  const response = await worker.fetch(new Request('https://api.example/v3/catalogs'), env(), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.topTraded.length, 3);
  assert.deepEqual(body.data.trending, []);
  assert.deepEqual(body.data.recent, []);
});

test('v3 network returns an explicit unavailable fixture without fabricating metrics', async () => {
  const response = await worker.fetch(new Request('https://api.example/v3/network'), env(), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.chain.state, 'unavailable');
  assert.equal(body.data.chain.finalizedSlot, undefined);
});

test('v3 recent transactions returns a bounded cached feed without calling Helius', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('The public route must not call Helius.'); };
  try {
    const sample = { source: 'helius-rpc', asOf: new Date().toISOString(), slot: 123, network: { source: 'helius-rpc', fetchedAt: new Date().toISOString(), chain: { state: 'fresh', processedSlot: 121, confirmedSlot: 123, blockHeight: 100, epoch: 1 }, performance: { state: 'fresh', tps: 100, nonVoteTps: 80 }, fees: { state: 'fresh', averageFeeLamports: 5000 } }, transactions: Array.from({ length: 20 }, (_, index) => ({ signature: `sig-${index}`, slot: 123, blockTime: '2026-10-06T00:00:00.000Z', status: 'confirmed', action: index === 0 ? 'swap' : null })) };
    const response = await worker.fetch(new Request('https://api.example/v3/transactions/recent?limit=15'), env({ HELIUS_API_KEY: 'h', SNAPSHOTS: { get: async (key) => key === 'helius:v3:dashboard' ? sample : null, put: async () => {} } }), {});
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.data.transactions.length, 15);
    assert.equal(body.data.transactions[0].action, 'swap'); assert.equal(body.data.network.chain.confirmedSlot, 123); assert.equal(body.meta.recentTransactions.sampled, true); assert.equal(calls, 0);
    const invalid = await worker.fetch(new Request('https://api.example/v3/transactions/recent?limit=21'), env(), {});
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_RECENT_TRANSACTION_LIMIT');
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid mint and wallet paths return the existing not-found envelopes', async () => {
  const asset = await worker.fetch(new Request('https://api.example/v2/assets/mint/not-a-mint'), env(), {});
  const wallet = await worker.fetch(new Request('https://api.example/v2/wallets/not-a-wallet'), env(), {});
  assert.equal((await asset.json()).error.code, 'ASSET_NOT_FOUND');
  assert.equal((await wallet.json()).error.code, 'INVALID_WALLET_ADDRESS');
});

test('valid public wallets are not restricted to a configured list', async () => {
  const response = await worker.fetch(new Request(`https://api.example/v2/wallets/${SOL_MINT}`), env(), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'WALLET_LOOKUP_UNAVAILABLE');
});
