# Building an Autonomous Trading Agent

## TL;DR

Give this document and `skills/unimarket/SKILL.md` to any coding agent and ask it to:

> Set up a workspace and run autonomous paper-trading cycles against the unimarket API at `http://localhost:3100`. Use `skills/unimarket/SKILL.md` as the API contract and `skills/unimarket/scripts/unimarket-agent.sh` as the helper script. Register once, then loop: research markets -> decide -> journal -> sleep -> repeat.

For the system behavior behind those APIs, also point the agent at [Trading Model](trading-model.md).

## Workspace Layout

```text
my-agent-workspace/
├── AGENTS.md
├── prompts/
│   └── trader.prompt.md
├── .state/
│   ├── agent.env
│   ├── memory.md
│   └── next_sleep_secs
├── logs/
│   └── strategy-journal.md
├── skills/
│   └── unimarket/
├── run.sh
└── package.json
```

Durable state should live in two places:
- server-side API records such as orders, timeline, and journal
- local `.state/` files for cycle memory and credentials

## Step 1: AGENTS.md

Keep the standing instructions short and explicit.

```markdown
# Agent Worker Instructions

Mission: run autonomous paper trading cycles against unimarket API and improve strategy over time.

Rules:
- Use `skills/unimarket/SKILL.md` as primary API contract.
- Use `skills/unimarket/scripts/unimarket-agent.sh` for endpoint operations.
- Never use admin endpoints.
- Persist runtime state under `.state/` and logs under `logs/`.
- All state-changing operations must include non-empty `reasoning`.
- Use idempotency keys for retry-safe writes.
- Discover markets dynamically; do not hardcode market assumptions.
- Never print or log raw API keys.
```

## Step 2: Cycle Prompt

A good per-cycle prompt has four parts.

### Objective

```text
Run exactly ONE autonomous trading cycle against http://localhost:3100, then exit.
Primary objective: maximize long-run paper-trading profitability.
```

### Autonomy scope

- choose strategy, holding period, and market interpretation independently
- trade only when there is a reasoned edge
- prefer action over infrastructure redesign during a live cycle

### Cycle requirements

Each cycle should:
1. read account, portfolio, orders, and positions
2. research markets through browse/search, quotes, orderbooks, price history, and optional funding/resolve endpoints
3. decide explicitly between trade and no-trade
4. avoid duplicate pending orders
5. write one concise journal entry every cycle
6. write the next sleep interval to `.state/next_sleep_secs`

### Journal checklist

Every cycle journal entry should record:
- actions taken, or why no action was taken
- supporting evidence
- current hypothesis and confidence
- risks and invalidators

## Step 3: Runner Script

A minimal runner is enough.

```bash
#!/usr/bin/env bash
set -euo pipefail

WS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_FILE="$WS_DIR/prompts/trader.prompt.md"
SLEEP_HINT_FILE="$WS_DIR/.state/next_sleep_secs"
DEFAULT_SLEEP=300
MIN_SLEEP=60
MAX_SLEEP=7200

mkdir -p "$WS_DIR/.state" "$WS_DIR/logs"

resolve_sleep() {
  local raw=""
  [[ -f "$SLEEP_HINT_FILE" ]] && raw="$(tr -d ' \t\r\n' <"$SLEEP_HINT_FILE" || true)"
  local val="${raw:-$DEFAULT_SLEEP}"
  [[ "$val" =~ ^[0-9]+$ ]] || val="$DEFAULT_SLEEP"
  (( val < MIN_SLEEP )) && val="$MIN_SLEEP"
  (( val > MAX_SLEEP )) && val="$MAX_SLEEP"
  printf '%s' "$val"
}

while true; do
  codex exec \
    --dangerously-bypass-approvals-and-sandbox \
    --skip-git-repo-check \
    -C "$WS_DIR" \
    "$(cat "$PROMPT_FILE")" || true

  sleep_secs="$(resolve_sleep)"
  sleep "$sleep_secs"
done
```

The exact CLI does not matter. The pattern does.

## Design Patterns

### State persistence

| What | Where | Why |
|------|-------|-----|
| Credentials | `.state/agent.env` | Survives restarts, protect with mode `600` |
| Cycle decisions | API journal | Durable server-side source of truth |
| Strategy memory | `.state/memory.md` | Long-lived hypotheses and lessons |
| Scratch data | `.state/cycle_*.json` | Disposable local working files |
| Local history | `logs/strategy-journal.md` | Full local trace |

### Risk defaults

Pragmatic starting defaults:
- no more than 2 orders per cycle
- conservative size while the strategy is immature
- skip when free balance is low
- avoid duplicate pending orders on the same thesis
- keep a clear written reason for every trade

### Research flow

Use a repeatable sequence:
1. `GET /api/markets`
2. read each market's `browseOptions` and `priceHistory` defaults
3. `GET /api/markets/:market/browse`
4. optional `GET /api/markets/:market/search` when the agent has a concrete query
5. keep the returned `reference` for the candidate you want to investigate
6. `GET /api/markets/:market/quotes`
7. `GET /api/markets/:market/orderbooks`
8. optional `GET /api/markets/:market/price-history?reference=...&interval=...&lookback=...`
9. optional `funding` and `resolve` reads when the market supports them
10. account, portfolio, positions, and order reads
11. decision and journal write

## What the Agent Should Know About the Platform

A few design facts help agents make better decisions.

- unimarket is simulation-first; it does not place real exchange trades in core flows
- discovery surfaces return market `reference` values; execution endpoints accept the same reference and let adapters normalize it internally
- `GET /api/markets` also advertises per-market `priceHistory` defaults so the agent can choose valid intervals and lookbacks without hardcoding them
- the agent should treat `reference` as the only external market identifier it needs to persist between discovery and execution
- on Polymarket, a discovery `reference` is usually a slug preview, not an already-resolved token id
- markets without `funding` behave like spot inventory
- prediction-market bearish views are expressed by buying the opposite outcome token, not by opening a naked short
- markets with `funding` behave like perp markets with leverage, funding, and liquidation
- quote reads include convenience fields such as `mid`, `spreadAbs`, and `spreadBps` that help compare execution quality before trading
- timeline and SSE now include funding and liquidation as first-class events

## Monitoring

Useful operator views while an agent is running:
- dashboard for balance, positions, and activity feed
- `GET /api/account/timeline` for durable audit history
- `GET /api/account/portfolio` for current exposure and PnL
- SSE via `GET /api/events` for real-time fills, cancels, settlements, funding, and liquidation
- local logs and `.state/` files for the agent's own memory

## Quick Start Checklist

1. Create a dedicated workspace.
2. Copy or symlink `skills/unimarket/`.
3. Write `AGENTS.md`.
4. Write the cycle prompt.
5. Write the runner script.
6. Start unimarket with `ADMIN_API_KEY` configured.
7. Launch the runner.
8. Monitor the dashboard, timeline, portfolio, and SSE stream.
