import { HealthCheckRegistry, Logger } from "@checkmate/backend-api";
import { QueueManager } from "@checkmate/queue-api";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
} from "./schema";
import * as schema from "./schema";
import { eq, and, max } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { type SignalService } from "@checkmate/signal-common";
import {
  HEALTH_CHECK_STATE_CHANGED,
  type HealthCheckStatus,
} from "@checkmate/healthcheck-common";
import { CatalogApi, catalogRoutes } from "@checkmate/catalog-common";
import { resolveRoute, type InferClient } from "@checkmate/common";
import { HealthCheckService } from "./service";

type Db = NodePgDatabase<typeof schema>;
type CatalogClient = InferClient<typeof CatalogApi>;

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
    `Scheduling recurring health check ${jobId} with interval ${intervalSeconds}s, startDelay ${startDelay}s`
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
 */
async function notifyStateChange(props: {
  systemId: string;
  previousStatus: HealthCheckStatus;
  newStatus: HealthCheckStatus;
  catalogClient: CatalogClient;
  logger: Logger;
}): Promise<void> {
  const { systemId, previousStatus, newStatus, catalogClient, logger } = props;

  // Only notify on actual state changes
  if (newStatus === previousStatus) {
    return;
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
      `Notified subscribers: ${previousStatus} → ${newStatus} for system ${systemId}`
    );
  } catch (error) {
    // Log but don't fail the operation - notifications are best-effort
    logger.warn(
      `Failed to notify subscribers for health state change on system ${systemId}:`,
      error
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
  logger: Logger;
  signalService: SignalService;
  catalogClient: CatalogClient;
}): Promise<void> {
  const { payload, db, registry, logger, signalService, catalogClient } = props;
  const { configId, systemId } = payload;

  // Create service for aggregated state evaluation
  const service = new HealthCheckService(db);

  // Capture aggregated state BEFORE this run for comparison
  const previousState = await service.getSystemHealthStatus(systemId);
  const previousStatus = previousState.status;

  try {
    // Fetch configuration
    const [configRow] = await db
      .select({
        configId: healthCheckConfigurations.id,
        strategyId: healthCheckConfigurations.strategyId,
        config: healthCheckConfigurations.config,
        interval: healthCheckConfigurations.intervalSeconds,
        enabled: systemHealthChecks.enabled,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id)
      )
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configId),
          eq(systemHealthChecks.enabled, true)
        )
      );

    // If configuration not found or disabled, exit without rescheduling
    if (!configRow) {
      logger.debug(
        `Health check ${configId} for system ${systemId} not found or disabled, not rescheduling`
      );
      return;
    }

    const strategy = registry.getStrategy(configRow.strategyId);
    if (!strategy) {
      logger.warn(
        `Strategy ${configRow.strategyId} not found for config ${configId}`
      );
      return;
    }

    // Execute health check
    const result = await strategy.execute(
      configRow.config as Record<string, unknown>
    );

    // Store result (spread to convert structured type to plain record for jsonb)
    await db.insert(healthCheckRuns).values({
      configurationId: configId,
      systemId,
      status: result.status,
      latencyMs: result.latencyMs,
      result: { ...result } as Record<string, unknown>,
    });

    logger.debug(
      `Ran health check ${configId} for system ${systemId}: ${result.status}`
    );

    // Broadcast signal for realtime frontend updates
    await signalService.broadcast(HEALTH_CHECK_STATE_CHANGED, {
      systemId,
      configurationId: configId,
      status: result.status,
    });

    // Check if aggregated state changed and notify subscribers
    const newState = await service.getSystemHealthStatus(systemId);
    if (newState.status !== previousStatus) {
      await notifyStateChange({
        systemId,
        previousStatus,
        newStatus: newState.status,
        catalogClient,
        logger,
      });
    }

    // Note: No manual rescheduling needed - recurring job handles it automatically
  } catch (error) {
    logger.error(
      `Failed to execute health check ${configId} for system ${systemId}`,
      error
    );

    // Store failure (no latencyMs for failures)
    await db.insert(healthCheckRuns).values({
      configurationId: configId,
      systemId,
      status: "unhealthy",
      result: { error: String(error) } as Record<string, unknown>,
    });

    // Broadcast failure signal for realtime frontend updates
    await signalService.broadcast(HEALTH_CHECK_STATE_CHANGED, {
      systemId,
      configurationId: configId,
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
        logger,
      });
    }

    // Note: No manual rescheduling needed - recurring job handles it automatically
  }
}

/**
 * Setup the health check worker to consume from the queue
 */
export async function setupHealthCheckWorker(props: {
  db: Db;
  registry: HealthCheckRegistry;
  logger: Logger;
  queueManager: QueueManager;
  signalService: SignalService;
  catalogClient: CatalogClient;
}): Promise<void> {
  const { db, registry, logger, queueManager, signalService, catalogClient } =
    props;

  const queue =
    queueManager.getQueue<HealthCheckJobPayload>(HEALTH_CHECK_QUEUE);

  // Subscribe to health check queue in work-queue mode
  await queue.consume(
    async (job) => {
      await executeHealthCheckJob({
        payload: job.data,
        db,
        registry,
        logger,
        signalService,
        catalogClient,
      });
    },
    {
      consumerGroup: WORKER_GROUP,
      maxRetries: 0, // Health checks should not retry on failure
    }
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
      eq(systemHealthChecks.configurationId, healthCheckConfigurations.id)
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
        (Date.now() - lastRun.getTime()) / 1000
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
        }s, startDelay: ${startDelay}s`
      );
    } else {
      logger.debug(
        `Health check ${check.configId}:${check.systemId} - no lastRun found, running immediately`
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
      (check) => `healthcheck:${check.configId}:${check.systemId}`
    )
  );

  const orphanedJobs = allRecurringJobs.filter(
    (jobId) => jobId.startsWith("healthcheck:") && !expectedJobIds.has(jobId)
  );

  for (const jobId of orphanedJobs) {
    await queue.cancelRecurring(jobId);
    logger.debug(`Removed orphaned job scheduler: ${jobId}`);
  }

  if (orphanedJobs.length > 0) {
    logger.info(
      `🧹 Cleaned up ${orphanedJobs.length} orphaned health check jobs`
    );
  }
}
