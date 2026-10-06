import { MAX_CATALOG_ASSETS, MIN_RECENT_CATALOG_VOLUME_USD, SOL_MINT } from './constants.js';
import { assetIdentity } from './transforms.js';

const JUPITER = 'https://api.jup.ag';
const BIRDEYE = 'https://public-api.birdeye.so';

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
    contractname: mint, metadataSource: 'jupiter', marketDataSource: 'jupiter', historyDataSource: null,
    v3: mapV3Asset(token)
  };
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function mapV3Asset(token) {
  const mint = token?.id || token?.mint || null;
  const stats = token?.stats24h || {};
  const buyVolume24hUsd = finiteOrNull(stats.buyVolume ?? token?.buyVolume24hUsd);
  const sellVolume24hUsd = finiteOrNull(stats.sellVolume ?? token?.sellVolume24hUsd);
  return {
    mint,
    symbol: typeof token?.symbol === 'string' ? token.symbol : null,
    name: typeof token?.name === 'string' ? token.name : null,
    decimals: Number.isInteger(token?.decimals) && token.decimals >= 0 ? token.decimals : null,
    iconUrl: typeof (token?.iconUrl ?? token?.icon) === 'string' ? (token.iconUrl ?? token.icon) : null,
    priceUsd: finiteOrNull(token?.usdPrice),
    marketCapUsd: finiteOrNull(token?.mcap),
    circulatingSupply: finiteOrNull(token?.circSupply),
    totalSupply: finiteOrNull(token?.totalSupply),
    fullyDilutedValuationUsd: finiteOrNull(token?.fdv),
    change24hPct: finiteOrNull(stats.priceChange ?? token?.priceChange24h),
    liquidityUsd: finiteOrNull(token?.liquidity),
    holderCount: finiteOrNull(token?.holderCount),
    verification: { isVerified: token?.isVerified === true, tags: Array.isArray(token?.tags) ? token.tags.filter((tag) => typeof tag === 'string') : [] },
    quality: { organicScore: finiteOrNull(token?.organicScore), organicScoreLabel: typeof token?.organicScoreLabel === 'string' ? token.organicScoreLabel : null, audit: token?.audit && typeof token.audit === 'object' ? token.audit : null },
    activity: { buyVolume24hUsd, sellVolume24hUsd, volume24hUsd: buyVolume24hUsd !== null && sellVolume24hUsd !== null ? buyVolume24hUsd + sellVolume24hUsd : null }
  };
}

function payloadItems(payload) {
  return Array.isArray(payload) ? payload : payload?.data || [];
}

export async function tokenByMint(mint, apiKey) {
  const items = payloadItems(await fetchJson(`${JUPITER}/tokens/v2/search?query=${encodeURIComponent(mint)}`, apiKey, 'Jupiter'));
  return items.find((item) => (item.id || item.address || item.mint) === mint) || null;
}

function catalogTokens(tokens, verifiedOnly = true) {
  const byMint = new Map();
  for (const token of tokens) {
    const mint = token?.id || token?.address || token?.mint;
    if (!mint || (verifiedOnly && !token.isVerified && mint !== SOL_MINT) || byMint.has(mint)) continue;
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

async function refreshDiscoveryCatalog(apiKey, path, minVolumeUsd = null) {
  try {
    const tokens = payloadItems(await fetchJson(`${JUPITER}/tokens/v2/${path}`, apiKey, 'Jupiter'));
    return catalogTokens(tokens, false).map(tokenAsset).filter((asset) => asset && (minVolumeUsd === null || asset.v3.activity.volume24hUsd >= minVolumeUsd));
  } catch (cause) {
    console.warn('Jupiter discovery catalog unavailable', { path, message: cause.message });
    return [];
  }
}

export async function refreshDiscoveryCatalogs(apiKey) {
  if (!apiKey) return { trending: [], recent: [] };
  const [trending, recent] = await Promise.all([
    refreshDiscoveryCatalog(apiKey, 'toptrending/24h'),
    refreshDiscoveryCatalog(apiKey, 'recent', MIN_RECENT_CATALOG_VOLUME_USD),
  ]);
  return { trending, recent };
}

const candlePlans = {
  '1h': { interval: '1m', durationMs: 60 * 60 * 1000 },
  '4h': { interval: '5m', durationMs: 4 * 60 * 60 * 1000 },
  '1d': { interval: '15m', durationMs: 24 * 60 * 60 * 1000 },
  '7d': { interval: '1H', durationMs: 7 * 24 * 60 * 60 * 1000 }
};

export function candlePlan(range) {
  return candlePlans[range] || null;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function birdeyeCandle(item) {
  const unixTime = item?.unix_time;
  const openUsd = finite(item?.o);
  const highUsd = finite(item?.h);
  const lowUsd = finite(item?.l);
  const closeUsd = finite(item?.c);
  const volume = finite(item?.v);
  const volumeUsd = finite(item?.v_usd);
  if (!Number.isInteger(unixTime) || unixTime < 0 || openUsd === null || highUsd === null || lowUsd === null || closeUsd === null || volume === null || volumeUsd === null) return null;
  if (highUsd < openUsd || highUsd < closeUsd || lowUsd > openUsd || lowUsd > closeUsd) return null;
  return { timestamp: new Date(unixTime * 1000).toISOString(), openUsd, highUsd, lowUsd, closeUsd, volume, volumeUsd };
}

export async function fetchCandles(mint, apiKey, range = '7d', now = Date.now()) {
  if (!apiKey) return null;
  const plan = candlePlan(range);
  if (!plan) throw new Error('Unsupported candle range.');
  const timeTo = Math.floor(now / 1000);
  const query = new URLSearchParams({ address: mint, type: plan.interval, time_from: String(timeTo - Math.floor(plan.durationMs / 1000)), time_to: String(timeTo), mode: 'range', currency: 'usd', chart_type: 'price' });
  const response = await fetch(`${BIRDEYE}/defi/v3/ohlcv?${query}`, { headers: { 'X-API-KEY': apiKey, 'x-chain': 'solana', accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Birdeye request failed with ${response.status}`);
  const payload = await response.json();
  if (payload?.success !== true || !Array.isArray(payload?.data?.items)) return null;
  const byTimestamp = new Map();
  for (const item of payload.data.items) {
    const candle = birdeyeCandle(item);
    if (candle) byTimestamp.set(candle.timestamp, candle);
  }
  const candles = [...byTimestamp.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  return candles.length ? { interval: plan.interval, candles } : null;
}

export async function fetchPriceHistory(mint, apiKey, range = '7d') {
  const result = await fetchCandles(mint, apiKey, range);
  return result?.candles.map((candle) => ({ date: candle.timestamp, price: candle.closeUsd })) || null;
}
