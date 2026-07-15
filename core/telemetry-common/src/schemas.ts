import { z } from "zod";
import { TelemetrySignalSchema } from "./signal-model";

/**
 * Source-instance domain schemas. A telemetry SOURCE INSTANCE is a configured
 * way telemetry enters the platform (a Prometheus-style poller, a vendor
 * webhook, a socket listener), created from a contributed SOURCE TYPE and
 * bound to one target stream per signal it emits.
 *
 * Instances are their own team-scopable resource (`telemetry.source`):
 * creating or re-binding one ADDITIONALLY requires manage on every bound
 * stream, enforced through the owning sink's `assertBindable` - the platform
 * never learns what a stream is.
 */

export const MAX_SOURCE_NAME_CHARS = 255;
export const MAX_SOURCE_DESCRIPTION_CHARS = 2000;

// =============================================================================
// BINDINGS
// =============================================================================

/** Route one emitted signal into one owning stream. */
export const SourceBindingSchema = z.object({
  signal: TelemetrySignalSchema,
  /** The target stream's id in the signal-owning plugin (opaque here). */
  streamId: z.string().min(1),
});
export type SourceBinding = z.infer<typeof SourceBindingSchema>;

/** At most ONE binding per signal: a source routes a signal to one stream. */
export const SourceBindingsSchema = z
  .array(SourceBindingSchema)
  .min(1)
  .refine(
    (bindings) =>
      new Set(bindings.map((b) => b.signal)).size === bindings.length,
    { message: "At most one binding per signal" },
  );

// =============================================================================
// SOURCE INSTANCE
// =============================================================================

/**
 * A source instance as returned by reads. `config` NEVER contains secret
 * values: fields the source type marks `x-secret` read back OMITTED, and
 * `storedSecretFields` lists which of them currently hold a stored value so
 * an editor can render "keep existing" semantics (DynamicForm's
 * `keepExistingSecretFields`).
 */
