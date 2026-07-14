import { z } from "zod";
import {
  createExtensionPoint,
  toJsonSchema,
  type AuthUser,
  type Logger,
} from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import type {
  SourceTypeDescriptor,
  TelemetryRecord,
  TelemetrySignal,
} from "@checkstack/telemetry-common";
import { assertConfigSecretFieldsValid } from "./secrets";

/**
 * The telemetry platform's two extension points.
 *
 * - SINKS: the plugin that owns a signal's streams (logstream, metricstream,
 *   tracestream) contributes ONE sink per signal. A sink adapts normalized
 *   records into the plugin's own ingest pipeline and owns the authorization
 *   question "may this caller bind stream X?" - the platform never learns what
 *   a stream is.
 * - SOURCE TYPES: any plugin contributes a way telemetry enters the platform
 *   (a poller, a vendor webhook). Instances of a type are configured by users
 *   (see `schema.ts` / `service.ts`) and routed to bound streams through the
 *   sinks.
 *
 * Dependency direction: the platform imports NO stream plugin; both sides
 * import the platform (see `.claude/rules/dependencies.md`).
 */

// =============================================================================
// SINKS
// =============================================================================

/** Result of one sink write - mirrors the plugins' push-endpoint semantics. */
export interface TelemetrySinkWriteResult {
  /** Records admitted into the owning plugin's pipeline/buffer. */
  accepted: number;
  /** Records refused (rate limit / full buffer / invalid for the stream). */
  rejected: number;
}

/** Identifies the writing source instance for per-source attribution. */
export interface TelemetrySourceRef {
  sourceId: string;
  sourceTypeId: string;
}

/**
 * A signal owner's sink contribution. Methods use method-shorthand signatures
 * ON PURPOSE - the registry stores them signal-erased.
 */
export interface TelemetrySinkContribution<
  S extends TelemetrySignal = TelemetrySignal,
> {
  signal: S;
  /**
   * Throw (FORBIDDEN / NOT_FOUND oRPC errors preferred) unless `user` may
   * MANAGE the stream - global manage rule OR a team grant on the instance.
   * Called by the platform on every create/update that binds the stream.
   */
  assertBindable(opts: { streamId: string; user: AuthUser }): Promise<void>;
  /**
   * Resolve display info for pickers and binding summaries, or null when the
   * stream does not exist. Must NOT leak data the caller cannot read - the
   * platform only calls it after `assertBindable` (write paths) or for
   * bindings already stored on a source the caller may read.
   */
  describeStream(opts: {
    streamId: string;
  }): Promise<{ id: string; name: string } | null>;
  /**
   * Batched variant of {@link describeStream} for LIST read paths: resolve the
   * display info for MANY streams of this signal in ONE set-based query, keyed
   * by stream id. An id whose stream does not resolve (deleted) maps to null.
   *
   * OPTIONAL: a sink that has not adopted it makes the platform fall back to
   * per-id `describeStream` (still grouped per signal), so a source list's
   * stream names resolve either way - the batch method just collapses N lookups
   * into one query.
   */
  describeStreams?(opts: {
    streamIds: string[];
  }): Promise<Record<string, { id: string; name: string } | null>>;
  /**
   * List the streams `user` may BIND (manage) for this signal, resolved AND
   * FILTERED by the owning plugin's own access rules - the platform never
   * learns what a stream is. Backs the binding editor's per-signal picker
   * (`listBindableStreams` RPC).
   *
   * OPTIONAL during rollout: a sink that has not yet implemented it yields an
   * empty picker for its signal (the platform returns `{ streams: [] }`), so
   * signal-owner plugins can adopt it in a follow-up wave without breaking
   * their typecheck.
   */
  listBindableStreams?(opts: {
    user: AuthUser;
  }): Promise<{ id: string; name: string }[]>;
  /**
   * Hand normalized records to the owning plugin's ingest pipeline. Runs on
   * machine paths (pull executors, webhook handlers) with NO user context -
   * authorization happened at bind time, exactly like a source token
   * pre-authorizes the plugins' push endpoints.
   */
  write(opts: {
    streamId: string;
    records: TelemetryRecord<S>[];
    source: TelemetrySourceRef;
    /** Platform receive time; defaults to now. Sinks clamp record ts with it. */
    now?: Date;
  }): Promise<TelemetrySinkWriteResult>;
}

/** Registry of sinks: exactly ONE per signal. */
export interface TelemetrySinkRegistry {
  register(
    contribution: TelemetrySinkContribution,
    pluginMetadata: PluginMetadata,
  ): void;
  get(signal: TelemetrySignal): RegisteredTelemetrySink | undefined;
  list(): RegisteredTelemetrySink[];
}

