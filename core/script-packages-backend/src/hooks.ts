import { createHook } from "@checkstack/backend-api";
import {
  SCRIPT_PACKAGES_CHANGED_HOOK_ID,
  type ScriptPackagesChangedPayload,
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
