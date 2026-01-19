import {
  HealthCheckRegistry,
  Logger,
  type EmitHookFn,
  type CollectorRegistry,
  evaluateAssertions,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { QueueManager } from "@checkstack/queue-api";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
} from "./schema";
import * as schema from "./schema";
import { eq, and, max } from "drizzle-orm";
import { type SignalService } from "@checkstack/signal-common";
import {
  HEALTH_CHECK_RUN_COMPLETED,
  type HealthCheckStatus,
  stripEphemeralFields,
} from "@checkstack/healthcheck-common";
import { CatalogApi, catalogRoutes } from "@checkstack/catalog-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import { resolveRoute, type InferClient } from "@checkstack/common";
import { HealthCheckService } from "./service";
import { healthCheckHooks } from "./hooks";

type Db = SafeDatabase<typeof schema>;
type CatalogClient = InferClient<typeof CatalogApi>;
type MaintenanceClient = InferClient<typeof MaintenanceApi>;

/**
 * Payload for health check queue jobs
 */
export interface HealthCheckJobPayload {
  configId: string;
  systemId: string;
}

/**
 * Queue name for health check execution
 */
const HEALTH_CHECK_QUEUE = "health-checks";

/**
 * Worker group for health check execution (work-queue mode)
 */
const WORKER_GROUP = "health-check-executor";

/**
 * Schedule a health check for execution using recurring jobs
 * @param queueManager - Queue manager service
 * @param payload - Health check job payload
 * @param intervalSeconds - Interval between executions
 * @param startDelay - Optional delay before first execution (for delta-based scheduling)
 * @param logger - Optional logger
 */
export async function scheduleHealthCheck(props: {
  queueManager: QueueManager;
  payload: HealthCheckJobPayload;
  intervalSeconds: number;
  startDelay?: number;
  logger?: Logger;
}): Promise<string> {
  const {
    queueManager,
    payload,
    intervalSeconds,
    startDelay = 0,
    logger,
  } = props;

  const queue =
    queueManager.getQueue<HealthCheckJobPayload>(HEALTH_CHECK_QUEUE);

  const jobId = `healthcheck:${payload.configId}:${payload.systemId}`;

  logger?.debug(
    `Scheduling recurring health check ${jobId} with interval ${intervalSeconds}s, startDelay ${startDelay}s`,
  );

  return queue.scheduleRecurring(payload, {
    jobId,
    intervalSeconds,
    startDelay,
    priority: 0,
  });
}

/**
 * Notify system subscribers about a health state change.
 * Skips notification if the system has active maintenance with suppression enabled.
 */
async function notifyStateChange(props: {
  systemId: string;
  previousStatus: HealthCheckStatus;
  newStatus: HealthCheckStatus;
  catalogClient: CatalogClient;
  maintenanceClient: MaintenanceClient;
  logger: Logger;
}): Promise<void> {
  const {
    systemId,
    previousStatus,
    newStatus,
    catalogClient,
    maintenanceClient,
    logger,
  } = props;

  // Only notify on actual state changes
  if (newStatus === previousStatus) {
    return;
  }

  // Check if notifications should be suppressed due to active maintenance
  try {
    const { suppressed } =
      await maintenanceClient.hasActiveMaintenanceWithSuppression({ systemId });
    if (suppressed) {
      logger.debug(
        `Skipping notification for ${systemId}: active maintenance with suppression enabled`,
      );
      return;
    }
  } catch (error) {
    // Log but continue with notification - suppression check failure shouldn't block notifications
    logger.warn(
      `Failed to check maintenance suppression for ${systemId}, proceeding with notification:`,
      error,
    );
  }

  const isRecovery = newStatus === "healthy" && previousStatus !== "healthy";
  const isDegraded = newStatus === "degraded";
  const isUnhealthy = newStatus === "unhealthy";

  let title: string;
  let body: string;
  let importance: "info" | "warning" | "critical";

  if (isRecovery) {
    title = "System health restored";
    body =
      "All health checks are now passing. The system has returned to normal operation.";
    importance = "info";
  } else if (isUnhealthy) {
    title = "System health critical";
    body = "Health checks indicate the system is unhealthy and may be down.";
    importance = "critical";
  } else if (isDegraded) {
    title = "System health degraded";
    body =
      "Some health checks are failing. The system may be experiencing issues.";
    importance = "warning";
  } else {
    // No notification for healthy → healthy (if somehow missed above)
    return;
  }

  const systemDetailPath = resolveRoute(catalogRoutes.routes.systemDetail, {
    systemId,
  });

  try {
    await catalogClient.notifySystemSubscribers({
      systemId,
      title,
      body,
      importance,
      action: { label: "View System", url: systemDetailPath },
      includeGroupSubscribers: true,
    });
    logger.debug(
      `Notified subscribers: ${previousStatus} → ${newStatus} for system ${systemId}`,
    );
  } catch (error) {
    // Log but don't fail the operation - notifications are best-effort
    logger.warn(
      `Failed to notify subscribers for health state change on system ${systemId}:`,
      error,
    );
  }
}

