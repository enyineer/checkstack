import {
  HealthCheckRegistry,
  Logger,
  type EmitHookFn,
  type CollectorRegistry,
  type SafeDatabase,
  type BaseStrategyConfig,
  type CollectorRunContext,
  type AdvisoryLockService,
  withScopedTransaction,
  healthcheckExecutionHistogram,
  healthcheckPhaseHistogram,
  healthcheckDeferredCounter,
} from "@checkstack/backend-api";
import { runHealthCheckCollection } from "@checkstack/healthcheck-execution";
import { QueueManager } from "@checkstack/queue-api";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
} from "./schema";
import * as schema from "./schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { type SignalService } from "@checkstack/signal-common";
import {
  HEALTH_CHECK_RUN_COMPLETED,
  SYSTEM_STATUS_CHANGED,
  ENVIRONMENT_RESOLUTION_FAILED,
  type HealthCheckStatus,
  type SystemHealthStatus,
  stripEphemeralFields,
  HEALTH_CHECK_QUEUE,
  type HealthCheckJobPayload,
} from "@checkstack/healthcheck-common";
// The run-queue contract (queue name + payload) now lives in the common leaf so
// every fast-path enqueuer shares one shape; re-exported from the owner here
// because this file's many internal importers reference these names.
export {
  HEALTH_CHECK_QUEUE,
  type HealthCheckJobPayload,
} from "@checkstack/healthcheck-common";
import { CatalogApi, type Environment } from "@checkstack/catalog-common";
import {
  resolveEffectiveEnvironments,
  type EffectiveEnvironment,
} from "./effective-environments";
import { buildHealthTransitionNotification } from "./health-notification-content";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import { IncidentApi } from "@checkstack/incident-common";
import { NotificationApi } from "@checkstack/notification-common";
import { type InferClient, extractErrorMessage } from "@checkstack/common";
import { secretEnvMappingSchema } from "@checkstack/secrets-common";
import type {
  SecretResolverService,
  InternalSecretsService,
} from "@checkstack/secrets-backend";
import { inflateConfigSecrets } from "./config-secrets";
import { HealthCheckService } from "./service";
import { healthCheckHooks } from "./hooks";
import { incrementHourlyAggregate } from "./realtime-aggregation";
import type { HealthCheckCache } from "./cache";
import {
  resolveSlowCheckRuntime,
  type SlowCheckRuntime,
} from "./slow-check-config";
import type { RecentRun } from "./slow-check-classifier";
import { evaluateSlowCheckAdmission } from "./slow-check-admission";
import {
  classifyTransition,
  shouldNotifyTransition,
} from "./notification-policy";
import { recordStateTransition } from "./state-transitions";
import { evaluateCollectorAssertionOutcomes } from "./collector-assertions";
import type { AssertionOutcome } from "@checkstack/healthcheck-common";
import {
  writeHealthEntity,
  createHealthEntitySerializer,
  type HealthEntityState,
} from "./health-entity";
import { encodeHealthEntityId } from "./health-entity-id";
import {
  buildUnobservableRun,
  resolveSatelliteOnlyOutcome,
} from "./satellite-liveness";
import type { EntityHandle } from "@checkstack/automation-backend";

type Db = SafeDatabase<typeof schema>;
type CatalogClient = InferClient<typeof CatalogApi>;
type MaintenanceClient = InferClient<typeof MaintenanceApi>;
type IncidentClient = InferClient<typeof IncidentApi>;
type NotificationClient = InferClient<typeof NotificationApi>;

/** Shape of the aggregated state returned by `getSystemHealthStatus`. */
type AggregatedHealth = Awaited<
  ReturnType<HealthCheckService["getSystemHealthStatus"]>
>;

/**
 * Derive the reactive `health` entity view from the freshly-computed
 * aggregated state. Mirrors `computeHealthEntityState` exactly: `status` is the
 * worst-wins aggregate, `healthyChecks` counts per-check `"healthy"` statuses,
 * and `totalChecks` is the number of enabled checks. Kept here so the
 * `handle.mutate` write returns the SAME view the `read` accessor would have
 * computed for the post-write state (the handle thus never re-reads).
 */
function toHealthEntityView(state: AggregatedHealth): HealthEntityState {
  return {
    status: state.status,
    healthyChecks: state.checkStatuses.filter((c) => c.status === "healthy")
      .length,
    totalChecks: state.checkStatuses.length,
  };
}

/**
 * Read the most recent runs for ONE (config, system, environment) slice,
 * newest-first, projected to the fields the slow-check classifier needs. Used
 * only when the slow-check bulkhead is enabled; keyed on the SAME
 * `environmentId` the job runs (an env-less job reads the `environment_id IS
 * NULL` slice), so the classification reflects exactly this slice's streak.
 */
async function fetchRecentRunsForSlice(props: {
  db: Db;
  configId: string;
  systemId: string;
  environmentId: string | null;
  limit: number;
}): Promise<RecentRun[]> {
  const { db, configId, systemId, environmentId, limit } = props;
  const rows = await db
    .select({
      environmentId: healthCheckRuns.environmentId,
      status: healthCheckRuns.status,
      latencyMs: healthCheckRuns.latencyMs,
      timestamp: healthCheckRuns.timestamp,
    })
    .from(healthCheckRuns)
    .where(
      and(
        eq(healthCheckRuns.configurationId, configId),
        eq(healthCheckRuns.systemId, systemId),
        environmentId === null
          ? isNull(healthCheckRuns.environmentId)
          : eq(healthCheckRuns.environmentId, environmentId),
      ),
    )
    .orderBy(desc(healthCheckRuns.timestamp))
    .limit(limit);
  return rows.map((r) => ({
    environmentId: r.environmentId,
    status: r.status,
    latencyMs: r.latencyMs,
    timestamp: r.timestamp,
  }));
}

/**
 * Emit the checkCompleted hook if available, plus the narrower
 * `checkFailed` hook when the result wasn't `healthy` (so operators
 * can wire a typed "trigger on failure" automation without having to
 * filter `checkCompleted` themselves).
 *
 * Extracted to avoid duplicating the hook emission pattern across
 * success/error paths.
 */
async function emitCheckCompletedHook({
  getEmitHook,
  systemId,
  configurationId,
  status,
  latencyMs,
  result,
  environmentId,
}: {
  getEmitHook: () => EmitHookFn | undefined;
  systemId: string;
  configurationId: string;
  status: string;
  latencyMs: number | undefined;
  result: Record<string, unknown> | undefined;
  environmentId: string | null;
}): Promise<void> {
  const emitHook = getEmitHook();
  if (!emitHook) return;
  const timestamp = new Date().toISOString();
  await emitHook(healthCheckHooks.checkCompleted, {
    systemId,
    configurationId,
    status,
    latencyMs,
    result,
    timestamp,
    environmentId,
  });
  // Narrow follow-up — informational for automation triggers; the
  // auto-incident pipeline still runs on its own thresholds.
  if (status !== "healthy") {
    await emitHook(healthCheckHooks.checkFailed, {
      systemId,
      configurationId,
      status,
      latencyMs,
      result,
      timestamp,
      environmentId,
    });
  }
}

/**
 * Payload for health check queue jobs. Every job runs EXACTLY ONE environment
 * slice - there is no in-job fan-out:
 * - `environmentId: null` - the single ENV-LESS run of a system that has no
 *   environments. Its write IS the system rollup, so it notifies directly.
 * - `environmentId: <id>` - the run for that specific environment. The system
 *   rollup is recomputed by the event-driven rollup consumer, not inline.
 *
 * The scheduling reconciler owns which (config, system, env) jobs exist; the
 * `run_now` action enqueues one job per effective environment.
 */
/** Prefix every health-check recurring jobId shares (used for orphan scans). */
export const HEALTH_CHECK_JOB_PREFIX = "healthcheck:";

/**
 * Build the recurring jobId for a check. The env-less form keeps the historical
 * `healthcheck:${configId}:${systemId}` shape (so env-less systems' jobs are
 * unchanged across the per-env migration); an env-scoped job appends the env id.
 */
