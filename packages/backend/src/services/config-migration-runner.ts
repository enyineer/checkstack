import {
  VersionedConfig,
  ConfigMigration,
  MigrationChain,
} from "@checkmate/backend-api";

/**
 * Service for running configuration migrations
 * Ensures migrations run in correct sequential order with validation
 */
export class ConfigMigrationRunner {
  /**
   * Validate that migration chain has correct sequential ordering
   * Throws error if chain is invalid
   */
  private validateMigrationChain(
    migrations: ConfigMigration<unknown, unknown>[],
    fromVersion: number,
    toVersion: number
  ): void {
    // Sort migrations by fromVersion to ensure correct order
    const sorted = migrations.toSorted((a, b) => a.fromVersion - b.fromVersion);

    // Verify we have a complete chain
    let expectedVersion = fromVersion;
    for (const migration of sorted) {
      if (migration.fromVersion !== expectedVersion) {
        throw new Error(
          `Migration chain broken: expected migration from version ${expectedVersion}, ` +
            `but found migration from version ${migration.fromVersion}`
        );
      }

      // Verify toVersion is exactly fromVersion + 1 (sequential)
      if (migration.toVersion !== migration.fromVersion + 1) {
        throw new Error(
          `Migration must increment version by 1: ` +
            `migration from ${migration.fromVersion} to ${migration.toVersion} is invalid`
        );
      }

      expectedVersion = migration.toVersion;
    }

    if (expectedVersion !== toVersion) {
      throw new Error(
        `Migration chain incomplete: reaches version ${expectedVersion}, ` +
          `but target version is ${toVersion}`
      );
    }
  }

  /**
   * Migrate a versioned config to the latest version
   * Migrations are ALWAYS run in sequential order (v1->v2, v2->v3, etc.)
   */
  async migrate<T>(
    versionedConfig: VersionedConfig,
    targetVersion: number,
    migrations: MigrationChain<T>
  ): Promise<VersionedConfig<T>> {
    const currentVersion = versionedConfig.version;

    // No migration needed
    if (currentVersion === targetVersion) {
      return versionedConfig as VersionedConfig<T>;
    }

    // Validate migration chain before running
    this.validateMigrationChain(migrations, currentVersion, targetVersion);

    // Sort migrations to ensure correct order (v1->v2, v2->v3, etc.)
    const sortedMigrations = migrations.toSorted(
      (a, b) => a.fromVersion - b.fromVersion
    );

    // Filter to only migrations we need
    const applicableMigrations = sortedMigrations.filter(
      (m) => m.fromVersion >= currentVersion && m.toVersion <= targetVersion
    );

    // Run migrations sequentially in order
    let currentData = versionedConfig.data;
    let runningVersion = currentVersion;
    const originalVersion = versionedConfig.originalVersion ?? currentVersion;

    for (const migration of applicableMigrations) {
      try {
        currentData = await migration.migrate(currentData);
        runningVersion = migration.toVersion;
      } catch (error) {
        throw new Error(
          `Migration from v${migration.fromVersion} to v${migration.toVersion} failed: ${error}`
        );
      }
    }

    return {
      version: runningVersion,
      pluginId: versionedConfig.pluginId,
      data: currentData as T,
      migratedAt: new Date(),
      originalVersion,
    };
  }
}
