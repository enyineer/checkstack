import type { Hono } from "hono";
import { adminPool, db } from "./db";
import { ServiceRegistry } from "./services/service-registry";
import {
  BackendPlugin,
  ServiceRef,
  ExtensionPoint,
} from "@checkmate/backend-api";

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

  // Permission registry - stores all registered permissions with pluginId for hook emission
  private registeredPermissions: {
    pluginId: string;
    id: string;
    description?: string;
    isDefault?: boolean;
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

  getAllPermissions(): {
    id: string;
    description?: string;
    isDefault?: boolean;
  }[] {
    return this.registeredPermissions.map(({ id, description, isDefault }) => ({
      id,
      description,
      isDefault,
    }));
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
