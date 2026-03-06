import { TtlCache } from "./cache.js";
import {
  MarketAdapterError,
  type BrowseOption,
  type BrowseOptions,
  type MarketAdapter,
  type MarketReference,
  type Orderbook,
  type OrderbookLevel,
  type Quote,
  type Resolution,
  type SearchOptions,
  type SymbolResolution,
  type TradingConstraints,
} from "./types.js";

type UnknownObject = Record<string, unknown>;

type BrowsePage = {
  previews: MarketReference[];
  hasMore: boolean;
};

const BATCH_SIZE = 50;
const QUOTE_TTL_MS = 10_000;
const ORDERBOOK_TTL_MS = 10_000;
const SEARCH_TTL_MS = 300_000;
const RESOLVE_TTL_MS = 60_000;
const RESOLVE_NAMES_CONCURRENCY = 8;
const SEARCH_PAGE_SIZE = 20;
const SEARCH_MAX_PAGES = 10;
const BROWSE_EVENTS_PAGE_SIZE = 50;
const BROWSE_MAX_EVENT_PAGES = 6;

const DEFAULT_GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const DEFAULT_CLOB_BASE_URL = "https://clob.polymarket.com";
const CONDITION_ID_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const TOKEN_ID_PATTERN = /^\d+$/;
const POLYMARKET_TRADING_CONSTRAINTS: TradingConstraints = {
  minQuantity: 1,
  quantityStep: 1,
  supportsFractional: false,
  maxLeverage: null,
};
const POLYMARKET_BROWSE_OPTIONS: readonly BrowseOption[] = [
  { value: "volume", label: "Volume" },
  { value: "liquidity", label: "Liquidity" },
  { value: "endingSoon", label: "Ending Soon" },
  { value: "newest", label: "Newest" },
];

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }

  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
    } catch {
      return [];
    }
  }

  return [];
};

const parseNumberArray = (value: unknown): number[] => {
  if (Array.isArray(value)) {
    return value.map((item) => parseNumber(item)).filter((item): item is number => item !== null);
  }

  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.map((item) => parseNumber(item)).filter((item): item is number => item !== null)
        : [];
    } catch {
      return [];
    }
  }

  return [];
};

const parseOrderbookSide = (value: unknown): OrderbookLevel[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const levels: OrderbookLevel[] = [];
  for (const row of value) {
    if (Array.isArray(row) && row.length >= 2) {
      const tuplePrice = parseNumber(row[0]);
      const tupleSize = parseNumber(row[1]);
      if (tuplePrice !== null && tupleSize !== null) {
        levels.push({ price: tuplePrice, size: tupleSize });
        continue;
      }
    }

    if (typeof row !== "object" || row === null) {
      continue;
    }

    const level = row as UnknownObject;
    const price = parseNumber(level.price);
    const size = parseNumber(level.size);
    if (price === null || size === null) {
      continue;
    }

    levels.push({ price, size });
  }

  return levels;
};

const isDiscoveryEligible = (market: UnknownObject): boolean => {
  if (market.active === false) return false;
  if (market.closed === true) return false;
  if (market.archived === true) return false;
  return true;
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new MarketAdapterError("UPSTREAM_ERROR", `Upstream request failed (${response.status}): ${url}`);
  }

  return (await response.json()) as T;
};

const normalizeBrowseSort = (sort?: string): string => {
  return POLYMARKET_BROWSE_OPTIONS.some((option) => option.value === sort) ? (sort as string) : "volume";
};

const browseSortRank = (sort: string, preview: MarketReference): number => {
  if (sort === "endingSoon") {
    if (!preview.endDate) return Number.POSITIVE_INFINITY;
    const ts = Date.parse(preview.endDate);
    return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
  }

  if (sort === "newest") {
    const createdAt = typeof preview.metadata?.createdAt === "string" ? preview.metadata.createdAt : null;
    if (!createdAt) return Number.NEGATIVE_INFINITY;
    const ts = Date.parse(createdAt);
    return Number.isFinite(ts) ? -ts : Number.NEGATIVE_INFINITY;
  }

  if (sort === "liquidity") {
    return -(preview.liquidity ?? Number.NEGATIVE_INFINITY);
  }

  return -(preview.volume ?? Number.NEGATIVE_INFINITY);
};

