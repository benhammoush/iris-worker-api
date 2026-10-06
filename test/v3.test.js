import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { SOL_MINT } from '../src/constants.js';
import { mapV3Asset } from '../src/market.js';
import { historyForAsset } from '../src/routes.js';
import { loadV3Wallet, mapDasWallet, mapV3Event, mapV3HistoryPoints } from '../src/v3.js';
import { loadRecentTransactionSample, refreshRecentTransactionSample } from '../src/recentTransactions.js';

function env(overrides = {}) { return { CORS_ORIGINS: 'https://app.example', SNAPSHOTS: { get: async () => null, put: async () => {} }, ...overrides }; }

test('v3 asset mapping has only canonical fields and exact finite volume behavior', () => {
  const asset = mapV3Asset({ id: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, iconUrl: 'https://icon', usdPrice: Infinity, mcap: 1, stats24h: { buyVolume: 2, sellVolume: 3 }, isVerified: true, tags: ['verified', 4], organicScore: NaN });
  assert.deepEqual(Object.keys(asset), ['mint', 'symbol', 'name', 'decimals', 'iconUrl', 'priceUsd', 'marketCapUsd', 'circulatingSupply', 'totalSupply', 'fullyDilutedValuationUsd', 'change24hPct', 'liquidityUsd', 'holderCount', 'verification', 'quality', 'activity']);
  assert.equal(asset.priceUsd, null); assert.equal(asset.activity.volume24hUsd, 5);
  assert.equal(mapV3Asset({ id: SOL_MINT, stats24h: { buyVolume: 2, sellVolume: Infinity } }).activity.volume24hUsd, null);
});

test('v3 history points use timestamp and priceUsd without changing v2 cache points', () => {
  const points = [{ date: '2026-10-01T00:00:00.000Z', price: 1.25 }, { date: 'invalid', price: 2 }, { date: '2026-10-02T00:00:00.000Z', price: Infinity }];
  assert.deepEqual(mapV3HistoryPoints(points), [{ timestamp: '2026-10-01T00:00:00.000Z', priceUsd: 1.25 }]);
  assert.deepEqual(points[0], { date: '2026-10-01T00:00:00.000Z', price: 1.25 });
  assert.equal(mapV3HistoryPoints(null), null);
});

test('v3 canonical mint routes return range-aware canonical history points', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ prices: [[1_760_000_000_000, 150]] }) });
  try {
    const history = await worker.fetch(new Request(`https://api.example/v3/assets/mint/${SOL_MINT}/history?range=1d`), env({ COINGECKO_DEMO_API_KEY: 'key' }), {});
    const detail = await worker.fetch(new Request(`https://api.example/v3/assets/mint/${SOL_MINT}`), env({ COINGECKO_DEMO_API_KEY: 'key' }), {});
    const historyPoint = (await history.json()).data.points[0]; const detailPoint = (await detail.json()).data.history.points[0];
    assert.deepEqual(historyPoint, { timestamp: '2025-10-09T08:53:20.000Z', priceUsd: 150 }); assert.deepEqual(detailPoint, historyPoint);
  } finally { globalThis.fetch = originalFetch; }
});

test('v3 resolves a valid mint outside the snapshot through Jupiter', async () => {
  const mint = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('/tokens/v2/search')
    ? { ok: true, json: async () => [{ id: mint, symbol: 'JUP', name: 'Jupiter', decimals: 6, isVerified: true, usdPrice: 1 }] }
    : { ok: true, json: async () => ({ prices: [[1_760_000_000_000, 1]] }) };
  try {
    const response = await worker.fetch(new Request(`https://api.example/v3/assets/mint/${mint}`), env({ COINGECKO_DEMO_API_KEY: 'key', JUPITER_API_KEY: 'key' }), {});
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.data.mint, mint); assert.equal(body.data.symbol, 'JUP');
  } finally { globalThis.fetch = originalFetch; }
});

test('v3 history rejects unsupported ranges', async () => {
  const response = await worker.fetch(new Request(`https://api.example/v3/assets/mint/${SOL_MINT}/history?range=30d`), env(), {});
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'INVALID_HISTORY_RANGE');
});

