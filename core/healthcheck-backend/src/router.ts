import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  toJsonSchema,
  type RpcContext,
  type HealthCheckRegistry,
  type SafeDatabase,
  type CollectorRegistry,
  type ConfigService,
} from "@checkstack/backend-api";
import {
  healthCheckContract,
  HEALTHCHECK_CONFIG_CHANGED,
} from "@checkstack/healthcheck-common";
import type { StrategyCategory } from "@checkstack/healthcheck-common";
import { type SignalService } from "@checkstack/signal-common";
import {
  resolveResolutionRootFromStore,
  resolveScriptPackagesDir,
} from "@checkstack/script-packages-backend";
import { HealthCheckService } from "./service";
import type { HealthCheckSecretsDeps } from "./config-secrets";
import {
  canReadRunScope,
  hasGlobalHistoryAccess,
  listManageableSystemIds,
  listTeamManageableConfigurationIds,
  resolveHistoryScope,
} from "./history-access";
import { collectConfigurationIssues } from "./validate-configuration";
import { runCollectorScriptTest } from "./collector-script-test";
import { healthCheckHooks } from "./hooks";
import * as schema from "./schema";
import { toJsonSchemaWithChartMeta } from "./schema-utils";
import { extractErrorMessage, type InferClient } from "@checkstack/common";
import { GitOpsApi } from "@checkstack/gitops-common";
import { CatalogApi } from "@checkstack/catalog-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import type { Logger } from "@checkstack/backend-api";
import type { HealthCheckCache } from "./cache";
import {
  applySystemHealthOverrides,
  type SystemHealthOverrideReader,
} from "./system-health-override";
import type { SystemHealthStatusResponse } from "@checkstack/healthcheck-common";

/**
 * Creates the healthcheck router using contract-based implementation.
 *
 * Auth and access rules are automatically enforced via autoAuthMiddleware
 * based on the contract's meta.userType and meta.access.
 */
