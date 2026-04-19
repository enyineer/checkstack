import { z } from "zod";
import { createClientDefinition, proc } from "@checkstack/common";
import { satelliteAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import { SatelliteWithStatusSchema, CreateSatelliteSchema } from "./schemas";

/**
 * RPC contract for satellite management.
 * Consumed by satellite-frontend for the management UI.
 */
export const satelliteContract = {
  /** List all satellites with computed online/offline status */
  listSatellites: proc({
    operationType: "query",
    userType: "authenticated",
    access: [satelliteAccess.satellite.read],
  }).output(
    z.object({ satellites: z.array(SatelliteWithStatusSchema) }),
  ),

  /** Get a single satellite by ID */
  getSatellite: proc({
    operationType: "query",
    userType: "authenticated",
    access: [satelliteAccess.satellite.read],
  })
    .input(z.object({ id: z.string() }))
    .output(SatelliteWithStatusSchema.nullable()),

  /**
   * Create a new satellite.
   * Returns the satellite record AND the plaintext token (shown once).
   * The clientId is the satellite's UUID (satellite.id).
   */
  createSatellite: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [satelliteAccess.satellite.manage],
  })
    .input(CreateSatelliteSchema)
    .output(
      z.object({
        satellite: SatelliteWithStatusSchema,
        /** Plaintext token — shown once, never stored */
        token: z.string(),
      }),
    ),

  /** Delete a satellite by ID */
  deleteSatellite: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [satelliteAccess.satellite.manage],
  })
    .input(z.object({ id: z.string() }))
    .output(z.void()),

  /**
   * Get the list of online satellite IDs.
   * Used internally by healthcheck-backend for stale source exclusion
   * during health state evaluation.
   */
  getOnlineSatelliteIds: proc({
    operationType: "query",
    userType: "service",
    access: [],
  }).output(z.object({ satelliteIds: z.array(z.string()) })),
};

// Export contract type
export type SatelliteContract = typeof satelliteContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(SatelliteApi);
export const SatelliteApi = createClientDefinition(
  satelliteContract,
  pluginMetadata,
);
