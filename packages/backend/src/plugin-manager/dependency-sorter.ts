import type { ServiceRef, Logger } from "@checkmate/backend-api";

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
    pluginId: string;
    deps: Record<string, ServiceRef<unknown>>;
  }[];
  providedBy: Map<string, string>;
  logger: Logger;
}): string[] {
  logger.debug("🔄 Calculating initialization order...");

  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  for (const p of pendingInits) {
    inDegree.set(p.pluginId, 0);
    graph.set(p.pluginId, []);
  }

  // Track queue plugin providers (plugins that depend on queuePluginRegistry)
  const queuePluginProviders = new Set<string>();
  for (const p of pendingInits) {
    for (const [, ref] of Object.entries(p.deps)) {
      if (ref.id === "core.queue-plugin-registry") {
        queuePluginProviders.add(p.pluginId);
      }
    }
  }

  // Build dependency graph
  for (const p of pendingInits) {
    const consumerId = p.pluginId;
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

    // Special handling: if this plugin uses queueFactory, it must wait for all queue plugin providers
    const usesQueueFactory = Object.values(p.deps).some(
      (ref) => ref.id === "core.queue-factory"
    );
    if (usesQueueFactory) {
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
