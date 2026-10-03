import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAsset, marketCapString, priceChangePercent, supplyFromAtomic } from '../src/transforms.js';

test('preserves legacy supply, price-index percentage, and market-cap formulas', () => {
  assert.equal(supplyFromAtomic(123456789, 6), 123.456789);
  assert.equal(priceChangePercent('12', '10'), 20);
  assert.equal(marketCapString(123.456789, '12.5'), '1543');
});

test('buildAsset provides normalized fields while retaining exact legacy formulas', () => {
  const prices = Array.from({ length: 4051 }, (_, index) => ({ date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`, avg_price_usd: String(100 - index / 100) }));
  const asset = buildAsset(
    { symbol: 'ALEX', contract: 'SP123.token-alex' },
    { name: 'Alex Token', image_uri: 'https://assets.example/alex.png', decimals: 6, total_supply: 123456789, contract_principal: 'SP123.token-alex' },
    { prices },
    0
  );
  assert.equal(asset.name, 'Alex Token');
  assert.equal(asset.imageUrl, asset.image);
  assert.equal(asset.contractId, 'SP123.token-alex');
  assert.equal(asset.price, asset.actualprice);
  assert.equal(asset.supply, 123.456789);
  assert.equal(asset.totalSupply, 123456789);
  assert.equal(asset.marketCap, asset.marketcap);
  assert.equal(asset.change24h, asset.percentdayminusone);
  assert.equal(asset.change7d, asset.percentweekminusone);
  assert.equal(asset.change30d, asset.percentmonthminusone);
  assert.deepEqual(asset.priceHistory[0], { date: '2026-01-01', price: '100' });
  assert.equal(asset.priceHistory.length, 4051);
});
