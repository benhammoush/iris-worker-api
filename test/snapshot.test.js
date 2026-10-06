import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_SNAPSHOT } from '../src/fixtures.js';
import { resolveSnapshot } from '../src/snapshot.js';
import { SNAPSHOT_FRESH_AFTER_MS, STALE_AFTER_MS } from '../src/constants.js';

const now = Date.parse('2026-10-02T12:00:00.000Z');

function kv(snapshot) {
  return {
    get: async (key) => key === 'snapshot:current' ? { key: 'snapshot:v1:test' } : snapshot
  };
}

function snapshot(createdAt) {
  return { createdAt, market: { source: 'snapshot', asOf: '2025-06-30T00:00:00.000Z' }, assets: [], wallets: {}, swaps: [] };
}

test('snapshot resolver distinguishes fresh, stale, and fixture data at exact boundaries', async () => {
  const fresh = await resolveSnapshot(kv(snapshot(new Date(now - SNAPSHOT_FRESH_AFTER_MS).toISOString())), now);
  const stale = await resolveSnapshot(kv(snapshot(new Date(now - SNAPSHOT_FRESH_AFTER_MS - 1).toISOString())), now);
  const oldestStale = await resolveSnapshot(kv(snapshot(new Date(now - STALE_AFTER_MS).toISOString())), now);
  const expired = await resolveSnapshot(kv(snapshot(new Date(now - STALE_AFTER_MS - 1).toISOString())), now);
  assert.equal(fresh.state, 'fresh');
  assert.equal(stale.state, 'stale');
  assert.equal(oldestStale.state, 'stale');
  assert.equal(expired.state, 'fixture');
  assert.strictEqual(expired.snapshot, FIXTURE_SNAPSHOT);
});

test('snapshot resolver replaces invalid current data with the bundled fixture object', async () => {
  const resolved = await resolveSnapshot(kv({ createdAt: 'not-a-date', market: { source: 'snapshot', asOf: '2025-06-30T00:00:00.000Z' }, assets: [], wallets: {}, swaps: [] }), now);
  assert.equal(resolved.state, 'fixture');
  assert.strictEqual(resolved.snapshot, FIXTURE_SNAPSHOT);
});
