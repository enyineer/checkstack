import { FrontendPlugin, Extension } from "./plugin";

/**
 * Listener function for registry changes
 */
type RegistryListener = () => void;

class PluginRegistry {
  private plugins: FrontendPlugin[] = [];
  private extensions = new Map<string, Extension[]>();

  /**
   * Version counter that increments on every registry change.
   * Used by React components to trigger re-renders when plugins are added/removed.
   */
  private version = 0;
  private listeners: Set<RegistryListener> = new Set();

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
        if (!this.extensions.has(extension.slotId)) {
          this.extensions.set(extension.slotId, []);
        }
        this.extensions.get(extension.slotId)!.push(extension);
      }
    }

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
        const slotExtensions = this.extensions.get(extension.slotId);
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

  getExtensions<T>(slotId: string): Extension<T>[] {
    return (this.extensions.get(slotId) as Extension<T>[]) || [];
  }

  /**
   * Get the URL-friendly base name for a plugin.
   * Strips common suffixes like "-frontend" for cleaner URLs.
   */
  private getPluginBaseName(pluginName: string): string {
    return pluginName.replace(/-frontend$/, "");
  }

  getAllRoutes() {
    return this.plugins.flatMap((plugin) => {
      const baseName = this.getPluginBaseName(plugin.name);
      return (plugin.routes || []).map((route) => ({
        ...route,
        // Auto-prefix with plugin base name for consistent namespacing
        path: `/${baseName}${
          route.path.startsWith("/") ? route.path : `/${route.path}`
        }`,
      }));
    });
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
    this.incrementVersion();
  }
}

export const pluginRegistry = new PluginRegistry();