export function encodeHealthCheckJobId(props: {
  configId: string;
  systemId: string;
  environmentId: string | null;
}): string {
  const { configId, systemId, environmentId } = props;
  const base = `${HEALTH_CHECK_JOB_PREFIX}${configId}:${systemId}`;
  return environmentId === null ? base : `${base}:${environmentId}`;
}

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

  const jobId = encodeHealthCheckJobId({
    configId: payload.configId,
    systemId: payload.systemId,
    environmentId: payload.environmentId,
  });

  logger?.debug(
    `Scheduling recurring health check ${jobId} with interval ${intervalSeconds}s, startDelay ${startDelay}s`,
  );

  return queue.scheduleRecurring(payload, {
    jobId,
    intervalSeconds,
    startDelay,
    priority: 0,
  });
}

/**
 * Recompute and persist the SYSTEM ROLLUP `health` entity for `systemId`
 * WITHOUT inserting a new run row.
 *
 * Used by configuration mutations that change which checks contribute to a
 * system's aggregate WITHOUT producing a new run — today, `pause`/
 * `resume`. Because `getSystemHealthStatus` excludes paused configs, the
 * recomputed rollup may transition (e.g. `degraded → healthy` when the sole
 * failing check is paused, or `healthy → degraded` when a check is resumed
 * whose last in-window run was failing and the system had no other degraded
 * checks). The framework diffs prev → next inside `handle.mutate` and emits a
 * single `ENTITY_CHANGED` on a real transition, which the SLO engine's
 * `onEntityChanged` handlers consume to close/open downtime events — so
 * pausing a failing check closes its open SLO downtime, and resuming a
 * still-failing check re-opens one on the next run.
 *
 * Mirrors the rollup write inside `executeHealthCheckJob` (no durable
 * insert; just recompute + emit), serialized on the same per-entity
 * `health:<systemId>` advisory lock so it can't race a concurrent run's
 * rollup write. Best-effort: a reactivity failure is routed to `onError`
 * and swallowed (the durable tables already hold the source-of-truth runs).
 */
export async function recomputeSystemRollupHealth(args: {
  systemId: string;
  service: HealthCheckService;
  getHealthEntity?: () => EntityHandle<HealthEntityState> | undefined;
  advisoryLock: AdvisoryLockService;
  logger: Logger;
  /**
   * When provided, a real rollup status change (prev → next) also invalidates
   * the per-system cache and broadcasts `SYSTEM_STATUS_CHANGED`, matching the
   * system-level signal the pre-per-env inline rollup fired. Omit for the pure
   * entity-only recompute (the framework's `ENTITY_CHANGED` still drives
   * SLO/dependency/triggers regardless).
   */
  signalService?: SignalService;
  cache?: HealthCheckCache;
}): Promise<
  | { previousStatus: SystemHealthStatus; newStatus: SystemHealthStatus }
  | undefined
> {
  const {
    systemId,
    service,
    getHealthEntity,
    advisoryLock,
    logger,
    signalService,
    cache,
  } = args;
  const rollupEntityId = encodeHealthEntityId({ systemId });
  const makeHealthSerializer = createHealthEntitySerializer({ advisoryLock });
  // The system-level signal + cache invalidation are only needed when a caller
  // wants them (the rollup consumer). The framework snapshots its OWN prev
  // inside `handle.mutate` for the authoritative `ENTITY_CHANGED`, so the
  // pure entity-recompute path (pause/resume) skips the extra prev read.
  const wantsSignal = signalService !== undefined || cache !== undefined;
  try {
    // Capture the FULL rollup states (not just the status enum) so the cache
    // reconcile can gate on the per-check vector while the frontend signal
    // stays gated on the coarser rollup-enum transition.
    let previousState: AggregatedHealth | undefined;
    if (wantsSignal) {
      previousState = await service.getSystemHealthStatus(systemId);
    }
    let newState: AggregatedHealth | undefined = previousState;
    await writeHealthEntity({
      handle: getHealthEntity?.(),
      entityId: rollupEntityId,
      apply: async () => {
        const rollupState = await service.getSystemHealthStatus(systemId);
        newState = rollupState;
        return toHealthEntityView(rollupState);
      },
      serialize: makeHealthSerializer(rollupEntityId),
      onError: (error) =>
        logger.warn(
          `Failed to mirror rollup health entity for ${systemId} (recompute)`,
          error,
        ),
    });

    if (wantsSignal && previousState !== undefined && newState !== undefined) {
      // Cache: evict the rollup key + broadcast to the cluster on ANY per-check
      // vector change — a check that flips while the rollup enum stays put still
      // changes the rollup's `checkStatuses`, and a reader gets that vector.
      await cache?.reconcile({
        systemId,
        previous: previousState,
        next: newState,
      });
      // Frontend signal: only a rollup-enum transition moves the badge, so a
      // per-check-only change needs no SYSTEM_STATUS_CHANGED refetch signal.
      if (newState.status !== previousState.status) {
        await signalService?.broadcast(SYSTEM_STATUS_CHANGED, {
          systemId,
          previousStatus: previousState.status,
          newStatus: newState.status,
        });
      }
    }
    return previousState !== undefined && newState !== undefined
      ? { previousStatus: previousState.status, newStatus: newState.status }
      : undefined;
  } catch (error) {
    // A recompute failure must never break the pause/resume RPC. The
    // durable tables still hold the authoritative runs; the next run tick
    // or the SLO self-heal (`reconcileOrphanedDowntime`) will converge.
    logger.error(
      `Failed to recompute system rollup health for ${systemId}`,
      error,
    );
    return undefined;
  }
}

// Flapping detection no longer lives here. It moved into the automation
// engine as a windowed-count gate on the `healthcheck.system_health_changed`
// trigger (raw aggregated-health change + `filter` +
// `window: { count, minutes, refire: "once" }`). The queue executor emits only
// the raw per-system health change (via the reactive `health` entity deriver,
// unchanged); the engine does the counting.

/**
 * Notify system subscribers about a health state change.
 * Skips notification when:
 * - the system has active maintenance/incident with suppression enabled, or
 * - the policy of the check that just ran opts into de-escalation
 *   suppression and this transition is a de-escalation (e.g.
 *   `unhealthy → degraded`).
 *
 * For non-recovery transitions, the action CTA is deep-linked to the
 * failing-checks filter so operators land directly on the problem.
 *
 * Policy is resolved per-assignment (per system+configuration) — the
 * just-ran check is the one driving any aggregate transition in this
 * execution, so its policy is the authoritative one.
 *
 * Returns `true` when a subscriber notification was actually delivered, and
 * `false` when it was skipped (no-op transition, policy/maintenance/incident
 * suppression) or the delivery threw. Callers use this to deduplicate the
 * system-rollup notification against the per-environment ones fired in the
 * same tick: when any environment already notified, the rollup notification
 * (which describes the same underlying outage) is redundant and suppressed.
 */
