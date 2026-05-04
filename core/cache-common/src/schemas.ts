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

/**
 * Scope of a cache stats response: `"instance"` if the figures reflect just
 * the local process, `"cluster"` if they're shared across the deployment.
 */
export const CacheStatsScopeSchema = z.enum(["instance", "cluster"]);
export type CacheStatsScope = z.infer<typeof CacheStatsScopeSchema>;

/**
 * Runtime stats DTO for the Infrastructure UI.
 *
 * Each numeric field is nullable to signal "backend can't report it cheaply".
 * `pluginId` is the active cache backend id at read time. `scope` lets the
 * UI warn the operator when in-memory backends are running with horizontal
 * scaling.
 */
export const CacheRuntimeStatsSchema = z.object({
  pluginId: z.string(),
  keyCount: z.number().int().nonnegative().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  hits: z.number().int().nonnegative().nullable(),
  misses: z.number().int().nonnegative().nullable(),
  scope: CacheStatsScopeSchema,
});

export type CacheRuntimeStats = z.infer<typeof CacheRuntimeStatsSchema>;

export const CacheEntrySummaryDtoSchema = z.object({
  key: z.string(),
  byteSize: z.number().int().nonnegative(),
  expiresAt: z.coerce.date().nullable(),
});

export type CacheEntrySummaryDto = z.infer<typeof CacheEntrySummaryDtoSchema>;

export const ListCacheEntriesInputSchema = z.object({
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200),
  sortBy: z.enum(["biggest", "newest"]),
});

export type ListCacheEntriesInput = z.infer<
  typeof ListCacheEntriesInputSchema
>;

/**
 * Response DTO for `listEntries`. `supported` is `false` when the active
 * cache backend doesn't implement entry enumeration; the UI shows a
 * "Listing not supported by this backend" message in that case.
 *
 * `total` is nullable so backends that can't compute it cheaply (some
 * remote caches) can still paginate using `hasMore`.
 */
export const ListCacheEntriesResultSchema = z.object({
  supported: z.boolean(),
  items: z.array(CacheEntrySummaryDtoSchema),
  total: z.number().int().nonnegative().nullable(),
  hasMore: z.boolean(),
});

export type ListCacheEntriesResult = z.infer<
  typeof ListCacheEntriesResultSchema
>;
