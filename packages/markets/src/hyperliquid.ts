import { TtlCache } from "./cache.js";
import {
    MarketAdapterError,
    type BrowseOption,
    type BrowseOptions,
    type FundingRate,
    type MarketAdapter,
    type MarketReference,
    type Orderbook,
    type OrderbookLevel,
    type Quote,
    type SearchOptions,
    type TradingConstraints,
} from "./types.js";

const QUOTE_TTL_MS = 5_000;
const ORDERBOOK_TTL_MS = 5_000;
const META_TTL_MS = 300_000;
const FUNDING_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_BROWSE_CACHE_TTL_MS = 300_000;
const HYPERLIQUID_BROWSE_OPTIONS: readonly BrowseOption[] = [
    { value: "price", label: "Price" },
];

const DEFAULT_API_URL = "https://api.hyperliquid.xyz/info";

type UnknownObject = Record<string, unknown>;

const parseNumber = (value: unknown): number | null => {
    if (typeof value === "number" && !Number.isNaN(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
};

const postInfo = async <T>(apiUrl: string, body: Record<string, unknown>, timeoutMs: number): Promise<T> => {
    let response: Response;
    try {
        response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") {
            throw new MarketAdapterError("UPSTREAM_TIMEOUT", `Hyperliquid API timeout (${timeoutMs}ms): ${String(body.type ?? "info")}`);
        }
        const message = error instanceof Error ? error.message : "Unknown fetch error";
        throw new MarketAdapterError("UPSTREAM_ERROR", `Hyperliquid API request failed: ${message}`);
    }

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new MarketAdapterError("UPSTREAM_ERROR", `Hyperliquid API error (${response.status}): ${text}`);
    }

    return (await response.json()) as T;
};

export type HyperliquidAdapterOptions = {
    apiUrl?: string;
    requestTimeoutMs?: number;
    browseCacheTtlMs?: number;
};

type MetaUniverse = {
    name: string;
    szDecimals: number;
    maxLeverage: number;
    isDelisted?: boolean;
};

type MetaResponse = {
    universe: MetaUniverse[];
};

type L2BookResponse = {
    levels: Array<Array<{ px: string; sz: string; n: number }>>;
};

type PredictedFundingEntry = {
    coin?: string;
    fundingRate: string | number;
    nextFundingTime: number | string;
};

type CurrentFundingParseResult = {
    matchedCoin: boolean;
    entry: PredictedFundingEntry | null;
};

const parseEpochMs = (value: unknown): number | null => {
    const numeric = parseNumber(value);
    if (numeric === null || !Number.isFinite(numeric)) return null;
    const ms = numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
    return Math.trunc(ms);
};

const isHyperliquidVenue = (value: unknown): boolean => {
    if (typeof value !== "string") return false;
    const venue = value.toLowerCase();
    return venue === "hlperp" || venue === "hyperliquid";
};

const asFundingEntry = (value: unknown): PredictedFundingEntry | null => {
    if (typeof value !== "object" || value === null) return null;
    return value as PredictedFundingEntry;
};

const parseCurrentShapeFundingEntry = (data: unknown[], normalizedSymbol: string): CurrentFundingParseResult => {
    for (const item of data) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const coin = item[0];
        const venues = item[1];
        if (typeof coin !== "string" || coin !== normalizedSymbol || !Array.isArray(venues)) continue;

        let fallback: PredictedFundingEntry | null = null;
        for (const venueItem of venues) {
            if (!Array.isArray(venueItem) || venueItem.length < 2) continue;
            const venue = venueItem[0];
            const info = asFundingEntry(venueItem[1]);
            if (!info) continue;
            if (fallback === null) fallback = info;
            if (isHyperliquidVenue(venue)) {
                return { matchedCoin: true, entry: info };
            }
        }
        return { matchedCoin: true, entry: fallback };
    }

    return { matchedCoin: false, entry: null };
};

