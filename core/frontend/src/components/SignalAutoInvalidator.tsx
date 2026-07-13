import { useEffect, useRef, useState } from "react";
import { pluginRegistry, useQueryClient } from "@checkstack/frontend-api";
import type { Signal } from "@checkstack/signal-common";
import { useSubscribeAllSignals } from "@checkstack/signal-frontend";
import {
  createInvalidationCoalescer,
  globalTimerScheduler,
  type InvalidationCoalescer,
} from "./invalidation-coalescer";
import {
  invalidationBucketKey,
  queryMatchesResource,
  resolveSignalResourceId,
  type InvalidationTarget,
} from "./signal-invalidation";

/**
 * Trailing debounce window for coalescing invalidations.
 *
 * During active health checking, many `healthcheck` signals arrive in a short
 * burst; without coalescing each one invalidates `[["healthcheck"]]` and every
 * catalog subscriber refetches `getBulkSystemHealthStatus`, with rapid
 * successive invalidations cancelling the in-flight fetch (503s) and refetching
 * again. 300ms collapses such a burst into a single trailing refetch while
 * staying well below human-perceptible latency, so an isolated lone signal
 * still refreshes the UI within a third of a second.
 */
const INVALIDATION_WINDOW_MS = 300;

/**
 * Subscribes to every incoming signal and invalidates the matching plugin's
 * react-query cache (`[[pluginId]]`).
 *
 * Two invalidation passes per signal:
 *   1. Always invalidate the OWNING plugin's queries (auto, no registration).
 *   2. Invalidate any other plugin that opted in via `foreignSignals` on its
 *      `FrontendPlugin` config.
 *
 * Scope of pass 1 depends on the signal's definition:
 *   - A signal with a `resourceKey` (registered via a plugin's `signals`) that
 *     yields an id => RESOURCE-SCOPED: only queries whose key contains that id,
 *     plus queries that opted into whole-plugin refresh with
 *     `meta: { signalScope: "plugin" }`, are invalidated. So a viewer on stream
 *     A's detail page is untouched when stream B ingests.
 *   - Any other signal => BLANKET: the whole `[[pluginId]]` cache, exactly as
 *     before. This is the default and preserves every existing signal's
 *     behavior with zero registration.
 *
 * Foreign (pass 2) invalidation is always blanket - a foreign subscriber opts
 * into a plugin's reactivity wholesale and its own queries are not keyed on the
 * originating plugin's resource ids.
 *
 * Both passes are routed through a per-bucket trailing-debounce coalescer keyed
 * on `pluginId` + `resourceId`, so a burst of signals for the SAME resource
 * triggers a single `invalidateQueries`, while distinct resources stay
 * independent (stream A's burst never collapses stream B's, nor degrades into a
 * blanket invalidation). Invalidation is idempotent, so this is
 * correctness-preserving - it only removes redundant, mutually-cancelling
 * in-flight refetches.
 *
 * Renders nothing. Mount once near the QueryClientProvider so its useQueryClient
 * call resolves to the same client used by the rest of the app.
 */
export function SignalAutoInvalidator(): React.ReactNode {
  const queryClient = useQueryClient();
  const foreignSubscriberPluginIds = useForeignSignalMap();
  const signalRegistry = useSignalRegistry();

  // The coalescer's `flush` closes over the latest queryClient via a ref, so a
  // single coalescer instance lives for the component's lifetime without ever
  // capturing a stale client.
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  const coalescerRef = useRef<InvalidationCoalescer<InvalidationTarget> | null>(
    null,
  );
  if (coalescerRef.current === null) {
    coalescerRef.current = createInvalidationCoalescer({
      windowMs: INVALIDATION_WINDOW_MS,
      scheduler: globalTimerScheduler,
      keyOf: invalidationBucketKey,
      flush: ({ job }) => {
        const { pluginId, resourceId } = job;
        if (resourceId === undefined) {
          queryClientRef.current.invalidateQueries({ queryKey: [[pluginId]] });
          return;
        }
        // Resource-scoped: restrict to the plugin's cache with the queryKey
        // filter (AND semantics), then keep only queries matching this resource
        // or the whole-plugin opt-in.
        queryClientRef.current.invalidateQueries({
          queryKey: [[pluginId]],
          predicate: (query) =>
            queryMatchesResource({
              query: { queryHash: query.queryHash, meta: query.meta },
              resourceId,
            }),
        });
      },
    });
  }

  useEffect(() => {
    return () => {
      coalescerRef.current?.dispose();
      coalescerRef.current = null;
    };
  }, []);

  useSubscribeAllSignals(({ signalId, pluginId, payload }) => {
    const coalescer = coalescerRef.current;
    if (!coalescer) return;

    // Owning plugin: resource-scoped when the signal declares a resourceKey and
    // it yields an id, else blanket.
    const resourceId = resolveSignalResourceId({
      signal: signalRegistry.get(signalId),
      payload,
    });
    coalescer.schedule({ job: { pluginId, resourceId } });

    // Foreign subscribers: always blanket (resourceId undefined).
    const subscriberPluginIds = foreignSubscriberPluginIds.get(signalId);
    if (subscriberPluginIds) {
      for (const subscriberPluginId of subscriberPluginIds) {
        coalescer.schedule({ job: { pluginId: subscriberPluginId } });
      }
    }
  });

  return null;
}

/**
 * Builds a `signalId → Signal` map from every registered plugin's `signals`
 * (and `foreignSignals`, which are Signal objects too), so the invalidator can
 * recover a received signal's `resourceKey` extractor from its id. Rebuilds
 * when plugins are dynamically loaded or unloaded.
 */
function useSignalRegistry(): Map<string, Signal<unknown>> {
  const [map, setMap] = useState<Map<string, Signal<unknown>>>(() =>
    buildSignalRegistry(),
  );

  useEffect(() => {
    return pluginRegistry.subscribe(() => {
      setMap(buildSignalRegistry());
    });
  }, []);

  return map;
}

function buildSignalRegistry(): Map<string, Signal<unknown>> {
  const map = new Map<string, Signal<unknown>>();
  for (const plugin of pluginRegistry.getPlugins()) {
    for (const signal of plugin.signals ?? []) {
      map.set(signal.id, signal);
    }
    for (const signal of plugin.foreignSignals ?? []) {
      // Only fill from a foreign declaration when the owning plugin did not
      // already register a (canonical) def - never overwrite it.
      if (!map.has(signal.id)) map.set(signal.id, signal);
    }
  }
  return map;
}

/**
 * Builds a `signalId → Set<pluginId>` map from the `foreignSignals`
 * declarations of all currently registered plugins. Rebuilds when plugins
 * are dynamically loaded or unloaded.
 */
function useForeignSignalMap(): Map<string, Set<string>> {
  const [map, setMap] = useState<Map<string, Set<string>>>(() =>
    buildForeignSignalMap(),
  );

  useEffect(() => {
    return pluginRegistry.subscribe(() => {
      setMap(buildForeignSignalMap());
    });
  }, []);

  return map;
}

function buildForeignSignalMap(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const plugin of pluginRegistry.getPlugins()) {
    if (!plugin.foreignSignals) continue;
    for (const signal of plugin.foreignSignals) {
      let subscribers = map.get(signal.id);
      if (!subscribers) {
        subscribers = new Set();
        map.set(signal.id, subscribers);
      }
      subscribers.add(plugin.metadata.pluginId);
    }
  }
  return map;
}
