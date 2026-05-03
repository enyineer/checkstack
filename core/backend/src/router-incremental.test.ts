import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { TrieRouter } from "hono/router/trie-router";

/**
 * Regression test for the "Hono router was already initialized" bug.
 *
 * Hono's default SmartRouter freezes its matcher on first request: any later
 * `app.get/all/...` throws "Can not add a route since the matcher is already
 * built". Plugins register routes during init() (and at runtime via
 * loadSinglePlugin), so we use TrieRouter — which is incremental. If anyone
 * ever swaps the router back to default, this test fails fast.
 *
 * See core/backend/src/index.ts where TrieRouter is wired up.
 */
describe("Hono router (TrieRouter) supports incremental route registration", () => {
  it("accepts routes added after the first request", async () => {
    const app = new Hono({ router: new TrieRouter() });
    app.get("/early", (c) => c.text("early"));

    // Trigger matcher build (this is what freezes SmartRouter).
    const r1 = await app.fetch(new Request("http://x/early"));
    expect(await r1.text()).toBe("early");

    // Add a route AFTER the matcher is "built". On SmartRouter this throws.
    app.get("/late", (c) => c.text("late"));

    const r2 = await app.fetch(new Request("http://x/late"));
    expect(r2.status).toBe(200);
    expect(await r2.text()).toBe("late");
  });

  it("accepts a parameterized route added after a request", async () => {
    const app = new Hono({ router: new TrieRouter() });
    app.get("/seed", (c) => c.text("seed"));
    await app.fetch(new Request("http://x/seed"));

    // This is the actual production scenario: /api/:pluginId/* is registered
    // inside loadPlugins() during init, well after the first request may have
    // already been handled.
    app.all("/api/:pluginId/*", (c) =>
      c.json({ pluginId: c.req.param("pluginId") }),
    );

    const r = await app.fetch(new Request("http://x/api/healthcheck/foo"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ pluginId: "healthcheck" });
  });
});
