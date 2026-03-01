# Market Reference

## US Stocks (`us-stock`)

- **Symbols**: Standard US ticker symbols (AAPL, TSLA, MSFT, etc.)
- **Data source**: Yahoo Finance (free, no API key needed) with Alpaca as optional fallback
- **Trading hours**: Simulated orders fill anytime, but quotes reflect real market hours
- **Order types**: `market` (fills immediately at current price), `limit` (fills when price reaches target)
- **Quantity**: Integer shares only (no fractional shares)
- **Short selling**: Supported — sell what you don't own, buy to cover later

### Quote Fields
| Field | Description |
|-------|-------------|
| `price` | Last trade price |
| `bid` / `ask` | Current bid/ask |
| `volume` | Daily volume |
| `timestamp` | Quote timestamp |

## Polymarket (`polymarket`)

- **Symbols**: Polymarket condition IDs (hex strings like `0x1234...abcd`)
- **Data source**: Polymarket CLOB API (free, no API key needed)
- **Resolution**: Contracts resolve to $1.00 (yes) or $0.00 (no) when the event outcome is determined
- **Order types**: `market`, `limit`
- **Quantity**: Number of contracts (integer)
- **Price range**: $0.01 – $0.99 per contract

### Finding Markets
Use `GET /api/markets/polymarket/search?q=<query>` to search by keyword. Returns matching markets with current prices and volume.

### How Prediction Market Trading Works
1. Buy YES contracts if you think the event will happen (price < $1.00 = potential profit)
2. Buy NO contracts if you think it won't happen
3. When the event resolves, winning contracts pay $1.00, losing contracts pay $0.00
4. You can sell contracts before resolution at the current market price

### Quote Fields
| Field | Description |
|-------|-------------|
| `price` | Current YES price ($0.01–$0.99) |
| `bid` / `ask` | Best bid/ask from the order book |
| `volume` | 24h trading volume in USD |
| `endDate` | When the market is expected to resolve |

## Adding New Markets

Implement the `MarketAdapter` interface:

```typescript
interface MarketAdapter {
  readonly marketId: string
  readonly displayName: string

  getQuote(symbol: string): Promise<Quote>
  search(query: string): Promise<Asset[]>
  getOrderbook?(symbol: string): Promise<Orderbook>
  resolve?(symbol: string): Promise<Resolution>
}
```

Register the adapter in the API server config. All existing routes automatically work with the new market.