export const createHealthCheckRouter = (opts: {
  database: SafeDatabase<typeof schema>;
  registry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
  gitOpsClient: InferClient<typeof GitOpsApi>;
  getEmitHook: () => ((hook: { id: string }, payload: Record<string, unknown>) => Promise<void>) | undefined;
  cache: HealthCheckCache;
  configService: ConfigService;
  catalogClient: InferClient<typeof CatalogApi>;
  maintenanceClient: InferClient<typeof MaintenanceApi>;
  logger: Logger;
  /**
   * Broadcasts `healthcheck.config.changed` so every client's `[[healthcheck]]`
   * cache refreshes after a config/assignment mutation - the only way an
   * out-of-band write (AI assistant, GitOps, another pod/user) reaches an
   * already-open Health Checks list before the first run fires a status signal.
   * Optional so existing tests can omit it.
   */
  signalService?: SignalService;
  /**
   * Recompute and persist the system rollup `health` entity for a single
   * system, used by `pauseConfiguration` to drive the SLO engine when the
   * recomputed aggregate transitions (e.g. degraded → healthy when the
   * sole failing check is paused, which closes the open SLO downtime
   * event via the `HEALTH_ENTITY_KIND` "recovered" transition). Optional so
   * tests can omit it; when absent, pause just flips the flag and the next
   * run / the SLO self-heal converge the rollup lazily.
   */
  recomputeSystemRollupHealth?: (systemId: string) => Promise<void>;
  /**
   * Secrets channel for config credentials (extract-on-write, redact-on-read,
   * blank-keeps-existing on update). Optional only for tests; the real
   * router MUST receive it or writes would store inline secrets verbatim.
   */
  configSecrets?: HealthCheckSecretsDeps;
  /**
   * Reads active incident health overrides and folds them into the two
   * user-facing system-health reads (single + bulk) via worst-wins, so a system
   * shows the status an active incident forces even when its checks look fine.
   * Applied OUTSIDE the status cache (always live, so an override lifts the
   * instant its incident resolves) and ONLY in these RPC handlers - never in the
   * shared `getSystemHealthStatus` deriver, whose other callers (SLO downtime,
   * the AI signals scan, the persisted `health` entity) must stay checks-only.
   * Optional so tests / no-incident deployments simply skip the fold.
   */
  incidentHealthOverrideReader?: SystemHealthOverrideReader;
}) => {
  const {
    database,
    registry,
    collectorRegistry,
    getEmitHook,
    cache,
    configService,
    catalogClient,
    maintenanceClient,
    logger,
    signalService,
    recomputeSystemRollupHealth,
    incidentHealthOverrideReader,
  } = opts;
  // Create service instance once - shared across all handlers
  const service = new HealthCheckService(
    database,
    registry,
    collectorRegistry,
    configService,
    catalogClient,
    opts.configSecrets,
  );

  /**
   * Fold active incident health overrides into a batch of checks-only system
   * statuses via worst-wins. Reads overrides for all systems in ONE incident RPC
   * (or none, when no reader is wired). Resilient by design: incidents are a
   * best-effort enrichment of health, so if the read fails the checks-only
   * statuses are returned unchanged rather than failing the whole health read.
   */
  const foldIncidentOverrides = async (
    statuses: Record<string, SystemHealthStatusResponse>,
  ): Promise<Record<string, SystemHealthStatusResponse>> => {
    const systemIds = Object.keys(statuses);
    if (!incidentHealthOverrideReader || systemIds.length === 0) {
      return statuses;
    }
    let overridesBySystem: Awaited<
      ReturnType<SystemHealthOverrideReader["getActiveOverrides"]>
    >;
    try {
      overridesBySystem =
        await incidentHealthOverrideReader.getActiveOverrides(systemIds);
    } catch (error) {
      logger.warn(
        "Failed to read incident health overrides; returning checks-only status",
        { error: extractErrorMessage(error) },
      );
      return statuses;
    }
    const folded: Record<string, SystemHealthStatusResponse> = {};
    for (const [systemId, base] of Object.entries(statuses)) {
      folded[systemId] = applySystemHealthOverrides({
        base,
        overrides: overridesBySystem[systemId] ?? [],
      });
    }
    return folded;
  };

  // Create contract implementer with context type AND auto auth middleware
  const os = implement(healthCheckContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  const enforceNotGitOpsLocked = async (kind: string, entityId: string) => {
    const provenance = await opts.gitOpsClient.getProvenance({
      kind,
      entityId,
    });
    if (provenance) {
      throw new ORPCError("FORBIDDEN", {
        message: `${kind} is managed by GitOps and cannot be modified manually.`,
      });
    }
  };

  /**
   * Fire the `healthcheck.config.changed` signal so every client's
   * `[[healthcheck]]` cache refreshes after a config/assignment write (the
   * executor's run/status signals only fire once a check actually runs).
   * Best-effort: a signal failure must never fail the mutation.
   */
  const broadcastConfigChanged = async (payload: {
    entity: "configuration" | "assignment";
    action: "created" | "updated" | "deleted";
    configurationId?: string;
    systemId?: string;
  }) => {
    try {
      await signalService?.broadcast(HEALTHCHECK_CONFIG_CHANGED, payload);
    } catch (error) {
      logger.warn(
        `Failed to broadcast healthcheck.config.changed signal: ${extractErrorMessage(error, "unknown")}`,
      );
    }
  };

  /**
   * Post-assignment side effects shared by `associateSystem` and
   * `createAndAssign`: invalidate the system cache, schedule the first run when
   * the assignment is enabled, and emit the `assignmentChanged` hook. Kept in
   * one place so both entry points stay in lock-step and an enabled assignment
   * always starts running immediately.
   */
  const scheduleAndNotifyAssignment = async (args: {
    systemId: string;
    configurationId: string;
    enabled: boolean;
    queueManager: RpcContext["queueManager"];
  }) => {
    await cache.invalidateSystem(args.systemId);

    // If enabling the health check, schedule it immediately so it starts
    // probing right away.
    if (args.enabled) {
      const config = await service.getConfiguration(args.configurationId);
      if (config) {
        const { scheduleHealthCheck } = await import("./queue-executor");
        await scheduleHealthCheck({
          queueManager: args.queueManager,
          payload: {
            configId: config.id,
            systemId: args.systemId,
          },
          intervalSeconds: config.intervalSeconds,
        });
      }
    }

    // Notify subscribers (e.g., satellite-backend) that assignments changed.
    const emitHook = getEmitHook();
    if (emitHook) {
      await emitHook(healthCheckHooks.assignmentChanged, {
        systemId: args.systemId,
        configurationId: args.configurationId,
      });
    }

    // Refresh every client's Health Checks / assignment views.
    await broadcastConfigChanged({
      entity: "assignment",
      action: "updated",
      configurationId: args.configurationId,
      systemId: args.systemId,
    });
  };

  return os.router({
    getStrategies: os.getStrategies.handler(async ({ context }) => {
      return context.healthCheckRegistry.getStrategiesWithMeta().map((r) => ({
        id: r.qualifiedId, // Return fully qualified ID
        displayName: r.strategy.displayName,
        description: r.strategy.description,
        category: (r.strategy.category ?? "other") as StrategyCategory,
        setupInstructions: r.strategy.setupInstructions,
        configSchema: toJsonSchema(r.strategy.config.schema),
        resultSchema: r.strategy.result
          ? toJsonSchemaWithChartMeta(r.strategy.result.schema)
          : undefined,
        aggregatedResultSchema: toJsonSchemaWithChartMeta(
          r.strategy.aggregatedResult.schema,
        ),
      }));
    }),

    getCollectors: os.getCollectors.handler(async ({ input, context }) => {
      // Get strategy to verify it exists
      const strategy = context.healthCheckRegistry.getStrategy(
        input.strategyId,
      );
      if (!strategy) {
        return [];
      }

      // Strategy ID is fully qualified: pluginId.strategyId
      // Extract the plugin ID (everything before the last dot)
      const lastDotIndex = input.strategyId.lastIndexOf(".");
      const pluginId =
        lastDotIndex > 0
          ? input.strategyId.slice(0, lastDotIndex)
          : input.strategyId;

      // Get collectors that support this strategy's plugin
      const registeredCollectors =
        context.collectorRegistry.getCollectorsForPlugin({
          pluginId,
        });

      return registeredCollectors.map(({ qualifiedId, collector }) => ({
        id: qualifiedId,
        displayName: collector.displayName,
        description: collector.description,
        configSchema: toJsonSchema(collector.config.schema),
        resultSchema: toJsonSchemaWithChartMeta(collector.result.schema),
        aggregatedResultSchema: collector.aggregatedResult
          ? toJsonSchemaWithChartMeta(collector.aggregatedResult.schema)
          : undefined,
        allowMultiple: collector.allowMultiple ?? false,
      }));
    }),

    testCollectorScript: os.testCollectorScript.handler(async ({ input }) => {
      // Resolve the managed npm-package root from the local store so a
      // collector test resolves the same allowlisted packages the real
      // collector would (plan §4.1). Filesystem-only; safety is the
      // runner's (auto-install disabled).
      const status = await resolveResolutionRootFromStore(
        resolveScriptPackagesDir(),
      );
      const resolutionRoot =
        status.mode === "ready" ? status.root : undefined;
      return runCollectorScriptTest({ input, deps: { resolutionRoot } });
    }),

    // UI/AI reads are ALWAYS redacted: `x-secret` fields (values, references,
    // internal markers alike) are stripped server-side. The editor renders a
    // blank secret input and blank-on-save means "keep existing".
    getConfigurations: os.getConfigurations.handler(async () => {
      return { configurations: await service.getConfigurationsRedacted() };
    }),

    getConfiguration: os.getConfiguration.handler(async ({ input }) => {
      return service.getConfigurationRedacted(input.id);
    }),

    createConfiguration: os.createConfiguration.handler(async ({ input }) => {
      const created = await service.createConfiguration(input);
      // A new configuration could be associated with any system later; the
      // safe move is to drop every per-system status cache so the next read
      // recomputes from fresh DB state.
      await cache.invalidateAllSystems();
      await broadcastConfigChanged({
        entity: "configuration",
        action: "created",
        configurationId: created.id,
      });
      // The response goes back to the editor: keep it redacted like reads.
      return service.redactConfiguration(created);
    }),

    validateConfiguration: os.validateConfiguration.handler(
      async ({ input, context }) => {
        // Deep validation WITHOUT persisting: resolve the strategy/collectors
        // against the live registries and run the same migrate-then-validate-
        // strict logic the create / gitops-apply path uses, so propose-time
        // errors match apply-time errors. Strategy/collector config (typed
        // `z.record(z.unknown())` on the input) is validated against each
        // registered schema, surfacing wrong types, missing required fields,
        // and unknown keys - not just missing-field presence.
        //
        // For an UPDATE (existingConfigurationId set), restore the stored
        // config's secrets into the proposed body first: reads are redacted,
        // so a kept secret arrives blank/absent and would otherwise fail a
        // required-secret check even though the apply path would preserve it.
        // The restored values are used ONLY to validate and never returned.
        let toValidate = input;
        if (input.existingConfigurationId) {
          const restored = await service.restoreSecretsForValidation({
            existingConfigurationId: input.existingConfigurationId,
            strategyId: input.strategyId,
            config: input.config,
            collectors: input.collectors,
          });
          toValidate = { ...input, ...restored };
        }
        const errors = await collectConfigurationIssues({
          input: toValidate,
          registry: context.healthCheckRegistry,
          collectorRegistry: context.collectorRegistry,
        });
        return { valid: errors.length === 0, errors };
      },
    ),

    updateConfiguration: os.updateConfiguration.handler(async ({ input }) => {
      await enforceNotGitOpsLocked("Healthcheck", input.id);
      const config = await service.updateConfiguration(input.id, input.body);
      if (!config) {
        throw new ORPCError("NOT_FOUND", {
          message: "Configuration not found",
        });
      }
      // Configuration update affects every system that has it associated.
      await cache.invalidateAllSystems();
      await broadcastConfigChanged({
        entity: "configuration",
        action: "updated",
        configurationId: config.id,
      });
      // The response goes back to the editor: keep it redacted like reads.
      return service.redactConfiguration(config);
    }),

    deleteConfiguration: os.deleteConfiguration.handler(async ({ input }) => {
      await enforceNotGitOpsLocked("Healthcheck", input.id);
      await service.deleteConfiguration(input.id);
      await cache.invalidateAllSystems();
      await broadcastConfigChanged({
        entity: "configuration",
        action: "deleted",
        configurationId: input.id,
      });
    }),

    pauseConfiguration: os.pauseConfiguration.handler(async ({ input }) => {
      await enforceNotGitOpsLocked("Healthcheck", input.id);
      await service.pauseConfiguration(input.id);
      await cache.invalidateAllSystems();
      await broadcastConfigChanged({
        entity: "configuration",
        action: "updated",
        configurationId: input.id,
      });

      // Recompute the rollup `health` entity for every system this config
      // is assigned to (enabled assignments only). Because
      // `getSystemHealthStatus` now excludes paused configs, the recomputed
      // rollup may transition degraded → healthy, which emits the
      // `HEALTH_ENTITY_KIND` "recovered" edge the SLO engine consumes to
      // close any open downtime event attributed to this check. If the
      // system stays degraded (other failing checks), no edge fires and
      // the open event correctly persists. Best-effort: a recompute
      // failure is logged inside the helper and never breaks the RPC.
      if (recomputeSystemRollupHealth) {
        try {
          const systemIds =
            await service.getSystemIdsForConfiguration(input.id);
          await Promise.all(
            systemIds.map((systemId) =>
              recomputeSystemRollupHealth(systemId),
            ),
          );
        } catch (error) {
          logger.warn(
            `Failed to recompute rollup health after pausing config ${input.id}: ${extractErrorMessage(error, "unknown")}`,
          );
        }
      }
    }),

    resumeConfiguration: os.resumeConfiguration.handler(async ({ input }) => {
      await enforceNotGitOpsLocked("Healthcheck", input.id);
      await service.resumeConfiguration(input.id);
      await cache.invalidateAllSystems();
      await broadcastConfigChanged({
        entity: "configuration",
        action: "updated",
        configurationId: input.id,
      });
      // Intentionally NO rollup recompute on resume. The check's last
      // in-window run may have been failing, but we don't know whether the
      // underlying condition is still present — only a fresh run can tell.
      // Recomputing now would open a new SLO downtime event based on stale
      // data and then potentially close it on the next successful run,
      // fabricating a brief false-positive downtime. Instead, let the
      // recurring job's next tick drive any degraded transition: if the
      // check still fails, the new unhealthy run recomputes the rollup and
      // the SLO engine opens a fresh downtime event (the previous event was
      // closed on pause, so the idempotent guard in `handleSystemDown`
      // doesn't suppress it). If the check now passes, no event opens.
    }),

    getSystemConfigurations: os.getSystemConfigurations.handler(
      async ({ input }) => {
        // Redacted like every other UI config read - x-secret fields stripped.
        return service.getSystemConfigurationsRedacted(input.systemId);
      },
    ),

    getSystemAssociations: os.getSystemAssociations.handler(
      async ({ input }) => {
        return service.getSystemAssociations(input.systemId);
      },
    ),

    associateSystem: os.associateSystem.handler(async ({ input, context }) => {
      await enforceNotGitOpsLocked("System", input.systemId);
      await service.associateSystem({
        systemId: input.systemId,
        configurationId: input.body.configurationId,
        enabled: input.body.enabled,
        stateThresholds: input.body.stateThresholds,
        satelliteIds: input.body.satelliteIds,
        environmentIds: input.body.environmentIds,
        includeLocal: input.body.includeLocal,
        notificationPolicy: input.body.notificationPolicy,
      });
      await scheduleAndNotifyAssignment({
        systemId: input.systemId,
        configurationId: input.body.configurationId,
        enabled: input.body.enabled,
        queueManager: context.queueManager,
      });
    }),

    createAndAssign: os.createAndAssign.handler(async ({ input, context }) => {
      await enforceNotGitOpsLocked("System", input.systemId);
      // Atomic create + assign in one transaction so the common 1-1 case can
      // never leave a dormant, unassigned check.
      const configuration = await service.createAndAssign({
        configuration: input.configuration,
        systemId: input.systemId,
        enabled: input.enabled,
        stateThresholds: input.stateThresholds,
        satelliteIds: input.satelliteIds,
        environmentIds: input.environmentIds,
        includeLocal: input.includeLocal,
        notificationPolicy: input.notificationPolicy,
      });
      await scheduleAndNotifyAssignment({
        systemId: input.systemId,
        configurationId: configuration.id,
        enabled: input.enabled,
        queueManager: context.queueManager,
      });
      // The response goes back to the caller (wizard / AI tool): redact it
      // like every other config read/write response.
      return service.redactConfiguration(configuration);
    }),

    disassociateSystem: os.disassociateSystem.handler(async ({ input }) => {
      await enforceNotGitOpsLocked("System", input.systemId);
      await service.disassociateSystem(input.systemId, input.configId);
      await cache.invalidateSystem(input.systemId);

      // Notify subscribers that assignments changed
      const emitHook = getEmitHook();
      if (emitHook) {
        await emitHook(healthCheckHooks.assignmentChanged, {
          systemId: input.systemId,
          configurationId: input.configId,
        });
      }

      await broadcastConfigChanged({
        entity: "assignment",
        action: "deleted",
        configurationId: input.configId,
        systemId: input.systemId,
      });
    }),

    getPlatformNotificationDefaults:
      os.getPlatformNotificationDefaults.handler(async () => {
        return service.getPlatformNotificationDefaults();
      }),

    setPlatformNotificationDefaults:
      os.setPlatformNotificationDefaults.handler(async ({ input }) => {
        await service.setPlatformNotificationDefaults(input);
      }),

    getRetentionConfig: os.getRetentionConfig.handler(async ({ input }) => {
      return service.getRetentionConfig(input.systemId, input.configurationId);
    }),

    updateRetentionConfig: os.updateRetentionConfig.handler(
      async ({ input }) => {
        await enforceNotGitOpsLocked("System", input.systemId);
        await service.updateRetentionConfig(
          input.systemId,
          input.configurationId,
          input.retentionConfig,
        );
      },
    ),

    getHistory: os.getHistory.handler(async ({ input }) => {
      return service.getHistory(input);
    }),

    getRunStats: os.getRunStats.handler(async ({ input }) => {
      return service.getRunStats(input);
    }),

    getDetailedHistory: os.getDetailedHistory.handler(
      async ({ input, context }) => {
        // Handler-side authorization (the contract's `access` is deliberately
        // empty - see the contract doc): global `configuration.manage` (or a
        // trusted service) gets the full feed; a team-scoped caller gets the
        // feed filtered to the configurations their teams manage PLUS all
        // runs of the systems they manage (a system's owning team sees every
        // run of that system); everyone else is forbidden. Fail-closed via
        // history-access.ts.
        const user = context.user;
        let accessibleConfigurationIds: string[] = [];
        let accessibleSystemIds: string[] = [];
        if (
          user &&
          (user.type === "user" || user.type === "application") &&
          !hasGlobalHistoryAccess(user)
        ) {
          const configs = await service.getConfigurations();
          [accessibleConfigurationIds, accessibleSystemIds] =
            await Promise.all([
              listTeamManageableConfigurationIds({
                auth: context.auth,
                user,
                allConfigurationIds: configs.map((c) => c.id),
              }),
              listManageableSystemIds({
                auth: context.auth,
                user,
                allSystemIds: await service.getRunSystemIds(),
              }),
            ]);
        }
        const scope = resolveHistoryScope({
          user,
          accessibleConfigurationIds,
          accessibleSystemIds,
        });
        if (scope.kind === "forbidden") {
          throw new ORPCError("FORBIDDEN", {
            message:
              "Run history requires health check manage access (globally, or via a team grant on a configuration or system)",
          });
        }
        if (scope.kind === "all") {
          return service.getDetailedHistory(input);
        }
        return service.getDetailedHistory({
          ...input,
          teamScope: {
            configurationIds: scope.configurationIds,
            systemIds: scope.systemIds,
          },
        });
      },
    ),

    getRunById: os.getRunById.handler(async ({ input, context }) => {
      // Authorized against the FETCHED run's own configuration/system (the
      // anchor cannot be spoofed via input). An unauthorized caller gets the
      // same `undefined` as a missing run, so run ids don't leak existence.
      const run = await service.getRunById({ runId: input.runId });
      if (!run) return;
      const allowed = await canReadRunScope({
        auth: context.auth,
        user: context.user,
        configurationId: run.configurationId,
        systemId: run.systemId,
      });
      if (!allowed) return;
      return run;
    }),

    getAggregatedHistory: os.getAggregatedHistory.handler(async ({ input }) => {
      return service.getAggregatedHistory(input, {
        includeAggregatedResult: false,
      });
    }),

    getDetailedAggregatedHistory: os.getDetailedAggregatedHistory.handler(
      async ({ input, context }) => {
        // Authorized on the (configurationId, systemId) input pair - exactly
        // the slice returned. See the contract doc / history-access.ts.
        const allowed = await canReadRunScope({
          auth: context.auth,
          user: context.user,
          configurationId: input.configurationId,
          systemId: input.systemId,
        });
        if (!allowed) {
          throw new ORPCError("FORBIDDEN", {
            message:
              "Detailed run data requires health check manage access (globally, or via a team grant on this configuration or system)",
          });
        }
        return service.getAggregatedHistory(input, {
          includeAggregatedResult: true,
        });
      },
    ),
    getSystemHealthStatus: os.getSystemHealthStatus.handler(
      async ({ input }) => {
        const base = await cache.wrapSystemHealthStatus(input.systemId, () =>
          service.getSystemHealthStatus(input.systemId),
        );
        const folded = await foldIncidentOverrides({
          [input.systemId]: base,
        });
        return folded[input.systemId]!;
      },
    ),

    getBulkSystemHealthStatus: os.getBulkSystemHealthStatus.handler(
      async ({ input }) => {
        // Per-entity caching: each system's status is cached individually
        // and invalidated by id on mutations, so dashboards with overlapping
        // (but non-identical) system sets share cache entries. See
        // ./cache.ts for the key/TTL/invalidation contract.
        const statuses: Record<string, SystemHealthStatusResponse> = {};
        await Promise.all(
          input.systemIds.map(async (systemId) => {
            statuses[systemId] = await cache.wrapSystemHealthStatus(
              systemId,
              () => service.getSystemHealthStatus(systemId),
            );
          }),
        );
        return { statuses: await foldIncidentOverrides(statuses) };
      },
    ),

    getBulkSystemHealthMatrix: os.getBulkSystemHealthMatrix.handler(
      async ({ input }) => {
        const matrix = await service.getBulkSystemHealthMatrix(input.systemIds);

        // Fold active incident overrides into each system's OVERALL rollup, so
        // an incident-forced status still propagates through dependencies (as
        // it does via getBulkSystemHealthStatus). Per-environment slices track
        // health-check status only - incidents force whole-system health, which
        // any-environment (env=null) dependency cells read from this rollup.
        const overallOnly: Record<string, SystemHealthStatusResponse> = {};
        for (const [systemId, m] of Object.entries(matrix)) {
          overallOnly[systemId] = {
            status: m.status,
            evaluatedAt: new Date(),
            checkStatuses: m.checkStatuses,
          };
        }
        const folded = await foldIncidentOverrides(overallOnly);

        const statuses: Record<string, (typeof matrix)[string]> = {};
        for (const [systemId, m] of Object.entries(matrix)) {
          statuses[systemId] = {
            status: folded[systemId]?.status ?? m.status,
            checkStatuses: m.checkStatuses,
            environments: m.environments,
          };
        }
        return { statuses };
      },
    ),

    getSystemHealthOverview: os.getSystemHealthOverview.handler(
      async ({ input }) => {
        return service.getSystemHealthOverview(input.systemId);
      },
    ),

    getHealthState: os.getHealthState.handler(async ({ input }) => {
      return service.getHealthState({
        systemId: input.systemId,
        configurationId: input.configurationId,
        transitionWindowMinutes: input.transitionWindowMinutes,
        maintenanceClient,
        logger,
      });
    }),

    getBulkHealthState: os.getBulkHealthState.handler(async ({ input }) => {
      const states = await service.getBulkHealthState({
        systemIds: input.systemIds,
        transitionWindowMinutes: input.transitionWindowMinutes,
        maintenanceClient,
        logger,
      });
      return { states };
    }),

    // ========================================================================
    // SERVICE INTERFACE (S2S — satellite-backend)
    // ========================================================================

    getAssignmentsForSatellite: os.getAssignmentsForSatellite.handler(
      async ({ input }) => {
        return service.getAssignmentsForSatellite(input.satelliteId);
      },
    ),

    ingestSatelliteResult: os.ingestSatelliteResult.handler(
      async ({ input }) => {
        await service.ingestSatelliteResult(input);
        // A satellite result writes a new run for this system, so the
        // cached aggregate status is now stale.
        await cache.invalidateSystem(input.systemId);
      },
    ),

    getRunsForAnalysis: os.getRunsForAnalysis.handler(
      async ({ input }) => {
        return service.getRunsForAnalysis(input);
      },
    ),
  });
};

export type HealthCheckRouter = ReturnType<typeof createHealthCheckRouter>;
