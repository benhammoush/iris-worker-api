import { FIXTURE_SNAPSHOT, MARKET_SNAPSHOT } from './fixtures.js';
import { FRESH_AFTER_MS, MAX_SWAPS, MAX_TRANSACTIONS_PER_WALLET, SNAPSHOT_KEY_PREFIX, SNAPSHOT_POINTER_KEY, STALE_AFTER_MS } from './constants.js';

const HIRO = 'https://api.mainnet.hiro.so';

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Upstream request failed with ${response.status}`);
  return response.json();
}

export function isUsableSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Number.isFinite(Date.parse(snapshot.createdAt))) return false;
  return snapshot.market && typeof snapshot.market === 'object'
    && snapshot.market.source === 'snapshot' && Number.isFinite(Date.parse(snapshot.market.asOf))
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
    txId: transaction.tx_id,
    wallet,
    timestamp: transaction.burn_block_time_iso ?? transaction.block_time_iso ?? transaction.burn_block_time ?? transaction.block_time ?? null,
    blockHeight: transaction.block_height ?? null,
    contractId: contractCall.contract_id ?? null,
    functionName: contractCall.function_name ?? null,
    status: transaction.tx_status ?? null
  };
}

function normalizeTransfers(transfers = []) {
  return transfers.map((transfer) => ({
    asset: transfer.asset_identifier ?? 'STX',
    amount: String(transfer.amount ?? '1'),
    sender: transfer.sender ?? null,
    recipient: transfer.recipient ?? null
  }));
}

function normalizeTransaction(transactionEntry) {
  const transaction = transactionEntry.tx || transactionEntry;
  return {
    txId: transaction.tx_id,
    timestamp: transaction.burn_block_time_iso ?? transaction.block_time_iso ?? transaction.burn_block_time ?? transaction.block_time ?? null,
    blockHeight: transaction.block_height ?? null,
    type: transaction.tx_type ?? null,
    status: transaction.tx_status ?? null,
    stxTransfers: normalizeTransfers(transactionEntry.stx_transfers ?? transaction.stx_transfers),
    ftTransfers: normalizeTransfers(transactionEntry.ft_transfers ?? transaction.ft_transfers),
    nftTransfers: normalizeTransfers(transactionEntry.nft_transfers ?? transaction.nft_transfers)
  };
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
    if (balance === null || !Number.isFinite(price)) return [];
    return [{
      symbol: asset.symbol,
      name: asset.name,
      imageUrl: asset.imageUrl,
      contractId: asset.contractId,
      decimals: asset.decimals,
      rawBalance,
      balance,
      price: asset.price,
      value: price * rawBalance / 10 ** asset.decimals
    }];
  });
}

async function fetchWalletData(wallet, assets) {
  const address = wallet.address;
  const [balances, transactionPayload] = await Promise.all([
    fetchJson(`${HIRO}/extended/v1/address/${address}/balances`),
    fetchJson(`${HIRO}/extended/v1/address/${address}/transactions_with_transfers?limit=${MAX_TRANSACTIONS_PER_WALLET}&offset=0`)
  ]);
  const transactions = (transactionPayload.results || []).slice(0, MAX_TRANSACTIONS_PER_WALLET);
  const walletAssets = buildWalletAssets(balances, assets);
  const swaps = transactions
    .filter((transaction) => {
      const tx = transaction.tx || transaction;
      return tx.contract_call?.function_name === 'swap-helper' && tx.tx_status === 'success';
    })
    .map((transaction) => normalizeSwap(address, transaction));
  return {
    label: wallet.label,
    description: wallet.description,
    assets: walletAssets,
    portfolioTotal: walletAssets.reduce((total, asset) => total + asset.value, 0),
    transactions: transactions.map(normalizeTransaction),
    swaps
  };
}

export async function refreshSnapshot(env, config, now = new Date()) {
  const [fees, info, stxSupply] = await Promise.all([
    fetchJson(`${HIRO}/extended/v2/mempool/fees`),
    fetchJson(`${HIRO}/v2/info`),
    fetchJson(`${HIRO}/extended/v1/stx_supply`)
  ]);
  const assets = MARKET_SNAPSHOT.assets;
  const walletEntries = await Promise.all(config.wallets.map(async (wallet) => [wallet.address, await fetchWalletData(wallet, assets)]));
  const wallets = Object.fromEntries(walletEntries);
  const swaps = walletEntries
    .flatMap(([, data]) => data.swaps)
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
      source: MARKET_SNAPSHOT.source,
      asOf: MARKET_SNAPSHOT.asOf,
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
