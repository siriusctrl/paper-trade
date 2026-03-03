# unimarket

Open paper trading platform for prediction markets and beyond. Built for humans and agents alike.

## What is this?

A self-hosted paper trading engine with a clean REST API. Simulated trading across multiple markets — no real money, no risk. Any AI agent (or human) that can call an HTTP endpoint can trade.

- **Market agnostic** — unified API across all markets, discover capabilities at runtime
- **Polymarket** — prediction market trading with live odds from the CLOB API
- **Extensible** — add new markets by implementing a simple adapter interface
- **Agent-friendly** — skill-based integration with version-aware SSE events, self-describing market capabilities
- **Decision transparency** — every action requires reasoning; journal + timeline for full audit trail
- **US Stocks** — coming soon

## Architecture

```
┌─────────────────────────────────────────────────┐
│            Single Node.js Process                │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │           Hono Server (:3100)              │  │
│  │                                            │  │
│  │  /api/*  → REST API                        │  │
│  │  /*      → Static files (Vite build)       │  │
│  │  /api/events → SSE event stream            │  │
│  └──────────────────┬─────────────────────────┘  │
│                     │                            │
│  ┌──────────────────▼─────────────────────────┐  │
│  │          Trading Engine (core)             │  │
│  │   account · orders · positions · P&L       │  │
│  │   pure logic, market agnostic              │  │
│  └──────────────────┬─────────────────────────┘  │
│                     │                            │
│  ┌──────────────────▼─────────────────────────┐  │
│  │         Market Adapter Registry            │  │
│  │  ┌─────────────┐  ┌─────────────┐         │  │
│  │  │ Polymarket  │  │  (future)   │  ...    │  │
│  │  └─────────────┘  └─────────────┘         │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**Key design decisions:**
- Single process: Hono serves both API and frontend static files
- `core` is pure logic with no I/O — Zod schemas shared across the entire stack
- Market adapters implement a unified interface, registered at startup
- Runtime discovery: `GET /api/markets` returns available markets + capabilities
- Every write operation requires a `reasoning` field — full decision audit trail
- Journal endpoint for freeform notes; timeline endpoint aggregates everything
- Accounts get initial funds on creation; only admins can deposit/withdraw
- API key auth: register → get key → trade

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript (end-to-end) | Type safety, shared types front-to-back |
| Runtime | Node.js | Single process serves everything |
| API | [Hono](https://hono.dev) + [Zod](https://zod.dev) | Type-safe routes, SSE streaming, serves static files |
| Database | SQLite via [Drizzle ORM](https://orm.drizzle.team) | Zero ops, single-file, perfect for paper trading |
| Frontend | [Vite](https://vite.dev) + [React](https://react.dev) + [shadcn/ui](https://ui.shadcn.com) + [Tailwind](https://tailwindcss.com) + [Recharts](https://recharts.org) + [TanStack Table](https://tanstack.com/table) | Polished dashboard UI with fast iteration and strong data visualization/table primitives |
| Monorepo | pnpm workspaces | Simple, fast |
| Testing | [Vitest](https://vitest.dev) | Fast, native TS |

## Project Structure

```
unimarket/
├── packages/
│   ├── core/             # Trading engine — pure logic, no I/O
│   │   ├── account.ts    # Account management, initial balance
│   │   ├── order.ts      # Order types, validation, matching
│   │   ├── position.ts   # Position tracking, average cost
│   │   ├── pnl.ts        # P&L calculation (realized + unrealized)
│   │   └── schemas.ts    # Zod schemas (shared front + back)
│   ├── markets/          # Market adapters (unified interface)
│   │   ├── types.ts      # MarketAdapter interface
│   │   └── polymarket/   # Polymarket CLOB API + Gamma API
│   ├── api/              # Hono server (API + static file serving)
│   │   ├── routes/       # Route handlers by domain
│   │   ├── middleware/    # Auth, error handling
│   │   ├── db/           # Drizzle schema + migrations
│   │   └── index.ts      # Entry point
│   └── web/              # Vite + React dashboard
├── skill/                # Agent integration skill
│   ├── SKILL.md
│   └── references/
│       ├── api.md
│       └── markets.md
└── README.md
```

## API Overview

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/register` | — | Register (`userName`), get first API key + default account |
| `POST` | `/api/auth/keys` | key | Generate additional API key |
| `DELETE` | `/api/auth/keys/:id` | key | Revoke a key |