export type PolymarketAdapterOptions = {
  gammaBaseUrl?: string;
  clobBaseUrl?: string;
};

export class PolymarketAdapter implements MarketAdapter {
  readonly marketId = "polymarket";
  readonly displayName = "Polymarket";
  readonly description = "Prediction markets - contracts typically settle to 0 or 1";
  readonly referenceFormat = "Market reference (slug, condition ID, or token ID)";
  readonly priceRange: [number, number] = [0.01, 0.99];
  readonly capabilities = ["search", "browse", "quote", "orderbook", "resolve"] as const;
  readonly browseOptions = POLYMARKET_BROWSE_OPTIONS;

  private readonly cache = new TtlCache();
  private readonly gammaBaseUrl: string;
  private readonly clobBaseUrl: string;

  constructor(options: PolymarketAdapterOptions = {}) {
    this.gammaBaseUrl = options.gammaBaseUrl ?? DEFAULT_GAMMA_BASE_URL;
    this.clobBaseUrl = options.clobBaseUrl ?? DEFAULT_CLOB_BASE_URL;
  }

  private cacheMarketSymbolMappings(market: UnknownObject): void {
    const conditionId = typeof market.conditionId === "string" ? market.conditionId : null;
    const tokenIds = parseStringArray(market.clobTokenIds);
    const slug = typeof market.slug === "string" ? market.slug : null;

    if (!conditionId) {
      return;
    }

    if (slug) {
      this.cache.set(`slug-condition:${slug}`, conditionId, SEARCH_TTL_MS);
    }

    const tokenId = tokenIds[0];
    if (tokenId) {
      this.cache.set(`condition-token:${conditionId}`, tokenId, SEARCH_TTL_MS);
      if (slug) {
        this.cache.set(`slug-token:${slug}`, tokenId, SEARCH_TTL_MS);
      }
    }

    for (const candidate of tokenIds) {
      this.cache.set(`token-condition:${candidate}`, conditionId, SEARCH_TTL_MS);
    }
  }

  private marketToPreview(
    market: UnknownObject,
    extras: {
      liquidity?: number | null;
      endDate?: string | null;
      createdAt?: string | null;
      eventTitle?: string | null;
    } = {},
  ): MarketReference | null {
    if (!isDiscoveryEligible(market)) {
      return null;
    }

    this.cacheMarketSymbolMappings(market);

    const reference =
      typeof market.slug === "string"
        ? market.slug
        : typeof market.conditionId === "string"
          ? market.conditionId
          : null;
    const name =
      typeof market.question === "string"
        ? market.question
        : typeof market.title === "string"
          ? market.title
          : null;

    if (!reference || !name) {
      return null;
    }

    const conditionId = typeof market.conditionId === "string" ? market.conditionId : null;
    const outcomes = parseStringArray(market.outcomes);
    const outcomePrices = parseNumberArray(market.outcomePrices);
    const defaultOutcome = outcomes[0] ?? null;
    const fallbackPrice = outcomePrices.length > 0 ? outcomePrices[0] : null;

    return {
      reference,
      name,
      price: parseNumber(market.lastTradePrice) ?? parseNumber(market.outcomePrice) ?? fallbackPrice ?? undefined,
      volume: parseNumber(market.volume24hr) ?? parseNumber(market.volume) ?? undefined,
      liquidity: parseNumber(market.liquidity) ?? extras.liquidity ?? undefined,
      endDate:
        (typeof market.endDate === "string" ? market.endDate : null) ?? extras.endDate ?? null,
      metadata:
        conditionId || outcomes.length > 0 || outcomePrices.length > 0 || extras.createdAt || extras.eventTitle
          ? {
              conditionId,
              outcomes,
              outcomePrices,
              defaultOutcome,
              eventTitle: extras.eventTitle ?? null,
              createdAt: extras.createdAt ?? null,
            }
          : undefined,
    };
  }

