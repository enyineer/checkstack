import { implement } from "@orpc/server";
import { anomalyContract } from "@checkstack/anomaly-common";
import type { AnomalyService } from "./service";
import type { Logger } from "@checkstack/backend-api";

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
        return await service.updateAnomalyConfig(input.configurationId, input.config);
      }
    ),

    getAnomalyAssignmentConfig: os.getAnomalyAssignmentConfig.handler(
      async ({ input }) => {
        return await service.getAnomalyAssignmentConfig(input.systemId, input.configurationId);
      }
    ),

    updateAnomalyAssignmentConfig: os.updateAnomalyAssignmentConfig.handler(
      async ({ input }) => {
        return await service.updateAnomalyAssignmentConfig(input.systemId, input.configurationId, input.config);
      }
    ),
  });
}
