import { z } from "zod";
import type { CacheProvider } from "./cache-provider";
import type { Logger, Migration } from "@checkstack/backend-api";

/**
 * Plugin interface for cache backend implementations.
 * Mirrors the QueuePlugin pattern — each cache backend (in-memory, Redis, etc.)
 * implements this interface and registers with the CachePluginRegistry.
 */
export interface CachePlugin<Config = unknown> {
  id: string;
  displayName: string;
  description?: string;

  /** Current version of the configuration schema */
  configVersion: number;

  /** Validation schema for the plugin-specific config */
  configSchema: z.ZodType<Config>;

  /** Optional migrations for backward compatibility */
  migrations?: Migration<unknown, unknown>[];

  /**
   * Create a new CacheProvider instance with the given config.
   * Unlike QueuePlugin.createQueue, there's only one provider per backend (not named instances).
   */
  createProvider(config: Config, logger: Logger): CacheProvider;
}

/**
 * Registry for cache plugin implementations.
 * Cache backend plugins register themselves here during initialization.
 */
export interface CachePluginRegistry {
  register(plugin: CachePlugin<unknown>): void;
  getPlugin(id: string): CachePlugin<unknown> | undefined;
  getPlugins(): CachePlugin<unknown>[];
}
