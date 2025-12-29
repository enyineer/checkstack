import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ServiceRef } from "./service-ref";
import { ExtensionPoint } from "./extension-point";
import type { Permission } from "@checkmate/common";

export type Deps = Record<string, ServiceRef<unknown>>;

// Helper to extract the T from ServiceRef<T>
export type ResolvedDeps<T extends Deps> = {
  [K in keyof T]: T[K]["T"];
};

export type PluginContext = {
  pluginId: string;
};

export type BackendPluginRegistry = {
  registerInit: <
    D extends Deps,
    S extends Record<string, unknown> | undefined = undefined
  >(args: {
    deps: D;
    schema?: S;
    init: (
      deps: ResolvedDeps<D> &
        (S extends undefined
          ? unknown
          : { database: NodePgDatabase<NonNullable<S>> })
    ) => Promise<void>;
  }) => void;
  registerService: <S>(ref: ServiceRef<S>, impl: S) => void;
  registerExtensionPoint: <T>(ref: ExtensionPoint<T>, impl: T) => void;
  getExtensionPoint: <T>(ref: ExtensionPoint<T>) => T;
  registerPermissions: (permissions: Permission[]) => void;
  registerRouter: (router: unknown) => void;
};

export type BackendPlugin = {
  pluginId: string;
  register: (env: BackendPluginRegistry) => void;
};

export function createBackendPlugin(config: BackendPlugin): BackendPlugin {
  return config;
}
