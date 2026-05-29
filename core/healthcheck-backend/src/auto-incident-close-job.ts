import { and, eq, gte, isNull } from "drizzle-orm";
import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import { IncidentApi } from "@checkstack/incident-common";
import type { QueueManager } from "@checkstack/queue-api";
import * as schema from "./schema";
import { healthCheckAutoIncidents, healthCheckRuns } from "./schema";

type Db = SafeDatabase<typeof schema>;
type IncidentClient = InferClient<typeof IncidentApi>;

const AUTO_CLOSE_QUEUE = "health-check-auto-incident-close";

interface AutoCloseJobPayload {
  trigger: "scheduled";
}

interface AutoCloseJobDeps {
  db: Db;
  logger: Logger;
  queueManager: QueueManager;
  incidentClient: IncidentClient;
  /**
   * Minutes of sustained healthy state required before an auto-opened
   * incident is closed. Default 30.
   */
  cooldownMinutes?: number;
  /**
   * How often the worker ticks. Default 60s. Set lower in tests.
   */
  intervalSeconds?: number;
}

const DEFAULT_COOLDOWN_MINUTES = 30;
const DEFAULT_INTERVAL_SECONDS = 60;

/**
 * Background worker that resolves auto-opened incidents once the
 * underlying system has stayed healthy for the cooldown window. Uses
 * the queue manager so it survives across worker restarts and stays
 * coordinated in multi-instance deployments.
 */
export async function setupAutoIncidentCloseJob(deps: AutoCloseJobDeps) {
  const {
    queueManager,
    logger,
    db,
    incidentClient,
    cooldownMinutes = DEFAULT_COOLDOWN_MINUTES,
    intervalSeconds = DEFAULT_INTERVAL_SECONDS,
  } = deps;

  const queue = queueManager.getQueue<AutoCloseJobPayload>(AUTO_CLOSE_QUEUE);

  await queue.consume(
    async () => {
      await runAutoIncidentCloseJob({
        db,
        logger,
        incidentClient,
        cooldownMinutes,
      });
    },
    { consumerGroup: "auto-incident-close-worker" },
  );

  await queue.scheduleRecurring(
    { trigger: "scheduled" },
    {
      jobId: "health-check-auto-incident-close",
      intervalSeconds,
    },
  );

  logger.info(
    `Health check auto-incident close job scheduled (interval ${intervalSeconds}s, cooldown ${cooldownMinutes}m)`,
  );
}

/**
 * Resolve any open auto-incidents whose linked system has been
 * steadily healthy for at least `cooldownMinutes`. "Steadily healthy"
 * means no unhealthy runs recorded inside the cooldown window. Each
 * incident is processed independently; one failure does not abort the
 * sweep.
 */
export async function runAutoIncidentCloseJob({
  db,
  logger,
  incidentClient,
  cooldownMinutes = DEFAULT_COOLDOWN_MINUTES,
}: {
  db: Db;
  logger: Logger;
  incidentClient: IncidentClient;
  cooldownMinutes?: number;
}): Promise<{ closed: number }> {
  const cooldownStart = new Date(Date.now() - cooldownMinutes * 60_000);

  // All open auto-incidents — closedAt IS NULL.
  const open = await db
    .select({
      id: healthCheckAutoIncidents.id,
      incidentId: healthCheckAutoIncidents.incidentId,
      systemId: healthCheckAutoIncidents.systemId,
      openedAt: healthCheckAutoIncidents.openedAt,
    })
    .from(healthCheckAutoIncidents)
    .where(isNull(healthCheckAutoIncidents.closedAt));

  let closed = 0;

  for (const row of open) {
    try {
      // Require the cooldown to have elapsed since the incident was
      // opened in the first place. Without this, a system that was
      // healthy *before* we opened the incident would be auto-closed on
      // the very first tick.
      if (row.openedAt > cooldownStart) {
        continue;
      }

      // Has the system had any unhealthy runs inside the cooldown?
      const recentUnhealthy = await db
        .select({ id: healthCheckRuns.id })
        .from(healthCheckRuns)
        .where(
          and(
            eq(healthCheckRuns.systemId, row.systemId),
            eq(healthCheckRuns.status, "unhealthy"),
            gte(healthCheckRuns.timestamp, cooldownStart),
          ),
        )
        .limit(1);

      if (recentUnhealthy.length > 0) {
        continue;
      }

      // Steady-state healthy → resolve.
      await incidentClient.resolveAutoIncident({
        id: row.incidentId,
        message: `Auto-resolved: system stayed healthy for ${cooldownMinutes} minutes.`,
      });

      await db
        .update(healthCheckAutoIncidents)
        .set({ closedAt: new Date() })
        .where(eq(healthCheckAutoIncidents.id, row.id));

      closed += 1;
      logger.info(
        `Auto-closed incident ${row.incidentId} for system ${row.systemId}`,
      );
    } catch (error) {
      logger.warn(
        `Auto-close failed for incident ${row.incidentId} (system ${row.systemId}):`,
        error,
      );
    }
  }

  return { closed };
}
