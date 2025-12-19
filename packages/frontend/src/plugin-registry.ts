import { FrontendPlugin, Extension } from "@checkmate/frontend-api";

class PluginRegistry {
  private plugins: FrontendPlugin[] = [];
  private extensions = new Map<string, Extension[]>();

  register(plugin: FrontendPlugin) {
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
  }

  getPlugins() {
    return this.plugins;
  }

  getExtensions<T>(slotId: string): Extension<T>[] {
    return (this.extensions.get(slotId) as Extension<T>[]) || [];
  }

  getAllRoutes() {
    return this.plugins.flatMap((p) => p.routes || []);
  }
}

export const pluginRegistry = new PluginRegistry();
