import type {
  HealthCheckStrategy,
  HealthCheckRegistry,
  CollectorRegistry,
  RegisteredCollector,
  CollectorStrategy,
  TransportClient,
  BackendPluginRegistry,
} from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isSatelliteLoadedPluginDir } from "./plugin-discovery";

/**
 * Simple in-memory HealthCheckRegistry for the satellite.
 * Captures strategy registrations from plugins without needing the full backend.
 */
class SatelliteHealthCheckRegistry implements HealthCheckRegistry {
  private strategies = new Map<string, HealthCheckStrategy>();
  private pluginId = "";

  setPluginId(id: string) {
    this.pluginId = id;
  }

  register<S extends HealthCheckStrategy>(strategy: S): void {
    const qualifiedId = `${this.pluginId}.${strategy.id}`;
    this.strategies.set(qualifiedId, strategy);
  }

  getStrategy(id: string): HealthCheckStrategy | undefined {
    return this.strategies.get(id);
  }

  getStrategies(): HealthCheckStrategy[] {
    return [...this.strategies.values()];
  }

  getStrategiesWithMeta() {
    return [...this.strategies.entries()].map(([qualifiedId, strategy]) => ({
      qualifiedId,
      strategy,
      ownerPluginId: qualifiedId.split(".")[0] ?? qualifiedId,
    }));
  }
}

/**
 * Simple in-memory CollectorRegistry for the satellite.
 */
class SatelliteCollectorRegistry implements CollectorRegistry {
  private collectors = new Map<string, RegisteredCollector>();
  private pluginMeta: PluginMetadata = { pluginId: "" };

  setPlugin(meta: PluginMetadata) {
    this.pluginMeta = meta;
  }

  register(
    collector: CollectorStrategy<TransportClient<unknown, unknown>>,
  ): void {
    const qualifiedId = `${this.pluginMeta.pluginId}.${collector.id}`;
    this.collectors.set(qualifiedId, {
      qualifiedId,
      collector,
      ownerPlugin: this.pluginMeta,
    });
  }

  getCollector(id: string): RegisteredCollector | undefined {
    return this.collectors.get(id);
  }

  getCollectorsForPlugin(meta: PluginMetadata): RegisteredCollector[] {
    return [...this.collectors.values()].filter(
      (c) => c.ownerPlugin.pluginId === meta.pluginId,
    );
  }

  getCollectors(): RegisteredCollector[] {
    return [...this.collectors.values()];
  }
}

/**
 * Discovers and loads all healthcheck strategy plugins from the plugins directory.
 * Returns in-memory registries populated with the strategies and collectors.
 */
export async function loadStrategies(opts: {
  logger: { info: (msg: string) => void; debug: (msg: string) => void; warn: (msg: string) => void };
}): Promise<{
  healthCheckRegistry: SatelliteHealthCheckRegistry;
  collectorRegistry: SatelliteCollectorRegistry;
}> {
  const { logger } = opts;
  const healthCheckRegistry = new SatelliteHealthCheckRegistry();
  const collectorRegistry = new SatelliteCollectorRegistry();

  // Discover plugins by scanning for healthcheck-*-backend directories
  // In Docker, plugins are at /app/plugins/; locally, relative to this file
  const pluginsDir = path.resolve(import.meta.dir, "../../../plugins");
  let entries: string[];
  try {
    entries = await readdir(pluginsDir);
  } catch {
    // Try Docker path
    try {
      const dockerPluginsDir = "/app/plugins";
      entries = await readdir(dockerPluginsDir);
      return loadPluginsFromDir({
        pluginsDir: dockerPluginsDir,
        entries,
        healthCheckRegistry,
        collectorRegistry,
        logger,
      });
    } catch {
      logger.warn("No plugins directory found, no strategies loaded");
      return { healthCheckRegistry, collectorRegistry };
    }
  }

  return loadPluginsFromDir({
    pluginsDir,
    entries,
    healthCheckRegistry,
    collectorRegistry,
    logger,
  });
}

async function loadPluginsFromDir(opts: {
  pluginsDir: string;
  entries: string[];
  healthCheckRegistry: SatelliteHealthCheckRegistry;
  collectorRegistry: SatelliteCollectorRegistry;
  logger: { info: (msg: string) => void; debug: (msg: string) => void; warn: (msg: string) => void };
}): Promise<{
  healthCheckRegistry: SatelliteHealthCheckRegistry;
  collectorRegistry: SatelliteCollectorRegistry;
}> {
  const { pluginsDir, entries, healthCheckRegistry, collectorRegistry, logger } = opts;

  // Include both healthcheck strategy plugins and standalone collector plugins.
  // The predicate is shared with the image prune so the two never disagree.
  const pluginDirs = entries.filter((e) => isSatelliteLoadedPluginDir(e));

  logger.info(`Discovered ${pluginDirs.length} strategy plugins`);

  for (const dir of pluginDirs) {
    try {
      const pluginPath = path.join(pluginsDir, dir, "src", "index.ts");
      const mod = await import(pluginPath);
      const plugin = mod.default;

      if (!plugin?.metadata?.pluginId || !plugin?.register) {
        logger.warn(`Plugin ${dir} has no valid default export, skipping`);
        continue;
      }

      const pluginId = plugin.metadata.pluginId as string;



      // Create a mock env that captures registrations
      healthCheckRegistry.setPluginId(pluginId);
      collectorRegistry.setPlugin(plugin.metadata as PluginMetadata);

      const mockEnv: Partial<BackendPluginRegistry> = {
        registerInit: ({ init }) => {
          // We'll call init synchronously after register
          // Store it for deferred execution
          (mockEnv as Record<string, unknown>)._init = init;
        },
        registerAccessRules: () => {
          // No-op in satellite
        },
      };

      plugin.register(mockEnv);

      // Call the stored init function with our registries
      const storedInit = (mockEnv as Record<string, unknown>)._init as (
        deps: Record<string, unknown>,
      ) => Promise<void>;

      if (storedInit) {
        await storedInit({
          healthCheckRegistry,
          collectorRegistry,
          logger: {
            debug: (msg: string) => logger.debug(`[${pluginId}] ${msg}`),
            info: (msg: string) => logger.info(`[${pluginId}] ${msg}`),
            warn: (msg: string) => logger.warn(`[${pluginId}] ${msg}`),
            error: (msg: string) => logger.warn(`[${pluginId}] ${msg}`),
          },
        });
      }

      logger.info(`✓ Loaded strategy plugin: ${pluginId}`);
    } catch (error) {
      logger.warn(`Failed to load plugin ${dir}: ${String(error)}`);
    }
  }

  logger.info(
    `Loaded ${healthCheckRegistry.getStrategies().length} strategies, ` +
    `${collectorRegistry.getCollectors().length} collectors`,
  );

  return { healthCheckRegistry, collectorRegistry };
}
