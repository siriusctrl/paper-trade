import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MarketRegistry, type MarketAdapter } from "@paper-trade/markets";

type AppLike = {
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const dbFilePath = join(tmpdir(), `paper-trade-test-${randomUUID()}.sqlite`);
process.env.DB_URL = `file:${dbFilePath}`;
process.env.ADMIN_API_KEY = "admin_test_key";

let app: AppLike;
const quoteBySymbol: Record<string, { price: number; bid: number; ask: number }> = {
  "0x-cross-symbol": { price: 0.35, bid: 0.34, ask: 0.35 },
  "0x-test-symbol": { price: 0.6, bid: 0.59, ask: 0.6 },
};

beforeAll(async () => {
  const [{ createApp }, { migrate }] = await Promise.all([import("../src/app.js"), import("../src/db/client.js")]);
  await migrate();

  const mockAdapter: MarketAdapter = {
    marketId: "polymarket",
    displayName: "Polymarket",
    description: "mock polymarket adapter",
    symbolFormat: "mock",
    priceRange: [0.01, 0.99],
    capabilities: ["search", "quote", "orderbook", "resolve"],
    search: async () => [],
    getQuote: async (symbol) => {
      const quote = quoteBySymbol[symbol] ?? { price: 0.6, bid: 0.59, ask: 0.6 };
      return { symbol, ...quote, timestamp: new Date().toISOString() };
    },
    getOrderbook: async (symbol) => ({
      symbol,
      bids: [{ price: 0.34, size: 100 }],
      asks: [{ price: 0.35, size: 100 }],
      timestamp: new Date().toISOString(),
    }),
    resolve: async (symbol) => ({
      symbol,
      resolved: false,
      outcome: null,
      settlementPrice: null,
      timestamp: new Date().toISOString(),
    }),
  };

  const registry = new MarketRegistry();
  registry.register(mockAdapter);

  app = createApp({ registry });
});

afterAll(async () => {
  await rm(dbFilePath, { force: true });
  await rm(`${dbFilePath}-wal`, { force: true });
  await rm(`${dbFilePath}-shm`, { force: true });
});

describe("api integration", () => {
  it("serves health and openapi without auth", async () => {
    const healthResponse = await app.request("/health");
    expect(healthResponse.status).toBe(200);
    const healthPayload = await healthResponse.json();
    expect(healthPayload.status).toBe("ok");

    const openApiResponse = await app.request("/openapi.json");
    expect(openApiResponse.status).toBe(200);
    const openApi = await openApiResponse.json();
    expect(openApi.openapi).toBe("3.1.0");
    expect(openApi.paths["/api/orders"]).toBeDefined();
  });

  it("provides admin overview for markets and agents", async () => {
    quoteBySymbol["0x-overview-symbol"] = { price: 0.52, bid: 0.51, ask: 0.52 };

    const registerResponse = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "overview-agent" }),
    });
    expect(registerResponse.status).toBe(201);

    const registerPayload = await registerResponse.json();
    const apiKey = registerPayload.apiKey as string;
    const accountId = registerPayload.account.id as string;
    const userId = registerPayload.userId as string;

    const placeOrderResponse = await app.request("/api/orders", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accountId,
        market: "polymarket",
        symbol: "0x-overview-symbol",
        side: "buy",
        type: "market",
        quantity: 20,
        reasoning: "Create position for overview snapshot",
      }),
    });
    expect(placeOrderResponse.status).toBe(201);

    const overviewResponse = await app.request("/api/admin/overview", {
      headers: {
        authorization: "Bearer admin_test_key",
      },
    });
    expect(overviewResponse.status).toBe(200);

    const overview = await overviewResponse.json();
    expect(overview.totals.users).toBeGreaterThan(0);
    expect(Array.isArray(overview.markets)).toBe(true);
    expect(Array.isArray(overview.agents)).toBe(true);
    expect(
      overview.agents.some((agent: unknown) => {
        if (typeof agent !== "object" || agent === null) {
          return false;
        }
        const typed = agent as { userId?: string };
        return typed.userId === userId;
      }),
    ).toBe(true);
  });

  it("enforces reasoning on account/order cancel flows and exposes timeline", async () => {
    const registerResponse = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "integration-agent" }),
    });

    expect(registerResponse.status).toBe(201);
    const registerPayload = await registerResponse.json();

    const apiKey = registerPayload.apiKey as string;
    const accountId = registerPayload.account.id as string;

    const missingReasoningAccount = await app.request("/api/accounts", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "no-reasoning-account" }),
    });

    expect(missingReasoningAccount.status).toBe(400);
    const missingReasoningAccountPayload = await missingReasoningAccount.json();
    expect(missingReasoningAccountPayload.error.code).toBe("REASONING_REQUIRED");

    const createAccountResponse = await app.request("/api/accounts", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "strategy-account",
        reasoning: "Separate account for integration test strategy",
      }),
    });

    expect(createAccountResponse.status).toBe(201);

    const createLimitOrderResponse = await app.request("/api/orders", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accountId,
        market: "polymarket",
        symbol: "0x-test-symbol",
        side: "buy",
        type: "limit",
        quantity: 10,
        limitPrice: 0.4,
        reasoning: "Test pending order for cancellation flow",
      }),
    });

    expect(createLimitOrderResponse.status).toBe(201);
    const orderPayload = await createLimitOrderResponse.json();
    expect(orderPayload.status).toBe("pending");

    const cancelWithoutReasoning = await app.request(`/api/orders/${orderPayload.id as string}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(cancelWithoutReasoning.status).toBe(400);
    const cancelWithoutReasoningPayload = await cancelWithoutReasoning.json();
    expect(cancelWithoutReasoningPayload.error.code).toBe("REASONING_REQUIRED");

    const cancelWithReasoning = await app.request(`/api/orders/${orderPayload.id as string}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reasoning: "Market thesis changed" }),
    });

    expect(cancelWithReasoning.status).toBe(200);

    const journalResponse = await app.request("/api/journal", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Tracking market sentiment drift",
        tags: ["analysis", "integration-test"],
      }),
    });

    expect(journalResponse.status).toBe(201);

    const timelineResponse = await app.request(`/api/accounts/${accountId}/timeline?limit=20&offset=0`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });

    expect(timelineResponse.status).toBe(200);
    const timelinePayload = await timelineResponse.json();

    expect(Array.isArray(timelinePayload.events)).toBe(true);
    expect(timelinePayload.events.some((event: unknown) => {
      if (typeof event !== "object" || event === null) {
        return false;
      }
      const typed = event as { type?: string };
      return typed.type === "order_cancelled";
    })).toBe(true);
    expect(timelinePayload.events.some((event: unknown) => {
      if (typeof event !== "object" || event === null) {
        return false;
      }
      const typed = event as { type?: string };
      return typed.type === "journal";
    })).toBe(true);
  });

  it("fills marketable limit orders immediately", async () => {
    const registerResponse = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "limit-fill-agent" }),
    });

    expect(registerResponse.status).toBe(201);
    const registerPayload = await registerResponse.json();

    const apiKey = registerPayload.apiKey as string;
    const accountId = registerPayload.account.id as string;

    const placeOrderResponse = await app.request("/api/orders", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accountId,
        market: "polymarket",
        symbol: "0x-cross-symbol",
        side: "buy",
        type: "limit",
        quantity: 10,
        limitPrice: 0.4,
        reasoning: "Crossing quote should fill instantly",
      }),
    });

    expect(placeOrderResponse.status).toBe(201);
    const order = await placeOrderResponse.json();
    expect(order.status).toBe("filled");
    expect(order.filledPrice).toBe(0.35);

    const positionsResponse = await app.request(`/api/positions?accountId=${accountId}`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });
    expect(positionsResponse.status).toBe(200);
    const positionsPayload = await positionsResponse.json();
    expect(Array.isArray(positionsPayload.positions)).toBe(true);
    expect(positionsPayload.positions).toHaveLength(1);
    expect(positionsPayload.positions[0].quantity).toBe(10);
  });

  it("reconciles pending limit orders when market price crosses", async () => {
    const registerResponse = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "reconcile-agent" }),
    });

    expect(registerResponse.status).toBe(201);
    const registerPayload = await registerResponse.json();
    const apiKey = registerPayload.apiKey as string;
    const accountId = registerPayload.account.id as string;

    quoteBySymbol["0x-reconcile-symbol"] = { price: 0.6, bid: 0.59, ask: 0.6 };

    const pendingOrderResponse = await app.request("/api/orders", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accountId,
        market: "polymarket",
        symbol: "0x-reconcile-symbol",
        side: "buy",
        type: "limit",
        quantity: 8,
        limitPrice: 0.4,
        reasoning: "Place pending order first",
      }),
    });
    expect(pendingOrderResponse.status).toBe(201);
    const pendingOrder = await pendingOrderResponse.json();
    expect(pendingOrder.status).toBe("pending");

    const missingReasoningResponse = await app.request("/api/orders/reconcile", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(missingReasoningResponse.status).toBe(400);
    const missingReasoningPayload = await missingReasoningResponse.json();
    expect(missingReasoningPayload.error.code).toBe("REASONING_REQUIRED");

    quoteBySymbol["0x-reconcile-symbol"] = { price: 0.35, bid: 0.34, ask: 0.35 };

    const reconcileResponse = await app.request("/api/orders/reconcile", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accountId,
        reasoning: "Check and fill marketable pending orders",
      }),
    });
    expect(reconcileResponse.status).toBe(200);
    const reconcilePayload = await reconcileResponse.json();
    expect(reconcilePayload.filled).toBe(1);
    expect(reconcilePayload.filledOrderIds).toContain(pendingOrder.id);

    const filledOrdersResponse = await app.request(`/api/orders?accountId=${accountId}&status=filled`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });
    expect(filledOrdersResponse.status).toBe(200);
    const filledOrdersPayload = await filledOrdersResponse.json();
    expect(Array.isArray(filledOrdersPayload.orders)).toBe(true);
    expect(filledOrdersPayload.orders.some((order: unknown) => {
      if (typeof order !== "object" || order === null) {
        return false;
      }
      const typed = order as { id?: string };
      return typed.id === pendingOrder.id;
    })).toBe(true);
  });
});
