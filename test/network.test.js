import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNetworkSnapshot, summarizePerformance, summarizeProduction } from '../src/network.js';

test('network summaries use weighted TPS and current-epoch aggregate production', () => {
  assert.deepEqual(summarizePerformance([{ numTransactions: 100, numNonVoteTransactions: 80, samplePeriodSecs: 2 }, { numTransactions: 150, numNonVoteTransactions: 90, samplePeriodSecs: 3 }]), { tps: 50, nonVoteTps: 34, sampleCount: 2, samplePeriodSecs: 5, transactions: 250, nonVoteTransactions: 170 });
  assert.deepEqual(summarizeProduction({ value: { range: { firstSlot: 1, lastSlot: 5 }, byIdentity: { one: [4, 3], two: [6, 5] } } }), { assignedLeaderSlots: 10, blocksProduced: 8, missedLeaderSlots: 2, productionPct: 80, range: { firstSlot: 1, lastSlot: 5 } });
});

test('failed network groups retain prior values as stale without substituting zero', () => {
  const rejected = { status: 'rejected', reason: new Error('unavailable') };
  const snapshot = normalizeNetworkSnapshot({ slots: rejected, epoch: rejected, blockHeight: rejected, blockTime: rejected, performance: rejected, production: rejected, priorityFees: rejected, voteAccounts: rejected, supply: rejected, inflationRate: rejected, inflationGovernor: rejected, block: rejected }, { performance: { state: 'fresh', asOf: '2026-10-01T00:00:00.000Z', tps: 42 }, chain: { state: 'fresh', asOf: '2026-10-01T00:00:00.000Z', finalizedSlot: 123 } }, new Date('2026-10-02T00:00:00.000Z'));
  assert.equal(snapshot.performance.state, 'stale');
  assert.equal(snapshot.performance.tps, 42);
  assert.equal(snapshot.chain.state, 'stale');
  assert.equal(snapshot.fees.state, 'unavailable');
});
