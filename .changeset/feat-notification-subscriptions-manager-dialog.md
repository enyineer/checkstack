---
"@checkstack/notification-frontend": minor
"@checkstack/notification-common": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-frontend": minor
"@checkstack/dashboard-frontend": minor
"@checkstack/anomaly-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-frontend": minor
---

feat: unified notification-subscription manager dialog driven by spec registry

Replaces the bell-toggle UX (which only managed a single legacy
catalog group) with a modal that lists every notification type
registered against a target — system or group — and exposes both
per-type toggles and a bulk "Subscribe to all / Unsubscribe from all"
action. Both surfaces (system detail page header bell, dashboard group
header bell) now open the same `NotificationSubscriptionsManager`
component.

**Key change vs. the prior slot-based approach**: rows are now driven
by `notificationClient.listSubscriptionSpecs` — the backend's spec
registry is the single source of truth. Previously, a row only
appeared if a frontend plugin had remembered to register a
`createNotificationSubscriptionExtension`; this caused silent drift
(healthcheck and dependency registered backend specs without frontend
extensions, so the dialog counted them but never rendered rows). Now,
every spec the platform knows about renders a row using the spec's
`display` metadata (title, description, iconName resolved via
`DynamicIcon`).

**Sub-controls registry** (`@checkstack/notification-frontend`):
plugins that want sub-granularity (anomaly's per-field mute list,
future severity / channel filters) call
`registerSubscriptionSubControls(spec, Component)` at module load —
the manager looks the component up by `specId` when expanding a row.

**Removed (no compat)**:
- `createNotificationSubscriptionExtension` (replaced by the
  spec-driven manager + the SubControls registry)
- `target.slot` field on `NotificationTarget` and the
  `NotificationTargetInput.slot` parameter on
  `defineNotificationTarget`
- `SystemNotificationSubscriptionsSlot` and
  `GroupNotificationSubscriptionsSlot` from `@checkstack/catalog-common`
- `SystemNotificationsCard` from the system detail page's main column
- `SubscribeButton` wiring on dashboard group cards and the system
  detail page header

**Migrated frontends**: anomaly (now registers `AnomalyFieldMuteList`
via the SubControls registry), incident, maintenance — all dropped
their `createNotificationSubscriptionExtension` calls. healthcheck and
dependency now show up automatically via the spec registry — no
frontend changes needed for them to render.

The trigger button reflects aggregate state — filled bell when at
least one spec is subscribed for the resource, ghost bell when none.
