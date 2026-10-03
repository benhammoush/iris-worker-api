import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function env(overrides = {}) {
  return { CORS_ORIGINS: 'https://app.example', SNAPSHOTS: { get: async () => null }, ...overrides };
}

test('health returns a request ID envelope without needing a snapshot', async () => {
  const response = await worker.fetch(new Request('https://api.example/health'), env(), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'ok');
  assert.ok(body.meta.requestId);
});

test('wallet listing returns metadata for all three public demo wallets', async () => {
  const response = await worker.fetch(new Request('https://api.example/v1/wallets'), env(), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.data, [
    { address: 'SP3MXB0HQH72ZGBTD6QWNRK9WNK1ZMMAXF6ANB2E8', label: 'Demo A', description: 'Public demo wallet with STX activity.' },
    { address: 'SP34SVHFFP532M35DHWTQJKJJR2DRGS7T5XEXQ0M0', label: 'Demo B', description: 'Public demo wallet with diversified assets.' },
    { address: 'SPG9HQ3A54KNP4V2HPJ20VBSFEE7W09ZBFJF2RNH', label: 'Demo C', description: 'Public demo wallet with recent STX activity.' }
  ]);
});

test('an unknown curated wallet returns the specified error code', async () => {
  const response = await worker.fetch(new Request('https://api.example/v1/wallets/SP0000000000000000000000000000000000000'), env(), {});
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'CURATED_WALLET_NOT_FOUND');
});

test('unconfigured snapshots resolve to the bundled static market fixture', async () => {
  const response = await worker.fetch(new Request('https://api.example/v1/assets'), env(), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.meta.snapshotState, 'fixture');
  assert.equal(body.data.length, 13);
  assert.equal(body.data.every((asset) => asset.symbol && asset.name && asset.imageUrl && asset.contractId
    && Number.isFinite(Number(asset.decimals)) && asset.price !== undefined && asset.supply !== undefined
    && asset.totalSupply !== undefined && asset.marketCap !== undefined && asset.change24h !== undefined
    && asset.change7d !== undefined && asset.change30d !== undefined && Array.isArray(asset.priceHistory)), true);
  assert.equal(body.meta.marketDataSource, 'snapshot');
  assert.equal(body.meta.marketDataAsOf, '2025-06-30T00:00:00.000Z');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-snapshot-state'), 'fixture');
});

test('status distinguishes the static market snapshot from refresh freshness', async () => {
  const response = await worker.fetch(new Request('https://api.example/v1/status'), env(), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.data.marketData, { source: 'snapshot', asOf: '2025-06-30T00:00:00.000Z' });
  assert.equal(body.data.snapshot.state, 'fixture');
});

test('ready resolves usable snapshot data rather than only probing KV', async () => {
  const response = await worker.fetch(new Request('https://api.example/ready'), env(), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'ready');
  assert.equal(body.data.snapshotState, 'fixture');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('asset paths reject malformed escapes and nested paths as not found', async () => {
  const malformed = await worker.fetch(new Request('https://api.example/v1/assets/%E0%A4%A'), env(), {});
  const nested = await worker.fetch(new Request('https://api.example/v1/assets/STX/extra'), env(), {});
  assert.equal(malformed.status, 404);
  assert.equal(nested.status, 404);
});
