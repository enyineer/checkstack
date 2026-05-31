---
title: "Automation platform"
description: "How the plugin-extensible automation engine is structured - triggers, actions, artifacts, the dispatch lifecycle, and the extension points plugins register into."
---

The automation platform lets operators wire triggers to ordered actions with full control flow (choose / parallel / repeat / delay / wait), and lets any plugin contribute triggers, actions, and artifact types. The engine is fully reactive: each plugin makes its own domain state reactive through the `defineEntity` wrapper (the framework records change history but never owns the state), and state changes drive triggers and waiting runs through a two-stage work-queue pipeline rather than polling. This page is the subsystem overview; see the sensing-layer and plugin-author pages for the building blocks and the extension API.

## Building blocks

- **Trigger** - an entry point. Either hook-backed (subscribes to a plugin hook) or setup-backed (manages its own schedule, e.g. cron). Declares a `contextKey` extractor that scopes artifact lookups and waits to a domain entity (a system, an incident).
- **Action** - a unit of work. Renders its templated `config`, runs, and optionally `produces` a typed artifact and/or `consumes` upstream ones.
- **Artifact** - a typed payload an action produced (e.g. a Jira issue, an incident), persisted so later actions in the run - or the run that resumes after a wait - can act on it.
- **Condition** - a pre-run gate or mid-run guard. A template string, an `and` / `or` / `not` combinator, or a structured `numeric_state` / `time` / `state` variant.
- **Control flow** - `choose`, `parallel`, `repeat`, `sequence`, `delay`, `wait_for_trigger`, `wait_until`, `variables`, `stop`.

An automation's definition (triggers + conditions + actions + mode) is stored as JSON, validated by `AutomationDefinitionSchema`, and round-trips losslessly to YAML.

## Dispatch lifecycle

1. A trigger fires - a setup-backed schedule tick, or a reactive entity change. A change to a domain's [entity state](/checkstack/developer-guide/backend/automations/entity-state-machine/) is routed through the [two-stage dispatch pipeline](/checkstack/developer-guide/backend/automations/reactive-dispatch/): Stage 1 (one instance claims) derives the qualified trigger event id(s) and the waiting runs to wake, and Stage 2 fans a per-run job out across instances.
2. The trigger fan-in resolves the `contextKey`, pre-resolves live state into scope (the `state.<kind>.<id>` namespace, with `health.*` kept as a back-compat alias), and evaluates the trigger `filter` and pre-run `conditions`.
3. Concurrency is applied per `mode` (single / parallel / queued / restart), scoped per `concurrency_scope` (whole automation, or per context key). The check-then-create is serialized under a transaction-scoped advisory lock keyed on `(automationId, scope)`, so two concurrent fires (or a dwell-fire racing a fresh fire, or two pods) can't both pass a `single`-mode "no active run" check and both start a run.
4. The engine walks the action tree, persisting a step row per action and a durable scope snapshot after each step.
5. Suspending actions persist a durable lock; the run resumes under a per-run advisory lock when woken. `delay` / `wait_for_trigger` / a `for:` dwell enqueue a wake job (or wait for a matching event); a reactive `wait_until` records wake-index rows and a single timeout timer instead, and is woken by a relevant entity change. A stalled-run sweeper is the restart-safety backstop.

Every suspend survives a process restart: the durable row is the source of truth, the queue job is just the wake signal, and resumes take an advisory lock so no run double-fires.

### Suspend / resume invariants

These guarantees keep suspended runs from being re-run or resurrected:

- **A suspended (`waiting`) run is owned by the wait-lock / queue resume paths, never the sweeper.** `findStalledRunIds` only returns `status = 'running'` runs (it joins `automation_runs`), and the suspend-finalisation does NOT clobber the run's `lastActionPath` checkpoint to `null`. Together this stops the sweeper from re-walking an intentional wait from the top (which would re-fire pre-wait side effects and leak a second wait lock).
- **Stalled recovery refuses a run that still holds a live wait lock.** `recoverStalledRun` only recovers a genuinely-`running` run with no wait lock; if a lock exists it leaves the run to the wait/resume paths and deletes nothing - so a crash-mid-wait recovery can't create a duplicate lock or duplicate delay job.
- **A cancelled / terminal run can never resume.** `resumeRun` guards on `status === 'waiting'` (mirroring `checkWaitUntil`): any other status drops the stale wait lock and returns without resuming. Cancellation (operator `cancelRun` or `restart`-mode `cancelActiveRuns`) deletes the affected runs' wait locks and run-state in the same operation, so a later trigger / delay-expiry / racing queue job can't wake a cancelled run.
- **A run resuming on a different pod re-seeds its output-mask set.** The run-wide secret-masking registry is in-memory and per-process, so a pod that did not originally run a suspended automation starts with an empty mask set. Before walking or persisting, both `resumeRun` and `recoverStalledRun` re-resolve the automation's declared secret refs (the `secretEnv` mappings and `connectionId` references in its action configs) through the run's wrapped `getService` (which auto-registers each resolved value), so the resuming pod re-populates the same least-privilege, by-value mask set. Without this, a carried-over scope value / artifact / error persisted on the new pod could leak a credential resolved on the original pod.

## Extension points

Plugins register into these in their `register()` phase:

- `automationTriggerExtensionPoint.registerTrigger(...)`
- `automationActionExtensionPoint.registerAction(...)`
- `automationArtifactTypeExtensionPoint.registerArtifactType(...)`
- `automationFilterExtensionPoint.registerFilter(...)` - pure template filters.
- `entityExtensionPoint.defineEntity(...)` / `declareNonReactiveState(...)` / `onEntityChanged(...)` / `registerChangeDeriver(...)` - declare reactive entity state and react to cross-plugin changes. See [the entity state machine](/checkstack/developer-guide/backend/automations/entity-state-machine/).

The automation backend also exposes read-only service refs (`automationRegistriesRef`, `automationArtifactStoreRef`) for cross-plugin introspection and artifact lookups, and a GitOps `Automation` entity kind so automations can be declared in Git.

See the [primitives reference](/checkstack/developer-guide/backend/automations/primitives/) for the shape and a runnable YAML example of every action, trigger, and condition, [extending the automation platform](/checkstack/developer-guide/backend/automations/extending/) for the registration API, [the sensing layer](/checkstack/developer-guide/backend/automations/sensing-layer/) for live state, duration filters, dwells, and structured conditions, [the entity state machine](/checkstack/developer-guide/backend/automations/entity-state-machine/) for exposing reactive state, and [the reactive dispatch pipeline](/checkstack/developer-guide/backend/automations/reactive-dispatch/) for how a state change becomes a run.