async function notifyStateChange(props: {
  systemId: string;
  systemName: string;
  configurationId: string;
  /**
   * Human-readable name of the health check whose run drove this transition.
   * Named in the body and surfaced as a `healthcheck.healthcheck` subject so
   * subscribers see WHICH check failed, not just which system. Best-effort:
   * falls back to the `configurationId` when the name could not be resolved.
   */
  configurationName?: string;
  previousStatus: HealthCheckStatus;
  newStatus: HealthCheckStatus;
  /**
   * The environment this transition is scoped to. `null` (or `undefined`)
   * means the rollout transition (the system rollup). A concrete string means
   * the per-env slice — the body and collapse key are env-qualified so two
   * failing envs don't merge into one card (see the changeset "Make
   * healthcheck triggers env-scoped").
   */
  environmentId?: string | null;
  /**
   * Human-readable env name, included in the title/body. Best-effort: when
   * absent (e.g. catastrophic job failure before env resolution) the message
   * falls back to the bare system name. Resolution happens before the call
   * site, so no extra catalog RPC here.
   */
  environmentName?: string;
  service: HealthCheckService;
  catalogClient: CatalogClient;
  notificationClient: NotificationClient;
  maintenanceClient: MaintenanceClient;
  incidentClient: IncidentClient;
  logger: Logger;
}): Promise<boolean> {
  const {
    systemId,
    systemName,
    configurationId,
    configurationName,
    previousStatus,
    newStatus,
    environmentId,
    environmentName,
    service,
    catalogClient,
    notificationClient,
    maintenanceClient,
    incidentClient,
    logger,
  } = props;

  // The check that just ran is the one driving this aggregate transition, so
  // its name is the authoritative check to blame. Fall back to the id.
  const checkName = configurationName ?? configurationId;

  const transition = classifyTransition(previousStatus, newStatus);
  if (transition === "none") {
    return false;
  }

  // Per-assignment notification policy. Failure to load defaults to
  // "notify everything" rather than dropping the notification.
  let suppressDeEscalations = false;
  try {
    const policy = await service.getAssignmentNotificationPolicy({
      systemId,
      configurationId,
    });
    suppressDeEscalations = policy.suppressDeEscalations;
  } catch (error) {
    logger.warn(
      `Failed to load notification policy for ${systemId}/${configurationId}, applying defaults:`,
      error,
    );
  }

  if (!shouldNotifyTransition(transition, { suppressDeEscalations })) {
    logger.debug(
      `Skipping notification for ${systemId}: ${transition} suppressed by policy`,
    );
    return false;
  }

  // Check if notifications should be suppressed due to active maintenance
  try {
    const { suppressed } =
      await maintenanceClient.hasActiveMaintenanceWithSuppression({ systemId });
    if (suppressed) {
      logger.debug(
        `Skipping notification for ${systemId}: active maintenance with suppression enabled`,
      );
      return false;
    }
  } catch (error) {
    // Log but continue with notification - suppression check failure shouldn't block notifications
    logger.warn(
      `Failed to check maintenance suppression for ${systemId}, proceeding with notification:`,
      error,
    );
  }

  // Check if notifications should be suppressed due to active incident
  try {
    const { suppressed } =
      await incidentClient.hasActiveIncidentWithSuppression({ systemId });
    if (suppressed) {
      logger.debug(
        `Skipping notification for ${systemId}: active incident with suppression enabled`,
      );
      return false;
    }
  } catch (error) {
    // Log but continue with notification - suppression check failure shouldn't block notifications
    logger.warn(
      `Failed to check incident suppression for ${systemId}, proceeding with notification:`,
      error,
    );
  }

  void catalogClient; // parents are resolved server-side via stored target edges

  try {
    // Content (title/body/subjects/collapseKey) is built by a pure, unit-tested
    // helper so the wording - which now NAMES the failing check and pushes a
    // `healthcheck.healthcheck` subject - can be verified without the executor.
    await notificationClient.notifyForSubscription(
      buildHealthTransitionNotification({
        transition,
        systemId,
        systemName,
        configurationId,
        checkName,
        newStatus,
        environmentId,
        environmentName,
      }),
    );
    logger.debug(
      `Notified subscribers: ${previousStatus} → ${newStatus} for system ${systemId}`,
    );
    return true;
  } catch (error) {
    // Log but don't fail the operation - notifications are best-effort. A
    // delivery that threw did NOT inform the user, so report `false` and let
    // the caller's rollup fallback still fire.
    logger.warn(
      `Failed to notify subscribers for health state change on system ${systemId}:`,
      error,
    );
    return false;
  }
}

/**
 * Persist ONE completed health-check run (for one system + environment +
 * source) and drive EVERYTHING that must react to it, in the correct order:
 * the reactive `health` entity write (which does the durable run insert +
 * hourly-aggregate increment and fires the authoritative `ENTITY_CHANGED`),
 * the cache reconcile, the realtime run signal, the checkCompleted/checkFailed
 * automation hooks, and - on a real status transition - the transition record,
 * the subscriber notification, and (for an env-less run) the system-status
 * signal.
 *
 * This is the SINGLE post-run path. A local run (the queue executor) and a
 * SATELLITE run (ingested over RPC) both call it, so a satellite-detected
 * outage fires the same notifications, automations, transitions, and signals a
 * local one does - previously ingest only inserted the row, so satellite runs
 * were silent. Keeping it in one function is what stops that from drifting
 * again; the only difference between the two callers is the `sourceId` /
 * `sourceLabel` / `runTimestamp` of the run, passed in.
 */
export async function persistRunAndReact(params: {
  db: Db;
  service: HealthCheckService;
  cache: HealthCheckCache;
  signalService: SignalService;
  notificationClient: NotificationClient;
  catalogClient: CatalogClient;
  maintenanceClient: MaintenanceClient;
  incidentClient: IncidentClient;
  getHealthEntity?: () => EntityHandle<HealthEntityState> | undefined;
  getEmitHook: () => EmitHookFn | undefined;
  collectorRegistry: CollectorRegistry;
  advisoryLock: AdvisoryLockService;
  logger: Logger;
  systemId: string;
  systemName: string;
  configId: string;
  configName?: string;
  /** `null` is the env-less slice, which IS the system rollup. */
  environmentId: string | null;
  environmentName?: string;
  status: HealthCheckStatus;
  latencyMs?: number;
  /** The full run result record persisted to `health_check_runs.result`. */
  result: Record<string, unknown>;
  /** `undefined` = local core; a satellite id otherwise. */
  sourceId?: string;
  sourceLabel: string;
  /** Timestamp used for the hourly aggregate bucket (the run's execution time). */
  runTimestamp: Date;
  /**
   * Record the run and its transition, but do NOT notify subscribers.
   *
   * For a run whose cause is a single shared failure that is ALREADY notified
   * elsewhere. The unobservable-run path is the case: one satellite going
   * offline makes every check assigned to it degrade at once, and
   * `healthy -> degraded` is an escalation, so without this a single satellite
   * outage fans out into one notification per check. The satellite's own
   * connectivity subscription names the actual root cause once.
   *
   * The run, the transition and the health state are still written, so the UI
   * stays honest - only the per-check alert is withheld.
   */
  suppressSubscriberNotification?: boolean;
}): Promise<void> {
  const {
    db,
    service,
    cache,
    signalService,
    notificationClient,
    catalogClient,
    maintenanceClient,
    incidentClient,
    getHealthEntity,
    getEmitHook,
    collectorRegistry,
    advisoryLock,
    logger,
    systemId,
    systemName,
    configId,
    configName,
    environmentId,
    environmentName,
    status,
    latencyMs,
    result,
    sourceId,
    sourceLabel,
    runTimestamp,
    suppressSubscriberNotification = false,
  } = params;

  const envEntityId = encodeHealthEntityId({ systemId, environmentId });
  const serializeEnvWrite = createHealthEntitySerializer({ advisoryLock })(
    envEntityId,
  );
  // An env-less run IS the system rollup, so it broadcasts the system-level
  // signal directly; a fanned-out env run leaves the rollup to the debounced
  // rollup consumer (driven by this write's ENTITY_CHANGED).
  const isFannedOut = environmentId !== null;

  let previousState!: AggregatedHealth;
  let previousStatus!: SystemHealthStatus;
  let newState!: AggregatedHealth;
  await writeHealthEntity({
    handle: getHealthEntity?.(),
    entityId: envEntityId,
    apply: async () => {
      // In-lock pre-run baseline: read inside the serialized critical section,
      // before the insert, so a concurrent same-slice run cannot commit between
      // the baseline read and this insert and make the cache gate miss a change.
      previousState = await service.getSystemHealthStatus(
        systemId,
        environmentId,
      );
      previousStatus = previousState.status;
      // Batch the run INSERT + aggregate SELECT/UPSERT under ONE scoped
      // transaction so they commit atomically.
      await withScopedTransaction(db, async (tx) => {
        await tx.insert(healthCheckRuns).values({
          configurationId: configId,
          systemId,
          environmentId,
          status,
          latencyMs,
          result,
          sourceId,
          sourceLabel,
        });
        await incrementHourlyAggregate({
          db: tx,
          systemId,
          configurationId: configId,
          environmentId,
          status,
          latencyMs,
          runTimestamp,
          result,
          collectorRegistry,
          sourceLabel,
        });
      });
      newState = await service.getSystemHealthStatus(systemId, environmentId);
      return toHealthEntityView(newState);
    },
    serialize: serializeEnvWrite,
    onError: (error) =>
      logger.warn(`Failed to mirror health entity for ${envEntityId}`, error),
  });

  logger.debug(
    `Ran health check ${configId} for system ${systemId}: ${status}`,
  );

  await cache.reconcile({
    systemId,
    environmentId,
    previous: previousState,
    next: newState,
  });

  await signalService.broadcast(HEALTH_CHECK_RUN_COMPLETED, {
    systemId,
    systemName,
    configurationId: configId,
    // The realtime signal names the check; fall back to its id when the name
    // could not be resolved (best-effort, as elsewhere).
    configurationName: configName ?? configId,
    status,
    latencyMs,
    environmentId: environmentId ?? undefined,
    environmentName,
  });

  await emitCheckCompletedHook({
    getEmitHook,
    systemId,
    configurationId: configId,
    status,
    latencyMs,
    result:
      (result.metadata as { collectors?: Record<string, unknown> } | undefined)
        ?.collectors ?? undefined,
    environmentId,
  });

  // `newState.status` cannot be `unknown` here (a run just completed).
  if (newState.status !== previousStatus && newState.status !== "unknown") {
    await recordStateTransition({
      db,
      systemId,
      configurationId: configId,
      environmentId,
      fromStatus: previousStatus === "unknown" ? undefined : previousStatus,
      toStatus: newState.status,
    });

    if (suppressSubscriberNotification) {
      logger.debug(
        `Recorded ${newState.status} for ${configId}/${systemId} without notifying: ` +
          "the underlying cause is notified once at its source",
      );
    } else {
      await notifyStateChange({
        notificationClient,
        systemId,
        systemName,
        configurationId: configId,
        configurationName: configName,
        previousStatus:
          previousStatus === "unknown" ? "healthy" : previousStatus,
        newStatus: newState.status,
        environmentId,
        environmentName,
        service,
        catalogClient,
        maintenanceClient,
        incidentClient,
        logger,
      });
    }

    if (!isFannedOut) {
      await signalService.broadcast(SYSTEM_STATUS_CHANGED, {
        systemId,
        previousStatus,
        newStatus: newState.status,
      });
    }
  }
}

