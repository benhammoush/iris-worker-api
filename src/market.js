import { MARKET_SNAPSHOT } from './fixtures.js';
import { priceChangePercent } from './transforms.js';

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

function nearestPrice(history, target) {
  return history.reduce((closest, point) => {
    if (!closest || Math.abs(Date.parse(point.date) - target) < Math.abs(Date.parse(closest.date) - target)) return point;
    return closest;
  }, null)?.price;
}

export async function refreshMarket(apiKey) {
  if (!apiKey) return null;
  const ids = LIVE_ASSETS.map((asset) => asset.coinId);
  const headers = { 'x-cg-demo-api-key': apiKey };
  const [prices, ...charts] = await Promise.all([
    fetchJson(`${COINGECKO}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`, { headers }),
    ...LIVE_ASSETS.map((asset) => fetchJson(`${COINGECKO}/coins/${asset.coinId}/market_chart?vs_currency=usd&days=365`, { headers }))
  ]);
  const dexPairs = await fetchJson(`${DEX_SCREENER}/tokens/v1/stacks/${LIVE_ASSETS.map((asset) => asset.dexAddress).join(',')}`);
  const assets = MARKET_SNAPSHOT.assets.map((asset) => ({ ...asset }));

  LIVE_ASSETS.forEach((definition, index) => {
    const asset = assets.find((item) => item.symbol === definition.symbol);
    const quote = prices[definition.coinId];
    if (!asset || !quote) return;
    const pair = bestDexPair(dexPairs, definition.dexAddress);
    const history = historyFrom(charts[index]);
    const price = Number(pair?.priceUsd ?? quote.usd);
    if (!Number.isFinite(price)) return;
    const now = Date.now();
    const dayPrice = nearestPrice(history, now - 24 * 60 * 60 * 1000);
    const weekPrice = nearestPrice(history, now - 7 * 24 * 60 * 60 * 1000);
    const monthPrice = nearestPrice(history, now - 30 * 24 * 60 * 60 * 1000);
    asset.price = price;
    asset.actualprice = price;
    asset.marketCap = String(quote.usd_market_cap ?? asset.marketCap);
    asset.marketcap = asset.marketCap;
    asset.change24h = Number.isFinite(Number(dayPrice)) ? priceChangePercent(price, dayPrice) : asset.change24h;
    asset.change7d = Number.isFinite(Number(weekPrice)) ? priceChangePercent(price, weekPrice) : asset.change7d;
    asset.change30d = Number.isFinite(Number(monthPrice)) ? priceChangePercent(price, monthPrice) : asset.change30d;
    asset.percentdayminusone = asset.change24h;
    asset.percentweekminusone = asset.change7d;
    asset.percentmonthminusone = asset.change30d;
    asset.priceHistory = history;
    asset.marketDataSource = pair ? 'dexscreener' : 'coingecko';
    asset.historyDataSource = 'coingecko';
    asset.marketDataAsOf = new Date(Number(quote.last_updated_at || now) * 1000).toISOString();
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
