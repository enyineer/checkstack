/**
 * Type-safe migration from one data version to another.
 * Used for backward-compatible schema evolution (see `Versioned` /
 * `MigrationBuilder` in `@checkstack/backend-api`).
 *
 * Lives in `@checkstack/common` (rather than `@checkstack/backend-api`) so that
 * low-level packages such as `@checkstack/cache-api` and `@checkstack/queue-api`
 * can reference it without taking a dependency on `backend-api` - which would
 * create a publish-time dependency cycle. `@checkstack/backend-api` re-exports
 * it for backward compatibility.
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
