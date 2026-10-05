import { API_VERSION, FRESH_AFTER_MS, HISTORY_KEY_PREFIX, REFRESH_INTERVAL_MINUTES, REFRESH_INTERVAL_MS, STALE_AFTER_MS, V3_HISTORY_KEY_PREFIX } from './constants.js';
import { error, json } from './http.js';
import { fetchPriceHistory } from './market.js';
import { isUsableSnapshot, loadWalletData, resolveSnapshot } from './snapshot.js';
import { isBase58PublicKey } from './transforms.js';
import { loadV3Events, loadV3Wallet, mapV3HistoryPoints, v3Asset } from './v3.js';

function usableHistory(history) {
  return history && typeof history === 'object' && Number.isFinite(Date.parse(history.fetchedAt)) && Array.isArray(history.points);
}

export async function historyForAsset(kv, mint, apiKey, keyPrefix = HISTORY_KEY_PREFIX) {
  const key = `${keyPrefix}${mint}`;
  const cached = kv ? await kv.get(key, 'json') : null;
  const cachedUsable = usableHistory(cached) || (cached?.unavailable === true && Number.isFinite(Date.parse(cached.fetchedAt)));
  const age = cachedUsable ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  if (age >= 0 && age <= FRESH_AFTER_MS) return { points: cached.unavailable ? null : cached.points, state: cached.unavailable ? 'unavailable' : 'fresh', fetchedAt: cached.fetchedAt };
  try {
    const points = await fetchPriceHistory(mint, apiKey);
    if (!points) {
      if (age >= 0 && age <= STALE_AFTER_MS && usableHistory(cached)) return { points: cached.points, state: 'stale', fetchedAt: cached.fetchedAt };
      const fetchedAt = new Date().toISOString();
      if (kv?.put) await kv.put(key, JSON.stringify({ version: 1, mint, source: 'coingecko', fetchedAt, unavailable: true }));
      return { points: null, state: 'unavailable', fetchedAt };
    }
    const fetchedAt = new Date().toISOString();
    if (kv?.put) await kv.put(key, JSON.stringify({ version: 1, mint, source: 'coingecko', fetchedAt, points }));
    return { points, state: 'fresh', fetchedAt };
  } catch (cause) {
    console.warn('CoinGecko history unavailable', { mint, message: cause.message });
    return age >= 0 && age <= STALE_AFTER_MS ? { points: cached.points, state: 'stale', fetchedAt: cached.fetchedAt } : { points: null, state: 'unavailable', fetchedAt: null };
  }
}

function v3Meta(meta, history = null) {
  return { ...meta, provenance: { snapshot: meta.snapshotState, market: meta.marketDataSource, history: history?.points ? 'coingecko' : null }, freshness: { snapshot: meta.snapshotState, history: history?.state ?? null, historyFetchedAt: history?.fetchedAt ?? null } };
}

function v3Swap(swap) {
  return { id: swap.id ?? null, timestamp: swap.timestamp ?? null, protocol: swap.protocol ?? null, wallet: swap.wallet ?? null, input: swap.input ? { mint: swap.input.mint ?? null, atomicAmount: String(swap.input.rawAmount ?? '0'), decimals: Number.isInteger(swap.input.decimals) ? swap.input.decimals : null } : null, output: swap.output ? { mint: swap.output.mint ?? null, atomicAmount: String(swap.output.rawAmount ?? '0'), decimals: Number.isInteger(swap.output.decimals) ? swap.output.decimals : null } : null };
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
  if (url.pathname === '/v3/status') return json({ data: { version: API_VERSION, chain: 'solana', provenance: { snapshot: snapshot.source, market: snapshot.market.source, reviewedSwaps: snapshot.market.swaps?.source ?? 'unknown' }, freshness: { snapshot: state, snapshotCreatedAt: snapshot.createdAt, marketDataAsOf: snapshot.market.asOf }, reviewedSwaps: { scope: snapshot.market.swaps?.scope ?? 'registered-liquid-pools', count: snapshot.market.swaps?.count ?? snapshot.swaps.length } }, meta: v3Meta(meta) }, 200, id, origin, snapshotHeaders);
  if (url.pathname === '/v3/assets') return json({ data: snapshot.assets.map(v3Asset), meta: v3Meta(meta) }, 200, id, origin, snapshotHeaders);
  if (url.pathname === '/v3/swaps') return json({ data: { scope: snapshot.market.swaps?.scope ?? 'registered-liquid-pools', swaps: snapshot.swaps.map(v3Swap) }, meta: v3Meta(meta) }, 200, id, origin, snapshotHeaders);
  if (url.pathname.startsWith('/v3/assets/')) {
    const suffix = url.pathname.slice('/v3/assets/'.length);
    const historySuffix = suffix.endsWith('/history');
    const encodedMint = historySuffix ? suffix.slice(0, -'/history'.length) : suffix;
    let mint;
    try { mint = decodeURIComponent(encodedMint); } catch { return error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin); }
    if (!mint || mint.includes('/') || !isBase58PublicKey(mint)) return error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin);
    const asset = snapshot.assets.find((item) => item.mint === mint);
    if (!asset) return error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin);
    const history = await historyForAsset(env.SNAPSHOTS, mint, config.coingeckoApiKey, V3_HISTORY_KEY_PREFIX);
    const points = mapV3HistoryPoints(history.points);
    if (historySuffix) return json({ data: { mint, points }, meta: v3Meta(meta, history) }, 200, id, origin, snapshotHeaders);
    return json({ data: { ...v3Asset(asset), history: { points, state: state === 'fixture' ? 'fixture' : history.state, fetchedAt: history.fetchedAt } }, meta: v3Meta(meta, history) }, 200, id, origin, snapshotHeaders);
  }
  if (url.pathname.startsWith('/v3/wallets/')) {
    const suffix = url.pathname.slice('/v3/wallets/'.length);
    const segments = suffix.split('/');
    const activityRoute = segments.length === 2 && (segments[1] === 'transactions' || segments[1] === 'events');
    if (segments.length !== 1 && !activityRoute) return error('NOT_FOUND', 'Route was not found.', 404, id, origin);
    const encodedAddress = segments[0];
    let address;
    try { address = decodeURIComponent(encodedAddress); } catch { return error('INVALID_WALLET_ADDRESS', 'Wallet address is invalid.', 400, id, origin); }
    if (!address || address.includes('/') || !isBase58PublicKey(address)) return error('INVALID_WALLET_ADDRESS', 'Wallet address is invalid.', 400, id, origin);
    if (activityRoute) {
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? 25 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('INVALID_EVENT_LIMIT', 'limit must be an integer from 1 to 100.', 400, id, origin);
      const cursor = url.searchParams.get('cursor');
      if (cursor !== null && !cursor) return error('INVALID_EVENT_CURSOR', 'cursor must not be empty.', 400, id, origin);
      try { return json({ data: await loadV3Events(env, config, address, limit, cursor), meta: v3Meta(meta) }, 200, id, origin, snapshotHeaders); } catch (cause) { return error(cause.code || 'WALLET_LOOKUP_UNAVAILABLE', 'Public wallet data is currently unavailable.', 503, id, origin); }
    }
    try { const result = await loadV3Wallet(env, config, address); return json({ data: result.wallet, meta: { ...v3Meta(meta), wallet: { source: 'helius-das', ...result.freshness } } }, 200, id, origin, snapshotHeaders); } catch (cause) { return error(cause.code || 'WALLET_LOOKUP_UNAVAILABLE', 'Public wallet data is currently unavailable.', 503, id, origin); }
  }
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
