import {
  pgTable,
  text,
  timestamp,
  json,
  primaryKey,
} from "drizzle-orm/pg-core";

export const systems = pgTable("systems", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  owner: text("owner"), // user_id or group_id reference? Keeping as text for now.
  status: text("status").notNull().default("healthy"), // healthy, degraded, unhealthy
  metadata: json("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),

  metadata: json("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const systemsGroups = pgTable(
  "systems_groups",
  {
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey(t.systemId, t.groupId),
  })
);

export const views = pgTable("views", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  configuration: json("configuration").default([]).notNull(), // List of group_ids to show
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Incidents can be linked to a system or a group (polymorphic-ish, or just FKs)
// "Add incidents for systems or system groups"
export const incidents = pgTable("incidents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull(), // investigating, identified, monitoring, resolved
  severity: text("severity").notNull(), // major, minor, etc.

  // Optional links
  systemId: text("system_id").references(() => systems.id, {
    onDelete: "set null",
  }),
  groupId: text("group_id").references(() => groups.id, {
    onDelete: "set null",
  }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const maintenances = pgTable("maintenances", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull(), // imminent, in_progress, completed

  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),

  // Optional links
  systemId: text("system_id").references(() => systems.id, {
    onDelete: "set null",
  }),
  groupId: text("group_id").references(() => groups.id, {
    onDelete: "set null",
  }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
