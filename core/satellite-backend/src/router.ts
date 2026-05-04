import { implement, ORPCError } from "@orpc/server";
import {
  satelliteContract,
  SATELLITE_STATUS_CHANGED,
  SATELLITE_CONFIG_CHANGED,
} from "@checkstack/satellite-common";
import {
  autoAuthMiddleware,
  type RpcContext,
  type Logger,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import type { SatelliteService } from "./service";

/**
 * RPC router for satellite management.
 * Implements the satelliteContract from satellite-common using oRPC's
 * implement pattern with autoAuthMiddleware.
 */
export function createSatelliteRouter(props: {
  service: SatelliteService;
  signalService: SignalService;
  logger: Logger;
}) {
  const { service, signalService, logger } = props;

  const os = implement(satelliteContract)
    .$context<RpcContext>()
    .use(autoAuthMiddleware);

  return os.router({
    listSatellites: os.listSatellites.handler(async () => {
      const satellites = await service.listSatellites();
      return { satellites };
    }),

    getSatellite: os.getSatellite.handler(async ({ input }) => {
      const satellite = await service.getSatellite(input.id);
       
      return satellite ?? null;
    }),

    createSatellite: os.createSatellite.handler(async ({ input }) => {
      const { satellite, plaintextToken } =
        await service.createSatellite(input);

      logger.info(
        `Satellite created: ${satellite.name} (${satellite.region})`,
      );

      // Signal config change so UI refreshes
      await signalService.broadcast(SATELLITE_CONFIG_CHANGED, {
        satelliteId: satellite.id,
      });

      return { satellite, token: plaintextToken };
    }),

    deleteSatellite: os.deleteSatellite.handler(async ({ input }) => {
      const satellite = await service.getSatellite(input.id);
      if (!satellite) return;

      await service.deleteSatellite(input.id);

      logger.info(
        `Satellite deleted: ${satellite.name} (${satellite.region})`,
      );

      // Signal status change (satellite gone)
      await signalService.broadcast(SATELLITE_STATUS_CHANGED, {
        satelliteId: input.id,
        status: "offline",
        name: satellite.name,
        region: satellite.region,
      });
    }),

    updateSatellite: os.updateSatellite.handler(async ({ input }) => {
      const updated = await service.updateSatelliteMetadata(input);
      if (!updated) {
        throw new ORPCError("NOT_FOUND", {
          message: `Satellite not found: ${input.id}`,
        });
      }
      logger.info(`Satellite metadata updated: ${updated.name}`);
      await signalService.broadcast(SATELLITE_CONFIG_CHANGED, {
        satelliteId: updated.id,
      });
      return updated;
    }),

    rotateSatelliteToken: os.rotateSatelliteToken.handler(async ({ input }) => {
      const result = await service.rotateSatelliteToken(input.id);
      if (!result) {
        throw new ORPCError("NOT_FOUND", {
          message: `Satellite not found: ${input.id}`,
        });
      }
      logger.info(`Satellite token rotated: ${result.satellite.name}`);
      await signalService.broadcast(SATELLITE_CONFIG_CHANGED, {
        satelliteId: result.satellite.id,
      });
      return { satellite: result.satellite, token: result.plaintextToken };
    }),

    getOnlineSatelliteIds: os.getOnlineSatelliteIds.handler(async () => {
      const satelliteIds = await service.getOnlineSatelliteIds();
      return { satelliteIds };
    }),
  });
}
