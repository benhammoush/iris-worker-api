import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshMarket } from '../src/market.js';

test('market refresh combines CoinGecko history with the most liquid Stacks pair', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('/coins/markets')) return {
      ok: true,
      json: async () => [
        { id: 'blockstack', current_price: 1, market_cap: 100, image: 'stx.png', last_updated: '2026-10-03T12:00:00Z', price_change_percentage_24h_in_currency: 1, price_change_percentage_7d_in_currency: 2, price_change_percentage_30d_in_currency: 3 },
        { id: 'alexgo', current_price: 2, market_cap: 200, image: 'alex.png', last_updated: '2026-10-03T12:00:00Z', price_change_percentage_24h_in_currency: 4, price_change_percentage_7d_in_currency: 5, price_change_percentage_30d_in_currency: 6 }
      ]
    };
    if (value.includes('/market_chart')) return {
      ok: true,
      json: async () => ({ prices: [[1000, 1], [2000, 2]], market_caps: [[1000, 10], [2000, 20]], total_volumes: [[1000, 30], [2000, 40]] })
    };
    return {
      ok: true,
      json: async () => [
        { baseToken: { address: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex' }, priceUsd: '2.5', liquidity: { usd: 100 }, dexId: 'alex', pairAddress: 'low', url: 'https://dex.example/low' },
        { baseToken: { address: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex' }, priceUsd: '2.6', liquidity: { usd: 200 }, dexId: 'alex', pairAddress: 'high', url: 'https://dex.example/high', volume: { h24: 50 }, txns: { h24: { buys: 3, sells: 2 } } }
      ]
    };
  };
  try {
    const market = await refreshMarket('demo-key');
    const alex = market.assets.find((asset) => asset.symbol === 'ALEX');
    assert.equal(market.source, 'mixed');
    assert.equal(market.historySource, 'coingecko');
    assert.equal(alex.price, 2.6);
    assert.equal(alex.marketCap, '200');
    assert.equal(alex.marketDataSource, 'dexscreener');
    assert.equal(alex.historyDataSource, 'coingecko');
    assert.equal(alex.dex.pairAddress, 'high');
    assert.deepEqual(alex.priceHistory[0], { date: '1970-01-01T00:00:01.000Z', price: 1, marketCap: 10, volume: 30 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('market refresh is disabled without a CoinGecko secret', async () => {
  assert.equal(await refreshMarket(undefined), null);
});
