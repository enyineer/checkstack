import type { Hono } from "hono";
import { adminPool, db } from "./db";
import { ServiceRegistry } from "./services/service-registry";
import {
  BackendPlugin,
  ServiceRef,
  ExtensionPoint,
  coreServices,
  coreHooks,
  HookUnsubscribe,
} from "@checkmate-monitor/backend-api";
import type { AnyContractRouter } from "@orpc/contract";
import type { Permission, PluginMetadata } from "@checkmate-monitor/common";

// Extracted modules
import { registerCoreServices } from "./plugin-manager/core-services";
import { createExtensionPointManager } from "./plugin-manager/extension-points";
import { loadPlugins as loadPluginsImpl } from "./plugin-manager/plugin-loader";
import { rootLogger } from "./logger";

export interface DeregisterOptions {
  deleteSchema: boolean;
}

export class PluginManager {
  private registry = new ServiceRegistry();
  private pluginRpcRouters = new Map<string, unknown>();
  private pluginHttpHandlers = new Map<
    string,
    (req: Request) => Promise<Response>
  >();
  private extensionPointManager = createExtensionPointManager();

  // Permission registry - stores all registered permissions with pluginId for hook emission
  private registeredPermissions: (Permission & { pluginId: string })[] = [];

  // Plugin metadata registry - stores PluginMetadata for request-time context injection
  private pluginMetadataRegistry = new Map<string, PluginMetadata>();

  // Cleanup handlers registered by plugins (LIFO execution)
  private cleanupHandlers = new Map<string, Array<() => Promise<void>>>();

  // Contract registry - stores plugin contracts for OpenAPI generation
  private pluginContractRegistry = new Map<string, AnyContractRouter>();

  // Hook subscriptions per plugin (for bulk unsubscribe)
  private hookSubscriptions = new Map<string, HookUnsubscribe[]>();

  constructor() {
    registerCoreServices({
      registry: this.registry,
      adminPool,
      pluginRpcRouters: this.pluginRpcRouters,
      pluginHttpHandlers: this.pluginHttpHandlers,
      pluginContractRegistry: this.pluginContractRegistry,
    });
  }

  registerExtensionPoint<T>(ref: ExtensionPoint<T>, impl: T) {
    this.extensionPointManager.registerExtensionPoint(ref, impl);
  }

  getExtensionPoint<T>(ref: ExtensionPoint<T>): T {
    return this.extensionPointManager.getExtensionPoint(ref);
  }

  /**
   * Register a core router (not from a plugin, but from core backend).
   * Used for admin endpoints like plugin installation/deregistration.
   */
  registerCoreRouter(routerId: string, router: unknown): void {
    this.pluginRpcRouters.set(routerId, router);
  }

  getAllPermissions(): Permission[] {
    return this.registeredPermissions.map(
      ({ id, description, isAuthenticatedDefault, isPublicDefault }) => ({
        id,
        description,
        isAuthenticatedDefault,
        isPublicDefault,
      })
    );
  }

  /**
   * Get all registered contracts for OpenAPI generation.
   * Returns a map of pluginId -> contract.
   */
  getAllContracts(): Map<string, AnyContractRouter> {
    return new Map(this.pluginContractRegistry);
  }

  async loadPlugins(rootRouter: Hono, manualPlugins: BackendPlugin[] = []) {
    await loadPluginsImpl({
      rootRouter,
      manualPlugins,
      deps: {
        registry: this.registry,
        pluginRpcRouters: this.pluginRpcRouters,
        pluginHttpHandlers: this.pluginHttpHandlers,
        extensionPointManager: this.extensionPointManager,
        registeredPermissions: this.registeredPermissions,
        getAllPermissions: () => this.getAllPermissions(),
        db,
        pluginMetadataRegistry: this.pluginMetadataRegistry,
        cleanupHandlers: this.cleanupHandlers,
        pluginContractRegistry: this.pluginContractRegistry,
      },
    });
  }

