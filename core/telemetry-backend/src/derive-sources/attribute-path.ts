/**
 * Safe dot-notation attribute traversal for the built-in derive source types.
 *
 * This MIRRORS logstream-common's trace-extraction `getByPath` deliberately: the
 * telemetry platform is a GENERAL layer and must never import a DOMAIN plugin
 * (logstream-common) - see `.claude/rules/dependencies.md`. The traversal rule is
 * identical (a literal flat key wins, then nested object descent), so a derive
 * config authored against a stream behaves the same whether the source emitted
 * dotted flat keys (syslog) or nested JSON (native/OTLP). A pure module: no IO,
 * only prototype-safe own-property reads.
 */

/**
 * Resolve a dot-notation `path` into a record's `attributes`. A literal flat key
 * is tried first (sources like syslog emit dotted flat keys such as `host.name`),
 * then nested object traversal (`ctx.trace_id` reaches `attributes.ctx.trace_id`).
 * Returns `undefined` for a missing path, or when traversal hits a non-object /
 * array / null. Only own enumerable properties are read (never prototype chain),
 * so a `__proto__` / `constructor` segment cannot escape the object.
 */
export function getAttributeByPath({
  attributes,
  path,
}: {
  attributes: Record<string, unknown> | undefined;
  path: string;
}): unknown {
  if (!attributes) return undefined;
  if (Object.prototype.hasOwnProperty.call(attributes, path)) {
    return attributes[path];
  }
  const parts = path.split(".");
  let current: unknown = attributes;
  for (const part of parts) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    // Standard narrowing for a checked plain object: TS cannot narrow `object`
    // to an index-signature type without the cast (the guard above excludes
    // null / arrays / non-objects). Mirrors trace-extraction's getByPath.
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, part)) return undefined;
    current = record[part];
  }
  return current;
}

/**
 * Resolve a path to a finite number: accepts a numeric value directly, or a
 * numeric string (a source may carry `"123.4"`). Returns `undefined` for a
 * missing path, a non-numeric value, `NaN`, or a non-finite number.
 */
export function getNumberByPath({
  attributes,
  path,
}: {
  attributes: Record<string, unknown> | undefined;
  path: string;
}): number | undefined {
  const value = getAttributeByPath({ attributes, path });
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Resolve a path to a label STRING: a primitive (string/number/boolean) becomes
 * its string form; anything else (object, array, null, missing) yields
 * `undefined` so the caller omits the label rather than stringifying `[object
 * Object]`.
 */
export function getLabelByPath({
  attributes,
  path,
}: {
  attributes: Record<string, unknown> | undefined;
  path: string;
}): string | undefined {
  const value = getAttributeByPath({ attributes, path });
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return String(value);
  return undefined;
}
