/**
 * Native ingest parser for the `POST /api/metricstream/ingest` push endpoint.
 * Accepts a JSON array `[{ name, type?, counterKind?, value, unit?, labels?, ts? }]`,
 * a `{ metrics: [...] }` envelope, a single object, or line-delimited NDJSON.
 *
 * Field semantics:
 *   - `name` (required), `value` (required finite number) - a record missing
 *     either is rejected (counted, not fatal).
 *   - `type` defaults to `gauge`; `counterKind` defaults to `cumulative` for a
 *     counter and is dropped for a gauge.
 *   - `labels` values are coerced to strings; `ts` accepts an ISO-8601 string or
 *     epoch millis (default: receive time). The sink clamps `ts` afterwards.
 *
 * Pure module: no IO. A wholly-unparseable body yields zero datapoints.
 */

import {
  MetricTypeSchema,
  CounterKindSchema,
  type CounterKind,
  type MetricType,
  type NormalizedDatapoint,
} from "../../schemas";

export interface NativeParseResult {
  datapoints: NormalizedDatapoint[];
  /** Records that could not be represented (missing name/value, malformed). */
  rejected: number;
}

export function parseNativeMetricsBody({
  text,
  ndjson,
  now,
}: {
  text: string;
  ndjson: boolean;
  now: Date;
}): NativeParseResult {
  const split = ndjson ? splitNdjson(text) : splitJson(text);
  const datapoints: NormalizedDatapoint[] = [];
  let rejected = split.rejected;

  for (const record of split.objects) {
    const dp = normalizeRecord({ record, now });
    if (!dp) {
      rejected += 1;
      continue;
    }
    datapoints.push(dp);
  }
  return { datapoints, rejected };
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
      const parsed: unknown = JSON.parse(line);
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
    return { objects: [], rejected: 1 };
  }
  if (Array.isArray(parsed)) return collect(parsed);
  if (isRecord(parsed)) {
    if (Array.isArray(parsed.metrics)) return collect(parsed.metrics);
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

function normalizeRecord({
  record,
  now,
}: {
  record: Record<string, unknown>;
  now: Date;
}): NormalizedDatapoint | null {
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name.length === 0) return null;

  const value = asFiniteNumber(record.value);
  if (value === null) return null;

  const type = parseType(record.type);
  const counterKind = type === "counter" ? parseCounterKind(record.counterKind) : undefined;
  const unit = typeof record.unit === "string" ? record.unit : undefined;
  const labels = parseLabels(record.labels);
  const ts = parseTs(record.ts, now);

  return { name, type, counterKind, unit, labels, value, ts };
}

function parseType(value: unknown): MetricType {
  const result = MetricTypeSchema.safeParse(value);
  return result.success ? result.data : "gauge";
}

function parseCounterKind(value: unknown): CounterKind {
  const result = CounterKindSchema.safeParse(value);
  return result.success ? result.data : "cumulative";
}

function parseLabels(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const labels: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") labels[key] = raw;
    else if (typeof raw === "number" || typeof raw === "boolean") labels[key] = String(raw);
  }
  return labels;
}

function parseTs(value: unknown, now: Date): Date {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value.trim());
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return now;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
