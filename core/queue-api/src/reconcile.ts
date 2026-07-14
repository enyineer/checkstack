/**
 * Shared convergence helper for reconciling a queue's RECURRING jobs toward a
 * desired set. Both the metricstream scrape scheduler and the telemetry pull
 * reconciler run the same dance - build the desired set from shared (Postgres)
 * state, idempotently (re-)schedule each desired job by its stable jobId, and
 * cancel every EXISTING recurring job this owner owns that is no longer desired
 * - so it lives here instead of being copied per plugin.
 */

import type { Queue } from "./queue";

/** One recurring job the reconciler wants present, keyed by its stable jobId. */
export interface RecurringJobSpec<T> {
  /**
   * Stable, idempotent jobId. Re-scheduling the same id UPDATES in place
   * (interval/payload), so an unchanged desired set is a no-op on re-run.
   */
  jobId: string;
  /** Fixed interval for the schedule. */
  intervalSeconds: number;
  /** Payload persisted with the schedule (re-read on each fire). */
  data: T;
}

/** What one convergence pass changed, for logging/inspection. */
export interface ReconcileRecurringJobsResult {
  /** Every desired jobId (re-)scheduled this pass. */
  scheduled: string[];
  /** Owned jobIds cancelled as orphans this pass. */
  cancelled: string[];
}

/**
 * Converge a queue's recurring jobs toward `desired`.
 *
 * Every desired spec is (re-)scheduled by its stable jobId, and every EXISTING
 * recurring job the caller OWNS (`ownsJobId`) that is not in the desired set is
 * cancelled as an orphan. Jobs the caller does NOT own - the reconcile job
 * itself, other plugins' schedules - are never touched, so `ownsJobId` is the
 * whole safety boundary; scope it to exactly the jobIds this reconciler mints
 * (e.g. a stable prefix). Schedules and cancels are disjoint (an orphan can
 * never also be desired) and run concurrently.
 *
 * Idempotent by construction, and lock-free across pods: every pod derives the
 * same desired set from shared state, so concurrent reconciles converge to the
 * same result.
 */
export async function reconcileRecurringJobs<T>({
  queue,
  desired,
  ownsJobId,
}: {
  queue: Queue<T>;
  desired: ReadonlyArray<RecurringJobSpec<T>>;
  ownsJobId: (jobId: string) => boolean;
}): Promise<ReconcileRecurringJobsResult> {
  const desiredJobIds = new Set(desired.map((spec) => spec.jobId));
  const existingJobIds = await queue.listRecurringJobs();
  const toCancel = existingJobIds.filter(
    (jobId) => ownsJobId(jobId) && !desiredJobIds.has(jobId),
  );

  await Promise.all([
    ...desired.map((spec) =>
      queue.scheduleRecurring(spec.data, {
        jobId: spec.jobId,
        intervalSeconds: spec.intervalSeconds,
      }),
    ),
    ...toCancel.map((jobId) => queue.cancelRecurring(jobId)),
  ]);

  return { scheduled: desired.map((spec) => spec.jobId), cancelled: toCancel };
}
