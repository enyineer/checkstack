---
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
---

Add per-context-key concurrency scope to automations (Phase 20 prerequisite).

A new optional `concurrency_scope: "automation" | "context_key"` field on the automation definition controls the bucket the concurrency `mode` is evaluated over:

- `automation` (default, backward-compatible): one bucket for the whole automation - `single` allows one in-flight run total, `restart` cancels every active run. Existing automations are unchanged.
- `context_key`: an independent bucket per `contextKey` (typically per system / incident) - `single` allows one in-flight run *per context key* (system A and system B run concurrently, but a second run for system A is deduped), and `restart` cancels only the active runs sharing the incoming context key.

`RunStore.hasActiveRun` / `countActiveRuns` / `cancelActiveRuns` gain an optional `contextKey` filter (the `automation_runs.context_key` column already exists, so no migration). `respectConcurrencyMode` threads the scope through. This is the primitive the default auto-incident automations need for faithful per-system deduplication.
