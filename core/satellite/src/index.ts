import type { SatelliteAssignment } from "@checkstack/satellite-common";
import { registerSandboxPolicyProvider } from "@checkstack/backend-api";
import { resolveScriptPackagesDir } from "@checkstack/script-packages-backend";
import { SatelliteClient } from "./satellite-client";
import { SatelliteSandboxPolicyCache } from "./sandbox-policy-cache";
import { Scheduler } from "./scheduler";
import { loadStrategies } from "./strategy-loader";
import { executeAssignment } from "./execute-assignment";
import { SatelliteScriptPackages } from "./satellite-script-packages";
import { TelemetryClient } from "./telemetry-client";
import { AgentCapabilityRegistry } from "./capability-config-registry";
import {
  computeCapabilities,
  isTelemetryEnabled,
  removedScrapeEnvWarning,
} from "./capabilities";
import { startTelemetryReceivers } from "./telemetry/receivers";
import { registerBuiltinPullExecutors } from "./telemetry/pull/executors";

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
  throw new Error(
    "CHECKSTACK_SATELLITE_TOKEN environment variable is required",
  );
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

// =============================================================================
// Bootstrap
// =============================================================================

logger.info(`Core URL: ${CORE_URL}`);
logger.info(`Client ID: ${CLIENT_ID}`);

// Telemetry / capability plumbing (additive; entirely off the health-result
// path). Capabilities are advertised from env flags; the telemetry client +
// capability registry are instantiated only when at least one capability is
// enabled. SAT-B wires the concrete receivers/scrapers into these instances.
// Statically-linked telemetry-pull executors (prometheus-scrape, k8s-events)
// must be registered before the pull scheduler resolves any pushed config.
registerBuiltinPullExecutors();

const capabilities = computeCapabilities(process.env);
const telemetryEnabled = isTelemetryEnabled(capabilities);
if (capabilities.length > 0) {
  logger.info(`Advertising capabilities: ${capabilities.join(", ")}`);
}
const removedScrapeWarning = removedScrapeEnvWarning(process.env);
if (removedScrapeWarning) logger.warn(removedScrapeWarning);

const client = new SatelliteClient({
  coreUrl: CORE_URL,
  clientId: CLIENT_ID,
  token: TOKEN,
  version: VERSION,
  logger,
  ...(telemetryEnabled ? { capabilities } : {}),
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
  onConnected: () => {
    // Resume the telemetry credit window once the socket is authenticated.
    telemetryClient?.onConnected();
  },
  onTelemetryAck: (ack) => {
    telemetryClient?.handleAck(ack);
  },
  onCapabilityConfig: (input) => {
    capabilityRegistry?.handleCapabilityConfig(input);
  },
  onDisconnect: () => {
    scheduler.stop();
    // Requeue in-flight batches + reset the credit window for the next socket.
    telemetryClient?.onDisconnected();
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
  onExecute: async ({ assignment, environment }) => {
    try {
      const result = await executeAssignment(
        assignment,
        environment,
        {
          requestRunSecrets: (input) => client.requestRunSecrets(input),
          requestConfigSecrets: (input) => client.requestConfigSecrets(input),
        },
        { healthCheckRegistry, collectorRegistry, logger },
      );
      client.sendResult(result);
    } catch (error) {
      logger.error(
        `Failed to execute ${assignment.configId}: ${String(error)}`,
      );
      client.sendResult({
        type: "result",
        configId: assignment.configId,
        systemId: assignment.systemId,
        environmentId: environment?.id ?? null,
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

// Telemetry sender + agent capability registry. Instantiated after `client`
// so their send/status closures reference the live socket (same forward-
// reference style as `scheduler` above). SAT-B registers receivers/scrapers
// against these: `telemetryClient.enqueue({ kind, items, estimateBytes })` to
// forward, `capabilityRegistry.register({ kind, onCapabilityConfig })` to
// consume pushed config, and `capabilityRegistry.emitStatus({ kind, payload })`
// to source status back to core.
const telemetryClient = telemetryEnabled
  ? new TelemetryClient({
      send: (msg) => client.sendTelemetry(msg),
      logger,
    })
  : undefined;

const capabilityRegistry = telemetryEnabled
  ? new AgentCapabilityRegistry({
      sendStatus: (input) => client.sendCapabilityStatus(input),
      logger,
    })
  : undefined;

telemetryClient?.start();

// Local telemetry receivers (HTTP logs/metrics + syslog), each behind its own
// capability flag. They forward into the ONE telemetry client above; nothing
// here touches the health-result path. Only started when the telemetry client
// exists (i.e. at least one capability is advertised).
const telemetryReceivers =
  telemetryClient !== undefined && capabilityRegistry !== undefined
    ? startTelemetryReceivers({
        capabilities,
        telemetryClient,
        capabilityRegistry,
        fetchSecret: (input) => client.requestCapabilitySecret(input),
        logger,
      })
    : undefined;

// Start the connection
void client.connect();

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down...");
  scheduler.stop();
  telemetryReceivers?.stop();
  telemetryClient?.stop();
  client.disconnect();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down...");
  scheduler.stop();
  telemetryReceivers?.stop();
  telemetryClient?.stop();
  client.disconnect();
  process.exit(0);
});
