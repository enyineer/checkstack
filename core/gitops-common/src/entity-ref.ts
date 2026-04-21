import { z } from "zod";

/**
 * K8s-style structured entity reference.
 * Used in YAML specs to reference other GitOps-managed entities.
 *
 * @example
 * ```yaml
 * healthchecks:
 *   - ref:
 *       kind: Healthcheck
 *       name: payment-db-check
 * ```
 */
export const entityRefSchema = z.object({
  kind: z.string().min(1),
  name: z.string().min(1),
});

export type EntityRef = z.infer<typeof entityRefSchema>;

/**
 * Check if a value is a valid EntityRef shape (object with string `kind` and `name`).
 */
function isEntityRef(value: unknown): value is EntityRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.kind === "string" &&
    obj.kind.length > 0 &&
    typeof obj.name === "string" &&
    obj.name.length > 0
  );
}

/**
 * Recursively extract all entity refs from a spec value.
 *
 * Walks objects and arrays, collecting objects that have both
 * a `kind` (non-empty string) and `name` (non-empty string) property.
 * Matched refs are not recursed into (no double-counting).
 */
export function extractEntityRefs(value: unknown): EntityRef[] {
  const refs: EntityRef[] = [];
  walk(value, refs);
  return refs;
}

function walk(value: unknown, refs: EntityRef[]): void {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, refs);
    }
    return;
  }

  // Check if this object IS a ref — collect it and stop recursing
  if (isEntityRef(value)) {
    refs.push({ kind: value.kind, name: value.name });
    return;
  }

  // Otherwise recurse into child values
  for (const child of Object.values(value as Record<string, unknown>)) {
    walk(child, refs);
  }
}
