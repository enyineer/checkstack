import type {
  CachePlugin,
  CachePluginRegistry,
} from "@checkstack/cache-api";

export class CachePluginRegistryImpl implements CachePluginRegistry {
  private plugins = new Map<string, CachePlugin<unknown>>();

  register(plugin: CachePlugin<unknown>): void {
    this.plugins.set(plugin.id, plugin);
  }

  getPlugin(id: string): CachePlugin<unknown> | undefined {
    return this.plugins.get(id);
  }

  getPlugins(): CachePlugin<unknown>[] {
    return [...this.plugins.values()];
  }
}
