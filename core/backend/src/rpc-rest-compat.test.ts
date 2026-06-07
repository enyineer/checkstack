import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { PluginManager } from "./plugin-manager";
import { coreServices, os, createBackendPlugin } from "@checkstack/backend-api";
import { Hono } from "hono";
import { createMockDbModule } from "@checkstack/test-utils-backend";
import { createMockLoggerModule } from "@checkstack/test-utils-backend";
import * as realDb from "./db";
import * as realLogger from "./logger";

// Snapshot the REAL modules before mocking so afterAll can restore them.
// `mock.module` is process-global and `mock.restore()` does not undo it, so
// without this the stubs leak into every core/backend suite that runs after
// this file (e.g. the real-HTTP auth tests).
const realDbModule = { ...realDb };
const realLoggerModule = { ...realLogger };

// Mock DB and other globals
mock.module("./db", () => createMockDbModule());

mock.module("./logger", () => createMockLoggerModule());

afterAll(() => {
  mock.module("./db", () => realDbModule);
  mock.module("./logger", () => realLoggerModule);
});

/**
 * Guards the oRPC router REGISTRATION + MOUNTING wiring contract.
 *
 * Background (silent-failure seam): the core/backend test preload used to
 * register a mock `rpc` service whose `registerRouter` was a no-op, so across
 * the ENTIRE suite a plugin's router never landed in the shared maps the
 * `/api/:pluginId/*` dispatcher reads. The one "reachability" test that
 * existed only asserted on a 200 inside an `if`, so it passed forever on a
 * 404. These tests assert the concrete wiring that was silently broken:
 *
 *   1. Resolving `coreServices.rpc` for a plugin and calling `registerRouter`
 *      lands the router AND its contract in the shared maps, keyed by the
 *      resolving plugin id (consumed by `createApiRouteHandler`).
 *   2. `loadPlugins` mounts the `/api/:pluginId/*` route on the Hono app, so
 *      requests to a registered plugin reach the handler (no Hono-level 404).
 *
 * Note: exercising oRPC's RPC wire protocol end-to-end requires the plugin's
 * real contract + protocol encoding; that is out of scope here. These guards
 * cover the registration/mounting seam — the exact thing the no-op mock hid.
 */
describe("oRPC router registration + mounting wiring", () => {
  let pluginManager: PluginManager;
  let app: Hono;

  beforeEach(() => {
    pluginManager = new PluginManager();
    app = new Hono();
  });

  it("registers a plugin router + contract into the shared maps the API handler reads", async () => {
    const authRouter = os.router({
      accessRules: os.handler(async () => ({ accessRules: ["test-perm"] })),
    });
    const contract = { accessRules: {} };

    // Resolve the rpc service scoped to the `auth` plugin and register the
    // router — exactly how a plugin does it during init().
    const rpcService = await pluginManager
      .getRegistry()
      .get(coreServices.rpc, { pluginId: "auth" });
    rpcService.registerRouter(authRouter, contract);

    // The contract MUST land in the shared registry the API route handler
    // (and OpenAPI generation) consumes, keyed by the plugin id —
    // `registerRouter` sets the router map and the contract map together. A
    // no-op `registerRouter` (the prior regression) would leave this empty.
    expect(pluginManager.getAllContracts().get("auth")).toBe(contract);
  });

  it("mounts the /api/:pluginId/* route so a registered plugin reaches the handler (not a Hono 404)", async () => {
    const authRouter = os.router({
      accessRules: os.handler(async () => ({ accessRules: ["test-perm"] })),
    });
    const rpcService = await pluginManager
      .getRegistry()
      .get(coreServices.rpc, { pluginId: "auth" });
    rpcService.registerRouter(authRouter, { accessRules: {} });
    pluginManager.registerCorePluginMetadata({ pluginId: "auth" });

    // At least one (manual) plugin is required for loadPlugins to proceed
    // past its "no plugins" early-return and actually mount the
    // `/api/:pluginId/*` route.
    const noopPlugin = createBackendPlugin({
      metadata: { pluginId: "noop" },
      register: () => {},
    });
    await pluginManager.loadPlugins(app, [noopPlugin], { skipDiscovery: true });

    // A request to `/api/:pluginId/*` must REACH the assembled API handler
    // (the dispatcher), not fall through to a Hono 404. The dispatcher
    // resolves the RpcContext first and, in this minimal harness, returns a
    // handler-level 500 ("Core services not initialized") — which is exactly
    // the proof we want: the route is mounted and the request reached the
    // handler. (A regression that fails to mount the route would surface as
    // a Hono 404 here instead.)
    const reached = await app.request("/api/auth/accessRules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(reached.status).not.toBe(404);
    expect(reached.status).toBe(500);
  });
});