/**
 * Execute a health check job
 */
async function executeHealthCheckJob(props: {
  payload: HealthCheckJobPayload;
  db: Db;
  registry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  logger: Logger;
  signalService: SignalService;
  catalogClient: CatalogClient;
  maintenanceClient: MaintenanceClient;
  getEmitHook: () => EmitHookFn | undefined;
}): Promise<void> {
  const {
    payload,
    db,
    registry,
    collectorRegistry,
    logger,
    signalService,
    catalogClient,
    maintenanceClient,
    getEmitHook,
  } = props;
  const { configId, systemId } = payload;

  // Create service for aggregated state evaluation
  const service = new HealthCheckService(db);

  // Capture aggregated state BEFORE this run for comparison
  const previousState = await service.getSystemHealthStatus(systemId);
  const previousStatus = previousState.status;

  try {
    // Fetch configuration (including name for signals)
    const [configRow] = await db
      .select({
        configId: healthCheckConfigurations.id,
        configName: healthCheckConfigurations.name,
        strategyId: healthCheckConfigurations.strategyId,
        config: healthCheckConfigurations.config,
        collectors: healthCheckConfigurations.collectors,
        interval: healthCheckConfigurations.intervalSeconds,
        enabled: systemHealthChecks.enabled,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
      )
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configId),
          eq(systemHealthChecks.enabled, true),
        ),
      );

    // If configuration not found or disabled, exit without rescheduling
    if (!configRow) {
      logger.debug(
        `Health check ${configId} for system ${systemId} not found or disabled, not rescheduling`,
      );
      return;
    }

    // Fetch system name for signal payload
    let systemName = systemId;
    try {
      const system = await catalogClient.getSystem({ systemId });
      if (system) {
        systemName = system.name;
      }
    } catch {
      // Fall back to systemId if catalog lookup fails
      logger.debug(`Could not fetch system name for ${systemId}, using ID`);
    }

    const strategy = registry.getStrategy(configRow.strategyId);
    if (!strategy) {
      logger.warn(
        `Strategy ${configRow.strategyId} not found for config ${configId}`,
      );
      return;
    }

    // Execute health check using createClient pattern
    const start = performance.now();
    let connectedClient;
    try {
      connectedClient = await strategy.createClient(
        configRow.config as Record<string, unknown>,
      );
    } catch (error) {
      // Connection failed
      const latencyMs = Math.round(performance.now() - start);
      const errorMessage =
        error instanceof Error ? error.message : "Connection failed";

      const result = {
        status: "unhealthy" as const,
        latencyMs,
        message: errorMessage,
        metadata: { connected: false, error: errorMessage },
      };

      await db.insert(healthCheckRuns).values({
        configurationId: configId,
        systemId,
        status: result.status,
        latencyMs: result.latencyMs,
        result: { ...result } as Record<string, unknown>,
      });

      logger.debug(
        `Health check ${configId} for system ${systemId} failed: ${errorMessage}`,
      );

      // Broadcast failure signal
      await signalService.broadcast(HEALTH_CHECK_RUN_COMPLETED, {
        systemId,
        systemName,
        configurationId: configId,
        configurationName: configRow.configName,
        status: result.status,
        latencyMs: result.latencyMs,
      });

      // Check and notify state change
      const newState = await service.getSystemHealthStatus(systemId);
      if (newState.status !== previousStatus) {
        await notifyStateChange({
          systemId,
          previousStatus,
          newStatus: newState.status,
          catalogClient,
          maintenanceClient,
          logger,
        });
      }

      return;
    }

    const connectionTimeMs = Math.round(performance.now() - start);

    // Execute collectors
    const collectors = configRow.collectors ?? [];
    const collectorResults: Record<string, unknown> = {};
    let hasCollectorError = false;
    let errorMessage: string | undefined;

    try {
      for (const collectorEntry of collectors) {
        const registered = collectorRegistry.getCollector(
          collectorEntry.collectorId,
        );
        if (!registered) {
          logger.warn(
            `Collector ${collectorEntry.collectorId} not found, skipping`,
          );
          continue;
        }

        // Use the collector's UUID as the storage key
        const storageKey = collectorEntry.id;

        try {
          const collectorResult = await registered.collector.execute({
            config: collectorEntry.config,
            client: connectedClient.client,
            pluginId: configRow.strategyId,
          });

          // Check for collector-level error
          if (collectorResult.error) {
            hasCollectorError = true;
            errorMessage = collectorResult.error;
          }

          // Evaluate per-collector assertions
          let assertionFailed: string | undefined;
          if (
            collectorEntry.assertions &&
            collectorEntry.assertions.length > 0 &&
            collectorResult.result
          ) {
            const assertions = collectorEntry.assertions;
            const failedAssertion = evaluateAssertions(
              assertions,
              collectorResult.result as Record<string, unknown>,
            );
            if (failedAssertion) {
              hasCollectorError = true;
              assertionFailed = `${failedAssertion.field} ${
                failedAssertion.operator
              } ${failedAssertion.value ?? ""}`;
              errorMessage = `Assertion failed: ${assertionFailed}`;
              logger.debug(
                `Collector ${storageKey} assertion failed: ${errorMessage}`,
              );
            }
          }

          // Strip ephemeral fields (like HTTP body) before storage to save space
          const strippedResult = stripEphemeralFields(
            collectorResult.result as Record<string, unknown>,
            registered.collector.result.schema,
          );

          // Store result under the collector's UUID, with collector type and assertion metadata
          collectorResults[storageKey] = {
            _collectorId: collectorEntry.collectorId, // Store the type for frontend schema linking
            _assertionFailed: assertionFailed, // null if no assertion failed
            ...strippedResult,
          };
        } catch (error) {
          hasCollectorError = true;
          errorMessage = error instanceof Error ? error.message : String(error);
          collectorResults[storageKey] = {
            _collectorId: collectorEntry.collectorId,
            _assertionFailed: undefined,
            error: errorMessage,
          };
          logger.debug(`Collector ${storageKey} failed: ${errorMessage}`);
        }
      }
    } finally {
      // Clean up connection
      try {
        connectedClient.close();
      } catch {
        // Ignore close errors
      }
    }

    // Determine health status based on collector results
    const status = hasCollectorError ? "unhealthy" : "healthy";
    const totalLatencyMs = Math.round(performance.now() - start);

    const result = {
      status: status as "healthy" | "unhealthy",
      latencyMs: totalLatencyMs,
      message: hasCollectorError
        ? `Check failed: ${errorMessage}`
        : `Completed in ${totalLatencyMs}ms`,
      metadata: {
        connected: true,
        connectionTimeMs,
        collectors: collectorResults,
      },
    };

    // Store result (spread to convert structured type to plain record for jsonb)
    await db.insert(healthCheckRuns).values({
      configurationId: configId,
      systemId,
      status: result.status,
      latencyMs: result.latencyMs,
      result: { ...result } as Record<string, unknown>,
    });

    logger.debug(
      `Ran health check ${configId} for system ${systemId}: ${result.status}`,
    );

    // Broadcast enriched signal for realtime frontend updates (e.g., terminal feed)
    await signalService.broadcast(HEALTH_CHECK_RUN_COMPLETED, {
      systemId,
      systemName,
      configurationId: configId,
      configurationName: configRow.configName,
      status: result.status,
      latencyMs: result.latencyMs,
    });

    // Check if aggregated state changed and notify subscribers
    const newState = await service.getSystemHealthStatus(systemId);
    if (newState.status !== previousStatus) {
      await notifyStateChange({
        systemId,
        previousStatus,
        newStatus: newState.status,
        catalogClient,
        maintenanceClient,
        logger,
      });

      // Emit integration hooks for external integrations
      const emitHook = getEmitHook();
      if (emitHook) {
        if (newState.status === "healthy" && previousStatus !== "healthy") {
          // Recovery: system became healthy
          await emitHook(healthCheckHooks.systemHealthy, {
            systemId,
            previousStatus,
            healthyChecks: newState.checkStatuses.filter(
              (c) => c.status === "healthy",
            ).length,
            totalChecks: newState.checkStatuses.length,
            timestamp: new Date().toISOString(),
          });
          logger.debug(
            `Emitted systemHealthy hook: ${previousStatus} → ${newState.status}`,
          );
        } else if (
          previousStatus === "healthy" &&
          newState.status !== "healthy"
        ) {
          // Degradation: system went from healthy to unhealthy/degraded
          await emitHook(healthCheckHooks.systemDegraded, {
            systemId,
            previousStatus,
            newStatus: newState.status,
            healthyChecks: newState.checkStatuses.filter(
              (c) => c.status === "healthy",
            ).length,
            totalChecks: newState.checkStatuses.length,
            timestamp: new Date().toISOString(),
          });
          logger.debug(
            `Emitted systemDegraded hook: ${previousStatus} → ${newState.status}`,
          );
        }
      }
    }

    // Note: No manual rescheduling needed - recurring job handles it automatically
  } catch (error) {
    logger.error(
      `Failed to execute health check ${configId} for system ${systemId}`,
      error,
    );

    // Store failure (no latencyMs for failures)
    await db.insert(healthCheckRuns).values({
      configurationId: configId,
      systemId,
      status: "unhealthy",
      result: { error: String(error) } as Record<string, unknown>,
    });

    // Try to fetch names for the enriched signal (best-effort)
    let systemName = systemId;
    let configName = configId;
    try {
      const system = await catalogClient.getSystem({ systemId });
      if (system) {
        systemName = system.name;
      }
      const [config] = await db
        .select({ name: healthCheckConfigurations.name })
        .from(healthCheckConfigurations)
        .where(eq(healthCheckConfigurations.id, configId));
      if (config) {
        configName = config.name;
      }
    } catch {
      // Use IDs as fallback
    }

    // Broadcast enriched failure signal for realtime frontend updates
    await signalService.broadcast(HEALTH_CHECK_RUN_COMPLETED, {
      systemId,
      systemName,
      configurationId: configId,
      configurationName: configName,
      status: "unhealthy",
    });

    // Check if aggregated state changed and notify subscribers
    const newState = await service.getSystemHealthStatus(systemId);
    if (newState.status !== previousStatus) {
      await notifyStateChange({
        systemId,
        previousStatus,
        newStatus: newState.status,
        catalogClient,
        maintenanceClient,
        logger,
      });

      // Emit integration hooks for external integrations
      const emitHook = getEmitHook();
      if (emitHook) {
        if (newState.status === "healthy" && previousStatus !== "healthy") {
          // Recovery: system became healthy
          await emitHook(healthCheckHooks.systemHealthy, {
            systemId,
            previousStatus,
            healthyChecks: newState.checkStatuses.filter(
              (c) => c.status === "healthy",
            ).length,
            totalChecks: newState.checkStatuses.length,
            timestamp: new Date().toISOString(),
          });
          logger.debug(
            `Emitted systemHealthy hook: ${previousStatus} → ${newState.status}`,
          );
        } else if (
          previousStatus === "healthy" &&
          newState.status !== "healthy"
        ) {
          // Degradation: system went from healthy to unhealthy/degraded
          await emitHook(healthCheckHooks.systemDegraded, {
            systemId,
            previousStatus,
            newStatus: newState.status,
            healthyChecks: newState.checkStatuses.filter(
              (c) => c.status === "healthy",
            ).length,
            totalChecks: newState.checkStatuses.length,
            timestamp: new Date().toISOString(),
          });
          logger.debug(
            `Emitted systemDegraded hook: ${previousStatus} → ${newState.status}`,
          );
        }
      }
    }

    // Note: No manual rescheduling needed - recurring job handles it automatically
  }
}

