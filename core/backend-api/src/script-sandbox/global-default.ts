import type { ConfigService } from "../config-service";
import {
  mergeSandboxPolicy,
  resolveDefaultSandboxProfile,
  sandboxPolicySchema,
  type SandboxPolicy,
  type SandboxPolicyInput,
} from "./policy";

/**
 * Durable, cluster-wide global default sandbox policy (plan §5.8).
 *
 * State-and-scale (`.claude/rules/state-and-scale.md`):
 *  1. WHERE IT LIVES: the existing plugin-scoped {@link ConfigService}, which
 *     persists to the shared Postgres `plugin_configs` table. NOT pod-local,
 *     NOT an env var that could differ per pod.
 *  2. SAME ANSWER ON EVERY POD: every pod/satellite reads the same row, so the
 *     resolved global default is identical everywhere it is read. The dedicated
 *     low-priv UID/GID seed (from `CHECKSTACK_SANDBOX_UID/GID`) is genuinely
 *     per-host infrastructure (a host without that user cannot drop to it), and
 *     that divergence is surfaced per run in the EffectiveSandbox report — it
 *     is not the queryable global policy.
 *  3. NOT DUPLICATED: this is the single writer of the logical "global default
 *     sandbox policy"; the per-item `sandbox` config field is a separate,
 *     narrower override applied ON TOP of this value.
 *
 * The shipped, code-level safe default ({@link resolveDefaultSandboxProfile})
 * is the value used when no row exists yet (a fresh install, or before an
 * operator ever touches the setting), so on-by-default holds even with an empty
 * settings table. An operator opts out globally by storing `{ enabled: false }`
 * (or any partial override) here.
 */

/**
 * Config key under which the global default sandbox policy is stored. Scoped to
 * the writing plugin by {@link ConfigService}, so each script plugin keeps its
 * own row; the read-side {@link readGlobalSandboxDefault} resolves the same key.
 */
export const GLOBAL_SANDBOX_DEFAULT_CONFIG_ID = "script-sandbox:global-default";

/** Schema version for the stored policy (bump + add a migration on change). */
export const GLOBAL_SANDBOX_DEFAULT_VERSION = 1;

/**
 * Read the durable global default sandbox policy, falling back to the shipped
 * safe default when nothing has been stored.
 *
 * Returns a fully-resolved {@link SandboxPolicy} suitable to pass straight to a
 * runner's `sandbox` option (the runner merges it over its own default profile
 * idempotently) or to merge a per-item override on top of via
 * `mergeSandboxPolicy`.
 */
export async function readGlobalSandboxDefault({
  configService,
}: {
  configService: ConfigService;
}): Promise<SandboxPolicy> {
  const stored = await configService.get<SandboxPolicy>(
    GLOBAL_SANDBOX_DEFAULT_CONFIG_ID,
    sandboxPolicySchema,
    GLOBAL_SANDBOX_DEFAULT_VERSION,
  );
  // No row yet → the shipped safe default (with the dedicated UID/GID seeded
  // from this host's env). On-by-default holds even on an empty settings table.
  return stored ?? resolveDefaultSandboxProfile();
}

/**
 * Persist the global default sandbox policy.
 *
 * The input is treated as a PARTIAL override merged over the shipped safe
 * default profile ({@link resolveDefaultSandboxProfile} via
 * {@link mergeSandboxPolicy}), so an admin loosening a single layer (e.g. just
 * `{ resources: { memoryBytes } }`) does NOT silently reset the unspecified
 * layers (filesystem → off, privilege → inherit, ...) cluster-wide. Only the
 * fields the admin actually set change; everything else keeps the safe default.
 * Use `{ enabled: false }` to globally opt out.
 */
export async function writeGlobalSandboxDefault({
  configService,
  policy,
}: {
  configService: ConfigService;
  policy: SandboxPolicyInput;
}): Promise<SandboxPolicy> {
  // Validate the partial first (bounds + .strict), then overlay only the
  // provided fields onto the safe default so unspecified layers are preserved.
  sandboxPolicySchema.parse(policy);
  const resolved = mergeSandboxPolicy({
    base: resolveDefaultSandboxProfile(),
    override: policy,
  });
  await configService.set<SandboxPolicy>(
    GLOBAL_SANDBOX_DEFAULT_CONFIG_ID,
    sandboxPolicySchema,
    GLOBAL_SANDBOX_DEFAULT_VERSION,
    resolved,
  );
  return resolved;
}
