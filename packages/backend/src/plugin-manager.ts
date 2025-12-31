import type { Hono } from "hono";
import { adminPool, db } from "./db";
import { ServiceRegistry } from "./services/service-registry";
import {
  BackendPlugin,
  ServiceRef,
  ExtensionPoint,
} from "@checkmate/backend-api";
import type { Permission } from "@checkmate/common";
import { rootLogger } from "./logger";

// Extracted modules
import { registerCoreServices } from "./plugin-manager/core-services";
import { createExtensionPointManager } from "./plugin-manager/extension-points";
import { loadPlugins as loadPluginsImpl } from "./plugin-manager/plugin-loader";

export class PluginManager {
  private registry = new ServiceRegistry();
  private pluginRpcRouters = new Map<string, unknown>();
  private pluginHttpHandlers = new Map<
    string,
    (req: Request) => Promise<Response>
  >();
  private extensionPointManager = createExtensionPointManager();

  // Permission registry
  private registeredPermissions: { id: string; description?: string }[] = [];
  private deferredPermissionRegistrations: {
    pluginId: string;
    permissions: { id: string; description?: string }[];
  }[] = [];

  constructor() {
    registerCoreServices({
      registry: this.registry,
      adminPool,
      pluginRpcRouters: this.pluginRpcRouters,
      pluginHttpHandlers: this.pluginHttpHandlers,
    });
  }

  registerExtensionPoint<T>(ref: ExtensionPoint<T>, impl: T) {
    this.extensionPointManager.registerExtensionPoint(ref, impl);
  }

  getExtensionPoint<T>(ref: ExtensionPoint<T>): T {
    return this.extensionPointManager.getExtensionPoint(ref);
  }

  private registerPermissions(pluginId: string, permissions: Permission[]) {
    // Prefix all permission IDs with the plugin ID
    const prefixed = permissions.map((p) => ({
      id: `${pluginId}.${p.id}`,
      description: p.description,
    }));

    // Store permissions in central registry
    this.registeredPermissions.push(...prefixed);
    rootLogger.debug(
      `   -> Registered ${prefixed.length} permissions for ${pluginId}`
    );

    // Defer hook emission until all plugins are initialized
    this.deferredPermissionRegistrations.push({
      pluginId,
      permissions: prefixed,
    });
  }

  getAllPermissions(): { id: string; description?: string }[] {
    return [...this.registeredPermissions];
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
        registerPermissions: (pluginId, permissions) =>
          this.registerPermissions(pluginId, permissions),
        getAllPermissions: () => this.getAllPermissions(),
        db,
        deferredPermissionRegistrations: this.deferredPermissionRegistrations,
        clearDeferredPermissions: () => {
          this.deferredPermissionRegistrations = [];
        },
      },
    });
  }

  async getService<T>(ref: ServiceRef<T>): Promise<T | undefined> {
    try {
      return await this.registry.get(ref, "core");
    } catch {
      return undefined;
    }
  }

  registerService<T>(ref: ServiceRef<T>, impl: T) {
    this.registry.register(ref, impl);
  }
}
