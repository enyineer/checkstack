---
"@checkstack/healthcheck-backend": minor
"@checkstack/backend-api": patch
---

Rework health-check scheduling to one recurring job per
`(configuration, system, environment)` slice and add a slow-check bulkhead so a
slow or unreachable check can no longer starve the healthy ones.

Previously a single recurring job per `(configuration, system)` fanned out over
every environment sequentially inside one tick, so the job held a concurrency
slot for the sum of all its environments, and a slow environment stalled its
siblings. Now each environment slice is its own recurring job that holds a slot
only for its own probe. A convergence reconciler (k8s-controller style) derives
the desired per-env job set from Postgres + catalog membership and converges the
queue toward it (schedule missing, cancel orphans, reschedule interval changes),
so it is self-healing across pods and stays correct as catalog membership
changes. It runs at boot, and system-scoped after an assignment or GitOps
change. `run_now` enqueues one one-off job per effective environment.

The system rollup (the bare `<systemId>` health entity every badge, SLO rule and
dependency map reads) is recomputed by an event-driven, debounced consumer that
subscribes to per-environment health changes and recomputes once per system per
window, instead of inline on every tick. Notifications stay owned by the
per-environment runs, so the rollup notification is structurally deduplicated.

The bulkhead classifies each slice's recent runs: a slice whose last K runs were
slow transport failures (held its slot ~the full timeout) is admitted to a
capped, pod-local lane (single-flight per slice) and probed with a timeout shrunk
toward its own healthy-latency baseline, or DEFERRED (recording nothing, freeing
the slot) when the lane is full or a prior run is still in flight. The adaptive
timeout has four deadlock guardrails: no baseline means no shrink, the baseline
uses only healthy runs, every Nth suspect run re-probes at the full timeout, and
an absolute floor. A healthy slice is never gated and always runs at the full
timeout. A new `checkstack.healthcheck.deferred{reason}` counter records
bulkhead deferrals.

Measured with the scale harness (240 checks, 20% unreachable, concurrency 10, 5s
timeout, 35s): with the bulkhead off the queue backlog climbs unbounded to 774
while 60 slow checks pin slots; with it on the backlog stays bounded (drains to
0), completions roughly triple (288 → 862), and slot-pinning timeouts drop
(60 → 12) as 207 suspect runs are deferred.

BREAKING CHANGE: the internal `HealthCheckJobPayload` now requires an
`environmentId` field and recurring health-check job IDs are per-environment
(`healthcheck:<config>:<system>[:<env>]`). This is an internal queue contract
with no external package API surface; on upgrade the reconciler cancels the
old-format jobs and schedules the per-environment set at boot.
