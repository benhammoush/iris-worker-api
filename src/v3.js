import { SOL_MINT, V3_ASSET_HOLDER_PAGE_SIZE, V3_ASSET_ONCHAIN_CACHE_SECONDS, V3_WALLET_CACHE_SECONDS, V3_WALLET_KEY_PREFIX } from './constants.js';
import { refreshMarket } from './market.js';
import { decimalValue, formatAtomicAmount } from './transforms.js';

const HELIUS_RPC = 'https://mainnet.helius-rpc.com/';

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function fallbackAsset(mint, decimals) {
  return { mint, symbol: null, name: null, decimals: Number.isInteger(decimals) && decimals >= 0 ? decimals : null, iconUrl: null, priceUsd: null };
}

export function v3Asset(asset) {
  if (asset?.v3) return asset.v3;
  return {
    mint: asset?.mint ?? null, symbol: typeof asset?.symbol === 'string' ? asset.symbol : null, name: typeof asset?.name === 'string' ? asset.name : null,
    decimals: Number.isInteger(asset?.decimals) && asset.decimals >= 0 ? asset.decimals : null, iconUrl: typeof asset?.imageUrl === 'string' ? asset.imageUrl : null,
    priceUsd: finiteOrNull(asset?.price), marketCapUsd: finiteOrNull(asset?.marketCap), circulatingSupply: finiteOrNull(asset?.supply), totalSupply: finiteOrNull(asset?.totalSupply), fullyDilutedValuationUsd: null,
    change24hPct: finiteOrNull(asset?.change24h), liquidityUsd: null, holderCount: null,
    verification: { isVerified: false, tags: [] }, quality: { organicScore: null, organicScoreLabel: null, audit: null },
    activity: { buyVolume24hUsd: null, sellVolume24hUsd: null, volume24hUsd: null }
  };
}

export function mapV3HistoryPoints(points) {
  if (!Array.isArray(points)) return null;
  return points.flatMap((point) => {
    const timestamp = typeof point?.date === 'string' && Number.isFinite(Date.parse(point.date)) ? point.date : null;
    const priceUsd = finiteOrNull(point?.price);
    return timestamp !== null && priceUsd !== null ? [{ timestamp, priceUsd }] : [];
  });
}

export async function heliusRpc(method, params, apiKey) {
  const response = await fetch(`${HELIUS_RPC}?api-key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Helius RPC request failed with ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Helius RPC error: ${payload.error.message || 'unknown'}`);
  return payload.result;
}

function stringOrNull(value) {
  return typeof value === 'string' && value ? value : null;
}

function atomicString(value) {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
}

function assetOnchainProfile(mint, asset, supply, account) {
  const metadata = asset?.content?.metadata || {};
  const tokenInfo = asset?.token_info || {};
  const parsedMint = account?.value?.data?.parsed?.info || {};
  const decimals = Number.isInteger(tokenInfo.decimals) ? tokenInfo.decimals : Number.isInteger(parsedMint.decimals) ? parsedMint.decimals : null;
  const supplyAtomic = atomicString(tokenInfo.supply) || atomicString(supply?.value?.amount) || atomicString(parsedMint.supply);
  const extensions = Array.isArray(tokenInfo.extensions) ? tokenInfo.extensions.filter((extension) => typeof extension === 'string') : [];
  return {
    mint,
    interface: stringOrNull(asset?.interface),
    tokenProgram: stringOrNull(tokenInfo.token_program) || stringOrNull(asset?.ownership?.owner),
    lastIndexedSlot: Number.isSafeInteger(asset?.last_indexed_slot) ? asset.last_indexed_slot : null,
    metadata: {
      name: stringOrNull(metadata.name), symbol: stringOrNull(metadata.symbol), description: stringOrNull(metadata.description), uri: stringOrNull(asset?.content?.json_uri), image: stringOrNull(asset?.content?.links?.image), externalUrl: stringOrNull(metadata.external_url)
    },
    mintState: {
      decimals,
      supplyAtomic,
      supply: supplyAtomic !== null && decimals !== null ? formatAtomicAmount(supplyAtomic, decimals) : null,
      mintAuthority: stringOrNull(tokenInfo.mint_authority) || stringOrNull(parsedMint.mintAuthority),
      freezeAuthority: stringOrNull(tokenInfo.freeze_authority) || stringOrNull(parsedMint.freezeAuthority),
      isMutable: typeof asset?.mutable === 'boolean' ? asset.mutable : null,
      extensions
    }
  };
}

function holderFromDas(item) {
  const tokenInfo = item?.token_info || {};
  const atomicAmount = atomicString(tokenInfo.balance);
  const decimals = Number.isInteger(tokenInfo.decimals) && tokenInfo.decimals >= 0 ? tokenInfo.decimals : null;
  if (!atomicAmount || decimals === null) return null;
  return {
    tokenAccount: stringOrNull(item?.id), owner: stringOrNull(item?.ownership?.owner), atomicAmount,
    amount: formatAtomicAmount(atomicAmount, decimals), decimals,
    frozen: typeof item?.frozen === 'boolean' ? item.frozen : null,
    delegated: typeof tokenInfo.delegated_amount === 'string' ? tokenInfo.delegated_amount : null
  };
}

