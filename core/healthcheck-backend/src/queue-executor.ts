import {
  HealthCheckRegistry,
  Logger,
  type EmitHookFn,
  type CollectorRegistry,
  evaluateAssertions,
  type SafeDatabase,
  type BaseStrategyConfig,
  type ConnectedClient,
  type TransportClient,
  type TransportTimings,
  type CollectorRunContext,
  type AdvisoryLockService,
  renderTemplatableConfig,
} from "@checkstack/backend-api";
import type { RunTimings } from "@checkstack/healthcheck-common";
import { QueueManager } from "@checkstack/queue-api";
import {
  healthCheckConfigurations,
  systemHealthChecks,
  healthCheckRuns,
} from "./schema";
import * as schema from "./schema";
import { eq, and, max } from "drizzle-orm";
import { type SignalService } from "@checkstack/signal-common";
import {
  HEALTH_CHECK_RUN_COMPLETED,
  SYSTEM_STATUS_CHANGED,
  ENVIRONMENT_RESOLUTION_FAILED,
  type HealthCheckStatus,
  stripEphemeralFields,
} from "@checkstack/healthcheck-common";
import {
  CatalogApi,
  catalogRoutes,
  createSystemSubject,
  type Environment,
} from "@checkstack/catalog-common";
import {
  resolveEffectiveEnvironments,
  type EffectiveEnvironment,
} from "./effective-environments";
import { systemHealthCollapseKey } from "@checkstack/healthcheck-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import { IncidentApi } from "@checkstack/incident-common";
import { NotificationApi } from "@checkstack/notification-common";
import { healthcheckSystemSubscription } from "@checkstack/healthcheck-common";
import { resolveRoute, type InferClient, extractErrorMessage} from "@checkstack/common";
import { secretEnvMappingSchema } from "@checkstack/secrets-common";
import type { SecretResolverService } from "@checkstack/secrets-backend";
import { HealthCheckService } from "./service";
import { healthCheckHooks } from "./hooks";
import { incrementHourlyAggregate } from "./realtime-aggregation";
import type { HealthCheckCache } from "./cache";
import {
  classifyTransition,
  shouldNotifyTransition,
} from "./notification-policy";
import { recordStateTransition } from "./state-transitions";
import {
  writeHealthEntity,
  createHealthEntitySerializer,
  type HealthEntityState,
} from "./health-entity";
import { encodeHealthEntityId } from "./health-entity-id";
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

/** The known transport timing phase keys, in transport order. */
const RUN_TIMING_KEYS = [
  "dnsMs",
  "connectMs",
  "tlsMs",
  "waitMs",
  "transferMs",
  "processingMs",
] as const;

/**
 * Build the run's `metadata.timings` from a connected client's surfaced
 * transport timings, keeping only present, finite, non-negative phases. Returns
 * `undefined` when no usable phase was measured so the field is omitted (old
 * runs and single-phase strategies stay on the coarse fallback in the UI).
 */
function extractRunTimings(
  connectedClient: ConnectedClient<TransportClient<never, unknown>> | undefined,
): RunTimings | undefined {
  const raw: TransportTimings | undefined = connectedClient?.timings;
  if (!raw) return undefined;
  const result: RunTimings = {};
  let any = false;
  for (const key of RUN_TIMING_KEYS) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      result[key] = value;
      any = true;
    }
  }
  return any ? result : undefined;
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
}: {
  getEmitHook: () => EmitHookFn | undefined;
  systemId: string;
  configurationId: string;
  status: string;
  latencyMs: number | undefined;
  result: Record<string, unknown> | undefined;
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
    });
  }
}

/**
 * Payload for health check queue jobs
 */
export interface HealthCheckJobPayload {
  configId: string;
  systemId: string;
}

/**
 * Queue name for health check execution. Exported so consumers like
 * the `healthcheck.run_now` automation action can enqueue a one-off
 * job without re-importing the recurring-job factory.
 */
