import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CATALOG_ASSETS, SOL_MINT } from '../src/constants.js';
import { fetchPriceHistory, refreshMarket } from '../src/market.js';

test('market refresh uses Jupiter Tokens V2 fields for the verified ranked catalog', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => String(url).includes('/toptraded/') ? [
    { id: 'UnverifiedMint1111111111111111111111111111111', symbol: 'RISK', isVerified: false },
    { id: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6, icon: 'https://assets.example/jup.png', isVerified: true, usdPrice: 0.7, mcap: 700000000, circSupply: 1000000000, totalSupply: 1000000000, stats24h: { priceChange: 2.5 } }
  ] : [{ id: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, isVerified: true, usdPrice: 150, mcap: 80000000000, circSupply: 500000000, totalSupply: 600000000, stats24h: { priceChange: 1.5 } }] });
  try {
    const market = await refreshMarket('jupiter-key');
    const sol = market.assets.find((asset) => asset.mint === SOL_MINT);
    assert.equal(market.source, 'jupiter');
    assert.equal(sol.price, 150);
    assert.equal(sol.marketCap, 80000000000);
    assert.equal(sol.supply, 500000000);
    assert.equal(sol.totalSupply, 600000000);
    assert.equal(sol.contractId, SOL_MINT);
    assert.equal(sol.marketDataSource, 'jupiter');
    assert.equal(market.assets.some((asset) => asset.symbol === 'RISK'), false);
    assert.ok(market.assets.length <= MAX_CATALOG_ASSETS);
  } finally { globalThis.fetch = originalFetch; }
});

test('market refresh preserves missing provider values as null', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [{ id: SOL_MINT, symbol: 'SOL', isVerified: true }] });
  try {
    const [sol] = (await refreshMarket('jupiter-key', [SOL_MINT])).assets;
    assert.equal(sol.price, null);
    assert.equal(sol.marketCap, null);
    assert.equal(sol.supply, null);
    assert.equal(sol.priceHistory, null);
  } finally { globalThis.fetch = originalFetch; }
});

test('market refresh falls back when no Jupiter key is configured', async () => {
  assert.equal(await refreshMarket(undefined), null);
});

test('CoinGecko Demo uses range-specific auto-granularity without truncating points', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, json: async () => ({ prices: [[1_760_000_000_000, 150], [1_760_086_400_000, 151]] }) };
  };
  try {
    const points = await fetchPriceHistory(SOL_MINT, 'coingecko-demo-key', '1d');
    assert.match(request.url, /coins\/solana\/contract\/So11111111111111111111111111111111111111112\/market_chart/);
    assert.match(request.url, /days=1/);
    assert.doesNotMatch(request.url, /interval=/);
    assert.equal(request.options.headers['x-cg-demo-api-key'], 'coingecko-demo-key');
    assert.deepEqual(points.map((point) => point.price), [150, 151]);
  } finally { globalThis.fetch = originalFetch; }
});
