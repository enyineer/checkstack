import { z } from "zod";

// --- API Request/Response Schemas (Zod) ---

export const HealthCheckStrategyDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  configSchema: z.record(z.string(), z.unknown()),
});

export const HealthCheckConfigurationSchema = z.object({
  id: z.string(),
  name: z.string(),
  strategyId: z.string(),
  config: z.record(z.string(), z.unknown()),
  intervalSeconds: z.number(),
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

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

export const GetHealthCheckHistoryQuerySchema = z.object({
  systemId: z.string().uuid().optional(),
  configurationId: z.string().uuid().optional(),
  limit: z.number().optional(),
});

export const HealthCheckRunSchema = z.object({
  id: z.string(),
  configurationId: z.string(),
  systemId: z.string(),
  status: z.enum(["healthy", "unhealthy", "degraded"]),
  result: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
});
