import { oc } from "@orpc/contract";
import {
  createClientDefinition,
  type ProcedureMetadata,
} from "@checkmate-monitor/common";
import { pluginMetadata } from "./plugin-metadata";
import { z } from "zod";
import { permissions } from "./permissions";
import {
  HealthCheckStrategyDtoSchema,
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

// Base builder with full metadata support
const _base = oc.$meta<ProcedureMetadata>({});

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

// Health Check RPC Contract using oRPC's contract-first pattern
export const healthCheckContract = {
  // ==========================================================================
  // STRATEGY MANAGEMENT (userType: "authenticated" with read permission)
  // ==========================================================================

  getStrategies: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckRead.id],
    })
    .output(z.array(HealthCheckStrategyDtoSchema)),

  // ==========================================================================
  // CONFIGURATION MANAGEMENT (userType: "authenticated")
  // ==========================================================================

  getConfigurations: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckRead.id],
    })
    .output(z.array(HealthCheckConfigurationSchema)),

  createConfiguration: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckManage.id],
    })
    .input(CreateHealthCheckConfigurationSchema)
    .output(HealthCheckConfigurationSchema),

  updateConfiguration: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckManage.id],
    })
    .input(
      z.object({
        id: z.string(),
        body: UpdateHealthCheckConfigurationSchema,
      })
    )
    .output(HealthCheckConfigurationSchema),

  deleteConfiguration: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckManage.id],
    })
    .input(z.string())
    .output(z.void()),

  // ==========================================================================
  // SYSTEM ASSOCIATION (userType: "authenticated")
  // ==========================================================================

  getSystemConfigurations: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckRead.id],
    })
    .input(z.string())
    .output(z.array(HealthCheckConfigurationSchema)),

  /**
   * Get system associations with their threshold configurations.
   * Returns full association data including enabled state and thresholds.
   */
  getSystemAssociations: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckRead.id],
    })
    .input(z.object({ systemId: z.string() }))
    .output(
      z.array(
        z.object({
          configurationId: z.string(),
          configurationName: z.string(),
          enabled: z.boolean(),
          stateThresholds: StateThresholdsSchema.optional(),
        })
      )
    ),

  associateSystem: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckManage.id],
    })
    .input(
      z.object({
        systemId: z.string(),
        body: AssociateHealthCheckSchema,
      })
    )
    .output(z.void()),

  disassociateSystem: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckManage.id],
    })
    .input(
      z.object({
        systemId: z.string(),
        configId: z.string(),
      })
    )
    .output(z.void()),

  // ==========================================================================
  // RETENTION CONFIGURATION (userType: "authenticated" with manage permission)
  // ==========================================================================

  getRetentionConfig: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckRead.id],
    })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
      })
    )
    .output(
      z.object({
        retentionConfig: RetentionConfigSchema.nullable(),
      })
    ),

  updateRetentionConfig: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckManage.id],
    })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
        retentionConfig: RetentionConfigSchema.nullable(),
      })
    )
    .output(z.void()),

  // ==========================================================================
  // HISTORY & STATUS (userType: "user" with read permission)
  // ==========================================================================

  getHistory: _base
    .meta({
      userType: "public",
      permissions: [permissions.healthCheckStatusRead.id],
    })
    .input(
      z.object({
        systemId: z.string().optional(),
        configurationId: z.string().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        limit: z.number().optional().default(10),
        offset: z.number().optional().default(0),
      })
    )
    .output(
      z.object({
        runs: z.array(HealthCheckRunPublicSchema),
        total: z.number(),
      })
    ),

  /**
   * Get detailed health check run history with full result data.
   * Requires permission to view detailed run data including metadata.
   */
  getDetailedHistory: _base
    .meta({
      userType: "authenticated",
      permissions: [permissions.healthCheckDetailsRead.id],
    })
    .input(
      z.object({
        systemId: z.string().optional(),
        configurationId: z.string().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        limit: z.number().optional().default(10),
        offset: z.number().optional().default(0),
      })
    )
    .output(
      z.object({
        runs: z.array(HealthCheckRunSchema),
        total: z.number(),
      })
    ),

  /**
   * Get aggregated health check history for long-term analysis.
   * Returns pre-computed buckets with core metrics only (no strategy-specific data).
   * For strategy-specific aggregated results, use getDetailedAggregatedHistory.
   */
  getAggregatedHistory: _base
    .meta({
      userType: "public",
      permissions: [permissions.healthCheckStatusRead.id],
    })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
        startDate: z.date(),
        endDate: z.date(),
        bucketSize: z.enum(["hourly", "daily", "auto"]),
      })
    )
    .output(
      z.object({
        buckets: z.array(AggregatedBucketBaseSchema),
      })
    ),

  /**
   * Get detailed aggregated health check history including strategy-specific data.
   * Returns buckets with core metrics AND aggregatedResult from strategy.
   * Requires healthCheckDetailsRead permission.
   */
  getDetailedAggregatedHistory: _base
    .meta({
      userType: "public",
      permissions: [permissions.healthCheckDetailsRead.id],
    })
    .input(
      z.object({
        systemId: z.string(),
        configurationId: z.string(),
        startDate: z.date(),
        endDate: z.date(),
        bucketSize: z.enum(["hourly", "daily", "auto"]),
      })
    )
    .output(
      z.object({
        buckets: z.array(AggregatedBucketSchema),
      })
    ),

  /**
   * Get evaluateted health status for a system based on configured thresholds.
   * Aggregates all health check statuses for the system.
   */
  getSystemHealthStatus: _base
    .meta({
      userType: "public",
      permissions: [permissions.healthCheckStatusRead.id],
    })
    .input(z.object({ systemId: z.string() }))
    .output(SystemHealthStatusResponseSchema),

  /**
   * Get comprehensive health overview for a system.
   * Returns all health checks with their last 25 runs for sparkline visualization.
   */
  getSystemHealthOverview: _base
    .meta({
      userType: "public",
      permissions: [permissions.healthCheckStatusRead.id],
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
              })
            ),
          })
        ),
      })
    ),
};

// Export contract type
export type HealthCheckContract = typeof healthCheckContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(HealthCheckApi);
export const HealthCheckApi = createClientDefinition(
  healthCheckContract,
  pluginMetadata
);