test('v3 Parsed Events mapping preserves string raw amounts and rejects unsafe numbers', () => {
  const event = mapV3Event({ parserStatus: 'OK', signature: 'signature', parsed: { transactionStatus: 'OK', nativeTransfers: [{ amount: '9007199254740993123' }, { amount: Number.MAX_SAFE_INTEGER + 1 }], tokenTransfers: [{ mint: SOL_MINT, rawTokenAmount: { tokenAmount: '2500000', decimals: 6 } }, { mint: SOL_MINT, rawTokenAmount: '7', decimals: 9 }] } });
  assert.equal(event.transfers.native[0].atomicAmount, '9007199254740993123'); assert.equal(event.transfers.native[1].atomicAmount, null);
  assert.equal(event.transfers.tokens[0].atomicAmount, '2500000'); assert.equal(event.transfers.tokens[0].decimals, 6); assert.equal(event.transfers.tokens[1].atomicAmount, '7');
});

test('v3 history negative-caches unavailable CoinGecko responses', async () => {
  const values = new Map(); let calls = 0;
  const kv = { get: async (key) => values.get(key) || null, put: async (key, value) => values.set(key, JSON.parse(value)) };
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => ({ prices: [] }) }; };
  try {
    assert.equal((await historyForAsset(kv, SOL_MINT, 'key', 'test:')).state, 'unavailable');
    assert.equal((await historyForAsset(kv, SOL_MINT, 'key', 'test:')).state, 'unavailable');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('v3 history preserves a stale seven-day cache when CoinGecko reports unavailable', async () => {
  const cached = { fetchedAt: new Date(Date.now() - (31 * 60 * 1000)).toISOString(), points: [{ date: '2026-10-01T00:00:00.000Z', price: 1 }] };
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => ({ ok: true, json: async () => ({ prices: [] }) });
  try {
    const history = await historyForAsset({ get: async () => cached }, SOL_MINT, 'key', 'test:');
    assert.equal(history.state, 'stale'); assert.deepEqual(history.points, cached.points);
  } finally { globalThis.fetch = originalFetch; }
});

test('recent transaction samples batch parsed actions, preserve signature order, and retain stale data on failure', async () => {
  const cache = new Map(); let calls = 0;
  const snapshots = { get: async (key) => cache.get(key) || null, put: async (key, value) => cache.set(key, JSON.parse(value)) };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    if (request.method === 'getSlot') return { ok: true, json: async () => ({ result: 123 }) };
    if (request.method === 'getBlock') return { ok: true, json: async () => ({ result: { blockTime: 1_760_000_000, signatures: ['sig-a', 'sig-a', 'sig-b'] } }) };
    if (Array.isArray(request.transactions)) return { ok: true, json: async () => ({ data: [{ signature: 'sig-b', parsed: { summary: null, instructions: [{ instructionName: 'create_account' }] } }, { signature: 'sig-a', parsed: { summary: { type: 'swap' } } }] }) };
    throw new Error(`Unexpected ${request.method}`);
  };
  try {
    const now = new Date('2026-10-06T00:00:00.000Z');
    await refreshRecentTransactionSample(env({ SNAPSHOTS: snapshots, HELIUS_API_KEY: 'h' }), {}, now);
    const first = await loadRecentTransactionSample(env({ SNAPSHOTS: snapshots, HELIUS_API_KEY: 'h' }), {}, now);
    const second = await loadRecentTransactionSample(env({ SNAPSHOTS: snapshots, HELIUS_API_KEY: 'h' }), {}, new Date(now.getTime() + 10_000));
    assert.equal(first.freshness, 'fresh'); assert.deepEqual(first.transactions, [{ signature: 'sig-a', slot: 123, blockTime: '2025-10-09T08:53:20.000Z', status: 'confirmed', action: 'swap' }, { signature: 'sig-b', slot: 123, blockTime: '2025-10-09T08:53:20.000Z', status: 'confirmed', action: 'create_account' }]);
    assert.equal(second.freshness, 'fresh'); assert.equal(calls, 3);
    globalThis.fetch = async () => { throw new Error('provider unavailable'); };
    const stale = await loadRecentTransactionSample(env({ SNAPSHOTS: snapshots, HELIUS_API_KEY: 'h' }), {}, new Date(now.getTime() + 121_000));
    assert.equal(stale.freshness, 'stale'); assert.equal(stale.transactions.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('DAS wallet mapping preserves atomic balances, caps holdings, and reports partial valuation', () => {
  const result = { nativeBalance: { lamports: '1000000000' }, items: Array.from({ length: 41 }, (_, index) => ({ id: `Mint${index}`, token_info: { balance: '2500000', decimals: 6 } })) };
  const wallet = mapDasWallet('11111111111111111111111111111111', result, [{ mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, iconUrl: null, priceUsd: 100 }, { mint: 'Mint0', symbol: 'M0', name: 'M0', decimals: 6, iconUrl: null, priceUsd: 2 }]);
  assert.equal(wallet.balances.length, 40); assert.equal(wallet.holdingsTruncated, true); assert.equal(wallet.balances[0].atomicAmount, '1000000000');
  assert.equal(wallet.balancesTruncated, undefined); assert.equal(wallet.valuation.pricedSubtotalUsd, 105); assert.equal(wallet.valuation.pricedHoldingCount, 2); assert.equal(wallet.valuation.unpricedHoldingCount, 38); assert.equal(wallet.valuation.complete, false);
});

test('v3 wallet returns DAS balances as unpriced when Jupiter enrichment rejects', async () => {
  const originalFetch = globalThis.fetch; const originalWarn = console.warn;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: { nativeBalance: { lamports: '1000000000' }, items: [{ id: 'Mint1', token_info: { balance: '2500000', decimals: 6 } }] } }) });
  console.warn = () => {};
  try {
    const wallet = (await loadV3Wallet(env({ HELIUS_API_KEY: 'h', JUPITER_API_KEY: 'j' }), {}, SOL_MINT, async () => { throw new Error('Jupiter unavailable'); })).wallet;
    assert.deepEqual(wallet.balances, [
      { mint: SOL_MINT, symbol: null, name: null, decimals: 9, iconUrl: null, atomicAmount: '1000000000', amount: '1', priceUsd: null, valueUsd: null },
      { mint: 'Mint1', symbol: null, name: null, decimals: 6, iconUrl: null, atomicAmount: '2500000', amount: '2.5', priceUsd: null, valueUsd: null }
    ]);
    assert.deepEqual(wallet.valuation, { pricedSubtotalUsd: 0, holdingCount: 2, pricedHoldingCount: 0, unpricedHoldingCount: 2, complete: false });
  } finally { globalThis.fetch = originalFetch; console.warn = originalWarn; }
});

