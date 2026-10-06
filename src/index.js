import { getConfig } from './config.js';
import { error, json, requestId } from './http.js';
import { route } from './routes.js';
import { refreshSnapshot } from './snapshot.js';
import { refreshHeliusDashboardSample } from './recentTransactions.js';
import { refreshDefiLlamaDashboard } from './defillama.js';

function allowedOrigin(request, config) {
  const origin = request.headers.get('origin');
  return origin && config.corsOrigins.includes(origin) ? origin : null;
}

async function refreshHeliusDashboardBackstop(env, config) {
  try {
    await refreshHeliusDashboardSample(env, config);
  } catch (cause) {
    // Snapshot publication must not fail because the optional live dashboard cache is unavailable.
    console.warn('Helius dashboard refresh unavailable', { message: cause.message });
  }
}

async function refreshDefiLlamaBackstop(env) {
  try {
    await refreshDefiLlamaDashboard(env.SNAPSHOTS);
  } catch (cause) {
    // DefiLlama is an optional dashboard source and must not block core snapshots.
    console.warn('DefiLlama dashboard refresh unavailable', { message: cause.message });
  }
}

export default {
  async fetch(request, env, ctx) {
    const id = requestId(request);
    let config;
    try { config = getConfig(env); } catch (cause) { return error('CONFIGURATION_ERROR', cause.message, 500, id); }
    const origin = allowedOrigin(request, config);
    if (request.headers.get('origin') && !origin) return error('CORS_ORIGIN_DENIED', 'Origin is not allowed.', 403, id);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-request-id, authorization', 'access-control-max-age': '86400', 'x-request-id': id } });
    }
    if (request.method === 'POST' && new URL(request.url).pathname === '/internal/refresh') {
      const expectedToken = env.REFRESH_TOKEN;
      if (!expectedToken || request.headers.get('authorization') !== `Bearer ${expectedToken}`) return error('REFRESH_UNAUTHORIZED', 'Refresh authorization is invalid.', 401, id, origin);
      try {
        const [snapshot] = await Promise.all([refreshSnapshot(env, config), refreshHeliusDashboardBackstop(env, config), refreshDefiLlamaBackstop(env)]);
        return json({ data: { status: 'refreshed', createdAt: snapshot.createdAt }, meta: { requestId: id } }, 200, id, origin, { 'cache-control': 'no-store' });
      } catch (cause) {
        console.error('deployment refresh failed', { requestId: id, message: cause.message });
        return error('REFRESH_FAILED', 'The snapshot refresh could not be completed.', 502, id, origin);
      }
    }
    if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 'Only GET is supported.', 405, id, origin);
    try { return await route(request, env, config, id, origin); } catch (cause) { console.error('request failed', { requestId: id, message: cause.message }); return error('INTERNAL_ERROR', 'The request could not be completed.', 500, id, origin); }
  },
  async scheduled(event, env, ctx) {
    try {
      const config = getConfig(env);
      const minute = Math.floor(event.scheduledTime / 60_000);
      if (minute % 15 === 0) {
        await Promise.all([refreshSnapshot(env, config), refreshHeliusDashboardBackstop(env, config), refreshDefiLlamaBackstop(env)]);
      } else {
        await refreshHeliusDashboardBackstop(env, config);
      }
    } catch (cause) {
      console.error('scheduled refresh failed', { message: cause.message });
      throw cause;
    }
  }
};
