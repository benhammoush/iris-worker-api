import { STALE_AFTER_MS, V3_RECENT_TRANSACTIONS_FRESH_AFTER_MS, V3_RECENT_TRANSACTIONS_KEY, V3_RECENT_TRANSACTIONS_MAX } from './constants.js';
import { heliusRpc } from './v3.js';

function usableSample(sample) {
  return sample && typeof sample === 'object' && Number.isFinite(Date.parse(sample.asOf)) && Number.isInteger(sample.slot) && Array.isArray(sample.transactions);
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

export async function refreshRecentTransactionSample(env, config, now = new Date()) {
  const apiKey = config.heliusApiKey || env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('Helius is not configured.');
  const slot = await heliusRpc('getSlot', [{ commitment: 'confirmed' }], apiKey);
  if (!Number.isInteger(slot) || slot < 0) throw new Error('Helius returned an invalid confirmed slot.');
  const block = await heliusRpc('getBlock', [slot, { commitment: 'confirmed', transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1 }], apiKey);
  const blockTime = Number.isFinite(block?.blockTime) ? new Date(block.blockTime * 1000).toISOString() : null;
  const signatures = signaturesFromBlock(block).slice(0, V3_RECENT_TRANSACTIONS_MAX);
  const parsedBySignature = new Map((await parsedEvents(signatures, apiKey)).filter((event) => typeof event?.signature === 'string').map((event) => [event.signature, event]));
  const transactions = signatures.map((signature) => ({ signature, slot, blockTime, status: 'confirmed', action: actionFromParsedEvent(parsedBySignature.get(signature)) }));
  const sample = { version: 2, source: 'helius-rpc-parsed-events', asOf: now.toISOString(), slot, transactions };
  if (env.SNAPSHOTS?.put) await env.SNAPSHOTS.put(V3_RECENT_TRANSACTIONS_KEY, JSON.stringify(sample), { expirationTtl: Math.ceil(STALE_AFTER_MS / 1000) });
  return sample;
}

export async function loadRecentTransactionSample(env, config, now = new Date()) {
  const cached = env.SNAPSHOTS?.get ? await env.SNAPSHOTS.get(V3_RECENT_TRANSACTIONS_KEY, 'json') : null;
  const age = usableSample(cached) ? now.getTime() - Date.parse(cached.asOf) : Infinity;
  if (age >= 0 && age <= V3_RECENT_TRANSACTIONS_FRESH_AFTER_MS) return { ...cached, freshness: 'fresh' };
  if (age >= 0 && age <= STALE_AFTER_MS) return { ...cached, freshness: 'stale' };
  return { source: 'helius-rpc-parsed-events', asOf: null, slot: null, transactions: [], freshness: 'unavailable' };
}
