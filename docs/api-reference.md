# API Reference

This reference lists the current HTTP and SSE surfaces. For system behavior and accounting semantics, read [Trading Model](trading-model.md). For operator workflows, read [Admin Guide](admin-guide.md).

## Auth

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/register` | — | Register a user with `{ "userName": "..." }`, create the default account, and return the first API key |
| `POST` | `/api/auth/keys` | key | Create an additional API key for the current user |
| `DELETE` | `/api/auth/keys/:id` | key | Revoke an API key |

## Accounts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/account` | key | Get the current user's default account |
| `GET` | `/api/account/portfolio` | key | Get balances, open positions, open orders, unrealized PnL, funding totals, and perp risk fields |
| `GET` | `/api/account/timeline` | key | Get the user's unified audit feed |

### `GET /api/account/timeline`

Query params:
- `limit`, default pagination behavior from shared schema
- `offset`

Current timeline event types:
- `order`
- `order.cancelled`
- `journal`
- `funding.applied`
- `position.liquidated`

Notes:
- liquidation timeline entries are sourced from the dedicated `liquidations` audit table
- the backing filled liquidation order is hidden from timeline results to avoid duplicate entries
- Polymarket timeline items try to resolve human-readable market names and outcomes
- the timeline record shape is shared with the dashboard through `@unimarket/core`

## Trading

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/orders` | key | Place an order |
| `GET` | `/api/orders` | key | List orders (`view=open|history|all`) |
| `GET` | `/api/orders/:id` | key | Fetch a single order |
| `DELETE` | `/api/orders/:id` | key | Cancel a pending order |

### Order payload notes

Required fields:
- `market`
- `reference`
- `side`
- `type`
- `quantity`
- `reasoning`

Optional fields:
- `limitPrice`
- `leverage`
- `reduceOnly`

Rules:
- `reasoning` is required for state-changing writes
- `leverage` and `reduceOnly` are valid only for perp markets
- quantity is validated against per-reference trading constraints
- normal market-order execution uses directional executable prices: `buy -> ask`, `sell -> bid`
- limit orders remain `pending` until the background reconciler fills or cancels them

## Positions

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/positions` | key | List open positions |

## Journal

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/journal` | key | Create a journal entry |
| `GET` | `/api/journal` | key | List journal entries (`limit`, `offset`, optional filters) |

## Market Data

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/markets` | key or admin | Discover registered markets, capabilities, browse options, and price-history defaults |
| `GET` | `/api/markets/:market/search` | key or admin | Search market references |
| `GET` | `/api/markets/:market/browse` | key or admin | Browse active market references |
| `GET` | `/api/markets/:market/trading-constraints` | key or admin | Get reference-level quantity and leverage constraints |
| `GET` | `/api/markets/:market/quote` | key or admin | Get one enriched quote |
| `GET` | `/api/markets/:market/quotes` | key or admin | Get enriched quotes in batch |
| `GET` | `/api/markets/:market/orderbook` | key or admin | Get one orderbook |
| `GET` | `/api/markets/:market/orderbooks` | key or admin | Get orderbooks in batch |
| `GET` | `/api/markets/:market/funding` | key or admin | Get one funding rate for funding-capable markets |
| `GET` | `/api/markets/:market/fundings` | key or admin | Get funding rates in batch |
| `GET` | `/api/markets/:market/price-history` | key or admin | Get historical candles, resolved range, and summary metrics |
| `GET` | `/api/markets/:market/resolve` | key or admin | Get settlement or resolution status |

### Search and browse contract

- `search` requires a non-empty `q`
- `browse` is explicit and accepts a market-specific `sort` string
- browse options are discoverable from `GET /api/markets`
- both endpoints return lightweight discovery records shaped like:

```json
{
  "reference": "btc",
  "name": "BTC-PERP",
  "price": 94321.1,
  "volume": 12003455.2,
  "liquidity": 882100.4,
  "endDate": null,
  "metadata": {}
}
```

- discovery results are not required to be execution-ready exchange ids
- adapters normalize the supplied `reference` lazily when `quote`, `orderbook`, `resolve`, `price-history`, or order placement is called

### Market descriptor notes

`GET /api/markets` returns per-market discovery metadata, including:
- `capabilities`
- `browseOptions`
- `priceHistory` or `null`

When present, `priceHistory` includes:
- `nativeIntervals`
- `supportedIntervals`
- `defaultInterval`
- `supportedLookbacks`
- `defaultLookbacks`
- `maxCandles`
- `supportsCustomRange`
- `supportsResampling`

### Trading constraints response

Example:

```json
{
  "reference": "BTC",
  "constraints": {
    "minQuantity": 0.00001,
    "quantityStep": 0.00001,
    "supportsFractional": true,
    "maxLeverage": 50
  }
}
```

