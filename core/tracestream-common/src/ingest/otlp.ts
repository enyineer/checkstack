/**
 * OTLP TRACES field mapping over the shared protobuf primitives and the
 * signal-agnostic OTLP structure readers from `@checkstack/otlp-wire`. Decodes an
 * `ExportTraceServiceRequest` (the body OTLP/HTTP trace shippers POST, in
 * protobuf OR the proto3-JSON flavor) into normalized
 * {@link NormalizedSpan}s from `@checkstack/telemetry-common` - the SAME shape
 * the telemetry sink hands the pipeline, so a span keys onto identical storage
 * no matter how it entered the platform.
 *
 * Field numbers follow the stable OpenTelemetry proto definitions
 * (`opentelemetry/proto/trace/v1/trace.proto`,
 * `opentelemetry/proto/collector/trace/v1/trace_service.proto`). The
 * `AnyValue` / `KeyValue` / `Resource` readers and the recursion depth guard are
 * shared; only the trace-specific message decoding lives here. Unknown fields
 * are skipped, so a newer producer decodes fine. Hostile-input hardened (id
 * length validation, capped attributes/events/links). Pure module: no IO, no
 * node builtins - browser-safe.
 */

import {
  ProtoReader,
  bytesToHex,
  readAttribute,
  readResource,
} from "@checkstack/otlp-wire";
import {
  TELEMETRY_SPAN_KINDS,
  type NormalizedSpan,
  type NormalizedSpanEvent,
  type NormalizedSpanLink,
  type TelemetryResource,
  type TelemetrySpanKind,
  type TelemetrySpanStatusCode,
} from "@checkstack/telemetry-common";

/** OTel `Span.SpanKind` enum value -> our normalized kind. Unspecified -> internal. */
const SPAN_KIND_BY_NUMBER: Record<number, TelemetrySpanKind> = {
  0: "internal",
  1: "internal",
  2: "server",
  3: "client",
  4: "producer",
  5: "consumer",
};

/** OTel `Status.StatusCode` enum value -> our normalized status code. */
const STATUS_CODE_BY_NUMBER: Record<number, TelemetrySpanStatusCode> = {
  0: "unset",
  1: "ok",
  2: "error",
};

/** Hard caps against a hostile export (a single span with millions of items). */
const MAX_ATTRIBUTES_PER_SPAN = 256;
const MAX_EVENTS_PER_SPAN = 128;
const MAX_LINKS_PER_SPAN = 128;

const NANOS_PER_MS = 1_000_000n;

/** The decode result: the normalized spans plus the count of rejected records. */
export interface DecodedTraces {
  spans: NormalizedSpan[];
  /**
   * Records that could NOT be normalized (invalid trace/span id length) -
   * surfaced as OTLP `partialSuccess.rejectedSpans`.
   */
  rejected: number;
}

/** Convert OTel unix-nanos to a millisecond `Date` (0/absent -> epoch, clamped later). */
function dateFromNanos(nanos: bigint): Date {
  if (nanos <= 0n) return new Date(0);
  return new Date(Number(nanos / NANOS_PER_MS));
}

// -----------------------------------------------------------------------------
// protobuf: ExportTraceServiceRequest
// -----------------------------------------------------------------------------

