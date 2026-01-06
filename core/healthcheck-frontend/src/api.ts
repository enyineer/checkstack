import { createApiRef } from "@checkmate-monitor/frontend-api";
import { HealthCheckApi } from "@checkmate-monitor/healthcheck-common";
import type { InferClient } from "@checkmate-monitor/common";

// Re-export types for convenience
export type {
  HealthCheckConfiguration,
  HealthCheckStrategyDto,
  HealthCheckRun,
  HealthCheckRunPublic,
} from "@checkmate-monitor/healthcheck-common";

// HealthCheckApiClient type inferred from the client definition
export type HealthCheckApiClient = InferClient<typeof HealthCheckApi>;

export const healthCheckApiRef =
  createApiRef<HealthCheckApiClient>("healthcheck-api");
