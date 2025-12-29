export * from "./permissions";
export * from "./schemas";

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

export * from "./rpc-contract";
