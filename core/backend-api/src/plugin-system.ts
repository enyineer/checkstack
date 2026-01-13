import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ServiceRef } from "./service-ref";
import { ExtensionPoint } from "./extension-point";
import type { AccessRule, PluginMetadata } from "@checkstack/common";
import type { Hook, HookSubscribeOptions, HookUnsubscribe } from "./hooks";
import { Router } from "@orpc/server";
import { RpcContext } from "./rpc";
import { AnyContractRouter } from "@orpc/contract";

export type Deps = Record<string, ServiceRef<unknown>>;

// Helper to extract the T from ServiceRef<T>
export type ResolvedDeps<T extends Deps> = {
  [K in keyof T]: T[K]["T"];
};

/**
 * Helper type for database dependency injection.
 * If schema S is provided, adds typed database; otherwise adds nothing.
 */
export type DatabaseDeps<S extends Record<string, unknown> | undefined> =
  S extends undefined ? unknown : { database: NodePgDatabase<NonNullable<S>> };

export type PluginContext = {
  pluginId: string;
};

/**
 * Context available during the afterPluginsReady phase.
 * Contains hook operations that are only safe after all plugins are initialized.
 */
export type AfterPluginsReadyContext = {
  /**
   * Subscribe to a hook. Only available in afterPluginsReady phase.
   * @returns Unsubscribe function
   */
  onHook: <T>(
    hook: Hook<T>,
    listener: (payload: T) => Promise<void>,
    options?: HookSubscribeOptions
  ) => HookUnsubscribe;
  /**
   * Emit a hook event. Only available in afterPluginsReady phase.
   */
  emitHook: <T>(hook: Hook<T>, payload: T) => Promise<void>;
};

export type BackendPluginRegistry = {
  registerInit: <
    D extends Deps,
    S extends Record<string, unknown> | undefined = undefined
  >(args: {
    deps: D;
    schema?: S;
    /**
     * Phase 2: Initialize the plugin.
     * Use this to register routers, services, and set up internal state.
     * DO NOT make RPC calls to other plugins here - use afterPluginsReady instead.
     */
    init: (deps: ResolvedDeps<D> & DatabaseDeps<S>) => Promise<void>;
    /**
     * Phase 3: Called after ALL plugins have initialized.
     * Safe to make RPC calls to other plugins and subscribe to hooks.
     * Receives the same deps as init, plus onHook and emitHook.
     */
    afterPluginsReady?: (
      deps: ResolvedDeps<D> & DatabaseDeps<S> & AfterPluginsReadyContext
    ) => Promise<void>;
  }) => void;
  registerService: <S>(ref: ServiceRef<S>, impl: S) => void;
  registerExtensionPoint: <T>(ref: ExtensionPoint<T>, impl: T) => void;
  getExtensionPoint: <T>(ref: ExtensionPoint<T>) => T;
  /**
   * Register access rules for this plugin.
   */
  registerAccessRules: (accessRules: AccessRule[]) => void;
  /**
   * Registers an oRPC router and its contract for this plugin.
   * The contract is used for OpenAPI generation.
   */
  registerRouter: <C extends AnyContractRouter>(
    router: Router<C, RpcContext>,
    contract: C
  ) => void;
  /**
   * Register cleanup logic to be called when the plugin is deregistered.
   * Multiple cleanup handlers can be registered; they run in LIFO order.
   */
  registerCleanup: (cleanup: () => Promise<void>) => void;
  pluginManager: {
    getAllAccessRules: () => { id: string; description?: string }[];
  };
};

export type BackendPlugin = {
  /**
   * Plugin metadata containing the pluginId.
   * This should be imported from the plugin's common package.
   */
  metadata: PluginMetadata;
  register: (env: BackendPluginRegistry) => void;
};

export function createBackendPlugin(config: BackendPlugin): BackendPlugin {
  return config;
}
