import type { PluginMetadata } from "@checkstack/common";
import {
  HealthCheckRegistry,
  HealthCheckStrategy,
} from "@checkstack/backend-api";
import { rootLogger } from "../logger";

/**
 * Registered strategy with its fully qualified ID and owner info.
 */
interface RegisteredStrategy {
  strategy: HealthCheckStrategy;
  ownerPlugin: PluginMetadata;
  qualifiedId: string;
}

/**
 * Core implementation of the HealthCheckRegistry storage.
 * This is the global singleton that stores all strategies with fully qualified IDs.
 */
export class CoreHealthCheckRegistry {
  private strategies = new Map<string, RegisteredStrategy>();

  /**
   * Register a strategy with its owning plugin.
   * The strategy ID is stored as: ownerPluginId.strategyId
   */
  registerWithOwner(
    strategy: HealthCheckStrategy,
    ownerPlugin: PluginMetadata
  ): void {
    const qualifiedId = `${ownerPlugin.pluginId}.${strategy.id}`;
    if (this.strategies.has(qualifiedId)) {
      rootLogger.warn(
        `HealthCheckStrategy '${qualifiedId}' is already registered. Overwriting.`
      );
    }
    this.strategies.set(qualifiedId, { strategy, ownerPlugin, qualifiedId });
    rootLogger.debug(`✅ Registered HealthCheckStrategy: ${qualifiedId}`);
  }

  getStrategy(qualifiedId: string) {
    return this.strategies.get(qualifiedId)?.strategy;
  }

  getStrategies() {
    return [...this.strategies.values()].map((r) => r.strategy);
  }

  /**
   * Get the owner plugin ID for a strategy.
   */
  getOwnerPluginId(qualifiedId: string): string | undefined {
    return this.strategies.get(qualifiedId)?.ownerPlugin.pluginId;
  }

  /**
   * Get all registered strategies with their metadata.
   */
  getStrategiesWithMeta(): Array<{
    strategy: HealthCheckStrategy;
    ownerPluginId: string;
    qualifiedId: string;
  }> {
    return [...this.strategies.values()].map((r) => ({
      strategy: r.strategy,
      ownerPluginId: r.ownerPlugin.pluginId,
      qualifiedId: r.qualifiedId,
    }));
  }
}

/**
 * Creates a scoped HealthCheckRegistry that auto-prefixes strategy IDs with plugin ID.
 */
export function createScopedHealthCheckRegistry(
  globalRegistry: CoreHealthCheckRegistry,
  ownerPlugin: PluginMetadata
): HealthCheckRegistry {
  return {
    register(strategy: HealthCheckStrategy) {
      globalRegistry.registerWithOwner(strategy, ownerPlugin);
    },
    getStrategy(id: string) {
      // Support both qualified and unqualified lookups
      return (
        globalRegistry.getStrategy(id) ||
        globalRegistry.getStrategy(`${ownerPlugin.pluginId}.${id}`)
      );
    },
    getStrategies() {
      return globalRegistry.getStrategies();
    },
    getStrategiesWithMeta() {
      return globalRegistry.getStrategiesWithMeta();
    },
  };
}