function readStatus(reader: ProtoReader): {
  code: TelemetrySpanStatusCode;
  message?: string;
} {
  let code = 0;
  let message: string | undefined;
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 2: {
        message = reader.readString();
        break;
      }
      case 3: {
        code = reader.readVarintNumber();
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return { code: STATUS_CODE_BY_NUMBER[code] ?? "unset", message };
}

function readSpanEvent(reader: ProtoReader): NormalizedSpanEvent {
  let timeUnixNano = 0n;
  let name = "";
  const attributes: Record<string, unknown> = {};
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: {
        timeUnixNano = reader.readFixed64();
        break;
      }
      case 2: {
        name = reader.readString();
        break;
      }
      case 3: {
        if (Object.keys(attributes).length < MAX_ATTRIBUTES_PER_SPAN) {
          Object.assign(
            attributes,
            readAttribute(new ProtoReader(reader.readBytes())),
          );
        } else {
          reader.skip(wireType);
        }
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return {
    ts: dateFromNanos(timeUnixNano),
    name,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
  };
}

function readSpanLink(reader: ProtoReader): NormalizedSpanLink | null {
  let traceId = "";
  let spanId = "";
  const attributes: Record<string, unknown> = {};
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: {
        traceId = bytesToHex(reader.readBytes());
        break;
      }
      case 2: {
        spanId = bytesToHex(reader.readBytes());
        break;
      }
      case 4: {
        if (Object.keys(attributes).length < MAX_ATTRIBUTES_PER_SPAN) {
          Object.assign(
            attributes,
            readAttribute(new ProtoReader(reader.readBytes())),
          );
        } else {
          reader.skip(wireType);
        }
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  if (traceId.length !== 32 || spanId.length !== 16) return null;
  return {
    traceId,
    spanId,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
  };
}

/** Decode one `Span`, or null when its ids are the wrong length (rejected). */
function readSpan(
  reader: ProtoReader,
  resource: TelemetryResource | undefined,
): NormalizedSpan | null {
  let traceId = "";
  let spanId = "";
  let parentSpanId: string | undefined;
  let name = "";
  let kind = 0;
  let startNano = 0n;
  let endNano = 0n;
  const attributes: Record<string, unknown> = {};
  const events: NormalizedSpanEvent[] = [];
  const links: NormalizedSpanLink[] = [];
  let status: { code: TelemetrySpanStatusCode; message?: string } | undefined;

  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: {
        traceId = bytesToHex(reader.readBytes());
        break;
      }
      case 2: {
        spanId = bytesToHex(reader.readBytes());
        break;
      }
      case 4: {
        const parent = bytesToHex(reader.readBytes());
        parentSpanId = parent.length > 0 ? parent : undefined;
        break;
      }
      case 5: {
        name = reader.readString();
        break;
      }
      case 6: {
        kind = reader.readVarintNumber();
        break;
      }
      case 7: {
        startNano = reader.readFixed64();
        break;
      }
      case 8: {
        endNano = reader.readFixed64();
        break;
      }
      case 9: {
        if (Object.keys(attributes).length < MAX_ATTRIBUTES_PER_SPAN) {
          Object.assign(
            attributes,
            readAttribute(new ProtoReader(reader.readBytes())),
          );
        } else {
          reader.skip(wireType);
        }
        break;
      }
      case 11: {
        if (events.length < MAX_EVENTS_PER_SPAN) {
          events.push(readSpanEvent(new ProtoReader(reader.readBytes())));
        } else {
          reader.skip(wireType);
        }
        break;
      }
      case 13: {
        if (links.length < MAX_LINKS_PER_SPAN) {
          const link = readSpanLink(new ProtoReader(reader.readBytes()));
          if (link) links.push(link);
        } else {
          reader.skip(wireType);
        }
        break;
      }
      case 15: {
        status = readStatus(new ProtoReader(reader.readBytes()));
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }

  return buildSpan({
    traceId,
    spanId,
    parentSpanId,
    name,
    kind: SPAN_KIND_BY_NUMBER[kind] ?? "internal",
    startTs: dateFromNanos(startNano),
    endTs: dateFromNanos(endNano > 0n ? endNano : startNano),
    startUnixNano: startNano > 0n ? startNano : undefined,
    endUnixNano: endNano > 0n ? endNano : undefined,
    status,
    attributes,
    events,
    links,
    resource,
  });
}

function readScopeSpans(
  reader: ProtoReader,
  resource: TelemetryResource | undefined,
  out: DecodedTraces,
): void {
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 2) {
      const span = readSpan(new ProtoReader(reader.readBytes()), resource);
      if (span) out.spans.push(span);
      else out.rejected += 1;
    } else {
      reader.skip(wireType);
    }
  }
}

function readResourceSpans(reader: ProtoReader, out: DecodedTraces): void {
  let resourceAttributes: Record<string, unknown> = {};
  const scopeReaders: ProtoReader[] = [];
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: {
        resourceAttributes = readResource(new ProtoReader(reader.readBytes()));
        break;
      }
      case 2: {
        // Buffer scope readers: the resource (field 1) may arrive after some
        // scope_spans, so decode scopes only once the resource is known.
        scopeReaders.push(new ProtoReader(reader.readBytes()));
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  const resource = toResource(resourceAttributes);
  for (const scope of scopeReaders) readScopeSpans(scope, resource, out);
}

/** Decode an `ExportTraceServiceRequest` from protobuf bytes. */
export function decodeExportTraceServiceRequest(buf: Uint8Array): DecodedTraces {
  const reader = new ProtoReader(buf);
  const out: DecodedTraces = { spans: [], rejected: 0 };
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) {
      readResourceSpans(new ProtoReader(reader.readBytes()), out);
    } else {
      reader.skip(wireType);
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// shared span builder (validation + resource fold)
// -----------------------------------------------------------------------------

/** Fold a resource attribute record into a {@link TelemetryResource} (service.name broken out). */
function toResource(
  attributes: Record<string, unknown>,
): TelemetryResource | undefined {
  const keys = Object.keys(attributes);
  if (keys.length === 0) return undefined;
  const serviceNameRaw = attributes["service.name"];
  const serviceName =
    typeof serviceNameRaw === "string" && serviceNameRaw.length > 0
      ? serviceNameRaw
      : undefined;
  return { serviceName, attributes };
}

/** Assemble a validated {@link NormalizedSpan}, or null when the ids are malformed. */
function buildSpan({
  traceId,
  spanId,
  parentSpanId,
  name,
  kind,
  startTs,
  endTs,
  startUnixNano,
  endUnixNano,
  status,
  attributes,
  events,
  links,
  resource,
}: {
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  name: string;
  kind: TelemetrySpanKind;
  startTs: Date;
  endTs: Date;
  startUnixNano: bigint | undefined;
  endUnixNano: bigint | undefined;
  status: { code: TelemetrySpanStatusCode; message?: string } | undefined;
  attributes: Record<string, unknown>;
  events: NormalizedSpanEvent[];
  links: NormalizedSpanLink[];
  resource: TelemetryResource | undefined;
}): NormalizedSpan | null {
  // W3C ids: trace id 32 hex chars, span id 16. A malformed id makes the span
  // unjoinable to its trace, so it is rejected (counted for partialSuccess).
  if (traceId.length !== 32 || spanId.length !== 16) return null;
  const parent =
    parentSpanId !== undefined && parentSpanId.length === 16
      ? parentSpanId
      : undefined;

  return {
    traceId,
    spanId,
    parentSpanId: parent,
    // OTel requires a name; tolerate an empty one so a mislabeled span is still
    // joinable (`NormalizedSpan.name` is min-length 1).
    name: name.length > 0 ? name : "unknown",
    kind,
    startTs,
    endTs,
    startUnixNano,
    endUnixNano,
    status: status && (status.code !== "unset" || status.message) ? status : undefined,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    events: events.length > 0 ? events : undefined,
    links: links.length > 0 ? links : undefined,
    resource,
  };
}

// -----------------------------------------------------------------------------
// OTLP/JSON: ExportTraceServiceRequest
// -----------------------------------------------------------------------------

/**
 * Parse an OTLP/JSON `ExportTraceServiceRequest` body into normalized spans.
 * Tolerant of the proto3-JSON mapping: camelCase or snake_case keys, `int64`
 * timestamps as strings or numbers, `spanKind`/`code` as a number or an OTel
 * enum name, and ids as hex OR base64. Malformed sub-parts are skipped; spans
 * with a bad id are counted as rejected.
 */
export function parseOtlpTracesJson(input: unknown): DecodedTraces {
  const out: DecodedTraces = { spans: [], rejected: 0 };
  const root = asRecord(input);
  if (!root) return out;

  for (const rsRaw of asArray(pick(root, "resourceSpans", "resource_spans"))) {
    const rs = asRecord(rsRaw);
    if (!rs) continue;
    const resourceObj = asRecord(pick(rs, "resource"));
    const resourceAttributes = resourceObj
      ? kvListToObject(asArray(pick(resourceObj, "attributes")))
      : {};
    const resource = toResource(resourceAttributes);

    for (const ssRaw of asArray(pick(rs, "scopeSpans", "scope_spans"))) {
      const ss = asRecord(ssRaw);
      if (!ss) continue;
      for (const spanRaw of asArray(pick(ss, "spans"))) {
        const span = jsonSpan(asRecord(spanRaw), resource);
        if (span) out.spans.push(span);
        else out.rejected += 1;
      }
    }
  }
  return out;
}

function jsonSpan(
  rec: Record<string, unknown> | null,
  resource: TelemetryResource | undefined,
): NormalizedSpan | null {
  if (!rec) return null;
  const traceId = hexId(asString(pick(rec, "traceId", "trace_id")), 32);
  const spanId = hexId(asString(pick(rec, "spanId", "span_id")), 16);
  if (traceId === null || spanId === null) return null;

  const parentSpanId =
    hexId(asString(pick(rec, "parentSpanId", "parent_span_id")), 16) ??
    undefined;

  const attributes = capRecord(
    kvListToObject(asArray(pick(rec, "attributes"))),
    MAX_ATTRIBUTES_PER_SPAN,
  );
  const events = asArray(pick(rec, "events"))
    .slice(0, MAX_EVENTS_PER_SPAN)
    .map((raw) => jsonSpanEvent(asRecord(raw)))
    .filter((event): event is NormalizedSpanEvent => event !== null);
  const links = asArray(pick(rec, "links"))
    .slice(0, MAX_LINKS_PER_SPAN)
    .map((raw) => jsonSpanLink(asRecord(raw)))
    .filter((link): link is NormalizedSpanLink => link !== null);

  const startNano = asBigint(pick(rec, "startTimeUnixNano", "start_time_unix_nano"));
  const endNano = asBigint(pick(rec, "endTimeUnixNano", "end_time_unix_nano"));

  const statusObj = asRecord(pick(rec, "status"));
  const status = statusObj
    ? {
        code: jsonStatusCode(pick(statusObj, "code")),
        message: asString(pick(statusObj, "message")) ?? undefined,
      }
    : undefined;

  return buildSpan({
    traceId,
    spanId,
    parentSpanId,
    name: asString(pick(rec, "name")) ?? "",
    kind: jsonSpanKind(pick(rec, "kind")),
    startTs: dateFromNanos(startNano),
    endTs: dateFromNanos(endNano > 0n ? endNano : startNano),
    startUnixNano: startNano > 0n ? startNano : undefined,
    endUnixNano: endNano > 0n ? endNano : undefined,
    status,
    attributes: attributes ?? {},
    events,
    links,
    resource,
  });
}

function jsonSpanEvent(rec: Record<string, unknown> | null): NormalizedSpanEvent | null {
  if (!rec) return null;
  const attributes = capRecord(
    kvListToObject(asArray(pick(rec, "attributes"))),
    MAX_ATTRIBUTES_PER_SPAN,
  );
  return {
    ts: dateFromNanos(asBigint(pick(rec, "timeUnixNano", "time_unix_nano"))),
    name: asString(pick(rec, "name")) ?? "",
    attributes,
  };
}

function jsonSpanLink(rec: Record<string, unknown> | null): NormalizedSpanLink | null {
  if (!rec) return null;
  const traceId = hexId(asString(pick(rec, "traceId", "trace_id")), 32);
  const spanId = hexId(asString(pick(rec, "spanId", "span_id")), 16);
  if (traceId === null || spanId === null) return null;
  return {
    traceId,
    spanId,
    attributes: capRecord(
      kvListToObject(asArray(pick(rec, "attributes"))),
      MAX_ATTRIBUTES_PER_SPAN,
    ),
  };
}

/** Map a JSON `spanKind` (number or `SPAN_KIND_*` enum name) to our kind. */
function jsonSpanKind(value: unknown): TelemetrySpanKind {
  if (typeof value === "number" && Number.isFinite(value)) {
    return SPAN_KIND_BY_NUMBER[value] ?? "internal";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return SPAN_KIND_BY_NUMBER[Number.parseInt(trimmed, 10)] ?? "internal";
    }
    const upper = trimmed.toUpperCase();
    for (const kind of TELEMETRY_SPAN_KINDS) {
      if (upper === `SPAN_KIND_${kind.toUpperCase()}` || upper === kind.toUpperCase()) {
        return kind;
      }
    }
  }
  return "internal";
}

/** Map a JSON status `code` (number or `STATUS_CODE_*` enum name) to our code. */
function jsonStatusCode(value: unknown): TelemetrySpanStatusCode {
  if (typeof value === "number" && Number.isFinite(value)) {
    return STATUS_CODE_BY_NUMBER[value] ?? "unset";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return STATUS_CODE_BY_NUMBER[Number.parseInt(trimmed, 10)] ?? "unset";
    }
    const upper = trimmed.toUpperCase();
    if (upper.endsWith("ERROR")) return "error";
    if (upper.endsWith("OK")) return "ok";
  }
  return "unset";
}

// -----------------------------------------------------------------------------
// Export*ServiceResponse (JSON form; the protobuf form is in @checkstack/otlp-wire)
// -----------------------------------------------------------------------------

/**
 * Build the OTLP/JSON `ExportTraceServiceResponse` body. Empty (`{}`) on full
 * success; otherwise `partialSuccess { rejectedSpans, errorMessage }`. The
 * protobuf form uses `encodeExportServiceResponse` from `@checkstack/otlp-wire`.
 */
export function exportTraceServiceResponseJson(partial?: {
  rejectedSpans: number;
  errorMessage: string;
}): Record<string, unknown> {
  if (!partial || partial.rejectedSpans <= 0) return {};
  return {
    partialSuccess: {
      rejectedSpans: partial.rejectedSpans,
      errorMessage: partial.errorMessage,
    },
  };
}

// -----------------------------------------------------------------------------
// small tolerant JSON accessors + shared readers reused across proto/json
// -----------------------------------------------------------------------------

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined) return obj[key];
  }
  return undefined;
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

