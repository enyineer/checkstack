---
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
"@checkstack/automation-frontend": minor
"@checkstack/integration-script-backend": minor
---

feat(automation): expose `trigger.id` and reconcile the trigger scope so multiple triggers are distinguishable

Automations with more than one trigger could not tell which trigger fired:
the trigger id wasn't queryable, and scripts only received `trigger.event`
(so two triggers on the same event were indistinguishable). This exposes a
consistent trigger contract everywhere - `trigger.id`, `trigger.event`,
`trigger.actor`, `trigger.payload` - in templates, shell, and TypeScript
scripts.

- **`trigger.id` is now available** in templates (`{{ trigger.id }}`) and in
  the script context (`context.trigger.id`). It is typed as the **literal
  union** of the automation's trigger ids, so it discriminates triggers -
  including two subscribed to the same `event`.
- **Auto-generated trigger ids.** The editor now assigns a unique, log-
  friendly id to every trigger (derived from its event, e.g.
  `incident_created`, deduped as `incident_created_2`), mirroring action ids:
  seeded on the starter automation, assigned on add, and re-filled on blur.
- **Scripts now receive `trigger.id` and `trigger.actor`.** The
  `ActionRunScope` projection previously dropped both (it only forwarded
  `event` + `payload`), so `context.trigger.actor` was typed but never
  populated - that gap is fixed.
- **Scope key reconciled.** The internal dispatch scope now exposes
  `trigger.event` as the canonical key (matching the editor and script
  contract) instead of leaking `trigger.eventId`; `trigger.eventId` is kept
  as a back-compat alias, so `{{ trigger.event }}` now resolves in template
  fields where it previously returned `undefined`.

No database migration: the actor and id ride in the run scope snapshot. A
shared `deriveTriggerId` is exported from `@checkstack/automation-common` so
the editor, generated script types, and the runtime all agree on derived ids.
