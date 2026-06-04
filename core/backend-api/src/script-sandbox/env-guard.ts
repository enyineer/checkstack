/**
 * Centralized environment hardening for the shared script runners.
 *
 * Two responsibilities:
 *  1. The `SAFE_ENV_VARS` whitelist + `pickSafeEnv()` (moved here from the two
 *     runners, which previously each had an identical copy). This is the
 *     curated subset forwarded to user scripts so backend secrets never leak.
 *  2. A forbidden-key DENYLIST applied to the merged env when the sandbox is
 *     enabled. This closes the known env-injection escape: a caller/operator
 *     supplying `LD_PRELOAD` / `NODE_OPTIONS` / `PATH`-override etc. could
 *     otherwise subvert the child process. When the sandbox is disabled the
 *     denylist is NOT applied, preserving the exact pre-hardening behavior.
 */

/**
 * Vars passed through to the subprocess. We intentionally do NOT forward the
 * satellite's full env so backend secrets (DB URLs, API tokens, signing keys)
 * never reach user-authored scripts. PATH / HOME / LANG / ... are kept so
 * `node:child_process`, `node:fs`, locale-sensitive APIs, and ordinary CLI
 * tools behave normally.
 */
export const SAFE_ENV_VARS = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "HOSTNAME",
  "SHELL",
] as const;

/**
 * Forbidden env keys dropped from the merged env when the sandbox is enabled.
 *
 * These either alter the dynamic loader (`LD_*` / `DYLD_*`), inject code into
 * the Node/Bun runtime (`NODE_OPTIONS`), or repoint Bun's install/config
 * behavior (`BUN_INSTALL`, `BUN_CONFIG_*`). A user/operator must not be able
 * to set them; the legitimate safe vars (`PATH`, etc.) are still forwarded via
 * `SAFE_ENV_VARS`, but a caller cannot OVERRIDE `PATH` to a malicious dir
 * because `PATH` is on the denylist for caller-supplied overrides.
 *
 * `BUN_CONFIG_` is a prefix match (any key starting with it is dropped).
 */
export const FORBIDDEN_ENV_KEYS = [
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "NODE_OPTIONS",
  "BUN_INSTALL",
  // PATH is a safe-base var (the curated one is always forwarded), but a
  // caller-supplied PATH OVERRIDE could repoint binary resolution at a
  // malicious directory, so caller overrides of PATH are dropped (the
  // curated base PATH survives). Closes the PATH-override escape (§1/§5.6).
  "PATH",
] as const;

/** Key prefixes that are forbidden (any matching key is dropped). */
export const FORBIDDEN_ENV_PREFIXES = ["BUN_CONFIG_"] as const;

/**
 * Build the curated safe-env base from the current process environment.
 * Identical behavior to the per-runner copies this replaces.
 */
export function pickSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_VARS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

/** True when `key` is forbidden by the denylist (exact or prefix match). */
export function isForbiddenEnvKey(key: string): boolean {
  if ((FORBIDDEN_ENV_KEYS as readonly string[]).includes(key)) {
    return true;
  }
  return FORBIDDEN_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export interface FilterEnvResult {
  /** The merged env with forbidden keys removed (when enabled). */
  env: Record<string, string>;
  /** Keys that were dropped by the denylist. Empty when none / disabled. */
  dropped: string[];
}

/**
 * Build the final subprocess env: the safe-env base overlaid with the
 * caller-supplied `overrides`. When `applyDenylist` is true, any caller
 * override whose key is on the forbidden denylist is dropped (the safe-env
 * base value, if any, is retained — e.g. the real `PATH` survives, but a
 * caller's attempt to REPLACE it does not).
 *
 * When `applyDenylist` is false the behavior is exactly the prior
 * `{ ...pickSafeEnv(), ...overrides }` merge (back-compat for disabled
 * sandbox / opted-out runs).
 */
export function buildSubprocessEnv({
  base,
  overrides,
  applyDenylist,
}: {
  base: Record<string, string>;
  overrides?: Record<string, string>;
  applyDenylist: boolean;
}): FilterEnvResult {
  const env: Record<string, string> = { ...base };
  const dropped: string[] = [];

  if (overrides !== undefined) {
    for (const [key, value] of Object.entries(overrides)) {
      if (applyDenylist && isForbiddenEnvKey(key)) {
        dropped.push(key);
        continue;
      }
      env[key] = value;
    }
  }

  return { env, dropped };
}
