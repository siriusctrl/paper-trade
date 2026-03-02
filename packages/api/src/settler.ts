import { type MarketRegistry } from "@unimarket/markets";
import { eq } from "drizzle-orm";

import { db } from "./db/client.js";
import { accounts, positions, trades } from "./db/schema.js";
import { makeId, nowIso } from "./utils.js";

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute

export const settlePendingPositions = async (registry: MarketRegistry): Promise<{ settled: number; skipped: number }> => {
  const allPositions = await db.select().from(positions).all();

  let settled = 0;
  let skipped = 0;

  for (const pos of allPositions) {
    const adapter = registry.get(pos.market);
    if (!adapter) {
      skipped += 1;
      continue;
    }

    if (!adapter.capabilities.includes("resolve") || typeof adapter.resolve !== "function") {
      skipped += 1;
      continue;
    }

    let resolution;
    try {
      resolution = await adapter.resolve(pos.symbol);
    } catch {
      skipped += 1;
      continue;
    }

    if (!resolution || !resolution.resolved || resolution.settlementPrice === null || resolution.settlementPrice === undefined) {
      skipped += 1;
      continue;
    }

    const settlementPrice = resolution.settlementPrice;

    try {
      const didSettle = await db.transaction(async (tx) => {
        const latestPosition = await tx.select().from(positions).where(eq(positions.id, pos.id)).get();
        if (!latestPosition) return false;

        const account = await tx.select().from(accounts).where(eq(accounts.id, latestPosition.accountId)).get();
        if (!account) return false;

        const proceeds = Number((latestPosition.quantity * settlementPrice).toFixed(6));
        const nextBalance = Number((account.balance + proceeds).toFixed(6));

        const accountUpdated = await tx.update(accounts).set({ balance: nextBalance }).where(eq(accounts.id, account.id)).run();
        if (accountUpdated.rowsAffected === 0) {
          throw new Error("Account update failed during settlement");
        }

        const now = nowIso();
        await tx
          .insert(trades)
          .values({
            id: makeId("trd"),
            orderId: makeId("stl"),
            accountId: latestPosition.accountId,
            market: latestPosition.market,
            symbol: latestPosition.symbol,
            side: "sell",
            quantity: latestPosition.quantity,
            price: settlementPrice,
            createdAt: now,
          })
          .run();

        const deletedPosition = await tx.delete(positions).where(eq(positions.id, latestPosition.id)).run();
        if (deletedPosition.rowsAffected === 0) {
          throw new Error("Position delete failed during settlement");
        }

        return true;
      });

      if (didSettle) {
        settled += 1;
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }

  return { settled, skipped };
};

export const startSettler = (registry: MarketRegistry): (() => void) => {
  const intervalMs = Number(process.env.SETTLE_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await settlePendingPositions(registry);
      if (result.settled > 0) {
        console.log(`[settler] settled ${result.settled} positions`);
      }
    } catch (err) {
      console.error("[settler] error:", err);
    } finally {
      running = false;
    }
  }, intervalMs);

  console.log(`[settler] started (interval: ${intervalMs}ms)`);

  return () => {
    clearInterval(timer);
    console.log("[settler] stopped");
  };
};