export async function loadV3AssetOnchain(env, config, mint) {
  const apiKey = config.heliusApiKey || env.HELIUS_API_KEY;
  if (!apiKey) { const cause = new Error('Helius is not configured.'); cause.code = 'ASSET_ONCHAIN_UNAVAILABLE'; throw cause; }
  const key = `asset:v3:onchain:${mint}`;
  const cached = env.SNAPSHOTS?.get ? await env.SNAPSHOTS.get(key, 'json') : null;
  if (cached?.profile?.mint === mint && Number.isFinite(Date.parse(cached.asOf))) return { profile: cached.profile, freshness: { cacheState: 'fresh', asOf: cached.asOf } };
  const [asset, supply, account] = await Promise.all([
    heliusRpc('getAsset', { id: mint }, apiKey),
    heliusRpc('getTokenSupply', [mint], apiKey),
    heliusRpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }], apiKey)
  ]);
  const profile = assetOnchainProfile(mint, asset, supply, account);
  const asOf = new Date().toISOString();
  if (env.SNAPSHOTS?.put) await env.SNAPSHOTS.put(key, JSON.stringify({ profile, asOf }), { expirationTtl: V3_ASSET_ONCHAIN_CACHE_SECONDS });
  return { profile, freshness: { cacheState: 'miss', asOf } };
}

export async function loadV3AssetHolders(env, config, mint, page = 1) {
  const apiKey = config.heliusApiKey || env.HELIUS_API_KEY;
  if (!apiKey) { const cause = new Error('Helius is not configured.'); cause.code = 'ASSET_ONCHAIN_UNAVAILABLE'; throw cause; }
  const result = await heliusRpc('getTokenAccounts', { mint, page, limit: V3_ASSET_HOLDER_PAGE_SIZE, options: { showZeroBalance: false } }, apiKey);
  const items = Array.isArray(result?.items) ? result.items.map(holderFromDas).filter(Boolean) : [];
  return { holders: items, page, total: Number.isInteger(result?.total) && result.total >= 0 ? result.total : null, cursor: stringOrNull(result?.cursor) };
}

async function parsedEvents(address, apiKey, limit, cursor) {
  const body = { address, limit, sortOrder: 'desc', commitment: 'confirmed' };
  if (cursor) body.paginationToken = cursor;
  const response = await fetch(`${HELIUS_RPC}v1/parsed-events/transaction-history?api-key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Helius parsed events request failed with ${response.status}`);
  const page = await response.json();
  return { data: Array.isArray(page?.data) ? page.data : [], paginationToken: typeof page?.paginationToken === 'string' ? page.paginationToken : null };
}

function dasHolding(item) {
  const mint = item?.id;
  const rawAmount = item?.token_info?.balance;
  const decimals = item?.token_info?.decimals ?? item?.content?.metadata?.decimals;
  if (typeof mint !== 'string' || !/^\d+$/.test(String(rawAmount)) || !Number.isInteger(decimals) || decimals < 0) return null;
  return { mint, rawAmount: String(rawAmount), decimals };
}

export function mapDasWallet(address, result, marketAssets) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const nativeRawAmount = result?.nativeBalance?.lamports;
  const native = /^\d+$/.test(String(nativeRawAmount)) && String(nativeRawAmount) !== '0' ? [{ mint: SOL_MINT, rawAmount: String(nativeRawAmount), decimals: 9 }] : [];
  const holdings = [...native, ...items.map(dasHolding).filter((holding) => holding && holding.rawAmount !== '0')];
  const balancesTruncated = holdings.length >= 100 || (Number.isInteger(result?.total) && result.total > items.length);
  const returned = holdings.slice(0, 40);
  const assetByMint = new Map(marketAssets.map((asset) => [asset.mint, asset]));
  let pricedHoldingCount = 0;
  let pricedSubtotalUsd = 0;
  const balances = returned.map((holding) => {
    const asset = assetByMint.get(holding.mint) || fallbackAsset(holding.mint, holding.decimals);
    const decimals = asset.decimals ?? holding.decimals;
    const amount = formatAtomicAmount(holding.rawAmount, decimals);
    const amountNumber = decimalValue(amount);
    const priceUsd = finiteOrNull(asset.priceUsd);
    const valueUsd = amountNumber === null || priceUsd === null ? null : amountNumber * priceUsd;
    if (valueUsd !== null && Number.isFinite(valueUsd)) { pricedHoldingCount += 1; pricedSubtotalUsd += valueUsd; }
    return { mint: holding.mint, symbol: asset.symbol, name: asset.name, decimals, iconUrl: asset.iconUrl, atomicAmount: holding.rawAmount, amount, priceUsd, valueUsd: Number.isFinite(valueUsd) ? valueUsd : null };
  });
  const unpricedHoldingCount = balances.length - pricedHoldingCount;
  return { address, balances, holdingsTruncated: holdings.length > 40 || balancesTruncated, valuation: { pricedSubtotalUsd, holdingCount: balances.length, pricedHoldingCount, unpricedHoldingCount, complete: !balancesTruncated && !unpricedHoldingCount } };
}

