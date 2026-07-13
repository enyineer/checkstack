/**
 * Prometheus scrape scheduling: a convergence reconciler over recurring jobs on
 * the `metricstream-scrape` queue, plus the competing-consumer that runs each
 * scrape.
 *
 * Every ENABLED scrape target is scheduled as ONE recurring job whose jobId
 * encodes the target AND its interval (`metricstream-scrape:<targetId>:<interval>`),
 * so an interval change produces a new jobId and the stale one is cancelled.
 * Desired state derives entirely from Postgres (`metric_scrape_targets`), so
 * every pod computes the same plan; `scheduleRecurring`/`cancelRecurring` are
 * jobId-idempotent, so concurrent pods reconciling is safe without a lock. The
 * API area calls {@link ScrapeScheduler.reconcileScrapeTarget} /
 * {@link ScrapeScheduler.removeScrapeTarget} right after a target CRUD for low
 * latency; {@link ScrapeScheduler.reconcileAll} runs on boot.
 *
 * On each fire the consumer loads the (possibly-changed) target FRESH, resolves
 * its bearer just-in-time, runs the registered pull source's `executePull`, and
 * updates `lastScrapeAt`/`lastError`/`consecutiveFailures` in the shared row. The
 * `consecutiveFailures` counter is DB-backed (cluster-consistent even as scrapes
 * rotate across pods); a `scrape_failing` event fires exactly when it CROSSES the
 * threshold, so an outage yields one event per episode, not one per failed poll.
 */

import { eq, sql } from "drizzle-orm";
import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type {
  InternalSecretsService,
  SecretResolverService,
} from "@checkstack/secrets-backend";
import {
  MetricStreamConfigSchema,
  pluginMetadata,
} from "@checkstack/metricstream-common";
import * as schema from "../../schema";
import { metricScrapeTargets, metricStreams } from "../../schema";
import type { ImportantEventRecorder } from "../../events/recorder";
import { resolveScrapeTargetBearer } from "../../secrets/scrape-target-secret";
import type {
  MetricIngestSink,
  MetricSourceRegistry,
  MetricPullTarget,
  RegisteredMetricSourceType,
} from "../extension-point";

type Db = SafeDatabase<typeof schema>;

/** Queue the recurring scrape jobs live on. */
export const SCRAPE_QUEUE = "metricstream-scrape";
/** Single consumer group => competing consumers (each fire runs on one pod). */
export const SCRAPE_CONSUMER_GROUP = "metricstream-scrape";
/** Recurring-jobId prefix (a target's jobs are `metricstream-scrape:<targetId>:<interval>`). */
export const SCRAPE_JOB_PREFIX = "metricstream-scrape:";
/** Consecutive failures at which a `scrape_failing` event is raised (once per episode). */
export const SCRAPE_FAILING_THRESHOLD = 3;
/** The built-in Prometheus pull source's qualified id. */
export const PROMETHEUS_SOURCE_QUALIFIED_ID = `${pluginMetadata.pluginId}.prometheus`;

/** The recurring-job payload: only the target id (the row is re-read on fire). */
export interface ScrapeJobPayload {
  targetId: string;
}

/** Build the stable recurring jobId for a target + interval. */
export function scrapeJobId({
  targetId,
  intervalSeconds,
}: {
  targetId: string;
  intervalSeconds: number;
}): string {
  return `${SCRAPE_JOB_PREFIX}${targetId}:${intervalSeconds}`;
}

/** True when a recurring jobId belongs to the given target (any interval). */
function isJobForTarget(jobId: string, targetId: string): boolean {
  return jobId.startsWith(`${SCRAPE_JOB_PREFIX}${targetId}:`);
}

/** Seam exposed to the API area (called after scrape-target CRUD) + boot/consumer. */
export interface ScrapeScheduler {
  /** Converge one target's schedule (schedule/reschedule if enabled, cancel if not). */
  reconcileScrapeTarget(input: { targetId: string }): Promise<void>;
  /** Cancel every recurring job for a target (on delete). */
  removeScrapeTarget(input: { targetId: string }): Promise<void>;
  /** Converge ALL targets' schedules (boot): schedule enabled, cancel orphans. */
  reconcileAll(): Promise<void>;
  /** Register the scrape consumer (competing consumers). */
  startConsumer(): Promise<void>;
  /** Stop the scheduler (best-effort). */
  stop(): Promise<void>;
}