const parseLegacyShapeFundingEntry = (data: unknown[], normalizedSymbol: string): PredictedFundingEntry | null => {
    for (const item of data) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const venue = item[0];
        const info = asFundingEntry(item[1]);
        if (!info) continue;
        if (info.coin !== normalizedSymbol) continue;
        if (!isHyperliquidVenue(venue)) continue;
        return info;
    }
    return null;
};

export class HyperliquidAdapter implements MarketAdapter {
    readonly marketId = "hyperliquid";
    readonly displayName = "Hyperliquid";
    readonly description = "Crypto perpetual futures — no expiry, funding rate every hour";
    readonly referenceFormat = "Ticker (e.g. BTC, ETH, SOL)";
    readonly priceRange: [number, number] | null = null;
    readonly capabilities = ["search", "browse", "quote", "orderbook", "funding"] as const;
    readonly browseOptions = HYPERLIQUID_BROWSE_OPTIONS;

    private readonly apiUrl: string;
    private readonly cache = new TtlCache();
    private readonly requestTimeoutMs: number;
    private readonly browseCacheTtlMs: number;

    constructor(options: HyperliquidAdapterOptions = {}) {
        this.apiUrl = options.apiUrl ?? DEFAULT_API_URL;
        this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
        this.browseCacheTtlMs = options.browseCacheTtlMs ?? DEFAULT_BROWSE_CACHE_TTL_MS;
    }

    private buildTradingConstraints(asset: MetaUniverse): TradingConstraints {
        const decimals = Math.max(0, Math.trunc(asset.szDecimals));
        const quantityStep = decimals === 0 ? 1 : Number((10 ** -decimals).toFixed(decimals));
        return {
            minQuantity: quantityStep,
            quantityStep,
            supportsFractional: decimals > 0,
            maxLeverage: asset.maxLeverage,
        };
    }

    private async findMetaBySymbol(symbol: string): Promise<MetaUniverse> {
        const candidate = symbol.trim().replace(/[-_\s]*perp$/i, "").toUpperCase();
        const universe = await this.getMeta();
        const matched = universe.find((asset) => asset.name.toUpperCase() === candidate);
        if (!matched) {
            throw new MarketAdapterError("SYMBOL_NOT_FOUND", `Unknown Hyperliquid symbol: ${symbol}`);
        }
        return matched;
    }

    private async getMeta(): Promise<MetaUniverse[]> {
        return this.cache.remember("meta", {
            ttlMs: META_TTL_MS,
            load: async () => {
                const data = await postInfo<MetaResponse>(this.apiUrl, { type: "meta" }, this.requestTimeoutMs);

                if (!data || !Array.isArray(data.universe)) {
                    throw new MarketAdapterError("UPSTREAM_ERROR", "Invalid meta response from Hyperliquid");
                }

                return data.universe;
            },
        });
    }

    private async getL2Book(symbol: string): Promise<L2BookResponse> {
        const cacheKey = `l2:${symbol}`;
        return this.cache.remember(cacheKey, {
            ttlMs: ORDERBOOK_TTL_MS,
            load: async () => {
                const data = await postInfo<L2BookResponse>(this.apiUrl, {
                    type: "l2Book",
                    coin: symbol,
                }, this.requestTimeoutMs);

                if (!data || !Array.isArray(data.levels)) {
                    throw new MarketAdapterError("UPSTREAM_ERROR", "Invalid l2Book response from Hyperliquid");
                }

                return data;
            },
        });
    }

    async normalizeReference(reference: string): Promise<string> {
        const raw = reference.trim();
        if (raw.length === 0) {
            throw new MarketAdapterError("SYMBOL_NOT_FOUND", "Reference is required");
        }
        const matched = await this.findMetaBySymbol(raw);
        return matched.name;
    }

    async getTradingConstraints(reference: string): Promise<TradingConstraints> {
        const matched = await this.findMetaBySymbol(reference);
        return this.buildTradingConstraints(matched);
    }