  private async fetchMarketBySlug(slug: string): Promise<UnknownObject | null> {
    const cacheKey = `market-by-slug:${slug}`;
    const cached = this.cache.get<UnknownObject | null>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const url = new URL("/markets", this.gammaBaseUrl);
    url.searchParams.set("slug", slug);
    url.searchParams.set("limit", "1");

    const raw = await fetchJson<unknown>(url.toString());
    const market = Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object" && raw[0] !== null
      ? (raw[0] as UnknownObject)
      : null;

    if (market) {
      this.cacheMarketSymbolMappings(market);
    }

    this.cache.set(cacheKey, market, SEARCH_TTL_MS);
    return market;
  }

  private async fetchMarketByConditionId(conditionId: string): Promise<UnknownObject | null> {
    const cacheKey = `market-by-condition:${conditionId}`;
    const cached = this.cache.get<UnknownObject | null>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const url = new URL("/markets", this.gammaBaseUrl);
    url.searchParams.set("conditionId", conditionId);
    url.searchParams.set("limit", "1");

    const raw = await fetchJson<unknown>(url.toString());
    const market = Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object" && raw[0] !== null
      ? (raw[0] as UnknownObject)
      : null;

    if (market) {
      this.cacheMarketSymbolMappings(market);
    }

    this.cache.set(cacheKey, market, SEARCH_TTL_MS);
    return market;
  }

  private async fetchMarketByTokenId(tokenId: string): Promise<UnknownObject | null> {
    const cacheKey = `market-by-token:${tokenId}`;
    const cached = this.cache.get<UnknownObject | null>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const url = new URL("/markets", this.gammaBaseUrl);
    url.searchParams.set("clob_token_ids", tokenId);
    url.searchParams.set("limit", "1");

    const raw = await fetchJson<unknown>(url.toString());
    const market = Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object" && raw[0] !== null
      ? (raw[0] as UnknownObject)
      : null;

    if (market) {
      this.cacheMarketSymbolMappings(market);
    }

    this.cache.set(cacheKey, market, SEARCH_TTL_MS);
    return market;
  }

