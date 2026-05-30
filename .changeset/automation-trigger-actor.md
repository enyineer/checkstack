---
"@checkstack/common": minor
"@checkstack/backend-api": minor
"@checkstack/backend": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
"@checkstack/automation-frontend": minor
---

feat(automation): expose `trigger.actor` so automations can filter on who/what caused an event

Every platform event now carries an **actor** - the user, application (API
client), service (backend-to-backend), or `system` (background /
unauthenticated) that caused it - and the automation engine surfaces it to
automations as `trigger.actor`. This lets a trigger filter gate on the
origin of the event it reacts to:

```text
{{ trigger.actor.type == "system" }}      # auto-created by the platform
{{ trigger.actor.type == "user" }}         # a human
{{ trigger.actor.id == "app-deploybot" }}  # a specific application
```

`trigger.actor` is available on **every** trigger - it is injected by the
platform, not declared per trigger - and editor autocomplete + Run Script
context types include `trigger.actor.{type,id,name}`.

How it works:

- **`@checkstack/common`** adds the canonical `Actor` type / `ActorSchema`
  and `SYSTEM_ACTOR`.
- **`@checkstack/backend-api`** adds `resolveActor(user)` and a
  `HookEventMeta` envelope. The hook listener / `onHook` signature gains an
  optional second `meta` argument (additive, backward compatible).
- **`@checkstack/backend`** wraps emitted hooks in an envelope so the actor
  travels with the payload through the distributed queue, unwrapping it
  before delivery. The RPC emit path captures the authenticated caller;
  background emits default to the system actor. Raw/legacy queue data is
  treated as a system-actor payload, so delivery stays backward compatible.
- **`@checkstack/automation-backend`** threads the actor into the dispatch
  scope (`trigger.actor`), available to trigger filters, top-level
  conditions, and all run templates, and persisted in the run's scope
  snapshot. Manual runs are attributed to the invoking user.
- **`@checkstack/automation-common`** / **`@checkstack/automation-frontend`**
  expose `trigger.actor` in the editor variable scope and the generated
  Run Script `context.trigger.actor` types.

No database migration and no per-trigger schema changes: the actor rides as
event-envelope metadata and in the run scope snapshot.
