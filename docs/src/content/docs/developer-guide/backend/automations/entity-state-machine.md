---
title: "Entity state machine"
description: "Expose a plugin's domain state as a reactive entity with defineEntity, the non-reactive escape hatch, cross-plugin change subscriptions, and change derivers."
---

The entity state machine is the framework primitive every plugin uses to make its domain state reactive. `defineEntity` is a reactive WRAPPER: it owns NO current-state storage of its own. Each plugin keeps its state where it already lives (its own table, an in-memory map, or a computed aggregate) and supplies a `read` accessor; every reactive-state write goes through the single `handle.mutate` entry point, which snapshots the previous state via `read`, runs the plugin's own write, and records the change. One `defineEntity` declaration replaces an ad-hoc change hook, a current-state query helper, and the since/duration bookkeeping that domains used to reimplement on their own - without duplicating the state itself. The automation engine consumes the resulting reactive surface for trigger routing, condition scope, and reactive waits, so state declared this way is automatically visible to automations and state declared off-pattern is structurally invisible to them. This page is the plugin-author guide; for the queue/wake machinery the change events drive, see [the reactive dispatch pipeline](/checkstack/developer-guide/backend/automations/reactive-dispatch/).

## Design principle: no state duplication

The framework NEVER owns a plugin's current state. There is no framework-managed mirror table that domains copy their state into. Instead:

- The plugin owns its current state - in its own durable table, or a value computed on the fly from its own durable tables. It exposes that state through a required batched `read` accessor. EVERY kind is plugin-backed: there is no framework-owned current-state storage and no "homeless" kind that falls back to a generic framework table.
- The framework owns only the change HISTORY. For every kind, on every real change, it appends field-level rows to its own `entity_transitions` table. This history is always platform-kept, so even a compute-on-read kind like `health` gets durable transition history.
- All reactive-state writes go through one driven entry point - `handle.mutate({ id, apply })`. The handle snapshots `prev` via `read` before the write, runs the plugin's `apply` (the real write against the plugin's own storage), then diffs and records the transition.

A kind's `read` resolves one of two ways, both plugin-backed:

- **Plugin-table-backed** - the reactive subset is projected straight off the plugin's own table(s). Incident, maintenance, catalog (system + group), and dependency all read this way.
- **Compute-on-read** - the reactive subset has no stored status row at all; it is derived on demand from the plugin's own durable data. The per-system `health` aggregate, the `slo` budget/streak view, and `satellite-connection` (status computed from `last_heartbeat_at`) compute this way, so there is no second materialized copy to drift from the source or get stuck after a pod crash.

## When to use defineEntity vs the escape hatch

Default to `defineEntity` for anything that is genuinely mutable domain state an operator might want to react to: an incident's status, a maintenance window, a system's aggregate health, a dependency edge, a satellite's connection, an SLO budget. The reactive path is the path of least resistance and the only one automations can see.

Reach for the escape hatch (`declareNonReactiveState`) only for data that looks like state but intentionally is not a reactive entity. There are four allowed reasons:

- `raw-sample` - high-frequency, high-cardinality samples (e.g. individual `health_check_runs`). The aggregate is the entity; a firehose of raw rows would melt the wake-index. Raw samples can still be a `numeric_state` wake source without being an entity.
- `sensitive` - secret values, which must never enter reactive scope or change events. The metadata may be an entity; the value is excluded.
- `externally-owned` - state we cannot observe without polling (a live Jira issue status). Model the artifact you created, not a pretend-live entity.
- `bookkeeping` - internal operational data: cursors, caches, heartbeat timestamps (e.g. `satellites.lastHeartbeatAt`, the dependency propagation cursor).

```ts
import { entityExtensionPoint } from "@checkstack/automation-backend";

const entity = env.getExtensionPoint(entityExtensionPoint);
entity.declareNonReactiveState({
  table: "health_check_runs",
  reason: "raw-sample",
  note: "Aggregate health is the entity; raw runs are a numeric_state wake source only.",
});
```

