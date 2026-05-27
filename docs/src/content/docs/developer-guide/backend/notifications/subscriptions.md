---
title: "Notification Subscriptions"
description: "Cross-plugin subscription pattern. The notification platform owns every groupId convention, lifecycle, and dispatch resolution; plugins declare what they emit and for which kind of resource, then c…"
---

Cross-plugin subscription pattern. The notification platform owns every
groupId convention, lifecycle, and dispatch resolution; plugins
declare *what* they emit and *for which kind of resource*, then call a
single dispatch RPC.

## The model

Three first-class objects:

1. **Notification target** — a typed handle on a *kind of resource*
   (catalog system, catalog group, future SLO objective, …). Owned by
   exactly one plugin (the resource's source of truth) and exported
   from that plugin's common package.

2. **Subscription spec** — a description of one *kind of subscription*
   a plugin offers for the resources of a given target. Carries
   display metadata; the groupId convention is derived
   (`<spec.ownerPlugin>.<spec.localId>.<resourceKey>`).

3. **Resource record** — pushed by the target's owner whenever a
   resource appears, is renamed, or disappears. notification-backend
   persists these and uses them to materialize one notification group
   per (registered spec × known resource) automatically.

Plus a fourth, optional object:

4. **Resource parent edges** — declared by the target's owner via
   `setNotificationResourceParents`. The dispatcher reads them at
   notification time to compute inherited group ids without callbacks
   to the owner.

## Author a target type

```ts
// catalog-common
export const catalogSystemTarget = defineNotificationTarget<{
  systemId: string;
  systemName: string;
}>({
  pluginMetadata,                        // namespacing
  localId: "system",                     // → targetTypeId: "catalog.system"
  resourceKind: "system",
  keyOf: ({ systemId }) => systemId,
  labelOf: ({ systemName }) => systemName,
  parents: { targetTypeId: "catalog.group" },        // optional
  legacy: { legacyGroupIdTemplate: "catalog.system.{resourceKey}" },
});
```

The target owner is responsible for keeping the resource registry in
sync:

```ts
// on resource creation/rename:
await notificationClient.upsertNotificationResource({
  targetTypeId: catalogSystemTarget.targetTypeId,
  resource: { resourceKey: system.id, displayLabel: system.name },
});

// on parent membership changes:
await notificationClient.setNotificationResourceParents({
  childTargetTypeId: catalogSystemTarget.targetTypeId,
  childResourceKey: systemId,
  parents: parentGroupIds.map(groupId => ({
    parentTargetTypeId: catalogGroupTarget.targetTypeId,
    parentResourceKey: groupId,
  })),
});

// on resource deletion:
await notificationClient.removeNotificationResource({
  targetTypeId: catalogSystemTarget.targetTypeId,
  resourceKey: systemId,
});
```

Catalog does this from `createSystem` / `updateSystem` / `deleteSystem`
/ `addSystemToGroup` / `removeSystemFromGroup`, and from a startup
`bootstrapNotificationTargets` that re-pushes everything for crash
recovery.

## Author a subscription spec

Pure data, no React, no lifecycle code:

```ts
// anomaly-common
const { defineSubscription } = createSubscriptionFactory(pluginMetadata);

export const anomalySystemSubscription = defineSubscription({
  localId: "system",
  target: catalogSystemTarget,
  display: {
    title: "Anomaly Detection",
    description: "Spike and drift alerts for this system's metrics.",
    iconName: "Activity",
  },
});
```

### Declare specs at register time

In your plugin's `register()` block, declare every spec you intend to
register at runtime. This is what feeds the plugin loader's
dependency sorter:

```ts
register(env) {
  env.registerSubscriptionSpecs([
    anomalySystemSubscription,
    anomalyGroupSubscription,
  ]);
  // ...
}
```

The loader walks each spec's `target.ownerPlugin` and adds an
init-order edge from the target owner to the emitting plugin. For
catalog-owned targets that means catalog finishes both init *and*
afterPluginsReady before any emitting plugin runs them — so by the
time the emitter calls `registerSubscriptionSpec` over RPC, the
target type is already in the registry. No manual `dependsOnPlugins`
list, no string parsing, no stub rows.

If a plugin forgets to declare its specs at register time, the
dispatcher returns a `Target type X is not registered. Did the
emitting plugin declare this spec via env.registerSubscriptionSpecs?`
error pointing right at the missing declaration.

### Register at runtime

Then in `afterPluginsReady`:

```ts
await notificationClient.registerSubscriptionSpec(
  specToRegistration(anomalySystemSubscription),
);
```

notification-backend joins the spec against every resource of
`anomalySystemSubscription.target.targetTypeId` and provisions a
notification group per pair on the spot. If the target declared a
legacy migration, subscribers of the legacy group are seeded onto the
new group exactly once per (spec × resource), tracked in
`subscription_migrations`.

## Dispatch

```ts
await notificationClient.notifyForSubscription({
  specId: anomalySystemSubscription.specId,
  resourceKeys: [systemId],
  excludeUserIds: Array.from(mutedUserIds),    // optional
  title, body, importance, action, collapseKey, subjects,
});
```

notification-backend resolves:

1. Primary group id per resourceKey: `<plugin>.<spec>.<key>`
2. Inherited group ids: walks `notification_resource_parents`, finds
   same-plugin specs targeting parent target types, derives their
   group ids
3. Unions subscribers across all of the above
4. Removes `excludeUserIds`
5. Delivers via in-app + external channels

Enforcement:
- Spec must be registered.
- Spec's `ownerPlugin` must equal the calling service's `pluginId`.
- Every `resourceKey` must be a registered resource of the spec's
  target.

The dispatcher will reject calls that violate any of these.

## Frontend

The frontend renders no per-spec rows in plugin code. Every host
surface — system detail page, dashboard group cards, future SLO pages
— mounts a single component:

```tsx
<NotificationSubscriptionsManager
  target={catalogSystemTarget}
  resource={{ systemId, systemName }}
/>
```

Inside, the dialog calls `notificationClient.listSubscriptionSpecs`,
filters by `target.targetTypeId`, and renders one row per registered
spec using the spec's `display` metadata (title, description,
iconName). The spec registry — populated server-side from each
plugin's `registerSubscriptionSpec` call — is the **single source of
truth** for which notification types exist. A plugin that registers a
backend spec automatically gets a row in every host surface; no
frontend extension to remember.

