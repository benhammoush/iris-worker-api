import { API_VERSION, FRESH_AFTER_MS, HISTORY_KEY_PREFIX, REFRESH_INTERVAL_MINUTES, REFRESH_INTERVAL_MS, STALE_AFTER_MS } from './constants.js';
import { error, json } from './http.js';
import { fetchPriceHistory } from './market.js';
import { isUsableSnapshot, loadWalletData, resolveSnapshot } from './snapshot.js';
import { isBase58PublicKey } from './transforms.js';

function usableHistory(history) {
  return history && typeof history === 'object' && Number.isFinite(Date.parse(history.fetchedAt)) && Array.isArray(history.points);
}

async function historyForAsset(kv, mint, apiKey) {
  const key = `${HISTORY_KEY_PREFIX}${mint}`;
  const cached = kv ? await kv.get(key, 'json') : null;
  const age = usableHistory(cached) ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  if (age >= 0 && age <= FRESH_AFTER_MS) return { points: cached.points, state: 'fresh', fetchedAt: cached.fetchedAt };
  try {
    const points = await fetchPriceHistory(mint, apiKey);
    if (!points) return age >= 0 && age <= STALE_AFTER_MS ? { points: cached.points, state: 'stale', fetchedAt: cached.fetchedAt } : { points: null, state: 'unavailable', fetchedAt: null };
    const fetchedAt = new Date().toISOString();
    if (kv?.put) await kv.put(key, JSON.stringify({ version: 1, mint, source: 'coingecko', fetchedAt, points }));
    return { points, state: 'fresh', fetchedAt };
  } catch (cause) {
    console.warn('CoinGecko history unavailable', { mint, message: cause.message });
    return age >= 0 && age <= STALE_AFTER_MS ? { points: cached.points, state: 'stale', fetchedAt: cached.fetchedAt } : { points: null, state: 'unavailable', fetchedAt: null };
  }
}

