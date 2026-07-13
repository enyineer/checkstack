/**
 * OTLP logs -> {@link IngestedLine} normalization, shared by the protobuf and
 * JSON request forms. Both decode to the protocol-neutral {@link OtlpLogsPayload}
 * ({@link decodeExportLogsServiceRequest} for protobuf, {@link parseOtlpJson} for
 * JSON), and {@link normalizeOtlpPayload} folds either into normalized lines.
 *
 * Pure module: no IO.
 */

import type { IngestedLine, LogStreamConfig } from "../../schemas";
import type { OtlpLogsPayload, OtlpLogRecord } from "../protobuf/otlp";
import {
  resolveSeverity,
  applySeverityValueMap,
  truncateBody,
  capAttributes,
  bodyToString,
  clampEventTimestamp,
} from "../normalize";

export interface NormalizedBatch {
  lines: IngestedLine[];
  /** Records that could not be normalized (OTLP partialSuccess count). */
  rejected: number;
  /**
   * Lines whose client event timestamp was outside the trust window and snapped
   * to a bound (see {@link clampEventTimestamp}). Kept, not rejected; surfaced
   * for observability.
   */
  clamped: number;
}

const NANOS_PER_MS = 1_000_000n;

function tsFromNanos(nanos: bigint, fallback: Date): Date {
  if (nanos <= 0n) return fallback;
  return new Date(Number(nanos / NANOS_PER_MS));
}

/** Fold a decoded OTLP payload into normalized ingest lines. */
export function normalizeOtlpPayload({
  payload,
  config,
  now,
}: {
  payload: OtlpLogsPayload;
  config: LogStreamConfig;
  now: Date;
}): NormalizedBatch {
  const lines: IngestedLine[] = [];
  let rejected = 0;
  let clamped = 0;

  for (const resourceLogs of payload) {
    const resource =
      Object.keys(resourceLogs.resource).length > 0
        ? capAttributes({ attributes: resourceLogs.resource })
        : undefined;

    for (const record of resourceLogs.records) {
      const normalized = normalizeRecord({ record, resource, config, now });
      if (!normalized) {
        rejected += 1;
        continue;
      }
      lines.push(normalized.line);
      if (normalized.clamped) clamped += 1;
    }
  }

  return { lines, rejected, clamped };
}

function normalizeRecord({
  record,
  resource,
  config,
  now,
}: {
  record: OtlpLogRecord;
  resource: Record<string, unknown> | undefined;
  config: LogStreamConfig;
  now: Date;
}): { line: IngestedLine; clamped: boolean } | null {
  const observedAt = now;
  const rawTs = tsFromNanos(
    record.timeUnixNano,
    tsFromNanos(record.observedTimeUnixNano, now),
  );

  const severity = resolveSeverity({
    severityNumber: record.severityNumber,
    level: record.severityText,
  });
  // A per-stream valueMap override wins over the default band mapping, keyed on
  // the RAW source severity value (OTLP `severityText`).
  const band = applySeverityValueMap({
    band: severity.band,
    rawValue: record.severityText,
    valueMap: config.severityRules?.valueMap,
  });

  const body = truncateBody({
    body: bodyToString(record.body),
    maxBytes: config.maxLineBytes,
  });
  const attributes = capAttributes({ attributes: record.attributes });

  // Normalization is otherwise tolerant, so this is the ONLY path that feeds
  // OTLP `partialSuccess.rejectedLogRecords`: a record carrying no usable
  // content (empty body AND no attributes) is meaningless as a log line.
  if (body.length === 0 && !attributes) return null;

  const { ts, clamped } = clampEventTimestamp({ ts: rawTs, observedAt });

  return {
    line: {
      ts,
      observedAt,
      severityNumber: severity.severityNumber,
      severityText: severity.severityText,
      band,
      body,
      attributes,
      resource,
      traceId: record.traceId || undefined,
      spanId: record.spanId || undefined,
    },
    clamped,
  };
}

// -----------------------------------------------------------------------------
// OTLP/JSON -> OtlpLogsPayload
// -----------------------------------------------------------------------------

/**
 * Parse an OTLP/JSON `ExportLogsServiceRequest` body into the neutral payload.
 * Tolerant of the proto-JSON mapping: camelCase or snake_case keys, `int64`
 * timestamps as strings or numbers, and `severityNumber` as a number or an
 * OTel enum name. Malformed sub-parts are skipped rather than throwing.
 */
