---
title: "Entity state machine"
description: "Expose a plugin's domain state as a reactive entity with defineEntity, the non-reactive escape hatch, cross-plugin change subscriptions, and change derivers."
---

The entity state machine is the single, framework-owned primitive every plugin uses to expose reactive state. One `defineEntity` declaration replaces a hand-rolled state table, an ad-hoc change hook, a current-state query, and the since/duration bookkeeping that domains used to reimplement each on their own. The automation engine consumes the resulting entity store for trigger routing, condition scope, and reactive waits, so state declared this way is automatically visible to automations and state declared off-pattern is structurally invisible to them. This page is the plugin-author guide; for the queue/wake machinery the entity store drives, see [the reactive dispatch pipeline](/checkstack/developer-guide/backend/automations/reactive-dispatch/).

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

Resolve the `automation.entity` extension point and call `defineEntity` with a globally-unique `kind` and a zod object describing the reactive state. The zod schema is the single source of truth for typing, validation, scope projection, and the change-event shape, so it MUST be a `z.object`. The call returns a typed `EntityHandle` you keep on your service and mutate through.

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
      indexes: [
        { name: "status", fields: ["status"] },
        { name: "severity", fields: ["severity"] },
      ],
    });
    // ...
  },
});
```

automation-backend registers the extension-point impl in its `register()` phase, so other plugins can resolve it and call `defineEntity` during their own `register()` or `init()`; cross-plugin calls are Proxy-buffered until the impl registers. Declare the entity in `register()` (as above) or in `init()` once your service and DB deps exist - whichever fits your plugin's wiring. Keep the returned handle on your service and call it from every site that used to write your state table and emit an ad-hoc hook.

A malformed registration hard-fails the loader at startup: a non-`z.object` state, a missing or duplicate `kind`, or an index field that is not a real state field.

### The handle

`EntityHandle<TState>` is the only typed path to reactive state:

```ts
interface EntityHandle<TState extends Record<string, unknown>> {
  readonly kind: string;
  set(id: string, next: TState, opts?: EntityMutationOpts): Promise<void>;
  patch(id: string, partial: Partial<TState>, opts?: EntityMutationOpts): Promise<void>;
  get(id: string): Promise<TState | undefined>;
  getMany(ids: ReadonlyArray<string>): Promise<Record<string, TState>>;
  remove(id: string, opts?: EntityMutationOpts): Promise<void>;
  inStateSince(id: string, field: keyof TState & string): Promise<Date | null>;
  inStateForMs(id: string, field: keyof TState & string): Promise<number>;
  transitionCount(args: { id: string; field: keyof TState & string; windowMs: number }): Promise<number>;
}
```

- `set` validates `next` against the kind's zod object, structurally diffs against the prior row, and emits a single change event only on a real diff. An unchanged write is a no-op (no event, no wake, no transition row).
- `patch` shallow-merges `partial` into the current state, then runs the same diff/emit/transition pipeline.
- `remove` emits a tombstone change event (`next === null`).
- `get` / `getMany` are the resolvers the engine uses for scope pre-resolution and wake re-evaluation; `getMany` mirrors the old `getBulkHealthState` batched shape.
- `inStateSince` / `inStateForMs` / `transitionCount` read the per-field transition log, generalizing the health-transition log to any entity.

`EntityMutationOpts` carries the mutating `actor` (defaults to the system actor; travels on the change event so automations read `trigger.actor`) and an optional `runId`. When the mutation originates inside a dispatch run, pass `runId` so the persisted state is run through the run-secret mask before it is written - secret values must never enter the entity store.

> [!IMPORTANT]
> Mutate at every site that owns the state. The existing migrated domains keep their original table authoritative and mirror the reactive subset through the handle (a behavior-preserving mirror), so the entity store is a reactive projection, not the record of truth. A mirror failure is fail-soft and must never break the domain's write path.

### Declaring indexes

The generic entity store keeps all kinds in one `entity_state` table (jsonb `state`). Declare a secondary index per `EntityIndexSpec` and the `defineEntity` impl creates a Postgres expression index on `state->>'field'` at load time, named `entity_state_<kind>_<name>_idx`. Index the fields your queries and condition lookups filter on.

```ts
indexes: [
  { name: "status", fields: ["status"] },
  { name: "severity", fields: ["severity"] },
]
```

## Cross-plugin change subscriptions

To react to ANOTHER domain's entity changes, use `onEntityChanged` from the same extension point. The internal `ENTITY_CHANGED` hook is deliberately unexported, so `defineEntity` stays the only typed path that emits a change and `onEntityChanged` is the typed, validated path that consumes one. The handler receives the validated `{ kind, id, prev, next, delta, changedFields, actor, occurredAt }`.

```ts
import {
  entityExtensionPoint,
  CATALOG_SYSTEM_ENTITY_KIND,
} from "@checkstack/automation-backend";

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

Two reactive consumers read the entity store, both kind-agnostically:

- **Scope projection.** Before a run starts (and on resume, and at the trigger gate), the engine resolves the referenced entity refs through each kind's `getMany` resolver and folds them into scope under `state.<kind>.<id>.<field>`. Conditions and templates read it as plain data: `state.slo['payments-slo'].budgetRemainingPercent`, `state.incident['abc'].severity`. The legacy `health.*` namespace is kept as a back-compat alias projection of `state.health.*` for one release.
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