  /**
   * Deregister a plugin at runtime.
   * Only works for plugins with isUninstallable: true.
   */
  async deregisterPlugin(
    pluginId: string,
    options: DeregisterOptions
  ): Promise<void> {
    rootLogger.info(`🔄 Deregistering plugin: ${pluginId}...`);

    // 1. Emit pluginDeregistering hook locally (instance-local, not distributed)
    // This lets other plugins on THIS instance cleanup dependencies
    const eventBus = await this.registry.get(coreServices.eventBus, {
      pluginId: "core",
    });
    await eventBus.emitLocal(coreHooks.pluginDeregistering, {
      pluginId,
      reason: "uninstall" as const,
    });

    // 2. Run cleanup handlers (LIFO order)
    const handlers = this.cleanupHandlers.get(pluginId) || [];
    for (const handler of handlers.toReversed()) {
      try {
        await handler();
      } catch (error) {
        rootLogger.error(`Cleanup handler failed for ${pluginId}:`, error);
      }
    }
    this.cleanupHandlers.delete(pluginId);

    // 3. Unsubscribe from all EventBus hooks
    const subscriptions = this.hookSubscriptions.get(pluginId) || [];
    for (const unsubscribe of subscriptions) {
      try {
        await unsubscribe();
      } catch (error) {
        rootLogger.error(`Failed to unsubscribe hook for ${pluginId}:`, error);
      }
    }
    this.hookSubscriptions.delete(pluginId);

    // 4. Remove from router maps and contract registry
    this.pluginRpcRouters.delete(pluginId);
    this.pluginHttpHandlers.delete(pluginId);
    this.pluginContractRegistry.delete(pluginId);
    rootLogger.debug(`   -> Removed routers and contracts for ${pluginId}`);

    // 5. Remove permissions from registry
    const beforeCount = this.registeredPermissions.length;
    this.registeredPermissions = this.registeredPermissions.filter(
      (p) => p.pluginId !== pluginId
    );
    rootLogger.debug(
      `   -> Removed ${
        beforeCount - this.registeredPermissions.length
      } permissions`
    );

    // 6. Drop schema if requested
    if (options.deleteSchema) {
      try {
        const schemaName = `plugin_${pluginId}`;
        await db.execute(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        rootLogger.info(`   -> Dropped schema: ${schemaName}`);
      } catch (error) {
        rootLogger.error(`Failed to drop schema for ${pluginId}:`, error);
      }
    }

    // 7. Emit pluginDeregistered hook (for permission cleanup in auth-backend)
    await eventBus.emit(coreHooks.pluginDeregistered, { pluginId });

    rootLogger.info(`✅ Plugin deregistered: ${pluginId}`);
  }

  /**
   * Track a hook subscription for a plugin (for bulk unsubscribe during deregistration)
   */
  trackHookSubscription(pluginId: string, unsubscribe: HookUnsubscribe): void {
    const existing = this.hookSubscriptions.get(pluginId) || [];
    existing.push(unsubscribe);
    this.hookSubscriptions.set(pluginId, existing);
  }

  /**
   * Request deregistration of a plugin across all instances.
   * This emits a broadcast hook that all instances (including this one) will receive.
   * Each instance then performs local cleanup via deregisterPlugin().
   */
  async requestDeregistration(
    pluginId: string,
    options: DeregisterOptions
  ): Promise<void> {
    rootLogger.info(`📢 Broadcasting deregistration request for: ${pluginId}`);

    // Emit broadcast hook - all instances receive and perform local cleanup
    const eventBus = await this.registry.get(coreServices.eventBus, {
      pluginId: "core",
    });
    await eventBus.emit(coreHooks.pluginDeregistrationRequested, {
      pluginId,
      deleteSchema: options.deleteSchema,
    });

    rootLogger.info(`✅ Deregistration request broadcast for: ${pluginId}`);
  }

  /**
   * Request installation/loading of a plugin across all instances.
   * This emits a broadcast hook that all instances (including this one) will receive.
   * Each instance then loads the plugin into memory.
   */
  async requestInstallation(
    pluginId: string,
    pluginPath: string
  ): Promise<void> {
    rootLogger.info(`📢 Broadcasting installation request for: ${pluginId}`);

    // Emit broadcast hook - all instances receive and load the plugin
    const eventBus = await this.registry.get(coreServices.eventBus, {
      pluginId: "core",
    });
    await eventBus.emit(coreHooks.pluginInstallationRequested, {
      pluginId,
      pluginPath,
    });

    rootLogger.info(`✅ Installation request broadcast for: ${pluginId}`);
  }

  /**
   * Setup lifecycle listeners for multi-instance coordination.
   * Must be called after EventBus is available (after loadPlugins).
   */
  async setupLifecycleListeners(): Promise<void> {
    const eventBus = await this.registry.get(coreServices.eventBus, {
      pluginId: "core",
    });

    // Listen for deregistration broadcasts (from any instance)
    await eventBus.subscribe(
      "core",
      coreHooks.pluginDeregistrationRequested,
      async ({ pluginId, deleteSchema }) => {
        rootLogger.info(`📥 Received deregistration request for: ${pluginId}`);
        await this.deregisterPlugin(pluginId, { deleteSchema });
      }
    );

    // Listen for installation broadcasts (from any instance)
    await eventBus.subscribe(
      "core",
      coreHooks.pluginInstallationRequested,
      async ({ pluginId, pluginPath }) => {
        rootLogger.info(
          `📥 Received installation request for: ${pluginId} at ${pluginPath}`
        );
        await this.loadSinglePlugin(pluginId, pluginPath);
      }
    );

    rootLogger.debug("🔗 Lifecycle listeners registered");
  }

  async getService<T>(ref: ServiceRef<T>): Promise<T | undefined> {
    try {
      return await this.registry.get(ref, { pluginId: "core" });
    } catch {
      return undefined;
    }
  }

  registerService<T>(ref: ServiceRef<T>, impl: T) {
    this.registry.register(ref, impl);
  }

  /**
   * Load a single plugin at runtime (for dynamic installation).
   * If the plugin isn't available locally, it will be installed via npm first.
   * This imports the plugin module, registers it, and initializes it.
   *
   * @param pluginId - The plugin ID (package name)
   * @param pluginPath - The expected path (may not exist yet on this instance)
   */
  async loadSinglePlugin(pluginId: string, pluginPath: string): Promise<void> {
    rootLogger.info(`🔌 Loading plugin at runtime: ${pluginId}`);

    // Emit instance-local installing hook
    const eventBus = await this.registry.get(coreServices.eventBus, {
      pluginId: "core",
    });
    await eventBus.emitLocal(coreHooks.pluginInstalling, { pluginId });

    try {
      // 1. Try to import the plugin - if it fails, install it first
      let pluginModule;

      try {
        // Try importing by package name first
        pluginModule = await import(pluginId);
      } catch {
        try {
          // Try importing by path
          pluginModule = await import(pluginPath);
        } catch {
          // Plugin not available locally - need to install it
          rootLogger.info(
            `   -> Plugin ${pluginId} not found locally, installing via npm...`
          );

          const installer = await this.registry.get(
            coreServices.pluginInstaller,
            { pluginId: "core" }
          );
          const result = await installer.install(pluginId);

          // Now try importing again
          try {
            pluginModule = await import(result.name);
          } catch {
            pluginModule = await import(result.path);
          }
        }
      }

      const backendPlugin: BackendPlugin = pluginModule.default;

      if (!backendPlugin || typeof backendPlugin.register !== "function") {
        throw new Error(
          `Plugin ${pluginId} does not export a valid BackendPlugin`
        );
      }

      const metaPluginId = backendPlugin.metadata.pluginId;

      // Store metadata for request-time context injection
      this.pluginMetadataRegistry.set(metaPluginId, backendPlugin.metadata);

      // 2. Register plugin (Phase 1)
      const pendingInits: { pluginId: string; init: () => Promise<void> }[] =
        [];

      backendPlugin.register({
        registerInit: (args) => {
          pendingInits.push({
            pluginId: metaPluginId,
            init: async () => {
              // Resolve dependencies
              const resolvedDeps: Record<string, unknown> = {};
              for (const [key, ref] of Object.entries(args.deps)) {
                resolvedDeps[key] = await this.registry.get(
                  ref as ServiceRef<unknown>,
                  backendPlugin.metadata
                );
              }
              await args.init(resolvedDeps as never);
            },
          });
        },
        registerPermissions: (permissions) => {
          const prefixed = permissions.map((p) => ({
            ...p,
            id: `${metaPluginId}.${p.id}`,
            pluginId: metaPluginId,
          }));
          this.registeredPermissions.push(...prefixed);

          // Emit permission hook
          eventBus.emit(coreHooks.permissionsRegistered, {
            pluginId: metaPluginId,
            permissions: prefixed,
          });
        },
        registerService: (ref, impl) => {
          this.registry.register(ref, impl);
        },
        registerExtensionPoint: (ref, impl) => {
          this.extensionPointManager.registerExtensionPoint(ref, impl);
        },
        registerCleanup: (cleanup) => {
          const handlers = this.cleanupHandlers.get(metaPluginId) || [];
          handlers.push(cleanup);
          this.cleanupHandlers.set(metaPluginId, handlers);
        },
        getExtensionPoint: <T>(ref: ExtensionPoint<T>) =>
          this.extensionPointManager.getExtensionPoint(ref),
        registerRouter: (router: unknown, contract: AnyContractRouter) => {
          this.pluginRpcRouters.set(metaPluginId, router);
          this.pluginContractRegistry.set(metaPluginId, contract);
        },
        pluginManager: {
          getAllPermissions: () => this.getAllPermissions(),
        },
      });

      // 3. Initialize plugin (Phase 2)
      for (const pending of pendingInits) {
        await pending.init();
      }

      // 4. Emit pluginInitialized
      await eventBus.emit(coreHooks.pluginInitialized, { pluginId });

      // 5. Emit pluginInstalled
      await eventBus.emit(coreHooks.pluginInstalled, { pluginId });

      rootLogger.info(`✅ Plugin loaded at runtime: ${pluginId}`);
    } catch (error) {
      rootLogger.error(`❌ Failed to load plugin ${pluginId}:`, error);
      throw error;
    }
  }
}
