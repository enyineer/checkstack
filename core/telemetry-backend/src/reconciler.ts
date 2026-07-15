/**
 * Pull scheduling: a convergence reconciler over recurring jobs on the
 * `telemetry-pull` queue, mirroring metricstream's scrape reconciler.
 *
 * Desired state derives entirely from Postgres (`telemetry_sources`): every
 * ENABLED, pull-capable instance with `satelliteId` NULL is scheduled as ONE
 * recurring job (`telemetry-pull:<id>`). The interval is the row's override
 * clamped to the type's `minIntervalSeconds`, defaulting to the type's default.
 * `scheduleRecurring` is jobId-idempotent and UPDATES in place, so an interval
 * change re-uses the same jobId; a disabled/deleted/satellite-bound instance has
 * its job cancelled. Every pod computes the same plan, so concurrent reconciles
 * are safe without a lock.
 *
 * A recurring reconcile job (~60s) runs {@link PullReconciler.reconcileAll} as a
 * convergence backstop; the service calls
 * {@link PullReconciler.reconcileSource} / {@link PullReconciler.removeSource}
 * right after a source CRUD for low latency.
 */

import type { Logger } from "@checkstack/backend-api";
import { reconcileRecurringJobs, type QueueManager } from "@checkstack/queue-api";
import type { TelemetrySourceRegistry } from "./extension-points";
import type { PullRunner } from "./runner";

/** Queue the recurring per-instance pull jobs live on. */
export const TELEMETRY_PULL_QUEUE = "telemetry-pull";
/** Single consumer group => competing consumers (each fire runs on one pod). */
export const TELEMETRY_PULL_CONSUMER_GROUP = "telemetry-pull";
/** Recurring-jobId prefix for a source's pull job. */
export const PULL_JOB_PREFIX = "telemetry-pull:";

/** Queue the recurring convergence reconcile job lives on. */
export const TELEMETRY_RECONCILE_QUEUE = "telemetry-reconcile";
export const TELEMETRY_RECONCILE_CONSUMER_GROUP = "telemetry-reconcile";
/** Stable jobId for the singleton recurring reconcile job. */
export const RECONCILE_JOB_ID = "telemetry-reconcile";
/** How often the convergence reconcile runs. */
export const RECONCILE_INTERVAL_SECONDS = 60;

/** The recurring per-instance pull payload (the row is re-read on fire). */
export interface PullJobPayload {
  sourceId: string;
}

/** Build the stable recurring jobId for a source's pull job. */
export function pullJobId(sourceId: string): string {
  return `${PULL_JOB_PREFIX}${sourceId}`;
}

