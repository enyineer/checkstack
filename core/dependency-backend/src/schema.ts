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
 * Optional health check rules for fine-grained dependency triggers.
 * When rules exist on a dependency, only specified checks trigger the impact.
 */
export const dependencyHealthCheckRules = pgTable(
  "dependency_health_check_rules",
  {
    id: text("id").primaryKey(),
    dependencyId: text("dependency_id")
      .notNull()
      .references(() => dependencies.id, { onDelete: "cascade" }),
    healthCheckId: text("health_check_id").notNull(),
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