export async function setupHealthCheckWorker(props: {
  db: Db;
  registry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  logger: Logger;
  queueManager: QueueManager;
  signalService: SignalService;
  catalogClient: CatalogClient;
  maintenanceClient: MaintenanceClient;
  getEmitHook: () => EmitHookFn | undefined;
}): Promise<void> {
  const {
    db,
    registry,
    collectorRegistry,
    logger,
    queueManager,
    signalService,
    catalogClient,
    maintenanceClient,
    getEmitHook,
  } = props;

  const queue =
    queueManager.getQueue<HealthCheckJobPayload>(HEALTH_CHECK_QUEUE);

  // Subscribe to health check queue in work-queue mode
  await queue.consume(
    async (job) => {
      await executeHealthCheckJob({
        payload: job.data,
        db,
        registry,
        collectorRegistry,
        logger,
        signalService,
        catalogClient,
        maintenanceClient,
        getEmitHook,
      });
    },
    {
      consumerGroup: WORKER_GROUP,
      maxRetries: 0, // Health checks should not retry on failure
    },
  );

  logger.debug("🎯 Health Check Worker subscribed to queue");
}

/**
 * Bootstrap health checks by enqueueing all enabled checks
 */
export async function bootstrapHealthChecks(props: {
  db: Db;
  queueManager: QueueManager;
  logger: Logger;
}): Promise<void> {
  const { db, queueManager, logger } = props;

  // Get all enabled health checks
  const enabledChecks = await db
    .select({
      systemId: systemHealthChecks.systemId,
      configId: healthCheckConfigurations.id,
      interval: healthCheckConfigurations.intervalSeconds,
    })
    .from(systemHealthChecks)
    .innerJoin(
      healthCheckConfigurations,
      eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
    )
    .where(eq(systemHealthChecks.enabled, true));

  // Get latest run timestamp for each system+config pair
  // Using Drizzle's max() function for proper timestamp handling (no raw SQL)
  const latestRuns = await db
    .select({
      systemId: healthCheckRuns.systemId,
      configurationId: healthCheckRuns.configurationId,
      maxTimestamp: max(healthCheckRuns.timestamp),
    })
    .from(healthCheckRuns)
    .groupBy(healthCheckRuns.systemId, healthCheckRuns.configurationId);

  // Create a lookup map for fast access
  const lastRunMap = new Map<string, Date>();
  for (const run of latestRuns) {
    if (run.maxTimestamp) {
      const key = `${run.systemId}:${run.configurationId}`;
      lastRunMap.set(key, run.maxTimestamp);
    }
  }

  logger.debug(`Bootstrapping ${enabledChecks.length} health checks`);

  for (const check of enabledChecks) {
    // Look up the last run from the map
    const lastRunKey = `${check.systemId}:${check.configId}`;
    const lastRun = lastRunMap.get(lastRunKey);

    // Calculate delay for first run based on time since last run
    let startDelay = 0;
    if (lastRun) {
      const elapsedSeconds = Math.floor(
        (Date.now() - lastRun.getTime()) / 1000,
      );
      if (elapsedSeconds < check.interval) {
        // Not overdue yet - schedule with remaining time
        startDelay = check.interval - elapsedSeconds;
      }
      // Otherwise it's overdue - run immediately (startDelay = 0)
      logger.debug(
        `Health check ${check.configId}:${
          check.systemId
        } - lastRun: ${lastRun.toISOString()}, elapsed: ${elapsedSeconds}s, interval: ${
          check.interval
        }s, startDelay: ${startDelay}s`,
      );
    } else {
      logger.debug(
        `Health check ${check.configId}:${check.systemId} - no lastRun found, running immediately`,
      );
    }

    await scheduleHealthCheck({
      queueManager,
      payload: {
        configId: check.configId,
        systemId: check.systemId,
      },
      intervalSeconds: check.interval,
      startDelay,
      logger,
    });
  }

  logger.debug(`✅ Bootstrapped ${enabledChecks.length} health checks`);

  // Clean up orphaned jobs
  const queue =
    queueManager.getQueue<HealthCheckJobPayload>(HEALTH_CHECK_QUEUE);
  const allRecurringJobs = await queue.listRecurringJobs();
  const expectedJobIds = new Set(
    enabledChecks.map(
      (check) => `healthcheck:${check.configId}:${check.systemId}`,
    ),
  );

  const orphanedJobs = allRecurringJobs.filter(
    (jobId) => jobId.startsWith("healthcheck:") && !expectedJobIds.has(jobId),
  );

  for (const jobId of orphanedJobs) {
    await queue.cancelRecurring(jobId);
    logger.debug(`Removed orphaned job scheduler: ${jobId}`);
  }

  if (orphanedJobs.length > 0) {
    logger.info(
      `🧹 Cleaned up ${orphanedJobs.length} orphaned health check jobs`,
    );
  }
}
