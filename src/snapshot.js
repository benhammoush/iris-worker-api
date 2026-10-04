import { FIXTURE_SNAPSHOT, MARKET_SNAPSHOT } from './fixtures.js';
import { FRESH_AFTER_MS, GLOBAL_TRANSACTION_SCAN_PAGES, MAX_CATALOG_ASSETS, MAX_DISCOVERED_ASSETS, MAX_GLOBAL_TRANSACTION_SCAN, MAX_SWAPS, MAX_TRANSACTIONS_PER_WALLET, MAX_TRANSACTION_SCAN_PER_WALLET, SNAPSHOT_KEY_PREFIX, SNAPSHOT_POINTER_KEY, STALE_AFTER_MS } from './constants.js';
import { refreshMarket } from './market.js';
import { isRegisteredDexSwap, protocolForSwap, registeredDexRoutes } from './dexRegistry.js';

const HIRO = 'https://api.mainnet.hiro.so';

async function fetchJson(url, hiroApiKey) {
  const response = await fetch(url, { headers: hiroApiKey ? { 'x-api-key': hiroApiKey } : undefined, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const error = new Error(`Upstream request failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function isUsableSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Number.isFinite(Date.parse(snapshot.createdAt))) return false;
  return snapshot.market && typeof snapshot.market === 'object'
    && typeof snapshot.market.source === 'string' && Number.isFinite(Date.parse(snapshot.market.asOf))
    && Array.isArray(snapshot.assets)
    && snapshot.assets.every((asset) => asset && typeof asset === 'object' && typeof asset.symbol === 'string'
      && typeof asset.name === 'string' && typeof asset.imageUrl === 'string' && typeof asset.contractId === 'string'
      && Number.isFinite(Number(asset.decimals)) && asset.price !== undefined && asset.supply !== undefined
      && asset.totalSupply !== undefined && asset.marketCap !== undefined && asset.change24h !== undefined
      && asset.change7d !== undefined && asset.change30d !== undefined && Array.isArray(asset.priceHistory)
      && asset.priceHistory.every((point) => point && point.date !== undefined && point.price !== undefined))
    && snapshot.wallets && typeof snapshot.wallets === 'object' && !Array.isArray(snapshot.wallets)
    && Array.isArray(snapshot.swaps);
}

export async function resolveSnapshot(kv, now = Date.now()) {
  if (!kv) return { snapshot: FIXTURE_SNAPSHOT, state: 'fixture' };
  const pointer = await kv.get(SNAPSHOT_POINTER_KEY, 'json');
  if (!pointer?.key) return { snapshot: FIXTURE_SNAPSHOT, state: 'fixture' };
  const snapshot = await kv.get(pointer.key, 'json');
  if (!isUsableSnapshot(snapshot)) return { snapshot: FIXTURE_SNAPSHOT, state: 'fixture' };
  const age = now - Date.parse(snapshot.createdAt);
  if (age < 0 || age > STALE_AFTER_MS) return { snapshot: FIXTURE_SNAPSHOT, state: 'fixture' };
  return { snapshot, state: age <= FRESH_AFTER_MS ? 'fresh' : 'stale' };
}

function normalizeSwap(wallet, transactionEntry) {
  const transaction = transactionEntry.tx || transactionEntry;
  const contractCall = transaction.contract_call || {};
  return {
    id: transaction.tx_id,
    txId: transaction.tx_id,
    wallet,
    protocol: protocolForSwap(transactionEntry),
    timestamp: transaction.burn_block_time_iso ?? transaction.block_time_iso ?? transaction.burn_block_time ?? transaction.block_time ?? null,
    blockHeight: transaction.block_height ?? null,
    contractId: contractCall.contract_id ?? null,
    functionName: contractCall.function_name ?? null,
    status: transaction.tx_status ?? null,
    input: null,
    output: null,
    side: null,
    value: null
  };
}

function normalizeTransfers(transfers = []) {
  return transfers.map((transfer) => ({
    asset: transfer.asset_identifier ?? 'STX',
    amountAtomic: String(transfer.amount ?? '1'),
    amount: String(transfer.amount ?? '1'),
    sender: transfer.sender ?? null,
    recipient: transfer.recipient ?? null
  }));
}

function normalizeTransaction(transactionEntry) {
  const transaction = transactionEntry.tx || transactionEntry;
  const stxTransfers = normalizeTransfers(transactionEntry.stx_transfers ?? transaction.stx_transfers);
  const ftTransfers = normalizeTransfers(transactionEntry.ft_transfers ?? transaction.ft_transfers);
  const nftTransfers = normalizeTransfers(transactionEntry.nft_transfers ?? transaction.nft_transfers);
  return {
    id: transaction.tx_id,
    txId: transaction.tx_id,
    timestamp: transaction.burn_block_time_iso ?? transaction.block_time_iso ?? transaction.burn_block_time ?? transaction.block_time ?? null,
    blockHeight: transaction.block_height ?? null,
    type: transaction.tx_type ?? null,
    status: transaction.tx_status ?? null,
    transfers: { stx: stxTransfers, fungible: ftTransfers, nft: nftTransfers },
    stxTransfers,
    ftTransfers,
    nftTransfers
  };
}

function assetContractId(assetIdentifier) {
  return assetIdentifier.split('::')[0];
}

function safeImageUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  if (value.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${value.slice(7).replace(/^ipfs\//, '')}`;
  try { return new URL(value).protocol === 'https:' ? value : ''; } catch { return ''; }
}

async function discoverAssets(balancePayloads, knownAssets, hiroApiKey) {
  const knownContractIds = new Set(knownAssets.map((asset) => asset.contractId));
  const contractIds = [...new Set(balancePayloads.flatMap((balances) => Object.keys(balances.fungible_tokens || {}).map(assetContractId)))]
    .filter((contractId) => !knownContractIds.has(contractId))
    .slice(0, MAX_DISCOVERED_ASSETS);
  const discovered = await Promise.all(contractIds.map(async (contractId) => {
    try {
      const metadata = await fetchJson(`${HIRO}/metadata/v1/ft/${encodeURIComponent(contractId)}`, hiroApiKey);
      const decimals = Number(metadata.decimals);
      if (!Number.isInteger(decimals) || decimals < 0) return null;
      const symbol = metadata.symbol || contractId.split('.')[1];
      return {
        symbol,
        name: metadata.name || symbol,
        imageUrl: safeImageUrl(metadata.image_canonical_uri || metadata.image_thumbnail_uri || metadata.image_uri),
        contractId,
        decimals,
        price: null,
        supply: null,
        totalSupply: metadata.total_supply ?? null,
        marketCap: null,
        change24h: null,
        change7d: null,
        change30d: null,
        priceHistory: [],
        metadataSource: 'hiro',
        marketDataSource: null,
        historyDataSource: null
      };
    } catch (cause) {
      console.warn('Token metadata unavailable', { contractId, message: cause.message });
      return null;
    }
  }));
  return discovered.filter(Boolean);
}

function assetFromMetadata(metadata) {
  const contractId = metadata.contract_principal || assetContractId(metadata.asset_identifier || '');
  const decimals = Number(metadata.decimals);
  if (!contractId || !Number.isInteger(decimals) || decimals < 0) return null;
  const symbol = metadata.symbol || contractId.split('.')[1];
  return {
    symbol,
    name: metadata.name || symbol,
    imageUrl: safeImageUrl(metadata.image_canonical_uri || metadata.image_thumbnail_uri || metadata.image_uri),
    contractId,
    decimals,
    price: null,
    supply: null,
    totalSupply: metadata.total_supply ?? null,
    marketCap: null,
    change24h: null,
    change7d: null,
    change30d: null,
    priceHistory: [],
    metadataSource: 'hiro',
    marketDataSource: null,
    historyDataSource: null
  };
}

async function fetchTradableCandidates(hiroApiKey) {
  try {
    const payload = await fetchJson(`${HIRO}/metadata/v1/ft?valid_metadata_only=true&limit=${MAX_CATALOG_ASSETS}&offset=0`, hiroApiKey);
    return (payload.results || []).map(assetFromMetadata).filter(Boolean);
  } catch (cause) {
    console.warn('Token catalog refresh unavailable', { message: cause.message });
    return [];
  }
}

async function fetchCuratedMetadata(hiroApiKey) {
  const metadata = await Promise.all(MARKET_SNAPSHOT.assets.filter((asset) => asset.symbol !== 'STX').map(async (asset) => {
    try {
      return assetFromMetadata(await fetchJson(`${HIRO}/metadata/v1/ft/${encodeURIComponent(asset.contractId)}`, hiroApiKey));
    } catch (cause) {
      console.warn('Curated token metadata unavailable', { contractId: asset.contractId, message: cause.message });
      return null;
    }
  }));
  return metadata.filter(Boolean);
}

async function fetchGlobalSwaps(hiroApiKey) {
  const swaps = [];
  try {
    for (const route of registeredDexRoutes()) {
      for (let page = 0; page < GLOBAL_TRANSACTION_SCAN_PAGES; page += 1) {
        const payload = await fetchJson(`${HIRO}/extended/v1/address/${route.contractId}/transactions?limit=${MAX_GLOBAL_TRANSACTION_SCAN}&offset=${page * MAX_GLOBAL_TRANSACTION_SCAN}`, hiroApiKey);
        swaps.push(...(payload.results || []).filter(isRegisteredDexSwap).map((transaction) => normalizeSwap(null, transaction)));
      }
    }
    return { swaps, error: null, asOf: new Date().toISOString() };
  } catch (cause) {
    console.warn('Global swap refresh unavailable', { message: cause.message });
    const error = cause.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : cause.status === 429 ? 'UPSTREAM_RATE_LIMITED' : cause.status ? `UPSTREAM_HTTP_${cause.status}` : 'UPSTREAM_UNAVAILABLE';
    return { swaps: [], error, asOf: null };
  }
}

function numericBalance(rawBalance, decimals) {
  const raw = Number(rawBalance);
  const divisor = 10 ** decimals;
  return Number.isFinite(raw) && Number.isFinite(divisor) ? raw / divisor : null;
}

function buildWalletAssets(balances, assets) {
  const rawBalances = new Map([['STX', balances.stx?.balance]]);
  for (const [contractId, balance] of Object.entries(balances.fungible_tokens || {})) rawBalances.set(contractId, balance?.balance);
  return assets.flatMap((asset) => {
    const rawBalance = asset.symbol === 'STX'
      ? rawBalances.get('STX')
      : [...rawBalances.entries()].find(([contractId]) => contractId === asset.contractId || contractId.startsWith(`${asset.contractId}::`))?.[1];
    if (typeof rawBalance !== 'string' || !/^\d+$/.test(rawBalance)) return [];
    const balance = numericBalance(rawBalance, asset.decimals);
    const price = Number(asset.price);
    if (balance === null) return [];
    return [{
      symbol: asset.symbol,
      name: asset.name,
      imageUrl: asset.imageUrl,
      contractId: asset.contractId,
      decimals: asset.decimals,
      rawBalance,
      balance,
      price: asset.price,
      value: Number.isFinite(price) ? price * rawBalance / 10 ** asset.decimals : null
    }];
  });
}

async function fetchWalletSource(wallet, hiroApiKey) {
  const address = wallet.address;
  const [balances, transactionPayload] = await Promise.all([
    fetchJson(`${HIRO}/extended/v1/address/${address}/balances`, hiroApiKey),
    fetchJson(`${HIRO}/extended/v1/address/${address}/transactions_with_transfers?limit=${MAX_TRANSACTION_SCAN_PER_WALLET}&offset=0`, hiroApiKey)
  ]);
  return { balances, transactions: transactionPayload.results || [] };
}

function buildWalletData(wallet, source, assets) {
  if (!source) return { label: wallet.label, description: wallet.description, assets: [], totalValue: 0, portfolioTotal: 0, activity: [], transactions: [], swaps: [] };
  const transactions = source.transactions.slice(0, MAX_TRANSACTIONS_PER_WALLET);
  const walletAssets = buildWalletAssets(source.balances, assets);
  const activity = transactions.map(normalizeTransaction);
  const swaps = source.transactions
    .filter(isRegisteredDexSwap)
    .map((transaction) => normalizeSwap(wallet.address, transaction));
  const totalValue = walletAssets.reduce((total, asset) => total + (Number.isFinite(asset.value) ? asset.value : 0), 0);
  return {
    label: wallet.label,
    description: wallet.description,
    assets: walletAssets,
    totalValue,
    portfolioTotal: totalValue,
    activity,
    transactions: activity,
    swaps
  };
}

export async function refreshSnapshot(env, config, now = new Date()) {
  const hiroApiKey = env.HIRO_API_KEY;
  const [feesResult, infoResult, stxSupplyResult, walletResults, catalogCandidates, curatedMetadata, globalSwapResult] = await Promise.all([
    fetchJson(`${HIRO}/extended/v2/mempool/fees`, hiroApiKey).catch((cause) => { console.warn('Fee refresh unavailable', { message: cause.message }); return null; }),
    fetchJson(`${HIRO}/v2/info`, hiroApiKey).catch((cause) => { console.warn('Chain info refresh unavailable', { message: cause.message }); return null; }),
    fetchJson(`${HIRO}/extended/v1/stx_supply`, hiroApiKey).catch((cause) => { console.warn('STX supply refresh unavailable', { message: cause.message }); return null; }),
    Promise.allSettled(config.wallets.map(async (wallet) => [wallet.address, await fetchWalletSource(wallet, hiroApiKey)])),
    fetchTradableCandidates(hiroApiKey),
    fetchCuratedMetadata(hiroApiKey),
    fetchGlobalSwaps(hiroApiKey)
  ]);
  const fees = feesResult;
  const info = infoResult || {};
  const stxSupply = stxSupplyResult || {};
  const walletSources = walletResults.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  const discoveredAssets = await discoverAssets(walletSources.map(([, source]) => source.balances), MARKET_SNAPSHOT.assets, hiroApiKey);
  const refreshedMarket = await refreshMarket(env.COINGECKO_DEMO_API_KEY, [...catalogCandidates, ...curatedMetadata, ...discoveredAssets]);
  const marketAssets = refreshedMarket?.assets || [...MARKET_SNAPSHOT.assets, ...discoveredAssets];
  const assets = refreshedMarket ? marketAssets.filter((asset) => asset.symbol === 'STX' || asset.marketDataSource) : marketAssets;
  const sourcesByAddress = Object.fromEntries(walletSources);
  const walletEntries = config.wallets.map((wallet) => [wallet.address, buildWalletData(wallet, sourcesByAddress[wallet.address], assets)]);
  const wallets = Object.fromEntries(walletEntries);
  const swaps = globalSwapResult.swaps
    .sort((left, right) => String(right.timestamp ?? '').localeCompare(String(left.timestamp ?? '')))
    .slice(0, MAX_SWAPS);
  const snapshot = {
    version: 1,
    createdAt: now.toISOString(),
    source: 'hybrid',
    market: {
      fees,
      stacksTipHeight: info.stacks_tip_height,
      block_height: info.stacks_tip_height,
      stxSupply: stxSupply.unlocked_stx,
      source: refreshedMarket?.source || MARKET_SNAPSHOT.source,
      asOf: refreshedMarket?.asOf || MARKET_SNAPSHOT.asOf,
      historySource: refreshedMarket?.historySource || 'snapshot',
      liveAssetCount: refreshedMarket?.liveAssetCount || 0,
      swaps: { count: swaps.length, asOf: globalSwapResult.asOf, source: 'hiro-dex-contracts', error: globalSwapResult.error },
      history: assets.map((asset) => ({ symbol: asset.symbol, points: asset.priceHistory }))
    },
    assets,
    wallets,
    swaps
  };
  const key = `${SNAPSHOT_KEY_PREFIX}${now.getTime()}`;
  await env.SNAPSHOTS.put(key, JSON.stringify(snapshot));
  await env.SNAPSHOTS.put(SNAPSHOT_POINTER_KEY, JSON.stringify({ key, createdAt: snapshot.createdAt }));
  return snapshot;
}
