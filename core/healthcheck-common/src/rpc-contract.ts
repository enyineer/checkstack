import { createClientDefinition, proc } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";
import { z } from "zod";
import { healthCheckAccess } from "./access";
import {
  HealthCheckStrategyDtoSchema,
  CollectorDtoSchema,
  HealthCheckConfigurationSchema,
  CreateHealthCheckConfigurationSchema,
  UpdateHealthCheckConfigurationSchema,
  ValidateConfigurationInputSchema,
  ValidateConfigurationResultSchema,
  AssociateHealthCheckSchema,
  HealthCheckRunSchema,
  HealthCheckRunPublicSchema,
  HealthCheckStatusSchema,
  HealthCheckRunResultSchema,
  StateThresholdsSchema,
  RetentionConfigSchema,
  AggregatedBucketBaseSchema,
  AggregatedBucketSchema,
  RunStatsSchema,
  NotificationPolicySchema,
} from "./schemas";

// --- Response Schemas for Evaluated Status ---

const SystemCheckStatusSchema = z.object({
  configurationId: z.string(),
  configurationName: z.string(),
  status: HealthCheckStatusSchema,
  runsConsidered: z.number(),
  lastRunAt: z.date().optional(),
});

const SystemHealthStatusResponseSchema = z.object({
  status: HealthCheckStatusSchema,
  evaluatedAt: z.date(),
  checkStatuses: z.array(SystemCheckStatusSchema),
});

export type SystemHealthStatusResponse = z.infer<
  typeof SystemHealthStatusResponseSchema
>;

/**
 * Live health-state snapshot used by the automation sensing layer.
 * Service-typed (backend-to-backend). `inStatusSince` is null when no
 * transition has been recorded; `inStatusForMs` is 0 in that case.
 */
const HealthStateSchema = z.object({
  status: HealthCheckStatusSchema,
  inStatusSince: z.date().nullable(),
  inStatusForMs: z.number(),
  latencyMs: z.number().optional(),
  avgLatencyMs: z.number().optional(),
  p95LatencyMs: z.number().optional(),
  successRate: z.number().optional(),
  lastRunAt: z.date().optional(),
  inMaintenance: z.boolean(),
  /** Count of aggregate status transitions in the trailing window (flapping). */
  transitionsInWindow: z.number(),
  /** The window (minutes) `transitionsInWindow` was counted over. */
  transitionWindowMinutes: z.number(),
  evaluatedAt: z.date(),
});

export type HealthStateResponse = z.infer<typeof HealthStateSchema>;

// --- Collector script testing (in-UI) ---

/**
 * Curated check/system metadata a collector script reads. Every part is
 * optional so a partial sample still runs.
 */
const CollectorTestRunContextSchema = z.object({
  check: z
    .object({
      id: z.string(),
      name: z.string(),
      intervalSeconds: z.number().int(),
    })
    .optional(),
  system: z.object({ id: z.string(), name: z.string() }).optional(),
});

export const CollectorScriptTestInputSchema = z.object({
  kind: z.enum(["typescript", "shell"]),
  script: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  /**
   * The collector's declared secret -> env mapping. The test panel NEVER
   * resolves real secret values: each declared env var gets a
   * `__SECRET_<NAME>__` placeholder by default, or the user override below
   * (decision 4).
   */
  secretEnv: z.record(z.string(), z.string()).optional(),
  /** User-supplied per-secret-NAME override values, masked out of the result. */
  secretOverrides: z.record(z.string(), z.string()).optional(),
  workingDirectory: z.string().optional(),
  runContext: CollectorTestRunContextSchema.optional(),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
});
export type CollectorScriptTestInputDto = z.infer<
  typeof CollectorScriptTestInputSchema
>;

