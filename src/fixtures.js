import { assetIdentity } from './transforms.js';
import { SOL_MINT } from './constants.js';

export const MARKET_SNAPSHOT_AS_OF = '2025-06-30T00:00:00.000Z';
const HISTORY_DATES = [MARKET_SNAPSHOT_AS_OF, '2025-06-29T00:00:00.000Z', '2025-06-23T00:00:00.000Z', '2025-05-31T00:00:00.000Z'];

function staticAsset(symbol, name, mint, decimals, price, totalSupply = null) {
  const priceHistory = [price, price, price, price].map((historyPrice, index) => ({ date: HISTORY_DATES[index], price: historyPrice }));
  return {
    ...assetIdentity(mint), symbol, name, imageUrl: '', decimals, price, supply: null, totalSupply,
    marketCap: null, change24h: null, change7d: null, change30d: null, priceHistory,
    actualprice: price, image: '', marketcap: null, pricedayminusone: price, percentdayminusone: null,
    priceweekminusone: price, percentweekminusone: null, pricemonthminusone: price, percentmonthminusone: null,
    contractname: mint
  };
}

export const MARKET_SNAPSHOT = Object.freeze({
  source: 'fixture',
  asOf: MARKET_SNAPSHOT_AS_OF,
  assets: [
    staticAsset('SOL', 'Solana', SOL_MINT, 9, 150),
    staticAsset('USDC', 'USD Coin', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6, 1),
    staticAsset('JUP', 'Jupiter', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 6, 0.7)
  ]
});

export const FIXTURE_SNAPSHOT = {
  version: 1, createdAt: '1970-01-01T00:00:00.000Z', source: 'fixture',
  market: { fees: null, slot: null, block_height: null, source: MARKET_SNAPSHOT.source, asOf: MARKET_SNAPSHOT.asOf, history: MARKET_SNAPSHOT.assets.map((asset) => ({ mint: asset.mint, symbol: asset.symbol, points: asset.priceHistory })) },
  assets: MARKET_SNAPSHOT.assets, wallets: {}, swaps: []
};
