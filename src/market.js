import { MARKET_SNAPSHOT } from './fixtures.js';
import { assetIdentity } from './transforms.js';

const JUPITER = 'https://api.jup.ag';
const GECKOTERMINAL = 'https://api.geckoterminal.com/api/v2';

async function fetchJson(url, apiKey) {
  const response = await fetch(url, { headers: apiKey ? { 'x-api-key': apiKey } : undefined, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Jupiter request failed with ${response.status}`);
  return response.json();
}

async function mapWithConcurrency(items, limit, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function tokenAsset(token, price) {
  const mint = token.address || token.mint;
  if (!mint) return null;
  return {
    ...assetIdentity(mint), symbol: token.symbol || mint.slice(0, 8), name: token.name || token.symbol || mint,
    imageUrl: token.icon || token.logoURI || '', decimals: Number.isInteger(token.decimals) ? token.decimals : 0,
    price: typeof price?.usdPrice === 'number' ? price.usdPrice : null,
    supply: null, totalSupply: token.supply ?? null, marketCap: price?.marketCap ?? null,
    change24h: price?.priceChange24h ?? null, change7d: null, change30d: null, priceHistory: [],
    actualprice: typeof price?.usdPrice === 'number' ? price.usdPrice : null, image: token.icon || token.logoURI || '',
    marketcap: price?.marketCap ?? null, pricedayminusone: null, percentdayminusone: price?.priceChange24h ?? null,
    priceweekminusone: null, percentweekminusone: null, pricemonthminusone: null, percentmonthminusone: null,
    contractname: mint, metadataSource: 'jupiter', marketDataSource: price ? 'jupiter' : null, historyDataSource: null
  };
}

export async function refreshMarket(apiKey, candidateMints = []) {
  if (!apiKey) return null;
  const mints = [...new Set([...MARKET_SNAPSHOT.assets.map((asset) => asset.mint), ...candidateMints])];
  try {
    const [tokens, prices] = await Promise.all([
      mapWithConcurrency(mints, 5, async (mint) => fetchJson(`${JUPITER}/tokens/v2/search?query=${encodeURIComponent(mint)}`, apiKey).then((payload) => (payload.data || payload || []).find((item) => (item.address || item.mint) === mint) || null)),
      fetchJson(`${JUPITER}/price/v3?ids=${encodeURIComponent(mints.join(','))}`, apiKey)
    ]);
    const priceData = prices.data || prices;
    const assets = tokens.map((token, index) => token ? tokenAsset(token, priceData[mints[index]]) : null).filter(Boolean);
    await mapWithConcurrency(assets, 5, async (asset) => {
      try {
        const history = await fetchJson(`${GECKOTERMINAL}/networks/solana/tokens/${encodeURIComponent(asset.mint)}/ohlcv/day?aggregate=1&limit=7&currency=usd`);
        const candles = history?.data?.attributes?.ohlcv_list;
        if (!Array.isArray(candles)) return;
        asset.priceHistory = candles.map(([timestamp, _open, _high, _low, close]) => ({ date: new Date(timestamp * 1000).toISOString(), price: close })).reverse();
        asset.historyDataSource = 'geckoterminal';
        const oldest = asset.priceHistory[0]?.price;
        if (typeof asset.price === 'number' && typeof oldest === 'number' && oldest > 0) asset.change7d = ((asset.price - oldest) / oldest) * 100;
      } catch (cause) {
        console.warn('GeckoTerminal history unavailable', { mint: asset.mint, message: cause.message });
      }
    });
    return { assets, source: 'jupiter', asOf: new Date().toISOString(), liveAssetCount: assets.filter((asset) => asset.marketDataSource).length, historySource: assets.some((asset) => asset.historyDataSource === 'geckoterminal') ? 'geckoterminal' : null };
  } catch (cause) {
    console.warn('Jupiter market refresh unavailable', { message: cause.message });
    return null;
  }
}
