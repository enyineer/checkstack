---
"@checkstack/incident-backend": minor
---

Migrate incidents to the reactive `incident` entity + rewire the catalog consumer (reactive automation engine Phase 4, §10.1).

Incident now defines an `incident` entity `{ status, severity, systemIds }` keyed by incident id through the `automation.entity` extension point and mirrors it at every router mutation site (`createIncident`, `updateIncident`, `addUpdate`, `resolveIncident`, `deleteIncident` tombstone, `createAutoIncident`, `resolveAutoIncident`). A change → trigger-event deriver reproduces the existing qualified events:

- create (`prev === null`) → `incident.created`
- transition to `resolved` → `incident.resolved`
- any other field change → `incident.updated`
- delete (tombstone) → no event (there is no `incident.deleted` trigger)

The catalog `system.deleted` consumer switched from `onHook(catalogHooks.systemDeleted)` to `onEntityChanged({ kind: "catalog-system" })` filtered to tombstones (`change.next === null`), keeping `work-queue` delivery (association cleanup must run once per cluster).

BREAKING CHANGES:
- The `incident.created` / `incident.updated` / `incident.resolved` cross-plugin hooks (the `createHook` descriptors) are removed. Incident lifecycle is now the reactive `incident` entity; the matching trigger events still fire (via the entity change deriver), so existing automations on `incident.created/.updated/.resolved` and external event-routing (e.g. the Jira integration's `incident.created` event type) keep working. No in-repo plugin subscribed to the removed hooks via `onHook`.
- The `addUpdate`-with-status=resolved path previously emitted BOTH `incident.updated` and `incident.resolved`; it now fires only `incident.resolved` (the deriver classifies a transition-to-resolved as a resolution). Automations meant to react to a resolution should use the `incident.resolved` trigger, not `incident.updated`.
- Incidents created/resolved via the `incident.create` / `incident.resolve` automation ACTIONS are not mirrored into the entity (those actions never emitted lifecycle hooks before either), preserving the prior behavior where action-driven incidents did not fire cross-plugin lifecycle events.
