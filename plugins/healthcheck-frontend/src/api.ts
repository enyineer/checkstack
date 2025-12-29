import { createApiRef } from "@checkmate/frontend-api";
import type { HealthCheckRpcContract } from "@checkmate/healthcheck-common";

// Re-export types for convenience
export type {
  HealthCheckConfiguration,
  CreateHealthCheckConfiguration,
  UpdateHealthCheckConfiguration,
  HealthCheckStrategyDto,
  AssociateHealthCheck,
  HealthCheckRun,
} from "@checkmate/healthcheck-common";

// HealthCheckApi is just an alias to the RPC contract
export type HealthCheckApi = HealthCheckRpcContract;

export const healthCheckApiRef =
  createApiRef<HealthCheckApi>("healthcheck-api");
