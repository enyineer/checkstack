---
"@checkstack/automation-backend": minor
---

Reactive two-stage dispatch pipeline + wake-index (reactive automation engine Phase 5).

The automation engine now reacts to entity-state changes through a two-stage work-queue pipeline instead of polling. State changes flow `ENTITY_CHANGED` → Stage-1 route (one instance claims) → Stage-2 dispatch fan-out (any instance runs one run).

- **Wake-index** (`automation_wake_index` child table of `automation_wait_locks`): a suspended `wait_until` records the `state.*` refs its condition reads (`${kind}:${id}`, or the kind-level wildcard `${kind}:*` when an id is dynamic), and a relevant change wakes it via an indexed intersection lookup. Reference extraction (`wake-refs.ts`) covers structured `state` / `numeric_state` conditions and template member-expressions rooted at `state.<kind>.<id>` or back-compat `health.*`; an indeterminate extraction logs at `warn` and falls back to the timeout timer only (never silent).
- **Reactive `wait_until`**: on suspend the engine inserts the wait lock + wake-index rows in a transaction and arms a single durable timeout timer at the deadline (queue `automation-wait-timeout`). A wake re-enriches scope, synchronously re-evaluates the full condition, and resumes only if it now holds. The stalled sweeper applies the timeout policy as a backstop if the timer job is lost.
- **Two-stage queues**: Stage 1 subscribes to `ENTITY_CHANGED` in work-queue mode (`workerGroup: "automation-entity-route"`) and does only indexed routing (wake-index intersection + trigger-event derivation), enqueuing per-run Stage-2 jobs onto `automation-dispatch` (`consumerGroup: "automation-dispatch-run"`, `maxRetries: 3`), which routes on `reason` to `dispatchTrigger` (trigger) or `resumeRun` (wake).
- **Entity-change → trigger-event derivation registry** (`registerChangeDeriver` on the `automation.entity` extension point): domains register a per-kind deriver mapping a change to the qualified trigger event id(s) Stage-1 routing fans out. No real domains are migrated in this phase, so production routing is a no-op until Phase 4 supplies the derivers.
- **Public `onEntityChanged({ kind, handler, delivery? })`** on the entity extension point: other plugins react to another domain's entity changes without touching the internal (unexported) `ENTITY_CHANGED` hook. Default delivery is `broadcast` (every instance); opt into `work-queue` (with a `workerGroup`) for exactly-once-per-cluster work.

BREAKING CHANGES:
- The polling `template` built-in trigger is removed. Its real cases are covered reactively by the `numeric_state` / `state` triggers + conditions. Re-author any `template` triggers as `numeric_state` / `state`.
- `wait_until` changed from interval polling to reactive wake-on-change. Semantics are preserved (wakes when the condition becomes true; times out at the deadline) but the `poll_seconds` field is now inert — a wait no longer re-checks on a timer, it is woken by a relevant `ENTITY_CHANGED` (with the durable timeout timer + sweeper as the deadline backstop).
- The `automation-wait-until` re-check queue and its consumer are removed (`wait-until-queue.ts`), along with the stalled sweeper's periodic `until`-lock re-tick. Reactive `wait_until` uses the wake-index + a single `automation-wait-timeout` timer instead.
