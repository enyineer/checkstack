/**
 * Event-driven system-rollup consumer (Phase 2 of the per-environment-jobs
 * migration).
 *
 * Under per-environment jobs, each recurring job writes ONLY its own
 * `"<systemId>::<environmentId>"` health entity; the bare `"<systemId>"` ROLLUP
 * entity (the worst-status view every existing system-level consumer, badge,
 * SLO rule and dashboard references) is no longer recomputed inline. This
 * consumer closes that gap WITHOUT re-coupling the executor to the rollup:
 *
 *  1. It subscribes to `health` `ENTITY_CHANGED` with **work-queue** delivery
 *     (exactly once per cluster per change) and filters to PER-ENV ids
 *     (`environmentId !== null`). A bare-rollup change is IGNORED, so the
 *     rollup write this consumer itself performs can never re-trigger it - no
 *     feedback loop.
 *  2. Per-env changes are DEBOUNCED per system into a short fixed window: the
 *     handler enqueues a `{ systemId }` job on the rollup queue keyed
 *     `healthrollup:<systemId>:<window-bucket>`. Both queue backends dedupe on
 *     jobId, so a burst of env transitions for one system in the same window
 *     coalesces to ONE rollup recompute (and the bucket id is used once, so
 *     BullMQ's completed-job retention never drops a later window's job).
 *  3. The rollup-queue consumer recomputes the bare `"<systemId>"` entity via
 *     `recomputeSystemRollupHealth`, which diffs prev → next inside the
 *     `health:<systemId>` advisory lock, emits the rollup `ENTITY_CHANGED`, and
 *     (on a real change) invalidates the cache + broadcasts
 *     `SYSTEM_STATUS_CHANGED`.
 *
 * Notifications are intentionally NOT sent here: each env run already notifies
 * its own transition, so a rollup notification would duplicate it. This is the
 * structural form of the #417 rollup-notification dedup - for a fanned-out
 * system the rollup notification is ALWAYS suppressed; an env-less system needs
 * no consumer at all (its run IS the bare-entity write and notifies directly).
 *
 * Scale-correctness (state-and-scale): the rollup is recomputed from Postgres
 * (`getSystemHealthStatus`) on whichever pod claims the debounced job, and the
 * advisory lock serializes concurrent recomputes, so every pod converges to the
 * same rollup regardless of which one ran it.
 */
import type { Logger, AdvisoryLockService } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type { SignalService } from "@checkstack/signal-common";
import type {
  OnEntityChanged,
  EntityChanged,
  EntityHandle,
} from "@checkstack/automation-backend";
import { HEALTH_ENTITY_KIND, type HealthEntityState } from "./health-entity";
import { parseHealthEntityId } from "./health-entity-id";
import { recomputeSystemRollupHealth } from "./queue-executor";
import type { HealthCheckService } from "./service";
import type { HealthCheckCache } from "./cache";

/** The dedicated queue the debounced rollup recomputes run on. */
export const HEALTH_ROLLUP_QUEUE = "health-rollup";

/** Payload for a debounced rollup recompute job. */
export interface HealthRollupJobPayload {
  systemId: string;
}

/** Default debounce window (ms) a burst of per-env changes coalesces into. */
export const DEFAULT_ROLLUP_DEBOUNCE_MS = 2000;

/**
 * The dedup jobId for a debounced rollup recompute. Keyed on the system AND a
 * fixed time bucket so a burst within one window coalesces to a single job,
 * while the NEXT window gets a fresh id (so a completed-job retention on the
 * queue backend can never suppress a later window's recompute).
 */
export function encodeRollupDebounceJobId(props: {
  systemId: string;
  now: number;
  windowMs: number;
}): string {
  const { systemId, now, windowMs } = props;
  const bucket = Math.floor(now / windowMs);
  return `healthrollup:${systemId}:${bucket}`;
}

export interface RollupConsumerDeps {
  queueManager: QueueManager;
  onEntityChanged: OnEntityChanged;
  service: HealthCheckService;
  advisoryLock: AdvisoryLockService;
  signalService: SignalService;
  cache: HealthCheckCache;
  getHealthEntity?: () => EntityHandle<HealthEntityState> | undefined;
  logger: Logger;
  /** Debounce window in ms. Defaults to {@link DEFAULT_ROLLUP_DEBOUNCE_MS}. */
  debounceMs?: number;
  /** Injectable clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Wire the rollup-queue consumer + the per-env `health` change subscription.
 * Returns the `onEntityChanged` unsubscribe handle for teardown.
 */
export async function setupRollupConsumer(
  deps: RollupConsumerDeps,
): Promise<() => Promise<void>> {
  const {
    queueManager,
    onEntityChanged,
    service,
    advisoryLock,
    signalService,
    cache,
    getHealthEntity,
    logger,
    debounceMs = DEFAULT_ROLLUP_DEBOUNCE_MS,
    now = () => Date.now(),
  } = deps;

  const rollupQueue =
    queueManager.getQueue<HealthRollupJobPayload>(HEALTH_ROLLUP_QUEUE);

  // Consumer: recompute the bare-system rollup entity for the job's system.
  await rollupQueue.consume(
    async (job) => {
      await recomputeSystemRollupHealth({
        systemId: job.data.systemId,
        service,
        getHealthEntity,
        advisoryLock,
        signalService,
        cache,
        logger,
      });
    },
    { consumerGroup: "health-rollup" },
  );

  // Subscription: a per-env `health` change debounces a rollup recompute for
  // its system. Bare-rollup changes are ignored (feedback-loop guard).
  const unsubscribe = onEntityChanged({
    kind: HEALTH_ENTITY_KIND,
    delivery: { mode: "work-queue", workerGroup: "health-rollup-debounce" },
    handler: async (change: EntityChanged) => {
      const { systemId, environmentId } = parseHealthEntityId(change.id);
      // Only PER-ENV changes drive a rollup recompute. A bare-`<systemId>`
      // change is either an env-less run (already the rollup) or this
      // consumer's own rollup write - never re-enqueue on it.
      if (environmentId === null) return;

      const jobId = encodeRollupDebounceJobId({
        systemId,
        now: now(),
        windowMs: debounceMs,
      });
      await rollupQueue.enqueue(
        { systemId },
        { jobId, startDelay: Math.ceil(debounceMs / 1000) },
      );
    },
  });

  logger.debug("✅ Health rollup consumer wired (per-env → debounced rollup).");
  return unsubscribe;
}
