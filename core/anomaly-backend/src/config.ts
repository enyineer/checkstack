import { Versioned } from "@checkstack/backend-api";
import { AnomalySettingsSchema } from "@checkstack/anomaly-common";
import type { AnomalySettings } from "@checkstack/anomaly-common";

export const anomalySettingsConfig = new Versioned<AnomalySettings>({
  version: 1,
  schema: AnomalySettingsSchema,
});
