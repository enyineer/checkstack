import type {
  SatelliteAssignment,
  ResultMessage,
} from "@checkstack/satellite-common";
import type {
  ConnectedClient,
  TransportClient,
} from "@checkstack/backend-api";
import { SatelliteClient } from "./satellite-client";
import { Scheduler } from "./scheduler";
import { loadStrategies } from "./strategy-loader";

// =============================================================================
// Environment validation — fail fast if required vars are missing
// =============================================================================

const CORE_URL = process.env["CHECKSTACK_CORE_URL"];
const CLIENT_ID = process.env["CHECKSTACK_SATELLITE_CLIENT_ID"];
const TOKEN = process.env["CHECKSTACK_SATELLITE_TOKEN"];

if (!CORE_URL) {
  throw new Error("CHECKSTACK_CORE_URL environment variable is required");
}
if (!CLIENT_ID) {
  throw new Error(
    "CHECKSTACK_SATELLITE_CLIENT_ID environment variable is required",
  );
}
if (!TOKEN) {
  throw new Error("CHECKSTACK_SATELLITE_TOKEN environment variable is required");
}

// Read version from package.json
const pkg = await import("../package.json");
const VERSION = (pkg as { version?: string }).version ?? "unknown";

// =============================================================================
// Logger
// =============================================================================

const logger = {
  info: (msg: string) => console.log(`[satellite] ${msg}`),
  warn: (msg: string) => console.warn(`[satellite] ${msg}`),
  error: (msg: string) => console.error(`[satellite] ${msg}`),
  debug: (msg: string) => {
    if (process.env["DEBUG"]) {
      console.log(`[satellite:debug] ${msg}`);
    }
  },
};

// =============================================================================
// Strategy loading — dynamically discovers healthcheck-*-backend plugins
// =============================================================================

logger.info(`Starting Checkstack Satellite v${VERSION}`);
logger.info("Loading health check strategies...");

const { healthCheckRegistry, collectorRegistry } = await loadStrategies({
  logger,
});

// =============================================================================
// Health check executor — mirrors core queue-executor pattern:
// 1. Look up strategy by ID
// 2. createClient(config) to establish connection + measure latency
// 3. Execute collectors against the connected client
// 4. Close client and report result
// =============================================================================

async function executeAssignment(
  assignment: SatelliteAssignment,
): Promise<ResultMessage> {
  const strategy = healthCheckRegistry.getStrategy(assignment.strategyId);
  if (!strategy) {
    return {
      type: "result",
      configId: assignment.configId,
      systemId: assignment.systemId,
      status: "unhealthy",
      executedAt: new Date().toISOString(),
      result: {
        error: `Strategy ${assignment.strategyId} not found in satellite`,
      },
    };
  }

  const start = performance.now();
  let connectedClient:
    | ConnectedClient<TransportClient<never, unknown>>
    | undefined;

  try {
    // 1. Establish connection (measures connectivity + latency)
    connectedClient = await strategy.createClient(assignment.config);
    const connectionTimeMs = Math.round(performance.now() - start);

    // 2. Execute collectors if configured
    const collectors = assignment.collectors ?? [];
    const collectorResults: Record<string, unknown> = {};
    let hasCollectorError = false;
    let errorMessage: string | undefined;

    if (collectors.length > 0) {
      const collectorPromises = collectors.map(async (collectorEntry) => {
        const registered = collectorRegistry.getCollector(
          collectorEntry.collectorId,
        );
        if (!registered) {
          logger.warn(
            `Collector ${collectorEntry.collectorId} not found, skipping`,
          );
          return { storageKey: collectorEntry.id, skipped: true };
        }

        try {
          const collectorResult = await registered.collector.execute({
            config: collectorEntry.config,
            client: connectedClient!.client,
            pluginId: assignment.strategyId,
          });

          return {
            storageKey: collectorEntry.id,
            skipped: false,
            success: !collectorResult.error,
            error: collectorResult.error,
            result: {
              _collectorId: collectorEntry.collectorId,
              ...collectorResult.result,
            },
          };
        } catch (error) {
          return {
            storageKey: collectorEntry.id,
            skipped: false,
            success: false,
            error: String(error),
            result: {
              _collectorId: collectorEntry.collectorId,
              error: String(error),
            },
          };
        }
      });

      const settledResults = await Promise.allSettled(collectorPromises);

      for (const settled of settledResults) {
        if (settled.status === "rejected") {
          hasCollectorError = true;
          if (!errorMessage) errorMessage = String(settled.reason);
          continue;
        }

        const result = settled.value;
        if (result.skipped) continue;

        collectorResults[result.storageKey] = result.result;

        if (!result.success) {
          hasCollectorError = true;
          if (!errorMessage) errorMessage = result.error;
        }
      }
    }

    const latencyMs = Math.round(performance.now() - start);

    // 3. Build result — matches local queue-executor structure so
    //    frontend auto-charts and history detail page work identically.
    const status = hasCollectorError ? "unhealthy" : "healthy";
    const result: ResultMessage = {
      type: "result",
      configId: assignment.configId,
      systemId: assignment.systemId,
      status,
      latencyMs,
      executedAt: new Date().toISOString(),
      result: {
        status,
        latencyMs,
        message: errorMessage
          ? `Check failed: ${errorMessage}`
          : `Completed in ${latencyMs}ms`,
        metadata: {
          connected: true,
          connectionTimeMs,
          collectors: collectorResults,
        },
      },
    };

    return result;
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      type: "result",
      configId: assignment.configId,
      systemId: assignment.systemId,
      status: "unhealthy",
      latencyMs,
      executedAt: new Date().toISOString(),
      result: {
        status: "unhealthy",
        latencyMs,
        message: String(error),
        metadata: {
          connected: !!connectedClient,
          error: String(error),
        },
      },
    };
  } finally {
    try {
      connectedClient?.close();
    } catch {
      // Ignore close errors
    }
  }
}

// =============================================================================
// Bootstrap
// =============================================================================

logger.info(`Core URL: ${CORE_URL}`);
logger.info(`Client ID: ${CLIENT_ID}`);

const client = new SatelliteClient({
  coreUrl: CORE_URL,
  clientId: CLIENT_ID,
  token: TOKEN,
  version: VERSION,
  logger,
  onAssignments: (assignments: SatelliteAssignment[]) => {
    scheduler.updateAssignments(assignments);
  },
  onDisconnect: () => {
    scheduler.stop();
  },
});

const scheduler = new Scheduler({
  logger,
  onExecute: async (assignment: SatelliteAssignment) => {
    try {
      const result = await executeAssignment(assignment);
      client.sendResult(result);
    } catch (error) {
      logger.error(
        `Failed to execute ${assignment.configId}: ${String(error)}`,
      );
      client.sendResult({
        type: "result",
        configId: assignment.configId,
        systemId: assignment.systemId,
        status: "unhealthy",
        executedAt: new Date().toISOString(),
        result: { error: String(error) },
      });
    }
  },
});

// Start the connection
void client.connect();

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down...");
  scheduler.stop();
  client.disconnect();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down...");
  scheduler.stop();
  client.disconnect();
  process.exit(0);
});
