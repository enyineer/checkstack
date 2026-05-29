import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
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
   * How often the worker ticks. Default 60s. Set lower in tests.
   */
  intervalSeconds?: number;
}

const DEFAULT_INTERVAL_SECONDS = 60;

/**
 * Background worker that resolves auto-opened incidents once the
 * underlying system has stayed healthy for the per-incident cooldown.
 * The cooldown is snapshot per-row at open time (see
 * `healthCheckAutoIncidents.cooldownMinutes`) so a policy change does
 * not retroactively alter the close behaviour of incidents already in
 * flight. A `null` cooldown means "never auto-close" — the worker
 * skips those rows and an operator must resolve them manually.
 */
export async function setupAutoIncidentCloseJob(deps: AutoCloseJobDeps) {
  const {
    queueManager,
    logger,
    db,
    incidentClient,
    intervalSeconds = DEFAULT_INTERVAL_SECONDS,
  } = deps;

  const queue = queueManager.getQueue<AutoCloseJobPayload>(AUTO_CLOSE_QUEUE);

  await queue.consume(
    async () => {
      await runAutoIncidentCloseJob({ db, logger, incidentClient });
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
    `Health check auto-incident close job scheduled (interval ${intervalSeconds}s; cooldown is per-incident)`,
  );
}

/**
 * Resolve any open auto-incidents whose linked system has been
 * steadily healthy for at least their snapshot `cooldownMinutes`. Rows
 * with a null cooldown are skipped. Each incident is processed
 * independently; one failure does not abort the sweep.
 */
export async function runAutoIncidentCloseJob({
  db,
  logger,
  incidentClient,
}: {
  db: Db;
  logger: Logger;
  incidentClient: IncidentClient;
}): Promise<{ closed: number }> {
  const now = new Date();

  // All open auto-incidents with a non-null cooldown — rows with null
  // cooldown opted out of auto-close entirely.
  const open = await db
    .select({
      id: healthCheckAutoIncidents.id,
      incidentId: healthCheckAutoIncidents.incidentId,
      systemId: healthCheckAutoIncidents.systemId,
      openedAt: healthCheckAutoIncidents.openedAt,
      cooldownMinutes: healthCheckAutoIncidents.cooldownMinutes,
    })
    .from(healthCheckAutoIncidents)
    .where(
      and(
        isNull(healthCheckAutoIncidents.closedAt),
        isNotNull(healthCheckAutoIncidents.cooldownMinutes),
      ),
    );

  let closed = 0;

  for (const row of open) {
    try {
      const cooldownMinutes = row.cooldownMinutes;
      if (cooldownMinutes === null) continue; // narrows the type

      const cooldownStart = new Date(now.getTime() - cooldownMinutes * 60_000);

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
