export * from "./permissions";
export * from "./schemas";
export * from "./zod-health-result";

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
 * NOTE: This is derived from Zod schema but kept as interface for explicit type documentation.
 */
export interface HealthCheckConfiguration {
  id: string;
  name: string;
  strategyId: string;
  config: Record<string, unknown>;
  intervalSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

// HealthCheckRun and HealthCheckStatus types are now exported from ./schemas

export * from "./rpc-contract";
export * from "./plugin-metadata";
export { healthcheckRoutes } from "./routes";

// =============================================================================
// REALTIME SIGNALS
// =============================================================================

import { createSignal } from "@checkmate-monitor/signal-common";
import { z } from "zod";

/**
 * Broadcast when a health check run completes and status potentially changes.
 * Frontend components listening to this signal can refetch state for the affected system.
 */
export const HEALTH_CHECK_STATE_CHANGED = createSignal(
  "healthcheck.state.changed",
  z.object({
    systemId: z.string(),
    configurationId: z.string(),
    status: z.enum(["healthy", "degraded", "unhealthy"]),
  })
);
