import { createHook } from "@checkstack/backend-api";
import {
  SCRIPT_PACKAGES_CHANGED_HOOK_ID,
  SCRIPT_SANDBOX_POLICY_CHANGED_HOOK_ID,
  type ScriptPackagesChangedPayload,
  type SandboxPolicyChangedPayload,
} from "@checkstack/script-packages-common";

/**
 * Backend hook fired by the elected installer after a successful install.
 *
 * Core instances subscribe in `broadcast` mode (every instance receives it,
 * the deliberate inverse of installer-election) and kick their reconciler
 * to delta-sync to the new `lockfileHash`. Each instance's broadcast
 * handler also pushes a `RefreshScriptPackages` control message to its
 * connected satellites (Phase 3). The hook is best-effort liveness; the
 * durable desired state (`install_state.lockfileHash`) drives idempotent
 * convergence on the next startup / assignment-sync regardless.
 */
export const scriptPackagesChangedHook = createHook<ScriptPackagesChangedPayload>(
  SCRIPT_PACKAGES_CHANGED_HOOK_ID,
);

/**
 * Backend hook fired after a successful global sandbox-policy write.
 *
 * Core instances subscribe in `broadcast` mode (every pod receives it) and each
 * pushes the new policy to its OWN connected satellites (push-on-change relay).
 * Best-effort liveness; the durable policy row is the source of truth and a
 * satellite re-pulls the relayed policy on (re)connect.
 */
export const sandboxPolicyChangedHook = createHook<SandboxPolicyChangedPayload>(
  SCRIPT_SANDBOX_POLICY_CHANGED_HOOK_ID,
);