/** Recover the sourceId from a `telemetry-pull:<id>` jobId, or null. */
export function sourceIdFromPullJobId(jobId: string): string | null {
  if (!jobId.startsWith(PULL_JOB_PREFIX)) return null;
  const id = jobId.slice(PULL_JOB_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** Clamp a requested interval to the type's bounds (default when unset). */
export function clampInterval({
  requested,
  defaultSeconds,
  minSeconds,
}: {
  requested: number | null | undefined;
  defaultSeconds: number;
  minSeconds: number;
}): number {
  const base = requested == null ? defaultSeconds : requested;
  return Math.max(base, minSeconds);
}

/** A source that should have a running pull job, with its resolved interval. */
export interface DesiredPull {
  sourceId: string;
  jobId: string;
  intervalSeconds: number;
}

// Cancel computation lives in queue-api's reconcileRecurringJobs; the pure
// planning here is only the desired-set derivation (computeDesiredPulls).

/** A row shape the reconciler needs to compute desired pull jobs. */
export interface ReconcileSourceRow {
  id: string;
  sourceTypeId: string;
  enabled: boolean;
  intervalSeconds: number | null;
  satelliteId: string | null;
}

/**
 * Derive the desired pull set from source rows: keep only enabled instances
 * whose type has a pull seam and that are NOT satellite-bound, resolving each
 * interval via the type's bounds. Rows whose type is unregistered are skipped
 * (the owning plugin is not loaded, so nothing can run them here).
 */
export function computeDesiredPulls({
  rows,
  sourceRegistry,
}: {
  rows: ReconcileSourceRow[];
  sourceRegistry: TelemetrySourceRegistry;
}): DesiredPull[] {
  const desired: DesiredPull[] = [];
  for (const row of rows) {
    if (!row.enabled || row.satelliteId) continue;
    const type = sourceRegistry.get(row.sourceTypeId);
    if (!type?.pull) continue;
    desired.push({
      sourceId: row.id,
      jobId: pullJobId(row.id),
      intervalSeconds: clampInterval({
        requested: row.intervalSeconds,
        defaultSeconds: type.pull.defaultIntervalSeconds,
        minSeconds: type.pull.minIntervalSeconds,
      }),
    });
  }
  return desired;
}

/** Seam: load the rows the reconciler plans over. DB-backed in production. */
export interface PullSourceLister {
  listAll(): Promise<ReconcileSourceRow[]>;
  get(sourceId: string): Promise<ReconcileSourceRow | null>;
}

export interface PullReconciler {
  /** Converge ALL sources' pull schedules (boot + recurring backstop). */
  reconcileAll(): Promise<void>;
  /** Converge one source's schedule after a CRUD (schedule/reschedule/cancel). */
  reconcileSource(input: { sourceId: string }): Promise<void>;
  /** Cancel a source's pull job (on delete). */
  removeSource(input: { sourceId: string }): Promise<void>;
  /** Register the recurring reconcile job + the pull + reconcile consumers. */
  start(): Promise<void>;
  /** Best-effort stop. */
  stop(): Promise<void>;
}

export function createPullReconciler({
  queueManager,
  lister,
  runner,
  sourceRegistry,
  logger,
}: {
  queueManager: QueueManager;
  lister: PullSourceLister;
  runner: PullRunner;
  sourceRegistry: TelemetrySourceRegistry;
  logger: Logger;
}): PullReconciler {
  const pullQueue = queueManager.getQueue<PullJobPayload>(TELEMETRY_PULL_QUEUE);
  const reconcileQueue = queueManager.getQueue<Record<string, never>>(
    TELEMETRY_RECONCILE_QUEUE,
  );

  /** Map desired pulls to the shared reconciler's recurring-job specs. */
  function toSpecs(desired: DesiredPull[]) {
    return desired.map((d) => ({
      jobId: d.jobId,
      intervalSeconds: d.intervalSeconds,
      data: { sourceId: d.sourceId } satisfies PullJobPayload,
    }));
  }

  async function reconcileAll(): Promise<void> {
    const rows = await lister.listAll();
    const desired = computeDesiredPulls({ rows, sourceRegistry });
    // This owner owns every `telemetry-pull:<id>` job; the reconcile job lives
    // on a different queue, so it can never be in this list.
    const { cancelled } = await reconcileRecurringJobs({
      queue: pullQueue,
      desired: toSpecs(desired),
      ownsJobId: (jobId) => jobId.startsWith(PULL_JOB_PREFIX),
    });
    logger.debug(
      `telemetry: pull reconcile - ${desired.length} desired, ${cancelled.length} cancelled`,
    );
  }

  async function reconcileSource({
    sourceId,
  }: {
    sourceId: string;
  }): Promise<void> {
    const row = await lister.get(sourceId);
    const desired = row
      ? computeDesiredPulls({ rows: [row], sourceRegistry })
      : [];
    // Converge just this source's single fixed jobId: schedule it when desired,
    // cancel it (idempotent) when the source is gone/disabled/satellite-bound.
    await reconcileRecurringJobs({
      queue: pullQueue,
      desired: toSpecs(desired),
      ownsJobId: (jobId) => jobId === pullJobId(sourceId),
    });
  }

  async function removeSource({
    sourceId,
  }: {
    sourceId: string;
  }): Promise<void> {
    await pullQueue.cancelRecurring(pullJobId(sourceId));
  }

  return {
    reconcileAll,
    reconcileSource,
    removeSource,
    async start() {
      await pullQueue.consume(
        async (job) => {
          await runner.run({ sourceId: job.data.sourceId });
        },
        { consumerGroup: TELEMETRY_PULL_CONSUMER_GROUP },
      );
      await reconcileQueue.consume(
        async () => {
          await reconcileAll();
        },
        { consumerGroup: TELEMETRY_RECONCILE_CONSUMER_GROUP },
      );
      await reconcileQueue.scheduleRecurring(
        {},
        {
          jobId: RECONCILE_JOB_ID,
          intervalSeconds: RECONCILE_INTERVAL_SECONDS,
        },
      );
    },
    async stop() {
      // The queue lifecycle is platform-owned; nothing pod-local to tear down
      // beyond letting in-flight runs finish.
    },
  };
}
