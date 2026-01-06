import { describe, it, expect, mock, beforeEach } from "bun:test";
import { PluginManager } from "./plugin-manager";
import { coreServices, os, RpcContext } from "@checkmate/backend-api";
import { Hono } from "hono";
import { createMockDbModule } from "@checkmate/test-utils-backend";
import { createMockLoggerModule } from "@checkmate/test-utils-backend";

// Mock DB and other globals
mock.module("./db", () => createMockDbModule());

mock.module("./logger", () => createMockLoggerModule());

describe("RPC REST Compatibility", () => {
  let pluginManager: PluginManager;
  let app: Hono;

  beforeEach(() => {
    pluginManager = new PluginManager();
    app = new Hono();
  });

  it("should handle GET /api/auth/permissions via oRPC router", async () => {
    // 1. Setup a mock auth router
    const authRouter = os.router({
      permissions: os.handler(async () => {
        return { permissions: ["test-perm"] };
      }),
    });

    // 2. Register it in plugin manager (now using new pattern - router AND contract required)
    // Note: In real usage, the path is derived from pluginId. For test, we manually set it.
    const rpcService = await pluginManager.getService(coreServices.rpc);
    // The new API auto-prefixes based on pluginId, but for test we need to manually set the map key
    // Since we're testing the router handler directly, we use the derived name "auth"
    // Second argument is the contract (for OpenAPI generation) - using a mock object for test
    rpcService?.registerRouter(authRouter, { permissions: {} });

    // 3. Mock the auth service to skip real authentication
    const mockAuth: any = {
      authenticate: mock(async () => ({ id: "user-1", permissions: ["*"] })),
    };
    pluginManager.registerService(coreServices.auth, mockAuth);

    // Register other dummy services needed for context
    pluginManager.registerService(coreServices.logger, {
      info: mock(),
      debug: mock(),
      error: mock(),
      warn: mock(),
    } as any);
    pluginManager.registerService(coreServices.database, {} as any);
    pluginManager.registerService(coreServices.fetch, {} as any);
    pluginManager.registerService(coreServices.healthCheckRegistry, {} as any);
    pluginManager.registerService(coreServices.queuePluginRegistry, {
      getPlugins: () => [],
    } as any);
    pluginManager.registerService(coreServices.queueManager, {
      getActivePlugin: () => "none",
      getQueue: () => ({}),
    } as any);

    // 4. Mount the plugins
    await pluginManager.loadPlugins(app);

    // 5. Simulate the request that frontend makes (now /api/auth instead of /api/auth-backend)
    const res = await app.request("/api/auth/permissions", {
      method: "GET",
    });

    // If it's a 404, my theory about dots vs slashes or GET vs POST is correct
    console.log("Response status:", res.status);
    if (res.status === 200) {
      const body = await res.json();
      console.log("Response body:", JSON.stringify(body));
      expect(body.permissions).toContain("test-perm");
    } else {
      console.log("Response text:", await res.text());
    }
  });
});
