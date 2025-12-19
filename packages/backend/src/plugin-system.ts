import { ServiceRef } from "@checkmate/core-api";

export type Deps = Record<string, ServiceRef<unknown>>;

// Helper to extract the T from ServiceRef<T>
export type ResolvedDeps<T extends Deps> = {
  [K in keyof T]: T[K]["T"];
};

export type PluginContext = {
  pluginId: string;
};

export type BackendPlugin = {
  pluginId: string;
  register: (env: {
    registerInit: <D extends Deps>(args: {
      deps: D;
      init: (deps: ResolvedDeps<D>) => Promise<void>;
    }) => void;
    registerService: <S>(ref: ServiceRef<S>, impl: S) => void;
  }) => void;
};

export function createBackendPlugin(config: BackendPlugin): BackendPlugin {
  return config;
}
