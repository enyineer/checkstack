import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  json,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Enums
export const contactTypeEnum = pgEnum("contact_type", ["user", "mailbox"]);

// Tables use pgTable (schemaless) - runtime schema is set via search_path
export const systems = pgTable(
  "systems",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    metadata: json("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // System names are unique. Enforced at the DB so a concurrent double-create
    // cannot slip two systems with the same name past the service-layer check.
    nameUnique: uniqueIndex("systems_name_unique").on(t.name),
  }),
);

export const systemContacts = pgTable(
  "system_contacts",
  {
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
  },
  (t) => ({
    // A given user, or a given mailbox email, may be attached to a system only
    // once. NULLs are distinct in Postgres btree, so the two partial keys don't
    // interfere: user contacts (email NULL) are deduped by (system, user) and
    // mailbox contacts (userId NULL) by (system, email).
    systemUserUnique: uniqueIndex("system_contacts_system_user_unique").on(
      t.systemId,
      t.userId,
    ),
    systemEmailUnique: uniqueIndex("system_contacts_system_email_unique").on(
      t.systemId,
      t.email,
    ),
  }),
);

export const groups = pgTable(
  "groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),

    metadata: json("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Group names are unique (consistent with systems.name), enforced at the DB
    // so a concurrent double-create cannot slip two same-named groups past the
    // service-layer check.
    nameUnique: uniqueIndex("groups_name_unique").on(t.name),
  }),
);

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

/**
 * Instance-wide environments. A sibling of `groups`: a free-form set of
 * custom fields (baseUrl, region, tier, ...) that any system can belong to
 * many-to-many. `metadata` reuses the same json+default({}) precedent as
 * systems.metadata / groups.metadata; its values surface in templating
 * verbatim. Unlike `groups`, environments carry a `description` (matching
 * `systems`).
 */
export const environments = pgTable(
  "environments",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    metadata: json("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Environment names are unique (consistent with systems.name / groups.name).
    nameUnique: uniqueIndex("environments_name_unique").on(t.name),
  }),
);

export const systemsEnvironments = pgTable(
  "systems_environments",
  {
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey(t.systemId, t.environmentId),
  }),
);

/**
 * Free-form hotlinks attached to a system — e.g. Jira board, dashboard URL,
 * runbook. Sits alongside contacts but is purely URL-based, no user/email.
 */
export const systemLinks = pgTable(
  "system_links",
  {
    id: text("id").primaryKey(),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    label: text("label"),
    url: text("url").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // The same URL may be attached to a system only once.
    systemUrlUnique: uniqueIndex("system_links_system_url_unique").on(
      t.systemId,
      t.url,
    ),
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
