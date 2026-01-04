import { z } from "zod";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Storage Interfaces (simple data shapes for DB/API)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Base interface for versioned data stored in database.
 * Simple JSON-serializable shape.
 */
export interface VersionedRecord<T = unknown> {
  /** Schema version of this record */
  version: number;
  /** The actual data payload */
  data: T;
  /** When the last migration was applied (if any) */
  migratedAt?: Date;
  /** Original version before any migrations were applied */
  originalVersion?: number;
}

/**
 * Versioned record with plugin context.
 * Used for plugin-wide configuration storage.
 */
export interface VersionedPluginRecord<T = unknown> extends VersionedRecord<T> {
  /** Plugin ID that owns this configuration */
  pluginId: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Migration Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Type-safe migration from one data version to another.
 * Used for backward-compatible schema evolution.
 */
export interface Migration<TFrom = unknown, TTo = unknown> {
  /** Version number migrating from */
  fromVersion: number;
  /** Version number migrating to (must be fromVersion + 1) */
  toVersion: number;
  /** Human-readable description of what this migration does */
  description: string;
  /** Migration function that transforms old data to new format */
  migrate(data: TFrom): TTo | Promise<TTo>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Migration Builder
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Builder for creating type-safe migration chains.
 * Provides better type inference for each migration step.
 */
export class MigrationBuilder<TCurrent> {
  private migrations: Migration<unknown, unknown>[] = [];

  /**
   * Add a migration to the chain.
   * Returns a new builder with updated type for the next migration.
   */
  addMigration<TNext>(
    migration: Migration<TCurrent, TNext>
  ): MigrationBuilder<TNext> {
    this.migrations.push(migration);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this as any as MigrationBuilder<TNext>;
  }

  /**
   * Build the final migration chain.
   */
  build(): Migration<unknown, unknown>[] {
    return this.migrations;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Parse Result Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ParseSuccess<T> = { success: true; data: T };
export type ParseError = { success: false; error: Error };
export type ParseResult<T> = ParseSuccess<T> | ParseError;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Versioned<T> Class
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Options for creating a Versioned instance.
 */
export interface VersionedOptions<T> {
  /** Current schema version */
  version: number;
  /** Zod schema for validation */
  schema: z.ZodType<T>;
  /** Optional migrations for backward compatibility */
  migrations?: Migration<unknown, unknown>[];
}

/**
 * Unified versioned schema handler.
 * Combines type definition, validation, and migration in one API.
 *
 * @example
 * ```typescript
 * const configType = new Versioned({
 *   version: 2,
 *   schema: configSchemaV2,
 *   migrations: [v1ToV2Migration],
 * });
 *
 * // Parse stored data (auto-migrates and validates)
 * const config = await configType.parse(storedRecord);
 *
 * // Create new versioned data
 * const record = configType.create({ url: "...", method: "GET" });
 * ```
 */
export class Versioned<T> {
  readonly version: number;
  readonly schema: z.ZodType<T>;
  private readonly migrations: Migration<unknown, unknown>[];

  constructor(options: VersionedOptions<T>) {
    this.version = options.version;
    this.schema = options.schema;
    this.migrations = options.migrations ?? [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Data Parsing (load from storage)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Parse and migrate stored data to current version.
   * Returns just the data payload.
   * @throws ZodError on validation failure
   * @throws Error on migration failure
   */
  async parse(input: VersionedRecord<unknown>): Promise<T> {
    const migrated = await this.migrateToVersion(input);
    return this.schema.parse(migrated.data);
  }

  /**
   * Safe parse - returns result object instead of throwing.
   */
  async safeParse(input: VersionedRecord<unknown>): Promise<ParseResult<T>> {
    try {
      const data = await this.parse(input);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  /**
   * Parse and return full VersionedRecord wrapper (preserves metadata).
   */
  async parseRecord(
    input: VersionedRecord<unknown>
  ): Promise<VersionedRecord<T>> {
    const migrated = await this.migrateToVersion(input);
    const validated = this.schema.parse(migrated.data);
    return { ...migrated, data: validated };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Data Creation (wrap new data)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new VersionedRecord wrapper for fresh data.
   * Validates data against schema.
   */
  create(data: T): VersionedRecord<T> {
    return {
      version: this.version,
      data: this.schema.parse(data),
    };
  }

  /**
   * Create with plugin context for plugin-wide configs.
   */
  createForPlugin(data: T, pluginId: string): VersionedPluginRecord<T> {
    return {
      version: this.version,
      data: this.schema.parse(data),
      pluginId,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if data needs migration to reach current version.
   */
  needsMigration(input: VersionedRecord<unknown>): boolean {
    return input.version !== this.version;
  }

  /**
   * Validate data without migration (schema.parse wrapper).
   * For data already at current version.
   */
  validate(data: unknown): T {
    return this.schema.parse(data);
  }

  /**
   * Safe validate - returns result object instead of throwing.
   */
  safeValidate(data: unknown): ReturnType<z.ZodType<T>["safeParse"]> {
    return this.schema.safeParse(data);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal migration logic
  // ─────────────────────────────────────────────────────────────────────────

  private async migrateToVersion(
    input: VersionedRecord<unknown>
  ): Promise<VersionedRecord<unknown>> {
    if (input.version === this.version) {
      return input;
    }

    // Validate migration chain
    this.validateMigrationChain(input.version);

    // Sort and filter applicable migrations
    const applicable = this.migrations
      .filter(
        (m) => m.fromVersion >= input.version && m.toVersion <= this.version
      )
      .toSorted((a, b) => a.fromVersion - b.fromVersion);

    // Run migrations sequentially
    let currentData = input.data;
    let currentVersion = input.version;
    const originalVersion = input.originalVersion ?? input.version;

    for (const migration of applicable) {
      try {
        currentData = await migration.migrate(currentData);
        currentVersion = migration.toVersion;
      } catch (error) {
        throw new Error(
          `Migration from v${migration.fromVersion} to v${migration.toVersion} failed: ${error}`
        );
      }
    }

    return {
      version: currentVersion,
      data: currentData,
      migratedAt: new Date(),
      originalVersion,
    };
  }

  private validateMigrationChain(fromVersion: number): void {
    const sorted = this.migrations.toSorted(
      (a, b) => a.fromVersion - b.fromVersion
    );

    let expectedVersion = fromVersion;
    for (const migration of sorted) {
      if (migration.fromVersion < fromVersion) continue;
      if (migration.toVersion > this.version) break;

      if (migration.fromVersion !== expectedVersion) {
        throw new Error(
          `Migration chain broken: expected migration from version ${expectedVersion}, ` +
            `but found migration from version ${migration.fromVersion}`
        );
      }
      if (migration.toVersion !== migration.fromVersion + 1) {
        throw new Error(
          `Migration must increment version by 1: migration from ${migration.fromVersion} ` +
            `to ${migration.toVersion} is invalid`
        );
      }
      expectedVersion = migration.toVersion;
    }

    if (expectedVersion !== this.version) {
      throw new Error(
        `Migration chain incomplete: reaches version ${expectedVersion}, ` +
          `but target version is ${this.version}`
      );
    }
  }
}
