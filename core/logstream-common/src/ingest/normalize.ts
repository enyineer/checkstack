/**
 * Pure normalization helpers shared by every ingest parser: fold a source's
 * severity dialect into a canonical `(severityNumber, band, severityText)`,
 * byte-truncate a line body, and size-cap an attributes object. No IO;
 * exhaustively unit-tested.
 */

import {
  bandFromLevelName,
  bandFromSeverityNumber,
  SEVERITY_NUMBER_FOR_BAND,
  type SeverityBand,
} from "../severity";

// Trace-id / span-id extraction lives in its own module for readability but is
// a normalization concern; re-exported here so it reaches the package root
// (`@checkstack/logstream-common`) via the existing `./ingest/normalize` export.
export * from "./trace-extraction";

export interface ResolvedSeverity {
  severityNumber: number;
  band: SeverityBand;
  severityText?: string;
}

/** Attributes cap: drop overflow keys and mark the object `_truncated`. */
export const DEFAULT_ATTRIBUTES_CAP_BYTES = 8192;

/**
 * How far in the PAST a client-supplied event timestamp may be before it is
 * clamped forward to the bound. Wide (24h) so legitimately delayed batches keep
 * their real event time, but bounded so an ancient timestamp cannot land in a
 * bucket that retention would never age out.
 */
export const MAX_PAST_LAG_MS = 24 * 60 * 60_000;

/**
 * How far in the FUTURE a client-supplied event timestamp may lead server time
 * before it is clamped back. Tight (2min) so a single future-dated line cannot
 * pin a stream's `lastReceivedAt` forward (which would permanently kill silence
 * detection) or create buckets that are invisible to health and never matched
 * by retention.
 */
export const MAX_FUTURE_SKEW_MS = 2 * 60_000;

const NUMERIC_RE = /^\d+$/;

export interface ClampedTimestamp {
  ts: Date;
  /** True when `ts` was outside the trust window and snapped to a bound. */
  clamped: boolean;
}

/**
 * Clamp a client-supplied event timestamp into the trust window around the
 * server's observation time: `[observedAt - MAX_PAST_LAG_MS, observedAt +
 * MAX_FUTURE_SKEW_MS]`. Client timestamps are untrusted input; a single
 * out-of-range line must never move a stream's activity or bucketing off the
 * real timeline. Clamped lines keep their full payload - only `ts` is snapped to
 * the nearest bound (an invalid/`NaN` timestamp snaps to `observedAt`).
 */
export function clampEventTimestamp({
  ts,
  observedAt,
}: {
  ts: Date;
  observedAt: Date;
}): ClampedTimestamp {
  const obs = observedAt.getTime();
  const min = obs - MAX_PAST_LAG_MS;
  const max = obs + MAX_FUTURE_SKEW_MS;
  const t = ts.getTime();
  if (!Number.isFinite(t)) return { ts: new Date(obs), clamped: true };
  if (t < min) return { ts: new Date(min), clamped: true };
  if (t > max) return { ts: new Date(max), clamped: true };
  return { ts, clamped: false };
}

/**
 * Resolve a canonical severity from whatever a source provided. Precedence:
 * a recognized level NAME wins (it is the most specific), else a numeric OTel
 * severity, else `info` (band) with severity number 0. An explicit OTel
 * `severityNumber` is preserved as the stored number even when a name decides
 * the band, so the raw row keeps the producer's exact value.
 */
export function resolveSeverity({
  severityNumber,
  level,
}: {
  /** An OTel severity number (1-24), if the source carried one. */
  severityNumber?: number;
  /** A free-text level or a numeric severity from a native/syslog source. */
  level?: string | number;
}): ResolvedSeverity {
  const hasOtelNumber =
    typeof severityNumber === "number" &&
    Number.isFinite(severityNumber) &&
    severityNumber > 0;

  const text =
    typeof level === "string" && !NUMERIC_RE.test(level.trim())
      ? level
      : undefined;

  // A numeric candidate from `level` (a raw number or a numeric string).
  let numericFromLevel: number | undefined;
  if (typeof level === "number" && Number.isFinite(level)) {
    numericFromLevel = level;
  } else if (typeof level === "string" && NUMERIC_RE.test(level.trim())) {
    numericFromLevel = Number.parseInt(level.trim(), 10);
  }

  const nameBand = text ? bandFromLevelName(text) : null;

  if (nameBand) {
    return {
      band: nameBand,
      severityNumber: hasOtelNumber
        ? severityNumber
        : SEVERITY_NUMBER_FOR_BAND[nameBand],
      severityText: text,
    };
  }

  const numeric = hasOtelNumber ? severityNumber : numericFromLevel;
  if (numeric !== undefined) {
    return {
      band: bandFromSeverityNumber(numeric),
      severityNumber: numeric,
      severityText: text,
    };
  }

  return { band: "info", severityNumber: 0, severityText: text };
}

