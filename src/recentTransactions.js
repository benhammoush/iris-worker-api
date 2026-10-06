import { STALE_AFTER_MS, V3_RECENT_TRANSACTIONS_CACHE_SECONDS, V3_RECENT_TRANSACTIONS_KEY, V3_RECENT_TRANSACTIONS_MAX } from './constants.js';
import { heliusRpc } from './v3.js';

let pendingRefresh = null;

function usableSample(sample) {
  return sample && typeof sample === 'object' && Number.isFinite(Date.parse(sample.asOf)) && Number.isInteger(sample.slot) && Array.isArray(sample.transactions);
}

function signaturesFromBlock(block) {
  const signatures = Array.isArray(block?.signatures) ? block.signatures : Array.isArray(block?.transactions) ? block.transactions : [];
  return [...new Set(signatures.filter((signature) => typeof signature === 'string' && signature))];
}

async function refreshSample(env, config, now) {
  const apiKey = config.heliusApiKey || env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('Helius is not configured.');
  const slot = await heliusRpc('getSlot', [{ commitment: 'confirmed' }], apiKey);
  if (!Number.isInteger(slot) || slot < 0) throw new Error('Helius returned an invalid confirmed slot.');
  const block = await heliusRpc('getBlock', [slot, { commitment: 'confirmed', transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1 }], apiKey);
  const blockTime = Number.isFinite(block?.blockTime) ? new Date(block.blockTime * 1000).toISOString() : null;
  const transactions = signaturesFromBlock(block).slice(0, V3_RECENT_TRANSACTIONS_MAX).map((signature) => ({ signature, slot, blockTime, status: 'confirmed' }));
  const sample = { version: 1, source: 'helius-rpc', asOf: now.toISOString(), slot, transactions };
  if (env.SNAPSHOTS?.put) await env.SNAPSHOTS.put(V3_RECENT_TRANSACTIONS_KEY, JSON.stringify(sample), { expirationTtl: Math.ceil(STALE_AFTER_MS / 1000) });
  return sample;
}

export async function loadRecentTransactionSample(env, config, now = new Date()) {
  const cached = env.SNAPSHOTS?.get ? await env.SNAPSHOTS.get(V3_RECENT_TRANSACTIONS_KEY, 'json') : null;
  const age = usableSample(cached) ? now.getTime() - Date.parse(cached.asOf) : Infinity;
  if (age >= 0 && age <= V3_RECENT_TRANSACTIONS_CACHE_SECONDS * 1000) return { ...cached, freshness: 'fresh' };
  try {
    // Coalesce concurrent browser misses in this Worker isolate before calling Helius.
    pendingRefresh ||= refreshSample(env, config, now).finally(() => { pendingRefresh = null; });
    const sample = await pendingRefresh;
    return { ...sample, freshness: 'fresh' };
  } catch (cause) {
    console.warn('Recent transaction sample unavailable', { message: cause.message });
    if (age >= 0 && age <= STALE_AFTER_MS) return { ...cached, freshness: 'stale' };
    return { source: 'helius-rpc', asOf: null, slot: null, transactions: [], freshness: 'unavailable' };
  }
}
