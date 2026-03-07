import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { eventsRoutes } from "../src/routes/events.js";

afterEach(() => {
  // no-op; route uses singleton event bus but these tests return before touching stream setup
});

describe("eventsRoutes", () => {
  it("rejects missing user identity", async () => {
    const app = new Hono();
    app.route("/events", eventsRoutes);

    const res = await app.request("/events");
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("rejects malformed SSE cursors before opening a stream", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("userId", "usr_1" as never);
      c.set("isAdmin", false as never);
      await next();
    });
    app.route("/events", eventsRoutes);

    const res = await app.request("/events?since=abc");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "INVALID_INPUT" } });
  });
});