/**
 * Lowercased-key lookup maps, memoized on the resolved config's `valueMap`
 * object. A stream's config (and thus its `valueMap` reference) is stable while
 * the stream-config cache holds it, so the O(keys) lowercasing runs ONCE per
 * resolved config rather than once per line - and a `WeakMap` lets a rotated
 * config's old map be collected. Insertion order preserves first-match-wins for
 * two keys that collide after lowercasing.
 */
const loweredValueMaps = new WeakMap<
  Record<string, SeverityBand>,
  ReadonlyMap<string, SeverityBand>
>();

function loweredValueMap(
  valueMap: Record<string, SeverityBand>,
): ReadonlyMap<string, SeverityBand> {
  const cached = loweredValueMaps.get(valueMap);
  if (cached) return cached;
  const lowered = new Map<string, SeverityBand>();
  for (const [candidate, mapped] of Object.entries(valueMap)) {
    const key = candidate.trim().toLowerCase();
    if (!lowered.has(key)) lowered.set(key, mapped);
  }
  loweredValueMaps.set(valueMap, lowered);
  return lowered;
}

/**
 * Apply a stream's `severityRules.valueMap` to a resolved band. The map is keyed
 * on the RAW source severity value (case-insensitive) - the OTLP `severityText`,
 * a native source's `level`/`severity` field, or (for syslog) the PRI-derived
 * severity keyword (`err`, `warning`, ...) - so a stream can declare e.g.
 * `{ "WARNING": "error" }` to treat its own `WARNING` level as the error band
 * regardless of the built-in mapping. A matching entry WINS over the default
 * band; a non-match (or an absent map / empty raw value) returns `band`
 * unchanged. The `valueMap` is lowercased ONCE per resolved config (memoized),
 * so this is an O(1) lookup per line. Applied at normalize time, BEFORE
 * classification (see the v2 plan's "Severity application order").
 */
export function applySeverityValueMap({
  band,
  rawValue,
  valueMap,
}: {
  band: SeverityBand;
  /** The raw source severity value (a level name or a numeric severity). */
  rawValue: string | number | undefined;
  valueMap: Record<string, SeverityBand> | undefined;
}): SeverityBand {
  if (!valueMap || rawValue === undefined) return band;
  const key = String(rawValue).trim().toLowerCase();
  if (key.length === 0) return band;
  return loweredValueMap(valueMap).get(key) ?? band;
}

/**
 * Truncate a string so its UTF-8 encoding is at most `maxBytes` bytes, without
 * splitting a multi-byte character (a trailing partial code point is dropped).
 */
export function truncateBody({
  body,
  maxBytes,
}: {
  body: string;
  maxBytes: number;
}): string {
  const encoded = new TextEncoder().encode(body);
  if (encoded.length <= maxBytes) return body;
  // `fatal: false` (default) replaces a trailing partial sequence; strip the
  // replacement char so we never emit U+FFFD from a clean cut.
  const sliced = encoded.subarray(0, maxBytes);
  return new TextDecoder().decode(sliced).replace(/�+$/u, "");
}

/**
 * Size-cap a flattened attributes object. Keys are kept in insertion order
 * until the running JSON size would exceed `maxBytes`; if anything is dropped a
 * `_truncated: true` marker is added. Returns `undefined` for an empty input so
 * the stored column stays null.
 */
export function capAttributes({
  attributes,
  maxBytes = DEFAULT_ATTRIBUTES_CAP_BYTES,
}: {
  attributes: Record<string, unknown> | undefined;
  maxBytes?: number;
}): Record<string, unknown> | undefined {
  if (!attributes) return undefined;
  const entries = Object.entries(attributes);
  if (entries.length === 0) return undefined;

  const full = jsonBytes(attributes);
  if (full <= maxBytes) return attributes;

  const kept: Record<string, unknown> = {};
  let dropped = false;
  for (const [key, value] of entries) {
    const candidate = { ...kept, [key]: value, _truncated: true };
    if (jsonBytes(candidate) > maxBytes) {
      dropped = true;
      continue;
    }
    kept[key] = value;
  }
  if (dropped) kept._truncated = true;
  return kept;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Coerce a resolved OTLP/native body value to a stored string. */
export function bodyToString(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === null || body === undefined) return "";
  if (typeof body === "number" || typeof body === "boolean") {
    return String(body);
  }
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}
