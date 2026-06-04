import { sandboxPolicySchema, type SandboxPolicy } from "./policy";

/**
 * Process-wide active sandbox policy provider.
 *
 * The script runners (`shell-script-runner.ts`, `esm-script-runner.ts`) no
 * longer accept a per-run `sandbox` argument: policy is GLOBAL-only. Each run
 * resolves the active policy through {@link resolveActiveSandboxPolicy}, which
 * awaits the provider registered once at platform startup
 * (see the script plugins' `init` and the satellite runtime).
 *
 * Why a provider (not a constant): the durable global default lives in the
 * shared Postgres `plugin_configs` table, reachable only where a
 * `ConfigService` is wired (the core pod). The runner module itself has no DB
 * handle, so startup hands it a closure that reads the durable value. This keeps
 * the global policy a single cluster-wide value (state-and-scale rule 2: the
 * same answer on every pod that has wired the same `ConfigService`-backed
 * provider), while the runner stays dependency-free.
 *
 * Fail-closed (security core): if NO provider is registered, or the registered
 * provider throws, {@link resolveActiveSandboxPolicy} returns the
 * {@link FAIL_CLOSED_SANDBOX_PROFILE} — the most restrictive safe policy (no
 * egress, scratch filesystem + read-only managed packages, privilege drop) —
 * NOT the permissive shipped
 * default. A misconfigured or un-wired runtime therefore denies, it does not
 * silently run unsandboxed.
 */

/** Reason string attached to the synthetic downgrade when failing closed. */
export const FAIL_CLOSED_DOWNGRADE_REASON =
  "no global sandbox policy provider was registered (or it failed); fell back " +
  "to the most restrictive fail-closed policy (deny egress, scratch filesystem " +
  "with read-only managed packages, privilege drop) instead of running " +
  "unsandboxed";

/**
 * The fail-closed policy. Derived from the shipped safe default's resource caps
 * and privilege drop, but with the network locked to `deny` (no egress at all)
 * and the filesystem locked to `scratch-plus-ro` — the per-run scratch dir is
 * writable and the reconciled managed-package tree
 * (`resolutionRoot/node_modules`) is bound READ-ONLY so a script can still
 * `import` its allowlisted packages, while the rest of the host FS stays
 * hidden. `onUnavailable` stays `degrade` so an unenforceable layer on a weak
 * host still RUNS the most restrictive subset it can (and surfaces the gap)
 * rather than refusing every run on a host that lacks the strong primitives —
 * refusing all runs would be a worse, silent-everything-breaks failure mode
 * than enforcing the portable subset.
 */
export const FAIL_CLOSED_SANDBOX_PROFILE: SandboxPolicy = sandboxPolicySchema.parse({
  enabled: true,
  onUnavailable: "degrade",
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
    mode: "deny",
    allow: [],
    denyLinkLocalAndMetadata: true,
  },
  privilege: {
    mode: "drop-to-uid",
  },
});

/** A registered provider for the active global sandbox policy. */
export type SandboxPolicyProvider = () => Promise<SandboxPolicy>;

/**
 * The result of resolving the active policy: the policy plus whether the
 * resolution fell back to {@link FAIL_CLOSED_SANDBOX_PROFILE}. The runners use
 * `failedClosed` to inject a synthetic downgrade into the run's
 * EffectiveSandbox report so the fallback is never silent.
 */
export interface ResolvedActiveSandboxPolicy {
  policy: SandboxPolicy;
  /** True when no provider was registered or the provider threw. */
  failedClosed: boolean;
}

// Module-level singleton. The active global policy is a single cluster-wide
// value, NOT per-run state — every run on this process wants the same answer —
// so a module-level provider closure is scale-correct. (Per-run state would be
// a bug; there is none here.)
let activeProvider: SandboxPolicyProvider | undefined;

/**
 * Register the process-wide active sandbox policy provider. Called ONCE at
 * platform startup where a `ConfigService` is available (the core pod) or with
 * the relayed cluster policy (the satellite runtime). Re-registering replaces
 * the previous provider (idempotent for the same closure; last writer wins),
 * which is harmless because the value is a single cluster-wide global.
 */
export function registerSandboxPolicyProvider(
  provider: SandboxPolicyProvider,
): void {
  activeProvider = provider;
}

/**
 * Clear the registered provider. Test-only helper so a test can assert the
 * fail-closed path and reset between cases. Not part of the production flow.
 */
export function resetSandboxPolicyProvider(): void {
  activeProvider = undefined;
}

/**
 * Resolve the active global sandbox policy for a run.
 *
 * - Provider registered and succeeds -> its policy, `failedClosed: false`.
 * - No provider, or the provider throws -> {@link FAIL_CLOSED_SANDBOX_PROFILE},
 *   `failedClosed: true`. NEVER the permissive shipped default.
 */
export async function resolveActiveSandboxPolicy(): Promise<ResolvedActiveSandboxPolicy> {
  if (activeProvider === undefined) {
    return { policy: FAIL_CLOSED_SANDBOX_PROFILE, failedClosed: true };
  }
  try {
    const policy = await activeProvider();
    return { policy, failedClosed: false };
  } catch {
    // A provider that throws (e.g. a transient DB error reading the durable
    // default) must NOT widen the sandbox: fail closed, not open.
    return { policy: FAIL_CLOSED_SANDBOX_PROFILE, failedClosed: true };
  }
}
