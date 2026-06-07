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

export const ANOMALY_STATE_CHANGED = createSignal({
  pluginMetadata,
  event: "state_changed",
  payloadSchema: z.object({
    systemId: z.string(),
    anomalyId: z.string(),
    newState: AnomalyStateSchema,
  }),
});

export const ANOMALY_BASELINE_UPDATED = createSignal({
  pluginMetadata,
  event: "baseline_updated",
  payloadSchema: z.object({
    systemId: z.string(),
    configurationId: z.string(),
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
