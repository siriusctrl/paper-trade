---
name: paper-trade
description: >
  Paper trading platform API for simulated trading on prediction markets (Polymarket). More markets (US stocks, Kalshi) coming soon.
  Use when an agent needs to: place simulated trades, check portfolio positions and P&L,
  look up stock quotes or prediction market odds, manage a virtual trading account,
  or test any trading strategy without real money.
  The platform exposes a standard REST API — no SDK or special protocol needed.
---

# Paper Trade

## Quick Start

The platform runs as a single HTTP server. All interaction is via REST API.

```
Base URL: http://<host>:3100/api
OpenAPI spec: http://<host>:3100/openapi.json
```

## Core Workflow

```
1. POST /api/accounts              → create account (gets $100,000 initial balance)
   save the returned account_id

2. GET  /api/markets               → list available markets (us-stock, polymarket)

3. GET  /api/markets/polymarket/search?q=election  → find a market

4. POST /api/orders                → place a trade
   { "accountId", "market", "symbol", "side": "buy"|"sell", "type": "market"|"limit", "quantity", "limitPrice?" }

5. GET  /api/accounts/:id/portfolio  → check positions + P&L
```

## Key Rules

- Accounts start with a fixed initial balance. You cannot deposit funds — only trade with what you have.
- All trades are simulated. No real money moves.
- Market data is real (live quotes from Yahoo Finance / Polymarket CLOB API).
- Orders execute against real market prices but in a simulated order book.

## Markets

Two markets are available. See [references/markets.md](references/markets.md) for market-specific details.

| Market ID | Assets | Order Types |
|-----------|--------|-------------|
| `polymarket` | Prediction market contracts | market, limit |

More markets (US stocks, Kalshi) planned — see roadmap.

### Polymarket Specifics

- Symbols are Polymarket condition IDs
- Positions resolve to $0 or $1 based on outcome
- Use `GET /api/markets/polymarket/search?q=<query>` to find markets

## Error Handling

All errors return JSON:
```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "..." } }
```

Common codes: `INSUFFICIENT_BALANCE`, `INVALID_ORDER`, `MARKET_NOT_FOUND`, `SYMBOL_NOT_FOUND`, `ORDER_NOT_FOUND`.

## Full API Reference

See [references/api.md](references/api.md) for complete endpoint documentation with request/response examples.
