import { createClientDefinition, proc } from "@checkstack/common";
import { z } from "zod";
import { cacheAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  CachePluginDtoSchema,
  CacheConfigurationDtoSchema,
  UpdateCacheConfigurationSchema,
  CacheRuntimeStatsSchema,
  ListCacheEntriesInputSchema,
  ListCacheEntriesResultSchema,
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

  // Cache runtime stats - Read access
  getRuntimeStats: proc({
    operationType: "query",
    userType: "authenticated",
    access: [cacheAccess.settings.read],
  }).output(CacheRuntimeStatsSchema),

  // List cache entries (without values) - Read access. Backends without an
  // affordable enumeration path return `supported: false`.
  listEntries: proc({
    operationType: "query",
    userType: "authenticated",
    access: [cacheAccess.settings.read],
  })
    .input(ListCacheEntriesInputSchema)
    .output(ListCacheEntriesResultSchema),
};

// Export contract type
export type CacheContract = typeof cacheContract;

// Export client definition for type-safe forPlugin usage
export const CacheApi = createClientDefinition(cacheContract, pluginMetadata);
