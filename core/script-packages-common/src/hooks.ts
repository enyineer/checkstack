import { z } from "zod";

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
