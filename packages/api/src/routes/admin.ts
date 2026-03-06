import {
  adminAmountSchema,
  calculateMarketValue,
  calculatePerpMaintenanceMargin,
  calculatePerpPositionEquity,
  calculatePerpUnrealizedPnl,
  calculateUnrealizedPnl,
  INITIAL_BALANCE,
  paginationQuerySchema,
  placeOrderSchema,
  registerSchema,
} from "@unimarket/core";
import type { MarketRegistry } from "@unimarket/markets";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { Hono } from "hono";

import type { AppVariables } from "../auth.js";
import { db } from "../db/client.js";
import { accounts, equitySnapshots, fundingPayments, journal, orders, perpPositionState, positions, users } from "../db/schema.js";
import { jsonError } from "../errors.js";
import { getUserAccount, parseJson, parseQuery, withErrorHandling } from "../helpers.js";
import { checkIdempotency, storeIdempotencyResponse } from "../idempotency.js";
import { createOrderPlacementService } from "../services/order-placement.js";
import { resolveSymbolsWithCache } from "../symbol-metadata.js";
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
    const account = await getUserAccount(userId);
    if (!account) {
      return { ok: false, status: 404, code: "ACCOUNT_NOT_FOUND", message: "Account not found" };
    }

    if (amountDelta < 0 && account.balance < Math.abs(amountDelta)) {
      return {
        ok: false,
        status: 400,
        code: "INSUFFICIENT_BALANCE",
        message: "Insufficient balance for withdrawal",
      };
    }

    const nextBalance = Number((account.balance + amountDelta).toFixed(6));
    await db.update(accounts).set({ balance: nextBalance }).where(eq(accounts.id, account.id)).run();
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
      const userRows = await db.select().from(users).all();
      const accountRows = await db.select().from(accounts).all();
      const positionRows = await db.select().from(positions).all();
      const perpStateRows = await db.select().from(perpPositionState).all();
      const perpStateByPositionId = new Map(perpStateRows.map((row) => [row.positionId, row]));

      const primaryAccountByUserId = new Map<string, (typeof accountRows)[number]>();
      for (const account of [...accountRows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        if (!primaryAccountByUserId.has(account.userId)) {
          primaryAccountByUserId.set(account.userId, account);
        }
      }

      const quotePriceByKey = new Map<string, number | null>();
      const quoteTimestampByKey = new Map<string, string | null>();

      for (const row of positionRows) {
        const key = `${row.market}::${row.symbol}`;
        if (quotePriceByKey.has(key)) continue;

        const adapter = registry.get(row.market);
        if (!adapter) {
          quotePriceByKey.set(key, null);
          quoteTimestampByKey.set(key, null);
          continue;
        }

        try {
          const quote = await adapter.getQuote(row.symbol);
          quotePriceByKey.set(key, quote.price);
          quoteTimestampByKey.set(key, quote.timestamp);
        } catch {
          quotePriceByKey.set(key, null);
          quoteTimestampByKey.set(key, null);
        }
      }

      // Resolve Polymarket symbol names and outcomes
      const pmPositionSymbols = new Set<string>();
      for (const row of positionRows) {
        if (row.market === "polymarket") pmPositionSymbols.add(row.symbol);
      }
      const positionResolution = await resolveSymbolsWithCache(registry, "polymarket", pmPositionSymbols);

      const positionsByAccount = new Map<string, Array<{
        market: string; symbol: string; symbolName: string | null; side: string | null; quantity: number; avgCost: number;
        currentPrice: number | null; marketValue: number | null;
        unrealizedPnl: number | null; quoteTimestamp: string | null;
        margin: number | null; maintenanceMargin: number | null; leverage: number | null; liquidationPrice: number | null;
      }>>();

      const marketSummaryById = new Map<string, {
        marketId: string; marketName: string; users: Set<string>;
        positions: number; totalQuantity: number; totalMarketValue: number;
        totalUnrealizedPnl: number; quotedPositions: number; unpricedPositions: number;
      }>();

      const accountById = new Map(accountRows.map((a) => [a.id, a]));

      for (const row of positionRows) {
        const account = accountById.get(row.accountId);
        if (!account) continue;

        const adapter = registry.get(row.market);
        const key = `${row.market}::${row.symbol}`;
        const currentPrice = quotePriceByKey.get(key) ?? null;
        const quoteTimestamp = quoteTimestampByKey.get(key) ?? null;
        const perpState = perpStateByPositionId.get(row.id);
        const isPerp = Boolean(adapter?.capabilities.includes("funding") && perpState);

        const unrealizedPnl = currentPrice === null
          ? null
          : isPerp
            ? calculatePerpUnrealizedPnl({ quantity: row.quantity, avgCost: row.avgCost }, currentPrice)
            : calculateUnrealizedPnl({ quantity: row.quantity, avgCost: row.avgCost }, currentPrice);
        const marketValue = currentPrice === null
          ? null
          : isPerp && perpState
            ? calculatePerpPositionEquity({ quantity: row.quantity, avgCost: row.avgCost, margin: perpState.margin }, currentPrice)
            : calculateMarketValue({ quantity: row.quantity, avgCost: row.avgCost }, currentPrice);
        const maintenanceMargin = currentPrice === null
          ? null
          : isPerp && perpState
            ? calculatePerpMaintenanceMargin(
              { quantity: row.quantity, maintenanceMarginRatio: perpState.maintenanceMarginRatio },
              currentPrice,
            )
            : null;

        if (!positionsByAccount.has(row.accountId)) positionsByAccount.set(row.accountId, []);
        positionsByAccount.get(row.accountId)?.push({
          market: row.market, symbol: row.symbol, symbolName: positionResolution.names.get(row.symbol) ?? null,
          side: positionResolution.outcomes.get(row.symbol) ?? null,
          quantity: row.quantity, avgCost: row.avgCost,
          currentPrice, marketValue, unrealizedPnl, quoteTimestamp,
          margin: perpState?.margin ?? null,
          maintenanceMargin,
          leverage: perpState?.leverage ?? null,
          liquidationPrice: perpState?.liquidationPrice ?? null,
        });

        if (!marketSummaryById.has(row.market)) {
          marketSummaryById.set(row.market, {
            marketId: row.market, marketName: adapter?.displayName ?? row.market,
            users: new Set(), positions: 0, totalQuantity: 0, totalMarketValue: 0,
            totalUnrealizedPnl: 0, quotedPositions: 0, unpricedPositions: 0,
          });
        }

        const ms = marketSummaryById.get(row.market)!;
        ms.positions += 1;
        ms.totalQuantity += row.quantity;
        ms.users.add(account.userId);

        if (marketValue === null || unrealizedPnl === null) {
          ms.unpricedPositions += 1;
        } else {
          ms.quotedPositions += 1;
          ms.totalMarketValue += marketValue;
          ms.totalUnrealizedPnl += unrealizedPnl;
        }
      }

      const agents = userRows
        .map((user) => {
          const primaryAccount = primaryAccountByUserId.get(user.id) ?? null;
          const agentPositions = [...(primaryAccount ? positionsByAccount.get(primaryAccount.id) ?? [] : [])].sort((a, b) =>
            `${a.market}:${a.symbol}`.localeCompare(`${b.market}:${b.symbol}`),
          );

          const totalBalance = Number((primaryAccount?.balance ?? 0).toFixed(6));
          const totalMarketValue = Number(agentPositions.reduce((sum, p) => sum + (p.marketValue ?? 0), 0).toFixed(6));
          const totalUnrealizedPnl = Number(agentPositions.reduce((sum, p) => sum + (p.unrealizedPnl ?? 0), 0).toFixed(6));
          const totalEquity = Number((totalBalance + totalMarketValue).toFixed(6));

          return {
            userId: user.id, userName: user.name, createdAt: user.createdAt,
            accountId: primaryAccount?.id ?? null, accountName: primaryAccount?.name ?? null,
            balance: totalBalance, positions: agentPositions,
            totals: { positions: agentPositions.length, balance: totalBalance, marketValue: totalMarketValue, unrealizedPnl: totalUnrealizedPnl, equity: totalEquity },
          };
        })
        .sort((a, b) => b.totals.equity - a.totals.equity);

      const markets = Array.from(marketSummaryById.values())
        .map((m) => ({
          marketId: m.marketId, marketName: m.marketName, users: m.users.size,
          positions: m.positions, totalQuantity: m.totalQuantity,
          totalMarketValue: Number(m.totalMarketValue.toFixed(6)),
          totalUnrealizedPnl: Number(m.totalUnrealizedPnl.toFixed(6)),
          quotedPositions: m.quotedPositions, unpricedPositions: m.unpricedPositions,
        }))
        .sort((a, b) => b.totalMarketValue - a.totalMarketValue);

      const totalBalance = Number(agents.reduce((sum, a) => sum + a.totals.balance, 0).toFixed(6));
      const totalMarketValue = Number(markets.reduce((sum, m) => sum + m.totalMarketValue, 0).toFixed(6));
      const totalUnrealizedPnl = Number(markets.reduce((sum, m) => sum + m.totalUnrealizedPnl, 0).toFixed(6));
      const totalEquity = Number((totalBalance + totalMarketValue).toFixed(6));

      const now = nowIso();

      // Snapshot writes are intentionally off the GET response hot-path.
      void (async () => {
        if (agents.length === 0) return;

        const userIds = agents.map((agent) => agent.userId);
        const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
        const recentRows = await db
          .select({ userId: equitySnapshots.userId })
          .from(equitySnapshots)
          .where(and(inArray(equitySnapshots.userId, userIds), gte(equitySnapshots.snapshotAt, fiveMinAgo)))
          .all();
        const recentlySnapshottedUserIds = new Set(recentRows.map((row) => row.userId));

        const pendingSnapshots = agents
          .filter((agent) => !recentlySnapshottedUserIds.has(agent.userId))
          .map((agent) => ({
            id: makeId("snap"),
            userId: agent.userId,
            balance: agent.totals.balance,
            marketValue: agent.totals.marketValue,
            equity: agent.totals.equity,
            unrealizedPnl: agent.totals.unrealizedPnl,
            snapshotAt: now,
          }));

        if (pendingSnapshots.length === 0) return;
        await db.insert(equitySnapshots).values(pendingSnapshots).run();
      })().catch((error) => {
        console.warn("[admin.overview] failed to record equity snapshots", error);
      });

      return c.json({
        generatedAt: now,
        totals: { users: userRows.length, positions: positionRows.length, balance: totalBalance, marketValue: totalMarketValue, unrealizedPnl: totalUnrealizedPnl, equity: totalEquity },
        markets,
        agents,
      });
    }),
  );

  router.get(
    "/users/:id/timeline",
    withErrorHandling(async (c) => {
      const userId = c.req.param("id");
      const user = await db.select().from(users).where(eq(users.id, userId)).get();
      if (!user) return jsonError(c, 404, "USER_NOT_FOUND", "User not found");

      const parsedQuery = parseQuery(c, paginationQuerySchema);
      if (!parsedQuery.success) return parsedQuery.response;

      const acc = await getUserAccount(userId);
      const events = await buildTimelineEvents({
        registry,
        userId,
        accountId: acc?.id ?? null,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
      });

      return c.json({ events });
    }),
  );

  const RANGE_MS: Record<string, number> = {
    "1w": 7 * 86_400_000,
    "1m": 30 * 86_400_000,
    "3m": 90 * 86_400_000,
    "6m": 180 * 86_400_000,
    "1y": 365 * 86_400_000,
  };

  router.get(
    "/equity-history",
    withErrorHandling(async (c) => {
      const range = (c.req.query("range") ?? "1m").toLowerCase();
      const ms = RANGE_MS[range] ?? RANGE_MS["1m"];
      const since = new Date(Date.now() - ms).toISOString();

      const rows = await db.select()
        .from(equitySnapshots)
        .where(gte(equitySnapshots.snapshotAt, since))
        .orderBy(equitySnapshots.snapshotAt)
        .all();

      // Group by userId
      const byUser = new Map<string, Array<{
        snapshotAt: string;
        equity: number;
        balance: number;
        marketValue: number;
        unrealizedPnl: number;
      }>>();

      for (const row of rows) {
        if (!byUser.has(row.userId)) byUser.set(row.userId, []);
        byUser.get(row.userId)!.push({
          snapshotAt: row.snapshotAt,
          equity: row.equity,
          balance: row.balance,
          marketValue: row.marketValue,
          unrealizedPnl: row.unrealizedPnl,
        });
      }

      // Get user names
      const userRows = await db.select().from(users).all();
      const nameById = new Map(userRows.map((u) => [u.id, u.name]));

      const series = Array.from(byUser.entries()).map(([userId, snapshots]) => ({
        userId,
        userName: nameById.get(userId) ?? userId,
        snapshots,
      }));

      return c.json({ range, series });
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
      const user = await db.select().from(users).where(eq(users.id, userId)).get();
      if (!user) return jsonError(c, 404, "USER_NOT_FOUND", "User not found");

      const account = await getUserAccount(userId);
      if (!account) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");

      const positionRows = await db
        .select()
        .from(positions)
        .where(eq(positions.accountId, account.id))
        .all();
      const perpStateRows = await db
        .select()
        .from(perpPositionState)
        .where(eq(perpPositionState.accountId, account.id))
        .all();
      const perpStateByPositionId = new Map(perpStateRows.map((row) => [row.positionId, row]));

      const enrichedPositions = [];
      for (const row of positionRows) {
        const adapter = registry.get(row.market);
        let currentPrice: number | null = null;
        try {
          if (adapter) {
            const quote = await adapter.getQuote(row.symbol);
            currentPrice = quote.price;
          }
        } catch {
          // ignore quote failures
        }
        const perpState = perpStateByPositionId.get(row.id);
        const isPerp = Boolean(adapter?.capabilities.includes("funding") && perpState);

        const unrealizedPnl = currentPrice === null
          ? null
          : isPerp
            ? calculatePerpUnrealizedPnl({ quantity: row.quantity, avgCost: row.avgCost }, currentPrice)
            : calculateUnrealizedPnl({ quantity: row.quantity, avgCost: row.avgCost }, currentPrice);
        const marketValue = currentPrice === null
          ? null
          : isPerp && perpState
            ? calculatePerpPositionEquity({ quantity: row.quantity, avgCost: row.avgCost, margin: perpState.margin }, currentPrice)
            : calculateMarketValue({ quantity: row.quantity, avgCost: row.avgCost }, currentPrice);

        enrichedPositions.push({
          market: row.market,
          symbol: row.symbol,
          quantity: row.quantity,
          avgCost: row.avgCost,
          currentPrice,
          marketValue,
          unrealizedPnl,
          leverage: perpState?.leverage ?? null,
          margin: perpState?.margin ?? null,
          liquidationPrice: perpState?.liquidationPrice ?? null,
        });
      }

      const recentOrders = await db
        .select()
        .from(orders)
        .where(eq(orders.accountId, account.id))
        .orderBy(desc(orders.createdAt))
        .limit(20)
        .all();
      const openOrders = await db
        .select()
        .from(orders)
        .where(and(eq(orders.accountId, account.id), eq(orders.status, "pending")))
        .orderBy(desc(orders.createdAt))
        .all();

      return c.json({
        userId: user.id,
        userName: user.name,
        accountId: account.id,
        balance: account.balance,
        positions: enrichedPositions,
        openOrders,
        recentOrders,
      });
    }),
  );

  // ─── POST /users/:id/orders — Admin places order on behalf of a user ───────

  router.post(
    "/users/:id/orders",
    withErrorHandling(async (c) => {
      const userId = c.req.param("id");
      const user = await db.select().from(users).where(eq(users.id, userId)).get();
      if (!user) return jsonError(c, 404, "USER_NOT_FOUND", "User not found");

      const parsed = await parseJson(c, placeOrderSchema);
      if (!parsed.success) return parsed.response;

      const account = await getUserAccount(userId);
      if (!account) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");
      if (parsed.data.accountId && parsed.data.accountId !== account.id) {
        return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");
      }

      const adminUserId = c.get("userId");
      const idempotencyResult = await checkIdempotency(c, adminUserId, { targetUserId: userId, ...parsed.data });
      if (idempotencyResult.kind === "invalid" || idempotencyResult.kind === "replay") {
        return idempotencyResult.response;
      }
      const idempotencyCandidate = idempotencyResult.kind === "store" ? idempotencyResult.candidate : null;
      const maybeStoreResponse = async (response: Response): Promise<void> => {
        if (!idempotencyCandidate) return;
        const clone = response.clone();
        const body = await clone.json();
        await storeIdempotencyResponse(idempotencyCandidate, clone.status, body);
      };
      const placement = await placeOrderForAccount({ account, order: parsed.data });
      if (placement.kind === "error") {
        return jsonError(c, placement.status, placement.code, placement.message);
      }

      const response = c.json(placement.order, 201);
      await maybeStoreResponse(response);
      return response;
    }),
  );

  return router;
};
