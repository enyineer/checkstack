import {
  pgTable,
  pgEnum,
  text,
  boolean,
  uuid,
  timestamp,
  jsonb,
  primaryKey,
  index,
  integer,
} from "drizzle-orm/pg-core";
import type {
  NotificationAction,
  NotificationSubject,
} from "@checkstack/notification-common";

// User notifications table
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(), // No FK - cross-schema limitation
    title: text("title").notNull(),
    /** Notification body content (supports markdown) */
    body: text("body").notNull(),
    /** Single primary action button */
    action: jsonb("action").$type<NotificationAction | null>(),
    importance: text("importance").notNull().default("info"), // 'info' | 'warning' | 'critical'
    isRead: boolean("is_read").notNull().default(false),
    /**
     * Collapse key shared by related notifications. Notifications with the
     * same (userId, collapseKey) collapse into one card on the frontend.
     * Examples: "incident.incident.<id>", "healthcheck.healthcheck.<id>".
     * Distinct from `notification_groups.id` (which is a subscription target).
     * Kept as `group_id` at the column level for backwards compatibility; the
     * TypeScript field name reflects its true purpose.
     */
    collapseKey: text("group_id"),
    /**
     * Affected entities. Each renders as a chip (in-app) or a link (in
     * notification strategies). When `action` is null, these are the only
     * navigation paths; when present, they supplement the primary CTA.
     */
    subjects: jsonb("subjects").$type<NotificationSubject[] | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userCollapseIdx: index("notifications_user_collapse_idx").on(
      t.userId,
      t.collapseKey,
    ),
    userCreatedIdx: index("notifications_user_created_idx").on(
      t.userId,
      t.createdAt,
    ),
  }),
);

// Notification groups (created by plugins)
// ID is namespaced: "pluginId.groupName"
export const notificationGroups = pgTable("notification_groups", {
  id: text("id").primaryKey(), // Namespaced: "pluginId.groupName"
  name: text("name").notNull(),
  description: text("description").notNull(),
  ownerPlugin: text("owner_plugin").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User-group subscriptions
export const notificationSubscriptions = pgTable(
  "notification_subscriptions",
  {
    userId: text("user_id").notNull(),
    groupId: text("group_id")
      .notNull()
      .references(() => notificationGroups.id, { onDelete: "cascade" }),
    subscribedAt: timestamp("subscribed_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.groupId] }),
  })
);

// Note: User notification preferences are now stored via ConfigService
// using the user-pref.{userId}.{strategyId} pattern for automatic
// secret encryption of OAuth tokens.

/**
 * Notification target type registry. Owned by a plugin (catalog owns
 * `catalog.system` and `catalog.group`). The owner pushes resource
 * lifecycle events to notification-backend; the backend uses this
 * registry to route subscription specs to known resources and to walk
 * parent inheritance during dispatch.
 */
export const notificationTargets = pgTable("notification_targets", {
  targetTypeId: text("target_type_id").primaryKey(),
  ownerPlugin: text("owner_plugin").notNull(),
  resourceKind: text("resource_kind").notNull(),
  parentTargetTypeId: text("parent_target_type_id"),
  /**
   * Template the backend substitutes `{resourceKey}` into to compute
   * the legacy groupId for migration. Null means no legacy migration.
   */
  legacyGroupIdTemplate: text("legacy_group_id_template"),
  registeredAt: timestamp("registered_at").defaultNow().notNull(),
});

/**
 * Resources of a target type. Pushed by the target owner whenever a
 * resource is created or renamed; removed on deletion. notification-
 * backend keeps a notification group materialized for every
 * (registered spec × resource) pair derived from this table.
 */
export const notificationResources = pgTable(
  "notification_resources",
  {
    targetTypeId: text("target_type_id")
      .notNull()
      .references(() => notificationTargets.targetTypeId, {
        onDelete: "cascade",
      }),
    resourceKey: text("resource_key").notNull(),
    displayLabel: text("display_label").notNull(),
    upsertedAt: timestamp("upserted_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.targetTypeId, t.resourceKey] }),
  }),
);

/**
 * Parent edges between resources. Populated by target owners via
 * `setNotificationResourceParents` (catalog calls it on
 * addSystemToGroup / removeSystemFromGroup / system create). Read at
 * dispatch time to compute inherited group ids.
 */
export const notificationResourceParents = pgTable(
  "notification_resource_parents",
  {
    childTargetTypeId: text("child_target_type_id").notNull(),
    childResourceKey: text("child_resource_key").notNull(),
    parentTargetTypeId: text("parent_target_type_id").notNull(),
    parentResourceKey: text("parent_resource_key").notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [
        t.childTargetTypeId,
        t.childResourceKey,
        t.parentTargetTypeId,
        t.parentResourceKey,
      ],
    }),
    childIdx: index("notification_resource_parents_child_idx").on(
      t.childTargetTypeId,
      t.childResourceKey,
    ),
  }),
);

