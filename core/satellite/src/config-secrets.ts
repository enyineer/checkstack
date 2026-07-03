import { isUnresolvedConfigSecret } from "@checkstack/healthcheck-common";

/**
 * Satellite-side half of the JIT config-secret channel: detect which fields of
 * a relayed assignment still hold an unresolved marker or `${{ secrets.* }}`
 * reference (core resolves those on request), and apply the returned
 * `path -> value` map onto a config copy just before the run. Legacy bare
 * literals need no round-trip.
 */

/**
 * Config keys whose subtree the config-secret scan must NOT descend into,
 * because their `${{ secrets.* }}` templates belong to a DIFFERENT channel and
 * legitimately survive config-secret resolution:
 *
 * - `secretEnv` - the `x-secret-env` env-mapping, resolved just-in-time over the
 *   SEPARATE run-secrets channel (`request_run_secrets`) and injected as env,
 *   never merged back into the config. `${{ secrets.NAME }}` is only ever
 *   resolved in `x-secret` / `x-secret-env` fields (see render-templatable-config),
 *   so a secretEnv reference that reaches this scan is NOT an unresolved config
 *   secret - it is resolved elsewhere. Including it here made the fail-closed
 *   assert throw on every satellite collector that declares a secretEnv.
 */
const CONFIG_SECRET_IGNORED_KEYS = new Set(["secretEnv"]);

/**
 * Whether any string leaf in `config` is an unresolved config-secret marker or
 * `${{ secrets.* }}` reference. Deliberately SCHEMA-FREE: a marker only ever
 * occupies an `x-secret` field (core put it there), and scanning raw JSON both
 * avoids reproducing the backend's schema walk (which previously missed secrets
 * nested in Zod unions) and needs no schema at all. The `secretEnv` subtree is
 * skipped ({@link CONFIG_SECRET_IGNORED_KEYS}) because its references ride a
 * separate channel; every OTHER `${{ secrets.* }}` / marker is a genuine
 * `x-secret` config secret that must be resolved before the probe runs.
 */
export function hasUnresolvedConfigSecrets({
  config,
}: {
  config: unknown;
}): boolean {
  const walk = (node: unknown): boolean => {
    if (typeof node === "string") return isUnresolvedConfigSecret(node);
    if (Array.isArray(node)) return node.some((child) => walk(child));
    if (node && typeof node === "object") {
      return Object.entries(node).some(([key, child]) =>
        CONFIG_SECRET_IGNORED_KEYS.has(key) ? false : walk(child),
      );
    }
    return false;
  };
  return walk(config);
}

/**
 * Fail CLOSED: throw if `config` still holds an unresolved marker/reference
 * after JIT resolution. A leftover marker means core could not deliver the
 * value (e.g. its schema was missing, or resolution was skipped) - running the
 * probe with the opaque marker string as a credential must never happen.
 */
export function assertConfigSecretsResolved({
  config,
  label,
}: {
  config: unknown;
  label: string;
}): void {
  if (hasUnresolvedConfigSecrets({ config })) {
    throw new Error(
      `${label}: a config secret could not be resolved (an unresolved ` +
        `marker/reference remains); refusing to run with a bogus credential.`,
    );
  }
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