export interface RegisteredTelemetrySink extends TelemetrySinkContribution {
  ownerPluginId: string;
}

export function createTelemetrySinkRegistry(): TelemetrySinkRegistry {
  const sinks = new Map<TelemetrySignal, RegisteredTelemetrySink>();
  return {
    register(contribution, pluginMetadata) {
      const existing = sinks.get(contribution.signal);
      if (existing) {
        throw new Error(
          `telemetry: duplicate sink for signal "${contribution.signal}" ` +
            `(already registered by "${existing.ownerPluginId}", ` +
            `rejected registration from "${pluginMetadata.pluginId}")`,
        );
      }
      sinks.set(contribution.signal, {
        ...contribution,
        ownerPluginId: pluginMetadata.pluginId,
      });
    },
    get(signal) {
      return sinks.get(signal);
    },
    list() {
      return [...sinks.values()];
    },
  };
}

/** Extension point: a signal-owning plugin contributes its sink. */
export interface TelemetrySinkExtensionPoint {
  registerSink(
    contribution: TelemetrySinkContribution,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const telemetrySinkExtensionPoint =
  createExtensionPoint<TelemetrySinkExtensionPoint>("telemetry.sink");

// =============================================================================
// SOURCE TYPES
// =============================================================================

/** Result of one emit: `bound` is false when the instance did not bind the
 * signal (a legal no-op - a multi-signal type may emit more than the instance
 * routes). */
export interface TelemetryEmitResult extends TelemetrySinkWriteResult {
  bound: boolean;
}

/**
 * The sink view a source implementation writes to. Bound per instance: emits
 * for signals the instance routes go to the bound stream; other signals are
 * counted and dropped. The platform wraps it with per-run counters (test
 * results, activity attribution).
 */
export interface BoundTelemetrySink {
  /** Signals this instance routes; emits for others return `bound: false`. */
  readonly boundSignals: readonly TelemetrySignal[];
  emit<S extends TelemetrySignal>(
    signal: S,
    records: TelemetryRecord<S>[],
  ): Promise<TelemetryEmitResult>;
}

/** Context for one scheduled pull run (and for editor config dry-runs). */
export interface TelemetryPullContext<Config = unknown> {
  /** Validated against the type's `configSchema`; secrets resolved. */
  config: Config;
  sink: BoundTelemetrySink;
  /**
   * SSRF-guarded fetch: blocks link-local/metadata endpoints and, outside
   * satellite execution, private ranges per platform policy. Sources MUST use
   * this instead of global fetch for any config-derived URL.
   */
  fetch: typeof fetch;
  logger: Logger;
  /** Aborted when the run exceeds the platform's per-run timeout. */
  abortSignal: AbortSignal;
}

/** Context for one verified webhook delivery. */
export interface TelemetryWebhookContext<Config = unknown> {
  config: Config;
  sink: BoundTelemetrySink;
  logger: Logger;
}

/**
 * Describes how a vendor SIGNS a webhook payload with the instance's shared
 * webhook secret, so the platform can verify a vendor HMAC signature uniformly
 * BEFORE `webhook.handle` runs - the way GitHub, Slack and Stripe authenticate
 * their deliveries. When a webhook seam declares this, the platform verifies the
 * HMAC INSTEAD of expecting the plain secret in an Authorization / secret header.
 *
 * Real-vendor fit (validated in tests):
 * - GitHub:  `{ algorithm: "hmac-sha256", header: "x-hub-signature-256",
 *              encoding: "hex", prefix: "sha256=", basestring: "body" }`.
 * - Slack:   `{ algorithm: "hmac-sha256", header: "x-slack-signature",
 *              encoding: "hex", prefix: "v0=", basestring:
 *              "versioned-timestamp-body", timestampHeader:
 *              "x-slack-request-timestamp", toleranceSeconds: 300 }`.
 * - Stripe:  does NOT fit. Stripe packs several comma-joined `k=v` pairs into
 *   ONE `Stripe-Signature` header (`t=<ts>,v1=<hex>`), which no single-header
 *   prefix scheme can address. A Stripe source type must verify inside its own
 *   `handle()` instead of declaring a `signature` descriptor.
 */
export interface WebhookSignatureDescriptor {
  algorithm: "hmac-sha256" | "hmac-sha1";
  /** Header carrying the signature (e.g. "x-hub-signature-256"). */
  header: string;
  encoding: "hex" | "base64";
  /** Literal prefix stripped before compare (e.g. "sha256=", "v0="). */
  prefix?: string;
  /**
   * Base string the vendor signs. "body" = the raw request body (GitHub, Stripe
   * default). "versioned-timestamp-body" = `<version>:<ts>:<body>` (Slack v0
   * style; `version` is the prefix without its trailing "=").
   */
  basestring: "body" | "versioned-timestamp-body";
  /** Header carrying the unix timestamp. Required for versioned-timestamp-body. */
  timestampHeader?: string;
  /** Max allowed |now - ts| skew (replay protection). Required for versioned. */
  toleranceSeconds?: number;
}

/**
 * Registration-time validator for a {@link WebhookSignatureDescriptor}. Kept as
 * a zod schema so a JS caller (or a malformed contribution) fails at boot with a
 * clear reason rather than silently mis-verifying at run time. The versioned
 * base-string mode additionally REQUIRES `timestampHeader`, `toleranceSeconds`
 * and `prefix` (the prefix doubles as the signed `version`).
 */
const webhookSignatureDescriptorSchema = z
  .object({
    algorithm: z.enum(["hmac-sha256", "hmac-sha1"]),
    header: z.string().min(1),
    encoding: z.enum(["hex", "base64"]),
    prefix: z.string().min(1).optional(),
    basestring: z.enum(["body", "versioned-timestamp-body"]),
    timestampHeader: z.string().min(1).optional(),
    toleranceSeconds: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.basestring !== "versioned-timestamp-body") return;
    if (!value.timestampHeader) {
      ctx.addIssue({
        code: "custom",
        message: "versioned-timestamp-body requires a timestampHeader",
      });
    }
    if (value.toleranceSeconds === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "versioned-timestamp-body requires a toleranceSeconds",
      });
    }
    if (!value.prefix) {
      ctx.addIssue({
        code: "custom",
        message: "versioned-timestamp-body requires a prefix (the signed version)",
      });
    }
  });

