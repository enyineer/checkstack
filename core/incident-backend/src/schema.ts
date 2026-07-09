import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  primaryKey,
  boolean,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import type { IncidentUpdateEditSnapshot } from "@checkstack/incident-common";

/**
 * Incident status enum
 */
export const incidentStatusEnum = pgEnum("incident_status", [
  "investigating",
  "identified",
  "fixing",
  "monitoring",
  "resolved",
]);

/**
 * Incident severity enum
 */
export const incidentSeverityEnum = pgEnum("incident_severity", [
  "minor",
  "major",
  "critical",
]);

/**
 * Optional health status an active incident forces onto its affected systems.
 * A subset of the health-check status vocabulary (no "healthy" - forcing a
 * system healthy via an incident makes no sense). Nullable column: `null` means
 * the incident does not touch derived system health.
 */
export const incidentHealthOverrideEnum = pgEnum("incident_health_override", [
  "degraded",
  "unhealthy",
]);

/**
 * Audience for an incident update or hotlink. Filtered server-side on the read
 * path: anonymous / public-status-page reads see only `public`; authenticated
 * non-managers additionally see `logged_in`; managers see everything.
 */
export const incidentVisibilityEnum = pgEnum("incident_content_visibility", [
  "public",
  "logged_in",
  "internal",
]);

/**
 * Main incidents table
 */
export const incidents = pgTable("incidents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: incidentStatusEnum("status").notNull().default("investigating"),
  severity: incidentSeverityEnum("severity").notNull().default("major"),
  suppressNotifications: boolean("suppress_notifications")
    .default(false)
    .notNull(),
  healthOverride: incidentHealthOverrideEnum("health_override"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Junction table for incident-system many-to-many relationship
 */
export const incidentSystems = pgTable(
  "incident_systems",
  {
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    systemId: text("system_id").notNull(),
  },
  (t) => ({
    pk: primaryKey(t.incidentId, t.systemId),
  }),
);

/**
 * Status updates for incidents
 */
export const incidentUpdates = pgTable("incident_updates", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id")
    .notNull()
    .references(() => incidents.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  statusChange: incidentStatusEnum("status_change"),
  visibility: incidentVisibilityEnum("visibility").notNull().default("public"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Set when the update is edited in place (null = never edited).
  editedAt: timestamp("edited_at"),
  // Prior versions archived on each in-place edit (oldest first). Durable,
  // globally-readable history of edits (jsonb, defaults to an empty array so
  // existing rows backfill cleanly). Manager-facing; the read path strips it
  // for non-manager audiences (see read-visibility).
  editHistory: jsonb("edit_history")
    .$type<IncidentUpdateEditSnapshot[]>()
    .notNull()
    .default([]),
  createdBy: text("created_by"),
});

/**
 * Hotlinks attached to an incident — e.g. a Jira ticket, runbook, or chat
 * thread. Free-form URL + optional human label.
 */
export const incidentLinks = pgTable(
  "incident_links",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    label: text("label"),
    url: text("url").notNull(),
    visibility: incidentVisibilityEnum("visibility")
      .notNull()
      .default("public"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // The same URL may be attached to an incident only once.
    incidentUrlUnique: uniqueIndex("incident_links_incident_url_unique").on(
      t.incidentId,
      t.url,
    ),
  }),
);
