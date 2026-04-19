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
import { SatelliteService } from "./service";
import { createSatelliteRouter } from "./router";
import { HeartbeatMonitor } from "./heartbeat-monitor";
import { SatelliteWsHandler } from "./satellite-ws-handler";
import { ConfigRelay } from "./config-relay";

// Queue and job constants
const HEARTBEAT_QUEUE = "satellite-heartbeat";
const HEARTBEAT_JOB_ID = "satellite-heartbeat-check";
const HEARTBEAT_WORKER_GROUP = "satellite-heartbeat-worker";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerAccessRules(satelliteAccessRules);

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        signalService: coreServices.signalService,
        queueManager: coreServices.queueManager,
        wsRegistry: coreServices.wsRegistry,
      },
      init: async ({ logger, database, rpc, signalService }) => {
        logger.debug("🛰️ Initializing Satellite Backend...");

        const service = new SatelliteService(
          database as SafeDatabase<typeof schema>,
        );

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

        logger.debug("✅ Satellite Backend afterPluginsReady complete.");
      },
    });
  },
});

// Re-export hooks for other plugins to use
export { satelliteHooks } from "./hooks";
