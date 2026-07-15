/**
 * Pure helpers for the built-in DERIVE source types' bespoke config editors
 * (log-to-metric, log-to-trace). The editors hold config as a plain
 * `Record<string, unknown>` (the SourceConfigSlot contract), so these helpers
 * read typed values out of it and patch it immutably, keeping the React
 * components thin and the parsing unit-testable without a DOM.
 */

/** Max attribute paths foldable into metric labels (mirrors the backend cap). */
export const MAX_DERIVE_LABELS = 5;

/** The two log-to-metric modes, for the editor's mode select. */
export const LOG_TO_METRIC_MODES = ["count", "extractNumber"] as const;
export type LogToMetricMode = (typeof LOG_TO_METRIC_MODES)[number];

/** Read a string field, defaulting to "" for a missing/non-string value. */
export function readString(
  config: Record<string, unknown>,
  key: string,
): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

/**
 * Read the log-to-metric mode, defaulting to "count" for a missing/unknown
 * value (so a fresh instance starts in the simplest mode).
 */
export function readMode(config: Record<string, unknown>): LogToMetricMode {
  return config.mode === "extractNumber" ? "extractNumber" : "count";
}

/** Read a nested filter field (`minSeverityNumber` | `bodyContains`) as a string. */
export function readFilterField(
  config: Record<string, unknown>,
  key: "minSeverityNumber" | "bodyContains",
): string {
  const filter = config.filter;
  if (typeof filter !== "object" || filter === null) return "";
  const value = (filter as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Read the `labelsFromAttributes` array back into a comma-separated input value. */
export function readLabelsInput(config: Record<string, unknown>): string {
  const value = config.labelsFromAttributes;
  if (!Array.isArray(value)) return "";
  return value.filter((v): v is string => typeof v === "string").join(", ");
}

/**
 * Parse a comma / newline separated labels input into a clean, de-duplicated,
 * capped array. Empty entries are dropped; order of first appearance is kept.
 */
export function parseLabelsInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const trimmed = part.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_DERIVE_LABELS) break;
  }
  return out;
}

/** Immutably set a top-level string field, deleting it when cleared to "". */
export function setStringField({
  config,
  key,
  value,
}: {
  config: Record<string, unknown>;
  key: string;
  value: string;
}): Record<string, unknown> {
  const next = { ...config };
  if (value.length === 0) delete next[key];
  else next[key] = value;
  return next;
}

/** Immutably set `labelsFromAttributes`, removing it when the parse is empty. */
export function setLabels({
  config,
  raw,
}: {
  config: Record<string, unknown>;
  raw: string;
}): Record<string, unknown> {
  const labels = parseLabelsInput(raw);
  const next = { ...config };
  if (labels.length === 0) delete next.labelsFromAttributes;
  else next.labelsFromAttributes = labels;
  return next;
}

/**
 * Immutably set a nested filter field. `minSeverityNumber` is coerced to a
 * finite integer (cleared when blank/invalid); `bodyContains` is a plain string.
 * The `filter` object is removed entirely once it holds no fields, so the saved
 * config stays minimal and matches the backend's optional-filter shape.
 */
export function setFilterField({
  config,
  key,
  value,
}: {
  config: Record<string, unknown>;
  key: "minSeverityNumber" | "bodyContains";
  value: string;
}): Record<string, unknown> {
  const current =
    typeof config.filter === "object" && config.filter !== null
      ? { ...(config.filter as Record<string, unknown>) }
      : {};

  if (key === "minSeverityNumber") {
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    if (trimmed.length === 0 || !Number.isFinite(parsed)) delete current.minSeverityNumber;
    else current.minSeverityNumber = Math.trunc(parsed);
  } else {
    if (value.length === 0) delete current.bodyContains;
    else current.bodyContains = value;
  }

  const next = { ...config };
  if (Object.keys(current).length === 0) delete next.filter;
  else next.filter = current;
  return next;
}

/** Set the mode, clearing `attributePath` when leaving extractNumber. */
export function setMode({
  config,
  mode,
}: {
  config: Record<string, unknown>;
  mode: LogToMetricMode;
}): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config, mode };
  if (mode !== "extractNumber") delete next.attributePath;
  return next;
}