  private async fetchSearchPreviewPage(query: string, page: number): Promise<BrowsePage> {
    const cacheKey = `search-preview:${query.toLowerCase()}:${page}`;
    const cached = this.cache.get<BrowsePage>(cacheKey);
    if (cached) {
      return cached;
    }

    const url = new URL("/search-v2", this.gammaBaseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("page", String(page));
    url.searchParams.set("type", "events");
    url.searchParams.set("optimized", "true");
    url.searchParams.set("limit_per_type", String(SEARCH_PAGE_SIZE));
    url.searchParams.set("search_tags", "true");
    url.searchParams.set("search_profiles", "true");
    url.searchParams.set("cache", "true");

    const raw = await fetchJson<unknown>(url.toString());
    if (typeof raw !== "object" || raw === null) {
      return { previews: [], hasMore: false };
    }

    const response = raw as UnknownObject;
    const events = Array.isArray(response.events) ? response.events : [];
    const previews: MarketReference[] = [];
    const seen = new Set<string>();

    for (const event of events) {
      if (typeof event !== "object" || event === null) {
        continue;
      }

      const eventRecord = event as UnknownObject;
      const eventTitle = typeof eventRecord.title === "string" ? eventRecord.title : null;
      const eventMarkets = Array.isArray(eventRecord.markets) ? eventRecord.markets : [];
      for (const market of eventMarkets) {
        if (typeof market !== "object" || market === null) {
          continue;
        }

        const preview = this.marketToPreview(market as UnknownObject, { eventTitle });
        if (!preview || seen.has(preview.reference)) {
          continue;
        }

        seen.add(preview.reference);
        previews.push(preview);
      }
    }

    const pagination =
      typeof response.pagination === "object" && response.pagination !== null
        ? (response.pagination as UnknownObject)
        : null;

    const result = { previews, hasMore: Boolean(pagination?.hasMore) };
    this.cache.set(cacheKey, result, SEARCH_TTL_MS);
    return result;
  }

  private async fetchBrowseEventPage(page: number): Promise<BrowsePage> {
    const cacheKey = `browse-events:${page}`;
    const cached = this.cache.get<BrowsePage>(cacheKey);
    if (cached) {
      return cached;
    }

    const url = new URL("/events", this.gammaBaseUrl);
    url.searchParams.set("limit", String(BROWSE_EVENTS_PAGE_SIZE));
    url.searchParams.set("offset", String((page - 1) * BROWSE_EVENTS_PAGE_SIZE));
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");

    const raw = await fetchJson<unknown>(url.toString());
    if (!Array.isArray(raw)) {
      return { previews: [], hasMore: false };
    }

    const previews: MarketReference[] = [];
    const seen = new Set<string>();
    for (const event of raw) {
      if (typeof event !== "object" || event === null) {
        continue;
      }

      const eventRecord = event as UnknownObject;
      const liquidity = parseNumber(eventRecord.liquidity);
      const endDate = typeof eventRecord.endDate === "string" ? eventRecord.endDate : null;
      const createdAt = typeof eventRecord.createdAt === "string" ? eventRecord.createdAt : null;
      const eventTitle = typeof eventRecord.title === "string" ? eventRecord.title : null;
      const markets = Array.isArray(eventRecord.markets) ? eventRecord.markets : [];
      for (const market of markets) {
        if (typeof market !== "object" || market === null) {
          continue;
        }

        const preview = this.marketToPreview(market as UnknownObject, {
          liquidity,
          endDate,
          createdAt,
          eventTitle,
        });
        if (!preview || seen.has(preview.reference)) {
          continue;
        }

        seen.add(preview.reference);
        previews.push(preview);
      }
    }

    const result = {
      previews,
      hasMore: raw.length === BROWSE_EVENTS_PAGE_SIZE,
    };
    this.cache.set(cacheKey, result, SEARCH_TTL_MS);
    return result;
  }

  private async resolveTokenId(reference: string): Promise<string> {
    const trimmed = reference.trim();
    if (TOKEN_ID_PATTERN.test(trimmed)) {
      return trimmed;
    }

    if (CONDITION_ID_PATTERN.test(trimmed)) {
      const cacheKey = `condition-token:${trimmed}`;
      const cached = this.cache.get<string>(cacheKey);
      if (cached) {
        return cached;
      }

      const market = await this.fetchMarketByConditionId(trimmed);
      if (!market) {
        throw new MarketAdapterError("SYMBOL_NOT_FOUND", `No token available for reference: ${reference}`);
      }

      const tokenId = parseStringArray(market.clobTokenIds)[0];
      if (!tokenId) {
        throw new MarketAdapterError("SYMBOL_NOT_FOUND", `No token available for reference: ${reference}`);
      }
      return tokenId;
    }

    const cacheKey = `slug-token:${trimmed}`;
    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      return cached;
    }

    const market = await this.fetchMarketBySlug(trimmed);
    if (!market) {
      throw new MarketAdapterError("SYMBOL_NOT_FOUND", `No token available for reference: ${reference}`);
    }

    const tokenId = parseStringArray(market.clobTokenIds)[0];
    if (!tokenId) {
      throw new MarketAdapterError("SYMBOL_NOT_FOUND", `No token available for reference: ${reference}`);
    }

    return tokenId;
  }

  private async resolveConditionId(reference: string): Promise<string> {
    const trimmed = reference.trim();
    if (CONDITION_ID_PATTERN.test(trimmed)) {
      return trimmed;
    }

    if (TOKEN_ID_PATTERN.test(trimmed)) {
      const cacheKey = `token-condition:${trimmed}`;
      const cached = this.cache.get<string>(cacheKey);
      if (cached) {
        return cached;
      }

      const market = await this.fetchMarketByTokenId(trimmed);
      if (!market || typeof market.conditionId !== "string") {
        throw new MarketAdapterError("SYMBOL_NOT_FOUND", `No market available for reference: ${reference}`);
      }
      return market.conditionId;
    }

    const cacheKey = `slug-condition:${trimmed}`;
    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      return cached;
    }

