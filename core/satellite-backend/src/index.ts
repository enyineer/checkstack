import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import {
  satelliteAccessRules,
  satelliteContract,
  pluginMetadata,
  HEARTBEAT_INTERVAL_MS,
} from "@checkstack/satellite-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { healthCheckHooks } from "@checkstack/healthcheck-backend";
import { ScriptPackagesApi } from "@checkstack/script-packages-common";
import { scriptPackagesChangedHook } from "@checkstack/script-packages-backend";
import { secretResolverRef } from "@checkstack/secrets-backend";
import { resolveSatelliteRunSecrets } from "./run-secret-resolver";
import { SatelliteService } from "./service";
import { createSatelliteRouter } from "./router";
import { HeartbeatMonitor } from "./heartbeat-monitor";
import { SatelliteWsHandler } from "./satellite-ws-handler";
import { ConfigRelay } from "./config-relay";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import { registerSatelliteGitOpsKinds } from "./satellite-gitops-kinds";
import {
  entityExtensionPoint,
  type EntityHandle,
} from "@checkstack/automation-backend";
import {
  SATELLITE_CONNECTION_ENTITY_KIND,
  createSatelliteConnectionRead,
  deriveSatelliteConnectionEvents,
  satelliteConnectionStateSchema,
  type SatelliteConnectionState,
} from "./entity";

