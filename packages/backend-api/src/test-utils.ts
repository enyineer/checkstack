import { mock } from "bun:test";
import { RpcContext } from "./rpc";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { HealthCheckRegistry } from "./health-check";
import { QueuePluginRegistry, QueueManager } from "@checkmate/queue-api";

/**
 * Creates a mocked oRPC context for testing.
 */
export function createMockRpcContext(
  overrides: Partial<RpcContext> = {}
): RpcContext {
  return {
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
      registerStrategy: mock(),
      getStrategies: mock().mockReturnValue([]),
      getStrategy: mock(),
    } as unknown as HealthCheckRegistry,
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
    ...overrides,
  };
}
