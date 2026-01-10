import { mock } from "bun:test";
import { RpcContext, EmitHookFn } from "./rpc";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { HealthCheckRegistry } from "./health-check";
import { CollectorRegistry } from "./collector-registry";
import { QueuePluginRegistry, QueueManager } from "@checkstack/queue-api";

/**
 * Creates a mocked oRPC context for testing.
 */
export function createMockRpcContext(
  overrides: Partial<RpcContext> = {}
): RpcContext {
  return {
    pluginMetadata: { pluginId: "test-plugin" },
    db: mock() as unknown as NodePgDatabase<Record<string, unknown>>,
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
      getAnonymousPermissions: mock().mockResolvedValue([]),
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
    user: undefined,
    emitHook: mock() as unknown as EmitHookFn,
    ...overrides,
  };
}
