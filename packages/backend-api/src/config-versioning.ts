/**
 * Versioned configuration wrapper for dynamic plugin configurations
 * Enables backward-compatible schema evolution with migrations
 */
export interface VersionedConfig<T = unknown> {
  /** Schema version (starts at 1, increments sequentially) */
  version: number;

  /** Plugin ID that owns this configuration */
  pluginId: string;

  /** The actual configuration data */
  data: T;

  /** When the last migration was applied (if any) */
  migratedAt?: Date;

  /** Original version before any migrations were applied */
  originalVersion?: number;
}

// Re-export migration types for convenience
export type { ConfigMigration, MigrationChain } from "./config-migration";
import type { ConfigMigration } from "./config-migration";

/**
 * Builder for creating type-safe migration chains
 * Provides better type inference for each migration step
 */
export class MigrationChainBuilder<TCurrent> {
  private migrations: ConfigMigration<unknown, unknown>[] = [];

  /**
   * Add a migration to the chain
   * Returns a new builder with updated type for the next migration
   */
  addMigration<TNext>(
    migration: ConfigMigration<TCurrent, TNext>
  ): MigrationChainBuilder<TNext> {
    this.migrations.push(migration);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this as any as MigrationChainBuilder<TNext>;
  }

  /**
   * Build the final migration chain
   */
  build(): ConfigMigration<unknown, unknown>[] {
    return this.migrations;
  }
}
