import { z } from "zod";

/** Validated shape of a system's metadata field. */
export const MetadataSchema = z.record(z.string(), z.unknown());

/** A single displayable key/value pair derived from raw metadata. */
export interface MetadataEntry {
  key: string;
  /** Human-readable value string: primitives as-is, objects/arrays as compact JSON. */
  displayValue: string;
}

/**
 * Normalise a raw `Record<string, unknown>` metadata object into a flat list
 * of `{ key, displayValue }` pairs suitable for key/value rendering.
 *
 * - Primitives (`string`, `number`, `boolean`) are displayed as their string
 *   representation.
 * - `null` is displayed as `"null"`.
 * - Objects and arrays are displayed as compact `JSON.stringify` output inside
 *   a `<code>` element, so structure is preserved without a raw JSON blob.
 * - An absent or empty metadata object yields `[]`.
 */
export function normalizeMetadata(
  meta: Record<string, unknown> | null | undefined,
): MetadataEntry[] {
  if (!meta || typeof meta !== "object") return [];

  const parsed = MetadataSchema.safeParse(meta);
  if (!parsed.success) return [];

  return Object.entries(parsed.data).map(([key, value]) => ({
    key,
    displayValue: valueToDisplay(value),
  }));
}

function valueToDisplay(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