/**
 * Subscription-spec registry. Every dispatch must reference a specId
 * that exists here, owned by the calling plugin. notification-backend
 * provisions one notification group per (spec × resource) pair where
 * `resource.targetTypeId == spec.targetTypeId`.
 */
export const subscriptionSpecs = pgTable(
  "subscription_specs",
  {
    specId: text("spec_id").primaryKey(),
    ownerPlugin: text("owner_plugin").notNull(),
    localId: text("local_id").notNull(),
    targetTypeId: text("target_type_id")
      .notNull()
      .references(() => notificationTargets.targetTypeId),
    displayTitle: text("display_title").notNull(),
    displayDescription: text("display_description").notNull(),
    displayIconName: text("display_icon_name"),
    registeredAt: timestamp("registered_at").defaultNow().notNull(),
  },
  (t) => ({
    ownerTargetIdx: index("subscription_specs_owner_target_idx").on(
      t.ownerPlugin,
      t.targetTypeId,
    ),
  }),
);

/**
 * Tracks which legacy notification groups have already been migrated
 * for a given (spec × resource) pair. Set after the one-shot seeding
 * runs so re-registering a spec doesn't re-seed (which would silently
 * resubscribe users who deliberately unsubscribed).
 */
export const subscriptionMigrations = pgTable(
  "subscription_migrations",
  {
    specId: text("spec_id").notNull(),
    resourceKey: text("resource_key").notNull(),
    migratedAt: timestamp("migrated_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.specId, t.resourceKey] }),
  }),
);

/**
 * Status enum for per-channel delivery attempts. Each attempted send
 * via an external delivery strategy resolves to exactly one of these
 * states. Visibility-only — retries are NOT implemented yet (deferred
 * to v1.1); a failure here is a final, surfaced outcome admins can
 * action manually.
 */
export const notificationDeliveryStatusEnum = pgEnum(
  "notification_delivery_status",
  ["success", "failure"],
);

/**
 * Per-channel delivery attempt log. Written best-effort by the dispatch
 * loop on every `strategy.send(...)` call (success or failure). Surfaces
 * silent external-delivery failures to admins so they can detect a
 * misconfigured webhook / dead channel without grepping logs.
 *
 * - `notificationId` cascades on delete so retention sweeps that drop
 *   notifications also drop their attempt rows.
 * - `errorMessage` MUST flow through `extractErrorMessage` so secrets
 *   embedded in raw error objects (webhook URLs, tokens) are not
 *   persisted verbatim.
 * - `durationMs` captures wall-clock time of the `send()` call only —
 *   not contact resolution or config loading.
 */
export const notificationDeliveryAttempts = pgTable(
  "notification_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    /** Qualified strategy id, e.g. `notification-discord.send`. */
    strategyQualifiedId: text("strategy_qualified_id").notNull(),
    attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
    status: notificationDeliveryStatusEnum("status").notNull(),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms").notNull(),
  },
  (t) => ({
    notificationIdx: index("notification_delivery_attempts_notification_idx").on(
      t.notificationId,
    ),
    attemptedAtIdx: index("notification_delivery_attempts_attempted_at_idx").on(
      t.attemptedAt,
    ),
  }),
);
