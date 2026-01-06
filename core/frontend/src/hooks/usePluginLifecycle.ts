import { useEffect, useReducer } from "react";
import { useSignal } from "@checkmate-monitor/signal-frontend";
import {
  PLUGIN_INSTALLED,
  PLUGIN_DEREGISTERED,
} from "@checkmate-monitor/signal-common";
import { pluginRegistry } from "@checkmate-monitor/frontend-api";
import { loadSinglePlugin, unloadPlugin } from "../plugin-loader";

/**
 * Hook that listens to plugin lifecycle signals and dynamically loads/unloads plugins.
 * Must be used within SignalProvider context.
 *
 * Returns the current registry version to trigger re-renders when plugins change.
 */
export function usePluginLifecycle(): { version: number } {
  // Force re-render when registry changes
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Subscribe to registry changes
  useEffect(() => {
    return pluginRegistry.subscribe(forceUpdate);
  }, []);

  // Listen for plugin installation signal
  useSignal(PLUGIN_INSTALLED, async ({ pluginId }) => {
    console.log(`📥 Received PLUGIN_INSTALLED signal for: ${pluginId}`);

    // Only load if not already registered
    if (!pluginRegistry.hasPlugin(pluginId)) {
      try {
        await loadSinglePlugin(pluginId);
      } catch (error) {
        console.error(`❌ Failed to load plugin ${pluginId}:`, error);
      }
    }
  });

  // Listen for plugin deregistration signal
  useSignal(PLUGIN_DEREGISTERED, ({ pluginId }) => {
    console.log(`📥 Received PLUGIN_DEREGISTERED signal for: ${pluginId}`);
    unloadPlugin(pluginId);
  });

  return { version: pluginRegistry.getVersion() };
}
