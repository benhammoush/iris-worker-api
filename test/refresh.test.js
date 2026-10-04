import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshSnapshot } from '../src/snapshot.js';
import { DEMO_WALLETS } from '../src/config.js';
import { MARKET_SNAPSHOT } from '../src/fixtures.js';

const wallets = DEMO_WALLETS;

test('refresh normalizes balances and transactions from the public Hiro endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => {
      const value = String(url);
      requests.push(value);
       if (value.includes('/mempool/fees')) return { estimated_cost: 1 };
       if (value.endsWith('/v2/info')) return { stacks_tip_height: 123 };
       if (value.endsWith('/stx_supply')) return { unlocked_stx: 1000000 };
       if (value.includes('/metadata/v1/ft?')) return { results: [] };
       if (value.includes('/metadata/v1/ft/')) return { symbol: 'ALEX', name: 'ALEX', decimals: 8, total_supply: '1', contract_principal: 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token', image_uri: 'https://images.example/alex.png' };
       if (value.includes('.dlmm-swap-router-v-1-2/transactions?')) return { results: Array.from({ length: 60 }, (_, index) => ({
         tx_id: `chain-${index}`, burn_block_time_iso: `2026-01-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`, block_height: index,
         tx_type: 'contract_call', tx_status: 'success', contract_call: { contract_id: 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-2', function_name: 'swap-y-for-x-simple-range-multi' }
       })) };
      const wallet = wallets.find(({ address }) => value.includes(address));
      if (value.includes('/balances')) return {
        stx: { balance: '1234567' },
        fungible_tokens: { 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token::alex': { balance: '2500000' } }
      };
      return {
        results: Array.from({ length: 30 }, (_, index) => ({
          tx: {
            tx_id: `${wallet.address}-${index}`,
            burn_block_time_iso: `2026-01-01T00:${String(index).padStart(2, '0')}:00.000Z`,
            block_height: index,
            tx_type: 'contract_call',
            tx_status: 'success',
            contract_call: { contract_id: 'SP123.dex', function_name: 'swap-helper' },
          },
          stx_transfers: [{ amount: '1', sender: 'SPsender', recipient: 'SPrecipient' }],
          nft_transfers: [{ asset_identifier: 'SP123.nft::collection', sender: 'SPsender', recipient: 'SPrecipient' }],
          untrusted: 'raw transaction field'
        }))
      };
    }
  });
  try {
    const writes = new Map();
    const snapshot = await refreshSnapshot({ SNAPSHOTS: { put: async (key, value) => writes.set(key, value) } }, { wallets }, new Date('2026-10-02T12:00:00.000Z'));
    assert.equal(snapshot.swaps.length, 50);
    assert.equal(snapshot.swaps[0].wallet, null);
    assert.deepEqual(Object.keys(snapshot.swaps[0]), ['id', 'txId', 'wallet', 'protocol', 'timestamp', 'blockHeight', 'contractId', 'functionName', 'status', 'input', 'output', 'side', 'value']);
    assert.equal(snapshot.swaps[0].untrusted, undefined);
    const demoA = snapshot.wallets[wallets[0].address];
    assert.equal(demoA.transactions.length, 25);
    assert.deepEqual(demoA.transactions[0].transfers, {
      stx: [{ asset: 'STX', amountAtomic: '1', amount: '1', sender: 'SPsender', recipient: 'SPrecipient' }], fungible: [],
      nft: [{ asset: 'SP123.nft::collection', amountAtomic: '1', amount: '1', sender: 'SPsender', recipient: 'SPrecipient' }]
    });
    assert.equal(demoA.transactions[0].id, `${wallets[0].address}-0`);
    assert.strictEqual(demoA.activity, demoA.transactions);
    assert.deepEqual(demoA.assets.map(({ symbol, rawBalance, balance, price }) => ({ symbol, rawBalance, balance, price })), [
      { symbol: 'STX', rawBalance: '1234567', balance: 1.234567, price: MARKET_SNAPSHOT.assets[0].price },
      { symbol: 'ALEX', rawBalance: '2500000', balance: 0.025, price: MARKET_SNAPSHOT.assets[1].price }
    ]);
    assert.equal(demoA.totalValue, demoA.portfolioTotal);
    assert.ok(requests.every((url) => url.startsWith('https://api.mainnet.hiro.so/')));
    assert.equal(requests.filter((url) => url.includes('/transactions_with_transfers?limit=100&offset=0')).length, 3);
    assert.equal(requests.filter((url) => url.includes('.dlmm-swap-router-v-1-2/transactions?limit=20&offset=')).length, 3);
    assert.equal(requests.some((url) => url.includes('/metadata/')), true);
    assert.equal(requests.some((url) => url.includes('alexgo.io')), false);
    assert.equal(snapshot.market.history.length, snapshot.assets.length);
    assert.equal(snapshot.market.source, 'snapshot');
    assert.equal(snapshot.market.asOf, MARKET_SNAPSHOT.asOf);
    assert.equal(snapshot.market.stxSupply, 1000000);
    assert.deepEqual(snapshot.assets, MARKET_SNAPSHOT.assets);
    assert.equal(writes.size, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
