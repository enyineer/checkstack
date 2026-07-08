---
"@checkstack/automation-backend": patch
---

Cut the per-event database round-trips in the automation backend's trigger
fan-out. Both live routing paths issued a full-table scan of `automations`
per event, making the plugin a top ongoing DB consumer. Behavior unchanged;
performance-only: the same automations match, in the same fan-out order, with
the same runs firing.

- Stage-1 routing (`routeEntityChange`) read enabled automations ONCE per
  derived trigger event id (`findEnabledByTriggerEvent`), so a single entity
  change deriving N event ids issued N full-table scans (an N-scans-per-change
  N+1). It now loads the enabled automations once via `listEnabled()` and
  matches every derived event id against them in memory. The outer-over-events,
  inner-over-automations fan-out order is preserved, and a change that derives
  nothing still issues zero automation reads (the Phase-5 production default).
- The hook-driven fan-in (`handleTriggerFiring`) scanned `automations` twice
  per firing: once to route fresh runs (step 2) and again in the eager
  inverse-cancel step (step 3, `cancelStaleDwells`). The step-2 result is now
  reused by step 3 — the enabled-automation set can't change between them
  (dispatching a run doesn't enable/disable automations) — halving the
  per-firing automation SELECTs.