    const market = await this.fetchMarketBySlug(trimmed);
    if (!market || typeof market.conditionId !== "string") {
      throw new MarketAdapterError("SYMBOL_NOT_FOUND", `No market available for reference: ${reference}`);
    }
    return market.conditionId;
  }

  async search(query: string, options?: SearchOptions): Promise<MarketReference[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      return this.browse({ limit: options?.limit, offset: options?.offset });
    }

    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;
    const desiredCount = limit + offset;
    const results: MarketReference[] = [];
    const seen = new Set<string>();
    let hasMore = true;

    for (let page = 1; page <= SEARCH_MAX_PAGES && hasMore && results.length < desiredCount; page += 1) {
      const nextPage = await this.fetchSearchPreviewPage(normalizedQuery, page);
      hasMore = nextPage.hasMore;
      for (const preview of nextPage.previews) {
        if (seen.has(preview.reference)) {
          continue;
        }
        seen.add(preview.reference);
        results.push(preview);
        if (results.length >= desiredCount) {
          break;
        }
      }
    }

    return results.slice(offset, offset + limit);
  }

  async browse(options?: BrowseOptions): Promise<MarketReference[]> {
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;
    const sort = normalizeBrowseSort(options?.sort);
    const desiredCount = limit + offset;
    const collected: MarketReference[] = [];
    const seen = new Set<string>();
    let hasMore = true;

    for (let page = 1; page <= BROWSE_MAX_EVENT_PAGES && hasMore && collected.length < Math.max(desiredCount * 2, 100); page += 1) {
      const nextPage = await this.fetchBrowseEventPage(page);
      hasMore = nextPage.hasMore;
      for (const preview of nextPage.previews) {
        if (seen.has(preview.reference)) {
          continue;
        }
        seen.add(preview.reference);
        collected.push(preview);
      }
    }

    const sorted = [...collected].sort((left, right) => {
      const leftRank = browseSortRank(sort, left);
      const rightRank = browseSortRank(sort, right);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.name.localeCompare(right.name);
    });

    return sorted.slice(offset, offset + limit);
  }

  async normalizeReference(reference: string): Promise<string> {
    return this.resolveTokenId(reference);
  }

  async getTradingConstraints(_reference: string): Promise<TradingConstraints> {
    return POLYMARKET_TRADING_CONSTRAINTS;
  }

  async getQuote(reference: string): Promise<Quote> {
    const normalizedTokenId = await this.resolveTokenId(reference);
    const cacheKey = `quote:${normalizedTokenId}`;
    const cached = this.cache.get<Quote>(cacheKey);
    if (cached) {
      return { ...cached, reference };
    }

    const orderbook = await this.getOrderbook(reference);
    const bestBid = orderbook.bids[0]?.price;
    const bestAsk = orderbook.asks[0]?.price;

    if (typeof bestBid !== "number" && typeof bestAsk !== "number") {
      throw new MarketAdapterError("SYMBOL_NOT_FOUND", `No quote available for reference: ${reference}`);
    }

    const price =
      typeof bestBid === "number" && typeof bestAsk === "number"
        ? (bestBid + bestAsk) / 2
        : (bestBid ?? bestAsk) as number;

    const quote: Quote = {
      reference,
      price: Number(price.toFixed(6)),
      bid: bestBid,
      ask: bestAsk,
      timestamp: orderbook.timestamp,
    };

    this.cache.set(cacheKey, quote, QUOTE_TTL_MS);
    return quote;
  }

  async getOrderbook(reference: string): Promise<Orderbook> {
    const tokenId = await this.resolveTokenId(reference);
    const cacheKey = `book:${tokenId}`;
    const cached = this.cache.get<Orderbook>(cacheKey);
    if (cached) {
      return { ...cached, reference };
    }

    const url = new URL("/book", this.clobBaseUrl);
    url.searchParams.set("token_id", tokenId);

    let raw: unknown;
    try {
      raw = await fetchJson<unknown>(url.toString());
    } catch (error) {
      if (error instanceof MarketAdapterError && error.code === "UPSTREAM_ERROR" && error.message.includes("(404)")) {
        throw new MarketAdapterError("SYMBOL_NOT_FOUND", `No orderbook available for reference: ${reference}`);
      }
      throw error;
    }

    if (typeof raw !== "object" || raw === null) {
      throw new MarketAdapterError("UPSTREAM_ERROR", "Invalid orderbook response from Polymarket CLOB API");
    }

    const book = raw as UnknownObject;
    const orderbook: Orderbook = {
      reference,
      bids: parseOrderbookSide(book.bids).sort((a, b) => b.price - a.price),
      asks: parseOrderbookSide(book.asks).sort((a, b) => a.price - b.price),
      timestamp: new Date().toISOString(),
    };

    this.cache.set(cacheKey, orderbook, ORDERBOOK_TTL_MS);
    return orderbook;
  }

  async resolve(reference: string): Promise<Resolution | null> {
    const cacheKey = `resolve:${reference}`;
    const cached = this.cache.get<Resolution | null>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let conditionId: string;
    try {
      conditionId = await this.resolveConditionId(reference);
    } catch (error) {
      if (error instanceof MarketAdapterError && error.code === "SYMBOL_NOT_FOUND") {
        this.cache.set(cacheKey, null, RESOLVE_TTL_MS);
        return null;
      }
      throw error;
    }

    const market = await this.fetchMarketByConditionId(conditionId);
    if (!market) {
      this.cache.set(cacheKey, null, RESOLVE_TTL_MS);
      return null;
    }

    const resolvedFlag = Boolean(market.resolved);
    if (!resolvedFlag) {
      const unresolved: Resolution = {
        reference,
        resolved: false,
        outcome: null,
        settlementPrice: null,
        timestamp: new Date().toISOString(),
      };
      this.cache.set(cacheKey, unresolved, RESOLVE_TTL_MS);
      return unresolved;
    }

    const resolved: Resolution = {
      reference,
      resolved: true,
      outcome: typeof market.outcome === "string" ? market.outcome : null,
      settlementPrice: parseNumber(market.settlementPrice),
      timestamp: new Date().toISOString(),
    };
    this.cache.set(cacheKey, resolved, RESOLVE_TTL_MS);
    return resolved;
  }

  async resolveSymbolNames(symbols: Iterable<string>): Promise<SymbolResolution> {
    const names = new Map<string, string>();
    const outcomes = new Map<string, string>();
    const conditionIds: string[] = [];
    const tokenIds: string[] = [];

    for (const symbol of symbols) {
      if (CONDITION_ID_PATTERN.test(symbol)) {
        conditionIds.push(symbol);
      } else {
        tokenIds.push(symbol);
      }
    }

    if (conditionIds.length === 0 && tokenIds.length === 0) return { names, outcomes };

    const processMarket = (market: UnknownObject) => {
      this.cacheMarketSymbolMappings(market);
      const question = typeof market.question === "string" ? market.question : null;
      const condId = typeof market.conditionId === "string" ? market.conditionId : null;

      if (condId && question) names.set(condId, question);

      const tokens = Array.isArray(market.tokens) ? market.tokens : [];
      for (const token of tokens) {
        if (typeof token !== "object" || token === null || !question) continue;
        const rec = token as UnknownObject;
        const tid = typeof rec.token_id === "string" ? rec.token_id : null;
        const out = typeof rec.outcome === "string" ? rec.outcome : null;
        if (!tid) continue;
        names.set(tid, question);
        if (out) outcomes.set(tid, out);
      }

      if (question) {
        const tids = parseStringArray(market.clobTokenIds);
        const outs = parseStringArray(market.outcomes);
        for (let i = 0; i < tids.length; i++) {
          const tid = tids[i];
          if (!tid) continue;
          if (!names.has(tid)) names.set(tid, question);
          if (!outcomes.has(tid) && outs[i]) outcomes.set(tid, outs[i]!);
        }
      }
    };

    const fetchBatch = async (queryKey: string, batch: string[]) => {
      for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        const chunk = batch.slice(i, i + BATCH_SIZE);
        for (let j = 0; j < chunk.length; j += RESOLVE_NAMES_CONCURRENCY) {
          const window = chunk.slice(j, j + RESOLVE_NAMES_CONCURRENCY);
          const settled = await Promise.allSettled(
            window.map(async (symbol) => {
              const url = new URL("/markets", this.gammaBaseUrl);
              url.searchParams.set(queryKey, symbol);
              url.searchParams.set("limit", "1");
              return fetchJson<unknown>(url.toString());
            }),
          );

          for (const result of settled) {
            if (result.status !== "fulfilled") continue;
            if (!Array.isArray(result.value)) continue;
            for (const market of result.value) {
              if (typeof market === "object" && market !== null) processMarket(market as UnknownObject);
            }
          }
        }
      }
    };

    try {
      if (conditionIds.length > 0) await fetchBatch("conditionId", conditionIds);
      if (tokenIds.length > 0) await fetchBatch("clob_token_ids", tokenIds);
    } catch {
      // Non-critical
    }

    return { names, outcomes };
  }
}
