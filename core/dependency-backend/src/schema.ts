import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  real,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Impact type enum for dependency relationships.
 */
export const impactTypeEnum = pgEnum("impact_type", [
  "informational",
  "degraded",
  "critical",
]);

/**
 * Main dependencies table.
 * Represents directional edges: sourceSystemId (downstream) depends on targetSystemId (upstream).
 */
export const dependencies = pgTable(
  "dependencies",
  {
    id: text("id").primaryKey(),
    sourceSystemId: text("source_system_id").notNull(),
    targetSystemId: text("target_system_id").notNull(),
    impactType: impactTypeEnum("impact_type").notNull().default("degraded"),
    transitive: boolean("transitive").default(false).notNull(),
    label: text("label"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueEdge: unique("uq_dependency_edge").on(
      t.sourceSystemId,
      t.targetSystemId,
    ),
  }),
);

/**
 * Dependency scope cells (kept table name for storage compatibility).
 *
 * Each row narrows an edge to a slice of the upstream (target) system and gives
 * that slice its own severity:
 * - `healthCheckId` = a target configuration id, or NULL for "any check".
 * - `environmentId` = a target environment id, or NULL for "any environment".
 * - `overrideImpactType` = severity applied when that slice is affected.
 *
 * When a dependency has ANY cells, only those slices are watched (they replace
 * the whole-system watch). With NO cells, the edge watches the target's overall
 * rollup at the edge's `impactType` (the default any-check/any-env behaviour).
 */
export const dependencyHealthCheckRules = pgTable(
  "dependency_health_check_rules",
  {
    id: text("id").primaryKey(),
    dependencyId: text("dependency_id")
      .notNull()
      .references(() => dependencies.id, { onDelete: "cascade" }),
    // Nullable: NULL = "any check" of the target system.
    healthCheckId: text("health_check_id"),
    // Nullable: NULL = "any environment" (the target's cross-env rollup).
    environmentId: text("environment_id"),
    overrideImpactType: impactTypeEnum("override_impact_type").notNull(),
  },
);

/**
 * Per-user node positions for the dependency map canvas.
 * Persisted server-side so layout syncs across devices.
 */
export const nodePositions = pgTable("node_positions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  systemId: text("system_id").notNull(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Tracks the last known derived state per downstream system.
 * Used by the notification sidecar to detect state transitions
 * and avoid duplicate notifications across horizontally-scaled instances.
 */
export const dependencyDerivedStates = pgTable("dependency_derived_states", {
  systemId: text("system_id").primaryKey(),
  derivedState: text("derived_state").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