export async function loadV3Wallet(env, config, address, marketRefresh = refreshMarket) {
  const apiKey = config.heliusApiKey || env.HELIUS_API_KEY;
  if (!apiKey) { const cause = new Error('Helius is not configured.'); cause.code = 'WALLET_LOOKUP_UNAVAILABLE'; throw cause; }
  const key = `${V3_WALLET_KEY_PREFIX}${address}`;
  const cached = env.SNAPSHOTS?.get ? await env.SNAPSHOTS.get(key, 'json') : null;
  if (cached?.wallet?.address === address && Number.isFinite(Date.parse(cached.asOf))) return { wallet: cached.wallet, freshness: { cacheState: 'fresh', asOf: cached.asOf } };
  const result = await heliusRpc('getAssetsByOwner', { ownerAddress: address, page: 1, limit: 100, displayOptions: { showFungible: true, showNativeBalance: true, showGrandTotal: true } }, apiKey);
  const mints = (Array.isArray(result?.items) ? result.items : []).map((item) => item?.id).filter((mint) => typeof mint === 'string').slice(0, 40);
  if (!mints.includes(SOL_MINT)) mints.unshift(SOL_MINT);
  let market = null;
  try {
    market = await marketRefresh(config.jupiterApiKey || env.JUPITER_API_KEY, mints.slice(0, 40));
  } catch (cause) {
    console.warn('Jupiter wallet enrichment unavailable', { message: cause?.message });
  }
  const wallet = mapDasWallet(address, result, (market?.assets || []).map(v3Asset));
  const asOf = new Date().toISOString();
  if (env.SNAPSHOTS?.put) await env.SNAPSHOTS.put(key, JSON.stringify({ wallet, asOf }), { expirationTtl: V3_WALLET_CACHE_SECONDS });
  return { wallet, freshness: { cacheState: 'miss', asOf } };
}

function atomicAmount(value) {
  const raw = value?.tokenAmount ?? value?.amount ?? value;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return raw;
  if (typeof raw === 'bigint') return raw.toString();
  // JSON numbers above this boundary have already lost integer precision.
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : null;
}

function transferDetails(parsed) {
  return {
    native: (parsed?.nativeTransfers || []).map((transfer) => ({ from: transfer.fromUserAccount ?? null, to: transfer.toUserAccount ?? null, atomicAmount: atomicAmount(transfer.amount ?? transfer.lamports ?? transfer.rawAmount) })),
    tokens: (parsed?.tokenTransfers || []).map((transfer) => {
      const raw = transfer.rawTokenAmount ?? transfer.tokenAmount ?? transfer.amount;
      const decimals = transfer.decimals ?? raw?.decimals;
      return { mint: transfer.mint ?? null, from: transfer.fromUserAccount ?? null, to: transfer.toUserAccount ?? null, fromTokenAccount: transfer.fromTokenAccount ?? null, toTokenAccount: transfer.toTokenAccount ?? null, atomicAmount: atomicAmount(raw), decimals: Number.isInteger(decimals) && decimals >= 0 ? decimals : null, tokenStandard: typeof transfer.tokenStandard === 'string' ? transfer.tokenStandard : null };
    })
  };
}

export function mapV3Event(event) {
  const parsed = event?.parsed;
  const summary = parsed?.summary;
  return { id: typeof event?.signature === 'string' ? event.signature : null, timestamp: Number.isFinite(parsed?.blockTime) ? new Date(parsed.blockTime * 1000).toISOString() : null, type: typeof summary?.type === 'string' ? summary.type : null, source: typeof summary?.parsedData?.protocol === 'string' ? summary.parsedData.protocol : null, status: event?.parserStatus === 'OK' && parsed?.transactionStatus === 'OK' ? 'success' : 'failed', summary: typeof summary?.description === 'string' ? summary.description : null, description: typeof summary?.description === 'string' ? summary.description : null, transfers: transferDetails(parsed) };
}

export async function loadV3Events(env, config, address, limit, cursor) {
  const apiKey = config.heliusApiKey || env.HELIUS_API_KEY;
  if (!apiKey) { const cause = new Error('Helius is not configured.'); cause.code = 'WALLET_LOOKUP_UNAVAILABLE'; throw cause; }
  const page = await parsedEvents(address, apiKey, limit, cursor);
  const data = page.data.map(mapV3Event);
  return { events: data, nextCursor: page.paginationToken };
}
