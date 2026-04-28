import { createClientDefinition, proc } from "@checkstack/common";
import { z } from "zod";
import { cacheAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  CachePluginDtoSchema,
  CacheConfigurationDtoSchema,
  UpdateCacheConfigurationSchema,
} from "./schemas";

/**
 * Cache RPC Contract with access metadata.
 * Mirrors queue contract structure.
 */
export const cacheContract = {
  // Cache plugin queries - Read access
  getPlugins: proc({
    operationType: "query",
    userType: "authenticated",
    access: [cacheAccess.settings.read],
  }).output(z.array(CachePluginDtoSchema)),

  getConfiguration: proc({
    operationType: "query",
    userType: "authenticated",
    access: [cacheAccess.settings.read],
  }).output(CacheConfigurationDtoSchema),

  // Cache configuration updates - Manage access
  updateConfiguration: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [cacheAccess.settings.manage],
  })
    .input(UpdateCacheConfigurationSchema)
    .output(CacheConfigurationDtoSchema),
};

// Export contract type
export type CacheContract = typeof cacheContract;

// Export client definition for type-safe forPlugin usage
export const CacheApi = createClientDefinition(cacheContract, pluginMetadata);
