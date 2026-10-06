import { FIXTURE_SNAPSHOT, MARKET_SNAPSHOT } from './fixtures.js';
import { MAX_DISCOVERED_ASSETS, MAX_SWAPS, MAX_TRACKED_POOL_TRANSACTIONS, MAX_TRANSACTIONS_PER_WALLET, MAX_TRANSACTION_SCAN_PER_WALLET, SNAPSHOT_FRESH_AFTER_MS, SNAPSHOT_KEY_PREFIX, SNAPSHOT_POINTER_KEY, SOL_MINT, STALE_AFTER_MS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from './constants.js';
import { refreshDiscoveryCatalogs, refreshMarket } from './market.js';
import { refreshNetworkMetrics } from './network.js';
import { isRegisteredDexSwap, protocolForSwap, registeredDexRoutes } from './dexRegistry.js';
import { addAtomicAmounts, assetIdentity, decimalValue, formatAtomicAmount, isBase58PublicKey } from './transforms.js';

const HELIUS_RPC = 'https://mainnet.helius-rpc.com/';
const HELIUS_ENHANCED = 'https://api.helius.xyz/v0';

async function heliusRpc(method, params, apiKey, timeoutMs = 10_000) {
  const response = await fetch(`${HELIUS_RPC}?api-key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }), signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Helius RPC request failed with ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Helius RPC error: ${payload.error.message || 'unknown'}`);
  return payload.result;
}

async function heliusEnhanced(path, apiKey) {
  const response = await fetch(`${HELIUS_ENHANCED}${path}${path.includes('?') ? '&' : '?'}api-key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Helius enhanced request failed with ${response.status}`);
  return response.json();
}

export function isUsableSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Number.isFinite(Date.parse(snapshot.createdAt))) return false;
  return snapshot.market && typeof snapshot.market === 'object' && typeof snapshot.market.source === 'string' && Number.isFinite(Date.parse(snapshot.market.asOf))
    && Array.isArray(snapshot.assets) && snapshot.assets.every((asset) => asset && typeof asset.symbol === 'string' && typeof asset.name === 'string' && typeof asset.mint === 'string' && isBase58PublicKey(asset.mint) && asset.contractId === asset.mint && (asset.priceHistory === null || Array.isArray(asset.priceHistory)))
    && snapshot.wallets && typeof snapshot.wallets === 'object' && !Array.isArray(snapshot.wallets) && Array.isArray(snapshot.swaps);
}

export async function resolveSnapshot(kv, now = Date.now()) {
  if (!kv) return { snapshot: FIXTURE_SNAPSHOT, state: 'fixture' };
  const pointer = await kv.get(SNAPSHOT_POINTER_KEY, 'json');
  if (!pointer?.key) return { snapshot: FIXTURE_SNAPSHOT, state: 'fixture' };
  const snapshot = await kv.get(pointer.key, 'json');
  if (!isUsableSnapshot(snapshot)) return { snapshot: FIXTURE_SNAPSHOT, state: 'fixture' };
  const age = now - Date.parse(snapshot.createdAt);
  if (age < 0 || age > STALE_AFTER_MS) return { snapshot: FIXTURE_SNAPSHOT, state: 'fixture' };
  return { snapshot, state: age <= SNAPSHOT_FRESH_AFTER_MS ? 'fresh' : 'stale' };
}

function normalizeTokenChange(change) {
  const rawAmount = change.rawTokenAmount?.tokenAmount ?? change.tokenAmount ?? change.rawAmount ?? change.amount ?? '0';
  return { mint: change.mint, assetId: change.mint, rawAmount: String(rawAmount), decimals: change.rawTokenAmount?.decimals ?? change.decimals ?? null, userAccount: change.userAccount ?? change.fromUserAccount ?? change.toUserAccount ?? null };
}

function normalizeTransaction(transaction) {
  return {
    id: transaction.signature, txId: transaction.signature, chain: 'solana', timestamp: transaction.timestamp ? new Date(transaction.timestamp * 1000).toISOString() : null,
    blockHeight: transaction.slot ?? null, type: transaction.type ?? null, status: transaction.transactionError ? 'failed' : 'success', source: transaction.source ?? null,
    nativeTransfers: (transaction.nativeTransfers || []).map((transfer) => ({ ...transfer, amount: String(transfer.amount ?? '0') })),
    tokenTransfers: (transaction.tokenTransfers || []).map(normalizeTokenChange)
  };
}

