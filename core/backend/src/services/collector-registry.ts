import type { PluginMetadata } from "@checkstack/common";
import type {
  CollectorStrategy,
  TransportClient,
  RegisteredCollector,
} from "@checkstack/backend-api";
import { rootLogger } from "../logger";

/**
 * Core implementation of the CollectorRegistry storage.
 * This is the global singleton that stores all collectors.
 */
export class CoreCollectorRegistry {
  private collectors = new Map<string, RegisteredCollector>();

  registerWithOwner(
    collector: CollectorStrategy<TransportClient<unknown, unknown>>,
    ownerPlugin: PluginMetadata
  ): void {
    if (this.collectors.has(collector.id)) {
      rootLogger.warn(
        `CollectorStrategy '${collector.id}' is already registered. Overwriting.`
      );
    }
    this.collectors.set(collector.id, { collector, ownerPlugin });
    rootLogger.debug(
      `✅ Registered CollectorStrategy: ${ownerPlugin.pluginId}.${collector.id}`
    );
  }

  /**
   * Unregister all collectors owned by a specific plugin.
   * Called when the collector-providing plugin is unloaded.
   */
  unregisterByOwner(ownerPluginId: string): void {
    const toRemove: string[] = [];
    for (const [id, entry] of this.collectors) {
      if (entry.ownerPlugin.pluginId === ownerPluginId) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.collectors.delete(id);
      rootLogger.debug(
        `🗑️ Unregistered CollectorStrategy: ${id} (owner plugin unloaded)`
      );
    }
  }

  /**
   * Remove collectors that no longer have any supported strategies loaded.
   * Called when a healthcheck strategy plugin is unloaded.
   * @param loadedStrategyPluginIds - Set of plugin IDs that are still loaded
   */
  unregisterByMissingStrategies(loadedStrategyPluginIds: Set<string>): void {
    const toRemove: string[] = [];
    for (const [id, entry] of this.collectors) {
      // Check if ANY of the collector's supported plugins are still loaded
      const hasLoadedStrategy = entry.collector.supportedPlugins.some((p) =>
        loadedStrategyPluginIds.has(p.pluginId)
      );
      // If none of the supported plugins are loaded, mark for removal
      if (!hasLoadedStrategy) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.collectors.delete(id);
      rootLogger.debug(
        `🗑️ Unregistered CollectorStrategy: ${id} (no supported strategies loaded)`
      );
    }
  }

  getCollector(id: string): RegisteredCollector | undefined {
    return this.collectors.get(id);
  }

  getCollectorsForPlugin(
    pluginMetadata: PluginMetadata
  ): RegisteredCollector[] {
    return [...this.collectors.values()].filter((entry) =>
      entry.collector.supportedPlugins.some(
        (p) => p.pluginId === pluginMetadata.pluginId
      )
    );
  }

  getCollectors(): RegisteredCollector[] {
    return [...this.collectors.values()];
  }
}

/**
 * Creates a scoped CollectorRegistry that auto-injects owning plugin metadata.
 */
export function createScopedCollectorRegistry(
  globalRegistry: CoreCollectorRegistry,
  ownerPlugin: PluginMetadata
) {
  return {
    register(collector: CollectorStrategy<TransportClient<unknown, unknown>>) {
      globalRegistry.registerWithOwner(collector, ownerPlugin);
    },
    getCollector(id: string) {
      return globalRegistry.getCollector(id);
    },
    getCollectorsForPlugin(pluginMetadata: PluginMetadata) {
      return globalRegistry.getCollectorsForPlugin(pluginMetadata);
    },
    getCollectors() {
      return globalRegistry.getCollectors();
    },
  };
}
