import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { SatelliteStatusSchema } from "./schemas";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Broadcast when a satellite's connection status changes (online ↔ offline).
 * Frontend components listening to this signal can update status badges in real-time.
 */
export const SATELLITE_STATUS_CHANGED = createSignal({
  pluginMetadata,
  event: "status.changed",
  payloadSchema: z.object({
    satelliteId: z.string(),
    status: SatelliteStatusSchema,
    name: z.string(),
    region: z.string(),
  }),
});

/**
 * Broadcast when satellite configuration changes (assignments updated).
 * Frontend components listening to this signal can refetch satellite data.
 */
export const SATELLITE_CONFIG_CHANGED = createSignal({
  pluginMetadata,
  event: "config.changed",
  payloadSchema: z.object({
    satelliteId: z.string(),
  }),
});