function normalizeSwap(wallet, transaction) {
  const swap = transaction.events?.swap || {};
  const input = swap.tokenInputs?.[0] || swap.nativeInput;
  const output = swap.tokenOutputs?.[0] || swap.nativeOutput;
  return {
    ...normalizeTransaction(transaction),
    wallet,
    protocol: protocolForSwap(transaction),
    input: input ? normalizeTokenChange(input) : null,
    output: output ? normalizeTokenChange(output) : null,
    side: null,
    value: null
  };
}

async function fetchWalletSource(wallet, apiKey) {
  const [balance, classicAccounts, token2022Accounts, transactions] = await Promise.all([
    heliusRpc('getBalance', [wallet.address], apiKey),
    heliusRpc('getTokenAccountsByOwner', [wallet.address, { programId: TOKEN_PROGRAM_ID }, { encoding: 'jsonParsed' }], apiKey),
    heliusRpc('getTokenAccountsByOwner', [wallet.address, { programId: TOKEN_2022_PROGRAM_ID }, { encoding: 'jsonParsed' }], apiKey),
    heliusEnhanced(`/addresses/${wallet.address}/transactions?limit=${MAX_TRANSACTION_SCAN_PER_WALLET}`, apiKey)
  ]);
  const accountInfos = [...(classicAccounts.value || []), ...(token2022Accounts.value || [])].map((account) => account.account?.data?.parsed?.info).filter(Boolean);
  const grouped = new Map();
  for (const info of accountInfos) {
    const current = grouped.get(info.mint) || { amounts: [], decimals: info.tokenAmount?.decimals ?? 0 };
    current.amounts.push(String(info.tokenAmount?.amount ?? '0'));
    grouped.set(info.mint, current);
  }
  const tokenBalances = [...grouped.entries()].flatMap(([mint, value]) => {
    const rawAmount = addAtomicAmounts(value.amounts);
    return rawAmount === null || rawAmount === '0' ? [] : [{ mint, rawAmount, decimals: value.decimals }];
  });
  return { nativeRawAmount: String(balance.value ?? '0'), tokenBalances, transactions: Array.isArray(transactions) ? transactions : [] };
}

async function fetchTrackedPoolSwaps(apiKey) {
  const routes = registeredDexRoutes();
  const results = await Promise.allSettled(routes.flatMap((route) => route.pools.map((pool) => heliusEnhanced(`/addresses/${pool}/transactions?limit=${MAX_TRACKED_POOL_TRANSACTIONS}`, apiKey))));
  const bySignature = new Map();
  let succeeded = 0;
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    succeeded += 1;
    for (const transaction of result.value) {
      if (isRegisteredDexSwap(transaction) && transaction.signature) bySignature.set(transaction.signature, transaction);
    }
  }
  if (succeeded !== results.length) throw new Error('A tracked pool refresh failed.');
  return [...bySignature.values()].map((transaction) => normalizeSwap(null, transaction));
}

function fallbackAsset(mint, decimals = 0) {
  const existing = MARKET_SNAPSHOT.assets.find((asset) => asset.mint === mint);
  return existing || { ...assetIdentity(mint), symbol: mint.slice(0, 8), name: mint, imageUrl: '', decimals, price: null, supply: null, totalSupply: null, marketCap: null, change24h: null, change7d: null, change30d: null, priceHistory: null, actualprice: null, image: '', marketcap: null, pricedayminusone: null, percentdayminusone: null, priceweekminusone: null, percentweekminusone: null, pricemonthminusone: null, percentmonthminusone: null, contractname: mint };
}

