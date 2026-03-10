import {
  calculateMarketValue,
  calculatePerpMaintenanceMargin,
  calculatePerpPositionEquity,
  calculatePerpUnrealizedPnl,
  calculateUnrealizedPnl,
} from "@unimarket/core";
import type { MarketRegistry } from "@unimarket/markets";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { accounts, fundingPayments, orders, perpPositionState, positions } from "../db/schema.js";

type AccountRow = typeof accounts.$inferSelect;
type PositionRow = typeof positions.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
type PerpStateRow = typeof perpPositionState.$inferSelect;

export type EnrichedPositionRow = {
  accountId: string;
  market: string;
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number | null;
  quoteTimestamp: string | null;
  unrealizedPnl: number | null;
  marketValue: number | null;
  accumulatedFunding: number;
  notional: number | null;
  positionEquity: number | null;
  leverage: number | null;
  margin: number | null;
  maintenanceMargin: number | null;
  liquidationPrice: number | null;
};

export type AccountPortfolioModel = {
  accountId: string;
  balance: number;
  positions: EnrichedPositionRow[];
  openOrders: OrderRow[];
  recentOrders: OrderRow[];
  totalValue: number;
  totalPnl: number;
  totalFunding: number;
};

const finalizeAccountPortfolioModel = ({
  account,
  positions,
  openOrders = [],
  recentOrders = [],
}: {
  account: AccountRow;
  positions: EnrichedPositionRow[];
  openOrders?: OrderRow[];
  recentOrders?: OrderRow[];
}): AccountPortfolioModel => {
  const totalMarketValue = positions.reduce((sum, row) => sum + (row.marketValue ?? 0), 0);
  const totalFunding = positions.reduce((sum, row) => sum + row.accumulatedFunding, 0);

  return {
    accountId: account.id,
    balance: account.balance,
    positions,
    openOrders,
    recentOrders,
    totalValue: Number((account.balance + totalMarketValue).toFixed(6)),
    totalPnl: Number(positions.reduce((sum, row) => sum + (row.unrealizedPnl ?? 0), 0).toFixed(6)),
    totalFunding: Number(totalFunding.toFixed(6)),
  };
};

const loadFundingByAccountAndSymbol = async (accountIds: string[]): Promise<Map<string, number>> => {
  if (accountIds.length === 0) {
    return new Map();
  }

  const fundingSums = await db
    .select({
      accountId: fundingPayments.accountId,
      market: fundingPayments.market,
      symbol: fundingPayments.symbol,
      total: sql<number>`sum(${fundingPayments.payment})`.as("total"),
    })
    .from(fundingPayments)
    .where(accountIds.length === 1 ? eq(fundingPayments.accountId, accountIds[0]!) : inArray(fundingPayments.accountId, accountIds))
    .groupBy(fundingPayments.accountId, fundingPayments.market, fundingPayments.symbol)
    .all();

  const fundingByKey = new Map<string, number>();
  for (const row of fundingSums) {
    fundingByKey.set(`${row.accountId}:${row.market}:${row.symbol}`, Number((row.total ?? 0).toFixed(6)));
  }
  return fundingByKey;
};

const enrichPositions = async ({
  registry,
  rows,
  perpStateByPositionId,
  fundingByKey,
  tolerateQuoteFailures,
  includeMissingAdapterAsUnpriced,
}: {
  registry: MarketRegistry;
  rows: PositionRow[];
  perpStateByPositionId: Map<string, PerpStateRow>;
  fundingByKey: Map<string, number>;
  tolerateQuoteFailures: boolean;
  includeMissingAdapterAsUnpriced: boolean;
}): Promise<EnrichedPositionRow[]> => {
  const quoteByKey = new Map<string, { price: number | null; timestamp: string | null }>();

  for (const row of rows) {
    const key = `${row.market}:${row.symbol}`;
    if (quoteByKey.has(key)) continue;

    const adapter = registry.get(row.market);
    if (!adapter) {
      if (includeMissingAdapterAsUnpriced) {
        quoteByKey.set(key, { price: null, timestamp: null });
      }
      continue;
    }

    try {
      const quote = await adapter.getQuote(row.symbol);
      quoteByKey.set(key, { price: quote.price, timestamp: quote.timestamp });
    } catch {
      if (!tolerateQuoteFailures) {
        throw new Error(`Quote lookup failed for ${row.market}:${row.symbol}`);
      }
      quoteByKey.set(key, { price: null, timestamp: null });
    }
  }

  const enriched: EnrichedPositionRow[] = [];

  for (const row of rows) {
    const adapter = registry.get(row.market);
    if (!adapter && !includeMissingAdapterAsUnpriced) {
      continue;
    }

    const quote = quoteByKey.get(`${row.market}:${row.symbol}`);
    if (!quote && !includeMissingAdapterAsUnpriced) {
      continue;
    }

    const perpState = perpStateByPositionId.get(row.id);
    const isPerp = Boolean(adapter?.capabilities.includes("funding") && perpState);
    const currentPrice = quote?.price ?? null;
    const quoteTimestamp = quote?.timestamp ?? null;
    const unrealizedPnl = currentPrice === null
      ? null
      : isPerp
        ? calculatePerpUnrealizedPnl({ quantity: row.quantity, avgCost: row.avgCost }, currentPrice)
        : calculateUnrealizedPnl({ quantity: row.quantity, avgCost: row.avgCost }, currentPrice);
    const positionEquity = currentPrice === null || !isPerp || !perpState
      ? null
      : calculatePerpPositionEquity(
        { quantity: row.quantity, avgCost: row.avgCost, margin: perpState.margin },
        currentPrice,
      );
    const maintenanceMargin = currentPrice === null || !isPerp || !perpState
      ? null
      : calculatePerpMaintenanceMargin(
        { quantity: row.quantity, maintenanceMarginRatio: perpState.maintenanceMarginRatio },
        currentPrice,
      );
    const marketValue = currentPrice === null
      ? null
      : isPerp
        ? positionEquity
        : calculateMarketValue({ quantity: row.quantity, avgCost: row.avgCost }, currentPrice);

    enriched.push({
      accountId: row.accountId,
      market: row.market,
      symbol: row.symbol,
      quantity: row.quantity,
      avgCost: row.avgCost,
      currentPrice,
      quoteTimestamp,
      unrealizedPnl,
      marketValue,
      accumulatedFunding: fundingByKey.get(`${row.accountId}:${row.market}:${row.symbol}`) ?? 0,
      notional: currentPrice === null || !isPerp ? null : Number((Math.abs(row.quantity) * currentPrice).toFixed(6)),
      positionEquity,
      leverage: perpState?.leverage ?? null,
      margin: perpState?.margin ?? null,
      maintenanceMargin,
      liquidationPrice: perpState?.liquidationPrice ?? null,
    });
  }

  return enriched;
};

