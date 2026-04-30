import type { ServiceRef, Logger } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import { coreServices } from "@checkstack/backend-api";

/**
 * Topologically sorts plugins based on their dependencies.
 * Pure function - no class dependencies.
 */
export function sortPlugins({
  pendingInits,
  providedBy,
  logger,
}: {
  pendingInits: {
    metadata: PluginMetadata;
    deps: Record<string, ServiceRef<unknown>>;
    /**
     * Optional plugin-id-level dependencies. Each id adds an edge
     * `dep -> consumer`, ensuring the consumer's init and
     * afterPluginsReady run after the dep's. Used by the notification
     * subscription pattern: emitter plugins automatically depend on
     * the plugins that own the targets they emit subscriptions for,
     * derived at register time from `spec.target.ownerPlugin`.
     */
    pluginDependencies?: Set<string>;
  }[];
  providedBy: Map<string, string>;
  logger: Logger;
}): string[] {
  logger.debug("🔄 Calculating initialization order...");

  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  for (const p of pendingInits) {
    inDegree.set(p.metadata.pluginId, 0);
    graph.set(p.metadata.pluginId, []);
  }

  // Track queue plugin providers (plugins that depend on queuePluginRegistry)
  const queuePluginProviders = new Set<string>();
  // Track cache plugin providers (plugins that depend on cachePluginRegistry)
  const cachePluginProviders = new Set<string>();
  for (const p of pendingInits) {
    for (const [, ref] of Object.entries(p.deps)) {
      if (ref.id === coreServices.queuePluginRegistry.id) {
        queuePluginProviders.add(p.metadata.pluginId);
      }
      if (ref.id === coreServices.cachePluginRegistry.id) {
        cachePluginProviders.add(p.metadata.pluginId);
      }
    }
  }

  // Build dependency graph
  for (const p of pendingInits) {
    const consumerId = p.metadata.pluginId;
    for (const [, ref] of Object.entries(p.deps)) {
      const serviceId = ref.id;
      const providerId = providedBy.get(serviceId);

      if (providerId && providerId !== consumerId) {
        if (!graph.has(providerId)) {
          graph.set(providerId, []);
        }
        graph.get(providerId)!.push(consumerId);
        inDegree.set(consumerId, (inDegree.get(consumerId) || 0) + 1);
      }
    }

    // Plugin-id-level deps (currently sourced from declared
    // notification subscription specs). Each entry forces the consumer
    // to load after the named plugin even when there's no shared
    // ServiceRef between them.
    if (p.pluginDependencies) {
      for (const depPluginId of p.pluginDependencies) {
        if (depPluginId === consumerId) continue;
        if (!graph.has(depPluginId)) {
          // Dep plugin isn't loaded — skip silently. The runtime RPC
          // layer (notification-backend) will produce a clearer error
          // if the dep was actually required.
          continue;
        }
        if (!graph.get(depPluginId)!.includes(consumerId)) {
          graph.get(depPluginId)!.push(consumerId);
          inDegree.set(consumerId, (inDegree.get(consumerId) || 0) + 1);
        }
      }
    }

    // Special handling: if this plugin uses queueManager, it must wait for all queue plugin providers
    const usesQueueManager = Object.values(p.deps).some(
      (ref) => ref.id === coreServices.queueManager.id
    );
    if (usesQueueManager) {
      for (const qpp of queuePluginProviders) {
        if (qpp !== consumerId) {
          if (!graph.has(qpp)) {
            graph.set(qpp, []);
          }
          // Add edge: queue plugin provider -> queue consumer
          if (!graph.get(qpp)!.includes(consumerId)) {
            graph.get(qpp)!.push(consumerId);
            inDegree.set(consumerId, (inDegree.get(consumerId) || 0) + 1);
          }
        }
      }
    }

    // Special handling: if this plugin uses cacheManager, it must wait for all cache plugin providers
    const usesCacheManager = Object.values(p.deps).some(
      (ref) => ref.id === coreServices.cacheManager.id
    );
    if (usesCacheManager) {
      for (const cpp of cachePluginProviders) {
        if (cpp !== consumerId) {
          if (!graph.has(cpp)) {
            graph.set(cpp, []);
          }
          // Add edge: cache plugin provider -> cache consumer
          if (!graph.get(cpp)!.includes(consumerId)) {
            graph.get(cpp)!.push(consumerId);
            inDegree.set(consumerId, (inDegree.get(consumerId) || 0) + 1);
          }
        }
      }
    }
  }

  const queue: string[] = [];
  for (const [id, count] of inDegree.entries()) {
    if (count === 0) {
      queue.push(id);
    }
  }

  const sortedIds: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    sortedIds.push(u);

    const dependents = graph.get(u) || [];
    for (const v of dependents) {
      inDegree.set(v, inDegree.get(v)! - 1);
      if (inDegree.get(v) === 0) {
        queue.push(v);
      }
    }
  }

  if (sortedIds.length !== pendingInits.length) {
    throw new Error("Circular dependency detected");
  }

  return sortedIds;
}
