import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Fired when an install completes (or fails) so frontends invalidate the
 * install-state + per-host status queries. The frontend signal is separate
 * from the backend `script-packages.changed` hook (which drives reconcilers).
 */
export const SCRIPT_PACKAGES_CHANGED_SIGNAL = createSignal({
  pluginMetadata,
  event: "script_packages_changed",
  payloadSchema: z.object({
    lockfileHash: z.string().nullable(),
  }),
});

/**
 * Fired when a vulnerability-audit pass completes (scheduled or on-demand)
 * so the settings page live-refreshes its advisory list + last-run summary
 * without a manual reload.
 */
export const SCRIPT_PACKAGES_AUDIT_COMPLETED_SIGNAL = createSignal({
  pluginMetadata,
  event: "script_packages_audit_completed",
  payloadSchema: z.object({
    lockfileHash: z.string().nullable(),
    total: z.number().int().nonnegative(),
  }),
});
