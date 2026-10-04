import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshSnapshot } from '../src/snapshot.js';
import { SOL_MINT } from '../src/constants.js';

const wallet = { address: '11111111111111111111111111111111', label: 'Demo', description: 'Test wallet' };
const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

test('refresh uses Helius RPC and decoded enhanced activity without numeric raw balances', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url); requests.push(value);
    if (value.includes('helius-rpc')) {
      const method = JSON.parse(options.body).method;
      if (method === 'getBalance') return { ok: true, json: async () => ({ result: { value: 9007199254740993000n.toString() } }) };
      if (options.body.includes('TokenzQdYQneH1k9i7gNJYkC7V3Tv1ALb6TrC3CFQeX')) return { ok: true, json: async () => ({ result: { value: [] } }) };
      return { ok: true, json: async () => ({ result: { value: [{ account: { data: { parsed: { info: { mint: usdc, tokenAmount: { amount: '2500000', decimals: 6 } } } } } }] } }) };
    }
    if (value.includes('/addresses/')) return { ok: true, json: async () => [{ signature: 'signature', timestamp: 1760000000, slot: 123, type: 'SWAP', source: 'RAYDIUM', accountData: [{ account: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2' }], tokenTransfers: [{ mint: usdc, rawTokenAmount: { tokenAmount: '2500000', decimals: 6 } }] }] };
    if (value.includes('/tokens/')) return { ok: true, json: async () => [{ address: value.includes(encodeURIComponent(usdc)) ? usdc : SOL_MINT, symbol: value.includes(encodeURIComponent(usdc)) ? 'USDC' : 'SOL', name: 'Token', decimals: 6 }] };
    return { ok: true, json: async () => ({ [SOL_MINT]: { usdPrice: 150 }, [usdc]: { usdPrice: 1 } }) };
  };
  try {
    const writes = new Map();
    const snapshot = await refreshSnapshot({ SNAPSHOTS: { put: async (key, value) => writes.set(key, value) } }, { wallets: [wallet], heliusApiKey: 'helius-key', jupiterApiKey: 'jupiter-key' }, new Date('2026-10-02T12:00:00.000Z'));
    const data = snapshot.wallets[wallet.address];
    assert.equal(snapshot.source, 'helius-jupiter');
    assert.equal(snapshot.swaps.length, 1);
    assert.equal(snapshot.swaps[0].protocol, 'Raydium AMM');
    assert.equal(snapshot.market.swaps.scope, 'registered-liquid-pools');
    assert.equal(data.assets[0].rawBalance, '9007199254740993000');
    assert.equal(typeof data.assets[0].rawBalance, 'string');
    assert.equal(data.assets[1].balance, '2.5');
    assert.equal(data.transactions[0].chain, 'solana');
    assert.equal(requests.some((url) => url.includes('hiro')), false);
    assert.equal(writes.size, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('refresh writes the Solana fixture when Helius is not configured', async () => {
  const writes = new Map();
  const snapshot = await refreshSnapshot({ SNAPSHOTS: { put: async (key, value) => writes.set(key, value) } }, { wallets: [wallet] }, new Date('2026-10-02T12:00:00.000Z'));
  assert.equal(snapshot.source, 'fixture');
  assert.equal(snapshot.assets[0].mint, SOL_MINT);
  assert.equal(writes.size, 2);
});
