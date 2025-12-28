import { QueuePlugin, QueuePluginRegistry } from "@checkmate/queue-api";

export class QueuePluginRegistryImpl implements QueuePluginRegistry {
  private plugins = new Map<string, QueuePlugin<unknown>>();

  register(plugin: QueuePlugin<unknown>): void {
    this.plugins.set(plugin.id, plugin);
  }

  getPlugin(id: string): QueuePlugin<unknown> | undefined {
    return this.plugins.get(id);
  }

  getPlugins(): QueuePlugin<unknown>[] {
    return [...this.plugins.values()];
  }
}
