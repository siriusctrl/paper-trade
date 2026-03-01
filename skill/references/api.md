# API Reference

Base URL: `http://<host>:3100/api`

Auto-generated OpenAPI 3.1 spec available at `/openapi.json`.

## Accounts

### Create Account
```
POST /accounts
Content-Type: application/json

{ "name": "my-agent" }

→ 201
{
  "id": "acc_xxxx",
  "name": "my-agent",
  "balance": 100000,
  "createdAt": "2026-03-01T00:00:00Z"
}
```

### Get Account
```
GET /accounts/:id

→ 200
{
  "id": "acc_xxxx",
  "name": "my-agent",
  "balance": 97500.50,
  "createdAt": "2026-03-01T00:00:00Z"
}
```

## Orders

### Place Order
```
POST /orders
Content-Type: application/json

{
  "accountId": "acc_xxxx",
  "market": "us-stock",
  "symbol": "AAPL",
  "side": "buy",
  "type": "market",
  "quantity": 10
}

→ 201
{
  "id": "ord_xxxx",
  "accountId": "acc_xxxx",
  "market": "us-stock",
  "symbol": "AAPL",
  "side": "buy",
  "type": "market",
  "quantity": 10,
  "status": "filled",
  "filledPrice": 245.32,
  "filledAt": "2026-03-01T00:00:01Z"
}
```

For limit orders, add `"limitPrice": 240.00`. Status will be `"pending"` until filled or cancelled.

### List Orders
```
GET /orders?accountId=acc_xxxx&status=filled&market=us-stock

→ 200
{ "orders": [...] }
```

Query params (all optional): `accountId`, `status` (pending|filled|cancelled), `market`, `symbol`, `limit`, `offset`.

### Cancel Order
```
DELETE /orders/:id

→ 200
{ "id": "ord_xxxx", "status": "cancelled" }
```

Only pending orders can be cancelled.

## Portfolio

### Get Portfolio
```
GET /accounts/:id/portfolio

→ 200
{
  "accountId": "acc_xxxx",
  "balance": 97500.50,
  "positions": [
    {
      "market": "us-stock",
      "symbol": "AAPL",
      "quantity": 10,
      "avgCost": 245.32,
      "currentPrice": 248.10,
      "unrealizedPnl": 27.80,
      "marketValue": 2481.00
    }
  ],
  "totalValue": 99981.50,
  "totalPnl": -18.50
}
```

### List Positions
```
GET /positions?accountId=acc_xxxx

→ 200
{ "positions": [...] }
```

## Market Data

### List Markets
```
GET /markets

→ 200
{
  "markets": [
    { "id": "us-stock", "name": "US Stocks", "status": "open" },
    { "id": "polymarket", "name": "Polymarket", "status": "open" }
  ]
}
```

### Get Quote
```
GET /markets/us-stock/quote/AAPL

→ 200
{
  "symbol": "AAPL",
  "price": 248.10,
  "bid": 248.05,
  "ask": 248.15,
  "volume": 52340000,
  "timestamp": "2026-03-01T00:00:00Z"
}
```

### Search Assets
```
GET /markets/polymarket/search?q=trump+election

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

## Admin Endpoints

Require admin API key in `Authorization: Bearer <admin-key>` header.

### Deposit
```
POST /admin/accounts/:id/deposit
Content-Type: application/json

{ "amount": 50000 }

→ 200
{ "balance": 147500.50 }
```

### Withdraw
```
POST /admin/accounts/:id/withdraw
Content-Type: application/json

{ "amount": 10000 }

→ 200
{ "balance": 137500.50 }
```

## Health
```
GET /health

→ 200
{ "status": "ok", "markets": { "us-stock": "open", "polymarket": "open" } }
```