/**
 * The per-run portion of {@link persistRunAndReact}: everything that varies per
 * run, WITHOUT the service dependencies (which the plugin binds once via a
 * closure). The plugin hands the router a reactor of this shape so a satellite
 * result drives the exact same post-run path as a local run - the deps are
 * captured once, so the two callers cannot pass a different set and drift.
 */
export type HealthRunReaction = Omit<
  Parameters<typeof persistRunAndReact>[0],
  | "db"
  | "service"
  | "cache"
  | "signalService"
  | "notificationClient"
  | "catalogClient"
  | "maintenanceClient"
  | "incidentClient"
  | "getHealthEntity"
  | "getEmitHook"
  | "collectorRegistry"
  | "advisoryLock"
  | "logger"
>;

/**
 * Execute a health check job
 */
async function executeHealthCheckJob(props: {
  payload: HealthCheckJobPayload;
  db: Db;
  advisoryLock: AdvisoryLockService;
  registry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  logger: Logger;
  signalService: SignalService;
  catalogClient: CatalogClient;
  notificationClient: NotificationClient;
  maintenanceClient: MaintenanceClient;
  incidentClient: IncidentClient;
  getEmitHook: () => EmitHookFn | undefined;
  cache: HealthCheckCache;
  /**
   * Resolver for the reactive `health` entity handle (§10.3). Returns the
   * handle once automation-backend has bound the entity store; `undefined`
   * during version skew / tests. Mirrors the `getEmitHook` closure pattern.
   * The entity is PLUGIN-BACKED + COMPUTED — there is no keyed store; the
   * durable run/aggregate write IS the entity write (see `writeHealthEntity`).
   */
  getHealthEntity?: () => EntityHandle<HealthEntityState> | undefined;
  /**
   * Central secret resolver. When set, a collector declaring a `secretEnv`
   * has it resolved + injected for this centrally-executed run; the
   * collector masks the values out of its output. Optional for version-skew
   * / test isolation.
   */
  secretResolver?: SecretResolverService;
  /**
   * Internal secret store. When set (together with `secretResolver`), stored
   * strategy/collector config `x-secret` fields - internal markers and
   * `${{ secrets.* }}` references - are INFLATED to their real values just
   * before use, in memory only. Optional for version-skew / test isolation;
   * without it, marker-bearing configs fail their runs clearly.
   */
  internalSecrets?: InternalSecretsService;
  /**
   * Slow-check bulkhead + adaptive-timeout runtime, resolved once at worker
   * startup. `null`/`undefined` disables the feature: the classification read
   * is skipped and the run executes exactly as before (full timeout, no lane).
   */
  slowCheckRuntime?: SlowCheckRuntime | null;
  /**
   * Resolves the ids of every currently-online satellite.
   *
   * Injected rather than imported so this module keeps no dependency on the
   * satellite plugin, and so the unobservable-check path is testable without
   * one. When absent, satellite-only checks behave exactly as they did before:
   * the core stays silent and lets the satellites report.
   */
  getOnlineSatelliteIds?: () => Promise<string[]>;
}): Promise<void> {
  const {
    payload,
    db,
    advisoryLock,
    registry,
    collectorRegistry,
    logger,
    signalService,
    catalogClient,
    notificationClient,
    maintenanceClient,
    incidentClient,
    getEmitHook,
    getHealthEntity,
    cache,
    secretResolver,
    internalSecrets,
    slowCheckRuntime,
    getOnlineSatelliteIds,
  } = props;
  const { configId, systemId } = payload;

  // Create service for aggregated state evaluation
  const service = new HealthCheckService(db, registry, collectorRegistry);

  // Per-ENTITY serializer factory for the reactive health mutate (§10.3,
  // Phase 3b): a transaction-scoped advisory lock keyed `health:<entityId>`
  // wraps the snapshot-prev + apply + diff + emit so concurrent evaluations
  // of one (system, environment) — or of the system rollup — can't double-emit
  // a single logical transition. Bound to the qualified entity id at each
  // `writeHealthEntity` call so distinct envs / the rollup don't block each
  // other.
  const makeHealthSerializer = createHealthEntitySerializer({ advisoryLock });

  // NOTE: the system-rollup status BEFORE this tick is computed LAZILY, only on
  // the catastrophic-failure path that actually consumes it (see the `catch`
  // below). It used to be captured here on EVERY run - a full worst-wins rollup
  // (`getSystemHealthStatus(systemId)`, an N+1 across every check × environment)
  // - even though the normal success/failure paths record their transition from
  // the per-env pre-read (`previousState`, below) and never touch the rollup
  // pre-state. Deferring it to the rare error path removes that whole recompute
  // from the hot path of every check tick.

  // Slow-check lane admission (set when this run was admitted to the suspect
  // lane); released in the outer finally so the slot frees on any exit path.
  let laneKey: string | undefined;

  try {
    // Fetch configuration (including name for signals)
    const [configRow] = await db
      .select({
        configId: healthCheckConfigurations.id,
        configName: healthCheckConfigurations.name,
        strategyId: healthCheckConfigurations.strategyId,
        config: healthCheckConfigurations.config,
        collectors: healthCheckConfigurations.collectors,
        interval: healthCheckConfigurations.intervalSeconds,
        enabled: systemHealthChecks.enabled,
        paused: healthCheckConfigurations.paused,
        includeLocal: systemHealthChecks.includeLocal,
        satelliteIds: systemHealthChecks.satelliteIds,
        environmentIds: systemHealthChecks.environmentIds,
      })
      .from(systemHealthChecks)
      .innerJoin(
        healthCheckConfigurations,
        eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
      )
      .where(
        and(
          eq(systemHealthChecks.systemId, systemId),
          eq(systemHealthChecks.configurationId, configId),
          eq(systemHealthChecks.enabled, true),
        ),
      );

    // If configuration not found or disabled, exit without rescheduling
    if (!configRow) {
      logger.debug(
        `Health check ${configId} for system ${systemId} not found or disabled, not rescheduling`,
      );
      return;
    }

    // If configuration is paused, skip execution (job continues to be scheduled)
    if (configRow.paused) {
      logger.debug(
        `Health check ${configId} is paused, skipping execution for system ${systemId}`,
      );
      return;
    }

    // If includeLocal is false and satellites are assigned, the SATELLITES
    // execute this check and the core does not.
    //
    // But "the core does not run it" is not the same as "nothing needs to
    // happen". If every assigned satellite is offline, nobody runs it, and
    // returning silently (as this once did) leaves the check displaying its
    // last known status forever - a dead probe reading exactly like a passing
    // one. So an unobservable check records a `degraded` run instead.
    if (
      !configRow.includeLocal &&
      configRow.satelliteIds &&
      configRow.satelliteIds.length > 0
    ) {
      const satelliteIds = configRow.satelliteIds;
      // Left UNSET (not empty) when liveness cannot be resolved: an empty list
      // would read as "every satellite is offline" and mark the whole fleet's
      // satellite-only checks degraded on a transient lookup failure.
      let onlineSatelliteIds: string[] | undefined;
      if (getOnlineSatelliteIds) {
        try {
          onlineSatelliteIds = await getOnlineSatelliteIds();
        } catch (error) {
          logger.warn(
            `Could not resolve satellite liveness for ${configId}/${systemId}; treating as executing`,
            error,
          );
        }
      }

      const outcome = resolveSatelliteOnlyOutcome({
        satelliteIds,
        ...(onlineSatelliteIds === undefined ? {} : { onlineSatelliteIds }),
      });

      if (outcome === "satellites-executing") {
        logger.debug(
          `Health check ${configId} for system ${systemId} is satellite-only, skipping local execution`,
        );
        return;
      }

      logger.warn(
        `Health check ${configId} for system ${systemId} has no online satellite ` +
          `(${satelliteIds.length} assigned); recording a degraded run so the gap is visible`,
      );

      let unobservableSystemName = systemId;
      try {
        const system = await catalogClient.getSystem({ systemId });
        if (system) unobservableSystemName = system.name;
      } catch {
        // Fall back to the id; a missing display name must not swallow the run.
      }

      await persistRunAndReact({
        db,
        service,
        cache,
        signalService,
        notificationClient,
        catalogClient,
        maintenanceClient,
        incidentClient,
        ...(getHealthEntity ? { getHealthEntity } : {}),
        getEmitHook,
        collectorRegistry,
        advisoryLock,
        logger,
        systemId,
        systemName: unobservableSystemName,
        configId,
        ...(configRow.configName ? { configName: configRow.configName } : {}),
        // The job payload already names the single (config, system, env) slice
        // this tick owns, so the stale run lands on exactly the slice the
        // satellites would have reported for.
        ...buildUnobservableRun({
          environmentId: payload.environmentId,
          satelliteIds,
        }),
        runTimestamp: new Date(),
        // One offline satellite degrades EVERY check assigned to it in the same
        // tick. Notifying per check would turn a single root cause into a
        // storm; the satellite's connectivity subscription reports it once.
        suppressSubscriberNotification: true,
      });
      return;
    }

    // Fetch system name + metadata for signal payload and run-context. The
    // metadata is the system's free-form catalog custom fields, surfaced to
    // config templating as `{{ system.metadata.<key> }}`.
    let systemName = systemId;
    let systemMetadata: Record<string, unknown> = {};
    try {
      const system = await catalogClient.getSystem({ systemId });
      if (system) {
        systemName = system.name;
        systemMetadata = system.metadata ?? {};
      }
    } catch {
      // Fall back to systemId if catalog lookup fails
      logger.debug(`Could not fetch system name for ${systemId}, using ID`);
    }

    const strategy = registry.getStrategy(configRow.strategyId);
    if (!strategy) {
      logger.warn(
        `Strategy ${configRow.strategyId} not found for config ${configId}`,
      );
      return;
    }

    // Inflate stored secret markers / `${{ secrets.* }}` references to their
    // real values ONCE, memory-only, BEFORE migrate+validate - so validation
    // sees real values. Old-shape rows (whose current-schema secret keys do
    // not exist yet) and legacy bare literals pass through untouched.
    let rawStrategyConfig = configRow.config;
    if (internalSecrets && secretResolver) {
      const inflated = await inflateConfigSecrets({
        configurationId: configId,
        scope: { kind: "strategy" },
        schema: strategy.config.schema,
        config: configRow.config,
        deps: { internalSecrets, secretResolver },
      });
      rawStrategyConfig = inflated.config;
    }

    // Migrate the stored (UNVERSIONED) strategy config ONCE, before the
    // per-environment render loop, so every env renders from the same
    // migrated shape. Stored configs predate explicit versioning and may be
    // genuinely v1 (e.g. an HTTP config still carrying url/method); assume-v1
    // -on-read runs the declared migration chain, then validates. The
    // migrations are idempotent, so an already-current config is a no-op.
    const strategyConfig: BaseStrategyConfig =
      await strategy.config.parseAssumingV1(rawStrategyConfig);
    const executionTimeout = strategyConfig.timeout ?? 60_000;

    // ── Per-environment fan-out (§7) ────────────────────────────────────────
    // Resolve the effective environment set from the assignment + the
    // system's current catalog membership, then run ONCE PER environment.
    // An empty effective set (opt-out `[]`, or `null` with no membership)
    // collapses to a single env-less run with `environment` unset — exactly
    // the pre-feature behavior. Membership lives ONLY in the catalog Postgres
    // tables and is re-read every tick via the cross-plugin RPC, so every pod
    // resolves the same set (state-and-scale: no pod-local env state).
    let membership: Environment[] = [];
    let catalogResolutionFailed = false;
    try {
      membership = await catalogClient.resolveSystemEnvironments({ systemId });
    } catch (error) {
      // Fail-open: a catalog read failure must not wedge the check. We keep
      // running the payload's env with degraded fields rather than skipping.
      catalogResolutionFailed = true;
      logger.warn(
        `Could not resolve environments for system ${systemId}`,
        error,
      );
      // Observability: a `logger.warn` alone is easy to miss when a durable
      // catalog misconfig (or outage) silently strips per-environment fan-out.
      // Broadcast a counter-style signal so the degradation is observable.
      // Best-effort — never let the signal break the (still-running) check.
      try {
        await signalService.broadcast(ENVIRONMENT_RESOLUTION_FAILED, {
          systemId,
          configurationId: configId,
          error: extractErrorMessage(error),
        });
      } catch (signalError) {
        logger.warn(
          `Failed to broadcast environment-resolution-failed signal for ${systemId}`,
          signalError,
        );
      }
    }
    const effectiveEnvs = resolveEffectiveEnvironments({
      environmentIds: configRow.environmentIds,
      membership,
    });

    // Select THE single environment this job runs (payload.environmentId). The
    // reconciler owns which (config, system, env) jobs exist; here we only
    // validate the payload's env against the CURRENT effective set so a stale
    // job (env removed, or an env-less job for a system that has since gained
    // envs) is skipped and the reconciler converges the set.
    const targetEnvironmentId = payload.environmentId;
    let singleEnvironment: EffectiveEnvironment | null;
    if (targetEnvironmentId === null) {
      // Env-less job: valid only while the system has no effective envs.
      if (!catalogResolutionFailed && effectiveEnvs.length > 0) {
        logger.debug(
          `Env-less job for ${configId}/${systemId} is stale (system now has ${effectiveEnvs.length} env(s)); skipping`,
        );
        return;
      }
      singleEnvironment = null;
    } else {
      const found =
        effectiveEnvs.find((env) => env.id === targetEnvironmentId) ?? null;
      if (found) {
        singleEnvironment = found;
      } else if (catalogResolutionFailed) {
        // Transient catalog failure: still run the probe, with degraded (empty)
        // env fields rather than skipping the tick. The next tick recovers.
        singleEnvironment = {
          id: targetEnvironmentId,
          name: targetEnvironmentId,
          fields: {},
        };
      } else {
        logger.debug(
          `Env ${targetEnvironmentId} no longer effective for ${configId}/${systemId}; skipping`,
        );
        return;
      }
    }

    // ── Slow-check bulkhead + adaptive timeout ──────────────────────────────
    // Classify THIS slice's recent runs. A slice whose last K runs were SLOW
    // transport failures (held its slot ~the full timeout) is "suspect": it is
    // admitted to a capped, pod-local lane (or DEFERRED this tick when the lane
    // is full or a prior run of the same slice is still in flight — recording
    // nothing so it can't pile up) and probed with a timeout shrunk toward its
    // OWN healthy-latency baseline, so a stuck target frees its slot fast
    // instead of pinning it for the full timeout. A healthy slice is untouched.
    let effectiveTimeout = executionTimeout;
    const sliceEnvironmentId = singleEnvironment?.id ?? null;
    if (slowCheckRuntime) {
      try {
        const recentRuns = await fetchRecentRunsForSlice({
          db,
          configId,
          systemId,
          environmentId: sliceEnvironmentId,
          limit: slowCheckRuntime.recentRunsLimit,
        });
        const decision = evaluateSlowCheckAdmission({
          runtime: slowCheckRuntime,
          recentRuns,
          configId,
          systemId,
          environmentId: sliceEnvironmentId,
          executionTimeoutMs: executionTimeout,
        });
        if (decision.kind === "defer") {
          healthcheckDeferredCounter().add(1, { reason: decision.reason });
          logger.debug(
            `Deferred suspect health check ${configId}/${systemId}` +
              (sliceEnvironmentId ? ` [${sliceEnvironmentId}]` : "") +
              ` (${decision.reason}); recording nothing this tick`,
          );
          // Record nothing: the recurring job stays scheduled, so the next tick
          // retries once the lane drains / the in-flight run finishes.
          return;
        }
        effectiveTimeout = decision.effectiveTimeoutMs;
        laneKey = decision.laneKey;
      } catch (error) {
        // Classification is best-effort: a read failure must never wedge the
        // check. Fall back to the full timeout with no lane admission.
        logger.warn(
          `Slow-check classification failed for ${configId}/${systemId}; running at full timeout`,
          error,
        );
      }
    }

    // This job runs exactly this ONE env. `isFannedOut` is now a per-JOB
    // property: an env-scoped run (`isFannedOut === true`) mutates the
    // `<systemId>::<env>` entity and leaves the bare `<systemId>` ROLLUP to the
    // event-driven rollup consumer; an env-less run mutates the bare entity
    // (which IS the rollup) and so notifies + broadcasts SYSTEM_STATUS_CHANGED
    // directly.
    const runEnvironments: (EffectiveEnvironment | null)[] = [
      singleEnvironment,
    ];
    // Whether this run fans out to a concrete environment is now derived inside
    // `persistRunAndReact` (an env-less run IS the rollup); nothing in the loop
    // body needs it directly.
    for (const environment of runEnvironments) {
      const environmentId = environment?.id ?? null;
      // The env-qualified entity id this run mutates. For the env-less run
      // (environmentId === null) this is the bare systemId — which is also the
      // rollup id, so the env-less run IS the rollup (no separate rollup write
      // is needed when the system has no environments — see below).
      const envEntityId = encodeHealthEntityId({ systemId, environmentId });
      const serializeEnvWrite = makeHealthSerializer(envEntityId);

      // Per-env baseline: the env-scoped aggregate BEFORE this run. Read INSIDE
      // the serialized `apply` below (assigned to these vars), NOT here — so a
      // concurrent same-slice run cannot commit between the baseline read and
      // our own insert. If it were read here (outside the `health:<envEntityId>`
      // lock), the cache change-gate could compare `next` against a baseline a
      // sibling run already superseded and miss a real transition, stranding a
      // stale cached status until the TTL. Assigned by whichever branch's
      // `apply` runs; used for the transition log AND the cache reconcile.
      let previousState!: AggregatedHealth;
      // May be `unknown`: the pre-run baseline of a check that had never run.
      let previousStatus!: SystemHealthStatus;

      // Curated, read-only run-context metadata exposed to collectors.
      // Metadata only - never secrets or config. `environment` carries the
      // resolved env's verbatim custom fields for this run (Phase 2 surfaces
      // consume it); absent for the env-less run.
      const runContext: CollectorRunContext = {
        check: {
          id: configId,
          name: configRow.configName || configId,
          intervalSeconds: configRow.interval,
        },
        system: { id: systemId, name: systemName, metadata: systemMetadata },
        ...(environment
          ? {
              environment: {
                id: environment.id,
                name: environment.name,
                fields: environment.fields,
              },
            }
          : {}),
      };

      // An env-less run renders any {{ environment.* }} reference to empty
      // string (the engine's buildTemplateContext maps a missing environment to
      // {}). Log it once at debug so it is visible without spamming every tick.
      if (!runContext.environment) {
        logger.debug(
          `Health check ${configId} for system ${systemId} ran with no environment; ` +
            `any {{ environment.* }} references render to empty string`,
        );
      }

      // Per-environment isolation: an unexpected failure persisting ONE
      // environment's run must not abort the sibling environments' runs.
      // Each iteration's run is independent (§7.2), so we log and continue.
      try {
        // Execute through the SHARED engine (@checkstack/healthcheck-execution):
        // it renders the strategy + collector `x-templatable` fields against this
        // env/system's context, builds the transport client, runs the collectors,
        // and closes the client. This is the SAME engine the satellite uses, so
        // templating, secret/template ordering, and the per-collector fan-out
        // cannot drift between core and satellite - the drift that hid custom-
        // field templates on satellite runs. The core's own edges stay here as
        // hooks: DB-backed secret resolution, migrate-on-read, and the
        // assertion/ephemeral-strip post-processing.
        const outcome = await runHealthCheckCollection({
          strategy,
          strategyConfig,
          collectors: configRow.collectors ?? [],
          runContext,
          pluginId: configRow.strategyId,
          logger,
          timeoutMs: effectiveTimeout,
          hooks: {
            getCollector: (entry) =>
              collectorRegistry.getCollector(entry.collectorId),
            storageKeyOf: (entry) => entry.id,
            resolveSecretEnv: async (entry) => {
              const declared = secretEnvMappingSchema.safeParse(
                (entry.config as { secretEnv?: unknown }).secretEnv,
              );
              if (
                secretResolver &&
                declared.success &&
                Object.keys(declared.data).length > 0
              ) {
                const resolved = await secretResolver.resolveForRun({
                  secretEnv: declared.data,
                });
                return resolved.env;
              }
              return;
            },
            prepareCollectorConfig: async (entry, registered) => {
              // Inflate secret markers (memory-only) then migrate-on-read, so the
              // engine templates + executes the migrated, secret-resolved shape.
              let rawCollectorConfig = entry.config;
              if (internalSecrets && secretResolver) {
                const inflated = await inflateConfigSecrets({
                  configurationId: configId,
                  scope: { kind: "collector", entryId: entry.id },
                  schema: registered.collector.config.schema,
                  config: entry.config,
                  deps: { internalSecrets, secretResolver },
                });
                rawCollectorConfig = inflated.config;
              }
              // `parseAssumingV1` returns the collector's own (generic
              // `unknown`) config type; the engine templates it as a record, so
              // narrow to the object shape every collector config actually is.
              const parsed =
                await registered.collector.config.parseAssumingV1(
                  rawCollectorConfig,
                );
              return parsed as Record<string, unknown>;
            },
            mapResult: ({ entry, registered, collectorResult }) => {
              const collectorError = collectorResult.error;
              let assertionFailed: string | undefined;
              let assertionOutcomes: AssertionOutcome[] = [];
              if (collectorResult.result) {
                const evaluation = evaluateCollectorAssertionOutcomes({
                  assertions: entry.assertions,
                  result: collectorResult.result as Record<string, unknown>,
                });
                assertionFailed = evaluation.firstFailureMessage;
                assertionOutcomes = evaluation.outcomes;
                if (assertionFailed) {
                  logger.debug(
                    `Collector ${entry.id} assertion failed: ${assertionFailed}`,
                  );
                }
              }
              const strippedResult = stripEphemeralFields(
                collectorResult.result as Record<string, unknown>,
                registered.collector.result.schema,
              );
              return {
                storageKey: entry.id,
                success: !collectorError && !assertionFailed,
                error:
                  collectorError ??
                  (assertionFailed
                    ? `Assertion failed: ${assertionFailed}`
                    : undefined),
                storedResult: {
                  _collectorId: entry.collectorId,
                  _assertionFailed: assertionFailed,
                  _collectorError: collectorError,
                  ...(assertionOutcomes.length > 0
                    ? { _assertions: assertionOutcomes }
                    : {}),
                  ...strippedResult,
                },
              };
            },
            mapError: ({ entry, error }) => {
              const errorStr = extractErrorMessage(error);
              logger.debug(`Collector ${entry.id} failed: ${errorStr}`);
              return {
                storageKey: entry.id,
                success: false,
                error: errorStr,
                storedResult: {
                  _collectorId: entry.collectorId,
                  _assertionFailed: undefined,
                  _collectorError: errorStr,
                },
              };
            },
          },
        });

        if (outcome.aborted) {
          // The transport itself failed: the client build threw, or the hard
          // timeout fired. This is a transport failure, distinct from a completed
          // run whose collectors reported problems, so it takes the failure
          // result shape and (deliberately, matching prior behaviour) skips the
          // checkCompleted hook + SYSTEM_STATUS_CHANGED signal the success path
          // emits.
          const finalError = outcome.errorMessage;

          const result = {
            status: "unhealthy" as const,
            latencyMs: outcome.latencyMs,
            message: finalError,
            metadata: {
              connected: outcome.connected,
              error: finalError,
            },
          };
          // Persist the run + aggregate THROUGH the reactive `health` entity:
          // `apply` does the durable write and returns the freshly-computed view.
          // The framework snapshots `prev` via `read` BEFORE this insert, so a real
          // status change emits exactly one correct `ENTITY_CHANGED` (§10.3). The
          // computed aggregated state is stashed for the transition/notify path.
          let newState!: AggregatedHealth;
          await writeHealthEntity({
            handle: getHealthEntity?.(),
            entityId: envEntityId,
            apply: async () => {
              // In-lock pre-run baseline (see the `previousState` declaration): read
              // here, inside the serialized critical section, before the insert.
              previousState = await service.getSystemHealthStatus(
                systemId,
                environmentId,
              );
              previousStatus = previousState.status;
              // §perf: batch the run INSERT + aggregate SELECT/UPSERT under ONE
              // `SET LOCAL search_path` transaction (3 scoped-db transactions → 1),
              // which also makes the run and its aggregate commit atomically.
              await withScopedTransaction(db, async (tx) => {
                await tx.insert(healthCheckRuns).values({
                  configurationId: configId,
                  systemId,
                  environmentId,
                  status: result.status,
                  latencyMs: result.latencyMs,
                  result: { ...result } as Record<string, unknown>,
                  sourceId: undefined,
                  sourceLabel: "Local",
                });

                await incrementHourlyAggregate({
                  db: tx,
                  systemId,
                  configurationId: configId,
                  environmentId,
                  status: result.status,
                  latencyMs: result.latencyMs,
                  runTimestamp: new Date(),
                  result: { ...result } as Record<string, unknown>,
                  collectorRegistry,
                  sourceLabel: "Local",
                });
              });

              // Env-scoped view: the per-env entity reflects only this env's runs.
              // Runs as its own batched read AFTER the write commits, so it sees
              // the just-inserted run.
              newState = await service.getSystemHealthStatus(
                systemId,
                environmentId,
              );
              return toHealthEntityView(newState);
            },
            serialize: serializeEnvWrite,
            onError: (error) =>
              logger.warn(
                `Failed to mirror health entity for ${envEntityId}`,
                error,
              ),
          });

          logger.debug(
            `Health check ${configId} for system ${systemId} failed: ${finalError}`,
          );

          // Reconcile this environment's cached status: evict + broadcast to the
          // cluster ONLY when the per-check vector actually changed (a run that
          // leaves every check's status unchanged keeps the cache warm instead of
          // thrashing it every tick). The rollup key is reconciled separately by
          // the debounced rollup consumer (recomputeSystemRollupHealth), also
          // vector-gated.
          await cache.reconcile({
            systemId,
            environmentId,
            previous: previousState,
            next: newState,
          });

          await signalService.broadcast(HEALTH_CHECK_RUN_COMPLETED, {
            systemId,
            systemName,
            configurationId: configId,
            configurationName: configRow.configName,
            status: result.status,
            latencyMs: result.latencyMs,
            // Env-scoped fan-out: `environment` is null for the env-less run, so
            // `?.` yields undefined and those runs broadcast exactly as before.
            environmentId: environment?.id,
            environmentName: environment?.name,
          });

          // `newState.status` cannot be `unknown` here - a run just completed, so
          // the check has a measurement - but narrowing it keeps that guarantee
          // explicit rather than asserted with a cast.
          if (
            newState.status !== previousStatus &&
            newState.status !== "unknown"
          ) {
            // Record the aggregate transition so the sensing layer has a
            // reliable "in status since" for every status (Wave 2).
            await recordStateTransition({
              db,
              systemId,
              configurationId: configId,
              environmentId,
              // NULL means "no prior measured status" - the column is nullable for
              // exactly this first-measurement case, so a system whose checks had
              // never run records an honest `null -> healthy` rather than
              // pretending it was healthy all along.
              fromStatus:
                previousStatus === "unknown" ? undefined : previousStatus,
              toStatus: newState.status,
            });

            await notifyStateChange({
              notificationClient,
              systemId,
              systemName,
              configurationId: configId,
              configurationName: configRow.configName,
              // A first measurement is not a transition anyone asked to hear about
              // when it lands healthy; `notifyStateChange` decides, and it needs a
              // concrete previous status to compare against.
              previousStatus:
                previousStatus === "unknown" ? "healthy" : previousStatus,
              newStatus: newState.status,
              environmentId,
              environmentName: environment?.name,
              service,
              catalogClient,
              maintenanceClient,
              incidentClient,
              logger,
            });
          }

          // This environment's run is done (failed). Continue to the next
          // effective environment rather than ending the whole job.
          continue;
        }

        // A COMPLETED run: the client built and the collectors ran. Its status is
        // decided by the collectors - a collector error or failed assertion
        // downgrades it - exactly as before.
        const status = outcome.hasCollectorError ? "unhealthy" : "healthy";
        const totalLatencyMs = outcome.latencyMs;

        // Transport sub-phase timings measured AT THE PROBE and already filtered by
        // the engine to present phases. The satellite surfaces the same shape for
        // remote runs, so a run's `metadata.timings` is identical wherever it ran.
        const timings = outcome.clientTimings;

        // Metrics (OTel no-ops unless enabled): the probe's total wall-clock and its
        // network sub-phases. The `phase` breakdown tells "slow target" (`wait`
        // grows) apart from "slow connection" (`connect`/`tls` grow) apart from
        // platform delay.
        healthcheckExecutionHistogram().record(totalLatencyMs, { status });
        if (timings) {
          for (const [phase, value] of Object.entries(timings)) {
            if (typeof value === "number" && Number.isFinite(value)) {
              healthcheckPhaseHistogram().record(value, {
                phase: phase.replace(/Ms$/, ""),
              });
            }
          }
        }

        const result = {
          status: status as "healthy" | "unhealthy",
          latencyMs: totalLatencyMs,
          message: outcome.hasCollectorError
            ? `Check failed: ${outcome.errorMessage}`
            : `Completed in ${totalLatencyMs}ms`,
          metadata: {
            connected: true,
            connectionTimeMs: outcome.connectionTimeMs,
            ...(timings ? { timings } : {}),
            collectors: outcome.collectorResults,
          },
        };

        // Persist this run and drive everything that reacts to it - the reactive
        // entity write, cache reconcile, realtime signal, automation hooks,
        // transition record, and subscriber notification - through the ONE
        // shared post-run path. Satellite-result ingest calls the same function,
        // so a satellite-detected change reacts identically and the two paths
        // cannot drift.
        await persistRunAndReact({
          db,
          service,
          cache,
          signalService,
          notificationClient,
          catalogClient,
          maintenanceClient,
          incidentClient,
          getHealthEntity,
          getEmitHook,
          collectorRegistry,
          advisoryLock,
          logger,
          systemId,
          systemName,
          configId,
          configName: configRow.configName,
          environmentId,
          environmentName: environment?.name,
          status: result.status,
          latencyMs: result.latencyMs,
          result: { ...result },
          sourceId: undefined,
          sourceLabel: "Local",
          runTimestamp: new Date(),
        });
      } catch (envError) {
        // Isolate this environment's failure; continue with the next env.
        logger.error(
          `Failed to run health check ${configId} for system ${systemId}` +
            (environmentId ? ` (environment ${environmentId})` : " (env-less)"),
          envError,
        );
      }
    } // end per-environment fan-out loop (for ... of runEnvironments)

    // The system ROLLUP (bare `<systemId>` entity) for a fanned-out env-scoped
    // run is recomputed ASYNCHRONOUSLY by the event-driven rollup consumer,
    // which subscribes to per-env `health` entity changes and debounces per
    // system (recordSystemRollupChange). Doing it inline per env-job would
    // multiply the `health:<systemId>` advisory-lock load by the fan-out
    // factor. An env-less run needs no separate rollup: its write above IS the
    // bare `<systemId>` entity, and it already recorded its own transition,
    // notification, and SYSTEM_STATUS_CHANGED signal.

    // Note: No manual rescheduling needed - recurring job handles it automatically
  } catch (error) {
    logger.error(
      `Failed to execute health check ${configId} for system ${systemId}`,
      error,
    );

    // Catastrophic job-level failure (e.g. the config fetch / env resolution
    // threw before the fan-out loop). Persist a single env-less failure run
    // against the bare `<systemId>` entity — which IS the system rollup — so
    // the system-level health change still emits. Reuses the pre-tick
    // rollup status captured before the try block.
    const rollupEntityId = encodeHealthEntityId({ systemId });
    // The pre-failure rollup baseline. Read INSIDE `apply` (inside the
    // `health:<systemId>` lock), before the failure-run insert, so a concurrent
    // catastrophic tick for the same system can't commit between the baseline
    // read and this insert and make the cache change-gate miss a transition.
    let rollupPreState!: AggregatedHealth;
    // May be `unknown`: the pre-run baseline of a check that had never run.
    let previousStatus!: SystemHealthStatus;
    let newState!: AggregatedHealth;
    await writeHealthEntity({
      handle: getHealthEntity?.(),
      entityId: rollupEntityId,
      apply: async () => {
        rollupPreState = await service.getSystemHealthStatus(systemId);
        previousStatus = rollupPreState.status;
        // §perf: batch the failure run INSERT + aggregate SELECT/UPSERT under
        // ONE `SET LOCAL search_path` transaction (3 scoped-db transactions →
        // 1), which also makes them commit atomically.
        await withScopedTransaction(db, async (tx) => {
          // Store failure (no latencyMs for failures)
          await tx.insert(healthCheckRuns).values({
            configurationId: configId,
            systemId,
            status: "unhealthy",
            result: { error: String(error) } as Record<string, unknown>,
            sourceId: undefined,
            sourceLabel: "Local",
          });

          // Trigger incremental hourly aggregation
          await incrementHourlyAggregate({
            db: tx,
            systemId,
            configurationId: configId,
            status: "unhealthy",
            latencyMs: undefined,
            runTimestamp: new Date(),
            // No collector data for error cases
            collectorRegistry,
            sourceLabel: "Local",
          });
        });

        newState = await service.getSystemHealthStatus(systemId);
        return toHealthEntityView(newState);
      },
      serialize: makeHealthSerializer(rollupEntityId),
      onError: (mirrorError) =>
        logger.warn(
          `Failed to mirror health entity for ${rollupEntityId}`,
          mirrorError,
        ),
    });

    // Try to fetch names for the enriched signal (best-effort)
    let systemName = systemId;
    let configName = configId;
    try {
      const system = await catalogClient.getSystem({ systemId });
      if (system) {
        systemName = system.name;
      }
      const [config] = await db
        .select({ name: healthCheckConfigurations.name })
        .from(healthCheckConfigurations)
        .where(eq(healthCheckConfigurations.id, configId));
      if (config) {
        configName = config.name;
      }
    } catch {
      // Use IDs as fallback
    }

    // Reconcile the rollup cache: evict + broadcast only on a real vector
    // change. This catastrophic path writes the bare `<systemId>` entity (it IS
    // the rollup), so it owns the rollup key directly — no debounced consumer
    // runs for it.
    await cache.reconcile({
      systemId,
      previous: rollupPreState,
      next: newState,
    });

    // Broadcast enriched failure signal for realtime frontend updates
    await signalService.broadcast(HEALTH_CHECK_RUN_COMPLETED, {
      systemId,
      systemName,
      configurationId: configId,
      configurationName: configName,
      status: "unhealthy",
    });

    await emitCheckCompletedHook({
      getEmitHook,
      systemId,
      configurationId: configId,
      status: "unhealthy",
      latencyMs: undefined,
      result: undefined,
      environmentId: null,
    });

    // `newState.status` cannot be `unknown` here (a run just completed).
    if (newState.status !== previousStatus && newState.status !== "unknown") {
      // Record the aggregate transition so the sensing layer has a
      // reliable "in status since" for every status (Wave 2).
      await recordStateTransition({
        db,
        systemId,
        configurationId: configId,
        // `undefined` records NULL: no prior measured status.
        fromStatus: previousStatus === "unknown" ? undefined : previousStatus,
        toStatus: newState.status,
      });

      await notifyStateChange({
        notificationClient,
        systemId,
        systemName,
        configurationId: configId,
        configurationName: configName,
        // A first measurement has no previous status to compare against.
        previousStatus:
          previousStatus === "unknown" ? "healthy" : previousStatus,
        newStatus: newState.status,
        service,
        catalogClient,
        maintenanceClient,
        incidentClient,
        logger,
      });

      // Broadcast system-level status change signal for frontend reactivity
      await signalService.broadcast(SYSTEM_STATUS_CHANGED, {
        systemId,
        previousStatus: previousStatus as HealthCheckStatus,
        newStatus: newState.status,
      });

      // The directional + umbrella system-health hooks were removed in
      // Phase 4 (§10.3): the `health` entity mirror above is the single
      // source of truth, and its change deriver fires the
      // `healthcheck.system_degraded` / `_healthy` / `_health_changed`
      // trigger events through Stage-1 routing. Nothing to emit here.
    }

    // Note: No manual rescheduling needed - recurring job handles it automatically
  } finally {
    // Release the suspect-lane slot (single-flight + capacity) on EVERY exit
    // path — success, timeout, or a catastrophic throw — so a slow run frees
    // its slot for the next tick. A no-op when this run was not admitted.
    if (laneKey && slowCheckRuntime) slowCheckRuntime.lane.release(laneKey);
  }
}

