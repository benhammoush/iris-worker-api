# Iris API

Cloudflare Worker API for cached Solana market data and on-demand public-wallet lookups. It is native JavaScript and uses Cloudflare KV only; it does not use Express, D1, or R2.

## System Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the detailed frontend-to-Worker organigram, route mapping, provider boundaries, caches, refresh sequence, and failure behavior.

## Local development

1. Run `npm ci`.
2. Copy `.dev.vars.example` to `.dev.vars` and set only local values. Do not commit `.dev.vars`.
3. Local KV requires no remote namespace. `npm run dev` uses `--local --env local`, port 8787, and isolated `.wrangler/local` persistence.
4. Set `HELIUS_API_KEY`, `JUPITER_API_KEY`, and `BIRDEYE_API_KEY` for live data and on-demand USD OHLCV candles. Never commit secrets or private wallet information.
5. Run `npm run dev` or `npm test`.

Any valid public Solana address can be looked up; Iris never requests wallet signing or private keys.

## Vertical testing

`npm run seed:e2e` writes fresh deterministic records to local Wrangler KV at `.wrangler/e2e`. `npm run e2e:serve` seeds that store and starts the Worker on `127.0.0.1:8787` using the `e2e` environment. That environment sets `PROVIDER_MODE=cache-only`, so it reads seeded KV data and cannot call market or chain providers.

The frontend repository's `npm run test:vertical` uses this command to verify browser-to-Worker journeys. Frontend CI pins an explicit compatible Worker SHA. Local E2E data is never written to a remote KV namespace.

## Deployment

Pushes to `main` deploy dev after existing CI passes. For staging/production, manually run CI from `main`, select the environment and exact merged commit SHA, and approve production through its protected GitHub environment. See the frontend [environment setup runbook](https://github.com/benhammoush/iris-dashboard/blob/main/ENVIRONMENTS.md). The repositories deploy independently; keep API changes backward-compatible and deploy the Worker first when both change.

Dev's existing isolated namespace and assigned frontend origin are configured in local `wrangler.toml`; the dev Worker has not yet been deployed. Before enabling deployment, verify actual Worker bindings, configure remote secrets/API origins, and verify staging/production isolation. Local/E2E placeholders stay local. Configure provider keys and `REFRESH_TOKEN` separately as remote Worker secrets; environment-scoped `IRIS_REFRESH_TOKEN` must match `REFRESH_TOKEN`. Set `DEPLOY_ENABLED=true` only after setup. Dev refresh is explicitly requested with `refresh_dev`; staging/production refresh on release and retain hourly Cron.

## Market data

Jupiter supplies token metadata, current prices, provider-reported market cap and supply, liquidity, and 24-hour activity. Birdeye supplies on-demand USD token-market OHLCV candles. The Worker supports Birdeye's exact native `1s`, `15s`, `30s`, `1m`, `3m`, `5m`, `15m`, `30m`, `1H`, `2H`, `4H`, `6H`, `8H`, `12H`, `1D`, `3D`, `1W`, and `1M` durations. Candles are cached for 30 minutes and may be served stale for 24 hours; unavailable data remains null rather than fabricated.

`GET /v3/assets/mint/:mint/candles?timeframe=<native-Birdeye-type>` returns one validated 300-candle USD OHLCV page. Its optional `before=<unix-seconds>` query loads the preceding page for backward chart pagination. `GET /v3/assets/mint/:mint/history?range=1d|7d` remains a compatibility route and projects each candle's USD close to `{ timestamp, priceUsd }`. The asset route accepts `includeHistory=false` to avoid loading compatibility history with its metadata.

Birdeye token candles are provider-defined market aggregation and are not a selected Raydium pool. The browser never calls Birdeye directly or receives the API key.

## Snapshot behavior

The production Cron runs at the start of every hour. Each run refreshes the complete Jupiter/Helius snapshot, the Helius dashboard cache, and a separate DefiLlama dashboard cache. A complete versioned snapshot is written to KV before its pointer is published, so readers never receive a partial refresh.

## API versions

`/v3` is the canonical contract. It exposes Jupiter asset fields, Birdeye candles, compatibility history points, reviewed-pool swaps, and DAS wallet balances. `/v2` and `/v1` remain supported but deprecated compatibility surfaces. The `/v3/wallets/:address/events` route is also deprecated; use `/v3/wallets/:address/transactions` instead.

Responses are JSON envelopes with `meta.requestId`; errors use `error.code`. Snapshot-backed routes include freshness metadata and use public cache-control headers; on-demand wallet and on-chain routes use `Cache-Control: no-store`. See `openapi.yaml` for the complete API contract. The Worker package version, runtime API version, and OpenAPI version are validated together in CI.
