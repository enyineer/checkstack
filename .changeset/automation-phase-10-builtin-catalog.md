---
"@checkstack/automation-backend": minor
---

feat(automation): Phase 10 — built-in triggers + actions

Ships the core automation catalog every install has out of the box:

**Triggers** (setup-backed via the shared
`automation-builtin-triggers` queue):

- `automation.cron` — recurring queue job on a cron pattern. Config:
  `{ cronPattern }`. Payload: `{ firedAt }`.
- `automation.interval` — recurring queue job on a fixed interval.
  Config: `{ intervalSeconds }`. `startDelay = intervalSeconds` so an
  operator doesn't see a tick the instant they save the automation.
- `automation.template` — polls a boolean template at `intervalSeconds`
  cadence and fires on the false → true edge. Uses
  `template-engine.evaluateBoolean` with `{ now }` in scope; invalid
  templates throw at setup so the operator sees the error in the
  editor rather than as silently-never-firing.

All three share a single consumer + module-scoped `tickHandlers` map
keyed by jobId. Restart semantics work the same way regardless of the
queue backend: `setupTriggerSubscriptions` re-runs every enabled
automation's `setup()` in `afterPluginsReady` on every boot, and
`setup()` calls `scheduleRecurring(...)` with a deterministic jobId.
On a persistent queue (BullMQ/Redis), the second call is an in-place
update of the surviving recurring job. On the in-memory queue — whose
recurring-schedule map is wiped at shutdown — it re-creates the
schedule from scratch. Either way the schedule is back in place
before the consumer would dispatch.

**Actions**:

- `automation.log` — write a single line to the run logger at the
  requested level (debug/info/warn/error). No artifact, no external
  delivery — the cheapest "I want to see something happened here"
  primitive, useful inside `choose` / `parallel` branches as a no-op
  placeholder until the operator wires the real action.
- `automation.notify_user` — thin wrapper over
  `NotificationApi.sendTransactional` so the core install has a
  "notify a user" action without depending on the integration-
  notification plugin. Produces `automation.notify_user_result`
  (per-strategy outcome).

The built-in catalog is registered directly via the trigger/action
registries in `init()` — no extension-point round-trip needed, since
automation-backend owns the registry. Pulls in
`@checkstack/notification-common` as a runtime dep for the
service-mode RPC call.
