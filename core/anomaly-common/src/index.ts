export * from "./schema";
export * from "./engine/baseline";
export * from "./engine/thresholds";
export * from "./engine/inference";
export * from "./engine/config";
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
