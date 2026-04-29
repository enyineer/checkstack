import { implement } from "@orpc/server";
import { anomalyContract } from "@checkstack/anomaly-common";
import type { AnomalyService } from "./service";
import type { Logger } from "@checkstack/backend-api";
import type { VersionedRecord } from "@checkstack/backend-api";
import type { AnomalySettings } from "@checkstack/anomaly-common";

export function createRouter(
  service: AnomalyService,
  logger: Logger
) {
  const os = implement(anomalyContract);

  return os.router({
    getAnomalies: os.getAnomalies.handler(
      async ({ input }) => {
        logger.debug("Fetching anomalies", { input });
        return await service.getAnomalies(input ?? {});
      }
    ),

    getAnomalyBaselines: os.getAnomalyBaselines.handler(
      async ({ input }) => {
        logger.debug("Fetching anomaly baselines", { input });
        return await service.getAnomalyBaselines(input);
      }
    ),

    getAnomalyConfig: os.getAnomalyConfig.handler(
      async ({ input }) => {
        return await service.getAnomalyConfig(input.configurationId);
      }
    ),

    updateAnomalyConfig: os.updateAnomalyConfig.handler(
      async ({ input }) => {
        const result = await service.updateAnomalyConfig(input.configurationId, input.config);
        return result as VersionedRecord<AnomalySettings>;
      }
    ),

    getAnomalyAssignmentConfig: os.getAnomalyAssignmentConfig.handler(
      async ({ input }) => {
        const result = await service.getAnomalyAssignmentConfig(input.systemId, input.configurationId);
        // eslint-disable-next-line unicorn/no-null
        return (result as VersionedRecord<Partial<AnomalySettings>>) ?? null;
      }
    ),

    updateAnomalyAssignmentConfig: os.updateAnomalyAssignmentConfig.handler(
      async ({ input }) => {
        const result = await service.updateAnomalyAssignmentConfig(input.systemId, input.configurationId, input.config);
        return result as VersionedRecord<Partial<AnomalySettings>>;
      }
    ),
  });
}
