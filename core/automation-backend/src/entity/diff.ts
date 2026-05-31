import { structurallyEqual } from "./stable-stringify";

/**
 * Per-field structural diff between a prior and next entity state.
 *
 * Fields are the top-level keys of the (zod-object) state. A field is
 * "changed" when its value is not structurally equal across prev/next —
 * this covers added keys (prev absent), removed keys (next absent, value
 * becomes `null` in the delta), and value changes (including nested object
 * / array mutations compared structurally).
 *
 * `delta` carries only the changed fields' NEXT values (or `null` for a
 * field that was dropped), mirroring the `EntityChangedSchema.delta` shape
 * ("changed fields only").
 */
export interface EntityDiff {
  /** Sorted list of changed top-level field names. */
  changedFields: string[];
  /** Changed fields only → their next value (or `null` when removed). */
  delta: Record<string, unknown>;
}

export function diffEntityState(args: {
  prev: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
}): EntityDiff {
  const { prev, next } = args;
  const prevObj = prev ?? {};
  const nextObj = next ?? {};

  const keys = new Set<string>([
    ...Object.keys(prevObj),
    ...Object.keys(nextObj),
  ]);

  const changedFields: string[] = [];
  const delta: Record<string, unknown> = {};

  for (const key of keys) {
    const prevHas = Object.prototype.hasOwnProperty.call(prevObj, key);
    const nextHas = Object.prototype.hasOwnProperty.call(nextObj, key);
    const prevVal = prevHas ? prevObj[key] : undefined;
    const nextVal = nextHas ? nextObj[key] : undefined;

    if (structurallyEqual(prevVal, nextVal)) continue;

    changedFields.push(key);
    // A dropped field surfaces as `null` so the delta is JSON-serializable
    // and the change event records the removal explicitly.
    delta[key] = nextHas ? nextVal : null;
  }

  return { changedFields: changedFields.toSorted(), delta };
}
