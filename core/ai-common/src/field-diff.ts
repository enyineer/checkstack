import type { AiFieldDiff } from "./tool";

/**
 * Compute a leaf-level before -> after diff between two values, used to show what
 * an UPDATE proposal actually changes. Walks plain objects recursively (dotted
 * paths) AND arrays element-wise (`field[i]` paths), so a single changed item in
 * a list - e.g. one collector's script in `collectors[0].config.script` - is
 * surfaced on its own instead of dumping the whole array as one opaque blob.
 * Scalars (and a value that changes shape, e.g. array <-> object) are compared by
 * value via canonical JSON. Added/removed fields and array elements surface with
 * `before`/`after` set to `undefined`.
 *
 * Pure and total: never throws. Returns an empty array when nothing changed.
 */
export function computeFieldDiff({
  before,
  after,
}: {
  before: unknown;
  after: unknown;
}): AiFieldDiff[] {
  const diffs: AiFieldDiff[] = [];
  walk({ before, after, path: "", diffs });
  return diffs;
}

/** True for a plain object (not null, not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep equality via canonical (sorted-key) JSON - sufficient for config bags. */
function deepEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (!isPlainObject(value)) return JSON.stringify(value) ?? "null";
  const keys = Object.keys(value).toSorted();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

function walk({
  before,
  after,
  path,
  diffs,
}: {
  before: unknown;
  after: unknown;
  path: string;
  diffs: AiFieldDiff[];
}): void {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].toSorted()) {
      walk({
        before: before[key],
        after: after[key],
        path: path ? `${path}.${key}` : key,
        diffs,
      });
    }
    return;
  }
  // Arrays recurse element-wise so a single changed item (a collector, an
  // assertion) is its own diff row, not the whole serialized list. A length
  // change surfaces the added/removed elements against `undefined`.
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      walk({
        before: before[index],
        after: after[index],
        path: `${path}[${index}]`,
        diffs,
      });
    }
    return;
  }
  if (!deepEqual(before, after)) {
    diffs.push({ path: path || "(root)", before, after });
  }
}
