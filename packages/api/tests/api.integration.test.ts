import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { INITIAL_BALANCE } from "@paper-trade/core";
import { MarketRegistry, type MarketAdapter } from "@paper-trade/markets";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type AppLike = {
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

type RegisterPayload = {
  userId: string;
  apiKey: string;
  account: {
    id: string;
    balance: number;
    createdAt: string;
  };
};

type DbModule = Awaited<typeof import("../src/db/client.js")>;
type SchemaModule = Awaited<typeof import("../src/db/schema.js")>;

const dbFilePath = join(tmpdir(), `paper-trade-test-${randomUUID()}.sqlite`);
process.env.DB_URL = `file:${dbFilePath}`;
process.env.ADMIN_API_KEY = "admin_test_key";

let app: AppLike;
let db: DbModule["db"];
let sqlite: DbModule["sqlite"];
let tables: SchemaModule;

const quoteBySymbol: Record<string, { price: number; bid: number; ask: number }> = {
  "0x-market-fill": { price: 0.52, bid: 0.51, ask: 0.52 },
  "0x-pending": { price: 0.66, bid: 0.65, ask: 0.66 },
  "0x-reconcile-a": { price: 0.71, bid: 0.7, ask: 0.71 },
  "0x-reconcile-b": { price: 0.72, bid: 0.71, ask: 0.72 },
};

const polymarketAdapter: MarketAdapter = {
  marketId: "polymarket",
  displayName: "Polymarket",
  description: "mock polymarket adapter",
  symbolFormat: "mock",
  priceRange: [0.01, 0.99],
  capabilities: ["search", "quote", "orderbook", "resolve"],
  search: async (query) => {
    const lowered = query.toLowerCase();
    return [
      { symbol: "0x-market-fill", name: "Market Fill Contract", metadata: { category: "test" } },
      { symbol: "0x-pending", name: "Pending Contract", metadata: { category: "test" } },
      { symbol: "0x-reconcile-a", name: "Reconcile Contract A", metadata: { category: "test" } },
      { symbol: "0x-reconcile-b", name: "Reconcile Contract B", metadata: { category: "test" } },
    ].filter((item) => item.symbol.includes(lowered) || item.name.toLowerCase().includes(lowered));
  },
  getQuote: async (symbol) => {
    const quote = quoteBySymbol[symbol] ?? { price: 0.6, bid: 0.59, ask: 0.6 };
    return { symbol, ...quote, timestamp: new Date().toISOString() };
  },
  getOrderbook: async (symbol) => ({
    symbol,
    bids: [{ price: 0.49, size: 120 }],
    asks: [{ price: 0.51, size: 130 }],
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

const quoteOnlyAdapter: MarketAdapter = {
  marketId: "quote-only",
  displayName: "Quote Only",
  description: "adapter to validate capability guard rails",
  symbolFormat: "mock",
  priceRange: [0.01, 1],
  capabilities: ["quote"],
  search: async () => [],
  getQuote: async (symbol) => ({
    symbol,
    price: 0.4,
    bid: 0.39,
    ask: 0.4,
    timestamp: new Date().toISOString(),
  }),
};

const resetDatabase = async (): Promise<void> => {
  await sqlite.execute("DELETE FROM trades");
  await sqlite.execute("DELETE FROM orders");
  await sqlite.execute("DELETE FROM positions");
  await sqlite.execute("DELETE FROM journal");
  await sqlite.execute("DELETE FROM api_keys");
  await sqlite.execute("DELETE FROM accounts");
  await sqlite.execute("DELETE FROM users");
};

const registerUser = async (name: string): Promise<RegisterPayload> => {
  const response = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });

  expect(response.status).toBe(201);
  return (await response.json()) as RegisterPayload;
};

const authedJson = async (
  path: string,
  apiKey: string,
  init: Omit<RequestInit, "headers"> & { headers?: HeadersInit } = {},
): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey}`);
  return app.request(path, {
    ...init,
    headers,
  });
};

beforeAll(async () => {
  const [{ createApp }, dbModule, schemaModule] = await Promise.all([
    import("../src/app.js"),
    import("../src/db/client.js"),
    import("../src/db/schema.js"),
  ]);

  await dbModule.migrate();
  db = dbModule.db;
  sqlite = dbModule.sqlite;
  tables = schemaModule;

  const registry = new MarketRegistry();
  registry.register(polymarketAdapter);
  registry.register(quoteOnlyAdapter);

  app = createApp({ registry });
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await rm(dbFilePath, { force: true });
  await rm(`${dbFilePath}-wal`, { force: true });
  await rm(`${dbFilePath}-shm`, { force: true });
});

describe("api integration", () => {
  it("serves meta endpoints and protects authenticated routes", async () => {
    const healthResponse = await app.request("/health");
    expect(healthResponse.status).toBe(200);
    const health = await healthResponse.json();
    expect(health.status).toBe("ok");
    expect(health.markets.polymarket).toBe("available");
    expect(health.markets["quote-only"]).toBe("available");

    const openApiResponse = await app.request("/openapi.json");
    expect(openApiResponse.status).toBe(200);
    const openApi = await openApiResponse.json();
    expect(openApi.openapi).toBe("3.1.0");
    expect(openApi.paths["/api/orders/reconcile"]).toBeDefined();
    expect(openApi.paths["/api/admin/overview"]).toBeDefined();

    const unauthorizedOrders = await app.request("/api/orders");
    expect(unauthorizedOrders.status).toBe(401);
    const unauthorizedPayload = await unauthorizedOrders.json();
    expect(unauthorizedPayload.error.code).toBe("UNAUTHORIZED");
  });

  it("covers auth key lifecycle and admin constraints", async () => {
    const user = await registerUser("auth-user");

    const createKeyResponse = await authedJson("/api/auth/keys", user.apiKey, {
      method: "POST",
    });
    expect(createKeyResponse.status).toBe(201);
    const createKeyPayload = await createKeyResponse.json();
    expect(createKeyPayload.id).toBeDefined();
    expect(createKeyPayload.apiKey).toBeDefined();
    expect(createKeyPayload.prefix).toMatch(/^pt_live_/);
    expect(createKeyPayload.prefix).toMatch(/\*{4}$/);

    const revokeResponse = await authedJson(`/api/auth/keys/${createKeyPayload.id as string}`, user.apiKey, {
      method: "DELETE",
    });
    expect(revokeResponse.status).toBe(200);
    expect((await revokeResponse.json()).revoked).toBe(true);

    const revokedKeyRequest = await authedJson("/api/markets", createKeyPayload.apiKey as string);
    expect(revokedKeyRequest.status).toBe(401);

    const adminCreateKey = await authedJson("/api/auth/keys", "admin_test_key", {
      method: "POST",
    });
    expect(adminCreateKey.status).toBe(400);
    expect((await adminCreateKey.json()).error.code).toBe("INVALID_USER");

    const adminRevokeKey = await authedJson(`/api/auth/keys/${createKeyPayload.id as string}`, "admin_test_key", {
      method: "DELETE",
    });
    expect(adminRevokeKey.status).toBe(400);
    expect((await adminRevokeKey.json()).error.code).toBe("INVALID_USER");
  });

  it("covers account creation, retrieval, ownership checks, and invalid JSON handling", async () => {
    const owner = await registerUser("owner-account-user");
    const other = await registerUser("other-account-user");

    const invalidJsonResponse = await authedJson("/api/accounts", owner.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });
    expect(invalidJsonResponse.status).toBe(400);
    expect((await invalidJsonResponse.json()).error.code).toBe("INVALID_JSON");

    const missingReasoningResponse = await authedJson("/api/accounts", owner.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "strategy-a" }),
    });
    expect(missingReasoningResponse.status).toBe(400);
    expect((await missingReasoningResponse.json()).error.code).toBe("REASONING_REQUIRED");

    const createAccountResponse = await authedJson("/api/accounts", owner.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "strategy-a",
        reasoning: "Segregate event-driven strategy from baseline account",
      }),
    });
    expect(createAccountResponse.status).toBe(201);
    const createAccountPayload = await createAccountResponse.json();

    const ownerGetAccount = await authedJson(`/api/accounts/${createAccountPayload.id as string}`, owner.apiKey);
    expect(ownerGetAccount.status).toBe(200);

    const otherGetAccount = await authedJson(`/api/accounts/${createAccountPayload.id as string}`, other.apiKey);
    expect(otherGetAccount.status).toBe(404);
    expect((await otherGetAccount.json()).error.code).toBe("ACCOUNT_NOT_FOUND");

    const adminGetAccount = await authedJson(`/api/accounts/${createAccountPayload.id as string}`, "admin_test_key");
    expect(adminGetAccount.status).toBe(200);
  });

  it("covers market discovery and capability-guarded market data endpoints", async () => {
    const user = await registerUser("market-user");

    const marketsResponse = await authedJson("/api/markets", user.apiKey);
    expect(marketsResponse.status).toBe(200);
    const marketsPayload = await marketsResponse.json();
    expect(marketsPayload.markets.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(["polymarket", "quote-only"]),
    );

    const searchResponse = await authedJson("/api/markets/polymarket/search?q=reconcile", user.apiKey);
    expect(searchResponse.status).toBe(200);
    const searchPayload = await searchResponse.json();
    expect(searchPayload.results.length).toBeGreaterThan(0);

    const quoteResponse = await authedJson("/api/markets/polymarket/quote?symbol=0x-market-fill", user.apiKey);
    expect(quoteResponse.status).toBe(200);
    const quotePayload = await quoteResponse.json();
    expect(quotePayload.price).toBe(0.52);

    const orderbookResponse = await authedJson("/api/markets/polymarket/orderbook?symbol=0x-market-fill", user.apiKey);
    expect(orderbookResponse.status).toBe(200);
    const orderbookPayload = await orderbookResponse.json();
    expect(Array.isArray(orderbookPayload.bids)).toBe(true);

    const resolveResponse = await authedJson("/api/markets/polymarket/resolve?symbol=0x-market-fill", user.apiKey);
    expect(resolveResponse.status).toBe(200);
    const resolvePayload = await resolveResponse.json();
    expect(resolvePayload.resolved).toBe(false);

    const missingMarket = await authedJson("/api/markets/missing/quote?symbol=0x-market-fill", user.apiKey);
    expect(missingMarket.status).toBe(404);
    expect((await missingMarket.json()).error.code).toBe("MARKET_NOT_FOUND");

    const unsupportedSearch = await authedJson("/api/markets/quote-only/search?q=abc", user.apiKey);
    expect(unsupportedSearch.status).toBe(400);
    expect((await unsupportedSearch.json()).error.code).toBe("CAPABILITY_NOT_SUPPORTED");

    const unsupportedOrderbook = await authedJson("/api/markets/quote-only/orderbook?symbol=abc", user.apiKey);
    expect(unsupportedOrderbook.status).toBe(400);
    expect((await unsupportedOrderbook.json()).error.code).toBe("CAPABILITY_NOT_SUPPORTED");

    const unsupportedResolve = await authedJson("/api/markets/quote-only/resolve?symbol=abc", user.apiKey);
    expect(unsupportedResolve.status).toBe(400);
    expect((await unsupportedResolve.json()).error.code).toBe("CAPABILITY_NOT_SUPPORTED");
  });

  it("covers order lifecycle, journal filtering, and timeline aggregation", async () => {
    const user = await registerUser("lifecycle-user");
    quoteBySymbol["0x-pending"] = { price: 0.66, bid: 0.65, ask: 0.66 };

    const pendingOrderResponse = await authedJson("/api/orders", user.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: user.account.id,
        market: "polymarket",
        symbol: "0x-pending",
        side: "buy",
        type: "limit",
        quantity: 9,
        limitPrice: 0.4,
        reasoning: "Place resting order while waiting for better entry",
      }),
    });
    expect(pendingOrderResponse.status).toBe(201);
    const pendingOrder = await pendingOrderResponse.json();
    expect(pendingOrder.status).toBe("pending");

    const listOrdersResponse = await authedJson(
      `/api/orders?accountId=${user.account.id}&status=pending&market=polymarket&symbol=0x-pending`,
      user.apiKey,
    );
    expect(listOrdersResponse.status).toBe(200);
    const listOrdersPayload = await listOrdersResponse.json();
    expect(listOrdersPayload.orders).toHaveLength(1);

    const cancelMissingReasoning = await authedJson(`/api/orders/${pendingOrder.id as string}`, user.apiKey, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(cancelMissingReasoning.status).toBe(400);
    expect((await cancelMissingReasoning.json()).error.code).toBe("REASONING_REQUIRED");

    const cancelResponse = await authedJson(`/api/orders/${pendingOrder.id as string}`, user.apiKey, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reasoning: "Thesis invalidated by new information" }),
    });
    expect(cancelResponse.status).toBe(200);
    expect((await cancelResponse.json()).status).toBe("cancelled");

    const cancelAgainResponse = await authedJson(`/api/orders/${pendingOrder.id as string}`, user.apiKey, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reasoning: "Trying to cancel again" }),
    });
    expect(cancelAgainResponse.status).toBe(400);
    expect((await cancelAgainResponse.json()).error.code).toBe("INVALID_ORDER");

    const journalCreateResponse = await authedJson("/api/journal", user.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "Tracking sentiment divergence in related contracts",
        tags: ["strategy", "sentiment"],
      }),
    });
    expect(journalCreateResponse.status).toBe(201);

    const journalFilteredResponse = await authedJson(
      "/api/journal?limit=10&offset=0&q=sentiment&tags=strategy",
      user.apiKey,
    );
    expect(journalFilteredResponse.status).toBe(200);
    const journalFilteredPayload = await journalFilteredResponse.json();
    expect(journalFilteredPayload.entries).toHaveLength(1);

    const timelineResponse = await authedJson(`/api/accounts/${user.account.id}/timeline?limit=20&offset=0`, user.apiKey);
    expect(timelineResponse.status).toBe(200);
    const timelinePayload = await timelineResponse.json();
    expect(Array.isArray(timelinePayload.events)).toBe(true);
    expect(timelinePayload.events.some((event: { type: string }) => event.type === "order_cancelled")).toBe(true);
    expect(timelinePayload.events.some((event: { type: string }) => event.type === "journal")).toBe(true);

    const adminJournalAccess = await authedJson("/api/journal", "admin_test_key");
    expect(adminJournalAccess.status).toBe(400);
    expect((await adminJournalAccess.json()).error.code).toBe("INVALID_USER");
  });

  it("covers market order fills, portfolio values, positions visibility, and sqlite persistence", async () => {
    const owner = await registerUser("portfolio-owner");
    const outsider = await registerUser("portfolio-outsider");

    quoteBySymbol["0x-market-fill"] = { price: 0.52, bid: 0.51, ask: 0.52 };

    const orderResponse = await authedJson("/api/orders", owner.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: owner.account.id,
        market: "polymarket",
        symbol: "0x-market-fill",
        side: "buy",
        type: "market",
        quantity: 20,
        reasoning: "Establish initial directional exposure",
      }),
    });
    expect(orderResponse.status).toBe(201);
    const orderPayload = await orderResponse.json();
    expect(orderPayload.status).toBe("filled");
    expect(orderPayload.filledPrice).toBe(0.52);

    const positionsResponse = await authedJson(`/api/positions?accountId=${owner.account.id}`, owner.apiKey);
    expect(positionsResponse.status).toBe(200);
    const positionsPayload = await positionsResponse.json();
    expect(positionsPayload.positions).toHaveLength(1);
    expect(positionsPayload.positions[0].quantity).toBe(20);

    const outsiderPositions = await authedJson(`/api/positions?accountId=${owner.account.id}`, outsider.apiKey);
    expect(outsiderPositions.status).toBe(404);
    expect((await outsiderPositions.json()).error.code).toBe("ACCOUNT_NOT_FOUND");

    const portfolioResponse = await authedJson(`/api/accounts/${owner.account.id}/portfolio`, owner.apiKey);
    expect(portfolioResponse.status).toBe(200);
    const portfolioPayload = await portfolioResponse.json();
    expect(portfolioPayload.positions).toHaveLength(1);
    expect(portfolioPayload.totalPnl).toBeCloseTo(0, 6);

    const expectedBalance = Number((INITIAL_BALANCE - 20 * 0.52).toFixed(6));
    expect(portfolioPayload.balance).toBeCloseTo(expectedBalance, 6);
    expect(portfolioPayload.totalValue).toBeCloseTo(expectedBalance + 20 * 0.52, 6);

    const orderRows = await db.select().from(tables.orders).where(eq(tables.orders.accountId, owner.account.id)).all();
    const tradeRows = await db.select().from(tables.trades).where(eq(tables.trades.accountId, owner.account.id)).all();
    const positionRows = await db.select().from(tables.positions).where(eq(tables.positions.accountId, owner.account.id)).all();
    const accountRows = await db.select().from(tables.accounts).where(eq(tables.accounts.id, owner.account.id)).all();

    expect(orderRows).toHaveLength(1);
    expect(orderRows[0]?.status).toBe("filled");
    expect(tradeRows).toHaveLength(1);
    expect(positionRows).toHaveLength(1);
    expect(accountRows[0]?.balance).toBeCloseTo(expectedBalance, 6);
  });

  it("covers reconcile endpoint for user scope and admin-wide scope", async () => {
    const userA = await registerUser("reconcile-a");
    const userB = await registerUser("reconcile-b");

    quoteBySymbol["0x-reconcile-a"] = { price: 0.71, bid: 0.7, ask: 0.71 };
    quoteBySymbol["0x-reconcile-b"] = { price: 0.72, bid: 0.71, ask: 0.72 };

    const pendingA = await authedJson("/api/orders", userA.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: userA.account.id,
        market: "polymarket",
        symbol: "0x-reconcile-a",
        side: "buy",
        type: "limit",
        quantity: 10,
        limitPrice: 0.5,
        reasoning: "Wait for improved entry",
      }),
    });
    expect(pendingA.status).toBe(201);
    const pendingAPayload = await pendingA.json();
    expect(pendingAPayload.status).toBe("pending");

    const pendingB = await authedJson("/api/orders", userB.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: userB.account.id,
        market: "polymarket",
        symbol: "0x-reconcile-b",
        side: "buy",
        type: "limit",
        quantity: 12,
        limitPrice: 0.5,
        reasoning: "Wait for improved entry",
      }),
    });
    expect(pendingB.status).toBe(201);

    const userScopeReconcile = await authedJson("/api/orders/reconcile", userA.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: userA.account.id, reasoning: "Check marketability for my account" }),
    });
    expect(userScopeReconcile.status).toBe(200);
    const userScopePayload = await userScopeReconcile.json();
    expect(userScopePayload.filled).toBe(0);

    const forbiddenAccountReconcile = await authedJson("/api/orders/reconcile", userA.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: userB.account.id, reasoning: "Try unauthorized account" }),
    });
    expect(forbiddenAccountReconcile.status).toBe(404);
    expect((await forbiddenAccountReconcile.json()).error.code).toBe("ACCOUNT_NOT_FOUND");

    quoteBySymbol["0x-reconcile-a"] = { price: 0.45, bid: 0.44, ask: 0.45 };
    quoteBySymbol["0x-reconcile-b"] = { price: 0.46, bid: 0.45, ask: 0.46 };

    const adminReconcile = await authedJson("/api/orders/reconcile", "admin_test_key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reasoning: "Reconcile all marketable pending orders" }),
    });
    expect(adminReconcile.status).toBe(200);
    const adminReconcilePayload = await adminReconcile.json();
    expect(adminReconcilePayload.processed).toBeGreaterThanOrEqual(2);
    expect(adminReconcilePayload.filled).toBe(2);
    expect(adminReconcilePayload.filledOrderIds).toEqual(
      expect.arrayContaining([pendingAPayload.id as string]),
    );

    const filledOrdersA = await authedJson(`/api/orders?accountId=${userA.account.id}&status=filled`, userA.apiKey);
    expect(filledOrdersA.status).toBe(200);
    expect((await filledOrdersA.json()).orders).toHaveLength(1);

    const filledOrdersB = await authedJson(`/api/orders?accountId=${userB.account.id}&status=filled`, userB.apiKey);
    expect(filledOrdersB.status).toBe(200);
    expect((await filledOrdersB.json()).orders).toHaveLength(1);
  });

  it("covers admin-only fund management and overview aggregation", async () => {
    const user = await registerUser("admin-overview-user");

    const userAccessAdminEndpoint = await authedJson(`/api/admin/accounts/${user.account.id}/deposit`, user.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 100 }),
    });
    expect(userAccessAdminEndpoint.status).toBe(403);
    expect((await userAccessAdminEndpoint.json()).error.code).toBe("FORBIDDEN");

    const depositResponse = await authedJson(`/api/admin/accounts/${user.account.id}/deposit`, "admin_test_key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 250 }),
    });
    expect(depositResponse.status).toBe(200);
    expect((await depositResponse.json()).balance).toBeCloseTo(INITIAL_BALANCE + 250, 6);

    const withdrawResponse = await authedJson(`/api/admin/accounts/${user.account.id}/withdraw`, "admin_test_key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 100 }),
    });
    expect(withdrawResponse.status).toBe(200);
    expect((await withdrawResponse.json()).balance).toBeCloseTo(INITIAL_BALANCE + 150, 6);

    const overdrawResponse = await authedJson(`/api/admin/accounts/${user.account.id}/withdraw`, "admin_test_key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: INITIAL_BALANCE * 10 }),
    });
    expect(overdrawResponse.status).toBe(400);
    expect((await overdrawResponse.json()).error.code).toBe("INSUFFICIENT_BALANCE");

    const placeOrderResponse = await authedJson("/api/orders", user.apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: user.account.id,
        market: "polymarket",
        symbol: "0x-market-fill",
        side: "buy",
        type: "market",
        quantity: 5,
        reasoning: "Seed position for overview aggregation",
      }),
    });
    expect(placeOrderResponse.status).toBe(201);

    const overviewResponse = await authedJson("/api/admin/overview", "admin_test_key");
    expect(overviewResponse.status).toBe(200);
    const overviewPayload = await overviewResponse.json();
    expect(overviewPayload.totals.users).toBe(1);
    expect(Array.isArray(overviewPayload.markets)).toBe(true);
    expect(Array.isArray(overviewPayload.agents)).toBe(true);
    expect(
      overviewPayload.agents.some((agent: { userId: string }) => agent.userId === user.userId),
    ).toBe(true);

    const indexListResult = await sqlite.execute("PRAGMA index_list('positions')");
    const hasUniqueIndex = indexListResult.rows.some((row) => {
      const typed = row as Record<string, unknown>;
      return typed.name === "positions_unique_idx";
    });
    expect(hasUniqueIndex).toBe(true);
  });

  it("persists register-created user/account/api-key rows in sqlite", async () => {
    const user = await registerUser("sqlite-persistence-user");

    const userRows = await db.select().from(tables.users).where(eq(tables.users.id, user.userId)).all();
    const accountRows = await db.select().from(tables.accounts).where(eq(tables.accounts.id, user.account.id)).all();
    const keyRows = await db.select().from(tables.apiKeys).where(eq(tables.apiKeys.userId, user.userId)).all();

    expect(userRows).toHaveLength(1);
    expect(accountRows).toHaveLength(1);
    expect(accountRows[0]?.balance).toBe(INITIAL_BALANCE);
    expect(keyRows).toHaveLength(1);
    expect(keyRows[0]?.revokedAt).toBeNull();
  });
});
