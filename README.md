# Iris API

Cloudflare Worker API for cached Solana market data and configured public wallets. It is native JavaScript and uses Cloudflare KV only; it does not use Express, D1, or R2.

## Local development

1. Run `npm install`.
2. Copy `.dev.vars.example` to `.dev.vars` and set only local values. Do not commit `.dev.vars`.
3. Create the KV namespaces and replace the placeholder namespace IDs in `wrangler.toml` before deploying.
4. Set `HELIUS_API_KEY` and `JUPITER_API_KEY` in `.dev.vars` for live refreshes. Set `TRACKED_WALLETS` to a JSON array of public wallet metadata. Never commit secrets or private wallet information.
5. Run `npm run dev` or `npm test`.

Wallets are public addresses configured through `TRACKED_WALLETS`; Iris never requests wallet signing or private keys.

## Deployment

Pushes to `main` automatically deploy to Cloudflare after CI passes when the repository has a `CLOUDFLARE_API_TOKEN` GitHub Actions secret. Create a least-privilege Cloudflare token that can deploy Workers for the account hosting `iris-api`; its value is never stored in this repository. Set `HELIUS_API_KEY`, `JUPITER_API_KEY`, and `TRACKED_WALLETS` as Worker secrets. Set the same high-entropy `IRIS_REFRESH_TOKEN` GitHub secret as the Worker `REFRESH_TOKEN` secret to invoke the protected `/internal/refresh` endpoint immediately after deployment. The refresh publishes available sections and reports unavailable providers instead of failing when an optional upstream source is unavailable.

`TRACKED_WALLETS` must be a JSON array such as `[ {"address":"<base58 address>","label":"Treasury","description":"Public wallet"} ]`. It is public configuration, not a credential.

## Snapshot behavior

The production Cron runs every 15 minutes. Refresh fetches a finalized Solana slot, SOL and SPL/Token-2022 balances, decoded Helius wallet activity, Jupiter metadata and current prices, and GeckoTerminal seven-day history where it is available. A complete versioned snapshot is written to KV before its pointer is published, so readers never receive a partial refresh.

With `HELIUS_API_KEY` and `JUPITER_API_KEY` configured, Iris identifies assets by mint address, not symbol. Jupiter supplies metadata, icons, current prices, and 24-hour change; GeckoTerminal supplies seven-day history when available. Missing values are `null`, never a fabricated zero. The bundled data in `src/fixtures.js` is an explicitly labeled outage fallback, not live pricing.

Responses are JSON envelopes with `meta.requestId`; errors use `error.code`. Snapshot responses include `snapshotCreatedAt`, `refreshIntervalMinutes`, and `nextScheduledRefreshAt` (the next UTC cron boundary), plus `X-Snapshot-State`, and are `Cache-Control: no-store`. The resolver serves fresh data for up to 30 minutes, stale data for more than 30 minutes through 24 hours, then the bundled fixture snapshot.

## Endpoints

`GET /health`, `GET /ready`, `GET /v2/status`, `GET /v2/market`, `GET /v2/assets`, `GET /v2/assets/mint/:mint`, `GET /v2/assets/:symbol`, `GET /v2/swaps`, `GET /v2/wallets`, and `GET /v2/wallets/:address`. The previous `/v1` routes remain transitional aliases.

`/v2/wallets` returns public configured-wallet metadata only. `/v2/wallets/:address` requires an exact configured address and returns cached balances, `totalValue`, and decoded activity; atomic quantities remain strings. `/v2/swaps` reads decoded activity only for the reviewed pool registry and is explicitly not chain-wide. `/v2/status` reports swap scope and count. Asset detail lookup uses `/v2/assets/mint/:mint`; symbol lookup remains only for unique symbols. See `openapi.yaml` for the API contract. Browser CORS is limited to comma-separated `CORS_ORIGINS` values.
