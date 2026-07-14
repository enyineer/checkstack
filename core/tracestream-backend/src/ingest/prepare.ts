/**
 * Normalize one decoded {@link NormalizedSpan} into a {@link PreparedSpan}: the
 * clamped, byte-capped, storage-ready shape the flush folds. This is where the
 * two ingest-time policies land, at the ONE choke point every source funnels
 * through (OTLP push, native push AND the telemetry sink):
 *
 * - TIMESTAMP CLAMP: `clampSpanTimes` snaps an untrusted start into the trust
 *   window and derives a sane duration (see clamp.ts).
 * - `maxSpanBytes`: a span whose serialized attribute payloads exceed the cap has
 *   those payloads DROPPED (attributes / events / links / resourceAttributes set
 *   to null), keeping the structural span so the trace tree stays intact. DROP
 *   (not truncate) is the documented choice: a partially-truncated attribute
 *   object is more misleading than an absent one, and the span's shape - which
 *   the waterfall needs - is preserved either way. The result flags
 *   `payloadDropped`; the pipeline counts it and records a (deduped)
 *   `span_bytes_exceeded` important event so the drop is visible to operators.
 *
 * Pure module: no IO.
 */

import { clampSpanTimes } from "@checkstack/tracestream-common";
import type {
  NormalizedSpan,
  TelemetrySpanKind,
  TelemetrySpanStatusCode,
} from "@checkstack/telemetry-common";
import { floorToMinute } from "../storage";

/** A clamped, byte-capped span plus the fields the fold derives once. */
export interface PreparedSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: TelemetrySpanKind;
  serviceName: string | null;
  startTs: Date;
  endTs: Date;
  durationMs: number;
  statusCode: TelemetrySpanStatusCode;
  statusMessage: string | null;
  attributes: Record<string, unknown> | null;
  events: NonNullable<NormalizedSpan["events"]> | null;
  links: NonNullable<NormalizedSpan["links"]> | null;
  resourceAttributes: Record<string, unknown> | null;
  /** True when this span has no parent (drives the trace's root service/name). */
  isRoot: boolean;
  /** True when the span's status is `error` (drives error counts + retention). */
  isError: boolean;
  /** `startTs` floored to the minute (the op-bucket key). */
  bucketStart: Date;
  /** Approximate heap bytes, for the buffer's byte budget (OOM guard). */
  estimatedBytes: number;
}

/** The result of preparing a span: the prepared shape + whether payloads were dropped. */
export interface PreparedSpanResult {
  prepared: PreparedSpan;
  /** True when attribute payloads were dropped to honor `maxSpanBytes`. */
  payloadDropped: boolean;
}

/** Approximate the serialized byte size of a JSON-able value (0 when null). */
function jsonBytes(value: unknown): number {
  if (value === null || value === undefined) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/**
 * Prepare one normalized span for storage: clamp its timing, break out the
 * service name, and enforce `maxSpanBytes` on the attribute payloads.
 */
export function prepareSpan({
  span,
  observedAt,
  maxSpanBytes,
}: {
  span: NormalizedSpan;
  observedAt: Date;
  maxSpanBytes: number;
}): PreparedSpanResult {
  const { startTs, durationMs } = clampSpanTimes({
    startTs: span.startTs,
    endTs: span.endTs,
    observedAt,
  });
  const endTs = new Date(startTs.getTime() + durationMs);

  const serviceName = span.resource?.serviceName ?? null;
  const resourceAttributes =
    span.resource?.attributes && Object.keys(span.resource.attributes).length > 0
      ? span.resource.attributes
      : null;

  let attributes = span.attributes ?? null;
  let events = span.events ?? null;
  let links = span.links ?? null;
  let resAttrs = resourceAttributes;

  // Byte cap over the heavy JSON payloads. When over cap, DROP them (documented).
  const payloadBytes =
    jsonBytes(attributes) +
    jsonBytes(events) +
    jsonBytes(links) +
    jsonBytes(resAttrs);
  let payloadDropped = false;
  if (payloadBytes > maxSpanBytes) {
    attributes = null;
    events = null;
    links = null;
    resAttrs = null;
    payloadDropped = true;
  }

  const statusCode = span.status?.code ?? "unset";
  const parentSpanId = span.parentSpanId ?? null;

  const prepared: PreparedSpan = {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId,
    name: span.name,
    kind: span.kind,
    serviceName,
    startTs,
    endTs,
    durationMs,
    statusCode,
    statusMessage: span.status?.message ?? null,
    attributes,
    events,
    links,
    resourceAttributes: resAttrs,
    isRoot: parentSpanId === null,
    isError: statusCode === "error",
    bucketStart: floorToMinute(startTs),
    estimatedBytes:
      96 +
      span.name.length +
      (serviceName?.length ?? 0) +
      (payloadDropped ? 0 : payloadBytes),
  };

  return { prepared, payloadDropped };
}
