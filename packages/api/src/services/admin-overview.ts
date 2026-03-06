import { and, gte, inArray } from "drizzle-orm";
import type { MarketRegistry } from "@unimarket/markets";

import { db } from "../db/client.js";
import { accounts, equitySnapshots, positions, users } from "../db/schema.js";
import { resolveSymbolsWithCache } from "../symbol-metadata.js";
import { makeId, nowIso } from "../utils.js";
import { buildAccountPortfolioModelsByAccount } from "./portfolio-read.js";

type UserRow = typeof users.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;

export type AdminOverviewAgent = {
  userId: string;
  userName: string;
  createdAt: string;
  accountId: string | null;
  accountName: string | null;
  balance: number;
  positions: Array<{
    market: string;
    symbol: string;
    symbolName: string | null;
    side: string | null;
    quantity: number;
    avgCost: number;
    currentPrice: number | null;
    marketValue: number | null;
    unrealizedPnl: number | null;
    quoteTimestamp: string | null;
    margin: number | null;
    maintenanceMargin: number | null;
    leverage: number | null;
    liquidationPrice: number | null;
  }>;
  totals: {
    positions: number;
    balance: number;
    marketValue: number;
    unrealizedPnl: number;
    equity: number;
  };
};

export type AdminOverviewModel = {
  generatedAt: string;
  totals: {
    users: number;
    positions: number;
    balance: number;
    marketValue: number;
    unrealizedPnl: number;
    equity: number;
  };
  markets: Array<{
    marketId: string;
    marketName: string;
    users: number;
    positions: number;
    totalQuantity: number;
    totalMarketValue: number;
    totalUnrealizedPnl: number;
    quotedPositions: number;
    unpricedPositions: number;
  }>;
  agents: AdminOverviewAgent[];
};

const getPrimaryAccountByUserId = (accountRows: AccountRow[]): Map<string, AccountRow> => {
  const primaryAccountByUserId = new Map<string, AccountRow>();
  for (const account of [...accountRows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!primaryAccountByUserId.has(account.userId)) {
      primaryAccountByUserId.set(account.userId, account);
    }
  }
  return primaryAccountByUserId;
};

