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

  it("should handle GET /api/auth-backend/permissions via oRPC router", async () => {
    // 1. Setup a mock auth router
    const authRouter = os.router({
      permissions: os.handler(async () => {
        return { permissions: ["test-perm"] };
      }),
    });

    // 2. Register it in plugin manager
    const rpcService = await pluginManager.getService(coreServices.rpc);
    rpcService?.registerRouter("auth-backend", authRouter);

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
    pluginManager.registerService(coreServices.queueFactory, {
      getActivePlugin: () => "none",
    } as any);

    // 4. Mount the plugins
    await pluginManager.loadPlugins(app);

    // 5. Simulate the request that frontend makes
    const res = await app.request("/api/auth-backend/permissions", {
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
