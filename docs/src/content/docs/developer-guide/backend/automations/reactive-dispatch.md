---
title: "Reactive dispatch pipeline"
description: "The two-stage entity-change queue, the wake-index that makes wait_until reactive, the removal of polling and the template trigger, and the durability model."
---

The automation engine reacts to state changes instead of polling for them. A change to a reactive entity flows through a two-stage work-queue pipeline that routes the change to interested triggers and waiting runs, then fans execution out across instances. Suspended `wait_until` actions are woken by a wake-index rather than re-checked on a timer, so the engine scales horizontally without N pods doing N times the redundant condition evaluation. This page is the runtime contract for that pipeline; for how a plugin produces the entity changes it consumes, see [the entity state machine](/checkstack/developer-guide/backend/automations/entity-state-machine/).

## Two-stage queue

An entity mutation through an `EntityHandle` emits a single internal `ENTITY_CHANGED` hook on a real diff. From there:

| Stage | Transport | Name / group |
|-------|-----------|--------------|
| Emit | hook | `ENTITY_CHANGED` (internal to automation-backend) |
| Stage 1 - route | `onHook` work-queue | `workerGroup: "automation-entity-route"` |
| Stage 2 - dispatch | queue | `automation-dispatch`, `consumerGroup: "automation-dispatch-run"`, `maxRetries: 3` |
| Timeout | queue job | `automation-wait-timeout`, a single job armed at the deadline |

**Stage 1 (route, one instance claims).** The `ENTITY_CHANGED` event lands on a work-queue, so exactly one instance per group claims each change. The claimer does only cheap, indexed routing and never executes a run:

- **Waiting runs** - a wake-index intersection lookup finds every `kind: "until"` wait lock whose dependency set includes the changed `${kind}:${id}` ref (or the kind-level wildcard). One Stage-2 `wake` job is enqueued per matching lock.
- **Fresh-run triggers** - the change is run through the per-kind change-deriver registry to get the qualified trigger event id(s), and each id is fanned out to the enabled automations referencing it (`findEnabledByTriggerEvent`). One Stage-2 `trigger` job is enqueued per matching `(automation, event)` pair.

**Stage 2 (dispatch fan-out, any instance runs).** Each per-run job lands on the `automation-dispatch` queue; any instance picks one up. The handler routes on the job's `reason` to `dispatchTrigger` (a fresh run from a trigger match) or `resumeRun` (resume a suspended wait). Spreading per-run execution across the cluster keeps Stage 1 fast.

The Stage-1 payload is the validated `ENTITY_CHANGED`; the Stage-2 job is a discriminated union:

```ts
export const EntityChangedSchema = z.object({
  kind: z.string(),
  id: z.string(),
  prev: z.record(z.unknown()).nullable(), // null on create
  next: z.record(z.unknown()).nullable(), // null on remove (tombstone)
  delta: z.record(z.unknown()),
  changedFields: z.array(z.string()),
  actor: ActorSchema,
  occurredAt: z.string(), // ISO
});

export const DispatchJobSchema = z.discriminatedUnion("reason", [
  z.object({
    reason: z.literal("trigger"),
    automationId: z.string(),
    triggerId: z.string(),
    ref: z.string(), // `${kind}:${id}`
    changed: EntityChangedSchema,
  }),
  z.object({
    reason: z.literal("wake"),
    runId: z.string(),
    waitLockId: z.string(),
    ref: z.string(),
    changed: EntityChangedSchema,
  }),
]);
```

## Wake-index

The wake-index makes `wait_until` fully reactive. It generalizes the wait-lock lookup so a single wait can depend on a SET of refs across any kinds, with an indexed key-intersection lookup.

```ts
export const automationWakeIndex = pgTable(
  "automation_wake_index",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    waitLockId: text("wait_lock_id")
      .notNull()
      .references(() => automationWaitLocks.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(), // `${kind}:${id}`, or `${kind}:*` (wildcard)
  },
  (t) => ({
    refIdx: index("automation_wake_index_ref_idx").on(t.ref),
    lockIdx: index("automation_wake_index_lock_idx").on(t.waitLockId),
    lockRefUnique: uniqueIndex("automation_wake_index_lock_ref_unique").on(
      t.waitLockId,
      t.ref,
    ),
  }),
);
```

On suspend, the engine inserts the `automation_wait_locks` row plus one wake-index row per extracted ref, in a transaction. The Stage-1 lookup for a changed `${kind}:${id}` joins the index against the wait locks:

