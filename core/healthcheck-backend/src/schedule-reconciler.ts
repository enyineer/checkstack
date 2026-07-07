/**
 * Convergence reconciler for per-environment health-check recurring jobs.
 *
 * Every health check is scheduled as ONE recurring job per
 * `(configId, systemId, environmentId)` slice (env-less systems use the bare
 * `(configId, systemId)` form). The set of environments is DYNAMIC - it comes
 * from catalog membership, which is not pushed to this backend - so we cannot
 * rely on catching every add/remove event. Instead this reconciler computes the
 * DESIRED job set from the durable tables + current membership and converges the
 * queue's ACTUAL recurring jobs toward it (schedule missing, cancel orphans,
 * reschedule interval changes). It is idempotent and self-healing: run it at
 * boot, periodically, and (scoped to a system) right after a mutation for low
 * latency.
 *
 * Scale-correctness (state-and-scale): desired state derives entirely from
 * Postgres (`system_health_checks`, `health_check_configurations`,
 * `health_check_runs`) + the catalog membership RPC, so every pod computes the
 * same plan. A full reconcile takes the `health:reconcile` advisory lock so only
 * one pod mutates the schedule at a time.
 */
import { eq, and, max, desc } from "drizzle-orm";
import type { Logger, AdvisoryLockService } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type { InferClient } from "@checkstack/common";
import type { CatalogApi } from "@checkstack/catalog-common";
import type { SafeDatabase } from "@checkstack/backend-api";
import { healthCheckConfigurations, systemHealthChecks, healthCheckRuns } from "./schema";
import * as schema from "./schema";
import { resolveEffectiveEnvironments } from "./effective-environments";
import { computeScheduleJitterSeconds } from "./schedule-jitter";
import {
  scheduleHealthCheck,
  encodeHealthCheckJobId,
  HEALTH_CHECK_QUEUE,
  HEALTH_CHECK_JOB_PREFIX,
  type HealthCheckJobPayload,
} from "./queue-executor";

type Db = SafeDatabase<typeof schema>;
type CatalogClient = InferClient<typeof CatalogApi>;

/** A recurring job the reconciler wants to exist. */
export interface DesiredJob {
  jobId: string;
  payload: HealthCheckJobPayload;
  intervalSeconds: number;
  /** Key for the deterministic first-fire jitter (per env slice). */
  jitterKey: string;
}

export interface ReconcilePlan {
  /** Desired jobs that do not exist yet - schedule them (with jitter). */
  toSchedule: DesiredJob[];
  /** Actual jobIds not desired anymore - cancel them. */
  toCancel: string[];
  /** Desired jobs that exist but whose interval changed - reschedule them. */
  toReschedule: DesiredJob[];
}

/**
 * Pure diff: given the desired jobs and the actual recurring jobs (with their
 * current intervals), decide what to schedule / cancel / reschedule.
 *
 * `cancelOrphans: false` (a system-scoped reconcile) skips cancellation - a
 * scoped run cannot see the whole actual set, so it only ADDS/updates; the
 * periodic FULL reconcile owns orphan cleanup.
 */
export function planReconcile(props: {
  desired: DesiredJob[];
  actualJobIds: Set<string>;
  actualIntervalsById: Map<string, number>;
  cancelOrphans: boolean;
}): ReconcilePlan {
  const { desired, actualJobIds, actualIntervalsById, cancelOrphans } = props;
  const desiredById = new Map(desired.map((d) => [d.jobId, d]));

  const toSchedule: DesiredJob[] = [];
  const toReschedule: DesiredJob[] = [];
  for (const job of desired) {
    if (!actualJobIds.has(job.jobId)) {
      toSchedule.push(job);
    } else if (actualIntervalsById.get(job.jobId) !== job.intervalSeconds) {
      // Interval changed - reschedule (scheduleRecurring updates in place). Only
      // when it actually differs, so we don't reset a job's fire phase every run.
      toReschedule.push(job);
    }
  }

  const toCancel = cancelOrphans
    ? [...actualJobIds].filter(
        (jobId) =>
          jobId.startsWith(HEALTH_CHECK_JOB_PREFIX) && !desiredById.has(jobId),
      )
    : [];

  return { toSchedule, toCancel, toReschedule };
}

/**
 * Build the desired per-env recurring jobs for one or all systems from the
 * durable tables + current catalog membership.
 */
async function buildDesiredJobs(props: {
  db: Db;
  catalogClient: CatalogClient;
  logger: Logger;
  systemId?: string;
}): Promise<DesiredJob[]> {
  const { db, catalogClient, logger, systemId } = props;

  const where = systemId
    ? and(
        eq(systemHealthChecks.enabled, true),
        eq(systemHealthChecks.systemId, systemId),
      )
    : eq(systemHealthChecks.enabled, true);

  const checks = await db
    .select({
      systemId: systemHealthChecks.systemId,
      configId: healthCheckConfigurations.id,
      interval: healthCheckConfigurations.intervalSeconds,
      environmentIds: systemHealthChecks.environmentIds,
    })
    .from(systemHealthChecks)
    .innerJoin(
      healthCheckConfigurations,
      eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
    )
    .where(where);

  // Resolve each distinct system's membership once.
  const membershipBySystem = new Map<
    string,
    Awaited<ReturnType<CatalogClient["resolveSystemEnvironments"]>>
  >();
  for (const systemIdToResolve of new Set(checks.map((c) => c.systemId))) {
    try {
      membershipBySystem.set(
        systemIdToResolve,
        await catalogClient.resolveSystemEnvironments({ systemId: systemIdToResolve }),
      );
    } catch (error) {
      // Fail-open: a system we cannot resolve keeps its env-less job (no fan-out)
      // rather than being dropped from the schedule entirely.
      logger.warn(
        `Reconcile: could not resolve environments for system ${systemIdToResolve}`,
        error,
      );
      membershipBySystem.set(systemIdToResolve, []);
    }
  }

  const desired: DesiredJob[] = [];
  for (const check of checks) {
    const effectiveEnvs = resolveEffectiveEnvironments({
      environmentIds: check.environmentIds,
      membership: membershipBySystem.get(check.systemId) ?? [],
    });
    const environmentIds: (string | null)[] =
      effectiveEnvs.length > 0 ? effectiveEnvs.map((e) => e.id) : [null];

    for (const environmentId of environmentIds) {
      const jobId = encodeHealthCheckJobId({
        configId: check.configId,
        systemId: check.systemId,
        environmentId,
      });
      desired.push({
        jobId,
        payload: {
          configId: check.configId,
          systemId: check.systemId,
          environmentId,
        },
        intervalSeconds: check.interval,
        jitterKey: jobId,
      });
    }
  }
  return desired;
}