> [!NOTE]
> The declaration is consumed by the `no-unmanaged-entity-state` lint rule, which flags `createHook`-based change-ish emits and direct writes to a migrated domain's former state column. Declaring the table suppresses the false positive. The lint rule informs at the project's chosen severity; it is not escalated to an error.

## Defining an entity

Resolve the `automation.entity` extension point and call `defineEntity` with a globally-unique `kind`, a zod object describing the reactive state, and the required `read` accessor that points at wherever the plugin already keeps that state. The zod schema is the single source of truth for typing, validation, scope projection, and the change-event shape, so it MUST be a `z.object`. The call returns a typed `EntityHandle` you keep on your service and mutate through.

```ts
import { z } from "zod";
import {
  entityExtensionPoint,
  type EntityHandle,
} from "@checkstack/automation-backend";

export const INCIDENT_ENTITY_KIND = "incident";

export const IncidentEntityStateSchema = z.object({
  status: z.enum(["open", "acknowledged", "resolved"]),
  severity: z.enum(["warning", "critical"]),
  systemIds: z.array(z.string()),
});
export type IncidentEntityState = z.infer<typeof IncidentEntityStateSchema>;

let incidentEntity: EntityHandle<IncidentEntityState> | undefined;

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    const entity = env.getExtensionPoint(entityExtensionPoint);
    incidentEntity = entity.defineEntity<IncidentEntityState>({
      kind: INCIDENT_ENTITY_KIND,
      state: IncidentEntityStateSchema,
      // PLUGIN-BACKED: read straight from the incident service's own tables.
      // There is no framework copy of this state.
      read: (ids) => incidentService.getManyEntityStates(ids),
    });
    // ...
  },
});
```

automation-backend registers the extension-point impl in its `register()` phase, so other plugins can resolve it and call `defineEntity` during their own `register()` or `init()`; cross-plugin calls are Proxy-buffered until the impl registers. Declare the entity in `register()` (as above) or in `init()` once your service and DB deps exist - whichever fits your plugin's wiring. Keep the returned handle on your service and call it from every site that mutates your state and used to emit an ad-hoc hook.

A malformed registration hard-fails the loader at startup: a non-`z.object` state, a missing or duplicate `kind`, or a missing / non-function `read`.

### The handle

`EntityHandle<TState>` is the only typed path to reactive state. All writes go through `mutate` / `remove`; there is no `set` / `patch`:

```ts
interface EntityHandle<TState extends Record<string, unknown>> {
  readonly kind: string;
  mutate(input: {
    id: string;
    opts?: EntityMutationOpts;
    apply: () => Promise<TState>;
  }): Promise<TState>;
  remove(input: {
    id: string;
    opts?: EntityMutationOpts;
    apply: () => Promise<void>;
  }): Promise<void>;
  get(id: string): Promise<TState | undefined>;
  getMany(ids: ReadonlyArray<string>): Promise<Record<string, TState>>;
  inStateSince(id: string, field: keyof TState & string): Promise<Date | null>;
  inStateForMs(id: string, field: keyof TState & string): Promise<number>;
  transitionCount(args: { id: string; field: keyof TState & string; windowMs: number }): Promise<number>;
}
```

- `mutate` is the single driven write. It snapshots `prev` via the kind's `read` accessor BEFORE the write, runs your `apply` (the REAL write against your own storage, committed in your own transaction, returning the resulting state as `next`), then validates `next` against the kind's zod object, structurally diffs `prev` against `next`, appends the field-level transition rows, and emits a single change event - all only on a real diff. An unchanged write is a no-op (no event, no wake, no transition row). A throwing `apply` records nothing and emits nothing: the plugin write is the source of truth.
- `remove` is the tombstone counterpart. Its `apply` performs the plugin's delete and returns void; the handle records the tombstone transition and emits a tombstone change event (`next === null`).
- `get` / `getMany` route to your `read` accessor; they are also the resolvers the engine uses for scope pre-resolution and wake re-evaluation.
- `inStateSince` / `inStateForMs` / `transitionCount` read the per-field transition log, generalizing the health-transition log to any entity.

