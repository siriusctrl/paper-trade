---
name: unimarket
description: Multi-market paper trading workflow for agents using the Unimarket REST API. Use when Codex needs to register a user, discover markets dynamically, inspect quotes, orderbooks, price history, funding, or resolution data, place or cancel paper orders, review account state, write journal entries, or consume SSE events against Unimarket.
---

# Unimarket

Base URL:
- `http://<host>:3100/api`

Authentication:
- Send `Authorization: Bearer <api_key>` on every endpoint except register and health.

## Fast Path

1. Register once with `POST /api/auth/register`.
2. Discover market IDs, capabilities, browse sorts, and price-history defaults with `GET /api/markets`.
3. Browse or search candidates:
   - `GET /api/markets/{market}/browse`
   - `GET /api/markets/{market}/search?q=...`
4. Persist the returned `reference`; treat it as the only external market identifier.
5. Read execution and sizing context before trading:
   - `GET /api/markets/{market}/trading-constraints?reference=...`
   - `GET /api/markets/{market}/quote?reference=...`
   - optional `orderbook`, `price-history`, `funding`, `resolve`
6. Place or cancel orders with non-empty `reasoning`.
7. Audit with `orders`, `positions`, `portfolio`, `timeline`, `journal`, and `events`.

## Operating Rules

- Discover `market`, `browseOptions`, and `priceHistory` support from `GET /api/markets`; do not hardcode markets, references, or intervals.
- Prefer `browse` for blank exploration; use `search` only with a concrete non-empty query.
- Use `reference` everywhere in public market-data and order endpoints.
- Read `priceHistory.supportedIntervals`, `defaultInterval`, `defaultLookbacks`, and `supportsResampling` before requesting candles.
- Prefer `interval + lookback` for routine trend checks.
- Use `asOf` only when you need reproducible historical analysis.
- Use `startTime + endTime` only for custom ranges.
- Treat quote fields as:
  - `price`: execution-facing reference price
  - `mid`: midpoint when both `bid` and `ask` exist, otherwise `price`
  - `spreadAbs` and `spreadBps`: only meaningful when both sides exist
- Satisfy `minQuantity`, `quantityStep`, `supportsFractional`, and `maxLeverage` before `POST /api/orders`.
- Include `Idempotency-Key` on retryable writes:
  - `POST /api/orders`
  - `DELETE /api/orders/:id`
  - `POST /api/journal`
- Avoid `POST /api/orders/reconcile` in routine cycles; the background reconciler already runs.
- Reload this skill and its references if `system.ready.data.version` changes.

## Helper Script

Use `skills/unimarket/scripts/unimarket-agent.sh` for repetitive calls.

Common commands:
- `register`, `markets`, `browse`, `search`
- `constraints`, `quote`, `quotes`, `orderbook`, `orderbooks`, `funding`, `fundings`, `resolve`
- `history`, `history-range`
- `buy`, `sell`, `cancel`, `orders`
- `account`, `portfolio`, `positions`, `timeline`, `journal-add`, `journal-list`, `events`

Use `history` for the common agent flow:
- `history <market> <reference> [interval] [lookback] [as_of]`

Use `history-range` only when an exact time window is required:
- `history-range <market> <reference> <interval> <start_time> <end_time>`

## Read References On Demand

- Read `references/api.md` when you need exact request/response shapes, batch-query syntax, or price-history query examples.
- Read `references/markets.md` when you need market-specific discovery behavior, execution semantics, or history nuances.