/**
 * Compute the startDelay for a newly-scheduled job: keep an in-flight cadence by
 * waiting out the remainder of the interval since the slice's last run, then add
 * the deterministic de-clustering jitter. Overdue slices (no recent run) fire
 * after just the jitter.
 */
function computeStartDelay(props: {
  intervalSeconds: number;
  lastRun: Date | undefined;
  jitterKey: string;
  now: number;
}): number {
  const { intervalSeconds, lastRun, jitterKey, now } = props;
  let startDelay = 0;
  if (lastRun) {
    const elapsed = Math.floor((now - lastRun.getTime()) / 1000);
    if (elapsed < intervalSeconds) startDelay = intervalSeconds - elapsed;
  }
  return startDelay + computeScheduleJitterSeconds({ key: jitterKey, intervalSeconds });
}

/**
 * Converge the queue's recurring health-check jobs toward the desired per-env
 * set. Pass `systemId` to reconcile just one system (add/update only, no orphan
 * cleanup); omit it for a full reconcile (also cancels orphaned jobs).
 */
export async function reconcileHealthCheckJobs(props: {
  db: Db;
  queueManager: QueueManager;
  catalogClient: CatalogClient;
  logger: Logger;
  advisoryLock?: AdvisoryLockService;
  systemId?: string;
  now?: number;
}): Promise<void> {
  const { db, queueManager, catalogClient, logger, advisoryLock, systemId, now } =
    props;
  const isFullReconcile = systemId === undefined;

  const run = async (): Promise<void> => {
    const desired = await buildDesiredJobs({ db, catalogClient, logger, systemId });

    // Last run per (system, config, environment) slice for startDelay.
    const lastRunRows = await db
      .select({
        systemId: healthCheckRuns.systemId,
        configurationId: healthCheckRuns.configurationId,
        environmentId: healthCheckRuns.environmentId,
        maxTimestamp: max(healthCheckRuns.timestamp),
      })
      .from(healthCheckRuns)
      .groupBy(
        healthCheckRuns.systemId,
        healthCheckRuns.configurationId,
        healthCheckRuns.environmentId,
      );
    const lastRunByJobId = new Map<string, Date>();
    for (const row of lastRunRows) {
      if (!row.maxTimestamp) continue;
      lastRunByJobId.set(
        encodeHealthCheckJobId({
          configId: row.configurationId,
          systemId: row.systemId,
          environmentId: row.environmentId,
        }),
        row.maxTimestamp,
      );
    }

    const queue =
      queueManager.getQueue<HealthCheckJobPayload>(HEALTH_CHECK_QUEUE);
    const actualJobIds = new Set(await queue.listRecurringJobs());
    const actualIntervalsById = new Map<string, number>();
    for (const job of desired) {
      if (!actualJobIds.has(job.jobId)) continue;
      const details = await queue.getRecurringJobDetails(job.jobId);
      const interval = details?.intervalSeconds;
      if (typeof interval === "number") actualIntervalsById.set(job.jobId, interval);
    }

    const plan = planReconcile({
      desired,
      actualJobIds,
      actualIntervalsById,
      cancelOrphans: isFullReconcile,
    });

    const stampNow = now ?? Date.now();
    for (const job of [...plan.toSchedule, ...plan.toReschedule]) {
      await scheduleHealthCheck({
        queueManager,
        payload: job.payload,
        intervalSeconds: job.intervalSeconds,
        startDelay: computeStartDelay({
          intervalSeconds: job.intervalSeconds,
          lastRun: lastRunByJobId.get(job.jobId),
          jitterKey: job.jitterKey,
          now: stampNow,
        }),
        logger,
      });
    }
    for (const jobId of plan.toCancel) {
      await queue.cancelRecurring(jobId);
      logger.debug(`Reconcile: cancelled orphaned job ${jobId}`);
    }

    logger.debug(
      `Reconcile${systemId ? ` [system ${systemId}]` : ""}: ` +
        `${plan.toSchedule.length} scheduled, ${plan.toReschedule.length} rescheduled, ` +
        `${plan.toCancel.length} cancelled (${desired.length} desired)`,
    );
  };

  // A full reconcile mutates the whole schedule - serialize across pods. A
  // system-scoped reconcile only adds/updates that system's jobs (jobId-keyed,
  // idempotent), so it needs no cluster lock.
  if (isFullReconcile && advisoryLock) {
    await advisoryLock.withXactLock({ key: "health:reconcile", fn: run });
  } else {
    await run();
  }
}
