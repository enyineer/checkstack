export * from "./schema";
export * from "./engine/baseline";
export * from "./engine/thresholds";
export * from "./engine/config";
export * from "./engine/drift";
export * from "./engine/self-resolution";
export * from "./access";
export * from "./signals";
export * from "./rpc-contract";
export * from "./plugin-metadata";
export * from "./notifications";

import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { AnomalyStateSchema } from "./schema";
import { pluginMetadata } from "./plugin-metadata";

/**
 * States a broadcast anomaly transition can carry. A superset of the persisted
 * {@link AnomalyStateSchema}: a `suspicious` row that never reaches its
 * confirmation threshold is DELETED rather than moved to `recovered`, so it has
 * no persisted state left to report. `cleared` is that transition. Consumers
 * must treat it exactly like `recovered` for the purpose of dropping the row
 * from any active feed, but it is deliberately a distinct value so an
 * automation that fires on `recovered` ("the anomaly we alerted about is over")
 * does not also fire for a transient suspicion that was never confirmed and
 * therefore never notified about.
 */
export const AnomalyStateChangeSchema = z.enum([
  ...AnomalyStateSchema.options,
  "cleared",
]);
export type AnomalyStateChange = z.infer<typeof AnomalyStateChangeSchema>;

export const ANOMALY_STATE_CHANGED = createSignal({
  pluginMetadata,
  event: "state_changed",
  payloadSchema: z.object({
    systemId: z.string(),
    anomalyId: z.string(),
    newState: AnomalyStateChangeSchema,
  }),
});

export const ANOMALY_BASELINE_UPDATED = createSignal({
  pluginMetadata,
  event: "baseline_updated",
  payloadSchema: z.object({
    systemId: z.string(),
    configurationId: z.string(),
    /**
     * Environment the recomputed baseline belongs to. null = the env-less
     * slice (no environment membership). Subscribers that only key on
     * (system, config, fieldPath) keep working; env-aware subscribers can
     * now scope their refetch.
     */
    environmentId: z.string().nullable(),
    fieldPath: z.string(),
    mean: z.number(),
    stdDev: z.number(),
    sampleCount: z.number(),
  }),
});

export const ANOMALY_TREND_DETECTED = createSignal({
  pluginMetadata,
  event: "trend_detected",
  payloadSchema: z.object({
    systemId: z.string(),
    anomalyId: z.string(),
    fieldPath: z.string(),
  }),
});
