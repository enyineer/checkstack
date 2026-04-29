import { z } from "zod";
import { createSignal } from "@checkstack/signal-common";
import { LagSeveritySchema } from "./schemas";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Signal broadcast when queue lag status changes.
 * Frontend listens to update lag warning UI in real-time.
 */
export const QUEUE_LAG_CHANGED = createSignal({
  pluginMetadata,
  event: "lag.changed",
  payloadSchema: z.object({
    pending: z.number(),
    severity: LagSeveritySchema,
  }),
});
