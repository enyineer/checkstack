import type { PluginMetadata } from "@checkstack/common";
import type { CollectorStrategy } from "./collector-strategy";
import type { TransportClient } from "./transport-client";

/**
 * A registered collector with its owning plugin metadata.
 */
export interface RegisteredCollector {
  /** The collector strategy */
  collector: CollectorStrategy<TransportClient<unknown, unknown>>;
  /** The plugin that registered this collector */
  ownerPlugin: PluginMetadata;
}

/**
 * Scoped collector registry interface.
 * The owning plugin metadata is automatically injected via factory.
 */
export interface CollectorRegistry {
  /**
   * Register a collector strategy.
   * The owning plugin metadata is automatically captured from the scoped context.
   */
  register(
    collector: CollectorStrategy<TransportClient<unknown, unknown>>
  ): void;

  /**
   * Get a collector by ID.
   */
  getCollector(id: string): RegisteredCollector | undefined;

  /**
   * Get all collectors that support a specific transport plugin.
   */
  getCollectorsForPlugin(pluginMetadata: PluginMetadata): RegisteredCollector[];

  /**
   * Get all registered collectors.
   */
  getCollectors(): RegisteredCollector[];
}
