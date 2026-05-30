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
 * Reports the satellite's script-package reconcile state back to the core,
 * which persists it in `script_package_satellite_state` for the admin UI.
 * Sent after a reconcile attempt (success or failure).
 */
const ScriptPackageSyncStateMessageSchema = z.object({
  type: z.literal("script_package_sync_state"),
  /** Active lockfile hash this satellite has materialized, or null. */
  lockfileHash: z.string().nullable(),
  /** "pending" | "syncing" | "ready" | "error" */
  status: z.enum(["pending", "syncing", "ready", "error"]),
  errorMessage: z.string().optional(),
});

/**
 * Satellite -> core request for the manifest of a lockfile hash, so the
 * satellite can diff against its local cache. The core replies with a
 * `script_package_manifest` message. Delivered over the existing
 * authenticated WS channel (no separate satellite HTTP auth surface).
 */
const RequestScriptPackageManifestMessageSchema = z.object({
  type: z.literal("request_script_package_manifest"),
  lockfileHash: z.string(),
});

/**
 * Satellite -> core request for one content-addressed blob by integrity.
 * The core replies with a `script_package_blob` message (base64 bytes).
 */
const RequestScriptPackageBlobMessageSchema = z.object({
  type: z.literal("request_script_package_blob"),
  integrity: z.string(),
});

/**
 * Discriminated union of all messages that a satellite can send to the core.
 */
export const SatelliteToCoreMessageSchema = z.discriminatedUnion("type", [
  AuthenticateMessageSchema,
  HeartbeatMessageSchema,
  ResultMessageSchema,
  StrategyErrorMessageSchema,
  ScriptPackageSyncStateMessageSchema,
  RequestScriptPackageManifestMessageSchema,
  RequestScriptPackageBlobMessageSchema,
]);

export type SatelliteToCoreMessage = z.infer<
  typeof SatelliteToCoreMessageSchema
>;

// Re-export individual message types for use in handler type narrowing
export type AuthenticateMessage = z.infer<typeof AuthenticateMessageSchema>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;
export type ResultMessage = z.infer<typeof ResultMessageSchema>;
export type StrategyErrorMessage = z.infer<typeof StrategyErrorMessageSchema>;
export type ScriptPackageSyncStateMessage = z.infer<
  typeof ScriptPackageSyncStateMessageSchema
>;
export type RequestScriptPackageManifestMessage = z.infer<
  typeof RequestScriptPackageManifestMessageSchema
>;
export type RequestScriptPackageBlobMessage = z.infer<
  typeof RequestScriptPackageBlobMessageSchema
>;

// =============================================================================
// CORE → SATELLITE MESSAGES
// =============================================================================

const AuthenticatedMessageSchema = z.object({
  type: z.literal("authenticated"),
  satelliteId: z.string(),
  assignments: z.array(SatelliteAssignmentSchema),
  /**
   * Desired script-package lockfile hash. Carried alongside assignments as
   * the durable convergence backstop: a satellite that booted after (or
   * missed) a `refresh_script_packages` push still converges on connect.
   * Optional for version-skew safety; null means "no packages installed".
   */
  scriptPackagesLockfileHash: z.string().nullable().optional(),
});

const AuthFailedMessageSchema = z.object({
  type: z.literal("auth_failed"),
  reason: z.string(),
});

const ConfigUpdatedMessageSchema = z.object({
  type: z.literal("config_updated"),
  assignments: z.array(SatelliteAssignmentSchema),
  /** See {@link AuthenticatedMessageSchema.scriptPackagesLockfileHash}. */
  scriptPackagesLockfileHash: z.string().nullable().optional(),
});

const ShutdownMessageSchema = z.object({
  type: z.literal("shutdown"),
  reason: z.string(),
});

/**
 * Control push telling the satellite to reconcile its script packages to a
 * new lockfile hash. Sent by each core instance's `script-packages.changed`
 * broadcast handler to its currently-connected satellites. Best-effort
 * liveness; the assignment-carried `scriptPackagesLockfileHash` is the
 * durable backstop.
 */
const RefreshScriptPackagesMessageSchema = z.object({
  type: z.literal("refresh_script_packages"),
  lockfileHash: z.string(),
});

/** One resolved package in a manifest reply. */
const ManifestEntryWireSchema = z.object({
  name: z.string(),
  version: z.string(),
  integrity: z.string(),
});

/** Core reply to `request_script_package_manifest`. */
const ScriptPackageManifestMessageSchema = z.object({
  type: z.literal("script_package_manifest"),
  lockfileHash: z.string(),
  entries: z.array(ManifestEntryWireSchema),
});

/** Core reply to `request_script_package_blob` (base64 compressed bytes). */
const ScriptPackageBlobMessageSchema = z.object({
  type: z.literal("script_package_blob"),
  integrity: z.string(),
  /** base64-encoded compressed blob bytes, or null if not found. */
  data: z.string().nullable(),
});

/**
 * Discriminated union of all messages that the core can send to a satellite.
 */
export const CoreToSatelliteMessageSchema = z.discriminatedUnion("type", [
  AuthenticatedMessageSchema,
  AuthFailedMessageSchema,
  ConfigUpdatedMessageSchema,
  ShutdownMessageSchema,
  RefreshScriptPackagesMessageSchema,
  ScriptPackageManifestMessageSchema,
  ScriptPackageBlobMessageSchema,
]);

export type CoreToSatelliteMessage = z.infer<
  typeof CoreToSatelliteMessageSchema
>;

// Re-export individual message types
export type AuthenticatedMessage = z.infer<typeof AuthenticatedMessageSchema>;
export type AuthFailedMessage = z.infer<typeof AuthFailedMessageSchema>;
export type ConfigUpdatedMessage = z.infer<typeof ConfigUpdatedMessageSchema>;
export type ShutdownMessage = z.infer<typeof ShutdownMessageSchema>;
export type RefreshScriptPackagesMessage = z.infer<
  typeof RefreshScriptPackagesMessageSchema
>;
export type ScriptPackageManifestMessage = z.infer<
  typeof ScriptPackageManifestMessageSchema
>;
export type ScriptPackageBlobMessage = z.infer<
  typeof ScriptPackageBlobMessageSchema
>;