export function parseOtlpJson(input: unknown): OtlpLogsPayload {
  const root = asRecord(input);
  if (!root) return [];
  const resourceLogs = asArray(pick(root, "resourceLogs", "resource_logs"));
  const out: OtlpLogsPayload = [];

  for (const rlRaw of resourceLogs) {
    const rl = asRecord(rlRaw);
    if (!rl) continue;
    const resourceObj = asRecord(pick(rl, "resource"));
    const resource = resourceObj
      ? kvListToObject(asArray(pick(resourceObj, "attributes")))
      : {};

    const records: OtlpLogRecord[] = [];
    for (const slRaw of asArray(pick(rl, "scopeLogs", "scope_logs"))) {
      const sl = asRecord(slRaw);
      if (!sl) continue;
      for (const recRaw of asArray(pick(sl, "logRecords", "log_records"))) {
        const record = jsonLogRecord(asRecord(recRaw));
        if (record) records.push(record);
      }
    }
    out.push({ resource, records });
  }
  return out;
}

function jsonLogRecord(rec: Record<string, unknown> | null): OtlpLogRecord | null {
  if (!rec) return null;
  const attributes = kvListToObject(asArray(pick(rec, "attributes")));
  const severityText = asString(pick(rec, "severityText", "severity_text"));
  return {
    timeUnixNano: asBigint(pick(rec, "timeUnixNano", "time_unix_nano")),
    observedTimeUnixNano: asBigint(
      pick(rec, "observedTimeUnixNano", "observed_time_unix_nano"),
    ),
    severityNumber: jsonSeverityNumber(
      pick(rec, "severityNumber", "severity_number"),
    ),
    severityText: severityText ?? undefined,
    body: resolveJsonAnyValue(pick(rec, "body")),
    attributes,
    traceId: hexOrUndefined(asString(pick(rec, "traceId", "trace_id"))),
    spanId: hexOrUndefined(asString(pick(rec, "spanId", "span_id"))),
  };
}

/** Map a JSON `severityNumber` (number or OTel enum name) to its int value. */
function jsonSeverityNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
    const fromEnum = OTEL_SEVERITY_ENUM[trimmed.toUpperCase()];
    if (fromEnum !== undefined) return fromEnum;
  }
  return 0;
}

/** Canonical OTel `SeverityNumber` enum names -> numeric value. */
const OTEL_SEVERITY_ENUM: Record<string, number> = (() => {
  const bases: Array<[string, number]> = [
    ["TRACE", 1],
    ["DEBUG", 5],
    ["INFO", 9],
    ["WARN", 13],
    ["ERROR", 17],
    ["FATAL", 21],
  ];
  const map: Record<string, number> = { SEVERITY_NUMBER_UNSPECIFIED: 0 };
  for (const [name, base] of bases) {
    for (let i = 0; i < 4; i += 1) {
      const suffix = i === 0 ? "" : String(i + 1);
      map[`SEVERITY_NUMBER_${name}${suffix}`] = base + i;
      map[`${name}${suffix}`] = base + i;
    }
  }
  return map;
})();

/** Resolve an OTLP/JSON AnyValue object to a plain value. */
function resolveJsonAnyValue(value: unknown): unknown {
  const obj = asRecord(value);
  if (!obj) return value ?? null;
  if ("stringValue" in obj) return obj.stringValue;
  if ("string_value" in obj) return obj.string_value;
  if ("boolValue" in obj) return Boolean(obj.boolValue);
  if ("bool_value" in obj) return Boolean(obj.bool_value);
  if ("intValue" in obj) return Number(obj.intValue);
  if ("int_value" in obj) return Number(obj.int_value);
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

// -----------------------------------------------------------------------------
// small tolerant accessors
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

/** OTLP/JSON trace/span ids may be hex or base64; keep hex, decode base64. */
function hexOrUndefined(value: string | null): string | undefined {
  if (!value) return undefined;
  if (/^[0-9a-fA-F]+$/.test(value)) return value.toLowerCase();
  // base64 fallback (proto-JSON default for bytes).
  try {
    const bytes = Uint8Array.from(Buffer.from(value, "base64"));
    if (bytes.length === 0) return undefined;
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex;
  } catch {
    return undefined;
  }
}
