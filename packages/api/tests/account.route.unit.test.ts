import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

const loadRoutes = async (opts: {
  userId?: string;
  account: { id: string; userId: string; name: string; balance: number; createdAt: string } | null;
  parsedQuery?: { success: true; data: { limit: number; offset: number } } | { success: false; response: Response };
  portfolio?: Record<string, unknown>;
  timeline?: unknown[];
}) => {
  vi.resetModules();
  const getUserAccountScope = vi.fn().mockResolvedValue({ account: opts.account, mismatch: false });
  const parseQuery = vi.fn(() => opts.parsedQuery ?? { success: true, data: { limit: 20, offset: 0 } });
  const buildAccountPortfolioModel = vi.fn().mockResolvedValue(
    opts.portfolio ?? {
      accountId: opts.account?.id ?? "acct_1",
      balance: opts.account?.balance ?? 0,
      positions: [],
      openOrders: [],
      totalValue: 0,
      totalPnl: 0,
      totalFunding: 0,
    },
  );
  const buildTimelineEvents = vi.fn().mockResolvedValue(opts.timeline ?? []);

  vi.doMock("../src/platform/helpers.js", () => ({
    getUserAccountScope,
    parseQuery,
    requireNonAdminUserId: (c: { get: (key: string) => string | undefined }, message: string) => {
      const userId = c.get("userId");
      if (!userId || userId === "admin") {
        return {
          success: false,
          response: new Response(JSON.stringify({ error: { code: "INVALID_USER", message } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        };
      }
      return { success: true, userId };
    },
    withErrorHandling: (fn: (c: unknown) => Promise<Response>) => fn,
  }));
  vi.doMock("../src/services/portfolio-read.js", () => ({ buildAccountPortfolioModel }));
  vi.doMock("../src/timeline.js", () => ({ buildTimelineEvents }));
  vi.doMock("../src/platform/errors.js", () => ({
    jsonError: (_c: unknown, status: number, code: string, message: string) =>
      new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "content-type": "application/json" } }),
  }));

  const { createAccountRoutes } = await import("../src/routes/account.js");
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId", opts.userId as never);
    await next();
  });
  app.route("/account", createAccountRoutes({} as never));
  return { app, getUserAccountScope, parseQuery, buildAccountPortfolioModel, buildTimelineEvents };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("account routes", () => {
  it("enforces permission boundaries and missing account handling", async () => {
    const admin = await loadRoutes({ userId: "admin", account: null });
    const adminRes = await admin.app.request("/account");
    expect(adminRes.status).toBe(400);

    const missing = await loadRoutes({ userId: "usr_1", account: null });
    const missingRes = await missing.app.request("/account");
    expect(missingRes.status).toBe(404);
  });

  it("returns account details and normalized portfolio fields", async () => {
    const account = { id: "acct_1", userId: "usr_1", name: "Agent", balance: 100, createdAt: "2026-03-07T00:00:00.000Z" };
    const routes = await loadRoutes({
      userId: "usr_1",
      account,
      portfolio: {
        accountId: account.id,
        balance: account.balance,
        positions: [
          {
            market: "hyperliquid",
            symbol: "BTC",
            quantity: 1,
            avgCost: 100,
            currentPrice: 90,
            unrealizedPnl: null,
            marketValue: null,
            accumulatedFunding: 1,
            notional: 90,
            positionEquity: 5,
            leverage: 5,
            margin: 10,
            maintenanceMargin: 4,
            liquidationPrice: 80,
          },
        ],
        openOrders: [{ id: "ord_1" }],
        totalValue: 105,
        totalPnl: 0,
        totalFunding: 1,
      },
    });

    const accountRes = await routes.app.request("/account");
    await expect(accountRes.json()).resolves.toEqual({ id: account.id, name: account.name, balance: 100, createdAt: account.createdAt });

    const portfolioRes = await routes.app.request("/account/portfolio");
    await expect(portfolioRes.json()).resolves.toEqual({
      accountId: account.id,
      balance: 100,
      positions: [
        {
          market: "hyperliquid",
          symbol: "BTC",
          quantity: 1,
          avgCost: 100,
          currentPrice: 90,
          unrealizedPnl: 0,
          marketValue: 0,
          accumulatedFunding: 1,
          notional: 90,
          positionEquity: 5,
          leverage: 5,
          margin: 10,
          maintenanceMargin: 4,
          liquidationPrice: 80,
        },
      ],
      openOrders: [{ id: "ord_1" }],
      totalValue: 105,
      totalPnl: 0,
      totalFunding: 1,
    });
    expect(routes.buildAccountPortfolioModel).toHaveBeenCalledWith(expect.objectContaining({ tolerateQuoteFailures: false, includeMissingAdapterAsUnpriced: false }));
  });

  it("returns query validation failures and timeline payloads", async () => {
    const account = { id: "acct_1", userId: "usr_1", name: "Agent", balance: 100, createdAt: "2026-03-07T00:00:00.000Z" };
    const invalid = await loadRoutes({ userId: "usr_1", account, parsedQuery: { success: false, response: new Response("bad", { status: 400 }) } });
    const invalidRes = await invalid.app.request("/account/timeline");
    expect(invalidRes.status).toBe(400);

    const ok = await loadRoutes({ userId: "usr_1", account, timeline: [{ id: "evt_1" }] });
    const okRes = await ok.app.request("/account/timeline?limit=10&offset=0");
    await expect(okRes.json()).resolves.toEqual({ events: [{ id: "evt_1" }] });
    expect(ok.buildTimelineEvents).toHaveBeenCalledWith(expect.objectContaining({ userId: "usr_1", accountId: "acct_1", limit: 20, offset: 0 }));
  });
});