function asBigint(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return 0n;
}

/** Cap a record to `max` entries (keeps the first `max` keys). */
function capRecord(
  record: Record<string, unknown>,
  max: number,
): Record<string, unknown> | undefined {
  const keys = Object.keys(record);
  if (keys.length === 0) return undefined;
  if (keys.length <= max) return record;
  const capped: Record<string, unknown> = {};
  for (const key of keys.slice(0, max)) capped[key] = record[key];
  return capped;
}

/**
 * OTLP/JSON trace/span ids may be hex or base64 (proto-JSON default for bytes).
 * Return the lowercase hex when it has exactly `expectedLength` chars, else null.
 */
function hexId(value: string | null, expectedLength: number): string | null {
  if (!value) return null;
  if (/^[0-9a-fA-F]+$/.test(value)) {
    return value.length === expectedLength ? value.toLowerCase() : null;
  }
  // base64 fallback.
  const hex = base64ToHex(value);
  return hex !== null && hex.length === expectedLength ? hex : null;
}

/** Decode a base64 string to lowercase hex, or null when it is not valid base64. */
function base64ToHex(value: string): string | null {
  try {
    const binary = atob(value);
    let hex = "";
    for (let i = 0; i < binary.length; i += 1) {
      hex += (binary.codePointAt(i) ?? 0).toString(16).padStart(2, "0");
    }
    return hex;
  } catch {
    return null;
  }
}

