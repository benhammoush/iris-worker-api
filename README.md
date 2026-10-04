# Iris API

Cloudflare Worker API for cached Stacks market data and three public demonstration wallets. It is native JavaScript and uses Cloudflare KV only; it does not use Express, D1, or R2.

## Local development

1. Run `npm install`.
2. Copy `.dev.vars.example` to `.dev.vars` and set only local values. Do not commit `.dev.vars`.
3. Create the KV namespaces and replace the placeholder namespace IDs in `wrangler.toml` before deploying.
4. Set `COINGECKO_DEMO_API_KEY` in `.dev.vars` for local live-market refreshes. Set it as a Worker secret for staging and production; never commit it.
4. Run `npm run dev` or `npm test`.

Wallets are fixed public third-party addresses. No wallet API credentials or wallet environment variables are required.

| Label | Address | Description |
| --- | --- | --- |
| Demo A | `SP3MXB0HQH72ZGBTD6QWNRK9WNK1ZMMAXF6ANB2E8` | STX activity |
| Demo B | `SP34SVHFFP532M35DHWTQJKJJR2DRGS7T5XEXQ0M0` | Diversified assets |
| Demo C | `SPG9HQ3A54KNP4V2HPJ20VBSFEE7W09ZBFJF2RNH` | Recent STX activity |

## Snapshot behavior

The production Cron runs every 15 minutes. Refresh fetches only Hiro fees, latest chain info, STX supply, and each public wallet's balances and up to 25 transactions with transfers from public Hiro endpoints. It never fetches market data from ALEX or token metadata at runtime, and never fetches NFT metadata. A complete versioned snapshot is written to KV before its pointer is published, so readers never receive a partial refresh.

With `COINGECKO_DEMO_API_KEY` configured, STX, ALEX, WELSH, LEO, and aBTC use CoinGecko historical market data and the most liquid matching Stacks DEX Screener pair for current price/liquidity. Other bundled assets remain snapshot-backed. Without the secret, all market assets use the bundled demonstration snapshot in `src/fixtures.js`. Response metadata includes `marketDataSource` and `marketDataAsOf`, while `snapshotState` describes only the freshness of the live-refresh snapshot.

Responses are JSON envelopes with `meta.requestId`; errors use `error.code`. Snapshot responses include `X-Snapshot-State` and are `Cache-Control: no-store`. The resolver serves fresh data for up to 30 minutes, stale data for more than 30 minutes through 24 hours, then the bundled fixture snapshot.

## Endpoints

`GET /health`, `GET /ready`, `GET /v1/status`, `GET /v1/market`, `GET /v1/assets`, `GET /v1/assets/:symbol`, `GET /v1/swaps`, `GET /v1/wallets`, and `GET /v1/wallets/:address`.

`/v1/wallets` returns public wallet metadata only. `/v1/wallets/:address` requires an exact configured address and returns its cached balances, portfolio total, and normalized recent transaction summary. See `openapi.yaml` for the minimal API contract. Browser CORS is limited to comma-separated `CORS_ORIGINS` values.
