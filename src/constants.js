export const API_VERSION = '2.6.3';
export const SNAPSHOT_POINTER_KEY = 'snapshot:current';
export const SNAPSHOT_KEY_PREFIX = 'snapshot:v1:';
export const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
export const REFRESH_INTERVAL_MINUTES = REFRESH_INTERVAL_MS / 60_000;
export const FRESH_AFTER_MS = 2 * REFRESH_INTERVAL_MS;
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const MAX_SWAPS = 50;
export const MAX_TRANSACTIONS_PER_WALLET = 25;
export const MAX_TRANSACTION_SCAN_PER_WALLET = 100;
export const MAX_DISCOVERED_ASSETS = 40;
export const MAX_CATALOG_ASSETS = 50;
// A 20-item global page stays within Hiro's public response-time/rate limits.
export const MAX_GLOBAL_TRANSACTION_SCAN = 20;
export const GLOBAL_TRANSACTION_SCAN_PAGES = 3;