/**
 * proto3-JSON encodes an int64 as a STRING (values can exceed 2^53). Parse to a
 * `number` only when it round-trips as a safe integer; otherwise keep the
 * original string so precision (and thus display fidelity) is never silently
 * lost. A numeric input is returned as-is.
 */
function resolveJsonInt64(raw: unknown): number | string {
  if (typeof raw === "number") return raw;
  const text = String(raw);
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : text;
}

/** Resolve an OTLP/JSON AnyValue object to a plain value. */
function resolveJsonAnyValue(value: unknown): unknown {
  const obj = asRecord(value);
  if (!obj) return value ?? null;
  if ("stringValue" in obj) return obj.stringValue;
  if ("string_value" in obj) return obj.string_value;
  if ("boolValue" in obj) return Boolean(obj.boolValue);
  if ("bool_value" in obj) return Boolean(obj.bool_value);
  if ("intValue" in obj) return resolveJsonInt64(obj.intValue);
  if ("int_value" in obj) return resolveJsonInt64(obj.int_value);
  if ("doubleValue" in obj) return Number(obj.doubleValue);
  if ("double_value" in obj) return Number(obj.double_value);
  const arr = pick(obj, "arrayValue", "array_value");
  if (arr) {
    const values = asArray(pick(asRecord(arr) ?? {}, "values"));
    return values.map((v) => resolveJsonAnyValue(v));
  }
  const kv = pick(obj, "kvlistValue", "kvlist_value");
  if (kv) return kvListToObject(asArray(pick(asRecord(kv) ?? {}, "values")));
  return null;
}

function kvListToObject(list: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of list) {
    const kv = asRecord(raw);
    if (!kv) continue;
    const key = asString(pick(kv, "key"));
    if (key === null) continue;
    out[key] = resolveJsonAnyValue(pick(kv, "value"));
  }
  return out;
}