export const TelemetrySourceSchema = z.object({
  id: z.string(),
  /** Qualified source type id: `${ownerPluginId}.${typeId}`. */
  sourceTypeId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  config: z.record(z.string(), z.unknown()),
  /** Config keys that are secret AND currently have a stored value. */
  storedSecretFields: z.array(z.string()),
  bindings: z.array(SourceBindingSchema),
  /**
   * Read-only: display names for the bound streams, keyed by signal (one
   * binding per signal). Null when the stream no longer resolves (deleted) or
   * its sink is not installed. Resolved by the sinks in one batched lookup.
   */
  bindingStreamNames: z.partialRecord(
    TelemetrySignalSchema,
    z.string().nullable(),
  ),
  enabled: z.boolean(),
  /**
   * Pull interval override. Null falls back to the type's default; values are
   * clamped to the type's `minIntervalSeconds` server-side. Ignored for
   * webhook-only types.
   */
  intervalSeconds: z.number().int().positive().nullable(),
  /** When set, a pull source executes on this satellite instead of core. */
  satelliteId: z.string().nullable(),
  /** Operational health: last pull/webhook activity and failure streak. */
  lastRunAt: z.date().nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number().int().min(0),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type TelemetrySource = z.infer<typeof TelemetrySourceSchema>;

export const CreateTelemetrySourceSchema = z.object({
  sourceTypeId: z.string().min(1),
  name: z.string().min(1).max(MAX_SOURCE_NAME_CHARS),
  description: z.string().max(MAX_SOURCE_DESCRIPTION_CHARS).optional(),
  config: z.record(z.string(), z.unknown()),
  bindings: SourceBindingsSchema,
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().int().positive().optional(),
  satelliteId: z.string().optional(),
});
export type CreateTelemetrySource = z.infer<typeof CreateTelemetrySourceSchema>;

/**
 * Update payload. `config`, when present, REPLACES the stored config except
 * that an OMITTED `x-secret` key keeps its stored value (matching the
 * DynamicForm edit convention); the platform-standard `SECRET_CLEAR_SENTINEL`
 * (from `@checkstack/common`) as the value clears an optional secret.
 * `sourceTypeId` is immutable - delete and recreate to change the type.
 */
export const UpdateTelemetrySourceSchema = z.object({
  name: z.string().min(1).max(MAX_SOURCE_NAME_CHARS).optional(),
  description: z
    .string()
    .max(MAX_SOURCE_DESCRIPTION_CHARS)
    .nullable()
    .optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  bindings: SourceBindingsSchema.optional(),
  enabled: z.boolean().optional(),
  intervalSeconds: z.number().int().positive().nullable().optional(),
  satelliteId: z.string().nullable().optional(),
});
export type UpdateTelemetrySource = z.infer<typeof UpdateTelemetrySourceSchema>;

// =============================================================================
// SOURCE TYPE DESCRIPTOR (frontend catalog / editor)
// =============================================================================

/**
 * How a source type collects telemetry. A type may support several modes.
 * "derive" consumes one signal's already-ingested records from a configured
 * input stream and emits ANOTHER signal (log-to-metric, log-to-trace);
 * "listener" is a long-lived socket (syslog-style) started on EVERY pod for
 * each enabled instance; the platform owns the lifecycle (start on boot /
 * enable, stop on disable / delete, restart on config change).
 */
export const SOURCE_MODES = [
  "pull",
  "webhook",
  "listener",
  "derive",
  "push",
] as const;
export const SourceModeSchema = z.enum(SOURCE_MODES);
export type SourceMode = z.infer<typeof SourceModeSchema>;

/**
 * One inbound endpoint a PUSH source type's owning plugin serves. Paths are
 * plugin-owned (per-signal endpoints stay separate by design); the descriptor
 * only tells the UI what to show in setup snippets.
 */
export const PushEndpointDescriptorSchema = z.object({
  /** Wire family of the endpoint (drives the snippet the UI renders). */
  kind: z.enum(["otlp", "native"]),
  /** Host-relative path, e.g. `/api/metricstream/v1/metrics`. */
  path: z.string(),
  /** Short human label, e.g. "OTLP metrics". */
  label: z.string(),
});
export type PushEndpointDescriptor = z.infer<
  typeof PushEndpointDescriptorSchema
>;

/**
 * A contributed source type as listed to the frontend. `configSchema` is the
 * serialized JSON Schema of the type's zod config schema (via backend-api's
 * `toJsonSchema`), carrying `x-secret` and options-resolver metadata so
 * DynamicForm renders it directly.
 */
export const SourceTypeDescriptorSchema = z.object({
  /** Qualified id: `${ownerPluginId}.${typeId}`. */
  id: z.string(),
  ownerPluginId: z.string(),
  displayName: z.string(),
  description: z.string(),
  /** Lucide icon name rendered in the source catalog grid. */
  icon: z.string().optional(),
  /** Signals this type can emit; an instance binds a non-empty subset. */
  signals: z.array(TelemetrySignalSchema).min(1),
  modes: z.array(SourceModeSchema).min(1),
  /** Serialized JSON Schema for the instance config form. */
  configSchema: z.record(z.string(), z.unknown()),
  /** Pull interval bounds; present when `modes` includes "pull". */
  pull: z
    .object({
      defaultIntervalSeconds: z.number().int().positive(),
      minIntervalSeconds: z.number().int().positive(),
    })
    .optional(),
  /** Inbound endpoints; present when `modes` includes "push". */
  push: z
    .object({
      endpoints: z.array(PushEndpointDescriptorSchema).min(1),
    })
    .optional(),
  /** Whether a pull instance may be bound to a satellite for edge execution. */
  supportsSatellite: z.boolean(),
});
export type SourceTypeDescriptor = z.infer<typeof SourceTypeDescriptorSchema>;

// =============================================================================
// BINDABLE STREAMS (binding editor picker)
// =============================================================================

/** A stream the caller may bind (resolved + filtered by the owning sink). */
export const BindableStreamSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type BindableStream = z.infer<typeof BindableStreamSchema>;

// =============================================================================
// WEBHOOK INFO
// =============================================================================

/**
 * Per-instance webhook endpoint info. The secret is shown ONCE at create /
 * rotate; only its hash is stored.
 */
export const WebhookInfoSchema = z.object({
  /** Host-relative path of the instance's webhook endpoint. */
  path: z.string(),
  /** The full webhook secret. Displayed once; never retrievable again. */
  secret: z.string(),
});
export type WebhookInfo = z.infer<typeof WebhookInfoSchema>;

// =============================================================================
// PUSH TOKEN INFO
// =============================================================================

/**
 * Per-instance push-token info for a PUSH source instance. The token is shown
 * ONCE at create / rotate; only its hash is stored. `endpoints` echoes the
 * type's inbound endpoints so the reveal panel can render ready-to-paste
 * shipper snippets.
 */
export const PushInfoSchema = z.object({
  /** The full bearer token. Displayed once; never retrievable again. */
  token: z.string(),
  endpoints: z.array(PushEndpointDescriptorSchema).min(1),
});
export type PushInfo = z.infer<typeof PushInfoSchema>;

// =============================================================================
// CONFIG TEST (editor "Test connection")
// =============================================================================

export const TestSourceConfigSchema = z.object({
  sourceTypeId: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  /**
   * When testing an EXISTING source whose secrets read back omitted, pass the
   * source id so stored secret values fill the omitted keys. Requires manage
   * on that source (checked in the handler).
   */
  sourceId: z.string().optional(),
});
export type TestSourceConfig = z.infer<typeof TestSourceConfigSchema>;

export const TestSourceConfigResultSchema = z.object({
  /** False when the type has no pull seam (webhook/listener types). */
  supported: z.boolean(),
  ok: z.boolean(),
  message: z.string().optional(),
  /** Records the dry-run produced, per signal (nothing is persisted). */
  recordCounts: z.record(TelemetrySignalSchema, z.number()).optional(),
});
export type TestSourceConfigResult = z.infer<
  typeof TestSourceConfigResultSchema
>;