Fallback behavior when a market does not implement custom constraints:
- `minQuantity = 1`
- `quantityStep = 1`
- `supportsFractional = false`
- `maxLeverage = null`

### Quote response

Example:

```json
{
  "reference": "BTC",
  "price": 94321.1,
  "bid": 94320.9,
  "ask": 94321.3,
  "mid": 94321.1,
  "spreadAbs": 0.4,
  "spreadBps": 0.042408309301,
  "timestamp": "2026-03-08T00:00:00.000Z"
}
```

Notes:
- `price` is the execution-facing reference price
- `mid` falls back to `price` when either side is missing
- `spreadAbs` and `spreadBps` are `null` when both sides are not available

### Price history response

Preferred query:

```http
GET /api/markets/:market/price-history?reference=BTC&interval=1h&lookback=7d
```

Advanced custom range:

```http
GET /api/markets/:market/price-history?reference=BTC&interval=1h&startTime=2026-03-01T00:00:00.000Z&endTime=2026-03-08T00:00:00.000Z
```

Rules:
- use `lookback` for the common case
- use `asOf` only to anchor reproducible historical analysis
- use either `lookback` or `startTime + endTime`
- read supported intervals and defaults from `GET /api/markets` before requesting candles

Example response shape:

```json
{
  "reference": "iran-hormuz",
  "interval": "4h",
  "resampledFrom": "1h",
  "range": {
    "mode": "lookback",
    "lookback": "30d",
    "asOf": "2026-03-08T00:00:00.000Z",
    "startTime": "2026-02-06T00:00:00.000Z",
    "endTime": "2026-03-08T00:00:00.000Z"
  },
  "candles": [],
  "summary": {
    "open": null,
    "close": null,
    "change": null,
    "changePct": null,
    "high": null,
    "low": null,
    "volume": null,
    "candleCount": 0
  }
}
```

## Real-Time Events

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/events` | key | Subscribe to the user's SSE event stream |

The SSE stream starts with:
- `system.ready`

Current user-scoped event types:
- `order.filled`
- `order.cancelled`
- `position.settled`
- `funding.applied`
- `position.liquidated`

Replay is supported through:
- `Last-Event-ID`
- `?since=<event_id>`

### `position.liquidated` event data

The structured liquidation event includes:
- `liquidationId`
- `market`
- `symbol`
- `side`
- `quantity`
- `triggerPrice`
- `executionPrice`
- `triggerPositionEquity`
- `maintenanceMargin`
- `grossPayout`
- `feeCharged`
- `netPayout`
- `cancelledReduceOnlyOrderIds`
- `liquidatedAt`

Note:
- timeline and settlement/liquidation audit surfaces still expose internal normalized `symbol` fields because accounting is stored against resolved execution identifiers

## Admin API

The full operator workflow is documented in [Admin Guide](admin-guide.md). The main admin-only endpoints are:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/users/:id/deposit` | Add funds to a user's default account |
| `POST` | `/api/admin/users/:id/withdraw` | Remove funds from a user's default account |
| `POST` | `/api/admin/traders` | Create a dedicated trader user + default account |
| `GET` | `/api/admin/overview` | Get cross-user portfolio and market summary |
| `GET` | `/api/admin/users/:id/portfolio` | Get one user's current balance, positions, open orders, and recent orders |
| `GET` | `/api/admin/users/:id/timeline` | Get one user's unified audit feed |
| `POST` | `/api/admin/users/:id/orders` | Place an order on behalf of a user |
| `GET` | `/api/admin/equity-history` | Get historical equity snapshots by user |

All admin endpoints require `Authorization: Bearer <ADMIN_API_KEY>`.

Admin read-model notes:
- `GET /api/admin/overview` is read-only and does not write equity snapshots as a side effect
- `GET /api/admin/equity-history` is backed by the background equity snapshotter worker

Admin order-placement notes:
- `POST /api/admin/users/:id/orders` accepts the same payload shape as `POST /api/orders`
- optional `accountId` must match the target user's default account
- `Idempotency-Key` replay protection is supported for retry-safe admin writes

## Meta

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | — | Health check including API version |

## Runtime Configuration

The API loads environment variables from repo root in this order:
- `.env.local`
- `.env`

Existing process environment variables keep highest priority.

Relevant runtime settings:
- `RECONCILE_INTERVAL_MS`
- `SETTLE_INTERVAL_MS`
- `FUNDING_INTERVAL_MS`
- `LIQUIDATION_INTERVAL_MS`
- `EQUITY_SNAPSHOT_INTERVAL_MS`
- `MAINTENANCE_MARGIN_RATIO`
- `DEFAULT_TAKER_FEE_RATE`
- `${MARKET}_TAKER_FEE_RATE`
- `SERVE_WEB_DIST`
