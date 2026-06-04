import { z } from "zod";
import { sandboxPolicySchema } from "@checkstack/common";

/**
 * Id + payload schema for the backend `script-packages.changed` hook.
 *
 * The hook itself (`createHook`) lives in the backend package (hooks are a
 * backend concern), but the id + payload contract is shared here so the
 * satellite-distribution push message and any subscriber agree on the
 * shape. Emitted by the elected installer after a successful install;
 * core instances subscribe in `broadcast` mode and kick their reconciler.
 */
export const SCRIPT_PACKAGES_CHANGED_HOOK_ID = "script-packages.changed";

export const ScriptPackagesChangedPayloadSchema = z.object({
  /** The new desired lockfile hash hosts should reconcile to. */
  lockfileHash: z.string(),
});
export type ScriptPackagesChangedPayload = z.infer<
  typeof ScriptPackagesChangedPayloadSchema
>;

/**
 * Id + payload schema for the backend `script-sandbox.policy-changed` hook.
 *
 * Emitted by `script-packages` after a successful `setSandboxPolicy` write.
 * Core instances subscribe in `broadcast` mode (every pod receives it) and
 * each pushes the new policy to its OWN connected satellites - the
 * push-on-change relay. The hook is best-effort liveness; the durable policy
 * row is the source of truth and satellites re-pull the relayed policy on
 * (re)connect (carried in the `authenticated` message).
 */
export const SCRIPT_SANDBOX_POLICY_CHANGED_HOOK_ID =
  "script-sandbox.policy-changed";

export const SandboxPolicyChangedPayloadSchema = z.object({
  /** The new fully-resolved global sandbox policy to relay to satellites. */
  policy: sandboxPolicySchema,
});
export type SandboxPolicyChangedPayload = z.infer<
  typeof SandboxPolicyChangedPayloadSchema
>;
