import {
  sandboxPolicySchema,
  type SandboxPolicy,
  type SandboxPolicyInput,
} from "@checkstack/common";

/**
 * OS-level sandbox policy for the shared user-script runners.
 *
 * The policy SHAPE (the zod `sandboxPolicySchema` and its sub-schemas) is the
 * single source of truth in `@checkstack/common` so it can be shared by the
 * RPC contract (admin read/write endpoints) and the satellite WS protocol
 * (policy relay) without a backward dependency on this backend package. This
 * module re-exports that schema and layers the runtime-only
 * helpers on top: the shipped default profile, the env-seeded low-priv UID/GID
 * resolution, and `mergeSandboxPolicy`.
 *
 * The two runners (`shell-script-runner.ts`, `esm-script-runner.ts`) parse a
 * `SandboxPolicyInput` against {@link sandboxPolicySchema}, reconcile it against
 * detected host capabilities, and build the extra `Bun.spawn` options from the
 * result.
 */

export {
  onUnavailableSchema,
  resourceLimitsSchema,
  filesystemPolicySchema,
  networkPolicySchema,
  privilegePolicySchema,
  sandboxPolicySchema,
  type OnUnavailable,
  type ResourceLimits,
  type FilesystemPolicy,
  type NetworkPolicy,
  type PrivilegePolicy,
  type SandboxPolicy,
  type SandboxPolicyInput,
} from "@checkstack/common";

/**
 * The shipped global default profile (DP) - plan §6.1.
 *
 * This is the runner's base default, so every script run is hardened out of the
 * box. It is SECURE-by-default: egress is denied until an operator adds
 * allowlist entries (network `allowlist` with an empty `allow` list), temp-file
 * writes are confined to the per-run scratch dir, the reconciled managed-package
 * tree is bound read-only, and fork-bombs / OOM / disk-fill plus reads of
 * arbitrary host paths (on a wrapper host) are blocked. Ordinary outbound
 * `fetch` does NOT work by default - the operator must allowlist the
 * destinations a script may reach.
 *
 * FAIL-CLOSED by default (`onUnavailable: "fail"`): if any requested layer
 * cannot be enforced on the host, the run is REFUSED
 * ({@link SandboxUnavailableError} -> clean `exitCode: -1`, NO unsandboxed
 * spawn) rather than silently degrading to a weaker subset. This makes the
 * shipped global default fail safe: a malicious script never slips through on a
 * host that is missing a sandbox primitive. The official container images are
 * built to support every layer (bubblewrap + unprivileged user namespaces +
 * slirp4netns rootless egress + util-linux rlimits + a dedicated non-root UID),
 * so the secure default WORKS out of the box there - see the container
 * verification in `docs/.../script-sandboxing` and the in-container probe. An
 * operator running on a host that genuinely cannot enforce a layer can switch
 * the global policy to `degrade` (drop to the portable subset and surface it)
 * via the admin settings page; that is an explicit, audited opt-out, never a
 * silent one. Each run's actual enforcement is reported via the
 * {@link EffectiveSandbox} report.
 *
 * The `privilege.uid`/`gid` are left UNSET here; the dedicated low-priv target
 * is resolved at runtime by {@link resolveDefaultSandboxProfile} (from
 * `CHECKSTACK_SANDBOX_UID` / `CHECKSTACK_SANDBOX_GID`), so the constant stays a
 * pure value and the env read happens once per process where it is used.
 */
export const DEFAULT_SANDBOX_PROFILE: SandboxPolicy = sandboxPolicySchema.parse({
  enabled: true,
  // Fail-closed: refuse the run if a layer can't be enforced, rather than
  // silently dropping to a weaker subset. The shipped containers support every
  // layer so this is a working default there; weak hosts can opt into
  // "degrade" explicitly via the admin settings page.
  onUnavailable: "fail",
  resources: {
    cpuSeconds: 60,
    memoryBytes: 512 * 1024 * 1024,
    maxOpenFiles: 1024,
    maxProcesses: 256,
    maxOutputBytes: 5 * 1024 * 1024,
    maxFileSizeBytes: 256 * 1024 * 1024,
  },
  filesystem: {
    mode: "scratch-plus-ro",
  },
  network: {
    // Secure-by-default: allowlist with an EMPTY allow list = deny egress until
    // an operator adds entries. Link-local / cloud-metadata IPs stay blocked.
    mode: "allowlist",
    allow: [],
    denyLinkLocalAndMetadata: true,
  },
  privilege: {
    mode: "drop-to-uid",
  },
});

