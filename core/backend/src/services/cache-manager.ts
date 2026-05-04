import type {
  CacheManager,
  CacheProvider,
  CacheStats,
  ListEntriesOptions,
  ListEntriesResult,
} from "@checkstack/cache-api";
import type { CachePluginRegistryImpl } from "./cache-plugin-registry";
import type { Logger, ConfigService } from "@checkstack/backend-api";
import { z } from "zod";
import { extractErrorMessage } from "@checkstack/common";

/**
 * Schema for the active cache plugin pointer.
 * Stored in the ConfigService for persistence and multi-instance coordination.
 */
const activeCachePointerSchema = z.object({
  activePluginId: z.string(),
  version: z.number(),
});

type ActiveCachePointer = z.infer<typeof activeCachePointerSchema>;

/**
 * A no-op CacheProvider used before any backend is configured.
 * All operations are safe to call but behave as if the cache is empty.
 *
 * Held only as the initial value of `activeProvider` until
 * `loadConfiguration()` runs; consumers always interact with the stable
 * proxy below, so they pick up the real provider as soon as it's ready.
 */
const nullProvider: CacheProvider = {
  // eslint-disable-next-line unicorn/no-useless-undefined
  get: async () => undefined,
  set: async () => {},
  delete: async () => {},
  deleteByPrefix: async () => 0,
  has: async () => false,
};

/**
 * CacheManagerImpl handles cache provider lifecycle and backend switching.
 *
 * `getProvider()` returns a single stable proxy whose methods delegate to
 * whichever provider is currently active. This means:
 *
 *  - Plugins that capture the proxy at init time (e.g. via
 *    `createCachedScope`) keep functioning across backend switches and
 *    don't write into orphaned providers.
 *  - The Infrastructure runtime panel reads stats from the same instance
 *    plugins write to — no split-brain.
 *
 * The earlier "no proxy pattern needed since cache is stateless key/value"
 * comment was wrong: in-memory backends are stateful and replacing the
 * active reference would orphan their state.
 */
export class CacheManagerImpl implements CacheManager {
  private activePluginId: string = "memory";
  private activeConfig: unknown = {
    maxEntries: 10_000,
    sweepIntervalMs: 60_000,
  };
  private configVersion: number = 0;
  private activeProvider: CacheProvider = nullProvider;
  private readonly providerProxy: CacheProvider;

  constructor(
    private registry: CachePluginRegistryImpl,
    private configService: ConfigService,
    private logger: Logger,
  ) {
    this.providerProxy = this.createProviderProxy();
  }

  private createProviderProxy(): CacheProvider {
    return {
      get: <T>(key: string) => this.activeProvider.get<T>(key),
      set: <T>(key: string, value: T, ttlMs?: number) =>
        this.activeProvider.set<T>(key, value, ttlMs),
      delete: (key: string) => this.activeProvider.delete(key),
      deleteByPrefix: (prefix: string) =>
        this.activeProvider.deleteByPrefix(prefix),
      has: (key: string) => this.activeProvider.has(key),
      getStats: async (): Promise<CacheStats> => {
        const provider = this.activeProvider;
        if (provider.getStats) {
          return provider.getStats();
        }
        return {
          keyCount: null,
          sizeBytes: null,
          hits: null,
          misses: null,
          scope: "instance",
        };
      },
      listEntries: async (
        opts: ListEntriesOptions,
      ): Promise<ListEntriesResult> => {
        const provider = this.activeProvider;
        if (!provider.listEntries) {
          return { items: [], total: 0, hasMore: false };
        }
        return provider.listEntries(opts);
      },
    };
  }

  async loadConfiguration(): Promise<void> {
    try {
      const pointer = await this.configService.get<ActiveCachePointer>(
        "cache:active",
        activeCachePointerSchema,
        1,
      );

      if (pointer) {
        this.activePluginId = pointer.activePluginId;
        this.configVersion = pointer.version;

        const plugin = this.registry.getPlugin(this.activePluginId);
        if (plugin) {
          const config = await this.configService.get(
            this.activePluginId,
            plugin.configSchema,
            plugin.configVersion,
          );

          if (config) {
            this.activeConfig = config;
          }
        }

        this.logger.info(
          `📦 Loaded cache configuration: plugin=${this.activePluginId}, version=${this.configVersion}`,
        );
      } else {
        this.logger.info(
          `📦 No cache configuration found, using default: plugin=${this.activePluginId}`,
        );
      }

      this.initializeProvider();
    } catch (error) {
      this.logger.error("Failed to load cache configuration", error);
      // Continue with defaults — nullProvider is already set behind the proxy.
    }
  }

  private initializeProvider(): void {
    const plugin = this.registry.getPlugin(this.activePluginId);
    if (!plugin) {
      this.logger.warn(
        `Cache plugin '${this.activePluginId}' not found, using null provider`,
      );
      return;
    }

    try {
      this.activeProvider = plugin.createProvider(
        this.activeConfig,
        this.logger,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create cache provider for '${this.activePluginId}'`,
        error,
      );
    }
  }

  /**
   * Returns the stable proxy. The same instance is returned for the
   * lifetime of the manager, so callers can safely capture it once.
   */
  getProvider(): CacheProvider {
    return this.providerProxy;
  }

  getActivePlugin(): string {
    return this.activePluginId;
  }

  getActiveConfig(): unknown {
    return this.activeConfig;
  }

  async setActiveBackend(pluginId: string, config: unknown): Promise<void> {
    const newPlugin = this.registry.getPlugin(pluginId);
    if (!newPlugin) {
      throw new Error(`Cache plugin '${pluginId}' not found`);
    }

    newPlugin.configSchema.parse(config);

    this.logger.info("🔍 Testing new cache provider...");
    let newProvider: CacheProvider;
    try {
      newProvider = newPlugin.createProvider(config, this.logger);
      await newProvider.set("__test__", true, 1000);
      await newProvider.delete("__test__");
      this.logger.info("✅ Cache provider test successful");
    } catch (error) {
      const message = extractErrorMessage(error);
      this.logger.error(`❌ Cache provider test failed: ${message}`);
      throw new Error(`Failed to create cache provider: ${message}`);
    }

    const oldProvider = this.activeProvider;
    if ("stop" in oldProvider && typeof oldProvider.stop === "function") {
      await (oldProvider as { stop: () => Promise<void> }).stop();
    }

    const oldPluginId = this.activePluginId;
    this.activePluginId = pluginId;
    this.activeConfig = config;
    this.configVersion++;
    this.activeProvider = newProvider;

    await this.configService.set(
      pluginId,
      newPlugin.configSchema,
      newPlugin.configVersion,
      config,
    );

    await this.configService.set("cache:active", activeCachePointerSchema, 1, {
      activePluginId: pluginId,
      version: this.configVersion,
    });

    this.logger.info(`✅ Cache backend switched: ${oldPluginId} → ${pluginId}`);
  }

  async shutdown(): Promise<void> {
    this.logger.info("🛑 Shutting down cache provider...");
    const provider = this.activeProvider;
    if ("stop" in provider && typeof provider.stop === "function") {
      await (provider as { stop: () => Promise<void> }).stop();
    }
    this.activeProvider = nullProvider;
    this.logger.info("✅ Cache provider shut down");
  }
}
