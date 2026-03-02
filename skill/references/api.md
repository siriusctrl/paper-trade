# API Reference

Base URL: `http://<host>:3100/api`

All responses include an `X-API-Version` header with the current server version.

All endpoints except `/api/auth/register` and `/health` require:
```
Authorization: Bearer <api_key>
```

All write operations require a `reasoning` field (string, non-empty).

## Auth

### Register
```
POST /api/auth/register
Content-Type: application/json

{ "name": "my-agent" }

→ 201
{
  "userId": "usr_xxxx",
  "apiKey": "pt_live_xxxxxxxxxxxx",
  "account": {
    "id": "acc_xxxx",
    "balance": 100000,
    "createdAt": "2026-03-01T00:00:00Z"
  }
}
```

The API key is only shown once at creation time. Store it securely.

### Generate New Key
```
POST /api/auth/keys

→ 201
{
  "id": "key_xxxx",
  "apiKey": "pt_live_yyyyyyyyyyyy",
  "prefix": "pt_live_yy****"
}
```

### Revoke Key
```
DELETE /api/auth/keys/:id

→ 200
{ "revoked": true }
```

## Accounts

### Create Account
```
POST /api/accounts
Content-Type: application/json

{
  "name": "strategy-alpha",
  "reasoning": "Dedicated account for mean-reversion strategy on election markets"
}

→ 201
{
  "id": "acc_xxxx",
  "name": "strategy-alpha",
  "balance": 100000,
  "createdAt": "2026-03-01T00:00:00Z"
}
```

Each user has exactly one account (enforced by unique constraint).

### Get Account
```
GET /api/accounts/:id

→ 200
{
  "id": "acc_xxxx",
  "name": "strategy-alpha",
  "balance": 97500.50,
  "createdAt": "2026-03-01T00:00:00Z"
}
```

### Get Portfolio
```
GET /api/accounts/:id/portfolio

→ 200
{
  "accountId": "acc_xxxx",
  "balance": 97500.50,
  "positions": [
    {
      "market": "polymarket",
      "symbol": "0x1234...abcd",
      "symbolName": "Will Trump win 2028?",
      "quantity": 100,
      "avgCost": 0.42,
      "currentPrice": 0.48,
      "unrealizedPnl": 6.00,
      "marketValue": 48.00
    }
  ],
  "totalValue": 97548.50,
  "totalPnl": -2451.50
}
```

### Get Timeline
```
GET /api/accounts/:id/timeline?limit=20&offset=0

→ 200
{
  "events": [
    {
      "type": "order",
      "data": {
        "id": "ord_xxxx",
        "side": "buy",
        "symbol": "0x1234...abcd",
        "quantity": 100,
        "filledPrice": 0.42,
        "status": "filled"
      },
      "reasoning": "Market overpricing NO at 0.58, polling suggests YES ~55%",
      "createdAt": "2026-03-01T12:00:01Z"
    },
    {
      "type": "journal",
      "data": {
        "id": "jrn_xxxx",
        "content": "Debate tonight — expecting volatility, will hold current positions",
        "tags": ["election", "risk-management"]
      },
      "createdAt": "2026-03-01T11:30:00Z"
    },
    {
      "type": "order_cancelled",
      "data": {
        "id": "ord_yyyy",
        "symbol": "0x5678...efgh",
        "side": "buy"
      },
      "reasoning": "New information invalidated the thesis — withdrawing limit order",
      "createdAt": "2026-03-01T10:00:00Z"
    }
  ]
}
```

## Orders

### Place Order
```
POST /api/orders
Content-Type: application/json

{
  "accountId": "acc_xxxx",
  "market": "polymarket",
  "symbol": "0x1234...abcd",
  "side": "buy",
  "type": "market",
  "quantity": 100,
  "reasoning": "Market overpricing NO at 0.58, recent polling data suggests YES probability ~55%"
}

→ 201
{
  "id": "ord_xxxx",
  "accountId": "acc_xxxx",
  "market": "polymarket",
  "symbol": "0x1234...abcd",
  "side": "buy",
  "type": "market",
  "quantity": 100,
  "status": "filled",
  "filledPrice": 0.42,
  "reasoning": "Market overpricing NO at 0.58, recent polling data suggests YES probability ~55%",
  "filledAt": "2026-03-01T00:00:01Z"
}
```

For limit orders, add `"limitPrice": 0.40`. Status will be `"pending"` until filled or cancelled.

### List Orders
```
GET /api/orders?accountId=acc_xxxx&status=filled&market=polymarket

→ 200
{ "orders": [...] }
```

