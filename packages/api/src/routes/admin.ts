import {
  adminAmountSchema,
  INITIAL_BALANCE,
  paginationQuerySchema,
  placeOrderSchema,
  registerSchema,
  symbolTradesQuerySchema,
} from "@unimarket/core";
import type { MarketRegistry } from "@unimarket/markets";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { AppVariables } from "../platform/auth.js";
import { db } from "../db/client.js";
import { accounts, journal, trades, users } from "../db/schema.js";
import { jsonError } from "../platform/errors.js";
import {
  getUserAccountScope,
  parseJson,
  parseQuery,
  requireUserRecord,
  withErrorHandling,
} from "../platform/helpers.js";
import { beginIdempotentRequest, storeIdempotentJsonResponse } from "../platform/idempotency.js";
import { buildAdminOverviewModel } from "../services/admin-overview.js";
import { buildEquityHistoryModel } from "../services/equity-history.js";
import { createOrderPlacementService } from "../services/order-placement.js";
import { buildAccountPortfolioModel } from "../services/portfolio-read.js";
import { buildTimelineEvents } from "../timeline.js";
import { makeId, nowIso } from "../utils.js";

export const createAdminRoutes = (registry: MarketRegistry) => {
  const router = new Hono<{ Variables: AppVariables }>();
  const { placeOrderForAccount } = createOrderPlacementService(registry);

  const adjustUserBalance = async (
    userId: string,
    amountDelta: number,
  ): Promise<
    { ok: true; balance: number }
    | { ok: false; code: "ACCOUNT_NOT_FOUND" | "INSUFFICIENT_BALANCE"; message: string; status: 404 | 400 }
  > => {
    const accountScope = await getUserAccountScope(userId);
    if (!accountScope.account) {
      return { ok: false, status: 404, code: "ACCOUNT_NOT_FOUND", message: "Account not found" };
    }

    if (amountDelta < 0 && accountScope.account.balance < Math.abs(amountDelta)) {
      return {
        ok: false,
        status: 400,
        code: "INSUFFICIENT_BALANCE",
        message: "Insufficient balance for withdrawal",
      };
    }

    const nextBalance = Number((accountScope.account.balance + amountDelta).toFixed(6));
    await db.update(accounts).set({ balance: nextBalance }).where(eq(accounts.id, accountScope.account.id)).run();
    return { ok: true, balance: nextBalance };
  };

  router.post(
    "/users/:id/deposit",
    withErrorHandling(async (c) => {
      const parsed = await parseJson(c, adminAmountSchema);
      if (!parsed.success) return parsed.response;

      const userId = c.req.param("id");
      const result = await adjustUserBalance(userId, parsed.data.amount);
      if (!result.ok) return jsonError(c, result.status, result.code, result.message);
      return c.json({ balance: result.balance });
    }),
  );

  router.post(
    "/users/:id/withdraw",
    withErrorHandling(async (c) => {
      const parsed = await parseJson(c, adminAmountSchema);
      if (!parsed.success) return parsed.response;

      const userId = c.req.param("id");
      const result = await adjustUserBalance(userId, -parsed.data.amount);
      if (!result.ok) return jsonError(c, result.status, result.code, result.message);
      return c.json({ balance: result.balance });
    }),
  );

  router.get(
    "/overview",
    withErrorHandling(async (c) => {
      return c.json(await buildAdminOverviewModel({ registry }));
    }),
  );

  router.get(
    "/users/:id/timeline",
    withErrorHandling(async (c) => {
      const userId = c.req.param("id");
      const userResult = await requireUserRecord(c, userId);
      if (!userResult.success) return userResult.response;

      const parsedQuery = parseQuery(c, paginationQuerySchema);
      if (!parsedQuery.success) return parsedQuery.response;

      const accountScope = await getUserAccountScope(userId);
      const events = await buildTimelineEvents({
        registry,
        userId,
        accountId: accountScope.account?.id ?? null,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
      });

      return c.json({ events });
    }),
  );

  router.get(
    "/equity-history",
    withErrorHandling(async (c) => {
      return c.json(await buildEquityHistoryModel(c.req.query("range") ?? "1m"));
    }),
  );

  // ─── POST /traders — Create a dedicated trader account ─────────────────────

  router.post(
    "/traders",
    withErrorHandling(async (c) => {
      const parsed = await parseJson(c, registerSchema);
      if (!parsed.success) return parsed.response;

      const createdAt = nowIso();
      const userId = makeId("usr");
      const accountId = makeId("acc");
      const userName = parsed.data.userName;

      await db.insert(users).values({ id: userId, name: userName, createdAt }).run();
      await db
        .insert(accounts)
        .values({
          id: accountId,
          userId,
          balance: INITIAL_BALANCE,
          name: `${userName}-main`,
          reasoning: "Trader account created by admin",
          createdAt,
        })
        .run();

      return c.json({ userId, userName, accountId, balance: INITIAL_BALANCE }, 201);
    }),
  );

  // ─── GET /users/:id/portfolio — Single-user portfolio view ─────────────────

  router.get(
    "/users/:id/portfolio",
    withErrorHandling(async (c) => {
      const userId = c.req.param("id");
      const userResult = await requireUserRecord(c, userId);
      if (!userResult.success) return userResult.response;

      const accountScope = await getUserAccountScope(userId);
      if (!accountScope.account) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");

      const portfolio = await buildAccountPortfolioModel({
        account: accountScope.account,
        registry,
        includeRecentOrders: true,
        tolerateQuoteFailures: true,
        includeMissingAdapterAsUnpriced: true,
      });

      return c.json({
        userId: userResult.user.id,
        userName: userResult.user.name,
        accountId: portfolio.accountId,
        balance: portfolio.balance,
        positions: portfolio.positions,
        openOrders: portfolio.openOrders,
        recentOrders: portfolio.recentOrders,
        totalValue: portfolio.totalValue,
        totalPnl: portfolio.totalPnl,
        totalFunding: portfolio.totalFunding,
      });
    }),
  );

  // ─── POST /users/:id/orders — Admin places order on behalf of a user ───────

  router.post(
    "/users/:id/orders",
    withErrorHandling(async (c) => {
      const userId = c.req.param("id");
      const userResult = await requireUserRecord(c, userId);
      if (!userResult.success) return userResult.response;

      const parsed = await parseJson(c, placeOrderSchema);
      if (!parsed.success) return parsed.response;

      const accountScope = await getUserAccountScope(userId, parsed.data.accountId);
      if (!accountScope.account) {
        return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");
      }

      const adminUserId = c.get("userId");
      const idempotency = await beginIdempotentRequest(c, adminUserId, { targetUserId: userId, ...parsed.data });
      if (idempotency.kind === "response") {
        return idempotency.response;
      }
      const placement = await placeOrderForAccount({ account: accountScope.account, order: parsed.data });
      if (placement.kind === "error") {
        return jsonError(c, placement.status, placement.code, placement.message);
      }

      const response = c.json(placement.order, 201);
      await storeIdempotentJsonResponse(idempotency.candidate, response);
      return response;
    }),
  );
  // ─── GET /users/:id/symbol-trades — Per-symbol trade history for charts ─────

  router.get(
    "/users/:id/symbol-trades",
    withErrorHandling(async (c) => {
      const userId = c.req.param("id");
      const userResult = await requireUserRecord(c, userId);
      if (!userResult.success) return userResult.response;

      const parsedQuery = parseQuery(c, symbolTradesQuerySchema);
      if (!parsedQuery.success) return parsedQuery.response;

      const accountScope = await getUserAccountScope(userId);
      if (!accountScope.account) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");

      let symbolFilter = parsedQuery.data.symbol;
      const marketAdapter = registry.get(parsedQuery.data.market);
      if (marketAdapter?.normalizeReference) {
        try {
          symbolFilter = await marketAdapter.normalizeReference(parsedQuery.data.symbol);
        } catch {
          // use original symbol if normalization fails
        }
      }

      const tradeRows = await db
        .select({
          side: trades.side,
          quantity: trades.quantity,
          price: trades.price,
          fee: trades.fee,
          createdAt: trades.createdAt,
        })
        .from(trades)
        .where(
          and(
            eq(trades.accountId, accountScope.account.id),
            eq(trades.market, parsedQuery.data.market),
            eq(trades.symbol, symbolFilter),
          ),
        )
        .orderBy(desc(trades.createdAt))
        .limit(parsedQuery.data.limit)
        .all();

      return c.json({ trades: tradeRows });
    }),
  );

  return router;
};
