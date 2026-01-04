import { z } from "zod";
import type { Migration } from "./config-versioning";

/**
 * Service for managing plugin configurations with automatic secret handling.
 * Each plugin gets its own scoped instance that can only access its own configs.
 */
export interface ConfigService {
  /**
   * Store a configuration with automatic secret encryption and migration support.
   *
   * @param configId - Unique identifier for this config (e.g., "github-strategy", "smtp-settings")
   * @param schema - Zod schema that defines the config structure and marks secret fields
   * @param version - Current schema version
   * @param data - The configuration data to store
   * @param migrations - Optional migration chain for backward compatibility
   */
  set<T>(
    configId: string,
    schema: z.ZodType<T>,
    version: number,
    data: T,
    migrations?: Migration<unknown, unknown>[]
  ): Promise<void>;

  /**
   * Load a configuration with automatic secret decryption and migration.
   * Returns undefined if config doesn't exist.
   *
   * @param configId - Unique identifier for the config
   * @param schema - Zod schema for validation and secret detection
   * @param version - Expected schema version
   * @param migrations - Optional migration chain
   */
  get<T>(
    configId: string,
    schema: z.ZodType<T>,
    version: number,
    migrations?: Migration<unknown, unknown>[]
  ): Promise<T | undefined>;

  /**
   * Load a configuration without decrypting secrets (safe for frontend).
   * Returns the data with secret fields removed.
   *
   * @param configId - Unique identifier for the config
   * @param schema - Zod schema for secret detection
   * @param version - Expected schema version
   * @param migrations - Optional migration chain
   */
  getRedacted<T>(
    configId: string,
    schema: z.ZodType<T>,
    version: number,
    migrations?: Migration<unknown, unknown>[]
  ): Promise<Partial<T> | undefined>;

  /**
   * Delete a configuration.
   *
   * @param configId - Unique identifier for the config to delete
   */
  delete(configId: string): Promise<void>;

  /**
   * List all config IDs for this plugin.
   *
   * @returns Array of config IDs belonging to this plugin
   */
  list(): Promise<string[]>;
}