/**
 * Context for a long-lived listener (a pod-local inbound socket - syslog, a TCP
 * collector). No `fetch`: a listener accepts inbound connections rather than
 * reaching out. `start` returns a stop function the platform calls on shutdown /
 * disable / config change.
 */
export interface TelemetryListenerContext<Config = unknown> {
  config: Config;
  sink: BoundTelemetrySink;
  logger: Logger;
}

/**
 * A contributed source type. At least one seam (`pull`, `webhook`) must be
 * implemented; a type may implement both. Config schemas mark secret fields
 * with backend-api's `configString({ "x-secret": true })` so the platform
 * encrypts them at rest and the editor masks them.
 *
 * The platform ALWAYS validates an instance's config with `configSchema`
 * before invoking a seam, so implementations may trust `ctx.config`'s shape.
 */
export interface TelemetrySourceTypeDefinition<Config = unknown> {
  /** Local id, qualified with the registering plugin id ("prometheus"). */
  id: string;
  displayName: string;
  description: string;
  /** Lucide icon name for the source catalog grid. */
  icon?: string;
  /** Signals the type can emit; instances bind a non-empty subset. */
  signals: TelemetrySignal[];
  configSchema: z.ZodType<Config>;
  pull?: {
    defaultIntervalSeconds: number;
    minIntervalSeconds: number;
    /** Execute one run, writing via `ctx.sink`. Throw on transport failure. */
    execute(ctx: TelemetryPullContext<Config>): Promise<void>;
  };
  webhook?: {
    /**
     * Handle one delivery. The PLATFORM verifies the delivery before invoking
     * (the plain per-instance secret, or - when `signature` is declared - a
     * vendor HMAC signature); the handler only parses the payload and emits.
     */
    handle(
      ctx: TelemetryWebhookContext<Config>,
      request: Request,
    ): Promise<Response>;
    /**
     * When present, the platform verifies a vendor HMAC signature computed with
     * the instance's webhook secret INSTEAD of expecting the plain secret in a
     * header. See {@link WebhookSignatureDescriptor}.
     */
    signature?: WebhookSignatureDescriptor;
  };
  listener?: {
    /**
     * Start a long-lived listener (bind a socket, subscribe a stream) and
     * return the stop function. The platform runs ONE listener per enabled
     * instance per pod and calls the returned stop on shutdown / disable /
     * config change. Throw on a start failure (e.g. `EADDRINUSE`); the platform
     * records it as the instance's `lastError` without crashing.
     */
    start(ctx: TelemetryListenerContext<Config>): Promise<() => void | Promise<void>>;
  };
  /** Whether a pull instance may bind a satellite for edge execution. */
  supportsSatellite?: boolean;
}

/**
 * Identity helper so a source author gets full `Config` inference on the seam
 * contexts without annotating them.
 */
