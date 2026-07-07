---
title: "Health Check Execution & Scheduling"
description: "Per-environment recurring jobs, the convergence reconciler, the event-driven rollup, and the slow-check bulkhead that keep health-check execution scale-correct."
---

Health checks run as recurring queue jobs. This page describes how those jobs
are scheduled, how the per-system rollup is kept up to date, and how the
slow-check bulkhead stops a slow or unreachable check from starving the healthy
ones.

## One recurring job per environment slice

A health-check configuration is assigned to one or more catalog systems, and
each system resolves to one or more effective environments. The unit of
execution is a single `(configuration, system, environment)` **slice**: one
recurring queue job per slice, each holding a concurrency slot only for its own
probe.

Job IDs encode the slice so the queue can dedupe them:

```ts
// core/healthcheck-backend/src/queue-executor.ts
encodeHealthCheckJobId({ configId, systemId, environmentId });
// -> "healthcheck:<config>:<system>"          (env-less slice)
// -> "healthcheck:<config>:<system>:<env>"    (per-environment slice)
```

The executor is single-environment: a tick validates its payload's
`environmentId` against the slice's *current* effective environment set and
skips stale ticks (an environment that was removed from the system since the job
was scheduled). It never fans out over environments inside one tick, so a slow
environment can never stall its siblings, and one failing environment never
gates the whole system.

> [!NOTE]
> `HealthCheckJobPayload.environmentId` is required. Recurring health-check job
> IDs are per-environment. This is an internal queue contract with no external
> package API surface.

## The convergence reconciler

Rather than imperatively scheduling and unscheduling jobs from every mutation
site, the desired job set is **reconciled** k8s-controller style
(`schedule-reconciler.ts`). The reconciler derives the desired per-slice job set
from Postgres (enabled, non-paused configurations and their assignments) joined
with catalog system membership, diffs it against what the queue currently holds,
and converges:

```ts
// pure diff, unit-tested in isolation
planReconcile({ desired, current }); // -> { toSchedule, toCancel, toReschedule }
```

- **Full reconcile** (boot): takes the `health:reconcile` advisory lock so only
  one pod converges at a time, then schedules missing slices, reschedules
  interval changes, and **cancels orphans** (jobs whose slice no longer exists,
  including old-format env-less jobs from before this change).
- **System-scoped reconcile**: after an assignment edit or a GitOps sync, only
  the affected system's slices are added or updated (no global orphan sweep).

Because the desired set is derived from durable state on every run, scheduling is
self-healing across pods and stays correct as catalog membership changes.
`run_now` bypasses the recurring set and enqueues one one-off job per effective
environment.

## The event-driven rollup

Every badge, SLO rule, and dependency-map node reads the **bare `<systemId>`
health entity** - the system rollup. Recomputing that rollup inline on every
per-environment tick would re-derive the same value once per environment per
tick. Instead a debounced consumer owns it (`rollup-consumer.ts`):

- It subscribes to per-environment health changes via `onEntityChanged` on a
  work-queue worker group, filtered to per-environment entity ids (the bare
  rollup id is skipped to avoid a feedback loop).
- It debounces by enqueuing onto a dedicated queue with a time-bucketed job id
  (`healthrollup:<systemId>:<bucket>`), so a burst of environment changes
  collapses to **one** rollup recompute per system per window.
- The recompute rebuilds the bare rollup entity and, on a status change,
  invalidates the cache and broadcasts `SYSTEM_STATUS_CHANGED`.

Notifications stay owned by the per-environment runs. The consumer never
notifies, so the system-level notification is **structurally deduplicated** - a
system going unhealthy across three environments no longer emits three rollup
notifications.

## The slow-check bulkhead

A single correlated outage - a downed host behind 60 checks, all timing out -
can pin a concurrency slot per check for the full timeout and let the backlog
climb unbounded while healthy checks wait. The bulkhead
(`slow-check-admission.ts`) prevents that.

For each slice the admission logic classifies the recent runs:

- A **healthy** slice is never gated: it always runs at the full configured
  timeout.
- A **suspect** slice (its last K runs were slow transport failures that held
  the slot ~the full timeout) is admitted to a capped, **pod-local lane**
  (single-flight per slice), and probed with an **adaptive timeout** shrunk
  toward its own healthy-latency baseline.
- When the lane is at capacity (`lane_full`) or a prior run of the same slice is
  still in flight (`in_flight`), the run is **deferred**: it records nothing and
  frees the slot immediately, incrementing
  `checkstack.healthcheck.deferred{reason}`.

The adaptive timeout has four deadlock guardrails so a check whose legitimate
runs are slow can never have its timeout shrunk below what it needs:

1. **No baseline, no shrink** - without a healthy-latency sample, run at the full
   timeout.
2. **Healthy-only baseline** - the baseline is computed from healthy runs only,
   never from the slow failures.
3. **Periodic full-timeout recovery probe** - every Nth suspect run re-probes at
   the full timeout so a recovered check is detected.
4. **Absolute floor** - the timeout never shrinks below a hard floor.

Deferral records *nothing* (no synthetic unhealthy run) so the bulkhead never
manufactures a health signal; it only decides *whether* a suspect probe runs
this tick.

### Measured effect

Scale harness (`scripts/healthcheck-scale-harness.ts`, `BULKHEAD=1`), 240
checks, 20% unreachable, concurrency 10, 5s timeout, over 35s:

| Metric                         | Bulkhead off       | Bulkhead on (lane cap 3) |
| ------------------------------ | ------------------ | ------------------------ |
| Final queue backlog            | 774 (climbing)     | 0 (bounded, draining)    |
| Completions                    | 288                | 862 (~3x)                |
| Slot-pinning timeouts          | 60                 | 12                       |
| Suspect runs deferred          | -                  | 207                      |
| p50 / p99 latency              | 4ms / 5014ms       | 4ms / 5005ms             |

With the bulkhead off the 60 slow checks pin slots and the backlog grows without
bound; with it on the backlog stays bounded, throughput roughly triples, and the
slow checks are deferred instead of starving the healthy ones. Healthy-check
latency is unchanged.

## Scale correctness

- The rollup's current state is read from durable, shared storage (the plugin's
  Postgres tables), so every pod reads the same answer.
- The suspect lane is **pod-local** infrastructure (a semaphore that gates *this*
  pod's concurrency), not a source of truth - it is bookkeeping, and deferral
  records nothing durable.
- The reconciler and rollup consumer both coordinate across pods via advisory
  locks and queue-id dedup, so N pods sharing one database converge to one
  correct job set and one rollup recompute per window.
