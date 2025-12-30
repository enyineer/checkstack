/**
 * Type-safe migration from one config version to another.
 * Used for backward-compatible schema evolution across all plugin configs.
 */
export interface ConfigMigration<TFrom = unknown, TTo = unknown> {
  /** Version number migrating from */
  fromVersion: number;
  /** Version number migrating to */
  toVersion: number;
  /** Human-readable description of what this migration does */
  description: string;
  /** Migration function that transforms old config to new config */
  migrate(oldConfig: TFrom): TTo | Promise<TTo>;
}

/**
 * Helper type for a chain of migrations.
 * Represents sequential migrations from version 1 to the current version.
 */
export type MigrationChain<T> = ConfigMigration<unknown, T>[];
