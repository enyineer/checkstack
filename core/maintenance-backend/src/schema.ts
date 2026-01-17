import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  primaryKey,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * Maintenance status enum
 */
export const maintenanceStatusEnum = pgEnum("maintenance_status", [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

/**
 * Main maintenance table
 */
export const maintenances = pgTable("maintenances", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  suppressNotifications: boolean("suppress_notifications")
    .notNull()
    .default(false),
  status: maintenanceStatusEnum("status").notNull().default("scheduled"),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Junction table for maintenance-system many-to-many relationship
 */
export const maintenanceSystems = pgTable(
  "maintenance_systems",
  {
    maintenanceId: text("maintenance_id")
      .notNull()
      .references(() => maintenances.id, { onDelete: "cascade" }),
    systemId: text("system_id").notNull(),
  },
  (t) => ({
    pk: primaryKey(t.maintenanceId, t.systemId),
  }),
);

/**
 * Status updates for maintenances
 */
export const maintenanceUpdates = pgTable("maintenance_updates", {
  id: text("id").primaryKey(),
  maintenanceId: text("maintenance_id")
    .notNull()
    .references(() => maintenances.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  statusChange: maintenanceStatusEnum("status_change"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: text("created_by"),
});
