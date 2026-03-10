import { listPositionsQuerySchema } from "@unimarket/core";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { AppVariables } from "../platform/auth.js";
import { db } from "../db/client.js";
import { positions } from "../db/schema.js";
import { jsonError } from "../platform/errors.js";
import { getUserAccountScope, parseQuery, withErrorHandling } from "../platform/helpers.js";

const router = new Hono<{ Variables: AppVariables }>();

router.get(
  "/",
  withErrorHandling(async (c) => {
    const parsed = parseQuery(c, listPositionsQuerySchema);
    if (!parsed.success) return parsed.response;

    const userId = c.get("userId");
    const orderedPositions = () =>
      db.select().from(positions).orderBy(asc(positions.market), asc(positions.symbol)).all();

    if (userId === "admin") {
      if (parsed.data.accountId) {
        if (parsed.data.userId) {
          const accountScope = await getUserAccountScope(parsed.data.userId, parsed.data.accountId);
          if (!accountScope.account) return c.json({ positions: [] });
        }

        const rows = await db
          .select()
          .from(positions)
          .where(eq(positions.accountId, parsed.data.accountId))
          .orderBy(asc(positions.market), asc(positions.symbol))
          .all();
        return c.json({ positions: rows });
      }

      if (parsed.data.userId) {
        const accountScope = await getUserAccountScope(parsed.data.userId);
        if (!accountScope.account) return c.json({ positions: [] });

        const rows = await db
          .select()
          .from(positions)
          .where(eq(positions.accountId, accountScope.account.id))
          .orderBy(asc(positions.market), asc(positions.symbol))
          .all();
        return c.json({ positions: rows });
      }

      const rows = await orderedPositions();
      return c.json({ positions: rows });
    }

    const accountScope = await getUserAccountScope(userId, parsed.data.accountId);
    if (!accountScope.account) {
      if (accountScope.mismatch) {
        return c.json({ positions: [] });
      }
      return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "Account not found");
    }

    const rows = await db
      .select()
      .from(positions)
      .where(eq(positions.accountId, accountScope.account.id))
      .orderBy(asc(positions.market), asc(positions.symbol))
      .all();
    return c.json({ positions: rows });
  }),
);

export { router as positionsRoutes };
