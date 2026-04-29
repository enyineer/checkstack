export * from "./schema";
export * from "./engine/baseline";
export * from "./engine/thresholds";
export * from "./engine/config";
export * from "./engine/drift";
export * from "./access";
export * from "./rpc-contract";
export * from "./plugin-metadata";

import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { AnomalyStateSchema } from "./schema";

export const ANOMALY_STATE_CHANGED = createSignal(
  "anomaly.state_changed",
  z.object({
    systemId: z.string(),
    anomalyId: z.string(),
    newState: AnomalyStateSchema,
  })
);

export const ANOMALY_BASELINE_UPDATED = createSignal(
  "anomaly.baseline_updated",
  z.object({
    systemId: z.string(),
    configurationId: z.string(),
    fieldPath: z.string(),
    mean: z.number(),
    stdDev: z.number(),
    sampleCount: z.number(),
  })
);

export const ANOMALY_TREND_DETECTED = createSignal(
  "anomaly.trend_detected",
  z.object({
    systemId: z.string(),
    anomalyId: z.string(),
    fieldPath: z.string(),
  })
);
