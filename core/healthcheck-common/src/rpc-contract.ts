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
  AssociateHealthCheckSchema,
  HealthCheckRunSchema,
  HealthCheckRunPublicSchema,
  HealthCheckStatusSchema,
  HealthCheckRunResultSchema,
  StateThresholdsSchema,
  RetentionConfigSchema,
  AggregatedBucketBaseSchema,
  AggregatedBucketSchema,
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

// Health Check RPC Contract using oRPC's contract-first pattern
export const healthCheckContract = {
  // ==========================================================================
  // STRATEGY MANAGEMENT (userType: "authenticated" with read access)
  // ==========================================================================

  getStrategies: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
  }).output(z.array(HealthCheckStrategyDtoSchema)),

  getCollectors: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
  })
    .input(z.object({ strategyId: z.string() }))
    .output(z.array(CollectorDtoSchema)),

  // ==========================================================================
  // CONFIGURATION MANAGEMENT (userType: "authenticated")
  // ==========================================================================

  getConfigurations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
  }).output(
    z.object({ configurations: z.array(HealthCheckConfigurationSchema) }),
  ),

  getConfiguration: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
  })
    .input(z.object({ id: z.string() }))
    .output(HealthCheckConfigurationSchema.optional()),

  createConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
  })
    .input(CreateHealthCheckConfigurationSchema)
    .output(HealthCheckConfigurationSchema),

  updateConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
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
  })
    .route({ method: "DELETE" })
    .input(z.string())
    .output(z.void()),

  pauseConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
  })
    .input(z.string())
    .output(z.void()),

  resumeConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
  })
    .input(z.string())
    .output(z.void()),

  // ==========================================================================
  // SYSTEM ASSOCIATION (userType: "authenticated")
  // ==========================================================================

  getSystemConfigurations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(HealthCheckConfigurationSchema)),

  getSystemAssociations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.read],
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
  })
    .input(NotificationPolicySchema)
    .output(z.void()),

  disassociateSystem: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [healthCheckAccess.configuration.manage],
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
  })
    .input(
      z.object({
        systemId: z.string().optional(),
        configurationId: z.string().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
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

  getDetailedHistory: proc({
    operationType: "query",
    userType: "authenticated",
    access: [healthCheckAccess.details],
  })
    .input(
      z.object({
        systemId: z.string().optional(),
        configurationId: z.string().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
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
  })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
        startDate: z.date(),
        endDate: z.date(),
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
        startDate: z.date(),
        endDate: z.date(),
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
        startDate: z.date(),
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

  /**
   * Every (system, configuration) assignment with its effective
   * notification policy. Service-typed; the automation platform's
   * auto-incident migration reads this to seed per-system default
   * automations whose thresholds mirror each policy 1:1.
   */
  listAutoIncidentPolicies: proc({
    operationType: "query",
    userType: "service",
    access: [],
  }).output(
    z.array(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
        configurationName: z.string(),
        policy: NotificationPolicySchema,
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