export const buildAdminOverviewModel = async ({
  registry,
  includeSymbolMetadata = true,
}: {
  registry: MarketRegistry;
  includeSymbolMetadata?: boolean;
}): Promise<AdminOverviewModel> => {
  const [userRows, accountRows, positionRows] = await Promise.all([
    db.select().from(users).all(),
    db.select().from(accounts).all(),
    db.select().from(positions).all(),
  ]);
  const portfolioByAccountId = await buildAccountPortfolioModelsByAccount({ accounts: accountRows, registry });

  const primaryAccountByUserId = getPrimaryAccountByUserId(accountRows);
  const polymarketSymbols = new Set<string>();
  if (includeSymbolMetadata) {
    for (const portfolio of portfolioByAccountId.values()) {
      for (const position of portfolio.positions) {
        if (position.market === "polymarket") {
          polymarketSymbols.add(position.symbol);
        }
      }
    }
  }

  const symbolResolution = includeSymbolMetadata
    ? await resolveSymbolsWithCache(registry, "polymarket", polymarketSymbols)
    : { names: new Map<string, string>(), outcomes: new Map<string, string>() };

  const marketSummaryById = new Map<string, {
    marketId: string;
    marketName: string;
    users: Set<string>;
    positions: number;
    totalQuantity: number;
    totalMarketValue: number;
    totalUnrealizedPnl: number;
    quotedPositions: number;
    unpricedPositions: number;
  }>();

  for (const portfolio of portfolioByAccountId.values()) {
    const account = accountRows.find((row) => row.id === portfolio.accountId);
    for (const position of portfolio.positions) {
      if (!marketSummaryById.has(position.market)) {
        marketSummaryById.set(position.market, {
          marketId: position.market,
          marketName: registry.get(position.market)?.displayName ?? position.market,
          users: new Set<string>(),
          positions: 0,
          totalQuantity: 0,
          totalMarketValue: 0,
          totalUnrealizedPnl: 0,
          quotedPositions: 0,
          unpricedPositions: 0,
        });
      }

      const marketSummary = marketSummaryById.get(position.market)!;
      marketSummary.positions += 1;
      marketSummary.totalQuantity += position.quantity;
      if (account) {
        marketSummary.users.add(account.userId);
      }

      if (position.marketValue === null || position.unrealizedPnl === null) {
        marketSummary.unpricedPositions += 1;
      } else {
        marketSummary.quotedPositions += 1;
        marketSummary.totalMarketValue += position.marketValue;
        marketSummary.totalUnrealizedPnl += position.unrealizedPnl;
      }
    }
  }

  const agents = userRows
    .map<AdminOverviewAgent>((user) => {
      const primaryAccount = primaryAccountByUserId.get(user.id) ?? null;
      const portfolio = primaryAccount ? portfolioByAccountId.get(primaryAccount.id) : null;
      const agentPositions = [...(portfolio?.positions ?? [])]
        .map((position) => ({
          market: position.market,
          symbol: position.symbol,
          symbolName: includeSymbolMetadata ? (symbolResolution.names.get(position.symbol) ?? null) : null,
          side: includeSymbolMetadata ? (symbolResolution.outcomes.get(position.symbol) ?? null) : null,
          quantity: position.quantity,
          avgCost: position.avgCost,
          currentPrice: position.currentPrice,
          marketValue: position.marketValue,
          unrealizedPnl: position.unrealizedPnl,
          quoteTimestamp: position.quoteTimestamp,
          margin: position.margin,
          maintenanceMargin: position.maintenanceMargin,
          leverage: position.leverage,
          liquidationPrice: position.liquidationPrice,
        }))
        .sort((a, b) => `${a.market}:${a.symbol}`.localeCompare(`${b.market}:${b.symbol}`));

      const totalBalance = Number((primaryAccount?.balance ?? 0).toFixed(6));
      const totalMarketValue = Number(agentPositions.reduce((sum, position) => sum + (position.marketValue ?? 0), 0).toFixed(6));
      const totalUnrealizedPnl = Number(agentPositions.reduce((sum, position) => sum + (position.unrealizedPnl ?? 0), 0).toFixed(6));
      const totalEquity = Number((totalBalance + totalMarketValue).toFixed(6));

      return {
        userId: user.id,
        userName: user.name,
        createdAt: user.createdAt,
        accountId: primaryAccount?.id ?? null,
        accountName: primaryAccount?.name ?? null,
        balance: totalBalance,
        positions: agentPositions,
        totals: {
          positions: agentPositions.length,
          balance: totalBalance,
          marketValue: totalMarketValue,
          unrealizedPnl: totalUnrealizedPnl,
          equity: totalEquity,
        },
      };
    })
    .sort((a, b) => b.totals.equity - a.totals.equity);

  const markets = Array.from(marketSummaryById.values())
    .map((market) => ({
      marketId: market.marketId,
      marketName: market.marketName,
      users: market.users.size,
      positions: market.positions,
      totalQuantity: market.totalQuantity,
      totalMarketValue: Number(market.totalMarketValue.toFixed(6)),
      totalUnrealizedPnl: Number(market.totalUnrealizedPnl.toFixed(6)),
      quotedPositions: market.quotedPositions,
      unpricedPositions: market.unpricedPositions,
    }))
    .sort((a, b) => b.totalMarketValue - a.totalMarketValue);

  const totalBalance = Number(agents.reduce((sum, agent) => sum + agent.totals.balance, 0).toFixed(6));
  const totalMarketValue = Number(markets.reduce((sum, market) => sum + market.totalMarketValue, 0).toFixed(6));
  const totalUnrealizedPnl = Number(markets.reduce((sum, market) => sum + market.totalUnrealizedPnl, 0).toFixed(6));

  return {
    generatedAt: nowIso(),
    totals: {
      users: userRows.length,
      positions: positionRows.length,
      balance: totalBalance,
      marketValue: totalMarketValue,
      unrealizedPnl: totalUnrealizedPnl,
      equity: Number((totalBalance + totalMarketValue).toFixed(6)),
    },
    markets,
    agents,
  };
};

export const recordEquitySnapshotsFromOverview = async ({
  overview,
  windowMs = 5 * 60_000,
}: {
  overview: AdminOverviewModel;
  windowMs?: number;
}): Promise<{ created: number; skipped: number }> => {
  if (overview.agents.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const userIds = overview.agents.map((agent) => agent.userId);
  const since = new Date(Date.now() - windowMs).toISOString();
  const recentRows = await db
    .select({ userId: equitySnapshots.userId })
    .from(equitySnapshots)
    .where(and(inArray(equitySnapshots.userId, userIds), gte(equitySnapshots.snapshotAt, since)))
    .all();
  const recentlySnapshottedUserIds = new Set(recentRows.map((row) => row.userId));

  const pendingSnapshots = overview.agents
    .filter((agent) => !recentlySnapshottedUserIds.has(agent.userId))
    .map((agent) => ({
      id: makeId("snap"),
      userId: agent.userId,
      balance: agent.totals.balance,
      marketValue: agent.totals.marketValue,
      equity: agent.totals.equity,
      unrealizedPnl: agent.totals.unrealizedPnl,
      snapshotAt: overview.generatedAt,
    }));

  if (pendingSnapshots.length === 0) {
    return { created: 0, skipped: overview.agents.length };
  }

  await db.insert(equitySnapshots).values(pendingSnapshots).run();
  return { created: pendingSnapshots.length, skipped: overview.agents.length - pendingSnapshots.length };
};
