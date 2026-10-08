# Iris API

Cloudflare Worker API for cached Solana market data and on-demand public-wallet lookups. It is native JavaScript and uses Cloudflare KV only; it does not use Express, D1, or R2.

## System Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the detailed frontend-to-Worker organigram, route mapping, provider boundaries, caches, refresh sequence, and failure behavior.

## Local development

1. Run `npm install`.
2. Copy `.dev.vars.example` to `.dev.vars` and set only local values. Do not commit `.dev.vars`.
3. Create the KV namespaces and replace the placeholder namespace IDs in `wrangler.toml` before deploying.
4. Set `HELIUS_API_KEY`, `JUPITER_API_KEY`, and `BIRDEYE_API_KEY` for live data and on-demand USD OHLCV candles. Never commit secrets or private wallet information.
5. Run `npm run dev` or `npm test`.

Any valid public Solana address can be looked up; Iris never requests wallet signing or private keys.

## Vertical testing

`npm run seed:e2e` writes fresh deterministic records to local Wrangler KV at `.wrangler/e2e`. `npm run e2e:serve` seeds that store and starts the Worker on `127.0.0.1:8787` using the `e2e` environment. That environment sets `PROVIDER_MODE=cache-only`, so it reads seeded KV data and cannot call market or chain providers.

The frontend repository's `npm run test:vertical` uses this command to verify browser-to-Worker journeys. The CI policy pairs matching branch names across the repositories and fails closed if the other repository does not provide that branch. Local E2E data is never written to a remote KV namespace.

## Deployment

Pushes to `main` deploy to Cloudflare after CI passes when the repository has a `CLOUDFLARE_API_TOKEN` GitHub Actions secret; the workflow explicitly reports a skipped deployment when that secret is absent. Set `HELIUS_API_KEY`, `JUPITER_API_KEY`, and `BIRDEYE_API_KEY` as Worker secrets. The deploy job invokes the protected `/internal/refresh` endpoint using the `IRIS_REFRESH_TOKEN` GitHub secret, which must match the Worker `REFRESH_TOKEN` secret.

## Market data

Jupiter supplies token metadata, current prices, provider-reported market cap and supply, liquidity, and 24-hour activity. Birdeye supplies on-demand USD token-market OHLCV candles. The Worker supports Birdeye's exact native `1s`, `15s`, `30s`, `1m`, `3m`, `5m`, `15m`, `30m`, `1H`, `2H`, `4H`, `6H`, `8H`, `12H`, `1D`, `3D`, `1W`, and `1M` durations. Candles are cached for 30 minutes and may be served stale for 24 hours; unavailable data remains null rather than fabricated.

`GET /v3/assets/mint/:mint/candles?timeframe=<native-Birdeye-type>` returns one validated 300-candle USD OHLCV page. Its optional `before=<unix-seconds>` query loads the preceding page for backward chart pagination. `GET /v3/assets/mint/:mint/history?range=1d|7d` remains a compatibility route and projects each candle's USD close to `{ timestamp, priceUsd }`. The asset route accepts `includeHistory=false` to avoid loading compatibility history with its metadata.

Birdeye token candles are provider-defined market aggregation and are not a selected Raydium pool. The browser never calls Birdeye directly or receives the API key.

## Snapshot behavior

The production Cron runs at the start of every hour. Each run refreshes the complete Jupiter/Helius snapshot, the Helius dashboard cache, and a separate DefiLlama dashboard cache. A complete versioned snapshot is written to KV before its pointer is published, so readers never receive a partial refresh.

## API versions

`/v3` is the canonical contract. It exposes Jupiter asset fields, Birdeye candles, compatibility history points, reviewed-pool swaps, and DAS wallet balances. `/v2` and `/v1` remain supported but deprecated compatibility surfaces. The `/v3/wallets/:address/events` route is also deprecated; use `/v3/wallets/:address/transactions` instead.

Responses are JSON envelopes with `meta.requestId`; errors use `error.code`. Snapshot-backed routes include freshness metadata and use public cache-control headers; on-demand wallet and on-chain routes use `Cache-Control: no-store`. See `openapi.yaml` for the complete API contract. The Worker package version, runtime API version, and OpenAPI version are validated together in CI.