// Queue and job constants
const HEARTBEAT_QUEUE = "satellite-heartbeat";
const HEARTBEAT_JOB_ID = "satellite-heartbeat-check";
const HEARTBEAT_WORKER_GROUP = "satellite-heartbeat-worker";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(satelliteAccessRules);

    // ─── Automation Platform: reactive connection entity ─────────────
    // Satellite connection state is the `satellite-connection` entity
    // (reactive automation engine §10.6, §9.1), PLUGIN-BACKED (Model B):
    // its current state lives in the DURABLE, shared `satellites` table
    // (the `connectionStatus` / `lastSeenAt` / `lastConnectionEvent`
    // columns) — there is NO framework `entity_state` mirror. `read` reads
    // those columns via the service, so EVERY pod sees the same state (this
    // fixes the horizontal-scaling read bug where the old in-memory map made a
    // satellite connected to pod A invisible to pod B). The three lifecycle
    // sites (connect / disconnect / heartbeat-lost) write through
    // `handle.mutate` — the pod that owns the socket UPDATEs the row — and the
    // framework still records full transition HISTORY in `entity_transitions`.
    //
    // The `satellite.connected` / `.disconnected` / `.heartbeat_lost` trigger
    // events are DERIVED from its changes (no hook-backed triggers). The
    // persisted `satellites.lastHeartbeatAt` column stays as escape-hatched
    // bookkeeping — the entity's `connectionStatus` is what's reactive.
    const entity = env.getExtensionPoint(entityExtensionPoint);
    entity.registerChangeDeriver({
      kind: SATELLITE_CONNECTION_ENTITY_KIND,
      derive: deriveSatelliteConnectionEvents,
    });
    entity.declareNonReactiveState({
      table: "satellites",
      reason: "bookkeeping",
      note: "lastHeartbeatAt is operational bookkeeping; the reactive connection state is the satellite-connection entity's status field.",
    });
    // Created once in init; reused by the WS handler + heartbeat monitor.
    let satelliteEntityHandle: EntityHandle<SatelliteConnectionState>;

    // ─── GitOps Entity Kind Registration ─────────────────────────────
    let gitopsService: SatelliteService | undefined;
    const kindRegistry = env.getExtensionPoint(entityKindExtensionPoint);
    registerSatelliteGitOpsKinds({
      kindRegistry,
      getService: () => {
        if (!gitopsService) throw new Error("SatelliteService not initialized");
        return gitopsService;
      },
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        signalService: coreServices.signalService,
        queueManager: coreServices.queueManager,
        wsRegistry: coreServices.wsRegistry,
        secretResolver: secretResolverRef,
      },
      init: async ({ logger, database, rpc, signalService }) => {
        logger.debug("🛰️ Initializing Satellite Backend...");

        const service = new SatelliteService(
          database as SafeDatabase<typeof schema>,
        );
        gitopsService = service;

        // Declare the reactive `satellite-connection` entity once. PLUGIN-
        // BACKED: `read` reads the durable connection columns of the shared
        // `satellites` table via the service (the source of truth — no
        // `entity_state` mirror, globally readable from any pod). The handle is
        // the only typed path that drives connection-state changes (reactive
        // automation engine §4.2); it is reused by the WS handler + heartbeat
        // monitor wired in afterPluginsReady.
        satelliteEntityHandle = entity.defineEntity({
          kind: SATELLITE_CONNECTION_ENTITY_KIND,
          state: satelliteConnectionStateSchema,
          read: createSatelliteConnectionRead(service),
        });

        const router = createSatelliteRouter({
          service,
          signalService,
          logger,
        });
        rpc.registerRouter(router, satelliteContract);

        logger.debug("✅ Satellite Backend initialized.");
      },
      afterPluginsReady: async ({
        database,
        queueManager,
        logger,
        signalService,
        wsRegistry,
        rpcClient,
        secretResolver,
        onHook,
      }) => {
        const service = new SatelliteService(
          database as SafeDatabase<typeof schema>,
        );

        // Wire ConfigRelay via RPC loopback to healthcheck-backend
        const configRelay = new ConfigRelay(async () => {
          const hcClient = rpcClient.forPlugin(HealthCheckApi);
          return {
            getAssignmentsForSatellite: async (satelliteId: string) => {
              return hcClient.getAssignmentsForSatellite({ satelliteId });
            },
          };
        });

        // Wire result handler — ingests satellite results into healthcheck-backend
        const wsHandler = new SatelliteWsHandler(
          service,
          configRelay,
          {
            handleResult: async ({ satelliteId, sourceLabel, result }) => {
              const hcClient = rpcClient.forPlugin(HealthCheckApi);
              await hcClient.ingestSatelliteResult({
                configId: result.configId,
                systemId: result.systemId,
                status: result.status,
                latencyMs: result.latencyMs,
                result: result.result,
                executedAt: result.executedAt,
                sourceId: satelliteId,
                sourceLabel,
              });
              logger.debug(
                `Ingested result from satellite ${satelliteId} (${sourceLabel}): ` +
                  `config=${result.configId} status=${result.status}`,
              );
            },
          },
          logger,
          {
            // Drive connect/disconnect through `handle.mutate` (Model B):
            // `apply` UPDATEs the satellite row's durable connection columns
            // (the globally-readable source of truth) and returns the view. The
            // framework snapshots `prev` via `read`, records the transition
            // (durable history), and emits the change; the deriver re-fires the
            // equivalent trigger events.
            mirror: async (satelliteId, state) => {
              await satelliteEntityHandle.mutate({
                id: satelliteId,
                apply: () =>
                  service.applyConnectionState({
                    satelliteId,
                    status: state.status,
                    lastEvent: state.lastEvent,
                    lastSeenAt: new Date(state.lastSeenAt),
                  }),
              });
            },
          },
          {
            // Script-package distribution: carry the desired lockfile hash in
            // assignment payloads + persist per-satellite reconcile state.
            // Satellites pull blobs from CORE (getManifest/downloadBlob),
            // never the registry.
            getDesiredLockfileHash: async () => {
              const spClient = rpcClient.forPlugin(ScriptPackagesApi);
              const state = await spClient.getInstallState();
              return state.lockfileHash;
            },
            reportSyncState: async (input) => {
              const spClient = rpcClient.forPlugin(ScriptPackagesApi);
              await spClient.reportSatelliteSyncState(input);
            },
            getManifest: async ({ lockfileHash }) => {
              const spClient = rpcClient.forPlugin(ScriptPackagesApi);
              const res = await spClient.getManifest({ lockfileHash });
              return res.entries;
            },
            getBlobBase64: async ({ integrity }) => {
              const spClient = rpcClient.forPlugin(ScriptPackagesApi);
              try {
                const res = await spClient.downloadBlob({ integrity });
                return res.data;
              } catch {
                return null;
              }
            },
          },
          {
            // JIT secret delivery: resolve a collector's declared secretEnv
            // (read from the satellite's own assignment) via the central
            // resolver. Values are returned over the WS channel per-run and
            // never persisted.
            resolveRunSecrets: async ({ satelliteId, configId, collectorId }) =>
              resolveSatelliteRunSecrets({
                satelliteId,
                configId,
                collectorId,
                getAssignmentsForSatellite: (id) =>
                  configRelay.getAssignmentsForSatellite(id),
                resolver: secretResolver,
              }),
          },
        );

        // Register satellite WebSocket endpoint via the scoped WS registry
        // pluginId "satellite" is auto-prefixed → available at /api/ws/satellite
        wsRegistry.register("/", wsHandler);
        logger.debug("✅ Satellite WebSocket endpoint registered at /api/ws/satellite");

        // Setup heartbeat monitor
        const heartbeatMonitor = new HeartbeatMonitor(
          service,
          signalService,
          logger,
          {
            // Drive the online → offline edge through `handle.mutate`; `apply`
            // UPDATEs the satellite row's durable connection columns and returns
            // the view, the framework records the transition (durable history),
            // and the deriver re-fires `satellite.heartbeat_lost`. The
            // heartbeat monitor is also the offline-on-timeout BACKSTOP for
            // distributed presence: if a pod dies without flipping its
            // satellites to offline, the stale "online" persists only until
            // this monitor observes the heartbeat timeout and writes "offline".
            mirror: async (satelliteId, state) => {
              await satelliteEntityHandle.mutate({
                id: satelliteId,
                apply: () =>
                  service.applyConnectionState({
                    satelliteId,
                    status: state.status,
                    lastEvent: state.lastEvent,
                    lastSeenAt: new Date(state.lastSeenAt),
                  }),
              });
            },
          },
        );

        const queue = queueManager.getQueue<Record<string, never>>(
          HEARTBEAT_QUEUE,
        );

        // Subscribe to heartbeat check jobs
        await queue.consume(
          async () => {
            await heartbeatMonitor.checkHeartbeats();
          },
          {
            consumerGroup: HEARTBEAT_WORKER_GROUP,
            maxRetries: 0,
          },
        );

        // Schedule heartbeat check at the same interval as the heartbeat itself
        const intervalSeconds = Math.round(HEARTBEAT_INTERVAL_MS / 1000);
        await queue.scheduleRecurring(
          {},
          {
            jobId: HEARTBEAT_JOB_ID,
            intervalSeconds,
          },
        );

        logger.debug(
          `✅ Satellite heartbeat monitor scheduled (every ${intervalSeconds}s).`,
        );

        // Subscribe to assignment changes to push config to connected satellites
        onHook(
          healthCheckHooks.assignmentChanged,
          async () => {
            await wsHandler.pushConfigUpdateToAll();
          },
        );

        // Fan the script-packages.changed broadcast out to THIS instance's
        // connected satellites. Every core instance subscribes in broadcast
        // mode, so each pushes to its own satellites; offline satellites
        // converge via the assignment-carried lockfile hash on reconnect.
        onHook(
          scriptPackagesChangedHook,
          async ({ lockfileHash }) => {
            wsHandler.pushRefreshScriptPackagesToAll(lockfileHash);
          },
          { mode: "broadcast" },
        );

        logger.debug("✅ Satellite Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { satelliteHooks } from "./hooks";