Query params (all optional): `accountId`, `status` (pending|filled|cancelled), `market`, `symbol`, `limit`, `offset`.

### Cancel Order
```
DELETE /api/orders/:id
Content-Type: application/json

{ "reasoning": "New information invalidated the thesis" }

→ 200
{ "id": "ord_xxxx", "status": "cancelled" }
```

Only pending orders can be cancelled.

## Positions

### List Positions
```
GET /api/positions?accountId=acc_xxxx

→ 200
{ "positions": [...] }
```

## Journal

### Write Entry
```
POST /api/journal
Content-Type: application/json

{
  "content": "Noticed correlation between polling shifts and election market price movement. Will monitor for entry opportunity below 0.40.",
  "tags": ["analysis", "election"]
}

→ 201
{
  "id": "jrn_xxxx",
  "userId": "usr_xxxx",
  "content": "...",
  "tags": ["analysis", "election"],
  "createdAt": "2026-03-01T12:00:00Z"
}
```

`content` is required. `tags` is optional.

### List Entries
```
GET /api/journal?limit=5&offset=0
GET /api/journal?q=election
GET /api/journal?tags=risk-management

→ 200
{ "entries": [...] }
```

Default `limit=5`. Supports `offset` for pagination, `q` for full-text search, `tags` for filtering.

## Market Data

All market data endpoints use query params.

### List Markets
```
GET /api/markets

→ 200
{
  "markets": [
    {
      "id": "polymarket",
      "name": "Polymarket",
      "description": "Prediction markets — contracts resolve to $0 or $1",
      "symbolFormat": "Condition ID (hex string)",
      "priceRange": [0.01, 0.99],
      "capabilities": ["search", "quote", "orderbook", "resolve"]
    }
  ]
}
```

### Search Assets
```
GET /api/markets/polymarket/search?q=trump+election

→ 200
{
  "results": [
    {
      "symbol": "0x1234...abcd",
      "name": "Will Trump win the 2028 presidential election?",
      "price": 0.42,
      "volume": 1500000
    }
  ]
}
```

### Get Quote
```
GET /api/markets/polymarket/quote?symbol=0x1234...abcd

→ 200
{
  "symbol": "0x1234...abcd",
  "price": 0.42,
  "bid": 0.41,
  "ask": 0.43,
  "volume": 1500000,
  "timestamp": "2026-03-01T00:00:00Z"
}
```

### Get Orderbook
```
GET /api/markets/polymarket/orderbook?symbol=0x1234...abcd

→ 200
{
  "bids": [{ "price": 0.41, "size": 5000 }, ...],
  "asks": [{ "price": 0.43, "size": 3000 }, ...]
}
```

### Check Resolution
```
GET /api/markets/polymarket/resolve?symbol=0x1234...abcd

→ 200
{ "symbol": "0x1234...abcd", "resolved": false, "outcome": null }

// or when resolved:
{ "symbol": "0x1234...abcd", "resolved": true, "outcome": "yes", "settlementPrice": 1.00 }
```

## Admin Endpoints

Require admin key in `Authorization: Bearer <admin_key>` header.

### Deposit
```
POST /api/admin/accounts/:id/deposit
Content-Type: application/json

{ "amount": 50000 }

→ 200
{ "balance": 147500.50 }
```

### Withdraw
```
POST /api/admin/accounts/:id/withdraw
Content-Type: application/json

{ "amount": 10000 }

→ 200
{ "balance": 137500.50 }
```

## Health
```
GET /health

→ 200
{ "status": "ok", "markets": { "polymarket": "open" } }
```

## Events (SSE)

### Subscribe to Events
```
GET /api/events
Authorization: Bearer <api_key>

→ 200 (text/event-stream)

data: {"type":"system.ready","data":{"version":"2.0.0","connectedAt":"2026-03-02T12:00:00.000Z"}}

data: {"type":"order.filled","userId":"usr_xxx","accountId":"acc_xxx","orderId":"ord_xxx","data":{...}}

data: {"type":"order.cancelled","userId":"usr_xxx","accountId":"acc_xxx","orderId":"ord_xxx","data":{...}}

data: {"type":"position.settled","userId":"usr_xxx","accountId":"acc_xxx","data":{...}}
```

Connection stays open. Events are pushed as they happen. The first event is always `system.ready`. User tokens receive only their own trading events. Admin tokens receive all trading events.

Event types:
- `system.ready` — emitted on connect with server version and connection timestamp
- `order.filled` — order was executed (market order or limit order hit)
- `order.cancelled` — order was cancelled by user
- `position.settled` — position was settled after market resolution