`EntityMutationOpts` carries the mutating `actor` (defaults to the system actor; travels on the change event so automations read `trigger.actor`) and an optional `runId`. When the mutation originates inside a dispatch run, pass `runId` so the recorded `prev` / `next` are run through the run-secret mask - secret values must never enter reactive scope or change events.

A typical `mutate` call wraps the plugin's own write:

```ts
// Inside the incident service, after computing the new state:
await incidentEntity.mutate({
  id: incidentId,
  // `apply` does the REAL incidents/junction write in the plugin's own tx and
  // returns the resulting reactive subset. The framework snapshots `prev` via
  // `read`, diffs, records the transition, and emits the change.
  apply: async () => {
    const incident = await this.persistIncident(incidentId, input);
    return {
      status: incident.status,
      severity: incident.severity,
      systemIds: incident.systemIds,
    };
  },
});
```

> [!IMPORTANT]
> The plugin write is authoritative. A plugin-backed kind keeps its state in its own schema, behind its own database client - a different client than the framework's `entity_transitions`. The two cannot share one transaction, so `apply` runs and commits first, and the transition log is appended afterwards in the framework's own transaction. If that append fails after a committed plugin write, the plugin state is still correct and only one history row is missing (a gap, never a corruption). This decoupling is deliberate: a plugin platform must not couple a plugin's storage to a framework-internal table's transaction.

### Compute-on-read kinds

A kind whose reactive subset has no stored row of its own - it is derivable from the plugin's own durable data - computes it on read instead of materializing a copy. The `read` accessor recomputes the view from the same tables the rest of the plugin already reads; `handle.mutate` snapshots `prev` through that same `read` before the write, so a real change still produces exactly one correct `ENTITY_CHANGED`.

The per-system `health` aggregate is the canonical example. It has no domain table and no framework storage; its `read` derives `{ status, healthyChecks, totalChecks }` on demand from `health_check_runs` (via `getSystemHealthStatus`), gated on the system having at least one enabled check association. A system with an enabled check but no runs yet resolves to the same default-`healthy` baseline the executor reads, so a first-ever run that comes up unhealthy is a real `healthy -> degraded` diff (not a suppressed create):

```ts
import { z } from "zod";
import { entityExtensionPoint, type EntityRead } from "@checkstack/automation-backend";

const HealthEntityStateSchema = z.object({
  status: HealthCheckStatusSchema,
  healthyChecks: z.number().int().nonnegative(),
  totalChecks: z.number().int().nonnegative(),
});

// COMPUTE-ON-READ: no stored row. Derive the view from the durable
// health_check_runs the rest of the plugin reads. The entity resolves iff the
// system has at least one ENABLED check association; a run-less system with an
// enabled check resolves to the default-`healthy` baseline (the executor's
// pre-run state), so a first-ever unhealthy run is a real healthy -> degraded
// diff rather than a suppressed create.
const read: EntityRead<HealthEntityState> = async (ids) => {
  const out: Record<string, HealthEntityState> = {};
  await Promise.all(ids.map(async (systemId) => {
    const overview = await service.getSystemHealthStatus(systemId);
    // No enabled check associations => no health entity for this system.
    if (overview.checkStatuses.length === 0) return;
    out[systemId] = {
      status: overview.status,
      healthyChecks: overview.checkStatuses.filter((c) => c.status === "healthy").length,
      totalChecks: overview.checkStatuses.length,
    };
  }));
  return out;
};

const handle = entity.defineEntity<HealthEntityState>({
  kind: "health",
  state: HealthEntityStateSchema,
  read,
});

// At every evaluation-write site, `apply` does the REAL durable write (insert
// the run + bump the aggregate) and returns the freshly-computed view. The
// framework snapshots `prev` via `read` BEFORE the run is persisted, so the
// diff and the emitted change are correct.
await handle.mutate({
  id: systemId,
  apply: async () => {
    await persistRunAndAggregate(systemId, result);
    return (await read([systemId]))[systemId]!;
  },
});
```

