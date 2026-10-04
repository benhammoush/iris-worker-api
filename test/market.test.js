import test from 'node:test';
import assert from 'node:assert/strict';
import { SOL_MINT } from '../src/constants.js';
import { refreshMarket } from '../src/market.js';

test('market refresh uses Jupiter token metadata and prices', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => String(url).includes('/search?') ? [{ address: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, icon: 'https://assets.example/sol.png' }] : { [SOL_MINT]: { usdPrice: 150, priceChange24h: 2.5 } } });
  try {
    const market = await refreshMarket('jupiter-key', [SOL_MINT]);
    const sol = market.assets.find((asset) => asset.mint === SOL_MINT);
    assert.equal(market.source, 'jupiter');
    assert.equal(sol.price, 150);
    assert.equal(sol.contractId, SOL_MINT);
    assert.equal(sol.marketDataSource, 'jupiter');
  } finally { globalThis.fetch = originalFetch; }
});

test('market refresh falls back when no Jupiter key is configured', async () => {
  assert.equal(await refreshMarket(undefined), null);
});
