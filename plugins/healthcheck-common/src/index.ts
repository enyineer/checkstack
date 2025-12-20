import { z } from "zod";
import type { Permission } from "@checkmate/common";

// --- Permissions ---

export const permissions = {
  healthCheckRead: {
    id: "healthcheck.read",
    description: "Read Health Check Configurations and Status",
  },
  healthCheckCreate: {
    id: "healthcheck.create",
    description: "Create Health Check Configurations",
  },
  healthCheckUpdate: {
    id: "healthcheck.update",
    description: "Update Health Check Configurations",
  },
  healthCheckDelete: {
    id: "healthcheck.delete",
    description: "Delete Health Check Configurations",
  },
} satisfies Record<string, Permission>;

export const permissionList = Object.values(permissions);

// --- DTOs for API Responses ---

/**
 * Represents a Health Check Strategy available in the system.
 */
export interface HealthCheckStrategyDto {
  id: string;
  displayName: string;
  description?: string;
  // schema is a JSON schema object derived from the Zod schema
  configSchema: Record<string, unknown>;
}

/**
 * Represents a Health Check Configuration (the check definition/template).
 */
export interface HealthCheckConfiguration {
  id: string;
  name: string;
  strategyId: string;
  config: Record<string, unknown>;
  intervalSeconds: number;
}
export interface HealthCheckRun {
  id: string;
  configurationId: string;
  systemId: string;
  status: "healthy" | "unhealthy" | "degraded";
  result: Record<string, unknown>;
  timestamp: string;
}

// --- API Request/Response Schemas (Zod) ---

export const CreateHealthCheckConfigurationSchema = z.object({
  name: z.string().min(1),
  strategyId: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  intervalSeconds: z.number().min(1),
});

export type CreateHealthCheckConfiguration = z.infer<
  typeof CreateHealthCheckConfigurationSchema
>;

export const UpdateHealthCheckConfigurationSchema =
  CreateHealthCheckConfigurationSchema.partial();

export type UpdateHealthCheckConfiguration = z.infer<
  typeof UpdateHealthCheckConfigurationSchema
>;

export const AssociateHealthCheckSchema = z.object({
  configurationId: z.string().uuid(),
  enabled: z.boolean().default(true),
});

export type AssociateHealthCheck = z.infer<typeof AssociateHealthCheckSchema>;
