import { MARKET_SNAPSHOT } from './fixtures.js';

const COINGECKO = 'https://api.coingecko.com/api/v3';
const DEX_SCREENER = 'https://api.dexscreener.com';

const LIVE_ASSETS = [
  { symbol: 'STX', coinId: 'blockstack', dexAddress: 'stx' },
  { symbol: 'ALEX', coinId: 'alexgo', dexAddress: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex' },
  { symbol: 'WELSH', coinId: 'welsh-corgi-coin', dexAddress: 'SP3NE50GEXFG9SZGTT51P40X2CKYSZ5CC4ZTZ7A2G.welshcorgicoin-token' },
  { symbol: 'LEO', coinId: 'leopold', dexAddress: 'SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6.leo-token' },
  { symbol: 'aBTC', coinId: 'xlink-bridged-btc-stacks', dexAddress: 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-abtc' }
];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Market provider request failed with ${response.status}`);
  return response.json();
}

function historyFrom(chart) {
  return chart.prices.map(([timestamp, price], index) => ({
    date: new Date(timestamp).toISOString(),
    price,
    marketCap: chart.market_caps[index]?.[1] ?? null,
    volume: chart.total_volumes[index]?.[1] ?? null
  }));
}

function bestDexPair(pairs, address) {
  return pairs
    .filter((pair) => pair.baseToken?.address === address && Number.isFinite(Number(pair.priceUsd)))
    .sort((left, right) => Number(right.liquidity?.usd || 0) - Number(left.liquidity?.usd || 0))[0];
}

export async function refreshMarket(apiKey) {
  if (!apiKey) return null;
  const ids = LIVE_ASSETS.map((asset) => asset.coinId);
  const headers = { 'x-cg-demo-api-key': apiKey };
  const [coins, ...charts] = await Promise.all([
    fetchJson(`${COINGECKO}/coins/markets?vs_currency=usd&ids=${ids.join(',')}&price_change_percentage=24h,7d,30d`, { headers }),
    ...LIVE_ASSETS.map((asset) => fetchJson(`${COINGECKO}/coins/${asset.coinId}/market_chart?vs_currency=usd&days=365`, { headers }))
  ]);
  const dexPairs = await fetchJson(`${DEX_SCREENER}/tokens/v1/stacks/${LIVE_ASSETS.map((asset) => asset.dexAddress).join(',')}`);
  const coinsById = new Map(coins.map((coin) => [coin.id, coin]));
  const assets = MARKET_SNAPSHOT.assets.map((asset) => ({ ...asset }));

  LIVE_ASSETS.forEach((definition, index) => {
    const asset = assets.find((item) => item.symbol === definition.symbol);
    const coin = coinsById.get(definition.coinId);
    if (!asset || !coin) return;
    const pair = bestDexPair(dexPairs, definition.dexAddress);
    const price = Number(pair?.priceUsd ?? coin.current_price);
    if (!Number.isFinite(price)) return;
    asset.price = price;
    asset.actualprice = price;
    asset.marketCap = String(coin.market_cap ?? asset.marketCap);
    asset.marketcap = asset.marketCap;
    asset.change24h = Number(coin.price_change_percentage_24h_in_currency ?? asset.change24h);
    asset.change7d = Number(coin.price_change_percentage_7d_in_currency ?? asset.change7d);
    asset.change30d = Number(coin.price_change_percentage_30d_in_currency ?? asset.change30d);
    asset.percentdayminusone = asset.change24h;
    asset.percentweekminusone = asset.change7d;
    asset.percentmonthminusone = asset.change30d;
    asset.imageUrl = coin.image || asset.imageUrl;
    asset.image = asset.imageUrl;
    asset.priceHistory = historyFrom(charts[index]);
    asset.marketDataSource = pair ? 'dexscreener' : 'coingecko';
    asset.historyDataSource = 'coingecko';
    asset.marketDataAsOf = coin.last_updated;
    asset.dex = pair ? {
      name: pair.dexId,
      pairAddress: pair.pairAddress,
      url: pair.url,
      liquidityUsd: pair.liquidity?.usd ?? null,
      volume24h: pair.volume?.h24 ?? null,
      buys24h: pair.txns?.h24?.buys ?? null,
      sells24h: pair.txns?.h24?.sells ?? null
    } : null;
  });

  return {
    assets,
    source: 'mixed',
    asOf: new Date().toISOString(),
    liveAssetCount: LIVE_ASSETS.length,
    historySource: 'coingecko'
  };
}
