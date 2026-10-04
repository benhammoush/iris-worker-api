# Iris API

Cloudflare Worker API for cached Stacks market data and three public demonstration wallets. It is native JavaScript and uses Cloudflare KV only; it does not use Express, D1, or R2.

## Local development

1. Run `npm install`.
2. Copy `.dev.vars.example` to `.dev.vars` and set only local values. Do not commit `.dev.vars`.
3. Create the KV namespaces and replace the placeholder namespace IDs in `wrangler.toml` before deploying.
4. Set `COINGECKO_DEMO_API_KEY` in `.dev.vars` for local live-market refreshes. Set it as a Worker secret for staging and production; never commit it.
4. Run `npm run dev` or `npm test`.

Wallets are fixed public third-party addresses. No wallet API credentials or wallet environment variables are required.

## Deployment

Pushes to `main` automatically deploy to Cloudflare after CI passes when the repository has a `CLOUDFLARE_API_TOKEN` GitHub Actions secret. Create a least-privilege Cloudflare token that can deploy Workers for the account hosting `iris-api`; its value is never stored in this repository. Set the same high-entropy `IRIS_REFRESH_TOKEN` GitHub secret as the Worker `REFRESH_TOKEN` secret to invoke the protected `/internal/refresh` endpoint immediately after deployment. The refresh publishes available sections and reports unavailable providers instead of failing when an optional upstream source is unavailable. Until the required secrets are configured, deployment or immediate refresh is skipped while validation continues.

| Label | Address | Description |
| --- | --- | --- |
| Demo A | `SP3MXB0HQH72ZGBTD6QWNRK9WNK1ZMMAXF6ANB2E8` | STX activity |
| Demo B | `SP34SVHFFP532M35DHWTQJKJJR2DRGS7T5XEXQ0M0` | Diversified assets |
| Demo C | `SPG9HQ3A54KNP4V2HPJ20VBSFEE7W09ZBFJF2RNH` | Recent STX activity |

## Snapshot behavior

The production Cron runs every 15 minutes. Refresh fetches Hiro fees, latest chain info, STX supply, each public wallet's balances, up to 100 transactions with transfers, and metadata for wallet-discovered fungible tokens. A complete versioned snapshot is written to KV before its pointer is published, so readers never receive a partial refresh.

With `COINGECKO_DEMO_API_KEY` configured, Iris reads valid Hiro fungible-token metadata and includes only tokens with a verified CoinGecko or DexScreener market. CoinGecko supplies historical changes; DexScreener supplies current price/liquidity and 24-hour change when a liquid Stacks pair exists. A 7-day change is only supplied from a verified historical source. Missing values are `null`, never a fabricated zero. The bundled data in `src/fixtures.js` is an explicitly labeled outage fallback, not live pricing.

Responses are JSON envelopes with `meta.requestId`; errors use `error.code`. Snapshot responses include `snapshotCreatedAt`, `refreshIntervalMinutes`, and `nextScheduledRefreshAt` (the next UTC cron boundary), plus `X-Snapshot-State`, and are `Cache-Control: no-store`. The resolver serves fresh data for up to 30 minutes, stale data for more than 30 minutes through 24 hours, then the bundled fixture snapshot.

## Endpoints

`GET /health`, `GET /ready`, `GET /v1/status`, `GET /v1/market`, `GET /v1/assets`, `GET /v1/assets/:symbol`, `GET /v1/swaps`, `GET /v1/wallets`, and `GET /v1/wallets/:address`.

`/v1/wallets` returns public wallet metadata only. `/v1/wallets/:address` requires an exact configured address and returns cached balances, `totalValue`, and grouped `activity` records; `portfolioTotal` and `transactions` remain compatibility aliases. `/v1/swaps` reads a bounded current chain-wide Hiro transaction page and retains successful contract/function/event combinations in the DEX registry. `/v1/status` reports the most recent swap scan count and specific upstream error category. Asset detail lookup uses `/v1/assets/id/:contractId`; symbol lookup remains only for unique legacy symbols. Swap records are neutral transaction metadata unless asset input/output can be proven. See `openapi.yaml` for the API contract. Browser CORS is limited to comma-separated `CORS_ORIGINS` values.
