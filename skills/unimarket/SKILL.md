---
name: unimarket
description: Simulated multi-market paper trading workflow for agents. Use when an agent needs to register, discover markets dynamically, fetch quotes/orderbooks (single or batch), place/cancel orders, review account state (orders/positions/portfolio/timeline/journal), and consume SSE events with reconnect cursors. Apply strict write semantics (`reasoning` required; idempotency keys for safe retries). Manual reconcile is optional and mainly for immediate consistency checks.
---

# Unimarket

## Use This Skill

Execute agent trading flows against the Unimarket REST API.

Base URL:
- `http://<host>:3100/api`

Authentication:
- Send `Authorization: Bearer <api_key>` for all endpoints except register and health.

## Fast Path

1. Register:
   - `POST /api/auth/register` with `{ "userName": "..." }`.
2. Discover markets:
   - `GET /api/markets`.
3. Search assets:
   - `GET /api/markets/{market}/search`.
4. Fetch market data:
   - Single: `quote`, `orderbook`, `resolve`
   - Batch: `quotes`, `orderbooks`
5. Trade:
   - `POST /api/orders` (market or limit).
   - `DELETE /api/orders/:id` for pending cancel.
6. Audit:
   - `GET /api/orders`, `GET /api/positions`, `GET /api/account/portfolio`, `GET /api/account/timeline`, `GET /api/journal`.
7. Optional manual reconcile:
   - `POST /api/orders/reconcile` only when immediate state convergence is required.

## Operating Rules

- Discover market IDs via `GET /api/markets`; do not hardcode market assumptions.
- Include non-empty `reasoning` in state-changing operations.
- Background reconciler already runs server-side. Do not call manual reconcile every cycle.
- Use `POST /api/orders/reconcile` only when you need deterministic immediate updates for pending limit orders.
- Send `Idempotency-Key` for retryable writes:
  - `POST /api/orders`
  - `DELETE /api/orders/:id`
  - `POST /api/journal`
- Track SSE event IDs and reconnect with cursor:
  - `GET /api/events?since=<event_id>`
  - or `Last-Event-ID: <event_id>`
- If `system.ready.data.version` changes, reload this skill and references.

## Helper Script

Use `skills/unimarket/scripts/unimarket-agent.sh` for repetitive operations.

Common commands:
- `register`, `markets`, `search`
- `quote`, `quotes`, `orderbook`, `orderbooks`, `resolve`
- `buy`, `sell`, `cancel`, `orders`, `reconcile`
- `account`, `portfolio`, `positions`, `timeline`, `journal-add`, `journal-list`
- `events [since_event_id]`

## Read References On Demand

- API contract and request/response details:
  - [references/api.md](references/api.md)
- Market-specific behavior and adapter notes:
  - [references/markets.md](references/markets.md)
