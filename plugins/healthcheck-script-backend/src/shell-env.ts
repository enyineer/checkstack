/**
 * Reserved `CHECKSTACK_ENV_*` / `CHECKSTACK_SYSTEM_*` shell env vars exposing a
 * run's resolved environment and system (id, name, and each custom field) to a
 * shell collector script.
 *
 * The reserved names and the key-normalization rule are kept local to this
 * plugin (mirroring the `CHECKSTACK_CHECK_*` reserved names in
 * `execute-collector.ts`) so the collector's dependency surface stays minimal.
 * The normalization mirrors the ReDoS-safe rule used by
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

/** Reserved env var carrying the system's id. */
export const CHECKSTACK_SYSTEM_ID = "CHECKSTACK_SYSTEM_ID";
/** Reserved env var carrying the system's name. */
export const CHECKSTACK_SYSTEM_NAME = "CHECKSTACK_SYSTEM_NAME";
/** Prefix on every per-custom-field system shell var. */
export const CHECKSTACK_SYSTEM_PREFIX = "CHECKSTACK_SYSTEM_";

/**
 * Normalize a custom-field key into the `<PREFIX><KEY>` shell var name.
 *
 * Splits a camelCase boundary into an underscore so `baseUrl` becomes
 * `BASE_URL`, then uppercases, collapses every run of non-alphanumeric
 * characters to a single `_`, and trims leading/trailing `_`. The
 * trailing-trim uses a negative look-behind to avoid the polynomial-time
 * backtracking of a naive `/^_+|_+$/g` (same hardening as automation-common's
 * `toShellEnvKey`).
 */
function toFieldShellKey(key: string, prefix: string): string {
  const normalized = key
    // Split camelCase / digit-letter boundaries before uppercasing so
    // `baseUrl` -> `base Url` -> `BASE_URL` rather than `BASEURL`.
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")
    .replaceAll(/^_+|(?<!_)_+$/g, "");
  return `${prefix}${normalized}`;
}

/** Derive the `CHECKSTACK_ENV_<KEY>` shell var name for a custom field key. */
export function toEnvFieldShellKey(key: string): string {
  return toFieldShellKey(key, CHECKSTACK_ENV_PREFIX);
}

/** Derive the `CHECKSTACK_SYSTEM_<KEY>` shell var name for a custom field key. */
export function toSystemFieldShellKey(key: string): string {
  return toFieldShellKey(key, CHECKSTACK_SYSTEM_PREFIX);
}

/**
 * Build the `<prefix><KEY>` shell vars for a set of custom fields. Values are
 * stringified (objects/arrays via JSON). A key that normalizes to an empty
 * name (just the prefix), to one of the `reserved` structural names, or to a
 * name a prior key already claimed is skipped and reported via `onCollision`
 * (never last-write-wins). The `reserved` guard keeps a custom field named
 * `id`/`name` from clobbering the structural `<prefix>ID` / `<prefix>NAME`.
 */
function buildFieldShellEnv({
  fields,
  prefix,
  label,
  reserved,
  toShellKey,
  onCollision,
}: {
  fields: Record<string, unknown>;
  prefix: string;
  label: string;
  reserved: ReadonlySet<string>;
  toShellKey: (key: string) => string;
  onCollision: (message: string) => void;
}): Record<string, string> {
  const env: Record<string, string> = {};
  // Track which original field key first claimed each shell var name so the
  // collision message can name both conflicting keys.
  const claimedBy: Record<string, string> = {};

  for (const [key, value] of Object.entries(fields)) {
    const shellKey = toShellKey(key);
    if (shellKey === prefix) {
      onCollision(
        `${label} custom field "${key}" normalizes to an empty shell var name; skipping.`,
      );
      continue;
    }
    if (reserved.has(shellKey)) {
      onCollision(
        `${label} custom field "${key}" maps to the reserved ${shellKey}; skipping (use a different key to avoid shadowing the built-in).`,
      );
      continue;
    }
    if (shellKey in env) {
      onCollision(
        `${label} custom fields "${claimedBy[shellKey]}" and "${key}" both map to ${shellKey}; keeping the first, skipping "${key}".`,
      );
      continue;
    }
    env[shellKey] = stringifyFieldValue(value);
    claimedBy[shellKey] = key;
  }

  return env;
}

/**
 * Build the `CHECKSTACK_ENV_<KEY>` shell vars for an environment's custom
 * fields. See {@link buildFieldShellEnv}.
 */
export function buildEnvironmentShellEnv(
  fields: Record<string, unknown>,
  onCollision: (message: string) => void = (message) =>
    console.warn(message),
): Record<string, string> {
  return buildFieldShellEnv({
    fields,
    prefix: CHECKSTACK_ENV_PREFIX,
    label: "Environment",
    reserved: new Set([CHECKSTACK_ENV_ID, CHECKSTACK_ENV_NAME]),
    toShellKey: toEnvFieldShellKey,
    onCollision,
  });
}

/**
 * Build the `CHECKSTACK_SYSTEM_<KEY>` shell vars for a system's custom fields.
 * See {@link buildFieldShellEnv}.
 */
export function buildSystemShellEnv(
  fields: Record<string, unknown>,
  onCollision: (message: string) => void = (message) =>
    console.warn(message),
): Record<string, string> {
  return buildFieldShellEnv({
    fields,
    prefix: CHECKSTACK_SYSTEM_PREFIX,
    label: "System",
    reserved: new Set([CHECKSTACK_SYSTEM_ID, CHECKSTACK_SYSTEM_NAME]),
    toShellKey: toSystemFieldShellKey,
    onCollision,
  });
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
