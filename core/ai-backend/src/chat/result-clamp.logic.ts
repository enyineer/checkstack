/**
 * Generic, last-resort size guard for a READ tool's result before it enters the
 * model's context window. Every projected/composite read result passes through
 * `runRead`, so a single oversized pull (e.g. a wide `healthcheck.runHistory`
 * page) can blow the context — and, because the chat loop replays full history
 * verbatim every turn, keep blowing it. This clamp bounds any one result.
 *
 * Strategy (deterministic, dependency-free):
 *  - If the JSON serialization already fits `maxChars`, return it untouched.
 *  - If the result is an OBJECT with array-valued fields, repeatedly trim the
 *    LARGEST remaining array (head-kept) until it fits, and attach a sibling
 *    `_truncated` note listing what was dropped + a hint to narrow/paginate.
 *  - If the result is itself an ARRAY, wrap it as `{ items, _truncated }`.
 *  - If nothing array-shaped can be trimmed (a huge scalar/object), return a
 *    `_truncated` envelope with a `preview` head of the serialization.
 *
 * The `_truncated` marker is MODEL-FACING: it tells the agent the data was cut
 * so it should narrow filters / paginate / use an aggregate tool, instead of
 * assuming it saw everything.
 */

/** Default per-result character budget (~3k tokens at ~4 chars/token). */
export const MAX_TOOL_RESULT_CHARS = 12_000;

/** Hint surfaced to the model when a result is clamped. */
const CLAMP_HINT =
  "Result truncated to fit the context window. Narrow your filters (e.g. a " +
  "shorter time window or a specific status), paginate with limit/offset, or " +
  "use an aggregate/summary tool instead of pulling raw rows.";

export interface ClampToolResult {
  /** The (possibly trimmed) value to hand to the model. */
  value: unknown;
  /** Whether anything was dropped. */
  clamped: boolean;
}

function safeStringifyLength(value: unknown): number | undefined {
  try {
    return JSON.stringify(value)?.length;
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

interface ArrayField {
  key: string;
  /** Live reference to the working array (mutated in place by trimming). */
  arr: unknown[];
  /** Original length, to report how many were omitted. */
  originalLength: number;
}

/**
 * Trim the array fields of `working` (largest-first, head-kept) until the whole
 * object serializes within `maxChars` or every array is empty. Returns the
 * per-field omission tally. Mutates `working`'s arrays.
 */
function trimArrayFields({
  working,
  fields,
  maxChars,
}: {
  working: Record<string, unknown>;
  fields: ArrayField[];
  maxChars: number;
}): Array<{ field: string; kept: number; omitted: number }> {
  // Reserve headroom for the `_truncated` note we will append.
  const budget = Math.max(0, maxChars - 256);
  let guard = 0;
  while ((safeStringifyLength(working) ?? 0) > budget && guard < 10_000) {
    guard += 1;
    // Pick the field whose array currently serializes largest and is non-empty.
    let target: ArrayField | undefined;
    let targetSize = -1;
    for (const f of fields) {
      if (f.arr.length === 0) continue;
      const size = safeStringifyLength(f.arr) ?? 0;
      if (size > targetSize) {
        targetSize = size;
        target = f;
      }
    }
    if (!target) break; // nothing left to trim
    // Drop ~10% (at least one) from the tail to converge quickly on big arrays.
    const drop = Math.max(1, Math.floor(target.arr.length * 0.1));
    target.arr.length = Math.max(0, target.arr.length - drop);
    working[target.key] = target.arr;
  }
  return fields
    .map((f) => ({
      field: f.key,
      kept: f.arr.length,
      omitted: f.originalLength - f.arr.length,
    }))
    .filter((t) => t.omitted > 0);
}

export function clampToolResult({
  result,
  maxChars = MAX_TOOL_RESULT_CHARS,
}: {
  result: unknown;
  maxChars?: number;
}): ClampToolResult {
  const length = safeStringifyLength(result);
  // Unserializable (circular, BigInt, ...) or already within budget: pass through.
  // An unserializable result is the SDK's problem to surface, not ours to mangle.
  if (length === undefined || length <= maxChars) {
    return { value: result, clamped: false };
  }

  // Object with array fields: trim the arrays in place.
  if (isPlainObject(result)) {
    const working: Record<string, unknown> = { ...result };
    const fields: ArrayField[] = Object.entries(working)
      .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
      .map(([key, arr]) => ({ key, arr: [...arr], originalLength: arr.length }));

    if (fields.length > 0) {
      for (const f of fields) working[f.key] = f.arr;
      const dropped = trimArrayFields({ working, fields, maxChars });
      if (dropped.length > 0) {
        working._truncated = { fields: dropped, hint: CLAMP_HINT };
        return { value: working, clamped: true };
      }
      // Arrays existed but couldn't be the source of the overflow; fall through.
    }
  }

  // Bare array: wrap and trim.
  if (Array.isArray(result)) {
    const arr = [...result];
    const working: Record<string, unknown> = { items: arr };
    const dropped = trimArrayFields({
      working,
      fields: [{ key: "items", arr, originalLength: result.length }],
      maxChars,
    });
    working._truncated = {
      fields: dropped,
      hint: CLAMP_HINT,
    };
    return { value: working, clamped: true };
  }

  // Nothing array-shaped to trim (huge scalar / deeply-nested object): return a
  // preview envelope so the model knows it saw only the head.
  const serialized = JSON.stringify(result) ?? "";
  return {
    value: {
      _truncated: {
        hint: CLAMP_HINT,
        note: "Result too large to include in full; showing a preview.",
        omittedChars: serialized.length - maxChars,
      },
      preview: serialized.slice(0, maxChars),
    },
    clamped: true,
  };
}
