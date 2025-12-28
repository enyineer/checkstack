import { z } from "zod";
import { Queue } from "./queue";

/**
 * Type-safe migration from one config version to another
 */
export interface ConfigMigration<TFrom = unknown, TTo = unknown> {
  fromVersion: number;
  toVersion: number;
  description: string;
  migrate(oldConfig: TFrom): TTo | Promise<TTo>;
}

/**
 * Helper type for a chain of migrations
 */
export type MigrationChain<T> = ConfigMigration<unknown, T>[];

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
   * Set the active queue plugin and its configuration
   */
  setActivePlugin(pluginId: string, config: unknown): Promise<void>;
}
