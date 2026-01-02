import type { ServiceRef } from "@checkmate/backend-api";
import type { PluginMetadata } from "@checkmate/common";

/** Erased callback type used in PendingInit storage */
export type InitCallback = (deps: Record<string, unknown>) => Promise<void>;

export interface PendingInit {
  metadata: PluginMetadata;
  pluginPath: string;
  deps: Record<string, ServiceRef<unknown>>;
  init: InitCallback;
  afterPluginsReady?: InitCallback;
  schema?: Record<string, unknown>;
}
