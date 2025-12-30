import { HealthCheckRegistry, Logger, Fetch } from "@checkmate/backend-api";
import { QueueFactory } from "@checkmate/queue-api";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
} from "./schema";
import * as schema from "./schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

type Db = NodePgDatabase<typeof schema>;

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
 * @param queueFactory - Queue factory service
 * @param payload - Health check job payload
 * @param intervalSeconds - Interval between executions
 * @param startDelay - Optional delay before first execution (for delta-based scheduling)
 * @param logger - Optional logger
 */
export async function scheduleHealthCheck(props: {
  queueFactory: QueueFactory;
  payload: HealthCheckJobPayload;
  intervalSeconds: number;
  startDelay?: number;
  logger?: Logger;
}): Promise<string> {
  const {
    queueFactory,
    payload,
    intervalSeconds,
    startDelay = 0,
    logger,
  } = props;

  const queue = await queueFactory.createQueue<HealthCheckJobPayload>(
    HEALTH_CHECK_QUEUE
  );

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
 * Execute a health check job
 */
async function executeHealthCheckJob(props: {
  payload: HealthCheckJobPayload;
  db: Db;
  registry: HealthCheckRegistry;
  logger: Logger;
  fetch: Fetch;
}): Promise<void> {
  const { payload, db, registry, logger, fetch } = props;
  const { configId, systemId } = payload;

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

    // Store result
    await db.insert(healthCheckRuns).values({
      configurationId: configId,
      systemId,
      status: result.status,
      result,
    });

    logger.debug(
      `Ran health check ${configId} for system ${systemId}: ${result.status}`
    );

    // Propagate status to catalog
    await propagateStatus({ systemId, db, logger, fetch });

    // Note: No manual rescheduling needed - recurring job handles it automatically
  } catch (error) {
    logger.error(
      `Failed to execute health check ${configId} for system ${systemId}`,
      error
    );

    // Store failure
    await db.insert(healthCheckRuns).values({
      configurationId: configId,
      systemId,
      status: "unhealthy",
      result: { error: String(error) },
    });

    // Propagate status even on failure
    await propagateStatus({ systemId, db, logger, fetch });

    // Note: No manual rescheduling needed - recurring job handles it automatically
  }
}

/**
 * Propagate health status to catalog backend
 */
async function propagateStatus(props: {
  systemId: string;
  db: Db;
  logger: Logger;
  fetch: Fetch;
}): Promise<void> {
  const { systemId, db, logger, fetch } = props;

  try {
    const aggregateStatus = await calculateAggregateStatus(systemId, db);

    logger.info(
      `Propagating status '${aggregateStatus}' for system ${systemId}`
    );

    const response = await fetch
      .forPlugin("catalog-backend")
      .put(`/entities/systems/${systemId}`, { status: aggregateStatus });

    if (!response.ok) {
      const text = await response.text();
      logger.error(
        `Failed to propagate status for system ${systemId}: ${response.status} ${text}`
      );
    }
  } catch (error) {
    logger.error(`Error propagating status for system ${systemId}`, error);
  }
}

/**
 * Calculate aggregate health status for a system
 */
async function calculateAggregateStatus(
  systemId: string,
  db: Db
): Promise<string> {
  // 1. Get all enabled checks for this system
  const checks = await db
    .select({ configId: systemHealthChecks.configurationId })
    .from(systemHealthChecks)
    .where(
      and(
        eq(systemHealthChecks.systemId, systemId),
        eq(systemHealthChecks.enabled, true)
      )
    );

  if (checks.length === 0) return "healthy";

  const statuses: string[] = [];

  // 2. Get the latest run for each check
  for (const check of checks) {
    const latestRun = await db
      .select({ status: healthCheckRuns.status })
      .from(healthCheckRuns)
      .where(
        and(
          eq(healthCheckRuns.systemId, systemId),
          eq(healthCheckRuns.configurationId, check.configId)
        )
      )
      .orderBy(desc(healthCheckRuns.timestamp))
      .limit(1);

    if (latestRun.length > 0) {
      statuses.push(latestRun[0].status);
    }
  }

  if (statuses.length === 0) return "healthy";

  // Aggregation logic:
  // - Any 'unhealthy' -> 'unhealthy'
  // - Any 'degraded' -> 'degraded' (if no unhealthy)
  // - All 'healthy' -> 'healthy'

  if (statuses.includes("unhealthy")) return "unhealthy";
  if (statuses.includes("degraded")) return "degraded";
  return "healthy";
}

/**
 * Setup the health check worker to consume from the queue
 */
export async function setupHealthCheckWorker(props: {
  db: Db;
  registry: HealthCheckRegistry;
  logger: Logger;
  fetch: Fetch;
  queueFactory: QueueFactory;
}): Promise<void> {
  const { db, registry, logger, fetch, queueFactory } = props;

  const queue = await queueFactory.createQueue<HealthCheckJobPayload>(
    HEALTH_CHECK_QUEUE
  );

  // Subscribe to health check queue in work-queue mode
  await queue.consume(
    async (job) => {
      await executeHealthCheckJob({
        payload: job.data,
        db,
        registry,
        logger,
        fetch,
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
  queueFactory: QueueFactory;
  logger: Logger;
}): Promise<void> {
  const { db, queueFactory, logger } = props;

  // Subquery to get the latest run timestamp per check (efficient, no in-memory grouping)
  const latestRuns = db
    .select({
      systemId: healthCheckRuns.systemId,
      configurationId: healthCheckRuns.configurationId,
      maxTimestamp: sql<Date>`MAX(${healthCheckRuns.timestamp})`.as(
        "max_timestamp"
      ),
    })
    .from(healthCheckRuns)
    .groupBy(healthCheckRuns.systemId, healthCheckRuns.configurationId)
    .as("latest_runs");

  // Get all enabled health checks with their latest run time (one row per check)
  const enabledChecks = await db
    .select({
      systemId: systemHealthChecks.systemId,
      configId: healthCheckConfigurations.id,
      interval: healthCheckConfigurations.intervalSeconds,
      lastRun: latestRuns.maxTimestamp,
    })
    .from(systemHealthChecks)
    .innerJoin(
      healthCheckConfigurations,
      eq(systemHealthChecks.configurationId, healthCheckConfigurations.id)
    )
    .leftJoin(
      latestRuns,
      and(
        eq(latestRuns.systemId, systemHealthChecks.systemId),
        eq(latestRuns.configurationId, systemHealthChecks.configurationId)
      )
    )
    .where(eq(systemHealthChecks.enabled, true));

  logger.debug(`Bootstrapping ${enabledChecks.length} health checks`);

  for (const check of enabledChecks) {
    // Calculate delta for first run
    let startDelay = 0;
    if (check.lastRun) {
      const elapsedSeconds = Math.floor(
        (Date.now() - check.lastRun.getTime()) / 1000
      );
      if (elapsedSeconds < check.interval) {
        // Not overdue yet - schedule with remaining time
        startDelay = check.interval - elapsedSeconds;
      }
      // Otherwise it's overdue - run immediately (startDelay = 0)
    }

    await scheduleHealthCheck({
      queueFactory,
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
  const queue = await queueFactory.createQueue<HealthCheckJobPayload>(
    HEALTH_CHECK_QUEUE
  );
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
