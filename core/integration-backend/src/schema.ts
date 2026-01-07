import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";

/**
 * Webhook subscriptions - admin-configured routing rules
 */
export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),

  /** Fully qualified provider ID: {pluginId}.{providerId} */
  providerId: text("provider_id").notNull(),

  /** Provider-specific configuration (encrypted if contains secrets) */
  providerConfig: jsonb("provider_config")
    .notNull()
    .$type<Record<string, unknown>>(),

  /** Single event to subscribe to (fully qualified event ID) */
  eventId: text("event_id").notNull(),

  /** Optional: Filter by system IDs */
  systemFilter: text("system_filter").array(),

  /** Subscription enabled state */
  enabled: boolean("enabled").notNull().default(true),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Delivery logs - track webhook delivery attempts and results
 */
export const deliveryLogs = pgTable("delivery_logs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  subscriptionId: text("subscription_id")
    .notNull()
    .references(() => webhookSubscriptions.id, { onDelete: "cascade" }),

  eventType: text("event_type").notNull(),
  eventPayload: jsonb("event_payload")
    .notNull()
    .$type<Record<string, unknown>>(),

  /** Delivery status: pending, success, failed, retrying */
  status: text("status")
    .notNull()
    .$type<"pending" | "success" | "failed" | "retrying">(),

  /** Number of delivery attempts */
  attempts: integer("attempts").notNull().default(0),

  /** Timestamp of last delivery attempt */
  lastAttemptAt: timestamp("last_attempt_at"),

  /** Next retry timestamp (if status is retrying) */
  nextRetryAt: timestamp("next_retry_at"),

  /** External ID returned by the target system (e.g., Jira issue key) */
  externalId: text("external_id"),

  /** Error message from last failed attempt */
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});
