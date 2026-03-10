import { browseMarketQuerySchema, multiQuoteQuerySchema, priceHistoryQuerySchema, quoteQuerySchema, searchMarketQuerySchema } from "@unimarket/core";
import { MarketAdapterError, type MarketRegistry, type TradingConstraints } from "@unimarket/markets";
import { Hono } from "hono";

import type { AppVariables } from "../platform/auth.js";
import { jsonError } from "../platform/errors.js";
import { parseQuery, withErrorHandling } from "../platform/helpers.js";

export const createMarketRoutes = (registry: MarketRegistry) => {
  const router = new Hono<{ Variables: AppVariables }>();
  const defaultTradingConstraints: TradingConstraints = {
    minQuantity: 1,
    quantityStep: 1,
    supportsFractional: false,
    maxLeverage: null,
  };

  const toBatchError = (error: unknown): { code: string; message: string } => {
    if (error instanceof MarketAdapterError) {
      return { code: error.code, message: error.message };
    }
    if (error instanceof Error) {
      return { code: "INTERNAL_ERROR", message: error.message };
    }
    return { code: "INTERNAL_ERROR", message: "Unknown server error" };
  };

  const roundMetric = (value: number): number => Number(value.toFixed(12));

  const enrichQuote = <TQuote extends { price: number; bid?: number; ask?: number }>(quote: TQuote) => {
    const bid = quote.bid;
    const ask = quote.ask;
    const hasBid = typeof bid === "number" && Number.isFinite(bid);
    const hasAsk = typeof ask === "number" && Number.isFinite(ask);
    const mid = roundMetric(hasBid && hasAsk ? (bid + ask) / 2 : quote.price);
    const spreadAbs = hasBid && hasAsk ? roundMetric(ask - bid) : null;
    const spreadBps = spreadAbs !== null && mid > 0 ? roundMetric((spreadAbs / mid) * 10_000) : null;

    return {
      ...quote,
      mid,
      spreadAbs,
      spreadBps,
    };
  };

  const validateSort = (sort: string | undefined, options: ReadonlyArray<{ value: string }>): string | null => {
    if (!sort) return null;
    if (options.some((option) => option.value === sort)) return null;
    const supported = options.map((option) => option.value).join(", ");
    return supported.length > 0
      ? `Unsupported sort '${sort}'. Supported values: ${supported}`
      : `Sort is not supported for this market`;
  };

  const toDiscoveryPage = <T>(results: T[], limit: number) => ({
    results: results.slice(0, limit),
    hasMore: results.length > limit,
  });

  router.get(
    "/",
    withErrorHandling(async (c) => {
      return c.json({ markets: registry.list() });
    }),
  );

  router.get(
    "/:market/search",
    withErrorHandling(async (c) => {
      const parsed = parseQuery(c, searchMarketQuerySchema);
      if (!parsed.success) return parsed.response;

      const adapter = registry.get(c.req.param("market"));
      if (!adapter) return jsonError(c, 404, "MARKET_NOT_FOUND", "Market not found");
      if (!adapter.capabilities.includes("search")) {
        return jsonError(c, 400, "CAPABILITY_NOT_SUPPORTED", "search is not supported for this market");
      }
      const sortError = validateSort(parsed.data.sort, adapter.searchSortOptions ?? []);
      if (sortError) return jsonError(c, 400, "INVALID_INPUT", sortError);

      const results = await adapter.search(parsed.data.q, {
        sort: parsed.data.sort,
        limit: parsed.data.limit + 1,
        offset: parsed.data.offset,
      });
      return c.json(toDiscoveryPage(results, parsed.data.limit));
    }),
  );

  router.get(
    "/:market/browse",
    withErrorHandling(async (c) => {
      const parsed = parseQuery(c, browseMarketQuerySchema);
      if (!parsed.success) return parsed.response;

      const adapter = registry.get(c.req.param("market"));
      if (!adapter) return jsonError(c, 404, "MARKET_NOT_FOUND", "Market not found");
      if (!adapter.capabilities.includes("browse") || typeof adapter.browse !== "function") {
        return jsonError(c, 400, "CAPABILITY_NOT_SUPPORTED", "browse is not supported for this market");
      }
      const sortError = validateSort(parsed.data.sort, adapter.browseOptions ?? []);
      if (sortError) return jsonError(c, 400, "INVALID_INPUT", sortError);

      const results = await adapter.browse({
        sort: parsed.data.sort,
        limit: parsed.data.limit + 1,
        offset: parsed.data.offset,
      });
      return c.json(toDiscoveryPage(results, parsed.data.limit));
    }),
  );

  router.get(
    "/:market/trading-constraints",
    withErrorHandling(async (c) => {
      const parsed = parseQuery(c, quoteQuerySchema);
      if (!parsed.success) return parsed.response;

      const adapter = registry.get(c.req.param("market"));
      if (!adapter) return jsonError(c, 404, "MARKET_NOT_FOUND", "Market not found");

      const constraints =
        typeof adapter.getTradingConstraints === "function"
          ? await adapter.getTradingConstraints(parsed.data.reference)
          : defaultTradingConstraints;
      return c.json({
        reference: parsed.data.reference,
        constraints: {
          minQuantity: constraints.minQuantity,
          quantityStep: constraints.quantityStep,
          supportsFractional: constraints.supportsFractional,
          maxLeverage: constraints.maxLeverage ?? null,
        },
      });
    }),
  );

  router.get(
    "/:market/quote",
    withErrorHandling(async (c) => {
      const parsed = parseQuery(c, quoteQuerySchema);
      if (!parsed.success) return parsed.response;

      const adapter = registry.get(c.req.param("market"));
      if (!adapter) return jsonError(c, 404, "MARKET_NOT_FOUND", "Market not found");
      if (!adapter.capabilities.includes("quote")) {
        return jsonError(c, 400, "CAPABILITY_NOT_SUPPORTED", "quote is not supported for this market");
      }

      const quote = await adapter.getQuote(parsed.data.reference);
      return c.json(enrichQuote(quote));
    }),
  );

  router.get(
    "/:market/quotes",
    withErrorHandling(async (c) => {
      const parsed = parseQuery(c, multiQuoteQuerySchema);
      if (!parsed.success) return parsed.response;

      const adapter = registry.get(c.req.param("market"));
      if (!adapter) return jsonError(c, 404, "MARKET_NOT_FOUND", "Market not found");
      if (!adapter.capabilities.includes("quote")) {
        return jsonError(c, 400, "CAPABILITY_NOT_SUPPORTED", "quote is not supported for this market");
      }

      const settled = await Promise.allSettled(parsed.data.references.map(async (reference) => adapter.getQuote(reference)));
      const quotes: unknown[] = [];
      const errors: Array<{ reference: string; error: { code: string; message: string } }> = [];

      for (let i = 0; i < settled.length; i += 1) {
        const reference = parsed.data.references[i];
        const result = settled[i];
        if (!reference || !result) continue;

        if (result.status === "fulfilled") {
          quotes.push(enrichQuote(result.value));
          continue;
        }

        errors.push({ reference, error: toBatchError(result.reason) });
      }

      return c.json({ quotes, errors });
    }),
  );

  router.get(
    "/:market/orderbook",
    withErrorHandling(async (c) => {
      const parsed = parseQuery(c, quoteQuerySchema);
      if (!parsed.success) return parsed.response;

      const adapter = registry.get(c.req.param("market"));
      if (!adapter) return jsonError(c, 404, "MARKET_NOT_FOUND", "Market not found");
      if (!adapter.capabilities.includes("orderbook") || typeof adapter.getOrderbook !== "function") {
        return jsonError(c, 400, "CAPABILITY_NOT_SUPPORTED", "orderbook is not supported for this market");
      }

      const orderbook = await adapter.getOrderbook(parsed.data.reference);
      return c.json(orderbook);
    }),
  );

  router.get(
    "/:market/orderbooks",
    withErrorHandling(async (c) => {
      const parsed = parseQuery(c, multiQuoteQuerySchema);
      if (!parsed.success) return parsed.response;

      const adapter = registry.get(c.req.param("market"));
      if (!adapter) return jsonError(c, 404, "MARKET_NOT_FOUND", "Market not found");
      if (!adapter.capabilities.includes("orderbook") || typeof adapter.getOrderbook !== "function") {
        return jsonError(c, 400, "CAPABILITY_NOT_SUPPORTED", "orderbook is not supported for this market");
      }

      const settled = await Promise.allSettled(parsed.data.references.map(async (reference) => adapter.getOrderbook!(reference)));
      const orderbooks: unknown[] = [];
      const errors: Array<{ reference: string; error: { code: string; message: string } }> = [];

      for (let i = 0; i < settled.length; i += 1) {
        const reference = parsed.data.references[i];
        const result = settled[i];
        if (!reference || !result) continue;

        if (result.status === "fulfilled") {
          orderbooks.push(result.value);
          continue;
        }

        errors.push({ reference, error: toBatchError(result.reason) });
      }

      return c.json({ orderbooks, errors });
    }),
  );

  router.get(
    "/:market/funding",
    withErrorHandling(async (c) => {
      const parsed = parseQuery(c, quoteQuerySchema);
      if (!parsed.success) return parsed.response;

      const adapter = registry.get(c.req.param("market"));
      if (!adapter) return jsonError(c, 404, "MARKET_NOT_FOUND", "Market not found");
      if (!adapter.capabilities.includes("funding") || typeof adapter.getFundingRate !== "function") {
        return jsonError(c, 400, "CAPABILITY_NOT_SUPPORTED", "funding is not supported for this market");
      }

      const funding = await adapter.getFundingRate(parsed.data.reference);
      return c.json(funding);
    }),
  );

  router.get(
    "/:market/fundings",
    withErrorHandling(async (c) => {
      const parsed = parseQuery(c, multiQuoteQuerySchema);
      if (!parsed.success) return parsed.response;

      const adapter = registry.get(c.req.param("market"));
      if (!adapter) return jsonError(c, 404, "MARKET_NOT_FOUND", "Market not found");
      if (!adapter.capabilities.includes("funding") || typeof adapter.getFundingRate !== "function") {
        return jsonError(c, 400, "CAPABILITY_NOT_SUPPORTED", "funding is not supported for this market");
      }

      const settled = await Promise.allSettled(parsed.data.references.map(async (reference) => adapter.getFundingRate!(reference)));
      const fundings: unknown[] = [];
      const errors: Array<{ reference: string; error: { code: string; message: string } }> = [];

      for (let i = 0; i < settled.length; i += 1) {
        const reference = parsed.data.references[i];
        const result = settled[i];
        if (!reference || !result) continue;

        if (result.status === "fulfilled") {
          fundings.push(result.value);
          continue;
        }

        errors.push({ reference, error: toBatchError(result.reason) });
      }

      return c.json({ fundings, errors });
    }),
  );

  router.get(
    "/:market/price-history",
    withErrorHandling(async (c) => {
      const parsed = parseQuery(c, priceHistoryQuerySchema);
      if (!parsed.success) return parsed.response;

      const adapter = registry.get(c.req.param("market"));
      if (!adapter) return jsonError(c, 404, "MARKET_NOT_FOUND", "Market not found");
      if (!adapter.capabilities.includes("priceHistory") || typeof adapter.getPriceHistory !== "function") {
        return jsonError(c, 400, "CAPABILITY_NOT_SUPPORTED", "priceHistory is not supported for this market");
      }

      const history = await adapter.getPriceHistory(parsed.data.reference, {
        interval: parsed.data.interval,
        lookback: parsed.data.lookback,
        asOf: parsed.data.asOf,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
      });
      return c.json(history);
    }),
  );

  router.get(
    "/:market/resolve",
    withErrorHandling(async (c) => {
      const parsed = parseQuery(c, quoteQuerySchema);
      if (!parsed.success) return parsed.response;

      const adapter = registry.get(c.req.param("market"));
      if (!adapter) return jsonError(c, 404, "MARKET_NOT_FOUND", "Market not found");
      if (!adapter.capabilities.includes("resolve") || typeof adapter.resolve !== "function") {
        return jsonError(c, 400, "CAPABILITY_NOT_SUPPORTED", "resolve is not supported for this market");
      }

      const resolution = await adapter.resolve(parsed.data.reference);
      return c.json(resolution ?? { reference: parsed.data.reference, resolved: false, outcome: null, settlementPrice: null });
    }),
  );

  return router;
};
