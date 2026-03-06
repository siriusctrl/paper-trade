import { afterEach, describe, expect, it, vi } from "vitest";

import { HyperliquidAdapter } from "../src/hyperliquid.js";
import { MarketAdapterError } from "../src/types.js";

const jsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

const makeAdapter = () =>
  new HyperliquidAdapter({
    apiUrl: "https://hl.example/info",
  });

const META_RESPONSE = {
  universe: [
    { name: "BTC", szDecimals: 5, maxLeverage: 50 },
    { name: "ETH", szDecimals: 4, maxLeverage: 50 },
    { name: "SOL", szDecimals: 2, maxLeverage: 20 },
    { name: "DOGE", szDecimals: 0, maxLeverage: 10 },
  ],
};

const META_WITH_DELISTED = {
  universe: [
    { name: "BTC", szDecimals: 5, maxLeverage: 50 },
    { name: "OLD", szDecimals: 0, maxLeverage: 1, isDelisted: true },
  ],
};

const makeL2Book = (bids: [string, string][], asks: [string, string][]) => ({
  levels: [
    bids.map(([px, sz]) => ({ px, sz, n: 1 })),
    asks.map(([px, sz]) => ({ px, sz, n: 1 })),
  ],
});

describe("HyperliquidAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct adapter metadata", () => {
    const adapter = makeAdapter();
    expect(adapter.marketId).toBe("hyperliquid");
    expect(adapter.displayName).toBe("Hyperliquid");
    expect(adapter.referenceFormat).toContain("Ticker");
    expect(adapter.capabilities).toEqual(expect.arrayContaining(["search", "browse", "quote", "orderbook", "funding"]));
  });

  it("searches references by query and caches meta", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.type === "meta") return jsonResponse(META_RESPONSE);
      if (body.type === "allMids") return jsonResponse({ BTC: "95000.5", ETH: "3200.1", SOL: "180.5", DOGE: "0.25" });
      throw new Error(`Unexpected request type: ${body.type}`);
    });

    const adapter = makeAdapter();
    const results = await adapter.search("btc");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ reference: "BTC", name: "BTC-PERP", price: 95000.5 });

    await adapter.search("eth");
    const metaCalls = fetchSpy.mock.calls.filter(([, init]) => {
      const body = JSON.parse((init as RequestInit).body as string);
      return body.type === "meta";
    });
    expect(metaCalls).toHaveLength(1);
  });

  it("browses all listed references with pagination", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.type === "meta") return jsonResponse(META_RESPONSE);
      if (body.type === "allMids") return jsonResponse({});
      throw new Error(`Unexpected request type: ${body.type}`);
    });

    const adapter = makeAdapter();
    const browseResults = await adapter.browse?.({ limit: 2, offset: 1 });

    expect(browseResults?.map((row) => row.reference)).toEqual(["ETH", "SOL"]);
  });

  it("excludes delisted assets from discovery results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.type === "meta") return jsonResponse(META_WITH_DELISTED);
      if (body.type === "allMids") return jsonResponse({ BTC: "95000.5" });
      throw new Error(`Unexpected request type: ${body.type}`);
    });

    const adapter = makeAdapter();
    const browseResults = await adapter.browse?.();

    expect(browseResults).toHaveLength(1);
    expect(browseResults?.[0]?.reference).toBe("BTC");
  });

  it("normalizes reference aliases and perp suffixes", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.type === "meta") return jsonResponse(META_RESPONSE);
      throw new Error(`Unexpected request type: ${body.type}`);
    });

    const adapter = makeAdapter();
    await expect(adapter.normalizeReference(" btc-perp ")).resolves.toBe("BTC");
    await expect(adapter.normalizeReference("eth")).resolves.toBe("ETH");
    await expect(adapter.normalizeReference("unknown")).rejects.toMatchObject<Partial<MarketAdapterError>>({
      code: "SYMBOL_NOT_FOUND",
    });
  });

  it("returns trading constraints from meta", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.type === "meta") return jsonResponse(META_RESPONSE);
      throw new Error(`Unexpected request type: ${body.type}`);
    });

    const adapter = makeAdapter();
    const constraints = await adapter.getTradingConstraints?.("BTC");
    expect(constraints).toMatchObject({
      minQuantity: 0.00001,
      quantityStep: 0.00001,
      supportsFractional: true,
      maxLeverage: 50,
    });
  });

  it("gets quote from l2Book and caches it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.type === "meta") return jsonResponse(META_RESPONSE);
      if (body.type === "l2Book" && body.coin === "BTC") {
        return jsonResponse(makeL2Book([["94990", "1.5"]], [["95010", "2.0"]]));
      }
      throw new Error(`Unexpected request: ${JSON.stringify(body)}`);
    });

    const adapter = makeAdapter();
    const first = await adapter.getQuote("BTC");
    const second = await adapter.getQuote("BTC");

    expect(first.reference).toBe("BTC");
    expect(first.price).toBe(95000);
    expect(first.bid).toBe(94990);
    expect(first.ask).toBe(95010);
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gets orderbook with sorted levels", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.type === "meta") return jsonResponse(META_RESPONSE);
      if (body.type === "l2Book") {
        return jsonResponse(
          makeL2Book(
            [["94980", "1"], ["94990", "2"], ["94970", "3"]],
            [["95020", "4"], ["95010", "5"], ["95030", "6"]],
          ),
        );
      }
      throw new Error(`Unexpected request: ${JSON.stringify(body)}`);
    });

    const adapter = makeAdapter();
    const book = await adapter.getOrderbook("ETH");

    expect(book.reference).toBe("ETH");
    expect(book.bids.map((l) => l.price)).toEqual([94990, 94980, 94970]);
    expect(book.asks.map((l) => l.price)).toEqual([95010, 95020, 95030]);
  });

  it("gets funding rate for a reference", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.type === "meta") return jsonResponse(META_RESPONSE);
      if (body.type === "predictedFundings") {
        return jsonResponse([
          ["BTC", [["HlPerp", { fundingRate: "0.0001", nextFundingTime: 1_700_000_000_000 }]]],
        ]);
      }
      throw new Error(`Unexpected request: ${JSON.stringify(body)}`);
    });

    const adapter = makeAdapter();
    const btcFunding = await adapter.getFundingRate("btc-perp");

    expect(btcFunding.reference).toBe("btc-perp");
    expect(btcFunding.rate).toBe(0.0001);
    expect(btcFunding.nextFundingAt).toBe(new Date(1_700_000_000_000).toISOString());
  });
});
