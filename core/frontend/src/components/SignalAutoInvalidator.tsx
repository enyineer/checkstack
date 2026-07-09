import { useEffect, useRef, useState } from "react";
import { pluginRegistry, useQueryClient } from "@checkstack/frontend-api";
import { useSubscribeAllSignals } from "@checkstack/signal-frontend";
import {
  createInvalidationCoalescer,
  globalTimerScheduler,
  type InvalidationCoalescer,
} from "./invalidation-coalescer";

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
 * Both passes are routed through a per-target trailing-debounce coalescer, so a
 * burst of signals for the same plugin triggers a single `invalidateQueries`
 * instead of one refetch per signal. Invalidation is idempotent, so this is
 * correctness-preserving — it only removes redundant, mutually-cancelling
 * in-flight refetches.
 *
 * Renders nothing. Mount once near the QueryClientProvider so its useQueryClient
 * call resolves to the same client used by the rest of the app.
 */
export function SignalAutoInvalidator(): React.ReactNode {
  const queryClient = useQueryClient();
  const foreignSubscriberPluginIds = useForeignSignalMap();

  // The coalescer's `flush` closes over the latest queryClient via a ref, so a
  // single coalescer instance lives for the component's lifetime without ever
  // capturing a stale client.
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  const coalescerRef = useRef<InvalidationCoalescer | null>(null);
  if (coalescerRef.current === null) {
    coalescerRef.current = createInvalidationCoalescer({
      windowMs: INVALIDATION_WINDOW_MS,
      scheduler: globalTimerScheduler,
      flush: ({ target }) => {
        queryClientRef.current.invalidateQueries({ queryKey: [[target]] });
      },
    });
  }

  useEffect(() => {
    return () => {
      coalescerRef.current?.dispose();
      coalescerRef.current = null;
    };
  }, []);

  useSubscribeAllSignals(({ signalId, pluginId }) => {
    const coalescer = coalescerRef.current;
    if (!coalescer) return;

    coalescer.schedule({ target: pluginId });

    const subscriberPluginIds = foreignSubscriberPluginIds.get(signalId);
    if (subscriberPluginIds) {
      for (const subscriberPluginId of subscriberPluginIds) {
        coalescer.schedule({ target: subscriberPluginId });
      }
    }
  });

  return null;
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
