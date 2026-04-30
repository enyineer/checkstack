/**
 * Notification target types — the platform abstraction that lets emitting
 * plugins declare *what kind of resource* their subscriptions are about
 * without dealing with notification-group lifecycle themselves.
 *
 * A target type ("system", "group", future kinds…) is owned by exactly
 * one plugin. The owner:
 *   1. Defines + exports the target object via `defineNotificationTarget`.
 *   2. Tells notification-backend about every resource of this type that
 *      exists (`upsertNotificationResource` on creation/rename,
 *      `removeNotificationResource` on deletion).
 *   3. Renders an extension slot on the resource's detail page so emitting
 *      plugins can drop their subscription rows in.
 *
 * notification-backend does the rest:
 *   - Materializes one notification group per (registered spec × known
 *     resource), keyed `<emitterPluginId>.<spec.localId>.<resourceKey>`.
 *   - Provisions/cleans up these groups automatically as resources and
 *     specs come and go.
 *   - At dispatch time, resolves spec + resourceKey(s) into the actual
 *     group ids (primary + inherited via the target's `parents` chain),
 *     unions subscribers, and delivers.
 *
 * Emitting plugins (anomaly, incident, maintenance, healthcheck, …) stop
 * carrying their own per-system / per-group lifecycle — they reference
 * a target object and supply display metadata. Convention-driven, typed,
 * and centralized.
 */

interface PluginMetadataLike {
  pluginId: string;
}

/**
 * Declarative parent reference. The target owner declares what type
 * its parent resources have ("catalogSystemTarget's parents are
 * catalogGroupTarget"); the actual parent edges live in
 * notification-backend's `notification_resource_parents` table and are
 * kept in sync by the target owner via `setNotificationResourceParents`
 * (called whenever a child's parent set changes — e.g. addSystemToGroup
 * in catalog).
 *
 * No callback at dispatch time — notification-backend reads the edges
 * from its own DB. Keeps dispatch fully server-local.
 */
export interface NotificationTargetParents {
  targetTypeId: string;
}

/**
 * Backwards-compatibility hook. If users were already subscribed to a
 * legacy notification group (e.g. catalog's pre-pattern
 * `catalog.system.<id>` group), the target type declares the template.
 * notification-backend substitutes `{resourceKey}` and seeds new spec
 * groups from the legacy group's subscribers — exactly once per
 * (spec × resource) pair, tracked in `subscription_migrations`.
 *
 * Encoded as a string so the backend can run it without a callback to
 * the target owner.
 */
export interface NotificationTargetLegacyMigration {
  /** e.g. `"catalog.system.{resourceKey}"`. */
  legacyGroupIdTemplate: string;
}

/**
 * The on-disk representation of a known resource. Plugins owning a
 * target type push these to notification-backend; the backend persists
 * them so the audit/settings UI can render display labels and dispatch
 * can iterate resources without round-tripping the owner.
 */
export interface NotificationTargetResourceRecord {
  /** Stable id within the target type. */
  resourceKey: string;
  /** Human-friendly label shown in subscription UIs. */
  displayLabel: string;
}

/**
 * The full shape of a notification target. Plugins consume this via
 * named imports and reference it from their subscription specs — never
 * by string id.
 */
export interface NotificationTarget<TResource> {
  /** `<ownerPluginId>.<localId>` — namespacing prevents collisions. */
  readonly targetTypeId: string;
  readonly ownerPlugin: string;
  readonly localId: string;
  readonly resourceKind: string;
  /** Pulls the stable key out of a resource shape — used everywhere. */
  keyOf(resource: TResource): string;
  /**
   * Pulls a human-friendly label out of a resource shape — used for
   * upsertNotificationResource calls and the settings audit page.
   */
  labelOf(resource: TResource): string;
  /** Optional parent target. Edges populated via setNotificationResourceParents. */
  readonly parents?: NotificationTargetParents;
  /** Optional legacy-migration declaration. Read once at startup. */
  readonly legacy?: NotificationTargetLegacyMigration;
}

/**
 * Plugin-bound input to `defineNotificationTarget`. The plugin author
 * supplies a *local* id; the factory namespaces it with the plugin's
 * id, mirroring `createSubscriptionFactory` and the existing
 * `createCollapseKeyBuilder` pattern.
 */
export interface NotificationTargetInput<TResource> {
  pluginMetadata: PluginMetadataLike;
  localId: string;
  resourceKind: string;
  keyOf: NotificationTarget<TResource>["keyOf"];
  labelOf: NotificationTarget<TResource>["labelOf"];
  parents?: NotificationTargetParents;
  legacy?: NotificationTargetLegacyMigration;
}

export function defineNotificationTarget<TResource>(
  input: NotificationTargetInput<TResource>,
): NotificationTarget<TResource> {
  if (input.localId.includes(".")) {
    throw new Error(
      `Notification target localId must not contain '.', got ${JSON.stringify(input.localId)}`,
    );
  }
  return {
    targetTypeId: `${input.pluginMetadata.pluginId}.${input.localId}`,
    ownerPlugin: input.pluginMetadata.pluginId,
    localId: input.localId,
    resourceKind: input.resourceKind,
    keyOf: input.keyOf,
    labelOf: input.labelOf,
    parents: input.parents,
    legacy: input.legacy,
  };
}

/**
 * Wire-format used when a target owner registers its target type with
 * notification-backend on startup. Excludes the live functions
 * (`keyOf` / `labelOf` / `parents.resolve` / `legacy.legacyGroupIdFor`)
 * because those run in the owner's process — backend only stores
 * metadata.
 */
export interface RegisteredNotificationTargetRecord {
  targetTypeId: string;
  ownerPlugin: string;
  resourceKind: string;
  parentTargetTypeId?: string;
  legacyGroupIdTemplate?: string;
}

export function targetToRegistration<TResource>(
  target: NotificationTarget<TResource>,
): RegisteredNotificationTargetRecord {
  return {
    targetTypeId: target.targetTypeId,
    ownerPlugin: target.ownerPlugin,
    resourceKind: target.resourceKind,
    parentTargetTypeId: target.parents?.targetTypeId,
    legacyGroupIdTemplate: target.legacy?.legacyGroupIdTemplate,
  };
}
