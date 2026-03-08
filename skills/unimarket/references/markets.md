# Unimarket Markets

## Cross-Market Rules

- Persist the discovery `reference`; do not replace it with guessed exchange identifiers.
- Read `/api/markets` before requesting candles so the agent can discover:
  - `supportedIntervals`
  - `defaultInterval`
  - `defaultLookbacks`
  - `supportsResampling`
- Read `/api/markets/{market}/trading-constraints?reference=...` before placing orders.
- Use quote fields as:
  - `price`: execution-facing reference price
  - `mid`: best-effort midpoint
  - `spreadAbs` and `spreadBps`: spread diagnostics when both sides exist

## Polymarket (`polymarket`)

- Discovery `reference` is usually a market slug.
- Execution reads and order placement accept the same `reference`; the adapter resolves it internally to a tradable token id.
- Capabilities: `search`, `browse`, `quote`, `orderbook`, `resolve`, `priceHistory`.
- Browse sorts: `volume`, `liquidity`, `endingSoon`, `newest`.
- Price range is usually `0.01` to `0.99`.
- Quantity is integer-only: `quantityStep = 1`, `supportsFractional = false`.
- Bearish views are usually expressed by buying the opposite outcome token, not by shorting.
- History behavior:
  - native intervals: `1m`, `1h`, `1d`
  - agent-facing intervals may include `5m`, `15m`, `4h`
  - `resampledFrom` tells you when the server aggregated native candles into the requested interval

## Hyperliquid (`hyperliquid`)

- Discovery and execution `reference` is usually a ticker such as `BTC`.
- Aliases like `btc`, `btc-perp`, or mixed case are normalized internally.
- Capabilities: `search`, `browse`, `quote`, `orderbook`, `funding`, `priceHistory`.
- Browse sorts: `price`.
- Quantity precision is per-symbol and derived from `szDecimals`.
- `maxLeverage` is enforced per symbol.
- Funding applies hourly and affects realized account balance over time.
- Perpetual futures do not resolve; close exposure with explicit trades.
- History behavior:
  - native intervals and supported intervals match
  - `supportsResampling = false`

## Choosing Reads Before Trading

### Prediction-market candidate
1. Browse or search Polymarket.
2. Keep the returned `reference`.
3. Read `quote` and `orderbook`.
4. Optionally read `price-history` to inspect trend.
5. Optionally read `resolve` if the market may already be settling.
6. Validate `trading-constraints` before ordering.

### Perp candidate
1. Browse or search Hyperliquid.
2. Keep the returned `reference`.
3. Read `quote`, `orderbook`, and `funding`.
4. Read `price-history` for recent trend or volatility.
5. Validate `trading-constraints` before ordering.