> [!IMPORTANT]
> A COMPUTE-ON-READ kind whose state can be evaluated by more than one pod at once must serialize the snapshot-`prev` + `apply` + diff + emit per entity id. Without a lock, two concurrent evaluations of one id both snapshot the same `prev`, both write, and both diff the same transition - emitting two `ENTITY_CHANGED` (and two transition rows) for one logical change. The `health` kind wraps each system's `handle.mutate` in a transaction-scoped advisory lock keyed `health:<systemId>` (`withXactLock` from `@checkstack/backend-api`), so concurrent per-config jobs across pods (or at-least-once redelivery) collapse to exactly one emit.

The `slo` entity computes the same way: its `budgetRemainingPercent` is a pure function of the objective's append-only downtime history, so the `read` recomputes it via the SLO engine rather than storing a second copy.

### Compute-on-read status with a pod-local live socket

A kind can compute its status on read AND still keep some genuinely pod-local infrastructure - as long as that infrastructure is never the queryable source of truth. The `satellite-connection` entity is the canonical example. Its `status` is COMPUTED on read from the single durable liveness column `satellites.last_heartbeat_at` (via the same `computeStatus(lastHeartbeatAt)` the admin list uses), so it is globally consistent from any pod AND self-heals: a row left marked `connected` by a crashed pod reads `offline` once its heartbeat ages past the threshold, with no stored status copy that could get stuck `online`. The only extra durable column is `last_connection_event` (the deriver's `connected` / `disconnected` / `heartbeat_lost` discriminator); `lastSeenAt` is derived from `last_heartbeat_at`:

```ts
const read: EntityRead<SatelliteConnectionState> = (ids) =>
  service.getManyConnectionStates(ids); // computes status from last_heartbeat_at

const handle = entity.defineEntity<SatelliteConnectionState>({
  kind: "satellite-connection",
  state: satelliteConnectionStateSchema,
  read,
});

// Each lifecycle edge writes the durable liveness inputs through `apply`:
//  - connect:    last_heartbeat_at = now,  last_connection_event = "connected"
//  - disconnect: last_heartbeat_at = null, last_connection_event = "disconnected"
//  - heartbeat-lost (the monitor, from ANY pod): flips ONLY the event to
//    "heartbeat_lost" - idempotent, since once flipped re-runs are no-ops.
await handle.mutate({
  id: satelliteId,
  apply: () => service.applyConnectionState({ satelliteId, lastEvent, lastHeartbeatAt }),
});
```

The heartbeat monitor detects the online->offline edge from DURABLE state alone - it reads every satellite's `(last_heartbeat_at, last_connection_event)`, computes status, and fires `heartbeat_lost` for any that is `offline` while still marked `connected`. This works on whichever pod claims the check job, with NO pod-local baseline, fixing a defect where a pod with an empty in-memory map never observed the satellite online and so left the status stuck `online` after a crash. The in-process WebSocket registry still exists, but ONLY as the pod-local live-socket map used to route messages to a connection physically held by THIS pod; it is never read as the entity's state. Mark it `declareNonReactiveState({ reason: "bookkeeping" })`. This is exactly the distinction the [horizontal-scale rule](#horizontal-scale) draws: the durable, computed-on-read status is the entity, the socket map is pod-local bookkeeping.

## Horizontal scale

The platform runs as N pods sharing one database, so a reactive entity's current state MUST be globally readable. Scope enrichment and `wait_until` re-evaluation run on whichever pod claims the dispatch/wake job, so a `read` that resolves from process-local memory returns a value written on pod A as invisible to pod B - the automation then reads stale or empty state. This is a real bug even when the single-process test suite passes (a value written in one process is trivially visible to the same process).

The rule, the guard, and the test:

- **Rule.** [State management & horizontal scale](https://github.com/enyineer/checkstack/blob/main/.agent/rules/state-and-scale.md) is the principle: a reactive entity's `read` MUST resolve from shared, durable storage (the plugin's own Postgres tables, or a derivation of them), never from process-local memory. In-memory is allowed only for genuinely pod-local infrastructure that is never the queryable source of truth (a live-socket registry), marked `declareNonReactiveState`.
- **Lint.** The `checkstack/no-pod-local-entity-state` ESLint rule is a forcing-function tripwire at the `defineEntity({ read })` boundary: it flags a `read` that reads a `Map`/`Set` or calls `.get`/`.has` on an in-memory structure, and warns (`needsAssertion`) when it cannot confirm durability so the author asserts it with a reason. It is wired at `warn`, never escalated to an error.
- **Integration test.** `cross-pod-read-consistency.it.test.ts` is the deterministic backstop the single-process suite cannot provide. It models two pods as two registries over two connections pointed at the same database, and asserts a write driven on pod A is visible to pod B's `read` for a durable kind (with a pod-local kind as a negative control that proves the test has teeth).

> [!IMPORTANT]
> Working triggers do NOT prove the read path is scale-correct. Entity change events propagate cluster-wide via the event bus, so `onEntityChanged` consumers and trigger routing fire correctly even when the current-state read is pod-local and broken. Verify the read path separately.

## Cross-plugin change subscriptions

To react to ANOTHER domain's entity changes, use `onEntityChanged` from the same extension point. The internal `ENTITY_CHANGED` hook is deliberately unexported, so `defineEntity` stays the only typed path that emits a change and `onEntityChanged` is the typed, validated path that consumes one. The handler receives the validated `{ kind, id, prev, next, delta, changedFields, actor, occurredAt }`.

```ts
import { entityExtensionPoint } from "@checkstack/automation-backend";
import { CATALOG_SYSTEM_ENTITY_KIND } from "@checkstack/catalog-backend";

const entity = env.getExtensionPoint(entityExtensionPoint);

// Clean up dependency edges when a catalog system is deleted.
entity.onEntityChanged({
  kind: CATALOG_SYSTEM_ENTITY_KIND,
  handler: async (change) => {
    if (change.next !== null) return; // tombstones only
    await service.removeSystemDependencies(change.id);
  },
  delivery: { mode: "work-queue", workerGroup: "dependency-system-cleanup" },
});
```

### Delivery semantics

Pick the delivery mode by what the handler does:

- `broadcast` (default) - every instance's handler runs for every change. Correct for reactors that maintain per-instance state: an in-memory cache to invalidate, a local fan-out, a websocket push.
- `work-queue` - exactly one instance in the cluster runs the handler per change (load-balanced, retried). Correct for side-effecting work that must happen once per change: writing a derived row, enqueuing a notification, cleaning up associations. Requires a `workerGroup` so distinct subscribers do not share a claim.

> [!NOTE]
> The default is `broadcast` because its failure mode (every instance reacts) is merely redundant work, whereas a wrong `work-queue` grouping silently drops a reactor's delivery on all but one instance - a far worse default for a cross-plugin API. Choose `work-queue` deliberately for once-per-change side effects.

Subscriptions are registered eagerly during your plugin's `register()` / `init()`; the underlying hook wiring is deferred until automation-backend reaches `afterPluginsReady` (the only place `onHook` is injected). The call returns an idempotent unsubscribe handle.

## Change derivers

A change deriver maps "this entity kind changed like THIS" to the qualified trigger event id(s) Stage-1 routing should fan out to fresh automation runs. This mapping is domain knowledge - incident's `incident.created` / `.resolved`, health's `healthcheck.system_degraded` - so it cannot live in the kind-agnostic engine. Register one per kind with `registerChangeDeriver`. A deriver is pure and synchronous, receives the validated `EntityChanged`, and returns the trigger event id(s) (an empty array means "fire nothing").

```ts
import {
  entityExtensionPoint,
  type EntityChangeDeriver,
} from "@checkstack/automation-backend";

const INCIDENT_TRIGGER_EVENTS = {
  created: "incident.created",
  updated: "incident.updated",
  resolved: "incident.resolved",
} as const;

const deriveIncidentTriggerEvents: EntityChangeDeriver = (changed) => {
  if (changed.prev === null && changed.next !== null) {
    return [INCIDENT_TRIGGER_EVENTS.created];
  }
  if (changed.next === null) return []; // tombstone, no event
  const prev = changed.prev?.["status"];
  const next = changed.next?.["status"];
  if (next === "resolved" && prev !== "resolved") {
    return [INCIDENT_TRIGGER_EVENTS.resolved];
  }
  return [INCIDENT_TRIGGER_EVENTS.updated];
};

const entity = env.getExtensionPoint(entityExtensionPoint);
entity.registerChangeDeriver({
  kind: INCIDENT_ENTITY_KIND,
  derive: deriveIncidentTriggerEvents,
});
```

> [!CAUTION]
> The deriver must return the qualified TRIGGER event id (`${pluginId}.${trigger.id}`) that automations store in `trigger.event` and that Stage-1 routing matches on - NOT the dotted hook id. The healthcheck triggers use underscore ids, so the health deriver emits `healthcheck.system_degraded` (not `healthcheck.system.degraded`); the catalog system triggers use ids `created` / `updated` / `deleted`, so the catalog deriver emits `catalog.created` (not `catalog.system.created`). Returning the wrong shape means the migrated automations never fire. Verify the exact ids against your plugin's registered triggers.

Multiple derivers may be registered per kind; their outputs union (de-duplicated, registration order). A deriver that throws is skipped so it cannot wedge routing for the others.

## How automations consume entities

Two reactive consumers read entity state through each kind's `read` accessor, both kind-agnostically:

- **Scope projection.** Before a run starts (and on resume, and at the trigger gate), the engine resolves the referenced entity refs through each kind's `getMany` resolver (which routes to that kind's `read`) and folds them into scope under `state.<kind>.<id>.<field>`. Conditions and templates read it as plain data: `state.slo['payments-slo'].budgetRemainingPercent`, `state.incident['abc'].severity`. This minimal `state.<kind>` view is the small reactive subset each kind's `defineEntity` exposes. Health additionally has a SEPARATE, richer projection: `scope.health.*` is the full health condition snapshot (status, latency, success rate, in-maintenance, transitions-in-window, ...) resolved through the healthcheck RPC, because the health aggregate is computed on read rather than stored as a framework row. The two coexist by design, not as a migration shim: `state.health.*` is the minimal reactive entity view, `scope.health.*` is the rich snapshot the structured `state` / `numeric_state` evaluators read, owned solely by the RPC path.
- **Reactive `wait_until`.** A suspended `wait_until` no longer polls. At suspend time the engine statically extracts the `state.*` refs the condition reads and inserts wake-index rows keyed by `${kind}:${id}`. A relevant change wakes the wait, re-resolves scope, and re-evaluates the condition synchronously. When an id is dynamic the engine records a kind-level wildcard `${kind}:*` so the wait wakes on any change of that kind and re-evaluates - a few extra wakes, never a silent stall.

```yaml
# React to a derived SLO budget threshold (no pre-baked budget hooks).
triggers:
  - event: healthcheck.system_health_changed
conditions:
  - numeric_state:
      value: "state.slo['payments-slo'].budgetRemainingPercent"
      below: 20
actions:
  - action: notification.send
    config: { title: "Payments error budget under 20%" }
```

See [the sensing layer](/checkstack/developer-guide/backend/automations/sensing-layer/) for the condition grammar and the `state.<kind>` scope reference, and [the reactive dispatch pipeline](/checkstack/developer-guide/backend/automations/reactive-dispatch/) for how a change becomes a run.
