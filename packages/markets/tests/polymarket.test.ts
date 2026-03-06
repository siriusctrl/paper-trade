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
                  volume24hr: "12345",
                },
              ],
            },
          ],
          pagination: { hasMore: false },
        });
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
      endDate: null,
      metadata: {
        conditionId: `0x${"a".repeat(64)}`,
        outcomes: [],
        outcomePrices: [],
        defaultOutcome: null,
        eventTitle: "Iran event",
        createdAt: null,
      },
    });
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
});
