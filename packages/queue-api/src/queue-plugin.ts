import { z } from "zod";
import { Queue } from "./queue";

export interface QueuePlugin<Config = unknown> {
  id: string;
  displayName: string;
  description?: string;
  configSchema: z.ZodType<Config>;
  createQueue<T>(name: string, config: Config): Queue<T>;
}

export interface QueuePluginRegistry {
  register(plugin: QueuePlugin<unknown>): void;
  getPlugin(id: string): QueuePlugin<unknown> | undefined;
  getPlugins(): QueuePlugin<unknown>[];
}

export interface QueueFactory {
  /**
   * Create a queue using the configured queue plugin
   */
  createQueue<T>(name: string): Queue<T>;

  /**
   * Get the currently active queue plugin ID
   */
  getActivePlugin(): string;

  /**
   * Set the active queue plugin and its configuration
   */
  setActivePlugin(pluginId: string, config: unknown): Promise<void>;
}