    private async listReferences({ query, sort }: { query?: string; sort: string }): Promise<{
        results: MarketReference[];
        midsAvailable: boolean;
    }> {
        const universe = await this.getMeta();
        const lowerQuery = query?.toLowerCase().trim() ?? "";
        const listed = universe.filter((asset) => !asset.isDelisted);

        const filtered = lowerQuery
            ? listed.filter((asset) => asset.name.toLowerCase().includes(lowerQuery))
            : listed;

        // Fetch mid prices for the page to include current price
        let midPrices: Record<string, string> = {};
        let midsAvailable = false;
        try {
            midPrices = await this.getAllMids();
            midsAvailable = true;
        } catch {
            // mid prices are optional enrichment; proceed without them
        }

        const sorted = filtered.map((asset, index) => ({ asset, index }));
        if (!lowerQuery && sort === "price") {
            sorted.sort((left, right) => {
                const leftPrice = parseNumber(midPrices[left.asset.name]);
                const rightPrice = parseNumber(midPrices[right.asset.name]);
                if (leftPrice !== null && rightPrice !== null && leftPrice !== rightPrice) {
                    return rightPrice - leftPrice;
                }
                return left.index - right.index;
            });
        } else {
            sorted.sort((left, right) => left.asset.name.localeCompare(right.asset.name));
        }

        const toReference = (asset: MetaUniverse): MarketReference => ({
            reference: asset.name,
            name: `${asset.name}-PERP`,
            price: parseNumber(midPrices[asset.name]) ?? undefined,
            metadata: {
                szDecimals: asset.szDecimals,
                maxLeverage: asset.maxLeverage,
                ...this.buildTradingConstraints(asset),
            },
        });

        return {
            results: sorted.map((entry) => toReference(entry.asset)),
            midsAvailable,
        };
    }

    private async buildReferences(
        {
            query,
            sort,
            limit = 20,
            offset = 0,
        }: {
            query?: string;
            sort?: string;
            limit?: number;
            offset?: number;
        },
    ): Promise<MarketReference[]> {
        const isBrowse = !query || query.trim().length === 0;
        const normalizedSort = sort ?? "price";

        if (isBrowse) {
            const cacheKey = `browse-result:${normalizedSort}`;
            // Browse cache is only valid when mids are available. Without mids we
            // intentionally fall back to universe order and omit prices, so that
            // degraded snapshot must not be reused across later browse requests.
            let cacheable = true;
            const fullResults = await this.cache.remember(cacheKey, {
                ttlMs: this.browseCacheTtlMs,
                load: async () => {
                    const { results, midsAvailable } = await this.listReferences({ sort: normalizedSort });
                    cacheable = midsAvailable;
                    return results;
                },
                shouldCache: () => cacheable,
            });
            return fullResults.slice(offset, offset + limit);
        }

        const { results } = await this.listReferences({ query, sort: normalizedSort });
        return results.slice(offset, offset + limit);
    }

    async search(query: string, options?: SearchOptions): Promise<MarketReference[]> {
        return this.buildReferences({
            query,
            limit: options?.limit,
            offset: options?.offset,
        });
    }

    async browse(options?: BrowseOptions): Promise<MarketReference[]> {
        return this.buildReferences({
            sort: options?.sort,
            limit: options?.limit,
            offset: options?.offset,
        });
    }

    private async getAllMids(): Promise<Record<string, string>> {
        return this.cache.remember("allMids", {
            ttlMs: QUOTE_TTL_MS,
            load: () => postInfo<Record<string, string>>(this.apiUrl, { type: "allMids" }, this.requestTimeoutMs),
        });
    }

    private async getPredictedFundings(): Promise<unknown[]> {
        return this.cache.remember("predictedFundings", {
            ttlMs: FUNDING_TTL_MS,
            load: async () => {
                const data = await postInfo<unknown>(this.apiUrl, {
                    type: "predictedFundings",
                }, this.requestTimeoutMs);

                if (!Array.isArray(data)) {
                    throw new MarketAdapterError("UPSTREAM_ERROR", "Invalid predictedFundings response from Hyperliquid");
                }

                return data;
            },
        });
    }

