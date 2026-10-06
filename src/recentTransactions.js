import { STALE_AFTER_MS, V3_HELIUS_DASHBOARD_KEY, V3_RECENT_TRANSACTIONS_FRESH_AFTER_MS, V3_RECENT_TRANSACTIONS_KEY, V3_RECENT_TRANSACTIONS_MAX } from './constants.js';
import { heliusRpc } from './v3.js';
import { refreshDashboardNetworkMetrics, staleDashboardNetwork } from './network.js';

let pendingRefresh = null;
let pendingDashboardRefresh = null;

function usableSample(sample) {
  return sample && typeof sample === 'object' && Number.isFinite(Date.parse(sample.asOf)) && Number.isInteger(sample.slot) && Array.isArray(sample.transactions);
}

function usableDashboardSample(sample) {
  return usableSample(sample) && sample.network && typeof sample.network === 'object' && sample.network.chain && typeof sample.network.chain === 'object' && sample.network.performance && typeof sample.network.performance === 'object' && sample.network.fees && typeof sample.network.fees === 'object';
}

function signaturesFromBlock(block) {
  const signatures = Array.isArray(block?.signatures) ? block.signatures : Array.isArray(block?.transactions) ? block.transactions : [];
  return [...new Set(signatures.filter((signature) => typeof signature === 'string' && signature))];
}

function actionFromParsedEvent(event) {
  const type = event?.parsed?.summary?.type;
  if (typeof type === 'string' && type) return type;
  const instruction = (event?.parsed?.instructions || []).find((item) => typeof item?.instructionName === 'string' && item.instructionName);
  return instruction?.instructionName ?? null;
}

async function parsedEvents(signatures, apiKey) {
  const response = await fetch(`https://mainnet.helius-rpc.com/v1/parsed-events/transactions?api-key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactions: signatures }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Helius Parsed Events request failed with ${response.status}`);
  const body = await response.json();
  return Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
}

export async function refreshRecentTransactionSample(env, config, now = new Date(), confirmedSlot = null, persist = true) {
  const apiKey = config.heliusApiKey || env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('Helius is not configured.');
  const slot = confirmedSlot ?? await heliusRpc('getSlot', [{ commitment: 'confirmed' }], apiKey);
  if (!Number.isInteger(slot) || slot < 0) throw new Error('Helius returned an invalid confirmed slot.');
  const block = await heliusRpc('getBlock', [slot, { commitment: 'confirmed', transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1 }], apiKey);
  const blockTime = Number.isFinite(block?.blockTime) ? new Date(block.blockTime * 1000).toISOString() : null;
  const signatures = signaturesFromBlock(block).slice(0, V3_RECENT_TRANSACTIONS_MAX);
  let parsed = null;
  try {
    parsed = await parsedEvents(signatures, apiKey);
  } catch (cause) {
    // A parser outage must not stop the lightweight block sample from advancing.
    console.warn('Helius Parsed Events unavailable for recent transactions', { message: cause.message });
  }
  const parsedBySignature = new Map((parsed || []).filter((event) => typeof event?.signature === 'string').map((event) => [event.signature, event]));
  const transactions = signatures.map((signature) => ({ signature, slot, blockTime, status: 'confirmed', action: actionFromParsedEvent(parsedBySignature.get(signature)) }));
  const sample = { version: 2, source: parsed ? 'helius-rpc-parsed-events' : 'helius-rpc', asOf: now.toISOString(), slot, transactions };
  if (persist && env.SNAPSHOTS?.put) await env.SNAPSHOTS.put(V3_RECENT_TRANSACTIONS_KEY, JSON.stringify(sample), { expirationTtl: Math.ceil(STALE_AFTER_MS / 1000) });
  return sample;
}

