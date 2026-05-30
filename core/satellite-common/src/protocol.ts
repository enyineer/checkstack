import { z } from "zod";
import {
  HealthCheckStatusSchema,
  HealthCheckRunResultSchema,
} from "@checkstack/healthcheck-common";

// =============================================================================
// SATELLITE ASSIGNMENT (Core → Satellite configuration payload)
// =============================================================================

/**
 * A single collector configuration sent to the satellite for execution.
 */
const SatelliteCollectorConfigSchema = z.object({
  id: z.string(),
  collectorId: z.string(),
  config: z.record(z.string(), z.unknown()),
  assertions: z
    .array(
      z.object({
        field: z.string(),
        jsonPath: z.string().optional(),
        operator: z.string(),
        value: z.unknown().optional(),
      }),
    )
    .optional(),
});

/**
 * A health check assignment sent from the core to a satellite.
 * Contains everything the satellite needs to execute the check.
 */
export const SatelliteAssignmentSchema = z.object({
  configId: z.string(),
  systemId: z.string(),
  strategyId: z.string(),
  config: z.record(z.string(), z.unknown()),
  collectors: z.array(SatelliteCollectorConfigSchema).optional(),
  intervalSeconds: z.number(),
  /** Curated run-context metadata. Optional for version-skew safety. */
  configName: z.string().optional(),
  systemName: z.string().optional(),
});

export type SatelliteAssignment = z.infer<typeof SatelliteAssignmentSchema>;

// =============================================================================
// SATELLITE → CORE MESSAGES
// =============================================================================

const AuthenticateMessageSchema = z.object({
  type: z.literal("authenticate"),
  clientId: z.string(),
  token: z.string(),
});

const HeartbeatMessageSchema = z.object({
  type: z.literal("heartbeat"),
  version: z.string(),
  uptimeSeconds: z.number(),
});

const ResultMessageSchema = z.object({
  type: z.literal("result"),
  configId: z.string(),
  systemId: z.string(),
  status: HealthCheckStatusSchema,
  latencyMs: z.number().optional(),
  /** Structured run result — typed to enforce parity with the local executor */
  result: HealthCheckRunResultSchema.optional(),
  executedAt: z.string(),
});

const StrategyErrorMessageSchema = z.object({
  type: z.literal("strategy_error"),
  strategyId: z.string(),
  message: z.string(),
});

/**
 * Discriminated union of all messages that a satellite can send to the core.
 */
export const SatelliteToCoreMessageSchema = z.discriminatedUnion("type", [
  AuthenticateMessageSchema,
  HeartbeatMessageSchema,
  ResultMessageSchema,
  StrategyErrorMessageSchema,
]);

export type SatelliteToCoreMessage = z.infer<
  typeof SatelliteToCoreMessageSchema
>;

// Re-export individual message types for use in handler type narrowing
export type AuthenticateMessage = z.infer<typeof AuthenticateMessageSchema>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;
export type ResultMessage = z.infer<typeof ResultMessageSchema>;
export type StrategyErrorMessage = z.infer<typeof StrategyErrorMessageSchema>;

// =============================================================================
// CORE → SATELLITE MESSAGES
// =============================================================================

const AuthenticatedMessageSchema = z.object({
  type: z.literal("authenticated"),
  satelliteId: z.string(),
  assignments: z.array(SatelliteAssignmentSchema),
});

const AuthFailedMessageSchema = z.object({
  type: z.literal("auth_failed"),
  reason: z.string(),
});

const ConfigUpdatedMessageSchema = z.object({
  type: z.literal("config_updated"),
  assignments: z.array(SatelliteAssignmentSchema),
});

const ShutdownMessageSchema = z.object({
  type: z.literal("shutdown"),
  reason: z.string(),
});

/**
 * Discriminated union of all messages that the core can send to a satellite.
 */
export const CoreToSatelliteMessageSchema = z.discriminatedUnion("type", [
  AuthenticatedMessageSchema,
  AuthFailedMessageSchema,
  ConfigUpdatedMessageSchema,
  ShutdownMessageSchema,
]);

export type CoreToSatelliteMessage = z.infer<
  typeof CoreToSatelliteMessageSchema
>;

// Re-export individual message types
export type AuthenticatedMessage = z.infer<typeof AuthenticatedMessageSchema>;
export type AuthFailedMessage = z.infer<typeof AuthFailedMessageSchema>;
export type ConfigUpdatedMessage = z.infer<typeof ConfigUpdatedMessageSchema>;
export type ShutdownMessage = z.infer<typeof ShutdownMessageSchema>;
