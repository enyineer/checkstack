import { mock } from "bun:test";
import { RpcContext, EmitHookFn } from "./rpc";
import { SafeDatabase } from "./plugin-system";
import { HealthCheckRegistry } from "./health-check";
import { CollectorRegistry } from "./collector-registry";
import { QueuePluginRegistry, QueueManager } from "@checkstack/queue-api";

/**
 * Creates a mocked oRPC context for testing.
 * By default provides an authenticated user with wildcard access.
 */
export function createMockRpcContext(
  overrides: Partial<RpcContext> = {},
): RpcContext {
  return {
    pluginMetadata: { pluginId: "test-plugin" },
    db: mock() as unknown as SafeDatabase<Record<string, unknown>>,
    logger: {
      info: mock(),
      error: mock(),
      warn: mock(),
      debug: mock(),
    },
    fetch: {
      fetch: mock(),
      forPlugin: mock().mockReturnValue({
        fetch: mock(),
        get: mock(),
        post: mock(),
        put: mock(),
        patch: mock(),
        delete: mock(),
      }),
    },
    auth: {
      authenticate: mock(),
      getCredentials: mock().mockResolvedValue({ headers: {} }),
      getAnonymousAccessRules: mock().mockResolvedValue([]),
      checkResourceTeamAccess: mock().mockResolvedValue({ hasAccess: true }),
      getAccessibleResourceIds: mock().mockImplementation(
        (params: { resourceIds: string[] }) =>
          Promise.resolve(params.resourceIds),
      ),
    },
    healthCheckRegistry: {
      register: mock(),
      getStrategies: mock().mockReturnValue([]),
      getStrategy: mock(),
      getStrategiesWithMeta: mock().mockReturnValue([]),
    } as unknown as HealthCheckRegistry,
    collectorRegistry: {
      register: mock(),
      getCollector: mock(),
      getCollectors: mock().mockReturnValue([]),
      getCollectorsForPlugin: mock().mockReturnValue([]),
    } as unknown as CollectorRegistry,
    queuePluginRegistry: {
      register: mock(),
      getPlugin: mock(),
      getPlugins: mock().mockReturnValue([]),
    } as unknown as QueuePluginRegistry,
    queueManager: {
      getQueue: mock(),
      getActivePlugin: mock(),
      getActiveConfig: mock(),
      setActiveBackend: mock(),
      getInFlightJobCount: mock(),
      listAllRecurringJobs: mock(),
      startPolling: mock(),
      shutdown: mock(),
    } as unknown as QueueManager,
    // Default: authenticated user with wildcard access for testing
    user: { type: "user" as const, id: "test-user", accessRules: ["*"] },
    emitHook: mock() as unknown as EmitHookFn,
    ...overrides,
  };
}
