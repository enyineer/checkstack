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
 * One environment a satellite assignment fans out into. Mirrors the core's
 * `EffectiveEnvironment`: `fields` is the environment's free-form catalog
 * metadata, surfaced to collectors as `{{ environment.<key> }}` - metadata
 * only, never secrets.
 */
export const SatelliteEnvironmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  fields: z.record(z.string(), z.unknown()).optional(),
});

export type SatelliteEnvironment = z.infer<typeof SatelliteEnvironmentSchema>;

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
  /**
   * The system's free-form catalog custom fields, surfaced to config
   * templating as `{{ system.metadata.<key> }}`. Metadata only, never secrets.
   * Optional for version-skew safety; an older core omits it and the satellite
   * treats it as `{}`.
   */
  systemMetadata: z.record(z.string(), z.unknown()).optional(),
  /**
   * The environments this assignment fans out into, already resolved by the
   * core against the system's membership and the assignment's selector. The
   * satellite runs the check ONCE PER entry and reports each result with that
   * environment's id.
   *
   * Absent or empty means one env-less run - which is also what an older core
   * sends, so an older core keeps producing exactly today's behaviour.
   */
  environments: z.array(SatelliteEnvironmentSchema).optional(),
});

export type SatelliteAssignment = z.infer<typeof SatelliteAssignmentSchema>;

// =============================================================================
// SATELLITE → CORE MESSAGES
// =============================================================================

const AuthenticateMessageSchema = z.object({
  type: z.literal("authenticate"),
  clientId: z.string(),
  token: z.string(),
  /**
   * Capabilities the satellite advertises (e.g. "telemetry", "scrape",
   * "log-receivers", "syslog"). Optional for version-skew safety: an older
   * agent omits it and the core treats it as no advertised capabilities. The
   * core persists this on the satellite row for UI + assignment gating.
   */
  capabilities: z.array(z.string()).optional(),
});

const HeartbeatMessageSchema = z.object({
  type: z.literal("heartbeat"),
  version: z.string(),
  uptimeSeconds: z.number(),
  /**
   * Re-advertised capabilities (see {@link AuthenticateMessageSchema}). Repeated
   * on heartbeat so a capability change (env re-config on restart, or a future
   * dynamic toggle) converges without waiting for a reconnect. Optional for
   * version-skew safety.
   */
  capabilities: z.array(z.string()).optional(),
});

// =============================================================================
// TELEMETRY (satellite -> core) — additive, generic envelopes. The domain
// payload is opaque here and validated by the registered capability handler for
// `kind`; keeping it `unknown` lets satellite-common stay a leaf (no dependency
// on any domain plugin's schemas).
// =============================================================================

/**
 * A batch of normalized telemetry items forwarded from a satellite. `batchId`
 * is monotonic PER CONNECTION so the core can dedupe resends within its
 * per-connection window; the core MUST reply with a `telemetry_ack` for every
 * batch (the agent's credit window blocks until acked).
 *
 * `droppedByGroup` carries how many items this kind's bounded agent buffer
 * dropped since the previous batch of the same kind, **keyed by the group the
 * loss belongs to** so the core can surface it on the exact stream that lost
 * data rather than spreading a single connection-level count across every
 * stream in the batch. The group key is an opaque DOMAIN string the capability
 * handler for `kind` interprets: the per-stream source token for the forward
 * paths (`logstream`, `metricstream`), the scrape target id for `metric-scrape`.
 * Omitted entirely when nothing was dropped.
 */
const TelemetryBatchMessageSchema = z.object({
  type: z.literal("telemetry_batch"),
  batchId: z.string(),
  kind: z.string(),
  payload: z.unknown(),
  droppedByGroup: z.record(z.string(), z.number()).optional(),
});

/**
 * A satellite -> core status update for a capability (e.g. per-scrape-target
 * lastScrapeAt / lastError). Fire-and-forget: no ack. Routed to the registered
 * handler's `handleCapabilityStatus` for `kind`.
 */
const CapabilityStatusMessageSchema = z.object({
  type: z.literal("capability_status"),
  kind: z.string(),
  payload: z.unknown(),
});

/**
 * Satellite -> core just-in-time request for a capability's secret (e.g. the
 * bearer token of a scrape target the satellite is about to poll). The GENERIC
 * analogue of `request_run_secrets` / `request_config_secrets` for the
 * capability channel: the core routes it to the registered handler's
 * `resolveSecret` for `kind`, which resolves the secret from ITS OWN durable
 * state (the satellite does not get to choose which secret - it names a resource
 * it is bound to, e.g. `{ targetId }`, and the handler validates the binding).
 *
 * Secrets NEVER ride the `capability_config` push (which re-crosses on every
 * reconnect); they are delivered ONLY over this per-request channel and held in
 * agent memory for the poll/scrape interval. `requestId` correlates the reply;
 * `payload` is the opaque, handler-validated request body.
 */