export const buildAccountPortfolioModel = async ({
  account,
  registry,
  includeRecentOrders = false,
  tolerateQuoteFailures = false,
  includeMissingAdapterAsUnpriced = false,
}: {
  account: AccountRow;
  registry: MarketRegistry;
  includeRecentOrders?: boolean;
  tolerateQuoteFailures?: boolean;
  includeMissingAdapterAsUnpriced?: boolean;
}): Promise<AccountPortfolioModel> => {
  const [positionRows, openOrders, recentOrders, perpStateRows, fundingByKey] = await Promise.all([
    db.select().from(positions).where(eq(positions.accountId, account.id)).all(),
    db
      .select()
      .from(orders)
      .where(and(eq(orders.accountId, account.id), eq(orders.status, "pending")))
      .orderBy(desc(orders.createdAt))
      .all(),
    includeRecentOrders
      ? db.select().from(orders).where(eq(orders.accountId, account.id)).orderBy(desc(orders.createdAt)).limit(20).all()
      : Promise.resolve([] as OrderRow[]),
    db.select().from(perpPositionState).where(eq(perpPositionState.accountId, account.id)).all(),
    loadFundingByAccountAndSymbol([account.id]),
  ]);

  const perpStateByPositionId = new Map(perpStateRows.map((row) => [row.positionId, row]));
  const positionsView = await enrichPositions({
    registry,
    rows: positionRows,
    perpStateByPositionId,
    fundingByKey,
    tolerateQuoteFailures,
    includeMissingAdapterAsUnpriced,
  });
  return finalizeAccountPortfolioModel({
    account,
    positions: positionsView,
    openOrders,
    recentOrders,
  });
};

export const buildAccountPortfolioModelsByAccount = async ({
  accounts: accountRows,
  registry,
  tolerateQuoteFailures = true,
  includeMissingAdapterAsUnpriced = true,
}: {
  accounts: AccountRow[];
  registry: MarketRegistry;
  tolerateQuoteFailures?: boolean;
  includeMissingAdapterAsUnpriced?: boolean;
}): Promise<Map<string, AccountPortfolioModel>> => {
  if (accountRows.length === 0) {
    return new Map();
  }

  const accountIds = accountRows.map((account) => account.id);
  const [positionRows, perpStateRows, fundingByKey] = await Promise.all([
    db.select().from(positions).where(inArray(positions.accountId, accountIds)).all(),
    db.select().from(perpPositionState).where(inArray(perpPositionState.accountId, accountIds)).all(),
    loadFundingByAccountAndSymbol(accountIds),
  ]);

  const perpStateByPositionId = new Map(perpStateRows.map((row) => [row.positionId, row]));
  const positionsView = await enrichPositions({
    registry,
    rows: positionRows,
    perpStateByPositionId,
    fundingByKey,
    tolerateQuoteFailures,
    includeMissingAdapterAsUnpriced,
  });

  const positionsByAccountId = new Map<string, EnrichedPositionRow[]>();
  for (const position of positionsView) {
    const grouped = positionsByAccountId.get(position.accountId);
    if (grouped) {
      grouped.push(position);
    } else {
      positionsByAccountId.set(position.accountId, [position]);
    }
  }

  const portfolioByAccountId = new Map<string, AccountPortfolioModel>();
  for (const account of accountRows) {
    portfolioByAccountId.set(
      account.id,
      finalizeAccountPortfolioModel({
        account,
        positions: positionsByAccountId.get(account.id) ?? [],
      }),
    );
  }

  return portfolioByAccountId;
};
