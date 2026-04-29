import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
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
 * Simpler than QueueManagerImpl — no proxy pattern needed since cache is
 * stateless key/value. The active provider is replaced atomically on backend switch.
 */
export class CacheManagerImpl implements CacheManager {
  private activePluginId: string = "memory";
  private activeConfig: unknown = {
    maxEntries: 10_000,
    sweepIntervalMs: 60_000,
  };
  private configVersion: number = 0;
  private activeProvider: CacheProvider = nullProvider;

  constructor(
    private registry: CachePluginRegistryImpl,
    private configService: ConfigService,
    private logger: Logger,
  ) {}

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

      // Initialize the active provider
      this.initializeProvider();
    } catch (error) {
      this.logger.error("Failed to load cache configuration", error);
      // Continue with defaults — nullProvider is already set
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

  getProvider(): CacheProvider {
    return this.activeProvider;
  }

  getActivePlugin(): string {
    return this.activePluginId;
  }

  getActiveConfig(): unknown {
    return this.activeConfig;
  }

  async setActiveBackend(pluginId: string, config: unknown): Promise<void> {
    // 1. Validate plugin exists
    const newPlugin = this.registry.getPlugin(pluginId);
    if (!newPlugin) {
      throw new Error(`Cache plugin '${pluginId}' not found`);
    }

    // 2. Validate config against schema
    newPlugin.configSchema.parse(config);

    // 3. Create new provider (acts as connection test)
    this.logger.info("🔍 Testing new cache provider...");
    let newProvider: CacheProvider;
    try {
      newProvider = newPlugin.createProvider(config, this.logger);
      // Quick smoke test
      await newProvider.set("__test__", true, 1000);
      await newProvider.delete("__test__");
      this.logger.info("✅ Cache provider test successful");
    } catch (error) {
      const message = extractErrorMessage(error);
      this.logger.error(`❌ Cache provider test failed: ${message}`);
      throw new Error(`Failed to create cache provider: ${message}`);
    }

    // 4. Stop old provider if it has a stop method
    const oldProvider = this.activeProvider;
    if ("stop" in oldProvider && typeof oldProvider.stop === "function") {
      await (oldProvider as { stop: () => Promise<void> }).stop();
    }

    // 5. Switch to new provider
    const oldPluginId = this.activePluginId;
    this.activePluginId = pluginId;
    this.activeConfig = config;
    this.configVersion++;
    this.activeProvider = newProvider;

    // 6. Persist configuration
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
