/**
 * Prometheus text exposition format parser
 * (`Content-Type: text/plain; version=0.0.4`). Folds a scraped body into
 * normalized datapoints, applying the metricstream metric model:
 *
 * - `# TYPE`/`# HELP` metadata lines drive per-metric typing; unknown metrics
 *   default to gauge (Prometheus "untyped").
 * - counter -> counter (`cumulative`); gauge / untyped -> gauge.
 * - HISTOGRAM is decomposed: `<base>_bucket` samples are DROPPED (no percentiles
 *   v1) and `<base>_sum` / `<base>_count` are kept as cumulative counters.
 * - SUMMARY is decomposed: the quantile samples (`<base>{quantile="..."}`) are
 *   DROPPED and `<base>_sum` / `<base>_count` are kept as cumulative counters.
 * - Label values are unescaped (`\\`, `\"`, `\n`); an optional trailing sample
 *   timestamp (epoch millis) is honored, else receive time is used; trailing
 *   OpenMetrics exemplars (` # ...`) are ignored.
 * - Non-finite sample values (`NaN`, `+Inf`, `-Inf`) are skipped (they would
 *   corrupt min/max/sum aggregates) rather than persisted.
 *
 * Pure module: no IO. Malformed lines are skipped, not fatal.
 */

import type {
  CounterKind,
  MetricType,
  NormalizedDatapoint,
} from "../../schemas";

/** A Prometheus metric TYPE. */
export type PromMetricType =
  | "counter"
  | "gauge"
  | "histogram"
  | "summary"
  | "untyped";

export interface PromParseResult {
  datapoints: NormalizedDatapoint[];
  /** Distinct series observed (by (name, labels) identity). */
  seriesCount: number;
}

/** One parsed sample line, before type resolution. */
interface ParsedSample {
  name: string;
  labels: Record<string, string>;
  value: number;
  tsMillis?: number;
}

export function parsePrometheusText({
  text,
  now,
}: {
  text: string;
  now: Date;
}): PromParseResult {
  const types = new Map<string, PromMetricType>();
  const datapoints: NormalizedDatapoint[] = [];
  const seriesSeen = new Set<string>();

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;

    if (line.startsWith("#")) {
      applyMetadata(line, types);
      continue;
    }

    const sample = parseSampleLine(line);
    if (!sample) continue;
    if (!Number.isFinite(sample.value)) continue;

    const resolved = resolveSampleType(sample, types);
    if (!resolved) continue; // dropped bucket / quantile

    datapoints.push({
      name: resolved.name,
      type: resolved.type,
      counterKind: resolved.counterKind,
      labels: sample.labels,
      value: sample.value,
      ts: sample.tsMillis === undefined ? now : new Date(sample.tsMillis),
    });
    seriesSeen.add(seriesKey(resolved.name, sample.labels));
  }

  return { datapoints, seriesCount: seriesSeen.size };
}

/** Parse a `# TYPE <name> <type>` line (HELP and other comments are ignored). */
function applyMetadata(line: string, types: Map<string, PromMetricType>): void {
  // `#` then optional ws then keyword.
  const match = /^#\s+(TYPE|HELP)\s+(\S+)\s*(.*)$/.exec(line);
  if (!match) return;
  const [, keyword, name, rest] = match;
  if (keyword !== "TYPE") return;
  const declared = rest.trim().toLowerCase();
  if (
    declared === "counter" ||
    declared === "gauge" ||
    declared === "histogram" ||
    declared === "summary" ||
    declared === "untyped"
  ) {
    types.set(name, declared);
  }
}

interface ResolvedSample {
  name: string;
  type: MetricType;
  counterKind?: CounterKind;
}

/**
 * Resolve a sample's stored name + type, or null when it must be DROPPED (a
 * histogram bucket or a summary quantile). Direct TYPE declarations win; else a
 * `_bucket`/`_sum`/`_count` suffix whose base is a histogram/summary decomposes.
 */
