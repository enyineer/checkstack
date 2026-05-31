/**
 * Deterministic JSON stringify for structural equality.
 *
 * The entity store diffs a freshly-validated state object against the
 * prior persisted row. A naive `JSON.stringify` is key-order-sensitive,
 * so two structurally-equal objects with differently-ordered keys would
 * read as a "change". This walker emits object keys in sorted order so
 * the serialization is canonical: equal values ⇒ equal strings.
 *
 * `undefined` is treated as absent (matching JSON.stringify): an explicit
 * `undefined` property and a missing property serialize identically, so a
 * `set` that drops an optional field to `undefined` no-ops against a prior
 * row that never had it.
 */
export function stableStringify(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null";
  const type = typeof value;
  if (type === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }
  if (type === "boolean") return value ? "true" : "false";
  if (type === "string") return JSON.stringify(value);
  if (type === "bigint") return JSON.stringify((value as bigint).toString());
  if (Array.isArray(value)) {
    return `[${value.map((v) => serialize(v)).join(",")}]`;
  }
  if (type === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .toSorted();
    const body = keys
      .map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`)
      .join(",");
    return `{${body}}`;
  }
  // Functions / symbols cannot appear in zod-parsed state; coerce to null.
  return "null";
}

/** Structural equality via canonical serialization. */
export function structurallyEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}
