import { z } from "zod";
import { extractErrorMessage } from "@checkstack/common";
import type { Migration } from "@checkstack/common";

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
 * The canonical `Migration` definition now lives in `@checkstack/common` so
 * that low-level packages (`@checkstack/cache-api`, `@checkstack/queue-api`)
 * can reference it without depending on `backend-api` and creating a
 * publish-time dependency cycle. Re-exported here for backward compatibility.
 */
export type { Migration } from "@checkstack/common";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Migration Chain Validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Options for {@link assertMigrationChainFromV1}.
 */
export interface AssertMigrationChainOptions {
  /** Target/current schema version the chain must reach. */
  version: number;
  /** The ordered (or unordered) set of migrations covering the chain. */
  migrations: Migration<unknown, unknown>[];
}

/**
 * Standalone, pure structural guard that a migration chain is COMPLETE and
 * contiguous from version 1 up to the given `version`: every applicable step
 * increments by exactly 1, there are no gaps, and the chain reaches
 * `version`. No `migrate()` is ever invoked — this only inspects the
 * `fromVersion` / `toVersion` discriminators.
 *
 * A `version: 1` config with no migrations passes trivially. Any
 * `version > 1` requires a covering chain; an incomplete chain is a latent
 * read failure (the read path would only discover it when it first tries to
 * migrate a genuinely-old stored blob), so callers use this to fail fast at
 * boot / registration instead.
 *
 * This is the single shared implementation behind both {@link Versioned}'s
 * construction guard and its non-throwing {@link Versioned.validateMigrationChainFromV1}
 * variant, and is reused by the auth strategy registration guard.
 *
 * @throws Error with a descriptive message on the first problem found.
 */
export function assertMigrationChainFromV1({
  version,
  migrations,
}: AssertMigrationChainOptions): void {
  const sorted = migrations.toSorted((a, b) => a.fromVersion - b.fromVersion);

  let expectedVersion = 1;
  for (const migration of sorted) {
    if (migration.fromVersion < 1) continue;
    if (migration.toVersion > version) break;

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

  if (expectedVersion !== version) {
    throw new Error(
      `Migration chain incomplete: reaches version ${expectedVersion}, ` +
        `but target version is ${version}`
    );
  }
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
    return this as unknown as MigrationBuilder<TNext>;
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
  private readonly _migrations: Migration<unknown, unknown>[];

  constructor(options: VersionedOptions<T>) {
    this.version = options.version;
    this.schema = options.schema;
    this._migrations = options.migrations ?? [];

    // Fail fast at construction (i.e. at module import / plugin
    // registration) if this Versioned's v1->version migration chain is
    // incomplete or broken. A `version: 1` config with no migrations
    // passes trivially. Any `version > 1` without a covering chain would
    // otherwise fail lazily on the first stale `parseAssumingV1` read — we
    // surface it at boot instead. This single guard covers every Versioned
    // instance repo-wide.
    assertMigrationChainFromV1({
      version: this.version,
      migrations: this._migrations,
    });
  }

  /**
   * Get the migrations chain for this versioned schema.
   * Useful for ConfigService integration.
   */
  get migrations(): Migration<unknown, unknown>[] {
    return this._migrations;
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

  /**
   * Parse raw data that was stored UNVERSIONED, assuming it was written
   * at version 1.
   *
   * Many config blobs predate explicit versioning and live nested in a
   * larger JSON document (e.g. an automation `definition`) without a
   * `version` discriminator. Reading them is "assume v1 on read": wrap the
   * raw value as `{ version: 1, data }`, run the migration chain up to the
   * current version, then validate.
   *
   * For a v1-with-no-migrations config this is just a validate; for a
   * config whose `version > 1` it runs the full migration chain first, so
   * removed/renamed fields are migrated away before validation.
   *
   * Validation is LENIENT (unknown keys are stripped, not rejected) — use
   * this on the runtime/read path so a stored config that picked up an
   * extra key survives schema evolution.
   *
   * @throws ZodError on validation failure
   * @throws Error on migration failure
   */
  async parseAssumingV1(rawData: unknown): Promise<T> {
    return this.parse({ version: 1, data: rawData });
  }

  /**
   * Like {@link parseAssumingV1}, but the FINAL validation is STRICT:
   * unknown keys on a plain-object schema are rejected rather than
   * stripped.
   *
   * Migrate-then-STRICT is the editor/validation path: removed or renamed
   * fields are migrated away by the chain (so stored configs survive
   * schema evolution), while genuine typos — keys no migration accounts
   * for — still surface to the operator.
   *
   * Strict handling mirrors the object-vs-non-object split used by the
   * automation definition validator: only `z.ZodObject` schemas can be
   * tightened with `.strict()`; unions, records, and primitives fall back
   * to a normal parse.
   *
   * @throws ZodError on validation failure
   * @throws Error on migration failure
   */
  async parseStrictAssumingV1(rawData: unknown): Promise<T> {
    const migrated = await this.migrateToVersion({ version: 1, data: rawData });
    return this.strictValidate(migrated.data);
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
   * Structural check (no `migrate()` invocation) that this config has a
   * COMPLETE, contiguous migration chain from version 1 to its current
   * `version`: every step increments by exactly 1 and the chain reaches
   * `version` with no gaps or detours.
   *
   * For a `version: 1` config this is trivially satisfied (no migrations
   * needed). For any `version > 1` it requires a covering chain — which is
   * exactly what {@link parseAssumingV1} relies on, so a missing chain is a
   * latent read failure. Returns the first problem found, or `undefined`
   * when the chain is complete.
   *
   * Intended for a CI contract test that enumerates every registered config
   * and fails the build if a future `version` bump ships without a covering
   * migration — zero per-config upkeep.
   */
  validateMigrationChainFromV1(): string | undefined {
    try {
      assertMigrationChainFromV1({
        version: this.version,
        migrations: this._migrations,
      });
      return undefined;
    } catch (error) {
      return extractErrorMessage(error);
    }
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

  /**
   * Validate in STRICT mode: when the schema is a plain object, unknown
   * keys are rejected; otherwise (unions/records/primitives) fall back to
   * a normal parse. Used by {@link parseStrictAssumingV1}.
   */
  private strictValidate(data: unknown): T {
    if (this.schema instanceof z.ZodObject) {
      // `.strict()` only narrows accepted keys; the parsed output shape is
      // identical to the base object schema's, but its inferred type loses
      // the `T` brand. The cast restores it without changing runtime
      // behaviour.
      return this.schema.strict().parse(data) as T;
    }
    return this.schema.parse(data);
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
