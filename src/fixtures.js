import { marketCapString, priceChangePercent, supplyFromAtomic } from './transforms.js';

export const MARKET_SNAPSHOT_AS_OF = '2025-06-30T00:00:00.000Z';

const HISTORY_DATES = [MARKET_SNAPSHOT_AS_OF, '2025-06-29T00:00:00.000Z', '2025-06-23T00:00:00.000Z', '2025-05-31T00:00:00.000Z'];

// Demonstration market data bundled with the Worker. It is never presented as live pricing.
const MARKET_ASSET_INPUTS = [
  ['STX', 'Stacks', 'https://cryptologos.cc/logos/stacks-stx-logo.png?v=029', 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wstx', 6, 1818000000000000, ['1.62', '1.58', '1.49', '1.74']],
  ['ALEX', 'ALEX', '/logoiris.png', 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token', 8, 60648900000000000, ['0.043', '0.041', '0.039', '0.051']],
  ['xBTC', 'xBTC', '/logoiris.png', 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wbtc', 8, 2100000000000000, ['104250', '102900', '101300', '106700']],
  ['sUSDT', 'sUSDT', '/logoiris.png', 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-susdt', 6, 1000000000000000, ['1.00', '1.00', '1.00', '1.00']],
  ['xUSD', 'xUSD', '/logoiris.png', 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wxusd', 8, 1000000000000000, ['0.996', '0.995', '0.992', '1.001']],
  ['USDA', 'USDA', '/logoiris.png', 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wusda', 6, 1000000000000000, ['0.999', '1.00', '0.998', '1.00']],
  ['DIKO', 'Arkadiko', '/logoiris.png', 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wdiko', 6, 1000000000000000, ['0.031', '0.030', '0.028', '0.036']],
  ['MIA', 'MiamiCoin', '/logoiris.png', 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wmia', 6, 100000000000000000, ['0.00022', '0.00021', '0.00020', '0.00025']],
  ['NYC', 'NewYorkCityCoin', '/logoiris.png', 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wnycc', 6, 100000000000000000, ['0.00014', '0.00013', '0.00012', '0.00016']],
  ['WELSH', 'Welshcorgicoin', '/logoiris.png', 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wcorgi', 6, 1000000000000000000, ['0.0000021', '0.0000020', '0.0000019', '0.0000024']],
  ['LEO', 'LEO', '/logoiris.png', 'SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6.token-wleo', 6, 1000000000000000, ['0.014', '0.013', '0.012', '0.016']],
  ['GUS', 'GUS', '/logoiris.png', 'SP1JFFSYTSH7VBM54K29ZFS9H4SVB67EA8VT2MYJ9.token-wgus', 6, 1000000000000000, ['0.007', '0.0068', '0.0065', '0.008']],
  ['aBTC', 'aBTC', '/logoiris.png', 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-abtc', 8, 2100000000000000, ['104100', '102800', '101100', '106500']]
];

function staticAsset([symbol, name, imageUrl, contractId, decimals, totalSupply, prices]) {
  const [price, dayPrice, weekPrice, monthPrice] = prices;
  const supply = supplyFromAtomic(totalSupply, decimals);
  const change24h = priceChangePercent(price, dayPrice);
  const change7d = priceChangePercent(price, weekPrice);
  const change30d = priceChangePercent(price, monthPrice);
  const priceHistory = prices.map((historyPrice, index) => ({ date: HISTORY_DATES[index], price: historyPrice }));
  return {
    symbol, name, imageUrl, contractId, decimals, price, supply, totalSupply,
    marketCap: marketCapString(supply, price), change24h, change7d, change30d, priceHistory,
    actualprice: price, image: imageUrl, marketcap: marketCapString(supply, price),
    pricedayminusone: dayPrice, percentdayminusone: change24h,
    priceweekminusone: weekPrice, percentweekminusone: change7d,
    pricemonthminusone: monthPrice, percentmonthminusone: change30d,
    contractname: contractId.split('.')[1]
  };
}

export const MARKET_SNAPSHOT = Object.freeze({
  source: 'snapshot',
  asOf: MARKET_SNAPSHOT_AS_OF,
  assets: MARKET_ASSET_INPUTS.map(staticAsset)
});

export const FIXTURE_SNAPSHOT = {
  version: 1,
  createdAt: '1970-01-01T00:00:00.000Z',
  source: 'fixture',
  market: {
    fees: null,
    stacksTipHeight: null,
    block_height: null,
    source: MARKET_SNAPSHOT.source,
    asOf: MARKET_SNAPSHOT.asOf,
    history: MARKET_SNAPSHOT.assets.map((asset) => ({ symbol: asset.symbol, points: asset.priceHistory }))
  },
  assets: MARKET_SNAPSHOT.assets,
  wallets: {},
  swaps: []
};