test('v3 wallet propagates DAS failures before attempting Jupiter enrichment', async () => {
  const originalFetch = globalThis.fetch; let jupiterRequested = false;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    await assert.rejects(loadV3Wallet(env({ HELIUS_API_KEY: 'h', JUPITER_API_KEY: 'j' }), {}, SOL_MINT, async () => { jupiterRequested = true; }), /Helius RPC request failed with 503/);
    assert.equal(jupiterRequested, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('v3 wallet cache, transaction pagination defaults, CORS, and v2 compatibility', async () => {
  const originalFetch = globalThis.fetch; const writes = []; const cache = new Map(); const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url); requests.push({ value, options });
    if (value.includes('/v1/parsed-events/transaction-history')) return { ok: true, json: async () => ({ data: Array.from({ length: 25 }, (_, index) => ({ signature: `sig${index}`, parserStatus: 'OK', parsed: { blockTime: 1, transactionStatus: 'OK', summary: { type: 'transfer', description: 'Transferred SOL', parsedData: { protocol: 'system' } }, nativeTransfers: [{ fromUserAccount: 'from', toUserAccount: 'to', amount: 9007199254740993n.toString() }], tokenTransfers: [{ mint: SOL_MINT, fromUserAccount: 'from', toUserAccount: 'to', rawTokenAmount: '2500000', decimals: 6, tokenStandard: 'Fungible' }] } })), paginationToken: '433950192:0' }) };
    if (value.includes('mainnet.helius-rpc.com')) return { ok: true, json: async () => ({ result: { nativeBalance: { lamports: '1000000000' }, items: [] } }) };
    if (value.includes('/tokens/')) return { ok: true, json: async () => [{ id: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, usdPrice: 100, isVerified: true }] };
    return { ok: true, json: async () => ({ prices: [[1_760_000_000_000, 150]] }) };
  };
  const snapshots = { get: async (key) => cache.get(key) || null, put: async (key, value) => { writes.push({ key, value }); cache.set(key, JSON.parse(value)); } };
  try {
    const options = await worker.fetch(new Request('https://api.example/v3/wallets/x', { method: 'OPTIONS', headers: { origin: 'https://app.example' } }), env({ SNAPSHOTS: snapshots }), {});
    assert.match(options.headers.get('access-control-allow-methods'), /POST/); assert.match(options.headers.get('access-control-allow-headers'), /authorization/);
    const first = await worker.fetch(new Request(`https://api.example/v3/wallets/${SOL_MINT}`), env({ SNAPSHOTS: snapshots, HELIUS_API_KEY: 'h', JUPITER_API_KEY: 'j' }), {});
    const second = await worker.fetch(new Request(`https://api.example/v3/wallets/${SOL_MINT}`), env({ SNAPSHOTS: snapshots, HELIUS_API_KEY: 'h', JUPITER_API_KEY: 'j' }), {});
    const firstBody = await first.json(); const secondBody = await second.json();
    assert.equal(firstBody.data.cacheState, undefined); assert.equal(firstBody.meta.wallet.cacheState, 'miss'); assert.equal(secondBody.meta.wallet.cacheState, 'fresh'); assert.ok(firstBody.meta.wallet.asOf); assert.equal(writes.length, 1);
    const transactions = await worker.fetch(new Request(`https://api.example/v3/wallets/${SOL_MINT}/transactions`), env({ HELIUS_API_KEY: 'h' }), {});
    const transactionBody = await transactions.json(); const parsedRequest = requests.find((request) => request.value.includes('/v1/parsed-events/transaction-history'));
    assert.equal(transactionBody.data.nextCursor, '433950192:0'); assert.equal(transactionBody.data.events[0].summary, 'Transferred SOL'); assert.equal(transactionBody.data.events[0].transfers.native[0].atomicAmount, '9007199254740993'); assert.equal(transactionBody.data.events[0].transfers.tokens[0].decimals, 6);
    assert.match(parsedRequest.value, /^https:\/\/mainnet\.helius-rpc\.com\/v1\/parsed-events\/transaction-history\?api-key=h$/); assert.equal(parsedRequest.options.method, 'POST'); assert.deepEqual(JSON.parse(parsedRequest.options.body), { address: SOL_MINT, limit: 25, sortOrder: 'desc', commitment: 'confirmed' });
    const dasRequest = requests.find((request) => request.value.includes('mainnet.helius-rpc.com') && request.options.body && JSON.parse(request.options.body).method === 'getAssetsByOwner');
    assert.deepEqual(JSON.parse(dasRequest.options.body).params, { ownerAddress: SOL_MINT, page: 1, limit: 100, displayOptions: { showFungible: true, showNativeBalance: true, showGrandTotal: true } });
    const eventsAlias = await worker.fetch(new Request(`https://api.example/v3/wallets/${SOL_MINT}/events?cursor=433950192%3A0`), env({ HELIUS_API_KEY: 'h' }), {});
    assert.equal(eventsAlias.status, 200);
    const cursorRequest = requests.filter((request) => request.value.includes('/v1/parsed-events/transaction-history')).at(-1);
    assert.equal(JSON.parse(cursorRequest.options.body).paginationToken, '433950192:0');
    const malformed = await worker.fetch(new Request(`https://api.example/v3/wallets/${SOL_MINT}/transactions/extra`), env({ HELIUS_API_KEY: 'h' }), {});
    assert.equal(malformed.status, 404); assert.equal((await malformed.json()).error.code, 'NOT_FOUND');
    const v2 = await worker.fetch(new Request('https://api.example/v2/assets'), env({ SNAPSHOTS: snapshots }), {});
    assert.equal(v2.status, 200); assert.ok(Array.isArray((await v2.json()).data));
  } finally { globalThis.fetch = originalFetch; }
});
