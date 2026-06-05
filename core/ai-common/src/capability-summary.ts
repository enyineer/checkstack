import { z } from "zod";
import type { CapabilityEntry, CapabilityFieldSummary } from "./context-tools";

/**
 * The maximum number of entries a `listCapabilities` catalog may carry a
 * per-entry `configSummary` for. Above this the summaries are dropped (the
 * catalog still returns identity + role for every entry) and `truncated` is
 * flagged, so the broad catalog stays small in the model's context window and
 * the model pulls a single kind's FULL schema on demand via
 * `getCapabilitySchema`.
 */
export const CAPABILITY_SUMMARY_ENTRY_CAP = 12;

/**
 * Minimal structural shape of a JSON Schema we read to derive a compact field
 * summary. We never trust the input to be a full draft - we narrow defensively
 * and treat anything we cannot read as "no derivable fields".
 */
const JsonSchemaShape = z.object({
  type: z.unknown().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
});

const PropertyShape = z.object({
  type: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
  format: z.string().optional(),
  items: z.unknown().optional(),
  anyOf: z.array(z.unknown()).optional(),
  oneOf: z.array(z.unknown()).optional(),
});

/**
 * Derive a short, human/model-readable type label from a single JSON Schema
 * property node. Deterministic and dependency-free - it never pulls in a JSON
 * Schema library, so it stays trivially testable.
 */
export function summarizeFieldType({ property }: { property: unknown }): string {
  const parsed = PropertyShape.safeParse(property);
  if (!parsed.success) return "unknown";
  const node = parsed.data;

  if (Array.isArray(node.enum) && node.enum.length > 0) return "enum";
  if (Array.isArray(node.anyOf) && node.anyOf.length > 0) return "union";
  if (Array.isArray(node.oneOf) && node.oneOf.length > 0) return "union";

  const { type } = node;
  if (typeof type === "string") {
    if (type === "array") return "array";
    if (type === "integer") return "number";
    return type;
  }
  // JSON Schema permits `type` to be an array of strings (e.g. ["string", "null"]).
  if (Array.isArray(type)) {
    const labels = type.filter((t): t is string => typeof t === "string");
    if (labels.length > 0) return labels.join("|");
  }
  return "unknown";
}

/**
 * Derive the COMPACT field summary (name + type + required) for one config
 * JSON Schema. Returns `undefined` when the schema has no readable object
 * properties (so callers can omit `configSummary` entirely rather than emit an
 * empty array). Pure and deterministic - this is the function the catalog and
 * its tests pin.
 */
export function summarizeConfigSchema({
  configSchema,
}: {
  configSchema: unknown;
}): CapabilityFieldSummary[] | undefined {
  const parsed = JsonSchemaShape.safeParse(configSchema);
  if (!parsed.success) return undefined;
  const { properties, required } = parsed.data;
  if (!properties) return undefined;

  const requiredSet = new Set<string>(required);
  const fields: CapabilityFieldSummary[] = Object.keys(properties).map(
    (name) => ({
      name,
      type: summarizeFieldType({ property: properties[name] }),
      required: requiredSet.has(name),
    }),
  );
  if (fields.length === 0) return undefined;
  return fields;
}

/**
 * A catalog entry BEFORE size-gating: it always carries the derived compact
 * summary; the gate decides whether the summary survives into the wire output.
 */
export interface RawCapabilityEntry extends Omit<CapabilityEntry, "configSummary"> {
  configSummary?: CapabilityFieldSummary[];
}

/**
 * Apply the size gate to a fully-derived catalog. When the catalog has more
 * than {@link CAPABILITY_SUMMARY_ENTRY_CAP} entries, every entry's
 * `configSummary` is stripped (identity/role survive) and `truncated` is set.
 * Otherwise the summaries are kept as-is. Pure - no I/O, deterministic in the
 * input ordering.
 */
export function applyCapabilitySizeGate({
  entries,
  entryCap = CAPABILITY_SUMMARY_ENTRY_CAP,
}: {
  entries: RawCapabilityEntry[];
  entryCap?: number;
}): { entries: CapabilityEntry[]; truncated: boolean } {
  const overCap = entries.length > entryCap;
  const gated: CapabilityEntry[] = entries.map((entry) => {
    if (overCap) {
      const { configSummary: _omit, ...rest } = entry;
      return rest;
    }
    return entry;
  });
  return { entries: gated, truncated: overCap };
}
