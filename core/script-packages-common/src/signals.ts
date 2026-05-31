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
