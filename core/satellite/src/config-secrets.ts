import { z } from "zod";
import { isSecretSchema } from "@checkstack/backend-api";
import { isUnresolvedConfigSecret } from "@checkstack/healthcheck-common";

/**
 * Satellite-side half of the JIT config-secret channel: detect which
 * `x-secret` fields of a relayed assignment still hold an unresolved marker
 * or `${{ secrets.* }}` reference (core resolves those on request), and
 * apply the returned `fieldPath -> value` map onto a config copy just
 * before the run. Legacy bare literals need no round-trip.
 */

function unwrapZod(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = current.def.innerType as z.ZodTypeAny;
      continue;
    }
    return current;
  }
}

/**
 * Whether any `x-secret` string field in `config` holds an unresolved
 * marker/reference. Mirrors the walk shape of the backend's
 * `walkSecretFields` (objects, arrays, wrapper unwrapping).
 */
export function hasUnresolvedConfigSecrets({
  schema,
  config,
}: {
  schema: z.ZodTypeAny;
  config: unknown;
}): boolean {
  const walk = (nodeSchema: z.ZodTypeAny, value: unknown): boolean => {
    if (value === null || value === undefined) return false;
    if (isSecretSchema(nodeSchema)) {
      return typeof value === "string" && isUnresolvedConfigSecret(value);
    }
    const unwrapped = unwrapZod(nodeSchema);
    if (
      unwrapped instanceof z.ZodObject &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const shape = unwrapped.shape as Record<string, z.ZodTypeAny>;
      const record = value as Record<string, unknown>;
      return Object.entries(shape).some(
        ([key, fieldSchema]) => key in record && walk(fieldSchema, record[key]),
      );
    }
    if (unwrapped instanceof z.ZodArray && Array.isArray(value)) {
      const elementSchema = unwrapped.element as z.ZodTypeAny;
      return value.some((item) => walk(elementSchema, item));
    }
    return false;
  };
  return walk(schema, config);
}

/**
 * Parse a walk-produced field path (`a.b`, `targets[0].password`) into
 * object-key / array-index segments.
 */
function parsePath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const tokenRe = /([^.[\]]+)|\[(\d+)\]/g;
  for (const match of path.matchAll(tokenRe)) {
    if (match[1] === undefined) segments.push(Number(match[2]));
    else segments.push(match[1]);
  }
  return segments;
}

/**
 * Return a copy of `config` with each `fieldPath -> value` entry applied.
 * Only paths that already exist in the config are written (the map was
 * derived from this very config on the core side); a stale path is skipped
 * rather than fabricating structure.
 */
export function applyConfigSecretValues({
  config,
  values,
}: {
  config: Record<string, unknown>;
  values: Record<string, string>;
}): Record<string, unknown> {
  // Structured clone keeps nested objects/arrays independent of the
  // persisted assignment object (which must never hold resolved values).
  const result = structuredClone(config);

  for (const [path, value] of Object.entries(values)) {
    const segments = parsePath(path);
    if (segments.length === 0) continue;
    let cursor: unknown = result;
    let valid = true;
    for (const segment of segments.slice(0, -1)) {
      if (typeof segment === "number") {
        if (!Array.isArray(cursor) || cursor[segment] === undefined) {
          valid = false;
          break;
        }
        cursor = cursor[segment];
      } else {
        if (
          typeof cursor !== "object" ||
          cursor === null ||
          Array.isArray(cursor) ||
          !(segment in cursor)
        ) {
          valid = false;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[segment];
      }
    }
    if (!valid) continue;
    const last = segments.at(-1);
    if (typeof last === "number") {
      if (Array.isArray(cursor) && last < cursor.length) cursor[last] = value;
    } else if (
      typeof last === "string" &&
      typeof cursor === "object" &&
      cursor !== null &&
      !Array.isArray(cursor) &&
      last in cursor
    ) {
      (cursor as Record<string, unknown>)[last] = value;
    }
  }

  return result;
}