export const HEALTH_CHECK_QUEUE = "health-checks";

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

  const jobId = `healthcheck:${payload.configId}:${payload.systemId}`;

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
}): Promise<void> {
  const { systemId, service, getHealthEntity, advisoryLock, logger } = args;
  const rollupEntityId = encodeHealthEntityId({ systemId });
  const makeHealthSerializer = createHealthEntitySerializer({ advisoryLock });
  try {
    await writeHealthEntity({
      handle: getHealthEntity?.(),
      entityId: rollupEntityId,
      apply: async () => {
        const rollupState = await service.getSystemHealthStatus(systemId);
        return toHealthEntityView(rollupState);
      },
      serialize: makeHealthSerializer(rollupEntityId),
      onError: (error) =>
        logger.warn(
          `Failed to mirror rollup health entity for ${systemId} (recompute)`,
          error,
        ),
    });
  } catch (error) {
    // A recompute failure must never break the pause/resume RPC. The
    // durable tables still hold the authoritative runs; the next run tick
    // or the SLO self-heal (`reconcileOrphanedDowntime`) will converge.
    logger.error(
      `Failed to recompute system rollup health for ${systemId}`,
      error,
    );
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
 */
async function notifyStateChange(props: {
  systemId: string;
  systemName: string;
  configurationId: string;
  previousStatus: HealthCheckStatus;
  newStatus: HealthCheckStatus;
  service: HealthCheckService;
  catalogClient: CatalogClient;
  notificationClient: NotificationClient;
  maintenanceClient: MaintenanceClient;
  incidentClient: IncidentClient;
  logger: Logger;
}): Promise<void> {
  const {
    systemId,
    systemName,
    configurationId,
    previousStatus,
    newStatus,
    service,
    catalogClient,
    notificationClient,
    maintenanceClient,
    incidentClient,
    logger,
  } = props;

  const transition = classifyTransition(previousStatus, newStatus);
  if (transition === "none") {
    return;
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
    return;
  }

  // Check if notifications should be suppressed due to active maintenance
  try {
    const { suppressed } =
      await maintenanceClient.hasActiveMaintenanceWithSuppression({ systemId });
    if (suppressed) {
      logger.debug(
        `Skipping notification for ${systemId}: active maintenance with suppression enabled`,
      );
      return;
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
      return;
    }
  } catch (error) {
    // Log but continue with notification - suppression check failure shouldn't block notifications
    logger.warn(
      `Failed to check incident suppression for ${systemId}, proceeding with notification:`,
      error,
    );
  }

  let title: string;
  let body: string;
  let importance: "info" | "warning" | "critical";

  if (transition === "recovery") {
    title = `System health restored: ${systemName}`;
    body =
      `All health checks for **${systemName}** are now passing. The system has returned to normal operation.`;
    importance = "info";
  } else if (newStatus === "unhealthy") {
    title = `System health critical: ${systemName}`;
    body = `Health checks indicate **${systemName}** is unhealthy and may be down.`;
    importance = "critical";
  } else {
    // degraded — either an escalation from healthy or a partial recovery
    title = `System health degraded: ${systemName}`;
    body =
      `Some health checks for **${systemName}** are failing. The system may be experiencing issues.`;
    importance = "warning";
  }

  const systemDetailPath = resolveRoute(catalogRoutes.routes.systemDetail, {
    systemId,
  });
  // Recovery lands on the default (all) view; failing transitions deep-link
  // operators into the failing-checks filter so they can debug immediately.
  const actionUrl =
    transition === "recovery"
      ? systemDetailPath
      : `${systemDetailPath}?filter=failing`;
  const actionLabel =
    transition === "recovery" ? "View System" : "View failing checks";

  void catalogClient; // parents are resolved server-side via stored target edges

  try {
    await notificationClient.notifyForSubscription({
      specId: healthcheckSystemSubscription.specId,
      resourceKeys: [systemId],
      title,
      body,
      importance,
      action: { label: actionLabel, url: actionUrl },
      collapseKey: systemHealthCollapseKey(systemId),
      subjects: [
        createSystemSubject({
          id: systemId,
          name: systemName,
          url: systemDetailPath,
          status: newStatus,
        }),
      ],
    });
    logger.debug(
      `Notified subscribers: ${previousStatus} → ${newStatus} for system ${systemId}`,
    );
  } catch (error) {
    // Log but don't fail the operation - notifications are best-effort
    logger.warn(
      `Failed to notify subscribers for health state change on system ${systemId}:`,
      error,
    );
  }
}

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

  // The system-rollup status BEFORE this tick (all environments + env-less).
  // Captured once so the post-loop rollup write (§7.4.3) — and the
  // catastrophic-failure path — can record a correct prev → next rollup
  // transition (environmentId = null). This is the system-wide aggregate read
  // the executor has always taken first.
  const rollupPreviousState = await service.getSystemHealthStatus(systemId);
  const rollupPreviousStatus = rollupPreviousState.status;

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

    // If includeLocal is false and satellites are assigned, skip local execution
    // (satellites handle execution, local core doesn't run this check)
    if (
      !configRow.includeLocal &&
      configRow.satelliteIds &&
      configRow.satelliteIds.length > 0
    ) {
      logger.debug(
        `Health check ${configId} for system ${systemId} is satellite-only, skipping local execution`,
      );
      return;
    }

    // Fetch system name for signal payload
    let systemName = systemId;
    try {
      const system = await catalogClient.getSystem({ systemId });
      if (system) {
        systemName = system.name;
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

    // Migrate the stored (UNVERSIONED) strategy config ONCE, before the
    // per-environment render loop, so every env renders from the same
    // migrated shape. Stored configs predate explicit versioning and may be
    // genuinely v1 (e.g. an HTTP config still carrying url/method); assume-v1
    // -on-read runs the declared migration chain, then validates. The
    // migrations are idempotent, so an already-current config is a no-op.
    const strategyConfig: BaseStrategyConfig =
      await strategy.config.parseAssumingV1(configRow.config);
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
    try {
      membership = await catalogClient.resolveSystemEnvironments({ systemId });
    } catch (error) {
      // Fail-open: a catalog read failure must not wedge the check. Degrade
      // to an env-less run (today's behavior) rather than skipping the tick.
      logger.warn(
        `Could not resolve environments for system ${systemId}, running env-less`,
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
    // `null` env => the single env-less run. Each entry => one run per env.
    const runEnvironments: (EffectiveEnvironment | null)[] =
      effectiveEnvs.length > 0 ? effectiveEnvs : [null];

    // Execute one run per effective environment. Runs are independent (own
    // status / latency / result) and persisted with their own
    // `environmentId`. Phase 3b: each env-run mutates its OWN env-qualified
    // `health` entity (`<systemId>::<environmentId>`, or the bare `<systemId>`
    // for the env-less run) through a per-entity serializer; after the loop a
    // single ROLLUP write for the bare `<systemId>` recomputes the worst-status
    // rollup so system-level consumers keep firing off the unchanged id.
    //
    // Track whether ANY per-env run persisted (so the rollup write only runs
    // when there is something to roll up — an all-failed loop still leaves the
    // durable runs the per-env apply already wrote).
    let anyEnvRunPersisted = false;
    // Whether this tick fans out into REAL environments (vs. the single
    // env-less run). When env-less, the loop's lone write already targets the
    // bare `<systemId>` entity — which IS the rollup — so no separate rollup
    // write is needed. With real envs, the loop writes `<systemId>::<env>`
    // entities and we recompute the bare-`<systemId>` rollup after the loop.
    const isFannedOut = effectiveEnvs.length > 0;
    for (const environment of runEnvironments) {
      const environmentId = environment?.id ?? null;
      // The env-qualified entity id this run mutates. For the env-less run
      // (environmentId === null) this is the bare systemId — which is also the
      // rollup id, so the env-less run IS the rollup (no separate rollup write
      // is needed when the system has no environments — see below).
      const envEntityId = encodeHealthEntityId({ systemId, environmentId });
      const serializeEnvWrite = makeHealthSerializer(envEntityId);

      // Per-env baseline status for the transition log: the env-scoped
      // aggregate BEFORE this run. Computed per env so a transition row is
      // recorded against the right (system, environment) streak.
      const previousState = await service.getSystemHealthStatus(
        systemId,
        environmentId,
      );
      const previousStatus = previousState.status;

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
        system: { id: systemId, name: systemName },
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

      // Templating context for the per-env config render pass (§6.3.3).
      // Carries only environment custom fields + curated check/system
      // metadata - never secrets. `{{ environment.baseUrl }}` resolves from
      // the resolved env's verbatim fields; an env-less run gets `{}` so a
      // reference renders to empty string (strict: false); see the debug log
      // below.
      const templateContext = {
        environment: runContext.environment?.fields ?? {},
        check: runContext.check,
        system: runContext.system,
      };
      if (!runContext.environment) {
        // §11.6: render-empty when a run has no environment. An env-less run is
        // a legitimate, documented configuration (the None assignment mode, or
        // All-environments with no membership), and it recurs every interval -
        // so this is `debug`, not `warn`, to avoid spamming the log. When an
        // empty `{{ environment.* }}` render actually matters, the HTTP
        // post-render `.url()` check already fails the run with a concrete
        // "Rendered URL is invalid" error; we do not inspect every field here.
        logger.debug(
          `Health check ${configId} for system ${systemId} ran with no environment; ` +
            `any {{ environment.* }} references render to empty string`,
        );
      }

      // (2) Environment/templating pass (NEW) - renders `{{ environment.* }}`
      // etc. in `x-templatable` fields. Runs PER ENVIRONMENT, AFTER the secret
      // resolution (secrets first, templating second - §6.3.4) and BEFORE the
      // strategy client build, so each env gets its own rendered strategy
      // config + client. The collector configs are rendered just before each
      // collector executes (below) so the secretEnv resolution stays first.
      const renderedStrategyConfig = renderTemplatableConfig({
        config: strategyConfig,
        schema: strategy.config.schema,
        context: templateContext,
      }) as BaseStrategyConfig;

    // Per-environment isolation: an unexpected failure persisting ONE
    // environment's run must not abort the sibling environments' runs.
    // Each iteration's run is independent (§7.2), so we log and continue.
    try {
    // Execute health check using createClient pattern with unified hard timeout
    const start = performance.now();
    let connectionTimeMs: number | undefined;
    let connectedClient:
      | ConnectedClient<TransportClient<never, unknown>>
      | undefined;
    const collectors = configRow.collectors ?? [];
    const collectorResults: Record<string, unknown> = {};
    let hasCollectorError = false;
    let errorMessage: string | undefined;

    try {
      // Platform-level hard timeout wrapping the entire execution sequence
      await Promise.race([
        (async () => {
          // 1. Establish connection. The strategy client build moves INSIDE
          // the per-env loop (§6.3.3): each env gets its own rendered config +
          // client, so a single job no longer bakes in one env's rendered
          // strategy config.
          connectedClient = await strategy.createClient(renderedStrategyConfig);
          connectionTimeMs = Math.round(performance.now() - start);

          // 2. Execute collectors in parallel
          const collectorPromises = collectors.map(async (collectorEntry) => {
            const registered = collectorRegistry.getCollector(
              collectorEntry.collectorId,
            );
            if (!registered) {
              logger.warn(
                `Collector ${collectorEntry.collectorId} not found, skipping`,
              );
              return { storageKey: collectorEntry.id, skipped: true };
            }

            const storageKey = collectorEntry.id;

            try {
              // Resolve the collector's declared secretEnv for THIS run
              // (central execution). The collector injects it and masks the
              // values out of its output. A missing required secret throws
              // and fails the collector clearly.
              let secretEnv: Record<string, string> | undefined;
              const declared = secretEnvMappingSchema.safeParse(
                (collectorEntry.config as { secretEnv?: unknown }).secretEnv,
              );
              if (
                secretResolver &&
                declared.success &&
                Object.keys(declared.data).length > 0
              ) {
                const resolved = await secretResolver.resolveForRun({
                  secretEnv: declared.data,
                });
                secretEnv = resolved.env;
              }

              // Migrate the stored (UNVERSIONED) collector config via
              // assume-v1-on-read: runs the declared migration chain, then
              // validates. Migrations are idempotent, so an already-current
              // config is a no-op. This runs BEFORE templating so the render
              // pass sees the migrated shape; the secretEnv resolution above
              // reads the raw `secretEnv` mapping (a constant string field
              // unaffected by the strategy/collector reshapes), keeping the
              // migrate -> secret resolve -> render -> execute order intact.
              const migratedCollectorConfig =
                await registered.collector.config.parseAssumingV1(
                  collectorEntry.config,
                );

              // (2) Environment/templating pass for the collector config -
              // runs AFTER the secretEnv resolution above (secrets first,
              // templating second) and renders `{{ environment.* }}` in this
              // collector's `x-templatable` fields against the per-env context.
              const renderedCollectorConfig = renderTemplatableConfig({
                config: migratedCollectorConfig,
                schema: registered.collector.config.schema,
                context: templateContext,
              });

              const collectorResult = await registered.collector.execute({
                config: renderedCollectorConfig,
                client: connectedClient!.client,
                pluginId: configRow.strategyId,
                runContext,
                ...(secretEnv ? { secretEnv } : {}),
              });

              // Check for collector-level error
              let collectorError: string | undefined;
              if (collectorResult.error) {
                collectorError = collectorResult.error;
              }

              // Evaluate per-collector assertions
              let assertionFailed: string | undefined;
              if (
                collectorEntry.assertions &&
                collectorEntry.assertions.length > 0 &&
                collectorResult.result
              ) {
                const failedAssertion = evaluateAssertions(
                  collectorEntry.assertions,
                  collectorResult.result as Record<string, unknown>,
                );
                if (failedAssertion) {
                  assertionFailed = `${failedAssertion.field} ${
                    failedAssertion.operator
                  } ${failedAssertion.value ?? ""}`;
                  logger.debug(
                    `Collector ${storageKey} assertion failed: ${assertionFailed}`,
                  );
                }
              }

              // Strip ephemeral fields before storage
              const strippedResult = stripEphemeralFields(
                collectorResult.result as Record<string, unknown>,
                registered.collector.result.schema,
              );

              return {
                storageKey,
                skipped: false,
                success: true,
                collectorError,
                assertionFailed,
                result: {
                  _collectorId: collectorEntry.collectorId,
                  _assertionFailed: assertionFailed,
                  _collectorError: collectorError,
                  ...strippedResult,
                },
              };
            } catch (error) {
              const errorStr =
                extractErrorMessage(error);
              logger.debug(`Collector ${storageKey} failed: ${errorStr}`);
              return {
                storageKey,
                skipped: false,
                success: false,
                error: errorStr,
                result: {
                  _collectorId: collectorEntry.collectorId,
                  _assertionFailed: undefined,
                  _collectorError: errorStr,
                },
              };
            }
          });

          // Wait for all collectors to complete
          const settledResults = await Promise.allSettled(collectorPromises);

          // Process results from all collectors
          for (const settled of settledResults) {
            if (settled.status === "rejected") {
              // This shouldn't happen since we catch errors above, but handle it
              hasCollectorError = true;
              if (!errorMessage) errorMessage = String(settled.reason);
              continue;
            }

            const result = settled.value;
            if (result.skipped) continue;

            // Store the result
            collectorResults[result.storageKey] = result.result;

            // Track errors
            if (
              !result.success ||
              result.collectorError ||
              result.assertionFailed
            ) {
              hasCollectorError = true;
              if (!errorMessage) {
                errorMessage =
                  result.error ||
                  result.collectorError ||
                  (result.assertionFailed
                    ? `Assertion failed: ${result.assertionFailed}`
                    : undefined);
              }
            }
          }
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`Execution timeout after ${executionTimeout}ms`),
              ),
            executionTimeout,
          ),
        ),
      ]);
    } catch (error) {
      const latencyMs = Math.round(performance.now() - start);
      const caughtError =
        extractErrorMessage(error);

      // Use a specific error message if available, otherwise use the caught error
      const finalError = errorMessage || caughtError;

      const result = {
        status: "unhealthy" as const,
        latencyMs,
        message: finalError,
        metadata: {
          connected: !!connectedClient,
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
          await db.insert(healthCheckRuns).values({
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
            db,
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

          // Env-scoped view: the per-env entity reflects only this env's runs.
          newState = await service.getSystemHealthStatus(systemId, environmentId);
          return toHealthEntityView(newState);
        },
        serialize: serializeEnvWrite,
        onError: (error) =>
          logger.warn(
            `Failed to mirror health entity for ${envEntityId}`,
            error,
          ),
      });
      anyEnvRunPersisted = true;

      logger.debug(
        `Health check ${configId} for system ${systemId} failed: ${finalError}`,
      );

      // Invalidate the per-system status cache before broadcasting so any
      // frontend that refetches in response to the signal gets fresh data.
      await cache.invalidateSystem(systemId);

      await signalService.broadcast(HEALTH_CHECK_RUN_COMPLETED, {
        systemId,
        systemName,
        configurationId: configId,
        configurationName: configRow.configName,
        status: result.status,
        latencyMs: result.latencyMs,
      });

      if (newState.status !== previousStatus) {
        // Record the aggregate transition so the sensing layer has a
        // reliable "in status since" for every status (Wave 2).
        await recordStateTransition({
          db,
          systemId,
          configurationId: configId,
          environmentId,
          fromStatus: previousStatus,
          toStatus: newState.status,
        });

        await notifyStateChange({
          notificationClient,
          systemId,
          systemName,
          configurationId: configId,
          previousStatus,
          newStatus: newState.status,
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
    } finally {
      if (connectedClient) {
        try {
          connectedClient.close();
        } catch (error) {
          logger.warn(`Failed to close connection: ${error}`);
        }
      }
    }

    // Determine health status based on collector results
    const status = hasCollectorError ? "unhealthy" : "healthy";
    const totalLatencyMs = Math.round(performance.now() - start);

    // Lift the strategy's structured transport timings (DNS / connect / TLS /
    // wait / transfer / processing) into the run metadata when the connected
    // client surfaced any. Strategies that cannot measure sub-phases leave this
    // undefined and the frontend falls back to the coarse connection split.
    const timings = extractRunTimings(connectedClient);

    const result = {
      status: status as "healthy" | "unhealthy",
      latencyMs: totalLatencyMs,
      message: hasCollectorError
        ? `Check failed: ${errorMessage}`
        : `Completed in ${totalLatencyMs}ms`,
      metadata: {
        connected: true,
        connectionTimeMs,
        ...(timings ? { timings } : {}),
        collectors: collectorResults,
      },
    };

    // Persist the run + aggregate THROUGH the reactive `health` entity on
    // every run (§10.3): `apply` does the durable write (insert + hourly
    // aggregate) and returns the freshly-computed view. The framework
    // snapshots `prev` via the COMPUTE-ON-READ accessor BEFORE this insert, so
    // an unchanged aggregate is a no-op and a real status change drives the
    // directional/umbrella trigger events via `deriveHealthTriggerEvents` —
    // exactly one correct `ENTITY_CHANGED` with accurate prev → next.
    let newState!: AggregatedHealth;
    await writeHealthEntity({
      handle: getHealthEntity?.(),
      entityId: envEntityId,
      apply: async () => {
        // Store result (spread to convert structured type to plain record for jsonb)
        await db.insert(healthCheckRuns).values({
          configurationId: configId,
          systemId,
          environmentId,
          status: result.status,
          latencyMs: result.latencyMs,
          result: { ...result } as Record<string, unknown>,
          sourceId: undefined,
          sourceLabel: "Local",
        });

        // Trigger incremental hourly aggregation
        await incrementHourlyAggregate({
          db,
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

        // Env-scoped view: the per-env entity reflects only this env's runs.
        newState = await service.getSystemHealthStatus(systemId, environmentId);
        return toHealthEntityView(newState);
      },
      serialize: serializeEnvWrite,
      onError: (error) =>
        logger.warn(`Failed to mirror health entity for ${envEntityId}`, error),
    });
    anyEnvRunPersisted = true;

    logger.debug(
      `Ran health check ${configId} for system ${systemId}: ${result.status}`,
    );

    // Invalidate the per-system status cache before broadcasting so any
    // frontend that refetches in response to the signal gets fresh data.
    await cache.invalidateSystem(systemId);

    // Broadcast enriched signal for realtime frontend updates (e.g., terminal feed)
    await signalService.broadcast(HEALTH_CHECK_RUN_COMPLETED, {
      systemId,
      systemName,
      configurationId: configId,
      configurationName: configRow.configName,
      status: result.status,
      latencyMs: result.latencyMs,
    });

    await emitCheckCompletedHook({
      getEmitHook,
      systemId,
      configurationId: configId,
      status: result.status,
      latencyMs: result.latencyMs,
      result: (result.metadata?.collectors as Record<string, unknown>) ?? undefined,
    });

    if (newState.status !== previousStatus) {
      // Record the aggregate transition so the sensing layer has a
      // reliable "in status since" for every status (Wave 2).
      await recordStateTransition({
        db,
        systemId,
        configurationId: configId,
        environmentId,
        fromStatus: previousStatus,
        toStatus: newState.status,
      });

      await notifyStateChange({
        notificationClient,
        systemId,
        systemName,
        configurationId: configId,
        previousStatus,
        newStatus: newState.status,
        service,
        catalogClient,
        maintenanceClient,
        incidentClient,
        logger,
      });

      // The system-level `SYSTEM_STATUS_CHANGED` signal must carry the ROLLUP
      // status, not a per-env status. When fanned out, the post-loop rollup
      // write broadcasts it once with the worst-status rollup; emitting it here
      // per env would send up to N system-level signals/tick carrying per-env
      // status. Only the env-less run (which IS the rollup — `!isFannedOut`)
      // broadcasts the system-level signal from inside the loop.
      if (!isFannedOut) {
        await signalService.broadcast(SYSTEM_STATUS_CHANGED, {
          systemId,
          previousStatus: previousStatus as HealthCheckStatus,
          newStatus: newState.status,
        });
      }

      // The directional + umbrella system-health hooks were removed in
      // Phase 4 (§10.3): the `health` entity mirror above is the single
      // source of truth, and its change deriver fires the
      // `healthcheck.system_degraded` / `_healthy` / `_health_changed`
      // trigger events through Stage-1 routing. Nothing to emit here.
    }
    } catch (envError) {
      // Isolate this environment's failure; continue with the next env.
      logger.error(
        `Failed to run health check ${configId} for system ${systemId}` +
          (environmentId ? ` (environment ${environmentId})` : " (env-less)"),
        envError,
      );
    }
    } // end per-environment fan-out loop (for ... of runEnvironments)

    // ── System rollup write (§7.4.3) ───────────────────────────────────────
    // With real environments, the per-env writes mutated `<systemId>::<env>`
    // entities; the bare `<systemId>` ROLLUP entity (the worst-status view
    // every existing system-level consumer references) must now recompute so
    // it diffs/emits its OWN `ENTITY_CHANGED`. The rollup `apply` does NO new
    // durable insert (the runs are already persisted by the per-env writes) —
    // it just recomputes + returns the all-runs rollup view so the framework
    // diffs prev → next. Keyed on the bare `health:<systemId>` lock so it
    // serializes against itself, independent of the per-env locks.
    //
    // Skipped when env-less (the loop's lone write already targeted the bare
    // `<systemId>` entity = the rollup) or when nothing persisted (a fully
    // isolated-failure loop left no new runs to roll up).
    if (isFannedOut && anyEnvRunPersisted) {
      const rollupEntityId = encodeHealthEntityId({ systemId });
      let rollupState!: AggregatedHealth;
      try {
        await writeHealthEntity({
          handle: getHealthEntity?.(),
          entityId: rollupEntityId,
          apply: async () => {
            // No durable insert — recompute the all-runs (rollup) view.
            rollupState = await service.getSystemHealthStatus(systemId);
            return toHealthEntityView(rollupState);
          },
          serialize: makeHealthSerializer(rollupEntityId),
          onError: (error) =>
            logger.warn(
              `Failed to mirror rollup health entity for ${systemId}`,
              error,
            ),
        });

        // Record the ROLLUP transition (environmentId = null) so system-level
        // "in status since" reflects the aggregate, and notify on a real
        // rollup status change so existing system-level notifications fire.
        if (rollupState.status !== rollupPreviousStatus) {
          await recordStateTransition({
            db,
            systemId,
            configurationId: configId,
            environmentId: null,
            fromStatus: rollupPreviousStatus,
            toStatus: rollupState.status,
          });

          await notifyStateChange({
            notificationClient,
            systemId,
            systemName,
            configurationId: configId,
            previousStatus: rollupPreviousStatus,
            newStatus: rollupState.status,
            service,
            catalogClient,
            maintenanceClient,
            incidentClient,
            logger,
          });

          await signalService.broadcast(SYSTEM_STATUS_CHANGED, {
            systemId,
            previousStatus: rollupPreviousStatus as HealthCheckStatus,
            newStatus: rollupState.status,
          });
        }
      } catch (rollupError) {
        // The rollup is best-effort reactivity over already-durable runs; a
        // failure must not wedge the (completed) per-env runs.
        logger.error(
          `Failed to write system rollup health for ${systemId}`,
          rollupError,
        );
      }
    }

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
    const previousStatus = rollupPreviousStatus;
    let newState!: AggregatedHealth;
    await writeHealthEntity({
      handle: getHealthEntity?.(),
      entityId: rollupEntityId,
      apply: async () => {
        // Store failure (no latencyMs for failures)
        await db.insert(healthCheckRuns).values({
          configurationId: configId,
          systemId,
          status: "unhealthy",
          result: { error: String(error) } as Record<string, unknown>,
          sourceId: undefined,
          sourceLabel: "Local",
        });

        // Trigger incremental hourly aggregation
        await incrementHourlyAggregate({
          db,
          systemId,
          configurationId: configId,
          status: "unhealthy",
          latencyMs: undefined,
          runTimestamp: new Date(),
          // No collector data for error cases
          collectorRegistry,
          sourceLabel: "Local",
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

    // Invalidate the per-system status cache before broadcasting so any
    // frontend that refetches in response to the signal gets fresh data.
    await cache.invalidateSystem(systemId);

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
    });

    if (newState.status !== previousStatus) {
      // Record the aggregate transition so the sensing layer has a
      // reliable "in status since" for every status (Wave 2).
      await recordStateTransition({
        db,
        systemId,
        configurationId: configId,
        fromStatus: previousStatus,
        toStatus: newState.status,
      });

      await notifyStateChange({
        notificationClient,
        systemId,
        systemName,
        configurationId: configId,
        previousStatus,
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
  } = props;

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
      });
    },
    {
      consumerGroup: WORKER_GROUP,
      maxRetries: 0, // Health checks should not retry on failure
    },
  );

  logger.debug("🎯 Health Check Worker subscribed to queue");
}

/**
 * Bootstrap health checks by enqueueing all enabled checks
 */
export async function bootstrapHealthChecks(props: {
  db: Db;
  queueManager: QueueManager;
  logger: Logger;
}): Promise<void> {
  const { db, queueManager, logger } = props;

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
      eq(systemHealthChecks.configurationId, healthCheckConfigurations.id),
    )
    .where(eq(systemHealthChecks.enabled, true));

  // Get latest run timestamp for each system+config pair
  // Using Drizzle's max() function for proper timestamp handling (no raw SQL)
  const latestRuns = await db
    .select({
      systemId: healthCheckRuns.systemId,
      configurationId: healthCheckRuns.configurationId,
      maxTimestamp: max(healthCheckRuns.timestamp),
    })
    .from(healthCheckRuns)
    .groupBy(healthCheckRuns.systemId, healthCheckRuns.configurationId);

  // Create a lookup map for fast access
  const lastRunMap = new Map<string, Date>();
  for (const run of latestRuns) {
    if (run.maxTimestamp) {
      const key = `${run.systemId}:${run.configurationId}`;
      lastRunMap.set(key, run.maxTimestamp);
    }
  }

  logger.debug(`Bootstrapping ${enabledChecks.length} health checks`);

  for (const check of enabledChecks) {
    // Look up the last run from the map
    const lastRunKey = `${check.systemId}:${check.configId}`;
    const lastRun = lastRunMap.get(lastRunKey);

    // Calculate delay for first run based on time since last run
    let startDelay = 0;
    if (lastRun) {
      const elapsedSeconds = Math.floor(
        (Date.now() - lastRun.getTime()) / 1000,
      );
      if (elapsedSeconds < check.interval) {
        // Not overdue yet - schedule with remaining time
        startDelay = check.interval - elapsedSeconds;
      }
      // Otherwise it's overdue - run immediately (startDelay = 0)
      logger.debug(
        `Health check ${check.configId}:${
          check.systemId
        } - lastRun: ${lastRun.toISOString()}, elapsed: ${elapsedSeconds}s, interval: ${
          check.interval
        }s, startDelay: ${startDelay}s`,
      );
    } else {
      logger.debug(
        `Health check ${check.configId}:${check.systemId} - no lastRun found, running immediately`,
      );
    }

    await scheduleHealthCheck({
      queueManager,
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
  const queue =
    queueManager.getQueue<HealthCheckJobPayload>(HEALTH_CHECK_QUEUE);
  const allRecurringJobs = await queue.listRecurringJobs();
  const expectedJobIds = new Set(
    enabledChecks.map(
      (check) => `healthcheck:${check.configId}:${check.systemId}`,
    ),
  );

  const orphanedJobs = allRecurringJobs.filter(
    (jobId) => jobId.startsWith("healthcheck:") && !expectedJobIds.has(jobId),
  );

  for (const jobId of orphanedJobs) {
    await queue.cancelRecurring(jobId);
    logger.debug(`Removed orphaned job scheduler: ${jobId}`);
  }

  if (orphanedJobs.length > 0) {
    logger.info(
      `🧹 Cleaned up ${orphanedJobs.length} orphaned health check jobs`,
    );
  }
}
