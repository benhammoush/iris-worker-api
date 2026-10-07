import { DEFILLAMA_DASHBOARD_KEY, DEFILLAMA_FRESH_AFTER_MS, STALE_AFTER_MS } from './constants.js';

const DEFILLAMA = 'https://api.llama.fi';

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function dexesFrom(payload) {
  const items = Array.isArray(payload?.protocols) ? payload.protocols : null;
  if (!items) throw new Error('DefiLlama DEX overview payload is invalid.');
  const normalized = items.flatMap((item) => {
    if (!item || typeof item.name !== 'string' || !item.name || typeof item.slug !== 'string' || !item.slug) return [];
    return [{ name: item.name, slug: item.slug, logo: typeof item.logo === 'string' && item.logo ? item.logo : null, total24hUsd: finiteOrNull(item.total24h), total7dUsd: finiteOrNull(item.total7d), change1dPct: finiteOrNull(item.change_1d) }];
  }).sort((left, right) => (right.total24hUsd ?? -Infinity) - (left.total24hUsd ?? -Infinity));
  return {
    total24hUsd: normalized.reduce((total, item) => total + (item.total24hUsd ?? 0), 0),
    total7dUsd: normalized.reduce((total, item) => total + (item.total7dUsd ?? 0), 0),
    items: normalized
  };
}

function protocolsFrom(payload) {
  if (!Array.isArray(payload)) throw new Error('DefiLlama protocol payload is invalid.');
  const normalized = payload.flatMap((item) => {
    const solanaTvlUsd = finiteOrNull(item?.chainTvls?.Solana);
    if (!item || !Array.isArray(item.chains) || !item.chains.includes('Solana') || typeof item.name !== 'string' || !item.name || typeof item.slug !== 'string' || !item.slug || solanaTvlUsd === null) return [];
    return [{ name: item.name, slug: item.slug, logo: typeof item.logo === 'string' && item.logo ? item.logo : null, category: typeof item.category === 'string' ? item.category : null, solanaTvlUsd, change1dPct: finiteOrNull(item.change_1d), change7dPct: finiteOrNull(item.change_7d) }];
  }).sort((left, right) => right.solanaTvlUsd - left.solanaTvlUsd);
  return { total: normalized.length, items: normalized };
}

export function isUsableDefiLlamaDashboard(dashboard) {
  return Boolean(dashboard && typeof dashboard === 'object' && timestamp(dashboard.fetchedAt)
    && dashboard.source === 'defillama' && dashboard.dexes && typeof dashboard.dexes === 'object' && Array.isArray(dashboard.dexes.items)
    && dashboard.protocols && typeof dashboard.protocols === 'object' && Array.isArray(dashboard.protocols.items));
}

export async function refreshDefiLlamaDashboard(kv, now = new Date()) {
  const [dexResponse, protocolResponse] = await Promise.all([
    fetch(`${DEFILLAMA}/overview/dexs/Solana?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`${DEFILLAMA}/protocols`, { signal: AbortSignal.timeout(10_000) })
  ]);
  if (!dexResponse.ok) throw new Error(`DefiLlama DEX overview request failed with ${dexResponse.status}`);
  if (!protocolResponse.ok) throw new Error(`DefiLlama protocol request failed with ${protocolResponse.status}`);
  const [dexPayload, protocolPayload] = await Promise.all([dexResponse.json(), protocolResponse.json()]);
  const dashboard = { source: 'defillama', fetchedAt: now.toISOString(), dexes: dexesFrom(dexPayload), protocols: protocolsFrom(protocolPayload) };
  if (kv?.put) await kv.put(DEFILLAMA_DASHBOARD_KEY, JSON.stringify(dashboard), { expirationTtl: Math.ceil(STALE_AFTER_MS / 1000) });
  return dashboard;
}

export async function loadDefiLlamaDashboard(kv, now = Date.now()) {
  const cached = kv?.get ? await kv.get(DEFILLAMA_DASHBOARD_KEY, 'json') : null;
  if (!isUsableDefiLlamaDashboard(cached)) return { dashboard: null, state: 'unavailable' };
  const age = now - Date.parse(cached.fetchedAt);
  if (age < 0 || age > STALE_AFTER_MS) return { dashboard: null, state: 'unavailable' };
  return { dashboard: cached, state: age <= DEFILLAMA_FRESH_AFTER_MS ? 'fresh' : 'stale' };
}
