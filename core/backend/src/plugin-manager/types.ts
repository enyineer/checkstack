import type { ServiceRef } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";

/** Erased callback type used in PendingInit storage */
export type InitCallback = (deps: Record<string, unknown>) => Promise<void>;

export interface PendingInit {
  metadata: PluginMetadata;
  pluginPath: string;
  deps: Record<string, ServiceRef<unknown>>;
  init: InitCallback;
  afterPluginsReady?: InitCallback;
  schema?: Record<string, unknown>;
  /**
   * Plugin ids this plugin must load *after*. Derived (not authored) —
   * computed at register time from the owners of any notification
   * subscription specs the plugin declared via
   * `registerSubscriptionSpecs`. Each declared spec contributes its
   * target's `ownerPlugin` to this set, so emitter plugins
   * automatically wait for the target owner without anyone
   * maintaining a manual dependency list.
   */
  pluginDependencies: Set<string>;
}