export function createScrapeScheduler({
  queueManager,
  db,
  recorder,
  sourceRegistry,
  sink,
  internalSecrets,
  secretResolver,
  logger,
  now = () => new Date(),
}: {
  queueManager: QueueManager;
  db: Db;
  recorder: ImportantEventRecorder;
  sourceRegistry: MetricSourceRegistry;
  sink: MetricIngestSink;
  internalSecrets: InternalSecretsService;
  secretResolver: SecretResolverService;
  logger: Logger;
  now?: () => Date;
}): ScrapeScheduler {
  const queue = queueManager.getQueue<ScrapeJobPayload>(SCRAPE_QUEUE);

  function pullSource(): RegisteredMetricSourceType | undefined {
    return sourceRegistry.get(PROMETHEUS_SOURCE_QUALIFIED_ID);
  }

  async function cancelTargetJobs(targetId: string): Promise<void> {
    const jobIds = await queue.listRecurringJobs();
    for (const jobId of jobIds) {
      if (isJobForTarget(jobId, targetId)) await queue.cancelRecurring(jobId);
    }
  }

  async function reconcileScrapeTarget({
    targetId,
  }: {
    targetId: string;
  }): Promise<void> {
    const [target] = await db
      .select({
        id: metricScrapeTargets.id,
        enabled: metricScrapeTargets.enabled,
        intervalSeconds: metricScrapeTargets.intervalSeconds,
        satelliteId: metricScrapeTargets.satelliteId,
      })
      .from(metricScrapeTargets)
      .where(eq(metricScrapeTargets.id, targetId))
      .limit(1);

    // A satellite-bound target is scheduled on that satellite, not core: cancel
    // any core job (this also cancels the OLD job when a core target rebinds to
    // a satellite). Same for disabled / deleted targets.
    if (!target || !target.enabled || target.satelliteId) {
      await cancelTargetJobs(targetId);
      return;
    }

    const desiredJobId = scrapeJobId({
      targetId,
      intervalSeconds: target.intervalSeconds,
    });
    // Cancel any stale job for this target (a different interval) before/aside
    // from scheduling the desired one.
    const jobIds = await queue.listRecurringJobs();
    for (const jobId of jobIds) {
      if (isJobForTarget(jobId, targetId) && jobId !== desiredJobId) {
        await queue.cancelRecurring(jobId);
      }
    }
    await queue.scheduleRecurring(
      { targetId },
      { jobId: desiredJobId, intervalSeconds: target.intervalSeconds },
    );
  }

  async function removeScrapeTarget({
    targetId,
  }: {
    targetId: string;
  }): Promise<void> {
    await cancelTargetJobs(targetId);
  }

  async function reconcileAll(): Promise<void> {
    const targets = await db
      .select({
        id: metricScrapeTargets.id,
        enabled: metricScrapeTargets.enabled,
        intervalSeconds: metricScrapeTargets.intervalSeconds,
        satelliteId: metricScrapeTargets.satelliteId,
      })
      .from(metricScrapeTargets);

    const desired = new Map<string, number>(); // jobId -> intervalSeconds
    for (const t of targets) {
      // Satellite-bound targets are scheduled on their satellite, not core.
      if (!t.enabled || t.satelliteId) continue;
      desired.set(
        scrapeJobId({ targetId: t.id, intervalSeconds: t.intervalSeconds }),
        t.intervalSeconds,
      );
    }

    const actual = new Set(await queue.listRecurringJobs());
    // Schedule missing desired jobs (idempotent - updates in place if present).
    for (const [jobId, intervalSeconds] of desired) {
      const targetId = targetIdFromJobId(jobId);
      if (!targetId) continue;
      await queue.scheduleRecurring({ targetId }, { jobId, intervalSeconds });
    }
    // Cancel orphaned scrape jobs (a target now disabled/deleted, or an old interval).
    for (const jobId of actual) {
      if (jobId.startsWith(SCRAPE_JOB_PREFIX) && !desired.has(jobId)) {
        await queue.cancelRecurring(jobId);
      }
    }
    logger.debug(
      `metricstream: scrape reconcile - ${desired.size} desired, ${actual.size} actual`,
    );
  }

  async function runScrape(targetId: string): Promise<void> {
    const [row] = await db
      .select()
      .from(metricScrapeTargets)
      .where(eq(metricScrapeTargets.id, targetId))
      .limit(1);
    // Stale fire (reconcile will cancel it): disabled, deleted, or rebound to a
    // satellite since this job was scheduled.
    if (!row || !row.enabled || row.satelliteId) return;

    const source = pullSource();
    if (!source?.executePull) {
      logger.warn(
        "metricstream: no prometheus pull source registered; skipping scrape",
      );
      return;
    }

    const maxSeries = await resolveStreamSeriesCap(row.streamId);
    let bearerToken: string | undefined;
    try {
      bearerToken = await resolveScrapeTargetBearer({
        stored: row.bearerTokenSecret,
        targetId: row.id,
        internalSecrets,
        secretResolver,
      });
    } catch (error) {
      await onScrapeFailure(row.id, `bearer token resolution failed: ${String(error)}`, row.streamId);
      return;
    }

    const target: MetricPullTarget = {
      id: row.id,
      streamId: row.streamId,
      name: row.name,
      url: row.url,
      timeoutMs: row.timeoutMs,
      bearerToken,
      maxSeries,
    };

    try {
      await source.executePull({ target, sink, logger });
      await onScrapeSuccess(row.id);
    } catch (error) {
      await onScrapeFailure(row.id, String(error), row.streamId);
    }
  }

  async function resolveStreamSeriesCap(streamId: string): Promise<number> {
    const [stream] = await db
      .select({ config: metricStreams.config })
      .from(metricStreams)
      .where(eq(metricStreams.id, streamId))
      .limit(1);
    return MetricStreamConfigSchema.parse(stream?.config ?? {}).seriesCap;
  }

  async function onScrapeSuccess(targetId: string): Promise<void> {
    await db
      .update(metricScrapeTargets)
      .set({
        lastScrapeAt: now(),
        lastError: null,
        consecutiveFailures: 0,
        updatedAt: now(),
      })
      .where(eq(metricScrapeTargets.id, targetId));
  }

  async function onScrapeFailure(
    targetId: string,
    message: string,
    streamId: string,
  ): Promise<void> {
    // Atomic increment so overlapping fires can't lose a count; read back the new
    // value to detect the threshold crossing.
    const [updated] = await db
      .update(metricScrapeTargets)
      .set({
        lastScrapeAt: now(),
        lastError: message,
        consecutiveFailures: sql`${metricScrapeTargets.consecutiveFailures} + 1`,
        updatedAt: now(),
      })
      .where(eq(metricScrapeTargets.id, targetId))
      .returning({
        name: metricScrapeTargets.name,
        consecutiveFailures: metricScrapeTargets.consecutiveFailures,
      });

    if (!updated) return;
    logger.warn(`metricstream: scrape of ${updated.name} failed: ${message}`);

    // Fire exactly on the threshold crossing (one event per outage episode).
    if (updated.consecutiveFailures === SCRAPE_FAILING_THRESHOLD) {
      try {
        await recorder.record({
          streamId,
          ts: now(),
          type: "scrape_failing",
          title: `Scrape target "${updated.name}" is failing`,
          detail: {
            targetId,
            consecutiveFailures: updated.consecutiveFailures,
            lastError: message,
          },
        });
      } catch (error) {
        logger.warn(
          `metricstream: failed to record scrape_failing event: ${String(error)}`,
        );
      }
    }
  }

  return {
    reconcileScrapeTarget,
    removeScrapeTarget,
    reconcileAll,
    async startConsumer() {
      await queue.consume(
        async (job) => {
          await runScrape(job.data.targetId);
        },
        { consumerGroup: SCRAPE_CONSUMER_GROUP },
      );
    },
    async stop() {
      // The queue's own lifecycle is owned by the platform; nothing pod-local to
      // tear down here beyond letting in-flight scrapes finish.
    },
  };
}

/** Recover the targetId from a `metricstream-scrape:<targetId>:<interval>` jobId. */
function targetIdFromJobId(jobId: string): string | null {
  if (!jobId.startsWith(SCRAPE_JOB_PREFIX)) return null;
  const rest = jobId.slice(SCRAPE_JOB_PREFIX.length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon <= 0) return null;
  return rest.slice(0, lastColon);
}
