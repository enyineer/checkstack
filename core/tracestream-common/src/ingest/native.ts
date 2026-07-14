/**
 * Native JSON span ingest format -> normalized {@link NormalizedSpan}s. A simpler
 * alternative to OTLP for shippers that emit plain JSON: either a top-level array
 * of spans, or a `{ "spans": [...] }` envelope. Each span uses the SAME field
 * names as the stored {@link TraceSpan} (minus the server-assigned `id`), with
 * ids as lowercase hex strings and timestamps as ISO-8601 strings OR epoch
 * milliseconds. `serviceName` + `resourceAttributes` fold into the normalized
 * resource. Tolerant: a malformed span is skipped and counted, never thrown.
 *
 * Pure module: no IO, no node builtins - browser-safe.
 */

import {
  TELEMETRY_SPAN_KINDS,
  TELEMETRY_SPAN_STATUS_CODES,
  type NormalizedSpan,
  type NormalizedSpanEvent,
  type NormalizedSpanLink,
  type TelemetryResource,
  type TelemetrySpanKind,
  type TelemetrySpanStatusCode,
} from "@checkstack/telemetry-common";
import type { DecodedTraces } from "./otlp";

const MAX_ATTRIBUTES_PER_SPAN = 256;
const MAX_EVENTS_PER_SPAN = 128;
const MAX_LINKS_PER_SPAN = 128;

/**
 * Parse a native-JSON traces body (already `JSON.parse`d) into normalized spans.
 * Accepts a bare array of spans or a `{ spans: [...] }` envelope. Spans with a
 * malformed trace/span id are counted as rejected (surfaced to the caller).
 */
export function parseNativeTraces(input: unknown): DecodedTraces {
  const out: DecodedTraces = { spans: [], rejected: 0 };
  const list = Array.isArray(input)
    ? input
    : asArray(pick(asRecord(input) ?? {}, "spans"));

  for (const raw of list) {
    const span = nativeSpan(asRecord(raw));
    if (span) out.spans.push(span);
    else out.rejected += 1;
  }
  return out;
}

function nativeSpan(rec: Record<string, unknown> | null): NormalizedSpan | null {
  if (!rec) return null;
  const traceId = hexId(asString(pick(rec, "traceId")), 32);
  const spanId = hexId(asString(pick(rec, "spanId")), 16);
  if (traceId === null || spanId === null) return null;

  const parentSpanId = hexId(asString(pick(rec, "parentSpanId")), 16) ?? undefined;

  const startTs = toDate(pick(rec, "startTs"));
  if (!startTs) return null;
  const durationMs = asFiniteNumber(pick(rec, "durationMs"));
  const endTs =
    toDate(pick(rec, "endTs")) ??
    (durationMs === null ? startTs : new Date(startTs.getTime() + Math.max(0, durationMs)));

  const attributes = capRecord(asRecord(pick(rec, "attributes")), MAX_ATTRIBUTES_PER_SPAN);
  const resource = toResource({
    serviceName: asString(pick(rec, "serviceName")),
    resourceAttributes: asRecord(pick(rec, "resourceAttributes")),
  });

  const statusMessage = asString(pick(rec, "statusMessage")) ?? undefined;
  const statusCode = toStatusCode(pick(rec, "statusCode"));
  const status =
    statusCode !== "unset" || statusMessage
      ? { code: statusCode, message: statusMessage }
      : undefined;

  const name = asString(pick(rec, "name"));

  return {
    traceId,
    spanId,
    parentSpanId,
    name: name && name.length > 0 ? name : "unknown",
    kind: toKind(pick(rec, "kind")),
    startTs,
    endTs,
    status,
    attributes,
    events: nativeEvents(pick(rec, "events")),
    links: nativeLinks(pick(rec, "links")),
    resource,
  };
}

function nativeEvents(value: unknown): NormalizedSpanEvent[] | undefined {
  const events: NormalizedSpanEvent[] = [];
  for (const raw of asArray(value).slice(0, MAX_EVENTS_PER_SPAN)) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const ts = toDate(pick(rec, "ts"));
    if (!ts) continue;
    events.push({
      ts,
      name: asString(pick(rec, "name")) ?? "",
      attributes: capRecord(asRecord(pick(rec, "attributes")), MAX_ATTRIBUTES_PER_SPAN),
    });
  }
  return events.length > 0 ? events : undefined;
}

function nativeLinks(value: unknown): NormalizedSpanLink[] | undefined {
  const links: NormalizedSpanLink[] = [];
  for (const raw of asArray(value).slice(0, MAX_LINKS_PER_SPAN)) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const traceId = hexId(asString(pick(rec, "traceId")), 32);
    const spanId = hexId(asString(pick(rec, "spanId")), 16);
    if (traceId === null || spanId === null) continue;
    links.push({
      traceId,
      spanId,
      attributes: capRecord(asRecord(pick(rec, "attributes")), MAX_ATTRIBUTES_PER_SPAN),
    });
  }
  return links.length > 0 ? links : undefined;
}

/** Fold native `serviceName` + `resourceAttributes` into a {@link TelemetryResource}. */
function toResource({
  serviceName,
  resourceAttributes,
}: {
  serviceName: string | null;
  resourceAttributes: Record<string, unknown> | null;
}): TelemetryResource | undefined {
  const attributes = resourceAttributes ?? undefined;
  const svc = serviceName && serviceName.length > 0 ? serviceName : undefined;
  if (!svc && (!attributes || Object.keys(attributes).length === 0)) return undefined;
  return { serviceName: svc, attributes };
}

// -----------------------------------------------------------------------------
// tolerant accessors
// -----------------------------------------------------------------------------

function pick(obj: Record<string, unknown>, key: string): unknown {
  return key in obj ? obj[key] : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Parse an ISO-8601 string or epoch-ms number into a Date, or null when invalid. */
function toDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string" && value.length > 0) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms);
    // A numeric epoch-ms string.
    if (/^\d+$/.test(value.trim())) return new Date(Number.parseInt(value.trim(), 10));
  }
  return null;
}

function toKind(value: unknown): TelemetrySpanKind {
  const s = asString(value);
  if (s && (TELEMETRY_SPAN_KINDS as readonly string[]).includes(s)) {
    return s as TelemetrySpanKind;
  }
  return "internal";
}

function toStatusCode(value: unknown): TelemetrySpanStatusCode {
  const s = asString(value);
  if (s && (TELEMETRY_SPAN_STATUS_CODES as readonly string[]).includes(s)) {
    return s as TelemetrySpanStatusCode;
  }
  return "unset";
}

function capRecord(
  record: Record<string, unknown> | null,
  max: number,
): Record<string, unknown> | undefined {
  if (!record) return undefined;
  const keys = Object.keys(record);
  if (keys.length === 0) return undefined;
  if (keys.length <= max) return record;
  const capped: Record<string, unknown> = {};
  for (const key of keys.slice(0, max)) capped[key] = record[key];
  return capped;
}

/** Return the lowercase hex when it has exactly `expectedLength` chars, else null. */
function hexId(value: string | null, expectedLength: number): string | null {
  if (!value) return null;
  if (!/^[0-9a-fA-F]+$/.test(value)) return null;
  return value.length === expectedLength ? value.toLowerCase() : null;
}
