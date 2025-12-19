import { FrontendPlugin } from "@checkmate/frontend-api";

class PluginRegistry {
  private plugins: FrontendPlugin[] = [];

  register(plugin: FrontendPlugin) {
    console.log(`🔌 Registering frontend plugin: ${plugin.name}`);
    this.plugins.push(plugin);
  }

  getPlugins() {
    return this.plugins;
  }
}

export const pluginRegistry = new PluginRegistry();