```sql
SELECT wl.* FROM automation_wait_locks wl
JOIN automation_wake_index wi ON wi.wait_lock_id = wl.id
WHERE wi.ref = $1 AND wl.kind = 'until';
```

A wait wakes when ANY of its refs match; the engine then re-evaluates the full condition (reading all refs from the re-enriched scope) and resumes only if it now holds.

### Reference extraction

At suspend time the engine statically walks the wait's condition and extracts the `state.*` refs it reads. Coverage:

- Structured `state` conditions read `health.systems[entity]`, yielding `health:<entity>`.
- Structured `numeric_state` conditions whose `value` is a path/template into `state.<kind>.<id>.<field>` (or back-compat `health.*`) yield `state.<kind>:<id>`.
- Template-string conditions yield a ref per member-expression rooted at `state.<kind>.<id>` or `health.systems[<id>]` / `health.system`.
- `and` / `or` / `not` combinators recurse into their operands.

When the walker sees a kind but not a concrete id (a dynamic or computed key), it records a kind-level wildcard `${kind}:*` so the wait wakes on any change of that kind and re-evaluates. When extraction is wholly indeterminate (not even a kind), the result is empty and the wait falls back to the durable timeout timer only, logged at `warn` - never silent.

## Reactive wait_until

A `wait_until` that is not already satisfied suspends with a durable `kind: "until"` wait lock carrying the condition + timeout policy, its wake-index rows, and a single durable timeout timer armed at the deadline. There is no active job and no polling while it waits.

- A relevant `ENTITY_CHANGED` wakes the run via Stage 1. The engine re-enriches scope kind-agnostically (health via the RPC client into `scope.health.*` for back-compat, plus every other `state.<kind>.<id>` ref the wait depends on resolved through each kind's `read` accessor into `scope.state.<kind>.<id>.<field>`), then synchronously re-evaluates the full condition and resumes only if it now holds.
- The single timeout timer handles the deadline - one job, not a re-check loop. On timeout the run resumes (continue) or fails per `continue_on_timeout` (default `true`).
- The stalled sweeper applies the timeout policy as a backstop if the timer job is ever lost.

> [!CAUTION]
> `wait_until` changed from interval polling to reactive wake-on-change. The semantics are preserved (it wakes when the condition becomes true and times out at the deadline), but the `poll_seconds` field is now inert - a wait is no longer re-checked on a timer. The `automation-wait-until` re-check queue and its consumer were removed, along with the sweeper's periodic `until`-lock re-tick.

## Removed: polling and the template trigger

The polling built-in `template` trigger is removed. Its real cases are covered reactively by the `numeric_state` and `state` triggers and conditions over reactive entity state. Re-author any `template` trigger as a `numeric_state` / `state` trigger or condition.

Time-driven timers are NOT polling and are kept: `delay`, the `for:` dwell, `cron` / `interval` triggers, and the wait timeout timer. They fire on a schedule rather than re-evaluating state on an interval.

## Durability model

The pipeline is at-least-once, so idempotency guards stay and crash recovery leans on the queue backend.

- **BullMQ worker tuning.** The worker sets explicit `lockDuration: 30_000`, `stalledInterval: 30_000`, and `maxStalledCount: 1`. BullMQ automatically renews the lock at `lockDuration/2` while the processor promise is pending, so no manual `extendLock` is needed. Dispatch jobs are short (one run); any `delay` / `wait` suspends and releases the job rather than blocking, so no job blocks longer than `lockDuration`. A worker that dies mid-job has its lock expire and the stalled check redelivers the job once - the crash-recovery path for in-flight dispatch work.
- **Two locks, different scopes - both retained.** The BullMQ job lock guards "one worker processes this job". The per-run Postgres advisory lock guards "one instance walks this run" across ALL wake paths (Stage-2 dispatch, the stalled sweeper, a manual run, a wake event). They are not interchangeable: a redelivered Stage-2 job after a crash plus a concurrent sweeper recovery can both target the same run, and only the advisory lock serializes them. The advisory lock stays the single serialization point for `resumeRun` / `recoverStalledRun`.
- **Suspended runs need no heartbeat.** They are durable wait-locks woken by events; there is nothing to sweep. A resume re-resolves the automation's declared secret refs so a pod that did not originally run the automation re-populates the same least-privilege output-mask set.

> [!NOTE]
> These durability seams are pinned by the env-gated integration lane (advisory-lock affinity, the dwell claim race, the wake-index ON CONFLICT race, BullMQ consumer-group exactly-once, and BullMQ stalled redelivery). See [the integration lane](/checkstack/developer-guide/testing/integration-lane/).
