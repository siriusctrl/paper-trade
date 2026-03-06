import {
  calculateMarketValue,
  calculatePerpMaintenanceMargin,
  calculatePerpPositionEquity,
  calculatePerpUnrealizedPnl,
  calculateUnrealizedPnl,
  paginationQuerySchema,
} from "@unimarket/core";
import type { MarketRegistry } from "@unimarket/markets";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { AppVariables } from "../auth.js";
import { db } from "../db/client.js";
import { fundingPayments, orders, perpPositionState, positions } from "../db/schema.js";
import { jsonError } from "../errors.js";
import { getUserAccount, parseQuery, withErrorHandling } from "../helpers.js";
import { buildTimelineEvents } from "../timeline.js";

export const createAccountRoutes = (registry: MarketRegistry) => {
  const account = new Hono<{ Variables: AppVariables }>();

  account.get(
    "/",
    withErrorHandling(async (c) => {
      const userId = c.get("userId");
      if (!userId || userId === "admin") {
        return jsonError(c, 400, "INVALID_USER", "Invalid user for account retrieval");
      }

      const acc = await getUserAccount(userId);
      if (!acc) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");

      return c.json({ id: acc.id, name: acc.name, balance: acc.balance, createdAt: acc.createdAt });
    }),
  );

  account.get(
    "/portfolio",
    withErrorHandling(async (c) => {
      const userId = c.get("userId");
      if (!userId || userId === "admin") {
        return jsonError(c, 400, "INVALID_USER", "Invalid user for portfolio");
      }

      const acc = await getUserAccount(userId);
      if (!acc) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");

      const rows = await db.select().from(positions).where(eq(positions.accountId, acc.id)).all();
      const openOrders = await db
        .select()
        .from(orders)
        .where(and(eq(orders.accountId, acc.id), eq(orders.status, "pending")))
        .orderBy(desc(orders.createdAt))
        .all();
      const perpStates = await db
        .select()
        .from(perpPositionState)
        .where(eq(perpPositionState.accountId, acc.id))
        .all();
      const perpStateByPositionId = new Map(perpStates.map((row) => [row.positionId, row]));

      // Aggregate accumulated funding per (market, symbol)
      const fundingSums = await db
        .select({
          market: fundingPayments.market,
          symbol: fundingPayments.symbol,
          total: sql<number>`sum(${fundingPayments.payment})`.as("total"),
        })
        .from(fundingPayments)
        .where(eq(fundingPayments.accountId, acc.id))
        .groupBy(fundingPayments.market, fundingPayments.symbol)
        .all();

      const fundingByKey = new Map<string, number>();
      for (const row of fundingSums) {
        fundingByKey.set(`${row.market}:${row.symbol}`, Number((row.total ?? 0).toFixed(6)));
      }

      const resultPositions: Array<{
        market: string;
        symbol: string;
        quantity: number;
        avgCost: number;
        currentPrice: number;
        unrealizedPnl: number;
        marketValue: number;
        accumulatedFunding: number;
        notional?: number;
        positionEquity?: number;
        leverage?: number;
        margin?: number;
        maintenanceMargin?: number;
        liquidationPrice?: number | null;
      }> = [];

      let totalMarketValue = 0;
      let totalFunding = 0;
      for (const row of rows) {
        const adapter = registry.get(row.market);
        if (!adapter) continue;

        const quote = await adapter.getQuote(row.symbol);
        const isPerp = adapter.capabilities.includes("funding");
        const perpState = perpStateByPositionId.get(row.id);
        const unrealizedPnl =
          isPerp && perpState
            ? calculatePerpUnrealizedPnl({ quantity: row.quantity, avgCost: row.avgCost }, quote.price)
            : calculateUnrealizedPnl({ quantity: row.quantity, avgCost: row.avgCost }, quote.price);
        const notional = Math.abs(row.quantity) * quote.price;
        const positionEquity =
          isPerp && perpState
            ? calculatePerpPositionEquity(
                { quantity: row.quantity, avgCost: row.avgCost, margin: perpState.margin },
                quote.price,
              )
            : undefined;
        const maintenanceMargin =
          isPerp && perpState
            ? calculatePerpMaintenanceMargin(
                { quantity: row.quantity, maintenanceMarginRatio: perpState.maintenanceMarginRatio },
                quote.price,
              )
            : undefined;
        const marketValue =
          isPerp && perpState
            ? positionEquity ?? 0
            : calculateMarketValue({ quantity: row.quantity, avgCost: row.avgCost }, quote.price);
        const accumulatedFunding = fundingByKey.get(`${row.market}:${row.symbol}`) ?? 0;
        totalMarketValue += marketValue;
        totalFunding += accumulatedFunding;

        resultPositions.push({
          market: row.market,
          symbol: row.symbol,
          quantity: row.quantity,
          avgCost: row.avgCost,
          currentPrice: quote.price,
          unrealizedPnl,
          marketValue,
          accumulatedFunding,
          notional: isPerp ? Number(notional.toFixed(6)) : undefined,
          positionEquity,
          leverage: perpState?.leverage,
          margin: perpState?.margin,
          maintenanceMargin,
          liquidationPrice: perpState?.liquidationPrice ?? null,
        });
      }

      const totalValue = Number((acc.balance + totalMarketValue).toFixed(6));
      const totalPnl = Number(resultPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0).toFixed(6));

      return c.json({
        accountId: acc.id,
        balance: acc.balance,
        positions: resultPositions,
        openOrders,
        totalValue,
        totalPnl,
        totalFunding: Number(totalFunding.toFixed(6)),
      });
    }),
  );

  account.get(
    "/timeline",
    withErrorHandling(async (c) => {
      const userId = c.get("userId");
      if (!userId || userId === "admin") {
        return jsonError(c, 400, "INVALID_USER", "Invalid user for timeline");
      }

      const acc = await getUserAccount(userId);
      if (!acc) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");

      const parsedQuery = parseQuery(c, paginationQuerySchema);
      if (!parsedQuery.success) return parsedQuery.response;

      const events = await buildTimelineEvents({
        registry,
        userId: acc.userId,
        accountId: acc.id,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
      });

      return c.json({ events });
    }),
  );

  return account;
};
