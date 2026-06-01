import { implement } from "@orpc/server";
import { anomalyContract } from "@checkstack/anomaly-common";
import type { AnomalyService } from "./service";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type Logger,
  type RealUser,
  type RpcContext,
  type VersionedRecord,
} from "@checkstack/backend-api";
import type { AnomalySettings } from "@checkstack/anomaly-common";
import type { AnomalyRouterCache } from "./router-cache";

export function createRouter(
  service: AnomalyService,
  logger: Logger,
  cache: AnomalyRouterCache,
) {
  const os = implement(anomalyContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    getAnomalies: os.getAnomalies.handler(
      async ({ input }) => {
        logger.debug("Fetching anomalies", { input });
        return cache.wrapAnomalies(input ?? {}, () =>
          service.getAnomalies(input ?? {}),
        );
      }
    ),

    getAnomalyBaselines: os.getAnomalyBaselines.handler(
      async ({ input }) => {
        logger.debug("Fetching anomaly baselines", { input });
        return cache.wrapBaselines(input, () =>
          service.getAnomalyBaselines(input),
        );
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
        // Config updates can change which fields are flagged; drop both
        // anomaly-list and baseline-list caches before returning so any
        // immediate refetch by the admin UI sees fresh state.
        await Promise.all([
          cache.invalidateAnomalies(),
          cache.invalidateBaselines(),
        ]);
        return result as VersionedRecord<AnomalySettings>;
      }
    ),

    getAnomalyAssignmentConfig: os.getAnomalyAssignmentConfig.handler(
      async ({ input }) => {
        const result = await service.getAnomalyAssignmentConfig(input.systemId, input.configurationId);
         
        return (result as VersionedRecord<Partial<AnomalySettings>>) ?? null;
      }
    ),

    updateAnomalyAssignmentConfig: os.updateAnomalyAssignmentConfig.handler(
      async ({ input }) => {
        const result = await service.updateAnomalyAssignmentConfig(input.systemId, input.configurationId, input.config);
        await Promise.all([
          cache.invalidateAnomalies(),
          cache.invalidateBaselines(),
        ]);
        return result as VersionedRecord<Partial<AnomalySettings>>;
      }
    ),

    suppressAnomaly: os.suppressAnomaly.handler(
      async ({ input }) => {
        const success = await service.suppressAnomaly({
          anomalyId: input.anomalyId,
          systemId: input.systemId,
        });
        await cache.invalidateAnomalies();
        return { success };
      },
    ),

    unsuppressAnomaly: os.unsuppressAnomaly.handler(
      async ({ input }) => {
        const success = await service.unsuppressAnomaly({
          anomalyId: input.anomalyId,
          systemId: input.systemId,
        });
        await cache.invalidateAnomalies();
        return { success };
      },
    ),

    listAnomalyNotificationMutes: os.listAnomalyNotificationMutes.handler(
      async ({ input, context }) => {
        const userId = (context.user as RealUser).id;
        return service.listMutes({ userId, systemId: input.systemId });
      },
    ),

    muteAnomalyNotification: os.muteAnomalyNotification.handler(
      async ({ input, context }) => {
        const userId = (context.user as RealUser).id;
        await service.addMute({
          userId,
          systemId: input.systemId,
          fieldPath: input.fieldPath,
        });
        return { success: true };
      },
    ),

    unmuteAnomalyNotification: os.unmuteAnomalyNotification.handler(
      async ({ input, context }) => {
        const userId = (context.user as RealUser).id;
        await service.removeMute({
          userId,
          systemId: input.systemId,
          fieldPath: input.fieldPath,
        });
        return { success: true };
      },
    ),
  });
}