### Accounts
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/account` | key | Get current user's default account details |
| `GET` | `/api/account/portfolio` | key | Current user's portfolio summary with P&L |
| `GET` | `/api/account/timeline` | key | Current user's timeline (orders + journal) |

### Trading
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/orders` | key | Place an order (requires `reasoning`) |
| `GET` | `/api/orders` | key | List orders (`view=open|history|all`) |
| `GET` | `/api/orders/:id` | key | Get a single order by id |
| `POST` | `/api/orders/reconcile` | key/admin | Reconcile pending limit orders (requires `reasoning`) |
| `DELETE` | `/api/orders/:id` | key | Cancel an order (requires `reasoning`) |

### Real-Time Events
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/events` | key | Subscribe to real-time events via SSE (order fills, cancellations, settlements) |

### Positions
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/positions` | key | List open positions |

### Journal
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/journal` | key | Write a journal entry |
| `GET` | `/api/journal` | key | List entries (`?limit=5&offset=0&q=&tags=`) |

### Market Data (runtime discovery)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/markets` | key | List markets + capabilities |
| `GET` | `/api/markets/:market/search` | key | Search or browse assets (`?q=&limit=20&offset=0`, default 20, max 100) |
| `GET` | `/api/markets/:market/quote` | key | Get quote (`?symbol=`) |
| `GET` | `/api/markets/:market/orderbook` | key | Get orderbook (`?symbol=`) |
| `GET` | `/api/markets/:market/resolve` | key | Check settlement (`?symbol=`) |

### Admin
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/admin/users/:id/deposit` | admin | Add funds to user's default account |
| `POST` | `/api/admin/users/:id/withdraw` | admin | Remove funds from user's default account |
| `GET` | `/api/admin/overview` | admin | Portfolio overview (totals, market summaries, user/agent holdings) |

### Meta
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | — | Health check (includes API version) |

## Runtime Market Discovery

`GET /api/markets` returns all available markets with their capabilities:

```json
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

## Market Adapters

Adding a new market means implementing this interface:

```typescript
interface MarketAdapter {
  readonly marketId: string
  readonly displayName: string
  readonly description: string
  readonly symbolFormat: string
  readonly priceRange: [number, number] | null
  readonly capabilities: string[]

  getQuote(symbol: string): Promise<Quote>
  search(query: string): Promise<Asset[]>
  getOrderbook?(symbol: string): Promise<Orderbook>
  resolve?(symbol: string): Promise<Resolution | null>
}
```

## Agent Integration

Agents interact with unimarket through a skill document (`skill/SKILL.md`) that serves as the API contract. No OpenAPI spec needed — the skill doc contains everything an LLM agent needs.

Key features:
- **Version-aware**: All responses include `X-API-Version` header. SSE connections start with a `system.ready` event containing the server version
- **Self-healing**: When the server version changes, agents can reload the skill document to pick up API changes automatically
- **Real-time events**: `GET /api/events` streams order fills, cancellations, and settlements via SSE — no polling needed
- **Reasoning audit trail**: Every write operation requires a `reasoning` field for full decision transparency

## Getting Started

```bash
git clone https://github.com/siriusctrl/unimarket.git
cd unimarket
pnpm install
pnpm dev       # starts API (:3100) + web dashboard (:5173)
pnpm dev:api   # API only
pnpm dev:web   # dashboard only
pnpm test
pnpm coverage  # API/core/markets coverage with CI-enforced thresholds
```

## Roadmap

- [x] Project setup + architecture
- [x] Core trading engine (accounts, orders, positions, P&L)
- [x] Auth (register, API keys)
- [x] Polymarket adapter
- [x] Journal + timeline
- [x] REST API with skill-based agent integration
- [x] Limit order improvements (immediate fill when marketable)
- [x] Pending order reconcile endpoint
- [x] Web dashboard (admin overview, market totals, user/agent holdings)
- [x] Agent integration skill
- [x] Transaction atomicity and CAS concurrency protection
- [x] SSE event stream for real-time agent notifications
- [x] API versioning with system.ready handshake
- [x] Dark mode dashboard with theme toggle
- [x] Reconciler optimization (1s polling, symbol-batched quotes)
- [ ] US stock market adapter
- [ ] More markets (Kalshi, crypto)
- [ ] Historical trade replay / backtesting

## Contributing

PRs welcome. Strong types, pure functions in core, clear separation of concerns.

## License

MIT
