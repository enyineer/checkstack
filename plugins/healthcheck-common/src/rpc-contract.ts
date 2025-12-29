import { oc } from "@orpc/contract";
import { z } from "zod";
import { permissions } from "./permissions";
import {
  HealthCheckStrategyDtoSchema,
  HealthCheckConfigurationSchema,
  CreateHealthCheckConfigurationSchema,
  UpdateHealthCheckConfigurationSchema,
  AssociateHealthCheckSchema,
  HealthCheckRunSchema,
} from "./schemas";

// Permission metadata type
export interface HealthCheckMetadata {
  permissions?: string[];
}

// Base builder with metadata support
const _base = oc.$meta<HealthCheckMetadata>({});

// Health Check RPC Contract using oRPC's contract-first pattern
export const healthCheckContract = {
  // Strategy management - Read permission
  getStrategies: _base
    .meta({ permissions: [permissions.healthCheckRead.id] })
    .output(z.array(HealthCheckStrategyDtoSchema)),

  // Configuration management - Read permission for list, Manage for mutations
  getConfigurations: _base
    .meta({ permissions: [permissions.healthCheckRead.id] })
    .output(z.array(HealthCheckConfigurationSchema)),

  createConfiguration: _base
    .meta({ permissions: [permissions.healthCheckManage.id] })
    .input(CreateHealthCheckConfigurationSchema)
    .output(HealthCheckConfigurationSchema),

  updateConfiguration: _base
    .meta({ permissions: [permissions.healthCheckManage.id] })
    .input(
      z.object({
        id: z.string(),
        body: UpdateHealthCheckConfigurationSchema,
      })
    )
    .output(HealthCheckConfigurationSchema),

  deleteConfiguration: _base
    .meta({ permissions: [permissions.healthCheckManage.id] })
    .input(z.string())
    .output(z.void()),

  // System association - Read permission for get, Manage for mutations
  getSystemConfigurations: _base
    .meta({ permissions: [permissions.healthCheckRead.id] })
    .input(z.string())
    .output(z.array(HealthCheckConfigurationSchema)),

  associateSystem: _base
    .meta({ permissions: [permissions.healthCheckManage.id] })
    .input(
      z.object({
        systemId: z.string(),
        body: AssociateHealthCheckSchema,
      })
    )
    .output(z.void()),

  disassociateSystem: _base
    .meta({ permissions: [permissions.healthCheckManage.id] })
    .input(
      z.object({
        systemId: z.string(),
        configId: z.string(),
      })
    )
    .output(z.void()),

  // History - Read permission
  getHistory: _base
    .meta({ permissions: [permissions.healthCheckRead.id] })
    .input(
      z.object({
        systemId: z.string().optional(),
        configurationId: z.string().optional(),
        limit: z.number().optional(),
      })
    )
    .output(z.array(HealthCheckRunSchema)),
};

// Export contract type for frontend
export type HealthCheckContract = typeof healthCheckContract;
