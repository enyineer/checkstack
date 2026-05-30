---
title: "Automation platform"
description: "How the plugin-extensible automation engine is structured - triggers, actions, artifacts, the dispatch lifecycle, and the extension points plugins register into."
---

The automation platform lets operators wire triggers to ordered actions with full control flow (choose / parallel / repeat / delay / wait), and lets any plugin contribute triggers, actions, and artifact types. This page is the subsystem overview; see the sensing-layer and plugin-author pages for the Wave-2 building blocks and the extension API.

## Building blocks

- **Trigger** - an entry point. Either hook-backed (subscribes to a plugin hook) or setup-backed (manages its own schedule, e.g. cron). Declares a `contextKey` extractor that scopes artifact lookups and waits to a domain entity (a system, an incident).
- **Action** - a unit of work. Renders its templated `config`, runs, and optionally `produces` a typed artifact and/or `consumes` upstream ones.
- **Artifact** - a typed payload an action produced (e.g. a Jira issue, an incident), persisted so later actions in the run - or the run that resumes after a wait - can act on it.
- **Condition** - a pre-run gate or mid-run guard. A template string, an `and` / `or` / `not` combinator, or a structured `numeric_state` / `time` / `state` variant.
- **Control flow** - `choose`, `parallel`, `repeat`, `sequence`, `delay`, `wait_for_trigger`, `wait_until`, `variables`, `stop`.

An automation's definition (triggers + conditions + actions + mode) is stored as JSON, validated by `AutomationDefinitionSchema`, and round-trips losslessly to YAML.

## Dispatch lifecycle

1. A trigger fires (a hook emission, or a setup-backed schedule tick).
2. The trigger fan-in resolves the `contextKey`, pre-resolves live state into scope (the `health.*` namespace), and evaluates the trigger `filter` and pre-run `conditions`.
3. Concurrency is applied per `mode` (single / parallel / queued / restart), scoped per `concurrency_scope` (whole automation, or per context key). The check-then-create is serialized under a transaction-scoped advisory lock keyed on `(automationId, scope)`, so two concurrent fires (or a dwell-fire racing a fresh fire, or two pods) can't both pass a `single`-mode "no active run" check and both start a run.
4. The engine walks the action tree, persisting a step row per action and a durable scope snapshot after each step.
5. Suspending actions (`delay`, `wait_for_trigger`, `wait_until`, a `for:` dwell) persist a durable lock + enqueue a wake job; the run resumes under a per-run advisory lock when the lock fires. A stalled-run sweeper is the restart-safety backstop.

Every suspend survives a process restart: the durable row is the source of truth, the queue job is just the wake signal, and resumes take an advisory lock so no run double-fires.

### Suspend / resume invariants

These guarantees keep suspended runs from being re-run or resurrected:

- **A suspended (`waiting`) run is owned by the wait-lock / queue resume paths, never the sweeper.** `findStalledRunIds` only returns `status = 'running'` runs (it joins `automation_runs`), and the suspend-finalisation does NOT clobber the run's `lastActionPath` checkpoint to `null`. Together this stops the sweeper from re-walking an intentional wait from the top (which would re-fire pre-wait side effects and leak a second wait lock).
- **Stalled recovery refuses a run that still holds a live wait lock.** `recoverStalledRun` only recovers a genuinely-`running` run with no wait lock; if a lock exists it leaves the run to the wait/resume paths and deletes nothing - so a crash-mid-wait recovery can't create a duplicate lock or duplicate delay job.
- **A cancelled / terminal run can never resume.** `resumeRun` guards on `status === 'waiting'` (mirroring `checkWaitUntil`): any other status drops the stale wait lock and returns without resuming. Cancellation (operator `cancelRun` or `restart`-mode `cancelActiveRuns`) deletes the affected runs' wait locks and run-state in the same operation, so a later trigger / delay-expiry / racing queue job can't wake a cancelled run.

## Extension points

Plugins register into these in their `register()` phase:

- `automationTriggerExtensionPoint.registerTrigger(...)`
- `automationActionExtensionPoint.registerAction(...)`
- `automationArtifactTypeExtensionPoint.registerArtifactType(...)`
- `automationFilterExtensionPoint.registerFilter(...)` - pure template filters.

The automation backend also exposes read-only service refs (`automationRegistriesRef`, `automationArtifactStoreRef`) for cross-plugin introspection and artifact lookups, and a GitOps `Automation` entity kind so automations can be declared in Git.

See the [primitives reference](/checkstack/developer-guide/backend/automations/primitives/) for the shape and a runnable YAML example of every action, trigger, and condition, [extending the automation platform](/checkstack/developer-guide/backend/automations/extending/) for the registration API, and [the sensing layer](/checkstack/developer-guide/backend/automations/sensing-layer/) for live state, duration filters, dwells, and structured conditions.
