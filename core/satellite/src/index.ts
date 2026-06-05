import type {
  SatelliteAssignment,
  ResultMessage,
} from "@checkstack/satellite-common";
import {
  registerSandboxPolicyProvider,
  type ConnectedClient,
  type TransportClient,
  type CollectorRunContext,
} from "@checkstack/backend-api";
import { resolveScriptPackagesDir } from "@checkstack/script-packages-backend";
import { SatelliteClient } from "./satellite-client";
import { SatelliteSandboxPolicyCache } from "./sandbox-policy-cache";
import { Scheduler } from "./scheduler";
import { loadStrategies } from "./strategy-loader";
import { buildRunContext } from "./run-context";
import { SatelliteScriptPackages } from "./satellite-script-packages";

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

// Wire the process-wide GLOBAL sandbox policy provider for the satellite
// runtime. The script runners (shell + ESM) resolve the active policy through
// this provider and FAIL CLOSED if none is registered, so it MUST be set before
// any health-check script runs.
//
// The satellite has no ConfigService, so it cannot read the durable cluster
// policy directly. Instead the core RELAYS the resolved global policy over the
// already-authenticated WS channel: on connect (carried in the `authenticated`
// message) and on change (a `sandbox_policy` push). The cache holds the last
// relayed policy and the provider resolves through it.
//
// FAIL CLOSED UNTIL RELAY: before the first policy is received, the cache's
// provider returns the FAIL_CLOSED profile (deny egress, scratch filesystem +
// read-only managed packages, privilege drop) - NEVER the permissive shipped
// default. A satellite must never run a script with a looser policy than core
// relayed; before the first relay there is none, so it denies. Trust is
// established by the authenticated WS connection.
const sandboxPolicyCache = new SatelliteSandboxPolicyCache();
registerSandboxPolicyProvider(sandboxPolicyCache.toProvider());

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

/** Whether a collector config declares a non-empty secretEnv mapping. */
function declaresSecretEnv(config: Record<string, unknown>): boolean {
  const se = config.secretEnv;
  return (
    typeof se === "object" &&
    se !== null &&
    Object.keys(se as Record<string, unknown>).length > 0
  );
}

async function executeAssignment(
  assignment: SatelliteAssignment,
  deps: {
    /**
     * Request a collector run's resolved secret env from core (JIT). Throws
     * on delivery/resolution failure so the collector fails clearly.
     */
    requestRunSecrets: (input: {
      configId: string;
      collectorId: string;
      runId: string;
    }) => Promise<Record<string, string>>;
  },
): Promise<ResultMessage> {
  const strategy = healthCheckRegistry.getStrategy(assignment.strategyId);
  if (!strategy) {
    return {
      type: "result",
      configId: assignment.configId,
      systemId: assignment.systemId,
      status: "unhealthy",
      latencyMs: 0,
      executedAt: new Date().toISOString(),
      result: {
        status: "unhealthy",
        latencyMs: 0,
        message: `Strategy ${assignment.strategyId} not found in satellite`,
        metadata: {
          connected: false,
          error: `Strategy ${assignment.strategyId} not found in satellite`,
        },
      },
    };
  }

  // Curated, read-only run-context metadata exposed to collectors.
  // Mirrors the core queue-executor; falls back to IDs when the optional
  // name fields are absent (version-skew safety).
  const runContext: CollectorRunContext = buildRunContext({ assignment });

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
          // JIT secret delivery: if this collector declares a secretEnv,
          // fetch the resolved values from core over the WS channel just
          // before running. Held in memory only for this run; never written
          // to disk and never part of the persisted assignment. A delivery
          // / resolution failure throws and fails the collector clearly.
          let secretEnv: Record<string, string> | undefined;
          if (declaresSecretEnv(collectorEntry.config)) {
            secretEnv = await deps.requestRunSecrets({
              configId: assignment.configId,
              collectorId: collectorEntry.id,
              runId: crypto.randomUUID(),
            });
          }

          const collectorResult = await registered.collector.execute({
            config: collectorEntry.config,
            client: connectedClient!.client,
            pluginId: assignment.strategyId,
            runContext,
            ...(secretEnv ? { secretEnv } : {}),
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
  onScriptPackagesLockfileHash: (lockfileHash) => {
    void scriptPackages.reconcile(lockfileHash);
  },
  onSandboxPolicy: (policy) => {
    // Cache the relayed cluster-wide policy; the runner's provider resolves
    // through this cache. Fail-closed until the first relay arrives.
    sandboxPolicyCache.set(policy);
    logger.info("Applied relayed global sandbox policy");
  },
  onDisconnect: () => {
    scheduler.stop();
  },
});

// Script-package reconciler: pulls blobs from CORE over the WS channel
// (never the registry), materializes node_modules, atomically flips
// `<store>/current`. Triggered on connect (assignment-carried backstop) and
// on `refresh_script_packages` pushes.
const scriptPackages = new SatelliteScriptPackages({
  storeRoot: resolveScriptPackagesDir(),
  requestManifest: (hash) => client.requestManifest(hash),
  requestBlob: (integrity) => client.requestBlob(integrity),
  reportState: (state) => client.reportScriptPackageSyncState(state),
  logger,
});

const scheduler = new Scheduler({
  logger,
  onExecute: async (assignment: SatelliteAssignment) => {
    try {
      const result = await executeAssignment(assignment, {
        requestRunSecrets: (input) => client.requestRunSecrets(input),
      });
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
        latencyMs: 0,
        executedAt: new Date().toISOString(),
        result: {
          status: "unhealthy",
          latencyMs: 0,
          message: String(error),
          metadata: {
            connected: false,
            error: String(error),
          },
        },
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
