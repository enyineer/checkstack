/**
 * Native ingest parser: `application/x-ndjson` (one JSON object per line) or
 * `application/json` (a bare array, a `{ logs: [...] }` envelope, or a single
 * object). Recognized fields: `ts` (ISO-8601 or epoch millis; default now),
 * `level`/`severity` (level name or OTel number), `message`/`body`; everything
 * else becomes an attribute. `traceId`/`spanId`/`resource` are lifted out.
 *
 * Pure module: no IO. Malformed NDJSON lines / non-object array entries are
 * counted as rejected rather than failing the whole request.
 */

import type { IngestedLine, LogStreamConfig } from "../../schemas";
import type { NormalizedBatch } from "./otlp";
import {
  resolveSeverity,
  applySeverityValueMap,
  truncateBody,
  capAttributes,
  bodyToString,
  clampEventTimestamp,
} from "../normalize";

/** Keys consumed as first-class fields, never copied into attributes. */
const RESERVED_KEYS = new Set([
  "ts",
  "time",
  "timestamp",
  "@timestamp",
  "level",
  "severity",
  "severityNumber",
  "severity_number",
  "severityText",
  "severity_text",
  "message",
  "msg",
  "body",
  "traceId",
  "trace_id",
  "spanId",
  "span_id",
  "resource",
]);

export interface ParseNativeInput {
  /** Decoded (already gunzipped) request body text. */
  text: string;
  /** True for `application/x-ndjson` (line-delimited); false for JSON. */
  ndjson: boolean;
  config: LogStreamConfig;
  now: Date;
}

/** Parse a native ingest body into normalized lines. */
export function parseNativeBody({
  text,
  ndjson,
  config,
  now,
}: ParseNativeInput): NormalizedBatch {
  const records = ndjson ? splitNdjson(text) : splitJson(text);
  const lines: IngestedLine[] = [];
  let rejected = records.rejected;
  let clamped = 0;

  for (const record of records.objects) {
    const normalized = normalizeNativeRecord({ record, config, now });
    if (!normalized) {
      rejected += 1;
      continue;
    }
    lines.push(normalized.line);
    if (normalized.clamped) clamped += 1;
  }

  return { lines, rejected, clamped };
}

interface SplitResult {
  objects: Record<string, unknown>[];
  rejected: number;
}

function splitNdjson(text: string): SplitResult {
  const objects: Record<string, unknown>[] = [];
  let rejected = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed)) objects.push(parsed);
      else rejected += 1;
    } catch {
      rejected += 1;
    }
  }
  return { objects, rejected };
}

function splitJson(text: string): SplitResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A single unparseable JSON body rejects the whole request.
    return { objects: [], rejected: 1 };
  }

  if (Array.isArray(parsed)) {
    return collect(parsed);
  }
  if (isRecord(parsed)) {
    if (Array.isArray(parsed.logs)) return collect(parsed.logs);
    return { objects: [parsed], rejected: 0 };
  }
  return { objects: [], rejected: 1 };
}

function collect(items: unknown[]): SplitResult {
  const objects: Record<string, unknown>[] = [];
  let rejected = 0;
  for (const item of items) {
    if (isRecord(item)) objects.push(item);
    else rejected += 1;
  }
  return { objects, rejected };
}

function normalizeNativeRecord({
  record,
  config,
  now,
}: {
  record: Record<string, unknown>;
  config: LogStreamConfig;
  now: Date;
}): { line: IngestedLine; clamped: boolean } | null {
  const rawTs = parseTimestamp(
    record.ts ?? record.timestamp ?? record.time ?? record["@timestamp"],
    now,
  );

  const rawLevel = levelValue(record);
  const severity = resolveSeverity({
    severityNumber: numberOrUndefined(
      record.severityNumber ?? record.severity_number,
    ),
    level: rawLevel,
  });
  // A per-stream valueMap override wins over the default band mapping, keyed on
  // the RAW source severity value (the level/severity field).
  const band = applySeverityValueMap({
    band: severity.band,
    rawValue: rawLevel,
    valueMap: config.severityRules?.valueMap,
  });

  const rawBody = record.message ?? record.msg ?? record.body;
  const body = truncateBody({
    body: bodyToString(rawBody),
    maxBytes: config.maxLineBytes,
  });

  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!RESERVED_KEYS.has(key)) attributes[key] = value;
  }

  const { ts, clamped } = clampEventTimestamp({ ts: rawTs, observedAt: now });

  return {
    line: {
      ts,
      observedAt: now,
      severityNumber: severity.severityNumber,
      severityText: severity.severityText,
      band,
      body,
      attributes: capAttributes({ attributes }),
      resource: isRecord(record.resource)
        ? capAttributes({ attributes: record.resource })
        : undefined,
      traceId: stringOrUndefined(record.traceId ?? record.trace_id),
      spanId: stringOrUndefined(record.spanId ?? record.span_id),
    },
    clamped,
  };
}

/** A `level`/`severity` value: a level name or an OTel severity number. */
function levelValue(record: Record<string, unknown>): string | number | undefined {
  const value = record.level ?? record.severity ?? record.severityText;
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

/** Parse `ts` as ISO-8601 or epoch millis; fall back to `now` when invalid. */
function parseTimestamp(value: unknown, now: Date): Date {
  if (value === undefined || value === null) return now;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? now : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return new Date(Number.parseInt(trimmed, 10));
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return now;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
