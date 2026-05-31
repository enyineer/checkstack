---
title: "Entity state machine"
description: "Expose a plugin's domain state as a reactive entity with defineEntity, the non-reactive escape hatch, cross-plugin change subscriptions, and change derivers."
---

The entity state machine is the framework primitive every plugin uses to make its domain state reactive. `defineEntity` is a reactive WRAPPER: it owns NO current-state storage of its own. Each plugin keeps its state where it already lives (its own table, an in-memory map, or a computed aggregate) and supplies a `read` accessor; every reactive-state write goes through the single `handle.mutate` entry point, which snapshots the previous state via `read`, runs the plugin's own write, and records the change. One `defineEntity` declaration replaces an ad-hoc change hook, a current-state query helper, and the since/duration bookkeeping that domains used to reimplement on their own - without duplicating the state itself. The automation engine consumes the resulting reactive surface for trigger routing, condition scope, and reactive waits, so state declared this way is automatically visible to automations and state declared off-pattern is structurally invisible to them. This page is the plugin-author guide; for the queue/wake machinery the change events drive, see [the reactive dispatch pipeline](/checkstack/developer-guide/backend/automations/reactive-dispatch/).

## Design principle: no state duplication

The framework NEVER owns a plugin's current state. There is no framework-managed mirror table that domains copy their state into. Instead:

- The plugin owns its current state - in its own table, an in-memory map, or a value computed on the fly. It exposes that state through a required batched `read` accessor.
- The framework owns only the change HISTORY. For every kind, on every real change, it appends field-level rows to its own `entity_transitions` table. This history is always platform-kept, even for in-memory kinds, so a satellite connection that lives only in process memory still gets durable transition history.
- All reactive-state writes go through one driven entry point - `handle.mutate({ id, apply })`. The handle snapshots `prev` via `read` before the write, runs the plugin's `apply` (the real write against the plugin's own storage), then diffs and records the transition.

A kind whose state has no natural home of its own can opt into `createKeyedStore` (see [homeless kinds](#homeless-kinds-createkeyedstore)); only the computed `health` aggregate uses it today. Everything else reads and writes its own storage.

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

### Homeless kinds: createKeyedStore

Most kinds own their state and pass their own reader to `read`. A kind whose state has NO natural home of its own - it is computed and otherwise unpersisted, like healthcheck's per-system `health` aggregate - can opt into the framework keyed store. `createKeyedStore` is backed by a generic `entity_state` table keyed by `(kind, id)` and plugs into `defineEntity` like any other plugin storage: pass its `readMany` as `read`, and write it from inside your `apply`.

```ts
import { entityKeyedStoreServiceRef } from "@checkstack/automation-backend";

// The homeless kind injects the keyed-store service ref (its `entity_state`
// lives in automation-backend's schema, reachable only through this ref).
const keyedSvc = env.getService(entityKeyedStoreServiceRef);
const keyed = keyedSvc.keyedStoreFor<HealthEntityState>("health");

const handle = entity.defineEntity<HealthEntityState>({
  kind: "health",
  state: HealthEntityStateSchema,
  read: keyed.readMany, // the keyed store IS this kind's current-state home
});

// ...at every aggregate-write site:
await handle.mutate({
  id: systemId,
  // `apply` takes no framework tx; open one over automation's DB and write the
  // keyed store there, returning the aggregate view as `next`.
  apply: () =>
    keyedSvc.runInTransaction((tx) =>
      keyed.write({ tx, id: systemId, state })),
});
```

The keyed store is the SOLE current-state home for the homeless kind - there is no duplicate domain row. The keyed write and the framework transition append still commit in separate transactions, but both target the same physical schema, so the homeless kind gets durable platform history in `entity_transitions` exactly like every other kind. Kinds that own their storage NEVER touch the keyed store.

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

- **Scope projection.** Before a run starts (and on resume, and at the trigger gate), the engine resolves the referenced entity refs through each kind's `getMany` resolver (which routes to that kind's `read`) and folds them into scope under `state.<kind>.<id>.<field>`. Conditions and templates read it as plain data: `state.slo['payments-slo'].budgetRemainingPercent`, `state.incident['abc'].severity`. The legacy `health.*` namespace is kept as a back-compat alias projection of `state.health.*` for one release.
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
