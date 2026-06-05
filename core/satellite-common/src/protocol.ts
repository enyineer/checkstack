import { z } from "zod";
import {
  HealthCheckStatusSchema,
  HealthCheckRunResultSchema,
} from "@checkstack/healthcheck-common";
import { sandboxPolicySchema } from "@checkstack/common";

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
 * Satellite -> core just-in-time request for a collector run's resolved
 * secret env, sent right before the satellite executes a collector that
 * declares a `secretEnv` mapping. The core resolves ONLY that collector's
 * declared `secretEnv` (read from the persisted assignment — the satellite
 * does not get to choose which secrets), and replies with a `run_secrets`
 * message carrying the env map (or an error).
 *
 * Secrets NEVER ride the persisted assignment payload; they are delivered
 * over this authenticated channel per-run and held in satellite memory only
 * for the lifetime of the run. `requestId` correlates the reply (a config
 * can run repeatedly; `runId` is for logging/audit).
 */
const RequestRunSecretsMessageSchema = z.object({
  type: z.literal("request_run_secrets"),
  /** Correlation id for the reply. */
  requestId: z.string(),
  /** The assignment/collector whose declared secretEnv to resolve. */
  configId: z.string(),
  collectorId: z.string(),
  /** Opaque per-run id for audit/logging on the core side. */
  runId: z.string(),
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
  RequestRunSecretsMessageSchema,
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
export type RequestRunSecretsMessage = z.infer<
  typeof RequestRunSecretsMessageSchema
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
  /**
   * The resolved GLOBAL script-sandbox policy, pushed at auth time so the
   * satellite enforces the operator's cluster-wide policy from its very first
   * script run. The satellite caches it and resolves every run through it;
   * until this arrives it FAILS CLOSED (denies egress) rather than using the
   * permissive shipped default. Optional for version-skew safety: an older
   * core omits it, and the satellite then stays fail-closed until a
   * `sandbox_policy` push or a reconnect against a newer core delivers it.
   */
  sandboxPolicy: sandboxPolicySchema.optional(),
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

/**
 * Push the new GLOBAL script-sandbox policy to a connected satellite when an
 * admin changes it (the push-on-change relay). Sent by each core instance's
 * `script-sandbox.policy-changed` broadcast handler to its currently-connected
 * satellites. The satellite replaces its cached policy so subsequent runs
 * enforce it immediately. Best-effort liveness; the policy carried in the
 * `authenticated` message on (re)connect is the durable backstop.
 */
const SandboxPolicyMessageSchema = z.object({
  type: z.literal("sandbox_policy"),
  policy: sandboxPolicySchema,
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
 * Core reply to `request_run_secrets`. Carries the resolved env map on
 * success, or an `error` when a required secret could not be resolved /
 * the collector was not found. The satellite injects `env` memory-only for
 * the run and drops it on completion; on `error` it fails the run clearly
 * rather than running without the secret.
 *
 * The env map never persists on the core side and is never written to disk
 * on the satellite.
 */
const RunSecretsMessageSchema = z.object({
  type: z.literal("run_secrets"),
  /** Correlates with the originating `request_run_secrets`. */
  requestId: z.string(),
  /** Resolved env, present only on success. */
  env: z.record(z.string(), z.string()).optional(),
  /** Set when resolution failed; `env` is then absent. */
  error: z.string().optional(),
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
  SandboxPolicyMessageSchema,
  ScriptPackageManifestMessageSchema,
  ScriptPackageBlobMessageSchema,
  RunSecretsMessageSchema,
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
export type SandboxPolicyMessage = z.infer<typeof SandboxPolicyMessageSchema>;
export type ScriptPackageManifestMessage = z.infer<
  typeof ScriptPackageManifestMessageSchema
>;
export type ScriptPackageBlobMessage = z.infer<
  typeof ScriptPackageBlobMessageSchema
>;
export type RunSecretsMessage = z.infer<typeof RunSecretsMessageSchema>;
