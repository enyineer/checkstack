---
"@checkstack/incident-backend": minor
---

Make incident automation actions fully reactive.

Only the `incident.create` action routed through the reactive `incident` entity; the `resolve`, `add_update`, and `update_status` actions called the incident service directly. Action-driven status flips therefore appended NO `entity_transitions` row, emitted NO `ENTITY_CHANGED` (so no `wait_until` woke), and fired NO `incident.resolved` / `.updated` derived trigger events — unlike the RPC router, which routes the same mutations through the entity handle.

The three actions now drive their writes through `writeIncidentEntity({ handle, incidentId, opts: { runId }, apply })` (re-reading the post-write state inside `apply` for the status-flipping actions), matching the router. As a result an action-driven resolve/status change now appends a transition, wakes suspended `wait_until` runs, and fires `incident.resolved` / `incident.updated`. The dispatch `runId` is passed so run-resolved secrets in the reactive state are masked.