function resolveSampleType(
  sample: ParsedSample,
  types: Map<string, PromMetricType>,
): ResolvedSample | null {
  const direct = types.get(sample.name);
  if (direct === "counter") {
    return { name: sample.name, type: "counter", counterKind: "cumulative" };
  }
  if (direct === "gauge" || direct === "untyped") {
    return { name: sample.name, type: "gauge" };
  }
  if (direct === "histogram" || direct === "summary") {
    // A sample carrying the base name directly is a summary quantile line (or an
    // unexpected bare histogram sample) - dropped (no percentiles v1).
    return null;
  }

  for (const suffix of ["_bucket", "_sum", "_count"] as const) {
    if (!sample.name.endsWith(suffix)) continue;
    const base = sample.name.slice(0, -suffix.length);
    const baseType = types.get(base);
    if (baseType === "histogram" || baseType === "summary") {
      if (suffix === "_bucket") return null; // drop histogram buckets
      return { name: sample.name, type: "counter", counterKind: "cumulative" };
    }
  }

  // No type info: treat as an untyped gauge (Prometheus default).
  return { name: sample.name, type: "gauge" };
}

/** Parse one sample line into name/labels/value/timestamp, or null when malformed. */
export function parseSampleLine(line: string): ParsedSample | null {
  const nameMatch = /^([a-zA-Z_:][a-zA-Z0-9_:]*)/.exec(line);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  let pos = name.length;

  let labels: Record<string, string> = {};
  if (line[pos] === "{") {
    const parsed = parseLabels(line, pos);
    if (!parsed) return null;
    labels = parsed.labels;
    pos = parsed.next;
  }

  // Remainder: `<value> [<timestamp>] [# exemplar...]`.
  let rest = line.slice(pos);
  const hashIndex = rest.indexOf("#");
  if (hashIndex !== -1) rest = rest.slice(0, hashIndex); // strip exemplar
  const tokens = rest.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  const value = parseValue(tokens[0]);
  if (value === null) return null;

  let tsMillis: number | undefined;
  if (tokens.length >= 2) {
    const ts = Number(tokens[1]);
    if (Number.isFinite(ts)) tsMillis = ts;
  }

  return { name, labels, value, tsMillis };
}

/** Parse a `{ k="v", ... }` label block starting at `line[start] === "{"`. */
function parseLabels(
  line: string,
  start: number,
): { labels: Record<string, string>; next: number } | null {
  const labels: Record<string, string> = {};
  let i = start + 1; // past `{`
  for (;;) {
    i = skipWs(line, i);
    if (line[i] === "}") return { labels, next: i + 1 };
    if (i >= line.length) return null;

    const keyMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(line.slice(i));
    if (!keyMatch) return null;
    const key = keyMatch[0];
    i += key.length;

    i = skipWs(line, i);
    if (line[i] !== "=") return null;
    i += 1;
    i = skipWs(line, i);
    if (line[i] !== '"') return null;

    const valueResult = parseQuoted(line, i);
    if (!valueResult) return null;
    labels[key] = valueResult.value;
    i = valueResult.next;

    i = skipWs(line, i);
    if (line[i] === ",") {
      i += 1;
      continue;
    }
    if (line[i] === "}") return { labels, next: i + 1 };
    return null;
  }
}

/** Parse a double-quoted string with `\\`, `\"`, `\n` escapes, starting at `line[start] === '"'`. */
function parseQuoted(
  line: string,
  start: number,
): { value: string; next: number } | null {
  let value = "";
  let i = start + 1; // past opening quote
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      const next = line[i + 1];
      switch (next) {
      case "\\": {
      value += "\\";
      break;
      }
      case '"': {
      value += '"';
      break;
      }
      case "n": {
      value += "\n";
      break;
      }
      default: { value += next ?? "";
      }
      }
      i += 2;
      continue;
    }
    if (ch === '"') return { value, next: i + 1 };
    value += ch;
    i += 1;
  }
  return null; // unterminated
}

function parseValue(token: string): number | null {
  if (token === "+Inf" || token === "Inf") return Number.POSITIVE_INFINITY;
  if (token === "-Inf") return Number.NEGATIVE_INFINITY;
  if (token === "NaN") return Number.NaN;
  const n = Number(token);
  return Number.isNaN(n) && token.toLowerCase() !== "nan" ? null : n;
}

function skipWs(line: string, i: number): number {
  let j = i;
  while (j < line.length && (line[j] === " " || line[j] === "\t")) j += 1;
  return j;
}

function seriesKey(name: string, labels: Record<string, string>): string {
  const keys = Object.keys(labels).toSorted();
  return `${name}{${keys.map((k) => `${k}=${labels[k]}`).join(",")}}`;
}
