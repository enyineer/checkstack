/**
 * Shared pure helpers for numeric threshold evaluation, used by both the
 * `numeric_state` trigger and the `numeric_state` condition.
 *
 * No I/O, fully synchronous.
 */

/**
 * Resolve a numeric value from an unknown input. Accepts numbers and
 * numeric strings; everything else (null, undefined, non-numeric string,
 * object) is "no value" → null.
 */
export function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Compare a numeric value against optional `above` / `below` bounds.
 * Returns true when the value is strictly above `above` AND/OR strictly
 * below `below` (whichever bounds are provided). With both bounds set,
 * the value must satisfy BOTH (i.e. `above < value < below` for a band,
 * or `value > above && value < below`). With neither bound, returns
 * false (a threshold with no bounds never matches).
 *
 * A null value never matches.
 */
export function matchesThreshold(args: {
  value: number | null;
  above?: number;
  below?: number;
}): boolean {
  const { value, above, below } = args;
  if (value === null) return false;
  if (above === undefined && below === undefined) return false;
  if (above !== undefined && !(value > above)) return false;
  if (below !== undefined && !(value < below)) return false;
  return true;
}

/**
 * Extract a numeric field from a `healthcheck.check.completed` payload.
 *
 * The hook payload's shape is:
 *
 *   { systemId, configurationId, status, latencyMs?, result?, timestamp }
 *
 * where `result` is the per-check collectors map
 * (`{ <collectorId>: { <field>: value, … }, … }`).
 *
 * Supported field paths:
 *   - `latencyMs`                → payload.latencyMs (top-level)
 *   - `collectors.<id>.<field>`  → payload.result.<id>.<field>
 *   - `<id>.<field>`             → payload.result.<id>.<field>
 *
 * (`p95LatencyMs` is a windowed aggregate, absent per-check — read it via
 * the `health.*` scope / a `numeric_state` condition instead.)
 *
 * Returns null when the path is absent or non-numeric.
 */
export function extractNumericField(
  payload: Record<string, unknown>,
  field: string,
): number | null {
  // Top-level latency is the common case.
  if (field === "latencyMs") {
    return toNumberOrNull(payload.latencyMs);
  }

  // Everything else is a collector field under `result` (the collectors
  // map). Accept an optional leading `collectors.` for readability.
  const collectors = isRecord(payload.result) ? payload.result : undefined;
  if (!collectors) return null;
  const path = field.startsWith("collectors.")
    ? field.slice("collectors.".length)
    : field;
  return toNumberOrNull(resolvePath(collectors, path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve a dotted path against a nested record. Returns undefined on miss. */
function resolvePath(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}