export async function refreshHeliusDashboardSample(env, config, previous = null, now = new Date()) {
  const apiKey = config.heliusApiKey || env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('Helius is not configured.');
  const confirmedSlot = await heliusRpc('getSlot', [{ commitment: 'confirmed' }], apiKey);
  if (!Number.isInteger(confirmedSlot) || confirmedSlot < 0) throw new Error('Helius returned an invalid confirmed slot.');
  const [transactionsResult, networkResult] = await Promise.allSettled([
    refreshRecentTransactionSample(env, config, now, confirmedSlot, false),
    refreshDashboardNetworkMetrics((method, params, timeoutMs) => heliusRpc(method, params, apiKey, timeoutMs), confirmedSlot, previous?.network, now)
  ]);
  if (transactionsResult.status === 'rejected') console.warn('Recent transaction refresh unavailable', { message: transactionsResult.reason?.message || String(transactionsResult.reason) });
  if (networkResult.status === 'rejected') console.warn('Helius dashboard network refresh unavailable', { message: networkResult.reason?.message || String(networkResult.reason) });
  if (transactionsResult.status === 'rejected' && networkResult.status === 'rejected') throw new Error('Helius dashboard refresh failed.');
  const transactions = transactionsResult.status === 'fulfilled' ? transactionsResult.value.transactions : previous?.transactions || [];
  const network = networkResult.status === 'fulfilled' ? networkResult.value : staleDashboardNetwork(previous?.network);
  const transactionsFreshness = transactionsResult.status === 'fulfilled' ? 'fresh' : transactions.length ? 'stale' : 'unavailable';
  const transactionAsOf = transactionsResult.status === 'fulfilled' ? now.toISOString() : previous?.transactionAsOf ?? null;
  const sample = { version: 1, source: 'helius-rpc', asOf: now.toISOString(), slot: confirmedSlot, transactionAsOf, transactionsFreshness, transactions, network };
  if (env.SNAPSHOTS?.put) await env.SNAPSHOTS.put(V3_HELIUS_DASHBOARD_KEY, JSON.stringify(sample), { expirationTtl: Math.ceil(STALE_AFTER_MS / 1000) });
  return sample;
}

export async function loadHeliusDashboardSample(env, config, now = new Date(), refreshIfStale = false) {
  const cached = env.SNAPSHOTS?.get ? await env.SNAPSHOTS.get(V3_HELIUS_DASHBOARD_KEY, 'json') : null;
  const age = usableDashboardSample(cached) ? now.getTime() - Date.parse(cached.asOf) : Infinity;
  if (age >= 0 && age <= V3_RECENT_TRANSACTIONS_FRESH_AFTER_MS) return { ...cached, freshness: 'fresh' };
  if (refreshIfStale) {
    try {
      pendingDashboardRefresh ||= refreshHeliusDashboardSample(env, config, cached, now).finally(() => { pendingDashboardRefresh = null; });
      return { ...await pendingDashboardRefresh, freshness: 'fresh' };
    } catch (cause) {
      console.warn('Helius dashboard refresh unavailable', { message: cause.message });
    }
  }
  if (age >= 0 && age <= STALE_AFTER_MS) return { ...cached, freshness: 'stale' };
  return { source: 'helius-rpc', asOf: null, slot: null, transactionAsOf: null, transactionsFreshness: 'unavailable', transactions: [], network: staleDashboardNetwork(), freshness: 'unavailable' };
}

export async function loadRecentTransactionSample(env, config, now = new Date(), refreshIfStale = false) {
  const cached = env.SNAPSHOTS?.get ? await env.SNAPSHOTS.get(V3_RECENT_TRANSACTIONS_KEY, 'json') : null;
  const age = usableSample(cached) ? now.getTime() - Date.parse(cached.asOf) : Infinity;
  if (age >= 0 && age <= V3_RECENT_TRANSACTIONS_FRESH_AFTER_MS) return { ...cached, freshness: 'fresh' };
  if (refreshIfStale) {
    try {
      // Coalesce concurrent cache misses in this Worker isolate before calling Helius.
      pendingRefresh ||= refreshRecentTransactionSample(env, config, now).finally(() => { pendingRefresh = null; });
      const sample = await pendingRefresh;
      return { ...sample, freshness: 'fresh' };
    } catch (cause) {
      console.warn('Recent transaction refresh unavailable', { message: cause.message });
    }
  }
  if (age >= 0 && age <= STALE_AFTER_MS) return { ...cached, freshness: 'stale' };
  return { source: 'helius-rpc-parsed-events', asOf: null, slot: null, transactions: [], freshness: 'unavailable' };
}
