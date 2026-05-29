---
"@checkstack/dependency-backend": minor
---

feat(dependency): Phase 9 — triggers + create/remove actions for the Automation Platform

- Triggers `dependency.created`, `dependency.updated`, `dependency.deleted`,
  each carrying `contextKey: (p) => p.dependencyId` so `wait_for_trigger`
  resumes on the same edge.
- New hook `dependencyHooks.impactPropagated` + matching trigger
  `dependency.impact_propagated` — fires once per upstream event from
  `evaluateAndNotifyDownstream` with the list of downstream systems
  whose derived state actually moved. Carries previous/new state for
  each affected system so subscribers don't have to re-query the
  graph. Fires regardless of notification suppression, so an
  automation can react even when the user-facing notification is
  skipped. `contextKey: (p) => p.sourceSystemId`.
- Actions `dependency.create` (with cycle + duplicate-edge detection
  surfaced via the action's `error`) and `dependency.remove`. Both emit
  the matching `dependencyHooks.*` so downstream automations and caches
  react identically to RPC-driven changes.
- Artifact type `dependency.edge` for source/target/impact pass-through
  between steps.
