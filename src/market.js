import { MAX_CATALOG_ASSETS, SOL_MINT } from './constants.js';
import { assetIdentity } from './transforms.js';

const JUPITER = 'https://api.jup.ag';
const GECKOTERMINAL = 'https://api.geckoterminal.com/api/v2';

async function fetchJson(url, apiKey, provider) {
  const response = await fetch(url, { headers: apiKey ? { 'x-api-key': apiKey } : undefined, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${provider} request failed with ${response.status}`);
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

function tokenAsset(token) {
  const mint = token.id || token.address || token.mint;
  if (!mint) return null;
  return {
    ...assetIdentity(mint), symbol: token.symbol || mint.slice(0, 8), name: token.name || token.symbol || mint,
    imageUrl: token.icon || token.logoURI || '', decimals: Number.isInteger(token.decimals) ? token.decimals : 0,
    price: typeof token.usdPrice === 'number' ? token.usdPrice : null,
    supply: token.circSupply ?? null, totalSupply: token.totalSupply ?? null, marketCap: token.mcap ?? null,
    change24h: token.stats24h?.priceChange ?? token.priceChange24h ?? null, change7d: null, change30d: null, priceHistory: null,
    actualprice: typeof token.usdPrice === 'number' ? token.usdPrice : null, image: token.icon || token.logoURI || '',
    marketcap: token.mcap ?? null, pricedayminusone: null, percentdayminusone: token.stats24h?.priceChange ?? token.priceChange24h ?? null,
    priceweekminusone: null, percentweekminusone: null, pricemonthminusone: null, percentmonthminusone: null,
    contractname: mint, metadataSource: 'jupiter', marketDataSource: 'jupiter', historyDataSource: null
  };
}

function payloadItems(payload) {
  return Array.isArray(payload) ? payload : payload?.data || [];
}

async function tokenByMint(mint, apiKey) {
  const items = payloadItems(await fetchJson(`${JUPITER}/tokens/v2/search?query=${encodeURIComponent(mint)}`, apiKey, 'Jupiter'));
  return items.find((item) => (item.id || item.address || item.mint) === mint) || null;
}

function catalogTokens(tokens) {
  const byMint = new Map();
  for (const token of tokens) {
    const mint = token?.id || token?.address || token?.mint;
    if (!mint || (!token.isVerified && mint !== SOL_MINT) || byMint.has(mint)) continue;
    byMint.set(mint, token);
  }
  return [...byMint.values()].slice(0, MAX_CATALOG_ASSETS);
}

export async function refreshMarket(apiKey, candidateMints = null) {
  if (!apiKey) return null;
  try {
    let tokens;
    if (Array.isArray(candidateMints)) {
      tokens = (await mapWithConcurrency([...new Set(candidateMints)], 5, (mint) => tokenByMint(mint, apiKey))).filter(Boolean);
    } else {
      tokens = payloadItems(await fetchJson(`${JUPITER}/tokens/v2/toptraded/24h?limit=${MAX_CATALOG_ASSETS}`, apiKey, 'Jupiter'));
      if (!tokens.some((token) => (token.id || token.address || token.mint) === SOL_MINT)) {
        const sol = await tokenByMint(SOL_MINT, apiKey);
        if (sol) tokens = [sol, ...tokens];
      }
      tokens = catalogTokens(tokens);
    }
    const assets = tokens.map(tokenAsset).filter(Boolean);
    return { assets, source: 'jupiter', asOf: new Date().toISOString(), liveAssetCount: assets.length, historySource: null };
  } catch (cause) {
    console.warn('Jupiter market refresh unavailable', { message: cause.message });
    return null;
  }
}

export async function fetchPriceHistory(mint) {
  const payload = await fetchJson(`${GECKOTERMINAL}/networks/solana/tokens/${encodeURIComponent(mint)}/ohlcv/day?aggregate=1&limit=7&currency=usd`, undefined, 'GeckoTerminal');
  const candles = payload?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(candles)) return null;
  const points = candles.map(([timestamp, _open, _high, _low, close]) => ({ date: new Date(timestamp * 1000).toISOString(), price: close })).filter((point) => Number.isFinite(Date.parse(point.date)) && typeof point.price === 'number').reverse();
  return points.length ? points : null;
}