/** Env var naming the dedicated low-privilege UID to drop script runs to. */
export const SANDBOX_UID_ENV = "CHECKSTACK_SANDBOX_UID";
/** Env var naming the dedicated low-privilege GID to drop script runs to. */
export const SANDBOX_GID_ENV = "CHECKSTACK_SANDBOX_GID";

/**
 * Parse a non-negative integer from an env value, or `undefined` when unset /
 * malformed. A malformed value is treated as "not configured" (the privilege
 * drop then degrades to `inherit` and surfaces it) rather than throwing - a
 * typo in an operator env var must not crash every script run.
 */
function readNonNegativeIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

/**
 * Resolve the shipped {@link DEFAULT_SANDBOX_PROFILE} with the dedicated
 * low-privilege UID/GID seeded from the environment
 * (`CHECKSTACK_SANDBOX_UID` / `CHECKSTACK_SANDBOX_GID`).
 *
 * This is the value the runner uses as its base default. When no UID is
 * configured (the common dev / macOS case) the privilege layer keeps
 * `drop-to-uid` but, with no target, the wrapper degrades it to `inherit` and
 * surfaces it - never a hard failure. A configured GID without a UID is
 * ignored (a GID drop without a UID drop is not meaningful here).
 *
 * Pure read of `process.env`; safe to call per run (no spawning, no I/O).
 */
export function resolveDefaultSandboxProfile(): SandboxPolicy {
  const uid = readNonNegativeIntEnv(SANDBOX_UID_ENV);
  if (uid === undefined) {
    return DEFAULT_SANDBOX_PROFILE;
  }
  const gid = readNonNegativeIntEnv(SANDBOX_GID_ENV);
  return {
    ...DEFAULT_SANDBOX_PROFILE,
    privilege: {
      ...DEFAULT_SANDBOX_PROFILE.privilege,
      uid,
      ...(gid === undefined ? {} : { gid }),
    },
  };
}

/**
 * Deep-merge a partial per-item override on top of a base policy. The base is
 * the fully-resolved global default (e.g. {@link DEFAULT_SANDBOX_PROFILE}, or
 * the durable global default read from settings); the override is a partial
 * `SandboxPolicyInput` parsed from a per-check /
 * per-action `sandbox` config field. Per-item values win per-field, and only
 * the fields the override actually sets are touched - an override that only
 * sets `{ network: { mode: "deny" } }` must not re-widen the other layers
 * back to the bare zod field defaults.
 *
 * Returns a validated {@link SandboxPolicy}.
 */
export function mergeSandboxPolicy({
  base,
  override,
}: {
  base: SandboxPolicy;
  override?: SandboxPolicyInput;
}): SandboxPolicy {
  if (override === undefined) {
    return base;
  }
  // Validate the override against the schema FIRST so its values and bounds
  // are enforced, then overlay only the keys the caller actually provided
  // (defined keys only) so an unset layer keeps the base value rather than
  // being re-widened to the bare zod field default.
  sandboxPolicySchema.parse(override);

  const merged: SandboxPolicy = {
    enabled: pick(override.enabled, base.enabled),
    onUnavailable: pick(override.onUnavailable, base.onUnavailable),
    resources: overlayDefined(base.resources, override.resources),
    filesystem: overlayDefined(base.filesystem, override.filesystem),
    network: overlayDefined(base.network, override.network),
    privilege: overlayDefined(base.privilege, override.privilege),
  };

  // Re-validate the merged shape (cheap; keeps bounds + strict enforcement).
  return sandboxPolicySchema.parse(merged);
}

/** Return `value` when defined, otherwise `fallback`. */
function pick<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

/**
 * Overlay only the *defined* keys of `over` onto `base`. An explicit
 * `undefined` in `over` does not clobber the base value.
 */
function overlayDefined<T extends Record<string, unknown>>(
  base: T,
  over: Partial<T> | undefined,
): T {
  if (over === undefined) {
    return base;
  }
  const result: T = { ...base };
  for (const key of Object.keys(over) as Array<keyof T>) {
    const value = over[key];
    if (value !== undefined) {
      result[key] = value as T[keyof T];
    }
  }
  return result;
}