const CapabilitySecretRequestMessageSchema = z.object({
  type: z.literal("capability_secret_request"),
  requestId: z.string(),
  kind: z.string(),
  payload: z.unknown(),
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
  /**
   * The environment this run executed for, or `null`/absent for an env-less
   * run. Optional for version-skew safety: an older satellite omits it and the
   * core stores the run env-less, exactly as it always did.
   */
  environmentId: z.string().nullable().optional(),
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
 * Satellite → core: just-in-time delivery of an assignment's CONFIG secrets
 * (`x-secret` fields of the strategy config and each collector's config),
 * sent right before the satellite builds the strategy client for a run. The
 * stored/relayed assignment carries only internal markers or
 * `${{ secrets.* }}` references in those fields - never values. Core walks
 * the satellite's OWN persisted assignment (the satellite does not get to
 * choose which secrets), resolves each marker/reference, and replies with a
 * `config_secrets` message mapping field paths to values (or an error).
 *
 * Like `request_run_secrets`, values ride only this authenticated channel,
 * live in satellite memory for the run, and are never persisted.
 */
const RequestConfigSecretsMessageSchema = z.object({
  type: z.literal("request_config_secrets"),
  /** Correlation id for the reply. */
  requestId: z.string(),
  /** The assignment whose config secrets to resolve. */
  configId: z.string(),
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
  RequestConfigSecretsMessageSchema,
  TelemetryBatchMessageSchema,
  CapabilityStatusMessageSchema,
  CapabilitySecretRequestMessageSchema,
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
export type RequestConfigSecretsMessage = z.infer<
  typeof RequestConfigSecretsMessageSchema
>;
export type TelemetryBatchMessage = z.infer<
  typeof TelemetryBatchMessageSchema
>;
export type CapabilityStatusMessage = z.infer<
  typeof CapabilityStatusMessageSchema
>;
export type CapabilitySecretRequestMessage = z.infer<
  typeof CapabilitySecretRequestMessageSchema
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
 * Core → satellite reply to `request_config_secrets`: the resolved values of
 * the assignment's `x-secret` config fields, keyed by field path (the same
 * dot/`[i]` paths the schema walk produces). Fields holding legacy bare
 * literals are omitted - the satellite uses the relayed value as-is. Held in
 * satellite memory only for the lifetime of the run.
 */
const ConfigSecretsMessageSchema = z.object({
  type: z.literal("config_secrets"),
  /** Correlates with the originating `request_config_secrets`. */
  requestId: z.string(),
  /** Strategy-config secret values by field path. Present only on success. */
  strategy: z.record(z.string(), z.string()).optional(),
  /** Collector-config secret values: entry id → field path → value. */
  collectors: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional(),
  /** Set when resolution failed; the value maps are then absent. */
  error: z.string().optional(),
});

// =============================================================================
// TELEMETRY (core -> satellite) — additive, generic envelopes.
// =============================================================================

/**
 * Core acknowledgement of a `telemetry_batch`. REQUIRED for every batch: the
 * agent's credit window holds the batch inflight until this arrives. `accepted`
 * / `rejected` mirror the handler's per-item outcome. `retryable` decides the
 * agent's action: `true` means a transient failure (over-budget, sink hiccup,
 * no handler yet) - keep the batch and resend later by the same batchId; `false`
 * means a terminal rejection (auth-rejected, no such handler will ever accept) -
 * drop the batch and count the loss.
 */
const TelemetryAckMessageSchema = z.object({
  type: z.literal("telemetry_ack"),
  batchId: z.string(),
  accepted: z.number(),
  rejected: z.number(),
  retryable: z.boolean(),
});

/**
 * Core -> satellite push of a capability's configuration (e.g. the scrape
 * targets bound to this satellite). Pushed right after `authenticated` and again
 * whenever a domain plugin calls `notifyCapabilityConfigChanged`. The payload is
 * opaque here and consumed by the agent's registered capability consumer for
 * `kind`.
 */
const CapabilityConfigMessageSchema = z.object({
  type: z.literal("capability_config"),
  kind: z.string(),
  payload: z.unknown(),
});

/**
 * Core -> satellite reply to `capability_secret_request`. Carries the handler's
 * resolved secret on success (`payload`, e.g. `{ bearerToken }`), or an `error`
 * when the secret could not be resolved / the binding check failed. The satellite
 * uses the value memory-only for the poll/scrape and never persists it; on
 * `error` it skips that poll and surfaces the failure via `capability_status`.
 * `requestId` correlates with the originating request; `payload` is opaque here
 * and validated by the agent's capability consumer for the request's `kind`.
 */
const CapabilitySecretResponseMessageSchema = z.object({
  type: z.literal("capability_secret_response"),
  requestId: z.string(),
  payload: z.unknown().optional(),
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
  ConfigSecretsMessageSchema,
  TelemetryAckMessageSchema,
  CapabilityConfigMessageSchema,
  CapabilitySecretResponseMessageSchema,
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
export type ConfigSecretsMessage = z.infer<typeof ConfigSecretsMessageSchema>;
export type TelemetryAckMessage = z.infer<typeof TelemetryAckMessageSchema>;
export type CapabilityConfigMessage = z.infer<
  typeof CapabilityConfigMessageSchema
>;
export type CapabilitySecretResponseMessage = z.infer<
  typeof CapabilitySecretResponseMessageSchema
>;
