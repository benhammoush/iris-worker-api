import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshMarket } from '../src/market.js';

test('market refresh combines CoinGecko history with the most liquid Stacks pair', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('/simple/price')) return {
      ok: true,
      json: async () => ({ blockstack: { usd: 1, usd_market_cap: 100, last_updated_at: 1760000000 }, alexgo: { usd: 2, usd_market_cap: 200, last_updated_at: 1760000000 } })
    };
    if (value.includes('/market_chart')) return {
      ok: true,
      json: async () => ({ prices: [[Date.now() - 31 * 24 * 60 * 60 * 1000, 1], [Date.now() - 8 * 24 * 60 * 60 * 1000, 1], [Date.now() - 25 * 60 * 60 * 1000, 1], [Date.now(), 2]], market_caps: [[Date.now() - 31 * 24 * 60 * 60 * 1000, 10], [Date.now() - 8 * 24 * 60 * 60 * 1000, 10], [Date.now() - 25 * 60 * 60 * 1000, 10], [Date.now(), 20]], total_volumes: [[Date.now() - 31 * 24 * 60 * 60 * 1000, 30], [Date.now() - 8 * 24 * 60 * 60 * 1000, 30], [Date.now() - 25 * 60 * 60 * 1000, 30], [Date.now(), 40]] })
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
    assert.equal(alex.priceHistory[0].price, 1);
    assert.equal(alex.priceHistory[0].marketCap, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('market refresh is disabled without a CoinGecko secret', async () => {
  assert.equal(await refreshMarket(undefined), null);
});
