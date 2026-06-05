import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  primaryKey,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
