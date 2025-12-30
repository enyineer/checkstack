import {
  HealthCheckRegistry,
  Logger,
  Fetch,
  QueueFactory,
} from "@checkmate/backend-api";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
} from "./schema";
import * as schema from "./schema";
import { eq, desc, and } from "drizzle-orm";
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
 * Schedule a health check for execution
 * @param queueFactory - Queue factory service
 * @param payload - Health check job payload
 * @param intervalSeconds - Delay before execution (from configuration)
 */
export async function scheduleHealthCheck(props: {
  queueFactory: QueueFactory;
  payload: HealthCheckJobPayload;
  intervalSeconds: number;
  logger?: Logger;
}): Promise<string> {
  const { queueFactory, payload, intervalSeconds, logger } = props;

  const queue = await queueFactory.createQueue<HealthCheckJobPayload>(
    HEALTH_CHECK_QUEUE
  );

  // Use deterministic job ID to prevent duplicates across instances
  const jobId = `healthcheck:${payload.configId}:${payload.systemId}`;

  const resultJobId = await queue.enqueue(payload, {
    delaySeconds: intervalSeconds,
    priority: 0,
    jobId,
  });

  // If the returned jobId matches our jobId, it was either created or already exists
  if (resultJobId === jobId && logger) {
    logger.debug(
      `Scheduled health check ${payload.configId} for system ${payload.systemId} (may be duplicate)`
    );
  }

  return resultJobId;
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
  queueFactory: QueueFactory;
}): Promise<void> {
  const { payload, db, registry, logger, fetch, queueFactory } = props;
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

    // Re-schedule for next execution
    await scheduleHealthCheck({
      queueFactory,
      payload,
      intervalSeconds: configRow.interval,
      logger,
    });

    logger.debug(
      `Rescheduled health check ${configId} for system ${systemId} in ${configRow.interval}s`
    );
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

    // Re-schedule even on failure (health checks can fail intentionally)
    // We need to fetch the interval from the database since we might not have it if we failed early
    try {
      const [config] = await db
        .select({ interval: healthCheckConfigurations.intervalSeconds })
        .from(healthCheckConfigurations)
        .where(eq(healthCheckConfigurations.id, configId));

      if (config) {
        await scheduleHealthCheck({
          queueFactory,
          payload,
          intervalSeconds: config.interval,
          logger,
        });
      }
    } catch (rescheduleError) {
      logger.error(
        `Failed to reschedule health check ${configId} after failure`,
        rescheduleError
      );
    }
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
        queueFactory,
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

  logger.debug(`Bootstrapping ${enabledChecks.length} health checks`);

  for (const check of enabledChecks) {
    await scheduleHealthCheck({
      queueFactory,
      payload: {
        configId: check.configId,
        systemId: check.systemId,
      },
      intervalSeconds: check.interval,
      logger,
    });
  }

  logger.debug(`✅ Bootstrapped ${enabledChecks.length} health checks`);
}
