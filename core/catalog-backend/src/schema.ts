import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  json,
  primaryKey,
} from "drizzle-orm/pg-core";

// Enums
export const contactTypeEnum = pgEnum("contact_type", ["user", "mailbox"]);

// Tables use pgTable (schemaless) - runtime schema is set via search_path
export const systems = pgTable("systems", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  metadata: json("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const systemContacts = pgTable("system_contacts", {
  id: text("id").primaryKey(),
  systemId: text("system_id")
    .notNull()
    .references(() => systems.id, { onDelete: "cascade" }),
  type: contactTypeEnum("type").notNull(),
  // For type="user": userId references auth user
  userId: text("user_id"),
  // For type="mailbox": store email directly
  email: text("email"),
  // Optional label for display (e.g., "On-Call", "Team Lead")
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  }),
);

export const views = pgTable("views", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  configuration: json("configuration").default([]).notNull(), // List of group_ids to show
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
