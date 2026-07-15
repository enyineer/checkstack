import { z } from "zod";
import type { Logger } from "@checkstack/common";
import {
  TELEMETRY_SIGNALS,
  TelemetrySignalSchema,
  type TelemetrySignal,
} from "../signal-model";
import {
  MAX_EXEMPLARS_PER_POINT,
  MetricExemplarSchema,
  NormalizedLogRecordSchema,
  NormalizedMetricPointSchema,
  NormalizedSpanEventSchema,
  NormalizedSpanLinkSchema,
  NormalizedSpanSchema,
  type NormalizedLogRecord,
  type NormalizedMetricPoint,
  type NormalizedSpan,
  type TelemetryRecordMap,
} from "../records";

/**
 * Shared wire contract for the `telemetry-pull` satellite capability: a
 * satellite executes PULL runs for telemetry source instances bound to it and
 * forwards the produced records. Both the CORE handler (telemetry-backend) and
 * the AGENT (core/satellite) import these so every payload validates against
 * ONE schema on both ends. Payloads ride the generic `capability_config` /
 * `capability_secret_request` / `telemetry_batch` / `capability_status`
 * envelopes owned by satellite-backend.
 *
 * Authorization model mirrors metric-scrape: the instance BINDING is the
 * authorization. Core only resolves secrets for, and only accepts batches
 * from, the satellite an instance is bound to. Secrets NEVER ride the config
 * payload - the agent requests them just-in-time per field over the
 * authenticated socket.
 *
 * EXECUTION CONSTRAINT (inherent to satellites): the agent can only run pull
 * logic that is STATICALLY compiled into the satellite build. A
 * satellite-capable source type therefore ships a pure
 * {@link SatellitePullExecutor} (in a `*-common` leaf the satellite imports)
 * and registers it in the agent's executor registry. Config for a source type
 * with no registered executor produces a per-instance `capability_status`
 * error, never a crash.
 */

/** Capability kind for satellite-executed telemetry pull sources. */
export const TELEMETRY_PULL_CAPABILITY_KIND = "telemetry-pull";

// =============================================================================
// WIRE RECORDS (JSON-safe variants of the normalized records)
// =============================================================================

/** A log record on the wire: `ts` is an ISO-8601 string. */
export const WireLogRecordSchema = NormalizedLogRecordSchema.extend({
  ts: z.string(),
});
export type WireLogRecord = z.infer<typeof WireLogRecordSchema>;

/**
 * An exemplar on the wire: identical to {@link MetricExemplarSchema} except its
 * own `ts` is an ISO-8601 STRING. JSON has no Date type, so the exemplar
 * timestamp needs the SAME string treatment as the point's top-level `ts` -
 * without it the core-side `TelemetryPullBatchSchema` parse rejects any batch
 * carrying an exemplar (mirrors metricstream-common's `WireExemplarSchema`).
 */
export const WireExemplarSchema = MetricExemplarSchema.extend({
  ts: z.string(),
});
export type WireExemplar = z.infer<typeof WireExemplarSchema>;

/**
 * A metric point on the wire: `ts` (and each exemplar's own `ts`) is an
 * ISO-8601 string. The inherited `exemplars` field is overridden so its
 * timestamps are strings too, not the `Date`s the normalized shape carries.
 */
export const WireMetricPointSchema = NormalizedMetricPointSchema.extend({
  ts: z.string(),
  exemplars: z
    .array(WireExemplarSchema)
    .max(MAX_EXEMPLARS_PER_POINT)
    .optional(),
});
export type WireMetricPoint = z.infer<typeof WireMetricPointSchema>;

/**
 * A span on the wire: `Date`s become ISO-8601 strings and the optional
 * nanosecond timestamps (bigint) become decimal strings.
 */
export const WireSpanSchema = NormalizedSpanSchema.extend({
  startTs: z.string(),
  endTs: z.string(),
  startUnixNano: z.string().optional(),
  endUnixNano: z.string().optional(),
  events: z
    .array(NormalizedSpanEventSchema.extend({ ts: z.string() }))
    .optional(),
  links: z.array(NormalizedSpanLinkSchema).optional(),
});
export type WireSpan = z.infer<typeof WireSpanSchema>;

export const WIRE_RECORD_SCHEMAS = {
  logs: WireLogRecordSchema,
  metrics: WireMetricPointSchema,
  traces: WireSpanSchema,
} as const;

/** Map from a signal to its wire record type. */
export interface WireRecordMap {
  logs: WireLogRecord;
  metrics: WireMetricPoint;
  traces: WireSpan;
}