export function defineTelemetrySourceType<Config>(
  def: TelemetrySourceTypeDefinition<Config>,
): TelemetrySourceTypeDefinition<Config> {
  return def;
}

export interface RegisteredTelemetrySourceType
  extends TelemetrySourceTypeDefinition {
  /** `${ownerPluginId}.${id}`. */
  qualifiedId: string;
  ownerPluginId: string;
}

/**
 * Registry of source types. Registration validates the contribution shape so
 * a broken contribution fails at boot, not on first use.
 */
export interface TelemetrySourceRegistry {
  register(
    def: TelemetrySourceTypeDefinition,
    pluginMetadata: PluginMetadata,
  ): void;
  get(qualifiedId: string): RegisteredTelemetrySourceType | undefined;
  list(): RegisteredTelemetrySourceType[];
}

export function createTelemetrySourceRegistry(): TelemetrySourceRegistry {
  const sources = new Map<string, RegisteredTelemetrySourceType>();
  return {
    register(def, pluginMetadata) {
      const qualifiedId = `${pluginMetadata.pluginId}.${def.id}`;
      if (sources.has(qualifiedId)) {
        throw new Error(
          `telemetry: duplicate source type "${qualifiedId}"`,
        );
      }
      if (def.signals.length === 0) {
        throw new Error(
          `telemetry: source type "${qualifiedId}" declares no signals`,
        );
      }
      if (!def.pull && !def.webhook && !def.listener) {
        throw new Error(
          `telemetry: source type "${qualifiedId}" implements none of pull, webhook or listener`,
        );
      }
      if (def.pull) {
        const { defaultIntervalSeconds, minIntervalSeconds } = def.pull;
        if (
          !Number.isInteger(minIntervalSeconds) ||
          minIntervalSeconds < 1 ||
          !Number.isInteger(defaultIntervalSeconds) ||
          defaultIntervalSeconds < minIntervalSeconds
        ) {
          throw new Error(
            `telemetry: source type "${qualifiedId}" has invalid pull intervals ` +
              `(min ${minIntervalSeconds}, default ${defaultIntervalSeconds})`,
          );
        }
      }
      if (def.supportsSatellite && !def.pull) {
        throw new Error(
          `telemetry: source type "${qualifiedId}" declares supportsSatellite without a pull seam`,
        );
      }
      if (def.webhook?.signature) {
        const result = webhookSignatureDescriptorSchema.safeParse(
          def.webhook.signature,
        );
        if (!result.success) {
          throw new Error(
            `telemetry: source type "${qualifiedId}" has an invalid webhook.signature: ` +
              result.error.issues.map((i) => i.message).join("; "),
          );
        }
      }
      // HARD guard: every x-secret config field must be a top-level string that
      // accepts the internal-secret marker (so the persisted marker round-trips).
      assertConfigSecretFieldsValid({
        schema: def.configSchema,
        label: qualifiedId,
      });
      sources.set(qualifiedId, {
        ...def,
        qualifiedId,
        ownerPluginId: pluginMetadata.pluginId,
      });
    },
    get(qualifiedId) {
      return sources.get(qualifiedId);
    },
    list() {
      return [...sources.values()];
    },
  };
}

/** Extension point: any plugin contributes a source type. */
export interface TelemetrySourceExtensionPoint {
  registerSourceType(
    def: TelemetrySourceTypeDefinition,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const telemetrySourceExtensionPoint =
  createExtensionPoint<TelemetrySourceExtensionPoint>("telemetry.source");

// =============================================================================
// DESCRIPTOR DERIVATION (backend definition -> frontend catalog entry)
// =============================================================================

/** Serialize a registered type into the frontend's catalog descriptor. */
export function toSourceTypeDescriptor(
  registered: RegisteredTelemetrySourceType,
): SourceTypeDescriptor {
  const modes: SourceTypeDescriptor["modes"] = [];
  if (registered.pull) modes.push("pull");
  if (registered.webhook) modes.push("webhook");
  if (registered.listener) modes.push("listener");
  return {
    id: registered.qualifiedId,
    ownerPluginId: registered.ownerPluginId,
    displayName: registered.displayName,
    description: registered.description,
    icon: registered.icon,
    signals: registered.signals,
    modes,
    configSchema: toJsonSchema(registered.configSchema),
    pull: registered.pull
      ? {
          defaultIntervalSeconds: registered.pull.defaultIntervalSeconds,
          minIntervalSeconds: registered.pull.minIntervalSeconds,
        }
      : undefined,
    supportsSatellite: registered.supportsSatellite ?? false,
  };
}
