import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Legacy webhook subscriptions table.
 *
 * Kept in the schema (and DB) so the one-time data migration in
 * `@checkstack/automation-backend` can read existing rows and convert
 * them to automations. Once Automation Platform consumers have all
 * been migrated and at least one release has shipped without
 * regressions, a follow-up PR will drop this table along with the
 * schema entry.
 *
 * The `delivery_logs` table is also retained in the database for the
 * same reason but no longer modelled here — nothing in the platform
 * reads or writes it.
 */
export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  providerId: text("provider_id").notNull(),
  providerConfig: jsonb("provider_config")
    .notNull()
    .$type<Record<string, unknown>>(),
  eventId: text("event_id").notNull(),
  systemFilter: text("system_filter").array(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
