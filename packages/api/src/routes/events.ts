import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { AppVariables } from "../auth.js";
import { jsonError } from "../errors.js";
import { ALL_EVENTS_SUBSCRIBER, eventBus, type TradingEvent } from "../events.js";

const router = new Hono<{ Variables: AppVariables }>();

router.get("/", (c) => {
  const userId = c.get("userId");
  if (!userId) return jsonError(c, 401, "UNAUTHORIZED", "Missing user identity");

  const subscriptionKey = c.get("isAdmin") ? ALL_EVENTS_SUBSCRIBER : userId;

  return streamSSE(c, async (stream) => {
    const onEvent = (event: TradingEvent) => {
      void stream.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = eventBus.subscribe(subscriptionKey, onEvent);
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      unsubscribe();
      c.req.raw.signal.removeEventListener("abort", handleAbort);
    };

    const handleAbort = () => {
      cleanup();
      stream.abort();
    };

    c.req.raw.signal.addEventListener("abort", handleAbort, { once: true });

    stream.onAbort(cleanup);
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
  });
});

export { router as eventsRoutes };