export const CollectorScriptTestResultSchema = z.object({
  result: z.unknown().optional(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  error: z.string().optional(),
});
export type CollectorScriptTestResultDto = z.infer<
  typeof CollectorScriptTestResultSchema
>;

// Health Check RPC Contract using oRPC's contract-first pattern
export const healthCheckContract = {
  // ==========================================================================
  // STRATEGY MANAGEMENT (userType: "authenticated" with read access)
  // ==========================================================================

  getStrategies: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Global utility: lists all strategy types, not scoped to any config or system.
    instanceAccess: { global: true },
  }).output(z.array(HealthCheckStrategyDtoSchema)),

  getCollectors: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Global utility: lists collectors for a strategy type, not scoped to a config instance.
    instanceAccess: { global: true },
  })
    .input(z.object({ strategyId: z.string() }))
    .output(z.array(CollectorDtoSchema)),

  /**
   * Run a collector script (inline-script TS or the shell `script`
   * collector) against an editable sample context, using the same
   * sandboxed runner the real collector uses. Lets operators test a
   * collector script in the editor without scheduling a real execution.
   *
   * Gated by `configuration.manage` because authoring a collector script
   * already executes code on the central backend - same privilege. The
   * run is central-only and time-bounded.
   */
  testCollectorScript: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Global utility: runs a sandboxed script test with no config/system instance to scope on.
    instanceAccess: { global: true },
  })
    .input(CollectorScriptTestInputSchema)
    .output(CollectorScriptTestResultSchema),

  // ==========================================================================
  // CONFIGURATION MANAGEMENT (userType: "authenticated")
  // ==========================================================================

  getConfigurations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // List post-filter: each item has a string `.id` matching the
    // `healthcheck.configuration` grant resourceId.
    instanceAccess: { listKey: "configurations" },
  }).output(
    z.object({ configurations: z.array(HealthCheckConfigurationSchema) }),
  ),

  getConfiguration: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Single-config read scoped by the configuration's own id.
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(HealthCheckConfigurationSchema.optional()),

  createConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Create-mode: an optional requested owning team (`teamId`) lets a
    // team member with a create-capability grant create the config; the
    // middleware writes the owning-team grant for the created `id`.
    instanceAccess: { create: { teamIdParam: "teamId", idField: "id" } },
  })
    // Extend (not mutate the base schema) so `teamId` does NOT leak into
    // Update/Validate inputs, which derive from CreateHealthCheckConfigurationSchema.
    .input(
      CreateHealthCheckConfigurationSchema.extend({
        teamId: z.string().optional(),
      }),
    )
    .output(HealthCheckConfigurationSchema),

  /**
   * Deep-validate a proposed health-check configuration WITHOUT persisting it.
   * Runs the SAME strategy/collector resolution + migrate-then-validate-strict
   * logic the create / gitops-apply path uses, so propose-time errors match
   * apply-time errors. Gated by `configuration.manage` (the privilege the
   * create form requires); the mirror of automation's `validateDefinition`.
   */
  validateConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Global utility: validates a proposed config without persisting; no existing instance id to scope on.
    instanceAccess: { global: true },
  })
    .input(ValidateConfigurationInputSchema)
    .output(ValidateConfigurationResultSchema),

  updateConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Update scoped by the configuration's own id.
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "PATCH" })
    .input(
      z.object({
        id: z.string(),
        body: UpdateHealthCheckConfigurationSchema,
      }),
    )
    .output(HealthCheckConfigurationSchema),

  deleteConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Scoped by the configuration's own id. Input reshaped from a bare
    // `z.string()` to `{ id }` so the middleware can read `input.id`.
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.void()),

  pauseConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(z.void()),

  resumeConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(z.void()),

  // ==========================================================================
  // SYSTEM ASSOCIATION (userType: "authenticated")
  // ==========================================================================

  getSystemConfigurations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Reads all health-check configs associated with a specific system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" } },
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(HealthCheckConfigurationSchema)),

  getSystemAssociations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Reads association details (per-assignment config) for a specific system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" } },
  })
    .input(z.object({ systemId: z.string() }))
    .output(
      z.array(
        z.object({
          configurationId: z.string(),
          configurationName: z.string(),
          enabled: z.boolean(),
          stateThresholds: StateThresholdsSchema.optional(),
          /** IDs of satellites assigned to execute this health check */
          satelliteIds: z.array(z.string()).optional(),
          /**
           * Per-assignment environment selector. null = all current
           * environments; [] = opt out (env-less); non-empty = those ids.
           */
          environmentIds: z.array(z.string()).nullable().optional(),
          /** Whether to also run this check locally on the core (default: true) */
          includeLocal: z.boolean(),
          /** Per-association notification policy (omitted = platform defaults) */
          notificationPolicy: NotificationPolicySchema.optional(),
        }),
      ),
    ),

  associateSystem: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Mutation that adds a check association to a system — requires manage on the system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "manage", idParam: "systemId" } },
  })
    .input(
      z.object({
        systemId: z.string(),
        body: AssociateHealthCheckSchema,
      }),
    )
    .output(z.void()),

  /**
   * Read the platform-wide notification policy defaults. Per-assignment
   * rows with no override inherit these values; admin tooling reads
   * them to populate the defaults editor. Compile-time defaults fill
   * in any unset fields.
   */
  getPlatformNotificationDefaults: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Global utility: platform-wide defaults are not scoped to any config or system instance.
    instanceAccess: { global: true },
  }).output(NotificationPolicySchema),

  /**
   * Update the platform-wide notification policy defaults. Per-
   * assignment rows that inherit (notificationPolicy = null) will pick
   * up the new values on the next read.
   */
  setPlatformNotificationDefaults: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Global utility: updates platform-wide defaults, not scoped to any config or system instance.
    instanceAccess: { global: true },
  })
    .input(NotificationPolicySchema)
    .output(z.void()),

  disassociateSystem: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Mutation that removes a check association from a system — requires manage on the system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "manage", idParam: "systemId" } },
  })
    .input(
      z.object({
        systemId: z.string(),
        configId: z.string(),
      }),
    )
    .output(z.void()),

  // ==========================================================================
  // RETENTION CONFIGURATION (userType: "authenticated" with manage access)
  // ==========================================================================

  getRetentionConfig: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
    // Scoped to the health-check configuration by its own id.
    instanceAccess: { idParam: "configurationId" },
  })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
      }),
    )
    .output(
      z.object({
        retentionConfig: RetentionConfigSchema.nullable(),
      }),
    ),

  updateRetentionConfig: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
    // Scoped to the health-check configuration by its own id.
    instanceAccess: { idParam: "configurationId" },
  })
    .route({ method: "PATCH" })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
        retentionConfig: RetentionConfigSchema.nullable(),
      }),
    )
    .output(z.void()),

  // ==========================================================================
  // HISTORY & STATUS (userType: "public" with read access)
  // ==========================================================================

  getHistory: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    // Both systemId and configurationId are optional — this is a cross-cutting history query
    // with no guaranteed single resource id to scope on; safe global fallback.
    instanceAccess: { global: true },
  })
    .input(
      z.object({
        systemId: z.string().optional(),
        configurationId: z.string().optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        /** Filter by source: "local" = core only, satellite UUID = specific satellite, undefined = all */
        sourceFilter: z.string().optional(),
        /** Restrict runs to the listed statuses. Omitted/empty = no filter. */
        statusFilter: z.array(HealthCheckStatusSchema).optional(),
        limit: z.number().optional().default(10),
        offset: z.number().optional().default(0),
        sortOrder: z.enum(["asc", "desc"]),
      }),
    )
    .output(
      z.object({
        runs: z.array(HealthCheckRunPublicSchema),
        total: z.number(),
      }),
    ),

  getRunStats: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    // Cross-cutting aggregate: systemId/configurationId are optional so it can
    // summarize broadly; no single guaranteed resource id to scope on.
    instanceAccess: { global: true },
  })
    .input(
      z.object({
        systemId: z.string().optional(),
        configurationId: z.string().optional(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        /** Filter by source: "local" = core only, satellite UUID = specific satellite, undefined = all */
        sourceFilter: z.string().optional(),
        /** Restrict the runs counted to the listed statuses. Omitted/empty = all. */
        statusFilter: z.array(HealthCheckStatusSchema).optional(),
        /** Max time-series buckets to return (default 24, max 100). */
        maxBuckets: z.number().min(1).max(100).optional().default(24),
      }),
    )
    .output(RunStatsSchema),

  getDetailedHistory: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.details],
  })
    .input(
      z.object({
        systemId: z.string().optional(),
        configurationId: z.string().optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        /** Filter by source: "local" = core only, satellite UUID = specific satellite, undefined = all */
        sourceFilter: z.string().optional(),
        /** Restrict runs to the listed statuses. Omitted/empty = no filter. */
        statusFilter: z.array(HealthCheckStatusSchema).optional(),
        limit: z.number().optional().default(10),
        offset: z.number().optional().default(0),
        sortOrder: z.enum(["asc", "desc"]),
      }),
    )
    .output(
      z.object({
        runs: z.array(HealthCheckRunSchema),
        total: z.number(),
      }),
    ),

  getRunById: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.details],
  })
    .input(
      z.object({
        runId: z.string(),
      }),
    )
    .output(HealthCheckRunSchema.optional()),

  getAggregatedHistory: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    // Scoped to a specific health-check configuration by its own id.
    instanceAccess: { idParam: "configurationId" },
  })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        /** Target number of data points (default: 500). Bucket interval is calculated as (endDate - startDate) / targetPoints */
        targetPoints: z.number().min(10).max(2000).default(500),
      }),
    )
    .output(
      z.object({
        buckets: z.array(AggregatedBucketBaseSchema),
        /** The calculated bucket interval in seconds */
        bucketIntervalSeconds: z.number(),
      }),
    ),

  getDetailedAggregatedHistory: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.details],
  })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        /** Filter by source: "local" = core only, satellite UUID = specific satellite, undefined = all */
        sourceFilter: z.string().optional(),
        /** Target number of data points (default: 500). Bucket interval is calculated as (endDate - startDate) / targetPoints */
        targetPoints: z.number().min(10).max(2000).default(500),
      }),
    )
    .output(
      z.object({
        buckets: z.array(AggregatedBucketSchema),
        /** The calculated bucket interval in seconds */
        bucketIntervalSeconds: z.number(),
      }),
    ),

  getSystemHealthStatus: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    // Per-system status read scoped to the catalog system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" } },
  })
    .input(z.object({ systemId: z.string() }))
    .output(SystemHealthStatusResponseSchema),

  getBulkSystemHealthStatus: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    instanceAccess: { recordKey: "statuses" },
  })
    .route({ method: "POST" })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        statuses: z.record(z.string(), SystemHealthStatusResponseSchema),
      }),
    ),

  getSystemHealthOverview: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
    // Per-system overview scoped to the catalog system.
    instanceAccess: { parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" } },
  })
    .input(z.object({ systemId: z.string() }))
    .output(
      z.object({
        systemId: z.string(),
        checks: z.array(
          z.object({
            configurationId: z.string(),
            configurationName: z.string(),
            strategyId: z.string(),
            intervalSeconds: z.number(),
            enabled: z.boolean(),
            status: HealthCheckStatusSchema,
            stateThresholds: StateThresholdsSchema.optional(),
            recentRuns: z.array(
              z.object({
                id: z.string(),
                status: HealthCheckStatusSchema,
                timestamp: z.date(),
              }),
            ),
          }),
        ),
      }),
    ),

  // ==========================================================================
  // SERVICE INTERFACE (userType: "service" — backend-to-backend only)
  // Used by satellite-backend to fetch assignments and submit results.
  // ==========================================================================

  getAssignmentsForSatellite: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(z.object({ satelliteId: z.string() }))
    .output(
      z.array(
        z.object({
          configId: z.string(),
          systemId: z.string(),
          strategyId: z.string(),
          config: z.record(z.string(), z.unknown()),
          collectors: z
            .array(
              z.object({
                id: z.string(),
                collectorId: z.string(),
                config: z.record(z.string(), z.unknown()),
                assertions: z
                  .array(
                    z.object({
                      field: z.string(),
                      jsonPath: z.string().optional(),
                      operator: z.string(),
                      value: z.unknown().optional(),
                    }),
                  )
                  .optional(),
              }),
            )
            .optional(),
          intervalSeconds: z.number(),
          configName: z.string().optional(),
          systemName: z.string().optional(),
        }),
      ),
    ),

  ingestSatelliteResult: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        configId: z.string(),
        systemId: z.string(),
        status: HealthCheckStatusSchema,
        latencyMs: z.number().optional(),
        result: HealthCheckRunResultSchema.optional(),
        executedAt: z.string(),
        sourceId: z.string(),
        sourceLabel: z.string(),
      }),
    )
    .output(z.void()),

  /**
   * Live health-state snapshot for a single system (Wave-2 sensing
   * contract). Returns status, in-status duration, latency, windowed
   * metrics, and suppression-agnostic maintenance state.
   */
  getHealthState: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string().optional(),
        /** Trailing window (minutes) for `transitionsInWindow`. Default 60. */
        transitionWindowMinutes: z.number().int().min(1).optional(),
      }),
    )
    .output(HealthStateSchema),

  /**
   * Bulk variant of {@link getHealthState}. POST to avoid N+1 from
   * dashboards and multi-system automation rules; all systems share one
   * evaluation timestamp.
   */
  getBulkHealthState: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .route({ method: "POST" })
    .input(
      z.object({
        systemIds: z.array(z.string()),
        /** Trailing window (minutes) for `transitionsInWindow`. Default 60. */
        transitionWindowMinutes: z.number().int().min(1).optional(),
      }),
    )
    .output(z.object({ states: z.record(z.string(), HealthStateSchema) })),

  getRunsForAnalysis: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        startDate: z.coerce.date(),
        limitPerAssignment: z.number().optional().default(200),
      }),
    )
    .output(
      z.array(
        z.object({
          systemId: z.string(),
          configurationId: z.string(),
          runs: z.array(
            z.object({
              result: z.record(z.string(), z.unknown()).nullable().optional(),
            }),
          ),
        }),
      ),
    ),
};
// Export contract type
export type HealthCheckContract = typeof healthCheckContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(HealthCheckApi);
export const HealthCheckApi = createClientDefinition(
  healthCheckContract,
  pluginMetadata,
);
