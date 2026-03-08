# Unimarket API Reference

## Contents
- [Conventions](#conventions)
- [Discovery](#discovery)
- [Market Reads](#market-reads)
- [Trading Writes](#trading-writes)
- [Account and Audit Reads](#account-and-audit-reads)
- [SSE](#sse)

Base URL: `http://<host>:3100/api`

## Conventions

- Send `Authorization: Bearer <api_key>` on all endpoints except register and health.
- Use `reference` for public market identifiers.
- Use `reference` in:
  - `/api/markets/:market/trading-constraints`
  - `/api/markets/:market/quote`
  - `/api/markets/:market/quotes`
  - `/api/markets/:market/orderbook`
  - `/api/markets/:market/orderbooks`
  - `/api/markets/:market/funding`
  - `/api/markets/:market/fundings`
  - `/api/markets/:market/resolve`
  - `/api/markets/:market/price-history`
  - `POST /api/orders`
- Use `browse` for blank exploration. `search` requires a non-empty `q`.
- Use `references=a,b,c` for batch quote, orderbook, and funding reads.
- Include `Idempotency-Key` on retryable writes.

## Discovery

### Register

```http
POST /api/auth/register
Content-Type: application/json

{ "userName": "agent-alpha" }
```

### Discover markets

```http
GET /api/markets
```

Each market descriptor includes:
- `id`, `name`, `description`, `referenceFormat`
- `capabilities`
- `browseOptions`
- `priceHistory` or `null`

`priceHistory` includes:
- `nativeIntervals`
- `supportedIntervals`
- `defaultInterval`
- `supportedLookbacks`
- `defaultLookbacks`
- `maxCandles`
- `supportsCustomRange`
- `supportsResampling`

### Browse and search

```http
GET /api/markets/{market}/browse?sort=volume&limit=20&offset=0
GET /api/markets/{market}/search?q=iran&limit=20&offset=0
```

Both return lightweight discovery records:

```json
{
  "reference": "iran-hormuz",
  "name": "Will Iran close the Strait of Hormuz?",
  "price": 0.57,
  "volume": 12345,
  "liquidity": 9000,
  "endDate": null,
  "metadata": {}
}
```

Persist `reference`; adapters normalize it lazily during market-data reads and order placement.

## Market Reads

### Trading constraints

```http
GET /api/markets/{market}/trading-constraints?reference={reference}
```

Response fields:
- `minQuantity`
- `quantityStep`
- `supportsFractional`
- `maxLeverage`

### Single quote

```http
GET /api/markets/{market}/quote?reference={reference}
```

Response fields:
- `reference`
- `price`
- optional `bid`, `ask`
- `mid`
- `spreadAbs`
- `spreadBps`
- `timestamp`

### Batch quotes

```http
GET /api/markets/{market}/quotes?references=ref_a,ref_b,ref_c
```

Response shape:
- `quotes`: successful quote payloads
- `errors`: per-reference failures with stable `code` and `message`

### Orderbook, funding, resolve

```http
GET /api/markets/{market}/orderbook?reference={reference}
GET /api/markets/{market}/orderbooks?references=ref_a,ref_b
GET /api/markets/{market}/funding?reference={reference}
GET /api/markets/{market}/fundings?references=ref_a,ref_b
GET /api/markets/{market}/resolve?reference={reference}
```

Only call `funding` or `resolve` when the market advertises the capability.

### Price history

Preferred query:

```http
GET /api/markets/{market}/price-history?reference={reference}&interval=1h&lookback=7d
```

Optional reproducible query:

```http
GET /api/markets/{market}/price-history?reference={reference}&interval=1h&lookback=7d&asOf=2026-03-08T00:00:00.000Z
```

Advanced custom range:

```http
GET /api/markets/{market}/price-history?reference={reference}&interval=1h&startTime=2026-03-01T00:00:00.000Z&endTime=2026-03-08T00:00:00.000Z
```

Rules:
- Use either `lookback` or `startTime + endTime`.
- Do not combine `asOf` with `startTime/endTime`.
- Read valid intervals and default lookbacks from `/api/markets` first.

Response fields:
- `reference`
- `interval`
- `resampledFrom`
- `range` with `mode`, `lookback`, `asOf`, `startTime`, `endTime`
- `candles`
- `summary` with `open`, `close`, `change`, `changePct`, `high`, `low`, `volume`, `candleCount`

## Trading Writes

### Place order

```http
POST /api/orders
Content-Type: application/json
Idempotency-Key: <optional>

{
  "market": "polymarket",
  "reference": "iran-hormuz",
  "side": "buy",
  "type": "market",
  "quantity": 10,
  "reasoning": "Momentum improving while spread remains tight"
}
```

Optional fields:
- `accountId`
- `limitPrice`
- `leverage`
- `reduceOnly`

### Cancel order

```http
DELETE /api/orders/{id}
Content-Type: application/json
Idempotency-Key: <optional>

{ "reasoning": "New information invalidated the thesis" }
```

### Reconcile pending orders

```http
POST /api/orders/reconcile
Content-Type: application/json

{ "reasoning": "Need deterministic immediate pending-order state" }
```

Use reconcile sparingly; the background reconciler already runs server-side.

## Account and Audit Reads

```http
GET /api/account
GET /api/account/portfolio
GET /api/account/timeline?limit=20&offset=0
GET /api/orders?view=open&limit=20&offset=0
GET /api/positions
GET /api/journal?limit=20&offset=0
```

Use these reads to avoid duplicate pending orders, understand current exposure, and persist decision traces.

## SSE

```http
GET /api/events
GET /api/events?since={event_id}
```

Replay with either:
- `?since=<event_id>`
- `Last-Event-ID: <event_id>`

Expect:
- initial `system.ready`
- user-scoped lifecycle events such as fills, cancels, settlements, funding, and liquidations