    async getQuote(reference: string): Promise<Quote> {
        const normalizedSymbol = await this.normalizeReference(reference);
        const cacheKey = `quote:${normalizedSymbol}`;
        const cached = this.cache.get<Quote>(cacheKey);
        if (cached) return cached;

        const book = await this.getL2Book(normalizedSymbol);
        const bids = book.levels[0] ?? [];
        const asks = book.levels[1] ?? [];

        const bestBid = bids.length > 0 ? parseNumber(bids[0].px) : null;
        const bestAsk = asks.length > 0 ? parseNumber(asks[0].px) : null;

        if (bestBid === null && bestAsk === null) {
            throw new MarketAdapterError("SYMBOL_NOT_FOUND", `No order book data for ${normalizedSymbol}`);
        }

        const mid =
            bestBid !== null && bestAsk !== null
                ? (bestBid + bestAsk) / 2
                : (bestBid ?? bestAsk)!;

        const quote: Quote = {
            reference,
            price: Number(mid.toFixed(6)),
            bid: bestBid ?? undefined,
            ask: bestAsk ?? undefined,
            timestamp: new Date().toISOString(),
        };

        this.cache.set(cacheKey, quote, QUOTE_TTL_MS);
        return quote;
    }

    async getOrderbook(reference: string): Promise<Orderbook> {
        const normalizedSymbol = await this.normalizeReference(reference);
        const cacheKey = `ob:${normalizedSymbol}`;
        const cached = this.cache.get<Orderbook>(cacheKey);
        if (cached) return cached;

        const book = await this.getL2Book(normalizedSymbol);
        const rawBids = book.levels[0] ?? [];
        const rawAsks = book.levels[1] ?? [];

        const parseLevels = (levels: Array<{ px: string; sz: string }>): OrderbookLevel[] =>
            levels
                .map((level) => {
                    const price = parseNumber(level.px);
                    const size = parseNumber(level.sz);
                    if (price === null || size === null) return null;
                    return { price, size };
                })
                .filter((level): level is OrderbookLevel => level !== null);

        const bids = parseLevels(rawBids).sort((a, b) => b.price - a.price);
        const asks = parseLevels(rawAsks).sort((a, b) => a.price - b.price);

        const orderbook: Orderbook = {
            reference,
            bids,
            asks,
            timestamp: new Date().toISOString(),
        };

        this.cache.set(cacheKey, orderbook, ORDERBOOK_TTL_MS);
        return orderbook;
    }

    async getFundingRate(reference: string): Promise<FundingRate> {
        const normalizedSymbol = await this.normalizeReference(reference);
        const cacheKey = `funding:${normalizedSymbol}`;
        const cached = this.cache.get<FundingRate>(cacheKey);
        if (cached) return cached;

        const data = await this.getPredictedFundings();

        const currentShape = parseCurrentShapeFundingEntry(data, normalizedSymbol);
        const entry =
            currentShape.entry ??
            (currentShape.matchedCoin ? null : parseLegacyShapeFundingEntry(data, normalizedSymbol));

        if (!entry) {
            throw new MarketAdapterError("SYMBOL_NOT_FOUND", `No funding rate data for ${normalizedSymbol}`);
        }

        const rate = parseNumber(entry.fundingRate);
        if (rate === null) {
            throw new MarketAdapterError("UPSTREAM_ERROR", `Invalid funding rate for ${normalizedSymbol}`);
        }

        const nextFundingTimeMs = parseEpochMs(entry.nextFundingTime);
        if (nextFundingTimeMs === null) {
            throw new MarketAdapterError("UPSTREAM_ERROR", `Invalid next funding timestamp for ${normalizedSymbol}`);
        }

        const fundingRate: FundingRate = {
            reference,
            rate,
            nextFundingAt: new Date(nextFundingTimeMs).toISOString(),
            timestamp: new Date().toISOString(),
        };

        this.cache.set(cacheKey, fundingRate, FUNDING_TTL_MS);
        return fundingRate;
    }
}
