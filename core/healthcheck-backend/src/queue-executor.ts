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
  type CollectorRunContext,
} from "@checkstack/backend-api";
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
  type HealthCheckStatus,
  stripEphemeralFields,
} from "@checkstack/healthcheck-common";
import {
  CatalogApi,
  catalogRoutes,
  createSystemSubject,
} from "@checkstack/catalog-common";
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
import {
  detectAndEmitFlapping,
  isTransitionToUnhealthy,
} from "./flapping-detector";
import { recordStateTransition } from "./state-transitions";
import {
  writeHealthEntity,
  type HealthEntityState,
} from "./health-entity";
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
 * After every check run, run flapping DETECTION for the per-check.
 *
 * The hardcoded incident open/close path was removed in Phase 20 - that
 * behaviour now ships as user-editable default automations
 * (`healthcheck.system.degraded` + `for:` -> `incident.create`, the
 * `healthcheck.flapping_detected` trigger, etc.). What remains here is
 * the detection that those automations subscribe to: record each
 * transition-to-unhealthy and emit `healthcheck.flapping_detected` when
 * the policy's flapping threshold is crossed within the window.
 *
 * The flapping emit is now UNCONDITIONAL on a threshold cross (it no
 * longer depends on `autoOpenIncidentOnUnhealthy`); see
 * `flapping-detector.ts`. Maintenance suppression / require-recovery /
 * the sustained-duration decision all move into the automations.
 */
async function detectFlappingForCheck(props: {
  db: Db;
  service: HealthCheckService;
  logger: Logger;
  systemId: string;
  configurationId: string;
  getEmitHook?: () => EmitHookFn | undefined;
  previousState: {
    checkStatuses: Array<{
      configurationId: string;
      status: HealthCheckStatus;
    }>;
  };
  newState: {
    checkStatuses: Array<{
      configurationId: string;
      status: HealthCheckStatus;
    }>;
  };
}): Promise<void> {
  const {
    db,
    service,
    logger,
    systemId,
    configurationId,
    getEmitHook,
    previousState,
    newState,
  } = props;

  const next = newState.checkStatuses.find(
    (c) => c.configurationId === configurationId,
  );
  // Flapping detection only triggers on a fresh transition to unhealthy.
  if (!next || next.status !== "unhealthy") return;

  const prev = previousState.checkStatuses.find(
    (c) => c.configurationId === configurationId,
  );
  const isTransition = isTransitionToUnhealthy(prev?.status, next.status);
  if (!isTransition) return;

  let policy;
  try {
    policy = await service.getAssignmentNotificationPolicy({
      systemId,
      configurationId,
    });
  } catch (error) {
    logger.warn(
      `Failed to load policy for flapping detection (${systemId}/${configurationId}):`,
      error,
    );
    return;
  }

  await detectAndEmitFlapping({
    db,
    configurationId,
    systemId,
    flappingTrigger: policy.flappingTrigger,
    isTransition,
    getEmitHook,
    logger,
  });
}

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

  // Capture aggregated state BEFORE this run for comparison
  const previousState = await service.getSystemHealthStatus(systemId);
  const previousStatus = previousState.status;

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

    // Curated, read-only run-context metadata exposed to collectors.
    // Metadata only - never secrets or config.
    const runContext: CollectorRunContext = {
      check: {
        id: configId,
        name: configRow.configName || configId,
        intervalSeconds: configRow.interval,
      },
      system: { id: systemId, name: systemName },
    };

    const strategy = registry.getStrategy(configRow.strategyId);
    if (!strategy) {
      logger.warn(
        `Strategy ${configRow.strategyId} not found for config ${configId}`,
      );
      return;
    }

    // Extract timeout from strategy config for platform-level enforcement
    const strategyConfig = configRow.config as unknown as BaseStrategyConfig;
    const executionTimeout = strategyConfig.timeout ?? 60_000;

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
          // 1. Establish connection
          connectedClient = await strategy.createClient(strategyConfig);
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

              const collectorResult = await registered.collector.execute({
                config: collectorEntry.config,
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
        systemId,
        apply: async () => {
          await db.insert(healthCheckRuns).values({
            configurationId: configId,
            systemId,
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
            status: result.status,
            latencyMs: result.latencyMs,
            runTimestamp: new Date(),
            result: { ...result } as Record<string, unknown>,
            collectorRegistry,
            sourceLabel: "Local",
          });

          newState = await service.getSystemHealthStatus(systemId);
          return toHealthEntityView(newState);
        },
        onError: (error) =>
          logger.warn(`Failed to mirror health entity for ${systemId}`, error),
      });

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

      // Per-check auto-incident: runs whether or not the aggregate
      // changed (a check can transition to unhealthy without flipping
      // the aggregate if another check is already unhealthy).
      await detectFlappingForCheck({
        db,
        service,
        logger,
        systemId,
        configurationId: configId,
        getEmitHook,
        previousState,
        newState,
      });

      return;
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

    const result = {
      status: status as "healthy" | "unhealthy",
      latencyMs: totalLatencyMs,
      message: hasCollectorError
        ? `Check failed: ${errorMessage}`
        : `Completed in ${totalLatencyMs}ms`,
      metadata: {
        connected: true,
        connectionTimeMs,
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
      systemId,
      apply: async () => {
        // Store result (spread to convert structured type to plain record for jsonb)
        await db.insert(healthCheckRuns).values({
          configurationId: configId,
          systemId,
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
          status: result.status,
          latencyMs: result.latencyMs,
          runTimestamp: new Date(),
          result: { ...result } as Record<string, unknown>,
          collectorRegistry,
          sourceLabel: "Local",
        });

        newState = await service.getSystemHealthStatus(systemId);
        return toHealthEntityView(newState);
      },
      onError: (error) =>
        logger.warn(`Failed to mirror health entity for ${systemId}`, error),
    });

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

    // Per-check flapping detection: see comment on the failed-execution path.
    await detectFlappingForCheck({
      db,
      service,
      logger,
      systemId,
      configurationId: configId,
      getEmitHook,
      previousState,
      newState,
    });

    // Note: No manual rescheduling needed - recurring job handles it automatically
  } catch (error) {
    logger.error(
      `Failed to execute health check ${configId} for system ${systemId}`,
      error,
    );

    // Persist the failure run + aggregate THROUGH the reactive `health`
    // entity: `apply` does the durable write and returns the freshly-computed
    // view. The framework snapshots `prev` via the compute-on-read accessor
    // BEFORE this insert, so a real status change emits exactly one correct
    // `ENTITY_CHANGED` (§10.3). See the success path for the full rationale.
    let newState!: AggregatedHealth;
    await writeHealthEntity({
      handle: getHealthEntity?.(),
      systemId,
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
      onError: (mirrorError) =>
        logger.warn(
          `Failed to mirror health entity for ${systemId}`,
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

    // Per-check flapping detection: see comment on the failed-execution path.
    await detectFlappingForCheck({
      db,
      service,
      logger,
      systemId,
      configurationId: configId,
      getEmitHook,
      previousState,
      newState,
    });

    // Note: No manual rescheduling needed - recurring job handles it automatically
  }
}

export async function setupHealthCheckWorker(props: {
  db: Db;
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
