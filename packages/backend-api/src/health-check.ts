import { z } from "zod";

export interface HealthCheckResult {
  status: "healthy" | "unhealthy" | "degraded";
  latency?: number; // ms
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface HealthCheckStrategy<Config = unknown> {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configSchema: z.ZodType<Config, any, any>; // Validation schema for the strategy-specific config
  execute(config: Config): Promise<HealthCheckResult>;
}

export interface HealthCheckRegistry {
  register(strategy: HealthCheckStrategy<unknown>): void;
  getStrategy(id: string): HealthCheckStrategy<unknown> | undefined;
  getStrategies(): HealthCheckStrategy<unknown>[];
}
