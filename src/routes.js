import { API_VERSION, REFRESH_INTERVAL_MINUTES, REFRESH_INTERVAL_MS } from './constants.js';
import { error, json } from './http.js';
import { isUsableSnapshot, resolveSnapshot } from './snapshot.js';

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
  if (url.pathname === '/v1/status') return json({ data: { version: API_VERSION, snapshot: { state, createdAt: snapshot.createdAt, source: snapshot.source }, marketData: { source: snapshot.market.source, asOf: snapshot.market.asOf }, swaps: snapshot.market.swaps || { count: snapshot.swaps.length, asOf: null, source: 'unknown', error: null } }, meta }, 200, id, origin, snapshotHeaders);
  if (url.pathname === '/v1/market') return json({ data: snapshot.market, meta }, 200, id, origin, snapshotHeaders);
  if (url.pathname === '/v1/assets') return json({ data: snapshot.assets, meta }, 200, id, origin, snapshotHeaders);
  if (url.pathname.startsWith('/v1/assets/id/')) {
    const encodedId = url.pathname.slice('/v1/assets/id/'.length);
    let contractId;
    try { contractId = decodeURIComponent(encodedId); } catch { return error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin); }
    const asset = snapshot.assets.find((item) => item.contractId === contractId);
    return asset ? json({ data: asset, meta }, 200, id, origin, snapshotHeaders) : error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin);
  }
  if (url.pathname.startsWith('/v1/assets/')) {
    const assetPath = url.pathname.slice('/v1/assets/'.length);
    if (!assetPath || assetPath.includes('/')) return error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin);
    let symbol;
    try { symbol = decodeURIComponent(assetPath).toUpperCase(); } catch { return error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin); }
    const assets = snapshot.assets.filter((item) => item.symbol.toUpperCase() === symbol);
    if (assets.length > 1) return error('ASSET_SYMBOL_AMBIGUOUS', 'Asset symbol matches multiple contracts. Use the contract identifier.', 409, id, origin);
    return assets[0] ? json({ data: assets[0], meta }, 200, id, origin, snapshotHeaders) : error('ASSET_NOT_FOUND', 'Asset was not found.', 404, id, origin);
  }
  if (url.pathname === '/v1/swaps') return json({ data: snapshot.swaps, meta }, 200, id, origin, snapshotHeaders);
  if (url.pathname === '/v1/wallets') {
    return json({ data: config.wallets, meta }, 200, id, origin, snapshotHeaders);
  }
  if (url.pathname.startsWith('/v1/wallets/')) {
    let address;
    try { address = decodeURIComponent(url.pathname.slice('/v1/wallets/'.length)); } catch { return error('CURATED_WALLET_NOT_FOUND', 'Wallet is not in the curated configuration.', 404, id, origin); }
    const wallet = config.wallets.find((item) => item.address === address);
    if (!wallet) return error('CURATED_WALLET_NOT_FOUND', 'Wallet is not in the curated configuration.', 404, id, origin);
    return json({ data: { address, ...wallet, ...(snapshot.wallets[address] || { assets: [], portfolioTotal: 0, transactions: [], swaps: [] }) }, meta }, 200, id, origin, snapshotHeaders);
  }
  return error('NOT_FOUND', 'Route was not found.', 404, id, origin);
}