export async function route(request, env, config, id, origin) {
  const url = new URL(request.url);
  if (url.pathname === '/health') return json({ data: { status: 'ok', version: API_VERSION }, meta: { requestId: id } }, 200, id, origin);
  if (url.pathname === '/ready') {
    if (!env.SNAPSHOTS) return error('NOT_READY', 'Snapshot KV binding is unavailable.', 503, id, origin);
    try {
      const { snapshot, state } = await resolveSnapshot(env.SNAPSHOTS);
      if (!isUsableSnapshot(snapshot)) return error('NOT_READY', 'No usable snapshot is available.', 503, id, origin);
      return json({ data: { status: 'ready', snapshotState: state }, meta: { requestId: id } }, 200, id, origin, { 'cache-control': 'no-store', 'x-snapshot-state': state });
    } catch {
      return error('NOT_READY', 'Snapshot KV binding is unavailable.', 503, id, origin);
    }
  }
  const { snapshot, state } = await resolveSnapshot(env.SNAPSHOTS);
  const meta = {
    requestId: id,
    snapshotState: state,
    snapshotCreatedAt: snapshot.createdAt,
    marketDataSource: snapshot.market.source,
    marketDataAsOf: snapshot.market.asOf,
    refreshIntervalMinutes: REFRESH_INTERVAL_MINUTES,
    nextScheduledRefreshAt: new Date((Math.floor(Date.now() / REFRESH_INTERVAL_MS) + 1) * REFRESH_INTERVAL_MS).toISOString()
  };
  const snapshotHeaders = { 'cache-control': 'no-store', 'x-snapshot-state': state };
  const versionPrefix = url.pathname.startsWith('/v2/') ? '/v2' : url.pathname.startsWith('/v1/') ? '/v1' : null;
  if (!versionPrefix) return error('NOT_FOUND', 'Route was not found.', 404, id, origin);
  if (url.pathname === `${versionPrefix}/status`) return json({ data: { version: API_VERSION, chain: 'solana', snapshot: { state, createdAt: snapshot.createdAt, source: snapshot.source }, marketData: { source: snapshot.market.source, asOf: snapshot.market.asOf }, swaps: snapshot.market.swaps || { count: snapshot.swaps.length, asOf: null, source: 'unknown', error: null } }, meta }, 200, id, origin, snapshotHeaders);
  if (url.pathname === `${versionPrefix}/market`) return json({ data: snapshot.market, meta }, 200, id, origin, snapshotHeaders);
  if (url.pathname === `${versionPrefix}/assets`) return json({ data: snapshot.assets, meta }, 200, id, origin, snapshotHeaders);
  const mintPrefix = `${versionPrefix}/assets/mint/`;
  const legacyIdPrefix = `${versionPrefix}/assets/id/`;
  if (url.pathname.startsWith(mintPrefix) || url.pathname.startsWith(legacyIdPrefix)) {
    const encodedId = url.pathname.slice((url.pathname.startsWith(mintPrefix) ? mintPrefix : legacyIdPrefix).length);
    let mint;
    try { mint = decodeURIComponent(encodedId); } catch { return error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin); }
    if (!isBase58PublicKey(mint)) return error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin);
    const asset = snapshot.assets.find((item) => item.mint === mint);
    if (!asset) return error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin);
    const history = await historyForAsset(env.SNAPSHOTS, mint, config.coingeckoApiKey);
    return json({ data: { ...asset, priceHistory: history.points, historyDataSource: history.points ? 'coingecko' : null }, meta: { ...meta, historyDataSource: history.points ? 'coingecko' : null, historyState: state === 'fixture' ? 'fixture' : history.state, historyFetchedAt: history.fetchedAt } }, 200, id, origin, snapshotHeaders);
  }
  if (url.pathname.startsWith(`${versionPrefix}/assets/`)) {
    const assetPath = url.pathname.slice(`${versionPrefix}/assets/`.length);
    if (!assetPath || assetPath.includes('/')) return error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin);
    let symbol;
    try { symbol = decodeURIComponent(assetPath).toUpperCase(); } catch { return error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin); }
    const assets = snapshot.assets.filter((item) => item.symbol.toUpperCase() === symbol);
    if (assets.length > 1) return error('ASSET_SYMBOL_AMBIGUOUS', 'Asset symbol matches multiple mints. Use the mint address.', 409, id, origin);
    return assets[0] ? json({ data: assets[0], meta }, 200, id, origin, snapshotHeaders) : error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin);
  }
  if (url.pathname === `${versionPrefix}/swaps`) return json({ data: snapshot.swaps, meta }, 200, id, origin, snapshotHeaders);
  if (url.pathname === `${versionPrefix}/wallets`) {
    return json({ data: [], meta }, 200, id, origin, snapshotHeaders);
  }
  if (url.pathname.startsWith(`${versionPrefix}/wallets/`)) {
    let address;
    try { address = decodeURIComponent(url.pathname.slice(`${versionPrefix}/wallets/`.length)); } catch { return error('INVALID_WALLET_ADDRESS', 'Wallet address is invalid.', 400, id, origin); }
    if (!isBase58PublicKey(address)) return error('INVALID_WALLET_ADDRESS', 'Wallet address is invalid.', 400, id, origin);
    try {
      const wallet = await loadWalletData(env, config, address);
      return json({ data: wallet, meta: { ...meta, walletDataSource: 'helius-live' } }, 200, id, origin, snapshotHeaders);
    } catch (cause) {
      if (cause.code === 'WALLET_LOOKUP_UNAVAILABLE') return error(cause.code, 'Public wallet lookup is unavailable until Helius is configured.', 503, id, origin);
      console.warn('wallet lookup unavailable', { address, message: cause.message });
      return error('WALLET_LOOKUP_UNAVAILABLE', 'Public wallet data is currently unavailable.', 503, id, origin);
    }
  }
  return error('NOT_FOUND', 'Route was not found.', 404, id, origin);
}