export async function setupHealthCheckWorker(props: {
  db: Db;
  advisoryLock: AdvisoryLockService;
  registry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  logger: Logger;
  queueManager: QueueManager;
  signalService: SignalService;
  catalogClient: CatalogClient;
  notificationClient: NotificationClient;
  maintenanceClient: MaintenanceClient;
  incidentClient: IncidentClient;
  getEmitHook: () => EmitHookFn | undefined;
  getHealthEntity?: () => EntityHandle<HealthEntityState> | undefined;
  cache: HealthCheckCache;
  secretResolver?: SecretResolverService;
  internalSecrets?: InternalSecretsService;
  /**
   * Slow-check bulkhead runtime. Omit to resolve it once from `process.env`
   * (the production path); pass `null` to force the feature OFF (tests that
   * don't exercise the bulkhead), or a concrete runtime to drive it.
   */
  slowCheckRuntime?: SlowCheckRuntime | null;
  /**
   * Resolves the ids of every currently-online satellite.
   *
   * Injected rather than imported so this module keeps no dependency on the
   * satellite plugin, and so the unobservable-check path is testable without
   * one. When absent, satellite-only checks behave exactly as they did before:
   * the core stays silent and lets the satellites report.
   */
  getOnlineSatelliteIds?: () => Promise<string[]>;
}): Promise<void> {
  const {
    db,
    advisoryLock,
    registry,
    collectorRegistry,
    logger,
    queueManager,
    signalService,
    catalogClient,
    notificationClient,
    maintenanceClient,
    incidentClient,
    getEmitHook,
    getHealthEntity,
    cache,
    secretResolver,
    internalSecrets,
    getOnlineSatelliteIds,
  } = props;

  // Resolve the slow-check runtime once at startup unless the caller supplied
  // one (including an explicit `null` to disable it).
  const slowCheckRuntime =
    props.slowCheckRuntime === undefined
      ? resolveSlowCheckRuntime(process.env)
      : props.slowCheckRuntime;
  if (slowCheckRuntime) {
    logger.debug("🩺 Slow-check bulkhead + adaptive timeout enabled.");
  }

  const queue =
    queueManager.getQueue<HealthCheckJobPayload>(HEALTH_CHECK_QUEUE);

  // Subscribe to health check queue in work-queue mode
  await queue.consume(
    async (job) => {
      await executeHealthCheckJob({
        payload: job.data,
        db,
        advisoryLock,
        registry,
        collectorRegistry,
        logger,
        signalService,
        catalogClient,
        notificationClient,
        maintenanceClient,
        incidentClient,
        getEmitHook,
        getHealthEntity,
        cache,
        secretResolver,
        internalSecrets,
        slowCheckRuntime,
        ...(getOnlineSatelliteIds ? { getOnlineSatelliteIds } : {}),
      });
    },
    {
      consumerGroup: WORKER_GROUP,
      maxRetries: 0, // Health checks should not retry on failure
    },
  );

  logger.debug("🎯 Health Check Worker subscribed to queue");
}
