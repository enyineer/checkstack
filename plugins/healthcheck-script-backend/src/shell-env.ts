/**
 * Reserved `CHECKSTACK_ENV_*` shell env vars exposing a run's resolved
 * environment (id, name, and each custom field) to a shell collector script.
 *
 * The reserved names and the key-normalization rule are kept local to this
 * plugin (mirroring the `CHECKSTACK_CHECK_*` / `CHECKSTACK_SYSTEM_*` reserved
 * names in `execute-collector.ts`) so the collector's dependency surface stays
 * minimal. The normalization mirrors the ReDoS-safe rule used by
 * `@checkstack/automation-common`'s `toShellEnvKey`: uppercase, collapse each
 * run of non-alphanumeric characters to a single `_`, trim leading/trailing
 * `_`. A camelCase boundary is split first (`baseUrl` -> `BASE_URL`).
 */

/** Reserved env var carrying the resolved environment's id. */
export const CHECKSTACK_ENV_ID = "CHECKSTACK_ENV_ID";
/** Reserved env var carrying the resolved environment's name. */
export const CHECKSTACK_ENV_NAME = "CHECKSTACK_ENV_NAME";
/** Prefix on every per-custom-field environment shell var. */
export const CHECKSTACK_ENV_PREFIX = "CHECKSTACK_ENV_";

/**
 * Derive the `CHECKSTACK_ENV_<KEY>` shell var name for a custom field key.
 *
 * Splits a camelCase boundary into an underscore so `baseUrl` becomes
 * `CHECKSTACK_ENV_BASE_URL`, then uppercases, collapses every run of
 * non-alphanumeric characters to a single `_`, and trims leading/trailing
 * `_`. The trailing-trim uses a negative look-behind to avoid the
 * polynomial-time backtracking of a naive `/^_+|_+$/g` (same hardening as
 * automation-common's `toShellEnvKey`).
 */
export function toEnvFieldShellKey(key: string): string {
  const normalized = key
    // Split camelCase / digit-letter boundaries before uppercasing so
    // `baseUrl` -> `base Url` -> `BASE_URL` rather than `BASEURL`.
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")
    .replaceAll(/^_+|(?<!_)_+$/g, "");
  return `${CHECKSTACK_ENV_PREFIX}${normalized}`;
}

/**
 * Build the `CHECKSTACK_ENV_<KEY>` shell vars for an environment's custom
 * fields. Values are stringified (objects/arrays via JSON). Two keys that
 * normalize to the same shell var name collide: the FIRST wins and the
 * later one is skipped + reported via `onCollision` (never last-write-wins).
 * Keys that normalize to an empty name (so just `CHECKSTACK_ENV_`) are
 * skipped + reported the same way.
 */
export function buildEnvironmentShellEnv(
  fields: Record<string, unknown>,
  onCollision: (message: string) => void = (message) =>
    console.warn(message),
): Record<string, string> {
  const env: Record<string, string> = {};
  // Track which original field key first claimed each shell var name so the
  // collision message can name both conflicting keys.
  const claimedBy: Record<string, string> = {};

  for (const [key, value] of Object.entries(fields)) {
    const shellKey = toEnvFieldShellKey(key);
    if (shellKey === CHECKSTACK_ENV_PREFIX) {
      onCollision(
        `Environment custom field "${key}" normalizes to an empty shell var name; skipping.`,
      );
      continue;
    }
    if (shellKey in env) {
      onCollision(
        `Environment custom fields "${claimedBy[shellKey]}" and "${key}" both map to ${shellKey}; keeping the first, skipping "${key}".`,
      );
      continue;
    }
    env[shellKey] = stringifyFieldValue(value);
    claimedBy[shellKey] = key;
  }

  return env;
}

/** Stringify a custom-field value for a shell env var. */
function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
