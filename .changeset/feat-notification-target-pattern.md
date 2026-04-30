---
"@checkstack/notification-common": major
"@checkstack/notification-backend": major
"@checkstack/notification-frontend": minor
"@checkstack/catalog-common": major
"@checkstack/catalog-backend": major
"@checkstack/catalog-frontend": minor
"@checkstack/anomaly-common": major
"@checkstack/anomaly-backend": major
"@checkstack/anomaly-frontend": minor
"@checkstack/incident-common": major
"@checkstack/incident-backend": major
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-common": major
"@checkstack/maintenance-backend": major
"@checkstack/maintenance-frontend": minor
"@checkstack/healthcheck-common": major
"@checkstack/healthcheck-backend": major
"@checkstack/dependency-common": major
"@checkstack/dependency-backend": major
"@checkstack/backend-api": minor
"@checkstack/backend": minor
---

feat: notification target pattern + per-spec subscriptions

Replaces the all-or-nothing catalog system/group notification model with a
platform-level target pattern. Each notification-emitting plugin declares
*subscription specs* against typed *target* objects exported from the
target's owning plugin (catalog ships `catalogSystemTarget` and
`catalogGroupTarget`). Notification-backend handles every per-resource
group lifecycle, parent-edge inheritance, and legacy-subscription seeding
— plugins never author groupId helpers, lifecycle hooks, or migration
code again.

**Plugin-author surface area is now ~12 lines per emitter:**

```ts
// <plugin>-common
const { defineSubscription } = createSubscriptionFactory(pluginMetadata);
export const fooSystemSubscription = defineSubscription({
  localId: "system",
  target: catalogSystemTarget,
  display: { title: "Foo Alerts", description: "...", iconName: "Bell" },
});

// <plugin>-backend register()
env.registerSubscriptionSpecs([fooSystemSubscription]);
//   ^ feeds the plugin loader's dependency sorter — each spec's
//     target.ownerPlugin becomes an implicit init-order dep, so this
//     plugin automatically waits for catalog (the target owner) to
//     finish init + afterPluginsReady before its own runs.

// <plugin>-backend afterPluginsReady
await notificationClient.registerSubscriptionSpec(
  specToRegistration(fooSystemSubscription),
);
// dispatch
await notificationClient.notifyForSubscription({
  specId: fooSystemSubscription.specId,
  resourceKeys: [systemId],
  title, body, importance, action, collapseKey, subjects,
});

// <plugin>-frontend
createNotificationSubscriptionExtension({ spec: fooSystemSubscription });
```

**Migrated plugins**: anomaly, incident, maintenance, healthcheck,
dependency. Each lost its bespoke `notification-groups.ts`,
`bootstrap*NotificationGroups`, `ensure*Group`, and inheritance walk —
all of that is now centralized in notification-backend's
`subscription-engine`.

**Plugin loader change** (`@checkstack/backend-api`,
`@checkstack/backend`): the register-time API gains
`env.registerSubscriptionSpecs([...specs])`. The dependency sorter
walks `spec.target.ownerPlugin` for every declared spec and adds the
target owner as an init-order dependency of the emitting plugin. This
guarantees that catalog (the owner of the platform's `system` and
`group` targets) completes init + afterPluginsReady before any
emitting plugin tries to register its specs against the notification
service — no string-prefix heuristics, no manual `dependsOnPlugins`
list, no stub rows. Plugins that fail to declare their specs at
register time get a clear `Target type X is not registered. Did the
emitting plugin declare this spec via env.registerSubscriptionSpecs?`
error from the dispatcher.

**Removed** (no backwards compat):
- `catalogClient.notifySystemSubscribers` and
  `catalogClient.notifyManySystemSubscribers`
- `notificationClient.notifyUsers` and `notificationClient.notifyGroups`
  as direct dispatch primitives — replaced by spec-bound
  `notifyForSubscription`
- catalog's `bootstrapNotificationGroups` (replaced by
  `bootstrapNotificationTargets`)

**Enforcement**: the dispatcher rejects calls referencing unregistered
specIds, specs owned by other plugins, or resourceKeys that haven't been
pushed via `upsertNotificationResource`. Display metadata for any
groupId is recoverable via the spec registry, so audit lists render
correct labels even when an emitter's frontend isn't loaded.

**Per-field anomaly mute** keeps working — it now lives inside the
generic SubscriptionRow's optional `SubControls` panel
(`AnomalyFieldMuteList`), exposed through the catalog system detail
page's notifications card.

The catalog system detail page renders a "Notifications" card hosting
`SystemNotificationSubscriptionsSlot`. The matching group surface is
not yet rendered — group-level subscriptions are wired end-to-end on
the backend; a follow-up will add the host UI.

**Migration of existing subscribers**: target types declare a
`legacyGroupIdTemplate`; on first registration of each spec,
notification-backend reads subscribers from the legacy
`catalog.system.<id>` / `catalog.group.<id>` groups and seeds the new
spec groups exactly once per (spec × resource) pair, tracked in
`subscription_migrations`. Anomaly stays opt-in (its target also
declares the template, but the user-explicit nature of the original
opt-in flow means the seeding produces the same set of subscribers
they already had).
