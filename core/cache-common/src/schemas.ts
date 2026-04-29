import { z } from "zod";

/**
 * DTO for cache plugin information
 */
export const CachePluginDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  configVersion: z.number(),
  configSchema: z.record(z.string(), z.unknown()),
});

export type CachePluginDto = z.infer<typeof CachePluginDtoSchema>;

/**
 * DTO for current cache configuration
 */
export const CacheConfigurationDtoSchema = z.object({
  pluginId: z.string(),
  config: z.record(z.string(), z.unknown()),
});

export type CacheConfigurationDto = z.infer<typeof CacheConfigurationDtoSchema>;

/**
 * Schema for updating cache configuration
 */
export const UpdateCacheConfigurationSchema = z.object({
  pluginId: z.string().describe("ID of the cache plugin to use"),
  config: z
    .record(z.string(), z.unknown())
    .describe("Plugin-specific configuration"),
});

export type UpdateCacheConfiguration = z.infer<
  typeof UpdateCacheConfigurationSchema
>;
