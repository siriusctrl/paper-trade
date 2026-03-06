export type MarketCapability = "search" | "browse" | "quote" | "orderbook" | "resolve" | "funding";

export type MarketReference = {
  reference: string;
  name: string;
  price?: number;
  volume?: number;
  liquidity?: number;
  endDate?: string | null;
  metadata?: Record<string, unknown>;
};

export type Quote = {
  reference: string;
  price: number;
  bid?: number;
  ask?: number;
  volume?: number;
  timestamp: string;
};

export type OrderbookLevel = {
  price: number;
  size: number;
};

export type Orderbook = {
  reference: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: string;
};

export type Resolution = {
  reference: string;
  resolved: boolean;
  outcome: string | null;
  settlementPrice: number | null;
  timestamp: string;
};

export type FundingRate = {
  reference: string;
  rate: number;
  nextFundingAt: string;
  timestamp: string;
};

export type MarketDescriptor = {
  id: string;
  name: string;
  description: string;
  referenceFormat: string;
  priceRange: [number, number] | null;
  capabilities: readonly MarketCapability[];
  browseOptions: readonly BrowseOption[];
};

export type SearchOptions = {
  limit?: number;
  offset?: number;
};

export type BrowseOption = {
  value: string;
  label: string;
};

export type BrowseOptions = {
  limit?: number;
  offset?: number;
  sort?: string;
};

export type TradingConstraints = {
  minQuantity: number;
  quantityStep: number;
  supportsFractional: boolean;
  maxLeverage?: number | null;
};

export type SymbolResolution = {
  names: Map<string, string>;
  outcomes: Map<string, string>;
};

export interface MarketAdapter {
  readonly marketId: string;
  readonly displayName: string;
  readonly description: string;
  readonly referenceFormat: string;
  readonly priceRange: [number, number] | null;
  readonly capabilities: readonly MarketCapability[];
  readonly browseOptions?: readonly BrowseOption[];

  search(query: string, options?: SearchOptions): Promise<MarketReference[]>;
  browse?(options?: BrowseOptions): Promise<MarketReference[]>;
  normalizeReference?(reference: string): Promise<string>;
  getQuote(reference: string): Promise<Quote>;
  getOrderbook?(reference: string): Promise<Orderbook>;
  resolve?(reference: string): Promise<Resolution | null>;
  resolveSymbolNames?(symbols: Iterable<string>): Promise<SymbolResolution>;
  getFundingRate?(reference: string): Promise<FundingRate>;
  getTradingConstraints?(reference: string): Promise<TradingConstraints>;
}

export class MarketAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
