import { paginationQuerySchema } from "@unimarket/core";
import type { MarketRegistry } from "@unimarket/markets";
import { Hono } from "hono";

import type { AppVariables } from "../platform/auth.js";
import { jsonError } from "../platform/errors.js";
import { getUserAccountScope, parseQuery, requireNonAdminUserId, withErrorHandling } from "../platform/helpers.js";
import { buildAccountPortfolioModel } from "../services/portfolio-read.js";
import { buildTimelineEvents } from "../timeline.js";

export const createAccountRoutes = (registry: MarketRegistry) => {
  const account = new Hono<{ Variables: AppVariables }>();

  account.get(
    "/",
    withErrorHandling(async (c) => {
      const userResult = requireNonAdminUserId(c, "Invalid user for account retrieval");
      if (!userResult.success) {
        return userResult.response;
      }

      const accountScope = await getUserAccountScope(userResult.userId);
      if (!accountScope.account) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");

      return c.json({
        id: accountScope.account.id,
        name: accountScope.account.name,
        balance: accountScope.account.balance,
        createdAt: accountScope.account.createdAt,
      });
    }),
  );

  account.get(
    "/portfolio",
    withErrorHandling(async (c) => {
      const userResult = requireNonAdminUserId(c, "Invalid user for portfolio");
      if (!userResult.success) {
        return userResult.response;
      }

      const accountScope = await getUserAccountScope(userResult.userId);
      if (!accountScope.account) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");

      const portfolio = await buildAccountPortfolioModel({
        account: accountScope.account,
        registry,
        tolerateQuoteFailures: false,
        includeMissingAdapterAsUnpriced: false,
      });

      return c.json({
        accountId: portfolio.accountId,
        balance: portfolio.balance,
        positions: portfolio.positions.map((position) => ({
          market: position.market,
          symbol: position.symbol,
          quantity: position.quantity,
          avgCost: position.avgCost,
          currentPrice: position.currentPrice,
          unrealizedPnl: position.unrealizedPnl ?? 0,
          marketValue: position.marketValue ?? 0,
          accumulatedFunding: position.accumulatedFunding,
          notional: position.notional ?? undefined,
          positionEquity: position.positionEquity ?? undefined,
          leverage: position.leverage ?? undefined,
          margin: position.margin ?? undefined,
          maintenanceMargin: position.maintenanceMargin ?? undefined,
          liquidationPrice: position.liquidationPrice ?? null,
        })),
        openOrders: portfolio.openOrders,
        totalValue: portfolio.totalValue,
        totalPnl: portfolio.totalPnl,
        totalFunding: portfolio.totalFunding,
      });
    }),
  );

  account.get(
    "/timeline",
    withErrorHandling(async (c) => {
      const userResult = requireNonAdminUserId(c, "Invalid user for timeline");
      if (!userResult.success) {
        return userResult.response;
      }

      const accountScope = await getUserAccountScope(userResult.userId);
      if (!accountScope.account) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");

      const parsedQuery = parseQuery(c, paginationQuerySchema);
      if (!parsedQuery.success) return parsedQuery.response;

      const events = await buildTimelineEvents({
        registry,
        userId: accountScope.account.userId,
        accountId: accountScope.account.id,
        limit: parsedQuery.data.limit,
        offset: parsedQuery.data.offset,
      });

      return c.json({ events });
    }),
  );

  return account;
};
