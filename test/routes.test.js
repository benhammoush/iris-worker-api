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

test('v2 is canonical and v1 remains an asset route alias', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { attributes: { ohlcv_list: [[1_760_000_000, 1, 1, 1, 150]] } } }) });
  try {
    const v2 = await worker.fetch(new Request('https://api.example/v2/assets/mint/' + SOL_MINT), env(), {});
    const v1 = await worker.fetch(new Request('https://api.example/v1/assets/id/' + SOL_MINT), env(), {});
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
