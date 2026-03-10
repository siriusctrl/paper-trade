import { afterEach, describe, expect, it, vi } from "vitest";

import { PolymarketAdapter } from "../src/polymarket.js";
import { MarketAdapterError } from "../src/types.js";

const jsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

const makeAdapter = () =>
  new PolymarketAdapter({
    gammaBaseUrl: "https://gamma.example",
    clobBaseUrl: "https://clob.example",
  });

describe("PolymarketAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("searches preview references through search-v2 and caches results", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/search-v2")) {
        return jsonResponse({
          events: [
            {
              title: "Iran event",
              markets: [
                {
                  slug: "iran-hormuz",
                  question: "Will Iran close the Strait of Hormuz?",
                  conditionId: `0x${"a".repeat(64)}`,
                  lastTradePrice: "0.57",
                },
              ],
            },
          ],
          pagination: { hasMore: false },
        });
      }
      if (url === "https://gamma.example/markets?slug=iran-hormuz&limit=1") {
        return jsonResponse([
          {
            slug: "iran-hormuz",
            question: "Will Iran close the Strait of Hormuz?",
            conditionId: `0x${"a".repeat(64)}`,
            lastTradePrice: "0.57",
            volume24hr: "12345",
            liquidity: "54321",
            endDate: "2026-03-12T00:00:00.000Z",
            createdAt: "2026-03-01T00:00:00.000Z",
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const first = await adapter.search("iran");
    const second = await adapter.search("iran");

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      reference: "iran-hormuz",
      name: "Will Iran close the Strait of Hormuz?",
      price: 0.57,
      volume: 12345,
      liquidity: 54321,
      endDate: "2026-03-12T00:00:00.000Z",
      metadata: {
        conditionId: `0x${"a".repeat(64)}`,
        outcomes: [],
        outcomePrices: [],
        defaultOutcome: null,
        eventTitle: "Iran event",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    });
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("browses active markets from events and sorts them locally", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/events")) {
        return jsonResponse([
          {
            title: "Macro",
            liquidity: "8000",
            endDate: "2026-03-10T00:00:00.000Z",
            createdAt: "2026-03-01T00:00:00.000Z",
            markets: [
              { slug: "fed-cut", question: "Will the Fed cut in March?", volume24hr: "2000", lastTradePrice: "0.41" },
              { slug: "jobs-hot", question: "Will payrolls beat expectations?", volume24hr: "5000", lastTradePrice: "0.62" },
            ],
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const results = await adapter.browse?.({ sort: "volume", limit: 10, offset: 0 });

    expect(results?.map((row) => row.reference)).toEqual(["jobs-hot", "fed-cut"]);
  });

  it("filters out closed or archived discovery results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/events")) {
        return jsonResponse([
          {
            title: "Mixed event",
            liquidity: "8000",
            markets: [
              { slug: "closed-market", question: "Closed market", active: true, closed: true, archived: false, volume24hr: "9000" },
              { slug: "archived-market", question: "Archived market", active: true, closed: false, archived: true, volume24hr: "8000" },
              { slug: "live-market", question: "Live market", active: true, closed: false, archived: false, volume24hr: "7000" },
            ],
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const results = await adapter.browse?.({ sort: "volume", limit: 10, offset: 0 });

    expect(results).toMatchObject([{ reference: "live-market", name: "Live market" }]);
  });

  it("normalizes slug, condition id, and token id references to token ids", async () => {
    const conditionId = `0x${"b".repeat(64)}`;
    const tokenId = "123456789";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=iran-hormuz&limit=1") {
        return jsonResponse([{ slug: "iran-hormuz", conditionId, clobTokenIds: JSON.stringify([tokenId, "987"]) }]);
      }
      if (url === `https://gamma.example/markets?conditionId=${conditionId}&limit=1`) {
        return jsonResponse([{ slug: "iran-hormuz", conditionId, clobTokenIds: JSON.stringify([tokenId, "987"]) }]);
      }
      if (url === `https://gamma.example/markets?clob_token_ids=${tokenId}&limit=1`) {
        return jsonResponse([{ slug: "iran-hormuz", conditionId, clobTokenIds: JSON.stringify([tokenId, "987"]) }]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    await expect(adapter.normalizeReference("iran-hormuz")).resolves.toBe(tokenId);
    await expect(adapter.normalizeReference(conditionId)).resolves.toBe(tokenId);
    await expect(adapter.normalizeReference(tokenId)).resolves.toBe(tokenId);
    await expect(adapter.resolve(tokenId)).resolves.toMatchObject({ reference: tokenId, resolved: false });
  });

  it("parses orderbook and quote using slug references", async () => {
    const conditionId = `0x${"c".repeat(64)}`;
    const tokenId = "555";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=iran-hormuz&limit=1") {
        return jsonResponse([{ slug: "iran-hormuz", conditionId, clobTokenIds: JSON.stringify([tokenId]) }]);
      }
      if (url === `https://clob.example/book?token_id=${tokenId}`) {
        return jsonResponse({
          bids: [["0.45", "12"], ["0.44", "10"]],
          asks: [["0.55", "15"], ["0.56", "18"]],
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const quote = await adapter.getQuote("iran-hormuz");
    const book = await adapter.getOrderbook("iran-hormuz");

    expect(quote).toMatchObject({ reference: "iran-hormuz", bid: 0.45, ask: 0.55, price: 0.5 });
    expect(book.reference).toBe("iran-hormuz");
    expect(book.bids.map((level) => level.price)).toEqual([0.45, 0.44]);
    expect(book.asks.map((level) => level.price)).toEqual([0.55, 0.56]);
  });

  it("maps orderbook 404s to SYMBOL_NOT_FOUND after reference resolution", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=missing-book&limit=1") {
        return jsonResponse([{ slug: "missing-book", conditionId: `0x${"d".repeat(64)}`, clobTokenIds: JSON.stringify(["777"]) }]);
      }
      if (url === "https://clob.example/book?token_id=777") {
        return jsonResponse({ error: "not found" }, 404);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    await expect(adapter.getQuote("missing-book")).rejects.toMatchObject<Partial<MarketAdapterError>>({
      code: "SYMBOL_NOT_FOUND",
    });
  });

  it("returns resolved payloads using the original reference", async () => {
    const conditionId = `0x${"1".repeat(64)}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === `https://gamma.example/markets?conditionId=${conditionId}&limit=1`) {
        return jsonResponse([
          {
            slug: "resolved-market",
            conditionId,
            clobTokenIds: JSON.stringify(["999"]),
            resolved: true,
            outcome: "YES",
            settlementPrice: "1",
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const resolution = await adapter.resolve(conditionId);

    expect(resolution).toMatchObject({ reference: conditionId, resolved: true, outcome: "YES", settlementPrice: 1 });
  });

  it("resolves names and outcomes for token ids", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?clob_token_ids=123&limit=1") {
        return jsonResponse([
          {
            question: "Will Iran close the Strait of Hormuz?",
            conditionId: `0x${"e".repeat(64)}`,
            clobTokenIds: JSON.stringify(["123", "456"]),
            outcomes: JSON.stringify(["Yes", "No"]),
          },
        ]);
      }
      if (url === "https://gamma.example/markets?clob_token_ids=456&limit=1") {
        return jsonResponse([
          {
            question: "Will Iran close the Strait of Hormuz?",
            conditionId: `0x${"e".repeat(64)}`,
            clobTokenIds: JSON.stringify(["123", "456"]),
            outcomes: JSON.stringify(["Yes", "No"]),
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const resolution = await adapter.resolveSymbolNames(["123", "456"]);

    expect(resolution.names.get("123")).toBe("Will Iran close the Strait of Hormuz?");
    expect(resolution.outcomes.get("123")).toBe("Yes");
    expect(resolution.outcomes.get("456")).toBe("No");
  });

  it("falls back to browse for blank searches and supports alternate browse sorts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/events")) {
        return jsonResponse([
          {
            title: "Macro",
            liquidity: "9000",
            endDate: "2026-03-11T00:00:00.000Z",
            createdAt: "2026-03-01T00:00:00.000Z",
            markets: [
              { slug: "older", question: "Older market", volume24hr: "2000", liquidity: "4000", lastTradePrice: "0.40" },
              { slug: "newer", question: "Newer market", volume24hr: "2000", liquidity: "7000", lastTradePrice: "0.60" },
            ],
          },
          {
            title: "Rates",
            liquidity: "5000",
            endDate: "2026-03-09T00:00:00.000Z",
            createdAt: "2026-03-05T00:00:00.000Z",
            markets: [
              { slug: "soonest", question: "Soonest market", volume24hr: "1000", liquidity: "3000", lastTradePrice: "0.30" },
            ],
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    await expect(adapter.search("   ", { limit: 2, offset: 0 })).resolves.toMatchObject([
      { reference: "newer" },
      { reference: "older" },
    ]);

    await expect(adapter.browse?.({ sort: "liquidity", limit: 3, offset: 0 })).resolves.toMatchObject([
      { reference: "newer" },
      { reference: "older" },
      { reference: "soonest" },
    ]);

    await expect(adapter.browse?.({ sort: "endingSoon", limit: 3, offset: 0 })).resolves.toMatchObject([
      { reference: "soonest" },
      { reference: "newer" },
      { reference: "older" },
    ]);

    await expect(adapter.browse?.({ sort: "newest", limit: 3, offset: 0 })).resolves.toMatchObject([
      { reference: "soonest" },
      { reference: "newer" },
      { reference: "older" },
    ]);
  });

  it("gracefully handles invalid search and browse payloads", async () => {
    const adapter = makeAdapter();

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/search-v2")) {
        return jsonResponse("bad-payload");
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });
    await expect(adapter.search("iran")).resolves.toEqual([]);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/events")) {
        return jsonResponse({ events: [] });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });
    await expect(adapter.browse?.()).resolves.toEqual([]);
  });

  it("rejects unresolved slug and condition references", async () => {
    const conditionId = `0x${"f".repeat(64)}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=missing&limit=1") {
        return jsonResponse([]);
      }
      if (url === `https://gamma.example/markets?conditionId=${conditionId}&limit=1`) {
        return jsonResponse([{ slug: "missing-token", conditionId, clobTokenIds: JSON.stringify([]) }]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    await expect(adapter.normalizeReference("missing")).rejects.toMatchObject<Partial<MarketAdapterError>>({
      code: "SYMBOL_NOT_FOUND",
    });
    await expect(adapter.normalizeReference(conditionId)).rejects.toMatchObject<Partial<MarketAdapterError>>({
      code: "SYMBOL_NOT_FOUND",
    });
  });

  it("returns one-sided quotes, validates empty quotes, and rejects invalid orderbooks", async () => {
    const conditionId = `0x${"9".repeat(64)}`;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=ask-only&limit=1") {
        return jsonResponse([{ slug: "ask-only", conditionId, clobTokenIds: JSON.stringify(["222"]) }]);
      }
      if (url === "https://clob.example/book?token_id=222") {
        return jsonResponse({ bids: [], asks: [{ price: "0.61", size: "8" }] });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const askOnlyAdapter = makeAdapter();
    await expect(askOnlyAdapter.getQuote("ask-only")).resolves.toMatchObject({ reference: "ask-only", price: 0.61, ask: 0.61 });
    await expect(askOnlyAdapter.getQuote("ask-only")).resolves.toMatchObject({ reference: "ask-only", price: 0.61, ask: 0.61 });

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=no-book&limit=1") {
        return jsonResponse([{ slug: "no-book", conditionId, clobTokenIds: JSON.stringify(["223"]) }]);
      }
      if (url === "https://clob.example/book?token_id=223") {
        return jsonResponse({ bids: [], asks: [] });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const noBookAdapter = makeAdapter();
    await expect(noBookAdapter.getQuote("no-book")).rejects.toMatchObject<Partial<MarketAdapterError>>({
      code: "SYMBOL_NOT_FOUND",
    });

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=bad-book&limit=1") {
        return jsonResponse([{ slug: "bad-book", conditionId, clobTokenIds: JSON.stringify(["224"]) }]);
      }
      if (url === "https://clob.example/book?token_id=224") {
        return jsonResponse("invalid-book");
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const badBookAdapter = makeAdapter();
    await expect(badBookAdapter.getOrderbook("bad-book")).rejects.toMatchObject<Partial<MarketAdapterError>>({
      code: "UPSTREAM_ERROR",
    });
  });

  it("caches missing resolutions and returns null for unresolved condition ids", async () => {
    const conditionId = `0x${"7".repeat(64)}`;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=missing-resolution&limit=1") {
        return jsonResponse([]);
      }
      if (url === `https://gamma.example/markets?conditionId=${conditionId}&limit=1`) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    await expect(adapter.resolve("missing-resolution")).resolves.toBeNull();
    await expect(adapter.resolve("missing-resolution")).resolves.toBeNull();
    await expect(adapter.resolve(conditionId)).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("resolves symbol names from condition ids and token records", async () => {
    const conditionId = `0x${"8".repeat(64)}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === `https://gamma.example/markets?conditionId=${conditionId}&limit=1`) {
        return jsonResponse([
          {
            question: "Will the launch happen?",
            conditionId,
            tokens: [
              { token_id: "101", outcome: "Yes" },
              { token_id: "202", outcome: "No" },
              null,
            ],
          },
        ]);
      }
      if (url === "https://gamma.example/markets?clob_token_ids=101&limit=1") {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const resolution = await adapter.resolveSymbolNames([conditionId, "101"]);

    expect(resolution.names.get(conditionId)).toBe("Will the launch happen?");
    expect(resolution.names.get("101")).toBe("Will the launch happen?");
    expect(resolution.outcomes.get("101")).toBe("Yes");
    expect(resolution.outcomes.get("202")).toBe("No");
  });

  it("ignores non-critical resolveSymbolNames batch failures", async () => {
    vi.spyOn(Promise, "allSettled").mockRejectedValueOnce(new Error("settled failed"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));

    const adapter = makeAdapter();
    const resolution = await adapter.resolveSymbolNames(["123"]);

    expect(resolution.names.size).toBe(0);
    expect(resolution.outcomes.size).toBe(0);
  });

  it("delegates blank searches to browse", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/events")) {
        return jsonResponse([
          {
            title: "Macro",
            liquidity: "5000",
            markets: [{ slug: "delegated-market", question: "Delegated market", volume24hr: "1000" }],
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    await expect(adapter.search("   ", { limit: 5, offset: 0 })).resolves.toMatchObject([
      { reference: "delegated-market", name: "Delegated market" },
    ]);
  });

  it("deduplicates paginated search previews and skips malformed entries", async () => {
    const conditionOne = `0x${"f".repeat(64)}`;
    const conditionTwo = `0x${"0".repeat(64)}`;
    const conditionThree = `0x${"2".repeat(64)}`;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.origin === "https://gamma.example" && url.pathname === "/search-v2") {
        const page = url.searchParams.get("page");
        if (page === "1") {
          return jsonResponse({
            events: [
              null,
              {
                title: "Event One",
                markets: [
                  null,
                  {
                    slug: "dup-market",
                    question: "Duplicate once",
                    conditionId: conditionOne,
                    lastTradePrice: "0.5",
                    outcomes: '["Yes","No"]',
                    outcomePrices: '["0.5","0.5"]',
                  },
                  {
                    slug: "dup-market",
                    question: "Duplicate twice",
                    conditionId: conditionOne,
                    lastTradePrice: "0.4",
                  },
                  {
                    slug: "title-fallback",
                    title: "Fallback title",
                    conditionId: conditionTwo,
                    outcomePrice: "0.33",
                    liquidity: "100",
                  },
                ],
              },
            ],
            pagination: { hasMore: true },
          });
        }
        if (page === "2") {
          return jsonResponse({
            events: [
              {
                title: "Event Two",
                markets: [
                  {
                    slug: "second-page",
                    question: "Second page",
                    conditionId: conditionThree,
                    lastTradePrice: "0.61",
                    volume24hr: "42",
                  },
                ],
              },
            ],
            pagination: { hasMore: false },
          });
        }
      }
      throw new Error(`Unexpected fetch url: ${String(input)}`);
    });

    const adapter = makeAdapter();
    const results = await adapter.search("iran", { limit: 3, offset: 0 });

    expect(results.map((row) => row.reference)).toEqual(["dup-market", "title-fallback", "second-page"]);
    expect(results[0]?.metadata).toMatchObject({
      conditionId: conditionOne,
      outcomes: ["Yes", "No"],
      outcomePrices: [0.5, 0.5],
      defaultOutcome: "Yes",
    });
    expect(results[1]).toMatchObject({ name: "Fallback title", price: 0.33, liquidity: 100 });
  });

  it("enriches sparse search previews with market detail metrics", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/search-v2")) {
        return jsonResponse({
          events: [
            {
              title: "Election event",
              markets: [
                {
                  slug: "fed-march",
                  question: "Will the Fed cut in March?",
                  conditionId: `0x${"3".repeat(64)}`,
                  lastTradePrice: "0.44",
                },
              ],
            },
          ],
          pagination: { hasMore: false },
        });
      }
      if (url === "https://gamma.example/markets?slug=fed-march&limit=1") {
        return jsonResponse([
          {
            slug: "fed-march",
            question: "Will the Fed cut in March?",
            conditionId: `0x${"3".repeat(64)}`,
            lastTradePrice: "0.44",
            volume24hr: "8800",
            liquidity: "12000",
            endDate: "2026-03-31T00:00:00.000Z",
            createdAt: "2026-03-01T00:00:00.000Z",
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const results = await adapter.search("fed");

    expect(results).toMatchObject([
      {
        reference: "fed-march",
        price: 0.44,
        volume: 8800,
        liquidity: 12000,
        endDate: "2026-03-31T00:00:00.000Z",
        metadata: {
          eventTitle: "Election event",
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      },
    ]);
  });

  it("supports explicit sort for search results across paginated previews", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.origin === "https://gamma.example" && url.pathname === "/search-v2") {
        const page = url.searchParams.get("page");
        if (page === "1") {
          return jsonResponse({
            events: [
              {
                title: "Rates",
                markets: [
                  {
                    slug: "fed-april",
                    question: "Will the Fed cut by April?",
                    conditionId: `0x${"4".repeat(64)}`,
                    lastTradePrice: "0.51",
                  },
                ],
              },
            ],
            pagination: { hasMore: true },
          });
        }
        if (page === "2") {
          return jsonResponse({
            events: [
              {
                title: "Rates",
                markets: [
                  {
                    slug: "fed-may",
                    question: "Will the Fed cut by May?",
                    conditionId: `0x${"5".repeat(64)}`,
                    lastTradePrice: "0.64",
                  },
                ],
              },
            ],
            pagination: { hasMore: false },
          });
        }
      }
      if (String(input) === "https://gamma.example/markets?slug=fed-april&limit=1") {
        return jsonResponse([
          {
            slug: "fed-april",
            question: "Will the Fed cut by April?",
            conditionId: `0x${"4".repeat(64)}`,
            lastTradePrice: "0.51",
            volume24hr: "100",
            liquidity: "900",
            endDate: "2026-04-30T00:00:00.000Z",
            createdAt: "2026-03-01T00:00:00.000Z",
          },
        ]);
      }
      if (String(input) === "https://gamma.example/markets?slug=fed-may&limit=1") {
        return jsonResponse([
          {
            slug: "fed-may",
            question: "Will the Fed cut by May?",
            conditionId: `0x${"5".repeat(64)}`,
            lastTradePrice: "0.64",
            volume24hr: "10000",
            liquidity: "1200",
            endDate: "2026-05-31T00:00:00.000Z",
            createdAt: "2026-03-05T00:00:00.000Z",
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${String(input)}`);
    });

    const adapter = makeAdapter();
    const defaultResults = await adapter.search("fed", { limit: 1, offset: 0 });
    const volumeSorted = await adapter.search("fed", { limit: 1, offset: 0, sort: "volume" });

    expect(defaultResults.map((row) => row.reference)).toEqual(["fed-april"]);
    expect(volumeSorted.map((row) => row.reference)).toEqual(["fed-may"]);
  });

  it("hydrates partially populated previews before explicit liquidity sorting", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/search-v2")) {
        return jsonResponse({
          events: [
            {
              title: "Rates",
              markets: [
                {
                  slug: "needs-hydration",
                  question: "Needs hydration",
                  conditionId: `0x${"6".repeat(64)}`,
                  lastTradePrice: "0.42",
                  volume24hr: "500",
                },
                {
                  slug: "already-liquid",
                  question: "Already liquid",
                  conditionId: `0x${"7".repeat(64)}`,
                  lastTradePrice: "0.51",
                  volume24hr: "400",
                  liquidity: "900",
                  endDate: "2026-04-30T00:00:00.000Z",
                  createdAt: "2026-03-01T00:00:00.000Z",
                },
              ],
            },
          ],
          pagination: { hasMore: false },
        });
      }
      if (url === "https://gamma.example/markets?slug=needs-hydration&limit=1") {
        return jsonResponse([
          {
            slug: "needs-hydration",
            question: "Needs hydration",
            conditionId: `0x${"6".repeat(64)}`,
            lastTradePrice: "0.42",
            volume24hr: "500",
            liquidity: "1500",
            endDate: "2026-04-15T00:00:00.000Z",
            createdAt: "2026-03-02T00:00:00.000Z",
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const results = await adapter.search("rates", { sort: "liquidity", limit: 2, offset: 0 });

    expect(results.map((row) => row.reference)).toEqual(["needs-hydration", "already-liquid"]);
    expect(results[0]).toMatchObject({
      liquidity: 1500,
      endDate: "2026-04-15T00:00:00.000Z",
      metadata: { createdAt: "2026-03-02T00:00:00.000Z" },
    });
  });

  it("pushes newest-sorted results with missing createdAt behind dated results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/search-v2")) {
        return jsonResponse({
          events: [
            {
              title: "Elections",
              markets: [
                {
                  slug: "missing-created",
                  question: "Missing createdAt",
                  conditionId: `0x${"8".repeat(64)}`,
                  lastTradePrice: "0.49",
                  volume24hr: "300",
                  liquidity: "1200",
                  endDate: "2026-11-01T00:00:00.000Z",
                },
                {
                  slug: "dated-market",
                  question: "Dated market",
                  conditionId: `0x${"9".repeat(64)}`,
                  lastTradePrice: "0.57",
                  volume24hr: "320",
                  liquidity: "1000",
                  endDate: "2026-11-02T00:00:00.000Z",
                  createdAt: "2026-03-05T00:00:00.000Z",
                },
              ],
            },
          ],
          pagination: { hasMore: false },
        });
      }
      if (url === "https://gamma.example/markets?slug=missing-created&limit=1") {
        return jsonResponse([
          {
            slug: "missing-created",
            question: "Missing createdAt",
            conditionId: `0x${"8".repeat(64)}`,
            lastTradePrice: "0.49",
            volume24hr: "300",
            liquidity: "1200",
            endDate: "2026-11-01T00:00:00.000Z",
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const results = await adapter.search("market", { sort: "newest", limit: 2, offset: 0 });

    expect(results.map((row) => row.reference)).toEqual(["dated-market", "missing-created"]);
  });

  it("supports endingSoon, newest, liquidity, and fallback browse sorting", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/events")) {
        return jsonResponse([
          {
            title: "Sooner",
            liquidity: "900",
            endDate: "2026-03-08T00:00:00.000Z",
            createdAt: "2026-03-07T00:00:00.000Z",
            markets: [{ slug: "soon-market", question: "Soon market", volume24hr: "10" }],
          },
          {
            title: "Newer",
            liquidity: "1200",
            endDate: "2026-03-12T00:00:00.000Z",
            createdAt: "2026-03-09T00:00:00.000Z",
            markets: [{ slug: "liquid-market", question: "Liquid market", volume24hr: "90" }],
          },
          {
            title: "No End",
            liquidity: "100",
            createdAt: "2026-03-01T00:00:00.000Z",
            markets: [{ slug: "no-end-market", question: "No end market", volume24hr: "20" }],
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();

    expect((await adapter.browse?.({ sort: "endingSoon", limit: 3, offset: 0 }))?.map((row) => row.reference)).toEqual([
      "soon-market",
      "liquid-market",
      "no-end-market",
    ]);
    expect((await adapter.browse?.({ sort: "newest", limit: 3, offset: 0 }))?.map((row) => row.reference)).toEqual([
      "liquid-market",
      "soon-market",
      "no-end-market",
    ]);
    expect((await adapter.browse?.({ sort: "liquidity", limit: 3, offset: 0 }))?.map((row) => row.reference)).toEqual([
      "liquid-market",
      "soon-market",
      "no-end-market",
    ]);
    expect((await adapter.browse?.({ sort: "not-a-sort", limit: 3, offset: 0 }))?.map((row) => row.reference)).toEqual([
      "liquid-market",
      "no-end-market",
      "soon-market",
    ]);
  });

  it("returns static trading constraints", async () => {
    const adapter = makeAdapter();
    await expect(adapter.getTradingConstraints("anything")).resolves.toEqual({
      minQuantity: 1,
      quantityStep: 1,
      supportsFractional: false,
      maxLeverage: null,
    });
  });

  it("rejects condition and slug references without token mappings", async () => {
    const conditionId = `0x${"3".repeat(64)}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === `https://gamma.example/markets?conditionId=${conditionId}&limit=1`) {
        return jsonResponse([{ conditionId, clobTokenIds: "[]" }]);
      }
      if (url === "https://gamma.example/markets?slug=missing-token&limit=1") {
        return jsonResponse([{ slug: "missing-token", conditionId: `0x${"4".repeat(64)}`, clobTokenIds: "not-json" }]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    await expect(adapter.normalizeReference(conditionId)).rejects.toMatchObject<Partial<MarketAdapterError>>({
      code: "SYMBOL_NOT_FOUND",
    });
    await expect(adapter.normalizeReference("missing-token")).rejects.toMatchObject<Partial<MarketAdapterError>>({
      code: "SYMBOL_NOT_FOUND",
    });
  });

  it("parses mixed orderbook rows, computes quotes, and remaps cached orderbooks", async () => {
    const conditionId = `0x${"5".repeat(64)}`;
    const tokenId = "777";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=mixed-market&limit=1") {
        return jsonResponse([{ slug: "mixed-market", conditionId, clobTokenIds: JSON.stringify([tokenId]) }]);
      }
      if (url === `https://clob.example/book?token_id=${tokenId}`) {
        return jsonResponse({
          bids: [["bad", "1"], { price: "0.41", size: "5" }],
          asks: [["0.55", "2"], { price: "oops", size: "1" }, ["0.53", "1"]],
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const quote = await adapter.getQuote("mixed-market");
    const book = await adapter.getOrderbook(tokenId);

    expect(quote).toMatchObject({ reference: "mixed-market", bid: 0.41, ask: 0.53, price: 0.47 });
    expect(book.reference).toBe(tokenId);
    expect(book.bids).toEqual([{ price: 0.41, size: 5 }]);
    expect(book.asks).toEqual([{ price: 0.53, size: 1 }, { price: 0.55, size: 2 }]);
  });

  it("rejects empty quotes and invalid orderbook payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=empty-book&limit=1") {
        return jsonResponse([{ slug: "empty-book", conditionId: `0x${"6".repeat(64)}`, clobTokenIds: JSON.stringify(["888"]) }]);
      }
      if (url === "https://clob.example/book?token_id=888") {
        return jsonResponse({ bids: [], asks: [] });
      }
      if (url === "https://gamma.example/markets?slug=invalid-book&limit=1") {
        return jsonResponse([{ slug: "invalid-book", conditionId: `0x${"7".repeat(64)}`, clobTokenIds: JSON.stringify(["889"]) }]);
      }
      if (url === "https://clob.example/book?token_id=889") {
        return jsonResponse("invalid-book", 200);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    await expect(adapter.getQuote("empty-book")).rejects.toMatchObject<Partial<MarketAdapterError>>({
      code: "SYMBOL_NOT_FOUND",
    });
    await expect(adapter.getOrderbook("invalid-book")).rejects.toMatchObject<Partial<MarketAdapterError>>({
      code: "UPSTREAM_ERROR",
    });
  });

  it("returns null for unresolved references and missing markets", async () => {
    const missingCondition = `0x${"8".repeat(64)}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=missing-market&limit=1") {
        return jsonResponse([]);
      }
      if (url === `https://gamma.example/markets?conditionId=${missingCondition}&limit=1`) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    await expect(adapter.resolve("missing-market")).resolves.toBeNull();
    await expect(adapter.resolve(missingCondition)).resolves.toBeNull();
  });

  it("resolves symbol names from token objects and fallback outcome arrays", async () => {
    const conditionId = `0x${"9".repeat(64)}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === `https://gamma.example/markets?conditionId=${conditionId}&limit=1`) {
        return jsonResponse([
          {
            question: "Will turnout exceed 60%?",
            conditionId,
            tokens: [
              null,
              { token_id: "11", outcome: "Yes" },
              { token_id: "12" },
            ],
            clobTokenIds: JSON.stringify(["11", "12", "13"]),
            outcomes: JSON.stringify(["Yes", "No", "Maybe"]),
          },
        ]);
      }
      if (url === "https://gamma.example/markets?clob_token_ids=13&limit=1") {
        return jsonResponse([
          {
            question: "Will turnout exceed 60%?",
            conditionId,
            clobTokenIds: JSON.stringify(["11", "12", "13"]),
            outcomes: JSON.stringify(["Yes", "No", "Maybe"]),
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const resolution = await adapter.resolveSymbolNames([conditionId, "11", "12", "13"]);

    expect(resolution.names.get(conditionId)).toBe("Will turnout exceed 60%?");
    expect(resolution.names.get("11")).toBe("Will turnout exceed 60%?");
    expect(resolution.outcomes.get("11")).toBe("Yes");
    expect(resolution.outcomes.get("12")).toBe("No");
    expect(resolution.outcomes.get("13")).toBe("Maybe");
  });

  it("serves browse results from cache on repeated calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/events")) {
        return jsonResponse([
          {
            title: "Macro",
            liquidity: "8000",
            endDate: "2026-03-10T00:00:00.000Z",
            createdAt: "2026-03-01T00:00:00.000Z",
            markets: [
              { slug: "market-a", question: "Market A", volume24hr: "5000", lastTradePrice: "0.50" },
              { slug: "market-b", question: "Market B", volume24hr: "2000", lastTradePrice: "0.40" },
            ],
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const first = await adapter.browse?.({ sort: "volume", limit: 10, offset: 0 });
    const second = await adapter.browse?.({ sort: "volume", limit: 10, offset: 0 });

    expect(first).toEqual(second);
    // Only one set of upstream fetches for the first call; second is served from cache
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("maintains independent browse cache entries per sort key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/events")) {
        return jsonResponse([
          {
            title: "Mixed",
            liquidity: "8000",
            endDate: "2026-03-10T00:00:00.000Z",
            createdAt: "2026-03-01T00:00:00.000Z",
            markets: [
              { slug: "alpha", question: "Alpha", volume24hr: "1000", liquidity: "5000", lastTradePrice: "0.50" },
              { slug: "beta", question: "Beta", volume24hr: "3000", liquidity: "2000", lastTradePrice: "0.60" },
            ],
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const byVolume = await adapter.browse?.({ sort: "volume", limit: 10, offset: 0 });
    const byLiquidity = await adapter.browse?.({ sort: "liquidity", limit: 10, offset: 0 });

    expect(byVolume?.map((r) => r.reference)).toEqual(["beta", "alpha"]);
    expect(byLiquidity?.map((r) => r.reference)).toEqual(["alpha", "beta"]);
    // The underlying event pages are cached from the first browse, but each sort
    // key maintains its own browse-result cache entry with independent ordering
  });

  it("retains browse caches across sort switches under heavy symbol-map churn", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/events")) {
        return jsonResponse([
          {
            title: "Mega event",
            liquidity: "1000",
            markets: Array.from({ length: 300 }, (_, index) => ({
              slug: `market-${index}`,
              question: `Market ${index}`,
              conditionId: `0x${index.toString(16).padStart(64, "0")}`,
              clobTokenIds: JSON.stringify([String(index + 1)]),
              volume24hr: String(10_000 - index),
              liquidity: String(index),
              lastTradePrice: "0.50",
            })),
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const byVolume = await adapter.browse?.({ sort: "volume", limit: 10, offset: 0 });
    const byLiquidity = await adapter.browse?.({ sort: "liquidity", limit: 10, offset: 0 });
    const byVolumeAgain = await adapter.browse?.({ sort: "volume", limit: 10, offset: 0 });

    expect(byVolume?.[0]?.reference).toBe("market-0");
    expect(byLiquidity?.[0]?.reference).toBe("market-299");
    expect(byVolumeAgain).toEqual(byVolume);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("applies limit and offset from browse cache without re-fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://gamma.example/events")) {
        return jsonResponse([
          {
            title: "Macro",
            liquidity: "8000",
            markets: [
              { slug: "first", question: "First", volume24hr: "5000", lastTradePrice: "0.50" },
              { slug: "second", question: "Second", volume24hr: "3000", lastTradePrice: "0.40" },
              { slug: "third", question: "Third", volume24hr: "1000", lastTradePrice: "0.30" },
            ],
          },
        ]);
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const page1 = await adapter.browse?.({ sort: "volume", limit: 2, offset: 0 });
    const page2 = await adapter.browse?.({ sort: "volume", limit: 2, offset: 1 });

    expect(page1?.map((r) => r.reference)).toEqual(["first", "second"]);
    expect(page2?.map((r) => r.reference)).toEqual(["second", "third"]);
    // Second call served from cache
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fills browse cache with the full result set before serving deeper offsets", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.origin === "https://gamma.example" && url.pathname === "/events") {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        if (offset === 0) {
          return jsonResponse(
            Array.from({ length: 50 }, (_, index) => ({
              title: `Event ${index + 1}`,
              liquidity: "1000",
              markets: [
                {
                  slug: `market-${index + 1}`,
                  question: `Market ${index + 1}`,
                  volume24hr: String(1_000 - index),
                  lastTradePrice: "0.50",
                },
              ],
            })),
          );
        }
        if (offset === 50) {
          return jsonResponse([
            {
              title: "Event 51",
              liquidity: "1000",
              markets: [{ slug: "market-51", question: "Market 51", volume24hr: "50", lastTradePrice: "0.50" }],
            },
            {
              title: "Event 52",
              liquidity: "1000",
              markets: [{ slug: "market-52", question: "Market 52", volume24hr: "49", lastTradePrice: "0.50" }],
            },
          ]);
        }
      }
      throw new Error(`Unexpected fetch url: ${String(input)}`);
    });

    const adapter = makeAdapter();

    const firstPage = await adapter.browse?.({ sort: "volume", limit: 20, offset: 0 });
    const deeperPage = await adapter.browse?.({ sort: "volume", limit: 5, offset: 50 });

    expect(firstPage).toHaveLength(20);
    expect(deeperPage?.map((row) => row.reference)).toEqual(["market-51", "market-52"]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("resamples price history into the requested interval", async () => {
    const tokenId = "777";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://gamma.example/markets?slug=macro-yes&limit=1") {
        return jsonResponse([{ slug: "macro-yes", conditionId: `0x${"7".repeat(64)}`, clobTokenIds: JSON.stringify([tokenId]) }]);
      }
      if (
        url
        === "https://clob.example/prices-history?market=777&interval=1m&fidelity=1&startTs=1700006400&endTs=1700009400"
      ) {
        return jsonResponse({
          history: [
            { t: 1700006400, p: "0.40" },
            { t: 1700006460, p: "0.42" },
            { t: 1700006520, p: "0.41" },
            { t: 1700006580, p: "0.45" },
            { t: 1700006640, p: "0.44" },
            { t: 1700006700, p: "0.46" },
          ],
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const adapter = makeAdapter();
    const opts = {
      interval: "5m" as const,
      startTime: new Date(1700006400000).toISOString(),
      endTime: new Date(1700009400000).toISOString(),
    };
    const first = await adapter.getPriceHistory("macro-yes", opts);
    const second = await adapter.getPriceHistory("macro-yes", opts);

    expect(first).toMatchObject({
      reference: "macro-yes",
      interval: "5m",
      resampledFrom: "1m",
      range: {
        mode: "custom",
        lookback: null,
        startTime: new Date(1700006400000).toISOString(),
        endTime: new Date(1700009400000).toISOString(),
      },
      summary: {
        open: 0.4,
        close: 0.46,
        high: 0.46,
        low: 0.4,
        candleCount: 2,
      },
    });
    expect(first.candles).toEqual([
      {
        timestamp: new Date(1700006400000).toISOString(),
        open: 0.4,
        high: 0.45,
        low: 0.4,
        close: 0.44,
        volume: 0,
      },
      {
        timestamp: new Date(1700006700000).toISOString(),
        open: 0.46,
        high: 0.46,
        low: 0.46,
        close: 0.46,
        volume: 0,
      },
    ]);
    expect(second).toEqual(first);
  });

});
