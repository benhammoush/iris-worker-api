const LAMPORTS_PER_SOL = 1_000_000_000;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function median(values) {
  const sorted = values.filter((value) => finite(value) !== null).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function staleOrUnavailable(previous, key) {
  const prior = previous?.[key];
  return prior && prior.state !== 'unavailable' ? { ...prior, state: 'stale' } : { state: 'unavailable', asOf: null };
}

function fulfilled(result) {
  return result.status === 'fulfilled' ? result.value : null;
}

function logRejectedRpcCalls(methods, results) {
  results.forEach((result, index) => {
    if (result.status === 'rejected') console.warn('Helius network RPC unavailable', { method: methods[index], message: result.reason?.message || String(result.reason) });
  });
}

export function summarizePerformance(samples) {
  const usable = (Array.isArray(samples) ? samples : []).filter((sample) => finite(sample?.numTransactions) !== null && finite(sample?.samplePeriodSecs) !== null && sample.samplePeriodSecs > 0);
  const seconds = usable.reduce((total, sample) => total + sample.samplePeriodSecs, 0);
  const transactions = usable.reduce((total, sample) => total + sample.numTransactions, 0);
  const hasNonVote = usable.length > 0 && usable.every((sample) => finite(sample.numNonVoteTransactions) !== null);
  const nonVoteTransactions = hasNonVote ? usable.reduce((total, sample) => total + sample.numNonVoteTransactions, 0) : null;
  return { tps: seconds ? transactions / seconds : null, nonVoteTps: seconds && nonVoteTransactions !== null ? nonVoteTransactions / seconds : null, sampleCount: usable.length, samplePeriodSecs: seconds, transactions, nonVoteTransactions };
}

export function summarizeProduction(production) {
  const entries = Object.values(production?.value?.byIdentity || {});
  const totals = entries.reduce((current, value) => ({ assigned: current.assigned + (finite(value?.[0]) || 0), produced: current.produced + (finite(value?.[1]) || 0) }), { assigned: 0, produced: 0 });
  return { assignedLeaderSlots: totals.assigned, blocksProduced: totals.produced, missedLeaderSlots: totals.assigned - totals.produced, productionPct: totals.assigned ? totals.produced / totals.assigned * 100 : null, range: production?.value?.range || null };
}

export function summarizeLatestBlock(block) {
  const transactions = Array.isArray(block?.transactions) ? block.transactions : [];
  const fees = transactions.map((transaction) => finite(transaction?.meta?.fee)).filter((value) => value !== null && value >= 0);
  const failedTransactions = transactions.filter((transaction) => transaction?.meta?.err != null).length;
  return { available: Boolean(block), slot: finite(block?.parentSlot) === null ? null : block.parentSlot + 1, blockHeight: finite(block?.blockHeight), blockTime: finite(block?.blockTime), transactionCount: transactions.length, failedTransactions: block ? failedTransactions : null, failurePct: block && transactions.length ? failedTransactions / transactions.length * 100 : null, averageFeeLamports: fees.length ? fees.reduce((total, fee) => total + fee, 0) / fees.length : null, feeSampleCount: fees.length };
}

export function normalizeNetworkSnapshot(results, previous = null, now = new Date()) {
  const asOf = now.toISOString();
  const slots = fulfilled(results.slots);
  const epoch = fulfilled(results.epoch);
  const blockHeight = fulfilled(results.blockHeight);
  const blockTime = fulfilled(results.blockTime);
  const performanceSamples = fulfilled(results.performance);
  const production = fulfilled(results.production);
  const priorityFees = fulfilled(results.priorityFees);
  const voteAccounts = fulfilled(results.voteAccounts);
  const supply = fulfilled(results.supply);
  const inflationRate = fulfilled(results.inflationRate);
  const inflationGovernor = fulfilled(results.inflationGovernor);
  const block = fulfilled(results.block);
  const chain = slots && epoch && blockHeight !== null ? { state: 'fresh', asOf, commitment: 'finalized', processedSlot: finite(slots.processed), confirmedSlot: finite(slots.confirmed), finalizedSlot: finite(slots.finalized), blockHeight: finite(blockHeight), blockTime: finite(blockTime), epoch: finite(epoch.epoch), slotIndex: finite(epoch.slotIndex), slotsInEpoch: finite(epoch.slotsInEpoch), epochProgressPct: finite(epoch.slotIndex) !== null && finite(epoch.slotsInEpoch) > 0 ? epoch.slotIndex / epoch.slotsInEpoch * 100 : null } : staleOrUnavailable(previous, 'chain');
  const performance = performanceSamples ? { state: 'fresh', asOf, ...summarizePerformance(performanceSamples) } : staleOrUnavailable(previous, 'performance');
  const productionSummary = production ? { state: 'fresh', asOf, ...summarizeProduction(production) } : staleOrUnavailable(previous, 'production');
  const priorityFeeValues = Array.isArray(priorityFees) ? priorityFees.map((sample) => finite(sample?.prioritizationFee)).filter((value) => value !== null && value >= 0) : null;
  const blockSummary = block ? summarizeLatestBlock(block) : null;
  const fees = priorityFeeValues !== null || blockSummary ? { state: 'fresh', asOf, averageFeeLamports: blockSummary?.averageFeeLamports ?? null, feeSampleCount: blockSummary?.feeSampleCount ?? 0, medianPriorityFeeMicroLamports: priorityFeeValues ? median(priorityFeeValues) : null, priorityFeeSampleCount: priorityFeeValues?.length ?? 0 } : staleOrUnavailable(previous, 'fees');
  const validators = voteAccounts ? { state: 'fresh', asOf, currentVoteAccounts: Array.isArray(voteAccounts.current) ? voteAccounts.current.length : 0, delinquentVoteAccounts: Array.isArray(voteAccounts.delinquent) ? voteAccounts.delinquent.length : 0 } : staleOrUnavailable(previous, 'validators');
  const economics = supply ? { state: 'fresh', asOf, totalSol: finite(supply.value?.total) === null ? null : supply.value.total / LAMPORTS_PER_SOL, circulatingSol: finite(supply.value?.circulating) === null ? null : supply.value.circulating / LAMPORTS_PER_SOL, nonCirculatingSol: finite(supply.value?.nonCirculating) === null ? null : supply.value.nonCirculating / LAMPORTS_PER_SOL, inflationTotalPct: finite(inflationRate?.total) === null ? null : inflationRate.total * 100, inflationValidatorPct: finite(inflationRate?.validator) === null ? null : inflationRate.validator * 100, inflationFoundationPct: finite(inflationRate?.foundation) === null ? null : inflationRate.foundation * 100, inflationEpoch: finite(inflationRate?.epoch), inflationGovernor: inflationGovernor || null } : staleOrUnavailable(previous, 'economics');
  const reliability = blockSummary ? { state: 'fresh', asOf, available: blockSummary.available, finalizedSlot: slots ? finite(slots.finalized) : null, blockHeight: blockSummary.blockHeight, blockTime: blockSummary.blockTime, transactionCount: blockSummary.transactionCount, failedTransactions: blockSummary.failedTransactions, failurePct: blockSummary.failurePct } : staleOrUnavailable(previous, 'reliability');
  return { source: 'helius-rpc', fetchedAt: asOf, chain, performance, production: productionSummary, fees, validators, economics, reliability };
}

export async function refreshNetworkMetrics(rpc, previous = null, now = new Date()) {
  console.info('Refreshing Helius network metrics');
  const initialMethods = ['getSlot:processed', 'getSlot:confirmed', 'getSlot:finalized', 'getBlockHeight', 'getEpochInfo', 'getRecentPerformanceSamples', 'getRecentPrioritizationFees', 'getVoteAccounts', 'getSupply', 'getInflationRate', 'getInflationGovernor'];
  const initial = await Promise.allSettled([
    rpc('getSlot', [{ commitment: 'processed' }]), rpc('getSlot', [{ commitment: 'confirmed' }]), rpc('getSlot', [{ commitment: 'finalized' }]), rpc('getBlockHeight', [{ commitment: 'finalized' }]), rpc('getEpochInfo', [{ commitment: 'finalized' }]), rpc('getRecentPerformanceSamples', [5]), rpc('getRecentPrioritizationFees', []), rpc('getVoteAccounts', [{ commitment: 'finalized' }]), rpc('getSupply', [{ commitment: 'finalized', excludeNonCirculatingAccountsList: true }]), rpc('getInflationRate', [{ commitment: 'finalized' }]), rpc('getInflationGovernor', [{ commitment: 'finalized' }])
  ]);
  logRejectedRpcCalls(initialMethods, initial);
  const [processed, confirmed, finalized, blockHeight, epoch, performance, priorityFees, voteAccounts, supply, inflationRate, inflationGovernor] = initial;
  const finalizedSlot = fulfilled(finalized);
  const epochInfo = fulfilled(epoch);
  const blockSlotsResult = finalizedSlot === null ? { status: 'rejected', reason: new Error('Finalized slot unavailable') } : await Promise.allSettled([rpc('getBlocksWithLimit', [Math.max(0, finalizedSlot - 500), 500, { commitment: 'finalized' }])]).then(([result]) => result);
  const blockSlots = fulfilled(blockSlotsResult);
  const latestBlockSlot = Array.isArray(blockSlots) && blockSlots.length ? blockSlots[blockSlots.length - 1] : null;
  const dependent = await Promise.allSettled([
    finalizedSlot === null ? Promise.reject(new Error('Finalized slot unavailable')) : rpc('getBlockTime', [finalizedSlot]),
    finalizedSlot === null || !epochInfo ? Promise.reject(new Error('Epoch range unavailable')) : rpc('getBlockProduction', [{ commitment: 'finalized', range: { firstSlot: epochInfo.absoluteSlot - epochInfo.slotIndex, lastSlot: finalizedSlot } }]),
    latestBlockSlot === null ? Promise.reject(new Error('No recent finalized block is available')) : rpc('getBlock', [latestBlockSlot, { commitment: 'finalized', transactionDetails: 'full', rewards: false, maxSupportedTransactionVersion: 0 }])
  ]);
  logRejectedRpcCalls(['getBlockTime', 'getBlockProduction', 'getBlock'], dependent);
  const [blockTime, production, block] = dependent;
  return normalizeNetworkSnapshot({ slots: { status: processed.status === 'fulfilled' && confirmed.status === 'fulfilled' && finalized.status === 'fulfilled' ? 'fulfilled' : 'rejected', value: { processed: fulfilled(processed), confirmed: fulfilled(confirmed), finalized: finalizedSlot } }, blockHeight, epoch, performance, priorityFees, voteAccounts, supply, inflationRate, inflationGovernor, blockTime, production, block }, previous, now);
}
