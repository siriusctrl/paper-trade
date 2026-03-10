import { gte } from "drizzle-orm";

import { db } from "../db/client.js";
import { equitySnapshots, users } from "../db/schema.js";

const RANGE_MS: Record<string, number> = {
  "1w": 7 * 86_400_000,
  "1m": 30 * 86_400_000,
  "3m": 90 * 86_400_000,
  "6m": 180 * 86_400_000,
  "1y": 365 * 86_400_000,
};

export type EquityHistoryModel = {
  range: string;
  series: Array<{
    userId: string;
    userName: string;
    snapshots: Array<{
      snapshotAt: string;
      equity: number;
      balance: number;
      marketValue: number;
      unrealizedPnl: number;
    }>;
  }>;
};

export const buildEquityHistoryModel = async (range = "1m"): Promise<EquityHistoryModel> => {
  const normalizedRange = range.toLowerCase();
  const ms = RANGE_MS[normalizedRange] ?? RANGE_MS["1m"];
  const since = new Date(Date.now() - ms).toISOString();

  const [rows, userRows] = await Promise.all([
    db.select()
      .from(equitySnapshots)
      .where(gte(equitySnapshots.snapshotAt, since))
      .orderBy(equitySnapshots.snapshotAt)
      .all(),
    db.select().from(users).all(),
  ]);

  const snapshotsByUserId = new Map<string, EquityHistoryModel["series"][number]["snapshots"]>();
  for (const row of rows) {
    const snapshots = snapshotsByUserId.get(row.userId);
    const snapshot = {
      snapshotAt: row.snapshotAt,
      equity: row.equity,
      balance: row.balance,
      marketValue: row.marketValue,
      unrealizedPnl: row.unrealizedPnl,
    };

    if (snapshots) {
      snapshots.push(snapshot);
    } else {
      snapshotsByUserId.set(row.userId, [snapshot]);
    }
  }

  const userNameById = new Map(userRows.map((user) => [user.id, user.name]));
  return {
    range,
    series: Array.from(snapshotsByUserId.entries()).map(([userId, snapshots]) => ({
      userId,
      userName: userNameById.get(userId) ?? userId,
      snapshots,
    })),
  };
};
