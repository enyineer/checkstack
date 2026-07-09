import type { CachePlugin, CacheProvider } from "@checkstack/cache-api";
import type { Logger } from "@checkstack/backend-api";
import { z } from "zod";
import { RedisCache } from "./redis-cache";

const configSchema = z.object({
  host: z.string().min(1).default("localhost").describe("Redis host"),
  port: z.number().int().min(1).max(65_535).default(6379).describe("Redis port"),
  password: z
    .string()
    .optional()
    .describe("Redis password (omit for an unauthenticated instance)"),
  db: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Redis logical database index"),
});

export type RedisCacheConfigInput = z.infer<typeof configSchema>;

/**
 * Redis cache backend plugin — the DISTRIBUTED cache operators configure for
 * horizontally-scaled (multi-pod) deployments. Every pod shares one Redis, so a
 * write/delete on any pod is visible to all, giving cross-pod cache coherence
 * without application-level broadcast. The default `memory` backend is per-pod
 * and only suitable for a single instance (dev / single-pod).
 */
export class RedisCachePlugin implements CachePlugin<RedisCacheConfigInput> {
  id = "redis";
  displayName = "Redis Cache";
  description =
    "Distributed Redis-backed cache for horizontally-scaled (multi-pod) deployments";
  configVersion = 1;
  configSchema = configSchema;

  /**
   * @param namespace instance namespace folded into every key so a secondary
   * instance sharing the same Redis cannot collide with the default instance.
   */
  constructor(private readonly namespace: string | undefined) {}

  createProvider(config: RedisCacheConfigInput, logger: Logger): CacheProvider {
    return new RedisCache(
      {
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db,
        keyPrefix: this.namespace ? `${this.namespace}:cache:` : "cache:",
      },
      logger,
    );
  }
}
