import {
  FAIL_CLOSED_SANDBOX_PROFILE,
  type SandboxPolicy,
  type SandboxPolicyProvider,
} from "@checkstack/backend-api";

/**
 * Pod-local cache of the GLOBAL sandbox policy relayed to this satellite by the
 * core over the authenticated WS channel.
 *
 * State-and-scale note: this is NOT a queryable global source of truth - the
 * core's durable policy row is. It is genuinely satellite-local transport state
 * (the policy this specific satellite was last told to enforce), exactly like
 * the pod-local live-socket registry on the core side. The satellite has no
 * database connection, so it cannot read the durable policy directly; it trusts
 * the already-authenticated WS connection to relay it.
 *
 * SECURITY - FAIL CLOSED UNTIL RELAY: before the first policy is received,
 * {@link resolve} returns {@link FAIL_CLOSED_SANDBOX_PROFILE} (deny egress,
 * scratch filesystem + read-only managed packages, privilege drop) - NEVER the
 * permissive shipped default. A satellite must never run a script with a looser
 * policy than core relayed, and before the first relay there is no relayed
 * policy, so it denies. The policy is delivered on connect (in the
 * `authenticated` message) and on change (a `sandbox_policy` push), so the
 * fail-closed window is only the brief interval before the first authenticated
 * message is processed.
 */
export class SatelliteSandboxPolicyCache {
  private policy: SandboxPolicy | undefined;

  /** Replace the cached policy with the latest relayed value. */
  set(policy: SandboxPolicy): void {
    this.policy = policy;
  }

  /**
   * Resolve the policy to enforce for a run: the cached relayed policy, or the
   * fail-closed profile if nothing has been relayed yet. Bound so it can be
   * handed directly to {@link registerSandboxPolicyProvider} as the provider.
   */
  resolve = async (): Promise<SandboxPolicy> => {
    return this.policy ?? FAIL_CLOSED_SANDBOX_PROFILE;
  };

  /** A {@link SandboxPolicyProvider} closure bound to this cache. */
  toProvider(): SandboxPolicyProvider {
    return this.resolve;
  }
}
