import type { CachePlugin, CacheProvider } from "@checkstack/cache-api";
import type { Logger } from "@checkstack/backend-api";
import { z } from "zod";
import { InMemoryCache } from "./memory-cache";

const configSchema = z.object({
  maxEntries: z
    .number()
    .min(1)
    .default(10_000)
    .describe("Maximum number of cache entries before eviction"),
  sweepIntervalMs: z
    .number()
    .min(0)
    .default(60_000)
    .describe(
      "Interval in ms for background sweep of expired entries. Set to 0 to disable.",
    ),
});

export type InMemoryCacheConfig = z.infer<typeof configSchema>;

export class InMemoryCachePlugin
  implements CachePlugin<InMemoryCacheConfig>
{
  id = "memory";
  displayName = "In-Memory Cache";
  description =
    "Simple in-memory cache for development and single-instance deployments";
  configVersion = 1;
  configSchema = configSchema;

  createProvider(config: InMemoryCacheConfig, _logger: Logger): CacheProvider {
    return new InMemoryCache(config);
  }
}
