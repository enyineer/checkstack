import { useEffect, useState } from "react";
import { pluginRegistry, useQueryClient } from "@checkstack/frontend-api";
import { useSubscribeAllSignals } from "@checkstack/signal-frontend";

/**
 * Subscribes to every incoming signal and invalidates the matching plugin's
 * react-query cache (`[[pluginId]]`).
 *
 * Two invalidation passes per signal:
 *   1. Always invalidate the OWNING plugin's queries (auto, no registration).
 *   2. Invalidate any other plugin that opted in via `foreignSignals` on its
 *      `FrontendPlugin` config.
 *
 * Renders nothing. Mount once near the QueryClientProvider so its useQueryClient
 * call resolves to the same client used by the rest of the app.
 */
export function SignalAutoInvalidator(): React.ReactNode {
  const queryClient = useQueryClient();
  const foreignSubscriberPluginIds = useForeignSignalMap();

  useSubscribeAllSignals(({ signalId, pluginId }) => {
    queryClient.invalidateQueries({ queryKey: [[pluginId]] });

    const subscriberPluginIds = foreignSubscriberPluginIds.get(signalId);
    if (subscriberPluginIds) {
      for (const subscriberPluginId of subscriberPluginIds) {
        queryClient.invalidateQueries({ queryKey: [[subscriberPluginId]] });
      }
    }
  });

  // eslint-disable-next-line unicorn/no-null
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