function buildWalletData(wallet, source, assets) {
  if (!source) return { label: wallet.label, description: wallet.description, chain: 'solana', assets: [], totalValue: null, portfolioTotal: null, activity: [], transactions: [], swaps: [] };
  const balances = [{ mint: SOL_MINT, rawAmount: source.nativeRawAmount, decimals: 9 }, ...source.tokenBalances];
  const assetByMint = new Map(assets.map((asset) => [asset.mint, asset]));
  const walletAssets = balances.map(({ mint, rawAmount, decimals }) => {
    const asset = assetByMint.get(mint) || fallbackAsset(mint, decimals);
    const displayBalance = formatAtomicAmount(rawAmount, asset.decimals);
    const numericBalance = decimalValue(displayBalance);
    const price = typeof asset.price === 'number' ? asset.price : null;
    return { ...assetIdentity(mint), symbol: asset.symbol, name: asset.name, imageUrl: asset.imageUrl, decimals: asset.decimals, rawBalance: rawAmount, balance: displayBalance, displayBalance, price, value: numericBalance === null || price === null ? null : numericBalance * price };
  });
  const transactions = source.transactions.slice(0, MAX_TRANSACTIONS_PER_WALLET).map(normalizeTransaction);
  const swaps = source.transactions.filter(isRegisteredDexSwap).map((transaction) => normalizeSwap(wallet.address, transaction));
  const totalValue = walletAssets.every((asset) => typeof asset.value === 'number') ? walletAssets.reduce((total, asset) => total + asset.value, 0) : null;
  return { label: wallet.label, description: wallet.description, chain: 'solana', assets: walletAssets, totalValue, portfolioTotal: totalValue, activity: transactions, transactions, swaps };
}

export async function loadWalletData(env, config, address) {
  const apiKey = config.heliusApiKey || env.HELIUS_API_KEY;
  if (!apiKey) {
    const cause = new Error('Helius is not configured.');
    cause.code = 'WALLET_LOOKUP_UNAVAILABLE';
    throw cause;
  }
  const source = await fetchWalletSource({ address }, apiKey);
  const mints = [...new Set([SOL_MINT, ...source.tokenBalances.map((balance) => balance.mint)])].slice(0, MAX_DISCOVERED_ASSETS);
  const market = await refreshMarket(config.jupiterApiKey || env.JUPITER_API_KEY, mints);
  const marketAssetsByMint = new Map((market?.assets || []).map((asset) => [asset.mint, asset]));
  const assets = mints.map((mint) => marketAssetsByMint.get(mint) || fallbackAsset(mint));
  return { address, ...buildWalletData({ address, label: address, description: '' }, source, assets) };
}

export async function refreshSnapshot(env, config, now = new Date()) {
  const apiKey = config.heliusApiKey || env.HELIUS_API_KEY;
  const existing = await resolveSnapshot(env.SNAPSHOTS, now.getTime());
  if (!apiKey) return existing.state === 'fixture' ? FIXTURE_SNAPSHOT : existing.snapshot;
  const [trackedPoolResult, network] = await Promise.all([
    fetchTrackedPoolSwaps(apiKey).catch((cause) => { console.warn('Tracked pool swaps unavailable', { message: cause.message }); return existing.state === 'fixture' ? [] : existing.snapshot.swaps; }),
    refreshNetworkMetrics((method, params, timeoutMs) => heliusRpc(method, params, apiKey, timeoutMs), existing.snapshot.network, now).catch((cause) => { console.warn('Helius network metrics unavailable', { message: cause.message }); return existing.snapshot.network || FIXTURE_SNAPSHOT.network; })
  ]);
  const jupiterApiKey = config.jupiterApiKey || env.JUPITER_API_KEY;
  const market = await refreshMarket(jupiterApiKey);
  if (!market || !market.assets.length) {
    if (existing.state !== 'fixture') return existing.snapshot;
    throw new Error('Jupiter market discovery is unavailable and no usable snapshot exists.');
  }
  const assets = market.assets;
  const discoveryCatalogs = await refreshDiscoveryCatalogs(jupiterApiKey);
  const wallets = {};
  const swaps = trackedPoolResult.sort((left, right) => String(right.timestamp ?? '').localeCompare(String(left.timestamp ?? ''))).slice(0, MAX_SWAPS);
  const snapshot = { version: 2, createdAt: now.toISOString(), source: 'helius-jupiter', market: { fees: null, slot: network.chain?.finalizedSlot ?? null, block_height: network.chain?.blockHeight ?? null, source: market.source, asOf: market.asOf, historySource: null, liveAssetCount: market.liveAssetCount, swaps: { count: swaps.length, asOf: new Date().toISOString(), source: 'helius-decoded-tracked-pools', scope: 'registered-liquid-pools', error: null }, history: [] }, network, assets, catalogs: { topTraded: assets, ...discoveryCatalogs }, wallets, swaps };
  const key = `${SNAPSHOT_KEY_PREFIX}${now.getTime()}`;
  await env.SNAPSHOTS.put(key, JSON.stringify(snapshot));
  await env.SNAPSHOTS.put(SNAPSHOT_POINTER_KEY, JSON.stringify({ key, createdAt: snapshot.createdAt }));
  return snapshot;
}
