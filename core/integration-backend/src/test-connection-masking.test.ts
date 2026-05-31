import { describe, it, expect } from "bun:test";
import { call } from "@orpc/server";
import { createMockRpcContext, type SafeDatabase } from "@checkstack/backend-api";
import { createIntegrationRouter } from "./router";
import type { IntegrationProviderRegistry } from "./provider-registry";
import type { ConnectionStore } from "./connection-store";
import type * as schema from "./schema";

/**
 * M4 — `testConnection` resolves the connection WITH credentials and runs
 * the provider's `testConnection`. A provider error that echoes the
 * credential must be masked before it is returned to the (manage-access)
 * browser. There is no run-scoped registry on this path, so the router
 * builds a per-call mask set from the resolved config's string leaves.
 */

const SECRET = "super-secret-token-abc123";

function fakeProviderRegistry(): IntegrationProviderRegistry {
  return {
    register() {},
    getProviders: () => [],
    hasProvider: () => true,
    getProviderConnectionSchema: () => undefined,
    getProvider: (qualifiedId: string) =>
      qualifiedId === "demo.provider"
        ? {
            id: "provider",
            qualifiedId: "demo.provider",
            ownerPluginId: "demo",
            displayName: "Demo",
            // Echoes the resolved token in its error — the leak vector.
            testConnection: async () => {
              throw new Error(
                `401 Unauthorized using Bearer ${SECRET} against demo`,
              );
            },
          }
        : undefined,
  } as unknown as IntegrationProviderRegistry;
}

function fakeConnectionStore(): ConnectionStore {
  return {
    listConnections: async () => [],
    getConnection: async () => undefined,
    getConnectionWithCredentials: async () => ({
      id: "conn-1",
      providerId: "demo.provider",
      name: "Demo connection",
      // Resolved credentials live here.
      config: { apiToken: SECRET, baseUrl: "https://demo.example" },
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    createConnection: async () => {
      throw new Error("nope");
    },
    updateConnection: async () => {
      throw new Error("nope");
    },
    deleteConnection: async () => false,
    findConnectionProvider: async () => "demo.provider",
  } as unknown as ConnectionStore;
}

function buildRouter() {
  const noopLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as Parameters<typeof createIntegrationRouter>[0]["logger"];
  return createIntegrationRouter({
    db: {} as unknown as SafeDatabase<typeof schema>,
    providerRegistry: fakeProviderRegistry(),
    connectionStore: fakeConnectionStore(),
    logger: noopLogger,
  });
}

describe("M4 — testConnection masks provider errors that echo credentials", () => {
  it("redacts the resolved token in the returned error message", async () => {
    const router = buildRouter();
    const result = await call(
      router.testConnection,
      { connectionId: "conn-1" },
      { context: createMockRpcContext() },
    );

    expect(result.success).toBe(false);
    expect(result.message).not.toContain(SECRET);
    expect(result.message).toContain("****");
    expect(result.message).toBe(
      "401 Unauthorized using Bearer **** against demo",
    );
  });
});
