import {
  type ConfigService,
  readGlobalSandboxDefault,
  writeGlobalSandboxDefault,
  registerSandboxPolicyProvider,
  type SandboxPolicy,
  type SandboxPolicyInput,
} from "@checkstack/backend-api";

/**
 * The GLOBAL script-sandbox policy, owned by the `script-packages` plugin.
 *
 * SINGLE SOURCE OF TRUTH (state-and-scale rule):
 *  1. WHERE IT LIVES: one durable row in the shared Postgres `plugin_configs`
 *     table, scoped to the `script-packages` plugin id (this plugin's own
 *     {@link ConfigService}). It is NOT pod-local and NOT duplicated.
 *  2. SAME ANSWER ON EVERY POD: every core pod reads the same row, so the
 *     resolved policy is identical everywhere.
 *  3. NOT DUPLICATED: previously BOTH script plugins
 *     (`integration-script-backend`, `healthcheck-script-backend`) registered a
 *     policy provider that read THEIR OWN plugin-scoped row, so the
 *     process-global provider was last-writer-wins and each plugin read a
 *     different row. That is fixed here: `script-packages` is the single owner.
 *     It registers the one process-wide provider (see
 *     {@link registerScriptPackagesSandboxProvider}); the script plugins read
 *     this same value over RPC (`getSandboxPolicy`) for their own startup logs
 *     and no longer register a competing provider on the core pod.
 */
export interface SandboxPolicyService {
  /** Resolve the durable global policy (safe default when nothing stored). */
  read(): Promise<SandboxPolicy>;
  /**
   * Persist a PARTIAL policy override (merged over the safe default so
   * unspecified layers are preserved) and return the fully-resolved policy.
   */
  write(policy: SandboxPolicyInput): Promise<SandboxPolicy>;
}

/**
 * Build the global sandbox-policy service over the `script-packages` plugin's
 * {@link ConfigService}. Thin wrapper around the platform read/write helpers so
 * the single owning row is the only place the policy is read or written.
 */
export function createSandboxPolicyService({
  configService,
}: {
  configService: ConfigService;
}): SandboxPolicyService {
  return {
    read: () => readGlobalSandboxDefault({ configService }),
    write: (policy) => writeGlobalSandboxDefault({ configService, policy }),
  };
}

/**
 * Register the ONE process-wide active sandbox policy provider, backed by the
 * single owning row. Called once from `script-packages` init on the core pod.
 * The runners resolve the active policy through this provider and FAIL CLOSED
 * if it throws (transient DB error), so a read failure never widens the
 * sandbox.
 */
export function registerScriptPackagesSandboxProvider({
  service,
}: {
  service: Pick<SandboxPolicyService, "read">;
}): void {
  registerSandboxPolicyProvider(() => service.read());
}