/**
 * Records produced by one pull run, keyed by signal (JSON-safe). The shape is
 * `satisfies`-checked against {@link TELEMETRY_SIGNALS} so adding a signal to
 * the enum FAILS typecheck here until the wire bundle carries it - the signal
 * set stays single-sourced.
 */
export const WirePullRecordsSchema = z.object({
  logs: z.array(WireLogRecordSchema).optional(),
  metrics: z.array(WireMetricPointSchema).optional(),
  traces: z.array(WireSpanSchema).optional(),
} satisfies Record<TelemetrySignal, z.ZodTypeAny>);
export type WirePullRecords = z.infer<typeof WirePullRecordsSchema>;

/** Total records in one wire bundle, across every signal. */
export function countWireRecords(records: WirePullRecords): number {
  let total = 0;
  for (const signal of TELEMETRY_SIGNALS) {
    total += records[signal]?.length ?? 0;
  }
  return total;
}

/** Copy one signal's records when present and non-empty (typed per key). */
function copyWireSignal<S extends TelemetrySignal>(
  out: WirePullRecords,
  records: WirePullRecords,
  signal: S,
): void {
  const recs = records[signal];
  if (recs && recs.length > 0) out[signal] = recs;
}

/**
 * Keep only the records of the given signals (the agent drops records for
 * signals the instance did not bind). Empty arrays are dropped too.
 */
export function filterWireRecordsToSignals({
  records,
  signals,
}: {
  records: WirePullRecords;
  signals: readonly TelemetrySignal[];
}): WirePullRecords {
  const out: WirePullRecords = {};
  for (const signal of TELEMETRY_SIGNALS) {
    if (signals.includes(signal)) copyWireSignal(out, records, signal);
  }
  return out;
}

// Wire -> normalized converters (core side, before feeding the sinks).

export function wireLogRecordToNormalized(
  record: WireLogRecord,
): NormalizedLogRecord {
  return { ...record, ts: new Date(record.ts) };
}

export function wireMetricPointToNormalized(
  point: WireMetricPoint,
): NormalizedMetricPoint {
  const { exemplars, ...rest } = point;
  return {
    ...rest,
    ts: new Date(point.ts),
    // Convert each exemplar's own ISO ts back to a Date so a chart-to-trace
    // jump-off survives the satellite hop.
    ...(exemplars
      ? { exemplars: exemplars.map((e) => ({ ...e, ts: new Date(e.ts) })) }
      : {}),
  };
}

export function wireSpanToNormalized(span: WireSpan): NormalizedSpan {
  return {
    ...span,
    startTs: new Date(span.startTs),
    endTs: new Date(span.endTs),
    startUnixNano:
      span.startUnixNano === undefined ? undefined : BigInt(span.startUnixNano),
    endUnixNano:
      span.endUnixNano === undefined ? undefined : BigInt(span.endUnixNano),
    events: span.events?.map((event) => ({
      ...event,
      ts: new Date(event.ts),
    })),
  };
}

// Normalized -> wire converters (agent side, before enqueueing a batch).

export function normalizedLogRecordToWire(
  record: NormalizedLogRecord,
): WireLogRecord {
  return { ...record, ts: record.ts.toISOString() };
}

export function normalizedMetricPointToWire(
  point: NormalizedMetricPoint,
): WireMetricPoint {
  const { exemplars, ...rest } = point;
  return {
    ...rest,
    ts: point.ts.toISOString(),
    // Serialize each exemplar's own Date ts to ISO so it round-trips as JSON.
    ...(exemplars
      ? { exemplars: exemplars.map((e) => ({ ...e, ts: e.ts.toISOString() })) }
      : {}),
  };
}

export function normalizedSpanToWire(span: NormalizedSpan): WireSpan {
  return {
    ...span,
    startTs: span.startTs.toISOString(),
    endTs: span.endTs.toISOString(),
    startUnixNano: span.startUnixNano?.toString(),
    endUnixNano: span.endUnixNano?.toString(),
    events: span.events?.map((event) => ({
      ...event,
      ts: event.ts.toISOString(),
    })),
  };
}

/**
 * Convert one wire records bundle back to normalized records per signal. The
 * literal is `satisfies`-checked so a new signal cannot be silently skipped.
 */
export function wirePullRecordsToNormalized(records: WirePullRecords): {
  [S in TelemetrySignal]?: TelemetryRecordMap[S][];
} {
  return {
    logs: records.logs?.map((record) => wireLogRecordToNormalized(record)),
    metrics: records.metrics?.map((point) =>
      wireMetricPointToNormalized(point),
    ),
    traces: records.traces?.map((span) => wireSpanToNormalized(span)),
  } satisfies Record<TelemetrySignal, unknown>;
}

// =============================================================================
// capability_config payload (core -> agent)
// =============================================================================

