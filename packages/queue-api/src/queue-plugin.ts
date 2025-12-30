import { z } from "zod";
import { Queue } from "./queue";
import type { MigrationChain } from "@checkmate/backend-api";

export interface QueuePlugin<Config = unknown> {
  id: string;
  displayName: string;
  description?: string;

  /** Current version of the configuration schema */
  configVersion: number;

  /** Validation schema for the plugin-specific config */
  configSchema: z.ZodType<Config>;

  /** Optional migrations for backward compatibility */
  migrations?: MigrationChain<Config>;

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
   * Get the currently active queue plugin configuration
   */
  getActiveConfig(): unknown;

  /**
   * Set the active queue plugin and its configuration
   */
  setActivePlugin(pluginId: string, config: unknown): Promise<void>;
}
