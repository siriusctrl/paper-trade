# paper-trade

Open paper trading platform for US stocks and prediction markets. Built for humans and agents alike.

## What is this?

A self-hosted paper trading engine with a clean REST API. Simulated trading across multiple markets — no real money, no risk. Any AI agent (or human) that can call an HTTP endpoint can trade.

- **Polymarket** — prediction market trading with live odds from the CLOB API
- **Extensible** — add new markets by implementing a simple adapter interface
- **US Stocks** — coming soon

Ships with a web dashboard and an auto-generated OpenAPI spec so any agent framework can integrate without custom glue code.

## Architecture

```
┌─────────────────────────────────────────────────┐
│            Single Node.js Process                │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │           Hono Server (:3100)              │  │
│  │                                            │  │
│  │  /api/*  → REST API (trading, accounts)    │  │
│  │  /*      → Static files (Vite build)       │  │
│  │  /openapi.json → Auto-generated spec       │  │
│  └──────────────────┬─────────────────────────┘  │
│                     │                            │
│  ┌──────────────────▼─────────────────────────┐  │
│  │          Trading Engine (core)             │  │
│  │   accounts · orders · positions · P&L      │  │
│  └──────┬─────────────────────────┬───────────┘  │
│         │                         │              │
│  ┌──────▼──────┐          ┌──────▼──────┐       │
│  │  US Stocks  │          │ Polymarket  │       │
│  │  (adapter)  │          │  (adapter)  │       │
│  └─────────────┘          └─────────────┘       │
└─────────────────────────────────────────────────┘
```

**Key design decisions:**
- Single process: Hono serves both API and frontend static files
- `core` is pure logic with no I/O — Zod schemas shared across the entire stack
- Market adapters implement a unified interface
- OpenAPI spec is the universal integration point — any agent that reads JSON can trade
- Accounts get initial funds on creation; only admins can deposit more

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript (end-to-end) | Type safety, shared types front-to-back |
| Runtime | Node.js | Single process serves everything |
| API | [Hono](https://hono.dev) + [Zod](https://zod.dev) | Type-safe routes, auto OpenAPI, serves static files |
| Database | SQLite via [Drizzle ORM](https://orm.drizzle.team) | Zero ops, single-file, perfect for paper trading |
| Frontend | [Vite](https://vite.dev) + [React](https://react.dev) | Pure SPA, no SSR complexity |
| Monorepo | pnpm workspaces | Simple, fast |
| Testing | [Vitest](https://vitest.dev) | Fast, native TS |

## Project Structure

```
paper-trade/
├── packages/
│   ├── core/             # Trading engine — pure logic, no I/O
│   │   ├── account.ts    # Account management, initial balance
│   │   ├── order.ts      # Order types, validation, matching
│   │   ├── position.ts   # Position tracking, average cost
│   │   ├── pnl.ts        # P&L calculation (realized + unrealized)
│   │   └── schemas.ts    # Zod schemas (shared front + back)
│   ├── markets/          # Market adapters (unified interface)
│   │   ├── types.ts      # MarketAdapter interface
│   │   └── polymarket/   # Polymarket CLOB API
│   ├── api/              # Hono server (API + static file serving)
│   │   ├── routes/       # Route handlers by domain
│   │   ├── db/           # Drizzle schema + migrations
│   │   └── index.ts      # Entry point (API + serves web build)
│   └── web/              # Vite + React dashboard
├── skill/                # Agent integration skill
│   ├── SKILL.md          # How agents should use this platform
│   └── references/
│       ├── api.md        # Endpoint details + examples
│       └── markets.md    # Market-specific notes
└── README.md
```

## API Overview

### Accounts
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/accounts` | Create account (starts with initial balance) |
| `GET` | `/api/accounts/:id` | Get account details + balance |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/accounts/:id/deposit` | Add funds (admin only) |
| `POST` | `/api/admin/accounts/:id/withdraw` | Remove funds (admin only) |

### Trading
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/orders` | Place an order (market/limit) |
| `GET` | `/api/orders` | List orders (filter by account, status, market) |
| `DELETE` | `/api/orders/:id` | Cancel a pending order |

### Portfolio
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/positions` | List open positions |
| `GET` | `/api/accounts/:id/portfolio` | Full portfolio summary with P&L |

### Market Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/markets` | List available markets |
| `GET` | `/api/markets/:market/quote/:symbol` | Get current quote |
| `GET` | `/api/markets/:market/search` | Search for tradeable assets |

### Meta
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/openapi.json` | OpenAPI 3.1 spec |
| `GET` | `/health` | Health check |

## Market Adapters

Adding a new market means implementing this interface:

```typescript
interface MarketAdapter {
  readonly marketId: string
  readonly displayName: string

  getQuote(symbol: string): Promise<Quote>
  search(query: string): Promise<Asset[]>
  getOrderbook?(symbol: string): Promise<Orderbook>
  resolve?(symbol: string): Promise<Resolution>  // for prediction markets
}
```

## Getting Started

```bash
git clone https://github.com/siriusctrl/paper-trade.git
cd paper-trade
pnpm install
pnpm dev       # starts API + web on :3100
pnpm test      # run tests
```

## Roadmap

- [x] Project setup + architecture
- [ ] Core trading engine (accounts, orders, positions, P&L)
- [ ] Polymarket adapter
- [ ] REST API with OpenAPI spec
- [ ] Web dashboard
- [ ] Agent integration skill
- [ ] US stock market adapter
- [ ] More markets (Kalshi, crypto)
- [ ] Historical trade replay / backtesting
- [ ] WebSocket for real-time updates

## Contributing

PRs welcome. Strong types, pure functions in core, clear separation of concerns.

## License

MIT
