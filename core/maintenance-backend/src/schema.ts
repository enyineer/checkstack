import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  primaryKey,
  boolean,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import type { MaintenanceUpdateEditSnapshot } from "@checkstack/maintenance-common";

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
 * Audience for a maintenance update or hotlink. Filtered server-side on the
 * read path: anonymous / public-status-page reads see only `public`;
 * authenticated non-managers additionally see `logged_in`; managers see all.
 */
export const maintenanceVisibilityEnum = pgEnum(
  "maintenance_content_visibility",
  ["public", "logged_in", "internal"],
);

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
    // Reverse lookup by system (getMaintenancesForSystem, per-system render
    // fan-out); the junction PK leads with the maintenance id.
    systemIdx: index("maintenance_systems_system_idx").on(t.systemId),
  }),
);

/**
 * Status updates for maintenances
 */
export const maintenanceUpdates = pgTable(
  "maintenance_updates",
  {
    id: text("id").primaryKey(),
    maintenanceId: text("maintenance_id")
      .notNull()
      .references(() => maintenances.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    statusChange: maintenanceStatusEnum("status_change"),
    visibility: maintenanceVisibilityEnum("visibility")
      .notNull()
      .default("public"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Set when the update is edited in place (null = never edited).
    editedAt: timestamp("edited_at"),
    // Prior versions archived on each in-place edit (oldest first). Durable,
    // globally-readable history of edits (jsonb, defaults to an empty array so
    // existing rows backfill cleanly). Manager-facing; the read path strips it
    // for non-manager audiences (see read-visibility).
    editHistory: jsonb("edit_history")
      .$type<MaintenanceUpdateEditSnapshot[]>()
      .notNull()
      .default([]),
    createdBy: text("created_by"),
  },
  (t) => ({
    // Status derivation (ORDER BY created_at DESC LIMIT 1) + bulk timeline
    // fetch, both keyed on maintenance id.
    maintenanceCreatedIdx: index(
      "maintenance_updates_maintenance_created_idx",
    ).on(t.maintenanceId, t.createdAt),
  }),
);

/**
 * Hotlinks attached to a maintenance — e.g. a change ticket, runbook, or
 * chat thread. Free-form URL + optional human label.
 */
export const maintenanceLinks = pgTable(
  "maintenance_links",
  {
    id: text("id").primaryKey(),
    maintenanceId: text("maintenance_id")
      .notNull()
      .references(() => maintenances.id, { onDelete: "cascade" }),
    label: text("label"),
    url: text("url").notNull(),
    visibility: maintenanceVisibilityEnum("visibility")
      .notNull()
      .default("public"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // The same URL may be attached to a maintenance only once.
    maintenanceUrlUnique: uniqueIndex(
      "maintenance_links_maintenance_url_unique",
    ).on(t.maintenanceId, t.url),
  }),
);
