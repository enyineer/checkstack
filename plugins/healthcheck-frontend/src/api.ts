import { createApiRef } from "@checkmate/frontend-api";
import type { ContractRouterClient } from "@orpc/contract";
import { healthCheckContract } from "@checkmate/healthcheck-common";

// Re-export types for convenience
export type {
  HealthCheckConfiguration,
  HealthCheckStrategyDto,
  HealthCheckRun,
} from "@checkmate/healthcheck-common";

// HealthCheckApi is the client type derived from the contract
export type HealthCheckApi = ContractRouterClient<typeof healthCheckContract>;

export const healthCheckApiRef =
  createApiRef<HealthCheckApi>("healthcheck-api");
