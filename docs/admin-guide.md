# Admin Guide

This guide covers the operator-facing dashboard and admin-only API surface.

## What the Admin Surface Is For

Admins can:
- create trader users
- fund and withdraw from user accounts
- inspect portfolio and audit history across users
- place simulation orders on behalf of a user from the dashboard or admin API
- monitor funding, liquidation, and equity trends

Admins cannot bypass the core trading engine. Admin order placement still uses the same validation, fill logic, accounting, and market constraints as normal user order placement.

## Using the Dashboard

### Login

1. Start the API with `ADMIN_API_KEY` configured.
2. Open the dashboard.
3. Authenticate with `Authorization: Bearer <ADMIN_API_KEY>` through the login page.

Typical local URLs:
- dashboard dev server: `http://localhost:5173`
- API server: `http://localhost:3100`

### Main operator views

The dashboard currently exposes several operator workflows.

#### Overview

The overview screen shows:
- total balance, market value, unrealized PnL, and equity across users
- per-user cards with balances, equity, and top holdings
- market-level summary data across all tracked positions
- equity trend charts backed by periodic admin snapshots

#### Agent detail

A user detail view shows:
- current balance and open positions
- perp risk fields such as leverage and liquidation price when applicable
- recent activity merged from orders, journals, funding, and liquidation audits

#### Trade console

The trade page allows an admin to:
- create a new trader account
- choose a market dynamically from runtime discovery
- search assets
- inspect quotes and trading constraints
- select a target user
- place market or limit orders on that user's behalf

This uses the admin endpoint `POST /api/admin/users/:id/orders`.

## Admin API Endpoints

All admin endpoints require:

```text
Authorization: Bearer <ADMIN_API_KEY>
```

### Account management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/users/:id/deposit` | Add funds to a user's default account |
| `POST` | `/api/admin/users/:id/withdraw` | Remove funds from a user's default account |
| `POST` | `/api/admin/traders` | Create a trader user and default account |

Examples:

```bash
curl -X POST http://localhost:3100/api/admin/traders \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userName":"research-bot"}'
```

```bash
curl -X POST http://localhost:3100/api/admin/users/<userId>/deposit \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount":100000}'
```

### Read models

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/overview` | Cross-user portfolio and market summary |
| `GET` | `/api/admin/users/:id/portfolio` | One user's balance, positions, open orders, and recent orders |
| `GET` | `/api/admin/users/:id/timeline` | One user's merged audit timeline |
| `GET` | `/api/admin/equity-history` | Historical equity snapshots grouped by user |

### Trading on behalf of a user

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/users/:id/orders` | Place an order for a user's default account |

This endpoint intentionally mirrors normal user-side order semantics.

Important rules:
- all orders still require `reasoning`
- optional `accountId` must match the user's default account if supplied
- `Idempotency-Key` is supported and should be used by the dashboard or scripts for retry-safe writes
- `leverage` and `reduceOnly` are only valid for perp markets
- symbol normalization and trading-constraint validation still apply
- market orders fill immediately using directional executable prices
- limit orders remain pending until the background reconciler fills or cancels them

## Timeline Semantics

Admin timelines use the same merged event builder as user timelines.

Current timeline event types:
- `order`
- `order.cancelled`
- `journal`
- `funding.applied`
- `position.liquidated`

This matters operationally because liquidation is now a first-class audit record instead of just a generic filled order with opaque reasoning.

## Background Workers Relevant to Admins

### Reconciler

The reconciler runs in the background and tries to fill pending limit orders when market prices cross the limit.

Behavior:
- fills executable pending limit orders
- auto-cancels stale delisted or expired symbols when the adapter can no longer quote them

Normal clients should treat this as automatic background convergence. The reconciler is not exposed as a public API action; dashboards and agents should read `portfolio`, `openOrders`, and timeline state instead of trying to manually advance the worker.

### Settler

The settler resolves positions in markets that expose resolution data, such as prediction markets.

Behavior:
- credits settlement proceeds to the account
- deletes the settled position
- emits settlement events

### Funding collector

The funding collector applies periodic funding to open perp positions.

Behavior:
- updates account balance
- records funding payments for later portfolio and timeline views

### Liquidator

The liquidator scans funding-capable positions and closes unsafe perp positions.

Current behavior:
- trigger uses `quote.price`
- execution uses `bid` for liquidating longs and `ask` for liquidating shorts, with fallback to `price`
- remaining payout is capped to isolated position equity semantics
- pending `reduceOnly` orders on the same account, market, and symbol are auto-cancelled
- each liquidation is written to the structured `liquidations` audit table
- the system emits `position.liquidated` and any necessary `order.cancelled` events

For operators, that means the activity feed can now show:
- who got liquidated
- when it happened
- the trigger price and execution price
- the net payout returned to the account
- which reduce-only orders were cancelled as part of cleanup

## Operational Notes

- The overview page records equity snapshots in the background. The chart becomes more useful over time.
- Admin order placement does not bypass trading constraints or risk rules.
- If you see liquidation events, always check the paired portfolio state and recent funding for context.
- If a pending `reduceOnly` order disappears after liquidation, that is expected cleanup behavior.

## Recommended Operator Workflow

1. Create a dedicated trader user.
2. Deposit starting capital.
3. Place trades either through the user API or the admin trade console.
4. Monitor positions and funding through portfolio views.
5. Use timelines and SSE for audit and incident review.
6. Use equity history for longer-horizon strategy comparison.