A bulk "Subscribe to all / Unsubscribe from all" toolbar at the top of
the dialog operates on the same set of groupIds.

### Sub-controls (optional)

Specs that want sub-granularity (anomaly's per-field mute list, future
severity/channel filters) register a React component once at module
load:

```ts
// anomaly-frontend
registerSubscriptionSubControls(
  anomalySystemSubscription,
  AnomalyFieldMuteList,
);
```

The manager looks up the component by `specId` and renders it inline
beneath the row when the user expands "Details". This is the only
React most plugins write — and only when sub-granularity is needed.

## Why this design

- **No groupId strings in plugin code.** Authoring a spec means
  picking a localId and a target object; everything else is derived.
  Renames of a target's pluginId propagate; typos in the namespace
  are impossible.
- **Init-order is derived, not authored.** The plugin loader reads
  each declared spec's `target.ownerPlugin` and orders the emitter
  after the owner automatically. Adding a new emitter against an
  existing target type is zero coordination work; switching a spec
  to a different target type re-derives the dep on next start.
- **Lifecycle is centralized.** Every plugin used to ship its own
  `notification-groups.ts` with `ensure*` / `delete*` / `bootstrap*`
  helpers — ~200 lines duplicated four times. All of it now lives in
  `subscription-engine.ts`.
- **Inheritance walks once, server-side.** The dispatch path used to
  contain a `for (const sid of systemIds) { await
  catalogClient.getSystemGroups(...) }` loop in incident, maintenance,
  and healthcheck. notification-backend now reads from
  `notification_resource_parents` directly and resolves all
  inheritance in one query.
- **Enforced display metadata.** The dispatcher validates every
  spec/resource at delivery time; the audit/settings UI joins
  groupIds against the spec registry to produce correct labels even
  for plugins whose frontend isn't loaded.
- **Spec registry drives the UI.** The subscription manager dialog
  reads `listSubscriptionSpecs` instead of relying on each plugin
  to register a frontend slot extension. A plugin that registers a
  backend spec automatically gets a row in every host surface — no
  parallel frontend wiring to forget, no silent drift between the
  spec registry and what the dialog renders.
- **Open for extension.** A new plugin defining its own target type
  works without notification-backend changes. SLO could declare
  `slo.objective` tomorrow and emitting plugins could register specs
  against it.

## Existing target types

| Target            | Owner    | Resource shape                       | Parents          |
|-------------------|----------|--------------------------------------|------------------|
| `catalog.system`  | catalog  | `{ systemId, systemName }`           | `catalog.group`  |
| `catalog.group`   | catalog  | `{ groupId, groupName }`             | —                |

## Existing subscription specs

| Spec                  | Owner        | Target           | Sub-controls        |
|-----------------------|--------------|------------------|---------------------|
| `anomaly.system`      | anomaly      | `catalog.system` | per-field mute list |
| `anomaly.group`       | anomaly      | `catalog.group`  | —                   |
| `incident.system`     | incident     | `catalog.system` | —                   |
| `incident.group`      | incident     | `catalog.group`  | —                   |
| `maintenance.system`  | maintenance  | `catalog.system` | —                   |
| `maintenance.group`   | maintenance  | `catalog.group`  | —                   |
| `healthcheck.system`  | healthcheck  | `catalog.system` | —                   |
| `healthcheck.group`   | healthcheck  | `catalog.group`  | —                   |
| `dependency.system`   | dependency   | `catalog.system` | —                   |
| `dependency.group`    | dependency   | `catalog.group`  | —                   |
