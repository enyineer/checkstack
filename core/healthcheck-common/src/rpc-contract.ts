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
  StateThresholdsSchema,
  RetentionConfigSchema,
  AggregatedBucketBaseSchema,
  AggregatedBucketSchema,
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
    .input(z.string())
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

  getAvailabilityStats: proc({
    operationType: "query",
    userType: "public",
    access: [healthCheckAccess.status],
  })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
      }),
    )
    .output(
      z.object({
        availability31Days: z.number().nullable(),
        availability365Days: z.number().nullable(),
        totalRuns31Days: z.number(),
        totalRuns365Days: z.number(),
      }),
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
