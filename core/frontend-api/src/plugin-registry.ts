import { FrontendPlugin, Extension } from "./plugin";

/**
 * Listener function for registry changes
 */
type RegistryListener = () => void;

/**
 * Resolved route information for runtime access.
 */
interface ResolvedRoute {
  id: string;
  path: string;
  pluginId: string;
  element?: React.ReactNode;
  title?: string;
  permission?: string;
}

class PluginRegistry {
  private plugins: FrontendPlugin[] = [];
  private extensions = new Map<string, Extension[]>();
  private routeMap = new Map<string, ResolvedRoute>();

  /**
   * Version counter that increments on every registry change.
   * Used by React components to trigger re-renders when plugins are added/removed.
   */
  private version = 0;
  private listeners: Set<RegistryListener> = new Set();

  /**
   * Get the URL-friendly base name for a plugin.
   * Strips common suffixes like "-frontend" for cleaner URLs.
   */
  private getPluginBaseName(pluginName: string): string {
    return pluginName.replace(/-frontend$/, "");
  }

  /**
   * Validate and register routes from a plugin.
   */
  private registerRoutes(plugin: FrontendPlugin) {
    if (!plugin.routes) return;

    const pluginBaseName = this.getPluginBaseName(plugin.name);

    for (const route of plugin.routes) {
      // Validate that route's pluginId matches the frontend plugin
      if (route.route.pluginId !== pluginBaseName) {
        console.error(
          `❌ Route pluginId mismatch: route "${route.route.id}" has pluginId "${route.route.pluginId}" ` +
            `but plugin is "${plugin.name}" (base: "${pluginBaseName}")`
        );
        throw new Error(
          `Route pluginId "${route.route.pluginId}" doesn't match plugin "${pluginBaseName}"`
        );
      }

      const fullPath = `/${route.route.pluginId}${
        route.route.path.startsWith("/")
          ? route.route.path
          : `/${route.route.path}`
      }`;

      const resolvedRoute: ResolvedRoute = {
        id: route.route.id,
        path: fullPath,
        pluginId: route.route.pluginId,
        element: route.element,
        title: route.title,
        permission: route.permission,
      };

      // Add to route map for resolution
      this.routeMap.set(route.route.id, resolvedRoute);
    }
  }

  /**
   * Unregister routes from a plugin.
   */
  private unregisterRoutes(plugin: FrontendPlugin) {
    if (!plugin.routes) return;

    for (const route of plugin.routes) {
      this.routeMap.delete(route.route.id);
    }
  }

  register(plugin: FrontendPlugin) {
    // Avoid duplicate registration
    if (this.plugins.some((p) => p.name === plugin.name)) {
      console.warn(`⚠️ Plugin ${plugin.name} already registered`);
      return;
    }

    console.log(`🔌 Registering frontend plugin: ${plugin.name}`);
    this.plugins.push(plugin);

    if (plugin.extensions) {
      for (const extension of plugin.extensions) {
        if (!this.extensions.has(extension.slot.id)) {
          this.extensions.set(extension.slot.id, []);
        }
        this.extensions.get(extension.slot.id)!.push(extension);
      }
    }

    this.registerRoutes(plugin);
    this.incrementVersion();
  }

  /**
   * Unregister a plugin by name.
   * Removes the plugin and all its extensions from the registry.
   */
  unregister(pluginName: string): boolean {
    const pluginIndex = this.plugins.findIndex((p) => p.name === pluginName);
    if (pluginIndex === -1) {
      console.warn(`⚠️ Plugin ${pluginName} not found for unregistration`);
      return false;
    }

    const plugin = this.plugins[pluginIndex];
    console.log(`🔌 Unregistering frontend plugin: ${pluginName}`);

    // Remove plugin from list
    this.plugins.splice(pluginIndex, 1);

    // Remove extensions
    if (plugin.extensions) {
      for (const extension of plugin.extensions) {
        const slotExtensions = this.extensions.get(extension.slot.id);
        if (slotExtensions) {
          const extIndex = slotExtensions.findIndex(
            (e) => e.id === extension.id
          );
          if (extIndex !== -1) {
            slotExtensions.splice(extIndex, 1);
          }
        }
      }
    }

    this.unregisterRoutes(plugin);
    this.incrementVersion();
    return true;
  }

  /**
   * Check if a plugin is registered.
   */
  hasPlugin(pluginName: string): boolean {
    return this.plugins.some((p) => p.name === pluginName);
  }

  getPlugins() {
    return this.plugins;
  }

  getExtensions(slotId: string): Extension[] {
    return this.extensions.get(slotId) || [];
  }

  /**
   * Get all routes for rendering in the router.
   */
  getAllRoutes() {
    return this.plugins.flatMap((plugin) => {
      return (plugin.routes || []).map((route) => {
        const fullPath = `/${route.route.pluginId}${
          route.route.path.startsWith("/")
            ? route.route.path
            : `/${route.route.path}`
        }`;

        return {
          path: fullPath,
          element: route.element,
          title: route.title,
          permission: route.permission,
        };
      });
    });
  }

  /**
   * Resolve a route by its ID to get the full path.
   *
   * @param routeId - Route ID in format "{pluginId}.{routeName}"
   * @param params - Optional path parameters to substitute
   * @returns The resolved full path, or undefined if not found
   */
  resolveRoute(
    routeId: string,
    params?: Record<string, string>
  ): string | undefined {
    const route = this.routeMap.get(routeId);
    if (!route) {
      console.warn(`⚠️ Route "${routeId}" not found in registry`);
      return undefined;
    }

    if (!params) {
      return route.path;
    }

    // Substitute path parameters
    let result = route.path;
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(`:${key}`, value);
    }
    return result;
  }

  /**
   * Get the current version number.
   * Increments on every register/unregister.
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Subscribe to registry changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private incrementVersion() {
    this.version++;
    for (const listener of this.listeners) {
      listener();
    }
  }

  reset() {
    this.plugins = [];
    this.extensions.clear();
    this.routeMap.clear();
    this.incrementVersion();
  }
}

export const pluginRegistry = new PluginRegistry();
