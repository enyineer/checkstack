import { z } from "zod";
import { MigrationChain } from "@checkmate/queue-api";

export interface HealthCheckResult {
  status: "healthy" | "unhealthy" | "degraded";
  latency?: number; // ms
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface HealthCheckStrategy<Config = unknown> {
  id: string;
  displayName: string;
  description?: string;

  /** Current version of the configuration schema */
  configVersion: number;

  /** Validation schema for the strategy-specific config */
  configSchema: z.ZodType<Config>;

  /** Optional migrations for backward compatibility */
  migrations?: MigrationChain<Config>;

  execute(config: Config): Promise<HealthCheckResult>;
}

export interface HealthCheckRegistry {
  register(strategy: HealthCheckStrategy<unknown>): void;
  getStrategy(id: string): HealthCheckStrategy<unknown> | undefined;
  getStrategies(): HealthCheckStrategy<unknown>[];
}