/**
 * One pull instance as pushed to its bound satellite. `config` carries the
 * NON-SECRET config values only (secret fields are OMITTED); `secretFields`
 * advertises which fields the agent must fetch just-in-time before a run
 * (mirrors metric-scrape's `hasBearer`).
 */
export const TelemetryPullInstanceConfigSchema = z.object({
  id: z.string(),
  /** Qualified source type id; resolves the agent-side executor. */
  sourceTypeId: z.string(),
  name: z.string(),
  intervalSeconds: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  config: z.record(z.string(), z.unknown()),
  secretFields: z.array(z.string()),
  /** Signals the instance routes; the agent drops records for other signals. */
  boundSignals: z.array(TelemetrySignalSchema).min(1),
});
export type TelemetryPullInstanceConfig = z.infer<
  typeof TelemetryPullInstanceConfigSchema
>;

/** Full `capability_config` payload: the satellite's complete instance set. */
export const TelemetryPullConfigSchema = z.object({
  instances: z.array(TelemetryPullInstanceConfigSchema),
});
export type TelemetryPullConfig = z.infer<typeof TelemetryPullConfigSchema>;

// =============================================================================
// capability_secret_request / response payloads (agent -> core -> agent)
// =============================================================================

/** JIT secret request: one instance config field. Binding-authorized on core. */
export const TelemetryPullSecretRequestSchema = z.object({
  instanceId: z.string(),
  field: z.string(),
});
export type TelemetryPullSecretRequest = z.infer<
  typeof TelemetryPullSecretRequestSchema
>;

/** JIT secret response. `value` is absent when the field holds no secret. */
export const TelemetryPullSecretResponseSchema = z.object({
  value: z.string().optional(),
});
export type TelemetryPullSecretResponse = z.infer<
  typeof TelemetryPullSecretResponseSchema
>;

// =============================================================================
// telemetry_batch payload (agent -> core)
// =============================================================================

/** One run's forwarded records for one instance. */
export const TelemetryPullBatchEntrySchema = z.object({
  instanceId: z.string(),
  records: WirePullRecordsSchema,
});
export type TelemetryPullBatchEntry = z.infer<
  typeof TelemetryPullBatchEntrySchema
>;

/** `telemetry_batch` payload for kind "telemetry-pull". */
export const TelemetryPullBatchSchema = z.array(TelemetryPullBatchEntrySchema);
export type TelemetryPullBatch = z.infer<typeof TelemetryPullBatchSchema>;

// =============================================================================
// capability_status payload (agent -> core)
// =============================================================================

/**
 * Per-instance run status. `consecutiveFailures` is the agent-owned absolute
 * counter (mirrors metric-scrape); core mirrors it into the source row.
 */
export const TelemetryPullStatusEntrySchema = z.object({
  instanceId: z.string(),
  lastRunAt: z.string().optional(),
  lastError: z.string().nullable().optional(),
  consecutiveFailures: z.number().int().min(0),
});
export type TelemetryPullStatusEntry = z.infer<
  typeof TelemetryPullStatusEntrySchema
>;

export const TelemetryPullStatusSchema = z.array(
  TelemetryPullStatusEntrySchema,
);
export type TelemetryPullStatus = z.infer<typeof TelemetryPullStatusSchema>;

// =============================================================================
// AGENT-SIDE EXECUTOR CONTRACT
// =============================================================================

/** Context handed to a satellite-side pull executor for one run. */
export interface SatellitePullExecutorContext {
  /** Non-secret config values (validated shape is the executor's concern). */
  config: Record<string, unknown>;
  /** JIT secret fetch for a field advertised in `secretFields`. */
  fetchSecret: (field: string) => Promise<string | undefined>;
  /** Aborted when the run exceeds the instance timeout. */
  abortSignal: AbortSignal;
  /**
   * Agent logger for run-level diagnostics an executor wants surfaced in the
   * satellite's own log (e.g. a truncated scan). Optional so bare test
   * harnesses need not supply one.
   */
  logger?: Logger;
}

/**
 * A pure, satellite-executable pull implementation for ONE source type. Ships
 * in a `*-common` leaf package the satellite build statically imports, and is
 * registered in the agent's executor registry keyed by `sourceTypeId`.
 * Transport failures throw; produced records are returned as JSON-safe wire
 * records (SSRF-guarded fetching is the executor's responsibility, using the
 * shared guard from `@checkstack/backend-api` like the scrape executor does).
 */
export interface SatellitePullExecutor {
  /** Qualified source type id this executor implements. */
  sourceTypeId: string;
  execute(ctx: SatellitePullExecutorContext): Promise<WirePullRecords>;
}
