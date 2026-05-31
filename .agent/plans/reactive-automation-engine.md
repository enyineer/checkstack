# Reactive automation engine + unified entity state machine

> **Status:** planned (design locked 2026-05-31; hardened into an
> assumption-free handoff 2026-05-31, not started)
> **Branch:** off `integration/automation+script-editor` (or `main` once that lands)
> **Goal:** make the automation engine **fully reactive** — no polling of state to
> detect conditions — and introduce a single, enforced **entity state machine**
> that every plugin uses to expose reactive state. State changes flow through a
> work-queue pipeline; triggers and waiting automations react to them; only one
> instance claims each event and fans dispatch out across instances. Designed for
> horizontal scale.

Self-contained handoff. Pick up from this document alone. Every current-state
claim carries a `file:line` anchor so the implementer never has to guess.

---

## 0. Design revision (Model B) — plugin-owned reactive wrapper

> **Revised 2026-05-31, mid-implementation, then finalized.** The original design
> (still described verbatim in §2, §4, §15.1 below for historical context) had the
> framework OWN entity current-state in a generic `entity_state` table, and each
> domain MIRRORED its state into that table through `handle.set` / `handle.patch`.
> That duplicated every domain's state and coupled plugin writes to a
> framework-owned table.
>
> **Model B replaces it:** `defineEntity` is a reactive WRAPPER that owns NO
> current-state storage. Each plugin keeps owning its own state (its own durable
> table, or a value computed on read from its own durable tables) and supplies a
> REQUIRED `read` accessor. ALL reactive-state writes go through a single driven
> entry point — `handle.mutate({ id, opts?, apply })` (and
> `handle.remove({ id, opts?, apply })` for tombstones). The handle snapshots
> `prev` via `read` BEFORE the write, runs the plugin's `apply` (the REAL write
> against the plugin's own storage, in the plugin's own transaction, returning the
> resulting state as `next`), then diffs `prev → next` and appends the change to
> the framework's `entity_transitions` table. There is NO `handle.set` /
> `handle.patch` and NO `indexes` option.
>
> **FINAL: there is NO framework-owned current-state storage at all.** The
> `createKeyedStore` opt-in and the generic `entity_state` table that the
> intermediate revision kept for "homeless" kinds have been REMOVED entirely
> (`createKeyedStore`, `KeyedStore`, `entityKeyedStoreServiceRef`,
> `EntityKeyedStoreService`, and the `entity_state` table are all gone). EVERY
> kind is plugin-backed; there is no "homeless" fallback. The two resolution
> shapes are:
> - **Plugin-table-backed** — the reactive subset projects straight off the
>   plugin's own table(s): incident, maintenance, catalog (system + group),
>   dependency, and `satellite-connection`.
> - **Compute-on-read** — the reactive subset has NO stored row; it is derived on
>   demand from the plugin's own durable data, so no second copy can drift. The
>   per-system `health` aggregate computes from `health_check_runs` (via
>   `getSystemHealthStatus`); the `slo` budget/streak view computes via the SLO
>   engine over the objective's downtime history.
>
> `satellite-connection` is DURABLE, not in-memory: its current state lives in
> the `connection_status` / `last_seen_at` / `last_connection_event` columns on
> the shared `satellites` table, so it is globally readable from any pod. The
> in-process WebSocket map is now ONLY the pod-local live-socket registry
> (`declareNonReactiveState`, bookkeeping), never the entity source.
>
> **Why:**
> - **No state duplication.** The framework never owns a plugin's current state;
>   there is no mirror table to keep in sync. The plugin's own storage (or a
>   computation over it) stays the single source of truth.
> - **History is always platform-kept.** For EVERY kind, on every real change,
>   the framework appends field-level rows to `entity_transitions` — including
>   compute-on-read kinds like `health`, which has no current-state row of its
>   own yet still gets durable platform transition history.
> - **No cross-plugin transaction coupling.** A plugin-backed kind lives behind a
>   different DB client than `entity_transitions`, so `apply` commits first and
>   the transition append runs afterwards in the framework's own transaction. The
>   plugin write is authoritative; a failure between the two leaves correct plugin
>   state with at most a missing history row (a gap, never a corruption).
> - **Horizontal-scale read-consistency is now a hard rule + guard.** A reactive
>   entity's current state MUST be globally readable from shared/durable storage,
>   never process-local memory (`.agent/rules/state-and-scale.md`). It is enforced
>   by the `checkstack/no-pod-local-entity-state` ESLint tripwire at the
>   `defineEntity({ read })` boundary and the deterministic
>   `cross-pod-read-consistency.it.test.ts` integration test.
>
> Sections §2.1, §4, and §15.1 below describe the SUPERSEDED original model and
> are retained only as historical record of the locked-then-revised decision.
> Their references to `entity_state` / `createKeyedStore` as a surviving
> opt-in are also superseded by this FINAL note — no framework current-state
> store exists.

---

## 1. Why

- **Polling doesn't scale horizontally.** The current `wait_until` re-evaluates
  its condition on a queue timer (`core/automation-backend/src/dispatch/wait-until-queue.ts:36-94`
  — re-enqueues a fresh `automation-wait-until` job every `poll_seconds`), and
  the `template` trigger polls a condition on an interval. With N pods this is N×
  redundant work and it grows with the number of in-flight waits. Eliminate
  condition/state polling entirely.
- **State handling is fragmented.** Incident, maintenance, health, SLO,
  dependency, catalog, satellite each reimplement their own slice of "store
  entity state + emit an ad-hoc change hook + (sometimes) expose a current-state
  query." Phase 13 hand-built the health-transition log
  (`core/healthcheck-backend/src/schema.ts:160-186` — `health_check_state_transitions`);
  everyone else lacks it. Unify this into one primitive with great plugin DX.
- **Make the right way the only way.** Plugin authors should hook into one shared
  state machine; the platform hides the queue / event / wake-index complexity;
  off-pattern entity state is structurally non-reactive (and therefore invisible
  to automations), so compliance is the path of least resistance.

---

## 2. Locked decisions

1. **Framework-owned entity storage.** ~~The platform owns the entity-state store;
   plugins declare entities and mutate through a returned handle. No plugin-owned
   entity table. Indexes/derived queries are declarable through the entity API so
   flexibility isn't lost. (Layout decided in §15.1 — generic keyed store.)~~
   **SUPERSEDED by Model B (see §0).** The framework owns NO current-state
   storage. Each plugin keeps owning its state and exposes a `read` accessor;
   all writes go through `handle.mutate({ id, apply })`; the framework records
   change history in `entity_transitions` only. FINAL: there is no framework
   current-state store at all — the generic keyed store and its `entity_state`
   table are removed. Every kind is plugin-backed, either projected off the
   plugin's own table or computed on read from it (the `health` aggregate and the
   `slo` budget/streak view compute on read). There is no `set` / `patch` /
   `indexes`.
2. **Explicit, reason-annotated escape hatch** for data that is intentionally NOT
   a reactive entity (see §5). Its purpose is to *enable strict enforcement* —
   declare intent so enforcement can flag everything unmarked. (Concrete API in §15.6.)
3. **Breaking + clean hook migration.** Entity-state-change hooks are removed and
   replaced by the entity's auto-emitted change events (breaking). Non-entity
   hooks (scheduled reports, action outcomes, derived signals, time ticks) are
   kept. The finalized hook inventory is §9.
4. **Big Bang migration.** All state-owning domains move to the entity state
   machine in this effort (not incremental). Migration target list is §10.
5. **Testing doctrine (§11):** unit/fakes for all logic + happy paths (default,
   fast lane); a **surgical** real-services integration lane (real Postgres + real
   Redis/BullMQ, env-gated) for ONLY the handful of external-runtime-contract
   assertions fakes cannot model. No pg-mem (half-fidelity middle tier rejected).
6. **No polling of state.** Time-driven timers (`delay`, `for:` dwell, `cron`/
   `interval` triggers) are kept — they are not state-polling. The `template`
   trigger (polls a condition) is **removed** (its real cases are covered by the
   reactive `numeric_state`/`state` triggers + conditions that already exist —
   `core/automation-backend/src/dispatch/structured-conditions.ts`).

---

## 3. Machinery to reuse (DO NOT reinvent)

The implementer wires the entity state machine into existing, battle-tested
platform primitives. Anchors below.

### 3.1 Hook system

- **`createHook<T>(id)`** — `core/backend-api/src/hooks.ts:27-29`. Phantom-typed
  hook descriptor.
- **`HookEventMeta { actor: Actor }`** travels with every emit
  (`core/backend-api/src/hooks.ts:20-22`) and is exposed to automations as
  `trigger.actor`. Entity change events MUST carry the mutating actor the same way.
- **`onHook` subscription modes** (discriminated union) —
  `core/backend-api/src/hooks.ts:134-188`:
  - `mode: "broadcast"` (default) — every instance receives a copy; consumer group
    is per-instance (`${pluginId}.${hook.id}.broadcast.${instanceId}` —
    `core/backend/src/services/event-bus.ts:128-131`).
  - `mode: "work-queue", workerGroup, maxRetries?` — exactly one instance per
    group claims; shared group `${pluginId}.${workerGroup}`
    (`core/backend/src/services/event-bus.ts:113-131`). Duplicate workerGroup in a
    plugin throws (`event-bus.ts:116-119`). **USE FOR STAGE-1 ROUTING.**
  - `mode: "instance-local"` — bypasses the queue, emitted via `emitLocal`
    (`event-bus.ts:287`, `event-bus.ts:332`).
- Implementation: `core/backend/src/services/event-bus.ts` (class `EventBus`,
  line 76). `onHook` only injectable in `afterPluginsReady`
  (`core/backend/src/plugin-manager/plugin-loader.ts:558-674`).

### 3.2 Queue manager

- Public `Queue<T>` interface — `core/queue-api/src/queue.ts:53-121`:
  `enqueue(data,{priority?,startDelay?,jobId?})` (`queue.ts:5-20`),
  `consume(consumer,{consumerGroup,maxRetries?})` (`queue.ts:27`),
  `scheduleRecurring(data,{jobId,cronPattern|intervalSeconds,...})`
  (`queue.ts:45-58`), `cancelRecurring`, `getInFlightCount`, `stop`.
- Manager wiring: `core/queue-api/src/queue-plugin.ts`; resolved via
  `coreServices.queueManager` (`core/backend-api/src/core-services.ts:58`).
- BullMQ backend: `plugins/queue-bullmq-backend/src/bullmq-queue.ts` (worker
  created at `:126`). **Note for §15.4:** the worker is created with NO explicit
  `lockDuration` / `stalledInterval` / `maxStalledCount` (`bullmq-queue.ts:139-155`),
  so BullMQ defaults apply (30s lock, 30s stalled check, 1 max-stalled). This is
  the concrete starting point for the job-lock decision.

### 3.3 Proto-wake path (already present — generalize it)

The automation backend already implements a primitive event→wake path; the
reactive engine generalizes it to arbitrary entity refs.

- **Wait locks** table `automation_wait_locks`
  (`core/automation-backend/src/schema.ts:193-250`): `runId`, `actionPath`, `kind`
  (`trigger|delay|until`), `eventId`, `contextKey`, `filterTemplate`, `waitConfig`,
  `timeoutAt`. Indexes: `eventLookupIdx (eventId, contextKey)` (`schema.ts:239`),
  `timeoutIdx (timeoutAt)` (`:244`), `runIdx (runId)` (`:246`), `kindIdx (kind)` (`:248`).
- **Lookup query** `findWaitLocksFor(eventId, contextKey)` —
  `core/automation-backend/src/dispatch/run-state.ts:313-326` (key match on
  `eventId` + null-safe `contextKey`). This is the proto-wake-index lookup.
- **Wake path** `wakeWaitingRuns` —
  `core/automation-backend/src/dispatch/trigger-subscriber.ts:248-301`: every
  incoming event is cross-referenced against wait locks, the filter template is
  re-evaluated, the lock deleted, and `resumeRun` invoked. The trigger subscriber
  resolves matches at `:165` (resume) then `:168` (fresh runs).
- **Dwell** (`for:`) — pre-run timers in `automation_dwell_timers`
  (`schema.ts:314-365`), atomic `DELETE…RETURNING` claim
  (`core/automation-backend/src/dispatch/dwell-store.ts:121-132`), queue
  `automation-dwell` (`dwell.ts:30`), re-confirm on expiry
  (`dwell.ts:163-228`). Kept (time-driven, not state-polling).
- **wait_until / wake-lock** — `wait-until-queue.ts` (removed in §7), the
  `kind:"until"` wait lock, and `checkWaitUntil` in `engine.ts`.

### 3.4 Advisory-lock service

- `core/backend-api/src/advisory-lock.ts`: `createAdvisoryLockService(pool)`
  → `tryAcquire(key)` returns a handle owning a dedicated pooled client
  (`advisory-lock.ts:78-120`); `withXactLock({db,key,fn})` for short critical
  sections via `pg_advisory_xact_lock` (`advisory-lock.ts:140-158`). Keys hashed
  with `hashtextextended(key,0)`.
- Per-run lock already wired: `RunStateStore.tryAdvisoryLock(runId)` →
  `advisoryLock.tryAcquire(runLockKey(runId))`
  (`core/automation-backend/src/dispatch/run-state-store.ts:194-198`).

### 3.5 Run-secret registry + reseed + masking

- In-memory, per-run, by-value mask set:
  `createRunSecretRegistry()` — `core/automation-backend/src/dispatch/run-secret-registry.ts:42`;
  interface `RunSecretRegistry` (`:21-40`). Capture by wrapping `getService`:
  `wrapGetServiceForRun` (`:108`), proxies for resolver/connection-store (`:185`, `:222`).
- Cross-pod reseed on resume: `reseedRunSecretRegistry` +
  `collectDeclaredSecretRefs` —
  `core/automation-backend/src/dispatch/reseed-run-secrets.ts:163`, `:87`.
- Mask primitives: `maskSecrets` / `maskSecretsDeep` —
  `core/secrets-common/src/masking.ts:36`, `:69`.
- **Constraint for the entity engine:** secret VALUES must never enter the entity
  store, change events, or scope projection (§5 escape-hatch class). The masking
  choke points already exist; entity-store writes become a new choke point that
  MUST run payloads through `maskDeep` for the owning run when a write originates
  inside a dispatch run.

### 3.6 Scope enrichment (`enrichScopeWithState`)

- `core/automation-backend/src/dispatch/state-scope.ts:122-179`. Today it batch-
  resolves *health* state for the trigger `contextKey` + `uses_state` ids and folds
  it into `scope.health` (snake_case, ISO strings) via the healthcheck client
  (`getBulkHealthState`, `state-scope.ts:156`). Bounded to `MAX_RESOLVED_SYSTEMS=50`
  (`:30`), fail-open (`:170-178`). The `uses_state` / `state_window_minutes`
  escape-hatch fields already exist on the automation definition
  (`core/automation-common/src/schemas.ts:684-707`).
- **Generalization target:** replace the health-specific resolution with a
  kind-agnostic `enrichScopeWithEntities` that resolves any `state.<kind>.<id>`
  ref via the entity store's resolver, folding into `scope.state.<kind>.<id>`.
  Keep `scope.health` as a back-compat alias projection of `state.health.*` for
  one release (the existing `evaluateStateCondition` reads `health.systems[entity]`
  — `structured-conditions.ts:81-101`).

### 3.7 Plugin lifecycle + extension point + service registration

- **Phase 1 `register(env)`** — `core/backend/src/plugin-manager/plugin-loader.ts:112-165`:
  declare schema/services/extension points; `env.registerExtensionPoint(ref,impl)`
  (`:160`), `env.getExtensionPoint(ref)` (`:163`), `env.registerService(ref,impl)`
  (`:147`), `env.getService(ref)` (`:158`). No DB access. Cross-plugin extension
  calls are Proxy-buffered until the impl registers
  (`core/backend/src/plugin-manager/extension-points.ts`).
- **Phase 2 `init({deps})`** — `plugin-loader.ts:342-488`. Migrations run BEFORE
  `init` per plugin (`:400-450`); each plugin gets its own Postgres schema
  (`getPluginSchemaName`, `:413`). Deps resolved; no cross-plugin RPC yet.
- **Phase 3 `afterPluginsReady({...deps,onHook,emitHook,eventBus})`** —
  `plugin-loader.ts:558-674`. **Only place `onHook`/`emitHook` are injected.**
- **`createExtensionPoint<T>(id)`** — `core/backend-api/src/extension-point.ts:9-11`.
- **`createServiceRef<T>(id)`** + the `coreServices` registry —
  `core/backend-api/src/core-services.ts:23-66` (note `eventBus` at `:60`,
  `queueManager` at `:58`, `signalService` at `:61`).
- The dispatch engine already resolves arbitrary cross-plugin refs at execute
  time via `assembleDispatchGetService` —
  `core/automation-backend/src/dispatch/assemble-get-service.ts:24-31`.

---

## 4. Core primitive — the entity state machine (`defineEntity`)

> **SUPERSEDED by Model B (§0).** This section describes the original
> framework-owned-storage API (`set` / `patch` / `indexes`, upsert into the
> framework entity store) and is retained as historical record. The shipped API
> is the Model B reactive wrapper: required `read` accessor + driven
> `handle.mutate({ id, apply })` / `handle.remove({ id, apply })`, no `set` /
> `patch` / `indexes`, and the framework records change history only. See §0 for
> the final API and the canonical docs under
> `docs/src/content/docs/developer-guide/backend/automations/entity-state-machine.md`.

One declaration; everything derived. The returned handle is the **only** typed
path to reactive state. `defineEntity` is registered through a new extension
point on `automation-backend` (it owns scope projection, the transition log, and
the wake-index — the same package that owns dispatch). *(Model B: it does NOT own
current-state storage.)*

### 4.1 Concrete API (superseded — see §0)

```ts
// core/automation-backend/src/entity/define-entity.ts (NEW)
import type { z } from "zod";
import type { Actor } from "@checkstack/common";

/** A declarable secondary index over fields of the entity state. */
export interface EntityIndexSpec<TState> {
  /** Stable id, namespaced under the kind. */
  name: string;
  /** State fields the index covers (dot-paths into the zod object). */
  fields: ReadonlyArray<keyof TState & string>;
}

export interface DefineEntityInput<TState extends Record<string, unknown>> {
  /** Globally-unique entity kind (e.g. "incident", "maintenance", "health"). */
  kind: string;
  /**
   * zod = single source of truth: typing, validation, scope projection,
   * UI/editor introspection, change-event shape. MUST be a z.object.
   */
  state: z.ZodObject<z.ZodRawShape> & z.ZodType<TState>;
  /** Declarable secondary indexes (map onto the generic store — see §15.1). */
  indexes?: ReadonlyArray<EntityIndexSpec<TState>>;
}

/** Mutation context so change events carry the causing actor (§3.1). */
export interface EntityMutationOpts {
  /** Defaults to the system actor when omitted. */
  actor?: Actor;
  /** Run id, when the mutation originates inside a dispatch run (masking). */
  runId?: string;
}

export interface EntityHandle<TState extends Record<string, unknown>> {
  readonly kind: string;
  /** Validate + persist + diff; emits change(kind:id, delta) only on a real diff. */
  set(id: string, next: TState, opts?: EntityMutationOpts): Promise<void>;
  /** Shallow-merge patch; same diff/emit/wake/transition pipeline. */
  patch(id: string, partial: Partial<TState>, opts?: EntityMutationOpts): Promise<void>;
  /** Current state by id (resolver — used by scope enrichment + wake re-eval). */
  get(id: string): Promise<TState | undefined>;
  /** Batched resolver for scope pre-resolution (mirrors getBulkHealthState). */
  getMany(ids: ReadonlyArray<string>): Promise<Record<string, TState>>;
  /** Remove the entity (emits a tombstone change event with delta = null). */
  remove(id: string, opts?: EntityMutationOpts): Promise<void>;
  /** Transition helpers — generalize Phase 13's health transitions to any entity. */
  inStateSince(id: string, field: keyof TState & string): Promise<Date | null>;
  inStateForMs(id: string, field: keyof TState & string): Promise<number>;
  transitionCount(args: { id: string; field: keyof TState & string; windowMs: number }): Promise<number>;
}

export type DefineEntity = <TState extends Record<string, unknown>>(
  input: DefineEntityInput<TState>,
) => EntityHandle<TState>;
```

### 4.2 Extension point + lifecycle

- New extension point: `entityExtensionPoint = createExtensionPoint<{ defineEntity: DefineEntity }>("automation.entity")`
  in `core/automation-backend/src/entity/extension-point.ts`, mirroring
  `automationTriggerExtensionPoint`
  (`core/automation-backend/src/extension-points.ts`, the pattern documented in
  the automation-platform plan §3).
- **automation-backend registers the impl in Phase 1** (`register`), so other
  plugins can `env.getExtensionPoint(entityExtensionPoint)` and call `defineEntity`
  during their own `register`/`init`. Calls are Proxy-buffered until the impl
  registers (`extension-points.ts`).
- **Plugins call `defineEntity` in `init`** (after their service/DB deps are
  resolved) and keep the returned handle on their service. Service mutation sites
  call `handle.set/patch` instead of writing their own table + emitting an ad-hoc
  hook.
- Load-time validation: a malformed registration (non-`z.object` state, missing
  `kind`, duplicate `kind`) hard-fails the loader (§6.3).

### 4.3 What `defineEntity` auto-derives (and how each is wired)

| Capability | Wiring |
|---|---|
| **Storage write** | Validate `next` with `state` (zod `parse`); upsert into the framework-owned entity store (§15.1). When `opts.runId` set, run the persisted JSON through `runSecretRegistry.maskDeep(runId, …)` (§3.5) first. |
| **Diff** | Load prior row; structural-equal compare (stable-stringify of the validated object). No-op return when unchanged (mirrors the dwell "no change" semantics). |
| **Change event** | On a real diff, emit a single internal hook `ENTITY_CHANGED` (created in automation-backend) carrying `{ kind, id, prev, next, delta, changedFields }` + the `HookEventMeta.actor`. Emitted in `mode: "work-queue"` → Stage 1 (§7). Keyed routing is by `kind:id` (the dispatch ref) and by `kind` (kind-level subscriptions). |
| **Scope projection** | The entity store's resolver feeds `enrichScopeWithEntities` (§3.6 generalization): `state.<kind>.<id>.<field>` for conditions/templates uniformly. |
| **Wake-index insert** | A suspended `wait_until` (now reactive — §7) extracts `state.*` refs and inserts wake-index rows keyed by `kind:id` (§8). The change event's `kind:id` is the lookup key. |
| **Transition log** | On a diff that changes a tracked field, append to the generic transition log (§15.1 transition table), generalizing `health_check_state_transitions` (`core/healthcheck-backend/src/schema.ts:160-186`). Powers `inStateSince` / `inStateForMs` / `transitionCount`. |

DX win: incident/maintenance/health/etc. stop reimplementing storage + ad-hoc
hook + current-state query + since/duration; one `defineEntity` call replaces all
(see §10 per-domain mapping).

---

## 5. The escape hatch (enables strict enforcement)

Data that looks like state but is intentionally **not** a reactive entity must be
declared as such, with a reason. This lets enforcement be strict on everything
unmarked. Legitimate classes:

- **High-frequency / high-cardinality raw samples** — e.g. `health_check_runs`
  (`core/healthcheck-backend/src/schema.ts:231-252`) and the
  `healthcheck.check.completed` hook (`core/healthcheck-backend/src/hooks.ts:56-63`).
  The *aggregate* health is the entity; raw samples are not (a firehose would melt
  the wake-index). The numeric extractor `extractNumericField`
  (`core/automation-backend/src/dispatch/numeric.ts:65-82`) still reads these per
  the `numeric_state` trigger — they remain a wake source for numeric conditions
  WITHOUT being entities.
- **Sensitive values** — secret values must never enter reactive scope/change
  events (see §3.5). Metadata may be an entity; the value is excluded.
- **Externally-owned state we cannot observe** — e.g. a Jira issue's live status:
  no change event without polling; model the artifact we created
  (`jira.issue` artifact type), not a pretend-live entity.
- **Internal operational bookkeeping** — cursors, caches, heartbeat timestamps
  (e.g. `satellites.lastHeartbeatAt` — `core/satellite-backend/src/schema.ts:23`),
  `dependency_derived_states` cursor (`core/dependency-backend/src/schema.ts:78-82`).

Concrete shape (decided, §15.6): a `declareNonReactiveState({ table, reason })`
call alongside `defineEntity`, plus a per-automation `uses_state` field that
already exists (`core/automation-common/src/schemas.ts:684`). Default is "entity
state ⇒ `defineEntity`"; the hatch is the annotated exception consumed by the
lint rule.

---

## 6. Enforcement — make the right way the only *reactive* way

Layered, structural-first (carrot + structural stick, not blanket rejection):

1. **Structural (primary):** no typed path emits an entity-change event or exposes
   entity state into scope except through `defineEntity`. The `ENTITY_CHANGED`
   hook is internal to automation-backend and not exported; Stage-1 routing and
   scope projection only read the framework store. Off-pattern entity state is
   non-reactive by construction.
2. **Framework-owned storage:** entity state lives in the automation-backend
   schema (§15.1), so there is no per-domain table to hand-roll for it.
3. **Load-time validation:** the `defineEntity` impl hard-fails a malformed
   registration (non-`z.object` state, missing/duplicate `kind`) during Phase 1/2,
   propagated through the loader's per-plugin init failure path
   (`core/backend/src/plugin-manager/plugin-loader.ts:476`).
4. **Lint backstop:** a custom ESLint rule (§15.6) flags manual `createHook`-based
   change-ish emits and direct writes to a migrated domain's old state column once
   the API exists; `declareNonReactiveState` suppresses false positives. Severity
   stays at the project's chosen level — do NOT escalate warnings to errors.

Not doing: blanket "plugin won't load if it has any non-conforming data" — that
punishes legitimate non-entity data. The stick is "your entity isn't reactive,"
except for malformed registrations.

---

## 7. Reactive dispatch pipeline (the two-stage queue)

State changes drive everything through the existing hook/work-queue infra (§3.1,
§3.2), generalized. Concrete spec in §13.

- **Stage 1 — route (one instance claims):** the `ENTITY_CHANGED` event lands on
  a work-queue (`mode: "work-queue"`, `workerGroup: "automation-entity-route"`,
  one instance per group). The claimer does only cheap, indexed routing: find
  interested **triggers** (automations subscribed to this entity kind/event —
  reuse `findEnabledByTriggerEvent`,
  `core/automation-backend/src/dispatch/run-state.ts` + automation-store) **+
  waiting runs** whose wake-index dependency set includes the changed `kind:id`
  (new — §8 intersection lookup, generalizing `findWaitLocksFor`,
  `run-state.ts:313-326`).
- **Stage 2 — dispatch fan-out:** for each interested automation/run, enqueue a
  per-run job onto a second work-queue (`automation-dispatch`); any instance runs
  one. Spreads execution load; keeps Stage 1 fast. Reuses
  `dispatchTrigger`/`resumeRun` (`core/automation-backend/src/dispatch/engine.ts`).

**Reactive `wait_until`:** on suspend, extract the referenced `state.*` refs (§8.3),
insert wake-index rows against those refs, persist; the run is a durable wait-lock
with **no active job and no polling**. A relevant change event wakes it (Stage 1 →
`enrichScopeWithEntities` re-resolve → sync re-evaluate the condition via the
existing `structured-conditions.ts` evaluators → resume if true). A single durable
**timeout timer** (queue job at the deadline, reusing the `timeoutAt` column on
`automation_wait_locks`, `schema.ts:230`) handles timeout — one deadline, not a
re-check loop. **Remove** the poll re-check job + consumer
(`core/automation-backend/src/dispatch/wait-until-queue.ts` entirely) and the
sweeper's `until`-lock re-tick.

**`template` trigger removed.** `numeric_state` + `state` triggers/conditions
(already implemented in `structured-conditions.ts`) cover the real reactive cases.

**Kept (not polling):** `delay`, `for:` dwell (`dwell.ts`), `cron`/`interval`
triggers (ride `scheduleRecurring`, `queue.ts:45`), timeout timers.

---

## 8. Wake-index

### 8.1 Table shape

Generalizes `automation_wait_locks`. Rather than overloading the single
`(eventId, contextKey)` columns, add a child table so a wait can depend on a SET
of refs (any kinds), with a key-intersection lookup:

```ts
// core/automation-backend/src/schema.ts (NEW table)
export const automationWakeIndex = pgTable(
  "automation_wake_index",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    waitLockId: text("wait_lock_id")
      .notNull()
      .references(() => automationWaitLocks.id, { onDelete: "cascade" }),
    /** The dependency ref: `${kind}:${id}` (e.g. "incident:abc", "health:sys-1"). */
    ref: text("ref").notNull(),
  },
  (t) => ({
    // Stage-1 lookup: "which waits depend on this just-changed ref?"
    refIdx: index("automation_wake_index_ref_idx").on(t.ref),
    lockIdx: index("automation_wake_index_lock_idx").on(t.waitLockId),
  }),
);
```

The owning `automation_wait_locks` row keeps `kind:"until"`, `actionPath`,
`waitConfig` (the condition + timeout), `timeoutAt`
(`core/automation-backend/src/schema.ts:193-250`). The `eventId`/`contextKey`
columns stay for the `kind:"trigger"` path (unchanged).

### 8.2 Insert / lookup queries

- **Insert** (on `wait_until` suspend): one `automation_wait_locks` row +
  N `automation_wake_index` rows (one per extracted ref), in a transaction.
- **Lookup** (Stage 1, per changed `kind:id`): the key-intersection query —
  ```sql
  SELECT wl.* FROM automation_wait_locks wl
  JOIN automation_wake_index wi ON wi.wait_lock_id = wl.id
  WHERE wi.ref = $1 AND wl.kind = 'until';
  ```
  This is the generalized form of `findWaitLocksFor`
  (`run-state.ts:313-326`). A wait wakes when ANY of its refs match; the engine
  re-evaluates the full condition (which reads all refs from the re-enriched
  scope) and resumes only if it now holds.

### 8.3 Reference extraction — where it runs + grammar coverage

- **Where:** at suspend time in `executeWaitUntil` (in `engine.ts`), before
  inserting the wait lock. Extraction parses the wait's condition with the
  existing template/condition parser (`parseCondition`,
  `core/automation-common`/`template-engine`) and walks the AST.
- **Grammar coverage (supported, extracted precisely):**
  - Structured `state` conditions: `{ state: { entity, status, for? } }` →
    ref `state.<resolved-kind>:<entity>` (the kind is the entity's kind; for the
    current health entity it is `health:<entity>`). Source:
    `evaluateStateCondition` reads `health.systems[entity]`
    (`structured-conditions.ts:81-101`).
  - Structured `numeric_state` conditions whose `value` is a path/template into
    `state.<kind>.<id>.<field>` (or the back-compat `health.*`) →
    ref `state.<kind>:<id>`. Source: `evaluateNumericStateCondition`
    (`structured-conditions.ts:26-42`).
  - Template-string conditions (`{{ … }}`): every member-expression rooted at
    `state.<kind>.<id>` (or `health.systems[<id>]` / `health.system`) →
    the corresponding ref(s).
- **Fallback when extraction is uncertain** (dynamic key, computed id, an
  expression the walker can't resolve to a concrete `kind:id`): record a
  **kind-level wildcard** ref `state.<kind>:*` so the wait wakes on ANY change of
  that kind, then re-evaluates. This trades a few extra wakes for never silently
  stalling (the §12 risk). If even the kind is indeterminate, fall back to the
  durable timeout timer only (logged at `warn`, never silent), matching the rigor
  the dwell-arming logic already applies.

---

## 9. Finalized hook inventory + classification

Grepped every `*/src/hooks.ts` (15 files; entity-owning domains below; the rest
are non-entity). Disposition is final — replaces the §9 first-pass of the prior
draft.

| Hook id(s) | Source `file:line` | Class | Disposition |
|---|---|---|---|
| `incident.created` / `incident.updated` / `incident.resolved` | `core/incident-backend/src/hooks.ts:21,35,49` | entity (incident.status/severity/systemIds) | **remove** → incident entity change events |
| `maintenance.created` / `maintenance.updated` | `core/maintenance-backend/src/hooks.ts:18,32` | entity (maintenance.status/window) | **remove** → maintenance entity change events |
| `healthcheck.system.degraded` / `.healthy` / `.health_changed` | `core/healthcheck-backend/src/hooks.ts:19,33,75` | entity (system aggregate health) | **remove** → health entity change events (the `health_changed` umbrella becomes the canonical diff) |
| `system.created` / `.updated` / `.deleted` | `core/catalog-backend/src/hooks.ts:12,25,35` | entity (catalog system) | **remove** → catalog-system entity change events |
| `dependency.created` / `.updated` / `.deleted` | `core/dependency-backend/src/hooks.ts:20,30,40` | entity (dependency edge) | **remove** → dependency-edge entity change events |
| `satellite.connected` / `.disconnected` / `.heartbeat_lost` | `core/satellite-backend/src/hooks.ts:22,35,48` | entity (satellite connection state) — **definitive** | **remove** → satellite-connection entity change events (see §9.1) |
| `slo.budget.warning` / `.critical` / `.exhausted`, `slo.streak.broken` | `core/slo-backend/src/hooks.ts:13,23,33,42` | **derived edges over the SLO budget entity** — **decided: derived, NOT separate hooks** (see §9.2) | **remove** → SLO budget becomes the entity; these become derived `numeric_state`/`state` conditions over `state.slo.<objectiveId>.budgetRemainingPercent` + `currentStreak` |
| `slo.achievement.unlocked` | `core/slo-backend/src/hooks.ts:52` | one-shot event (achievement is append-only, `slo_achievements`, `core/slo-backend/src/schema.ts:115-120`) | **keep** (not a mutable state field) |
| `slo.weekly.digest` | `core/slo-backend/src/hooks.ts:61` | scheduled report (cron, `weekly-digest.ts:128`) | **keep** |
| `healthcheck.check.completed` / `.check.failed` | `core/healthcheck-backend/src/hooks.ts:56,94` | non-entity high-frequency raw sample (escape-hatch) | **keep** (also a wake source for `numeric_state` via `extractNumericField`) |
| `healthcheck.assignment.changed` | `core/healthcheck-backend/src/hooks.ts:47` | config-change signal, not entity state | **keep** |
| `healthcheck.flapping_detected` | `core/healthcheck-backend/src/hooks.ts:116` | **derived signal — definitive: KEEP** (see §9.3) | **keep** |
| `dependency.impact_propagated` | `core/dependency-backend/src/hooks.ts:59` | derived fan-out signal (per-downstream deltas) | **keep** (the per-system derived state is reachable via the health entity; this hook is the propagation notification) |
| `catalog.group.created` / `.deleted` | `core/catalog-backend/src/hooks.ts:45,54` | entity (catalog group) | **remove** → catalog-group entity change events (group is a state-owning entity, included in migration) |
| `notification.delivered` / `.failed` | `core/notification-backend/src/hooks.ts:19,31` | action outcome | **keep** |
| `auth.user.deleted` | `core/auth-backend/src/hooks.ts:11` | lifecycle/cleanup signal | **keep** |
| `secrets.changed` | `core/secrets-backend/src/hooks.ts:12` (id `core/secrets-common/src/hooks.ts:12`) | sensitive metadata signal (value excluded — §5) | **keep** |
| `script-packages.changed` | `core/script-packages-backend/src/hooks.ts:18` | desired-state liveness signal | **keep** |
| `signal.internal.broadcast` / `.user` | `core/signal-backend/src/hooks.ts:8,16` | infra transport | **keep** |
| core platform hooks (`coreHooks`) | `core/backend-api/src/hooks.ts:34-126` | platform lifecycle | **keep** |
| `template` trigger (built-in, polling) | automation-backend built-in | polling trigger | **remove** (reactive `numeric_state`/`state` cover it) |

### 9.1 Satellite classification (definitive)

Satellite connection state is genuinely an entity: the in-memory connection map
(`core/satellite-backend/src/satellite-ws-handler.ts:106`, `.set` at `:179`,
`.delete` at `:337`) + the heartbeat monitor's online→offline transition
(`core/satellite-backend/src/heartbeat-monitor.ts:76`) ARE state with diffs.
Define a `satellite-connection` entity `{ status: "online"|"offline", region,
name, lastSeenAt }`. The three hooks become diffs of `status`. The persisted
`lastHeartbeatAt` column (`schema.ts:23`) stays as escape-hatched bookkeeping;
the entity's `status` is what's reactive. **Classification: entity.**

> **FINAL (§0).** The shipped `satellite-connection` entity is DURABLE, not
> in-memory-backed: its current state lives in the `connection_status` /
> `last_seen_at` / `last_connection_event` columns on the shared `satellites`
> table (added by migration), so it is globally readable from any pod (fixing a
> horizontal-scale read bug). The in-memory connection map is now ONLY the
> pod-local live-socket registry (`declareNonReactiveState`, bookkeeping), never
> the entity source. The shipped state also carries a `lastEvent` discriminator
> so the deriver can tell a socket drop (`disconnected`) from the heartbeat-lost
> offline edge (`heartbeat_lost`).

### 9.2 SLO classification (definitive — resolves the §14 borderline)

**Decision: the SLO budget IS the entity; `budget.warning/critical/exhausted` and
`streak.broken` become derived conditions, NOT separate semantic hooks.**

Rationale: warning/critical/exhausted are pure thresholds over one continuous
field (`budgetRemainingPercent`), and `streak.broken` is a transition of
`currentStreak` to a lower value. The SLO budget already lives in
`slo_streaks` + computed budget (`core/slo-backend/src/schema.ts:96-105` and the
engine). Modeling them as a `slo` entity `{ objectiveId, systemId, target,
budgetRemainingPercent, currentStreak, bestStreak }` lets operators author
`numeric_state` conditions (`budgetRemainingPercent < 20` etc.) reactively —
exactly the `extractNumericField`/`matchesThreshold` machinery
(`numeric.ts:32-43`) — instead of subscribing to four pre-baked threshold hooks.
This removes redundant threshold logic from the SLO plugin. `achievement.unlocked`
and `weekly.digest` stay (append-only / scheduled, not state diffs). **The migration
note must call out that downstream consumers of the four removed SLO hooks
re-author as conditions** (only in-repo consumer is notification routing via the
integration registry — re-pointed in the same effort).

### 9.3 Flapping classification (definitive)

`flapping_detected` (`core/healthcheck-backend/src/hooks.ts:116`) is a **derived
signal — KEEP**. It is computed over the unhealthy-transition log
(`health_check_unhealthy_transitions`, `core/healthcheck-backend/src/schema.ts:125-142`),
re-fires on every transition past the threshold, and is not a single mutable
state field. Operators who want reactive flapping use the generalized
`transitions_in_window` field on the health entity (already in scope via
`state-scope.ts:43-44`, authored as a `numeric_state` condition). The hook stays
for the "page once" debounced use case.

---

## 10. Current-state facts — entity-owning domains (migration target list)

For each state-owning domain: exact schema file + table(s), the service mutation
sites that write state + emit the to-be-removed hook today, and the target entity.

### 10.1 Incident — `core/incident-backend`

- Schema: `core/incident-backend/src/schema.ts` — `incidents`
  (`:33-44`, status `:37`, severity `:38`), junction `incident_systems`
  (`:49-60`), plus `incident_updates` / `incident_links` (NOT entity state).
- Write+emit sites (router): `core/incident-backend/src/router.ts:169`
  (`incidentCreated`), `:215` / `:269` (`incidentUpdated`), `:281` / `:346` / `:463`
  (`incidentResolved`), `:416` (`incidentCreated` from action path).
- Target entity: `incident` `{ status, severity, systemIds: string[] }`. `set` on
  create, `patch` on status/severity/systems change; `resolved` is `status="resolved"`.

### 10.2 Maintenance — `core/maintenance-backend`

- Schema: `core/maintenance-backend/src/schema.ts` — `maintenances`
  (`:23-35`, status `:30`, window `startAt/endAt` `:31-32`), junction
  `maintenance_systems` (`:40-51`).
- Write+emit sites: router `core/maintenance-backend/src/router.ts:165` (created),
  `:214` / `:260` / `:328` (updated); automation actions
  `core/maintenance-backend/src/automations.ts:221` (created), `:267` / `:310` / `:393`
  (updated). Both call `emitHook` (`automations.ts:169` injects the factory).
- Target entity: `maintenance` `{ status, systemIds, startAt, endAt }`.

### 10.3 Healthcheck system-health aggregate — `core/healthcheck-backend`

- Schema: `core/healthcheck-backend/src/schema.ts` — the aggregate is computed,
  with the transition log `health_check_state_transitions` (`:160-186`, lookup idx
  `:176`, recent idx `:182`) as the durable since/duration source (Phase 13).
- Write+emit sites: `core/healthcheck-backend/src/queue-executor.ts:958/973/990`
  and `:1130/1145/1162` (the two evaluation paths emit `systemHealthy` /
  `systemDegraded` / `systemHealthChanged`).
- Target entity: `health` `{ status, healthyChecks, totalChecks }` keyed by
  systemId. The transition log generalizes into the framework transition table
  (§15.1); the per-system since/duration comes from `inStateSince`/`inStateForMs`.
  `getBulkHealthState` (`state-scope.ts:156`) becomes the entity `getMany` resolver.

### 10.4 Catalog system + group — `core/catalog-backend`

- Schema: `core/catalog-backend/src/schema.ts` — `systems` (`:14-21`),
  `groups` (`:38-45`) (+ contacts/links/views, NOT entity state).
- Write+emit sites: `core/catalog-backend/src/router.ts:236` (systemCreated),
  `:284` (systemUpdated), `:311` (systemDeleted), `:326` (groupCreated), `:378`
  (groupDeleted); automation action `core/catalog-backend/src/automations.ts:189`
  (systemUpdated). Note `system.health_changed` is owned by healthcheck, NOT
  catalog (`core/catalog-backend/src/automations.ts:12`).
- Target entities: `catalog-system` `{ name, description, metadata }` and
  `catalog-group` `{ name, metadata }`.

### 10.5 Dependency edge — `core/dependency-backend`

- Schema: `core/dependency-backend/src/schema.ts` — `dependencies`
  (`:24-42`, impactType `:30`, unique edge `:37`). `dependency_derived_states`
  (`:78-82`) is a cursor (escape-hatch, §5). `node_positions` is UI state.
- Write+emit sites: router `core/dependency-backend/src/router.ts:197` (created),
  `:239` (updated), `:267` (deleted); automation actions
  `core/dependency-backend/src/automations.ts:210` (created), `:264` (deleted).
  `impactPropagated` emitted via `core/dependency-backend/src/index.ts:126` (KEEP).
- Target entity: `dependency-edge` `{ sourceSystemId, targetSystemId, impactType,
  transitive }` keyed by dependency id.

### 10.6 Satellite connection state — `core/satellite-backend`

- Schema: `core/satellite-backend/src/schema.ts` — `satellites` (`:14-27`).
  Connection liveness is in-memory (`satellite-ws-handler.ts:106`), not a column.
  `lastHeartbeatAt` (`:23`) is bookkeeping (escape-hatch).
- Write+emit sites: connected `satellite-ws-handler.ts:185`; disconnected `:345`;
  heartbeat-lost `core/satellite-backend/src/heartbeat-monitor.ts:76`.
- Target entity: `satellite-connection` `{ status: "online"|"offline", name,
  region, lastSeenAt }` keyed by satelliteId (see §9.1).

### 10.7 SLO budget — `core/slo-backend`

- Schema: `core/slo-backend/src/schema.ts` — `slo_objectives` (`:19-38`),
  `slo_streaks` (`:96-105`, currentStreak `:101`, bestStreak `:102`). Budget
  computed by the engine. `slo_downtime_events` / `slo_daily_snapshots` are
  event-sourced history (escape-hatch, not the live entity).
- Write+emit sites: integration-event registration with hook refs at
  `core/slo-backend/src/index.ts:109-164` (budget warning/critical/exhausted,
  streak broken, achievement unlocked); the engine emits them when budget/streak
  recompute. Weekly digest at `core/slo-backend/src/weekly-digest.ts:128`.
- Target entity: `slo` `{ objectiveId, systemId, target, budgetRemainingPercent,
  currentStreak, bestStreak }` keyed by objectiveId (see §9.2).

---

## 11. Testing doctrine

- **Unit lane (fakes, default, fast):** all logic + happy paths — `defineEntity`
  diff/emit/no-op, reference extraction (all grammar shapes in §8.3 + the
  wildcard fallback), wake-index intersection lookups, Stage-1 routing, Stage-2
  fan-out, condition eval (reuse `structured-conditions.test.ts`,
  `numeric.test.ts`), scope projection, masking (reuse `run-state-masking.test.ts`,
  `scope-artifact-masking.test.ts`), per-domain migration mapping. The bulk of
  coverage. Run with `bun test` (`testing.md`).
- **Integration lane (real Postgres + real Redis/BullMQ, env-gated, surgical):**
  ONLY assertions verifying our code against real third-party runtime semantics
  fakes cannot model. Fixed minimal set (§14 for exact targets):
  1. Advisory-lock connection affinity + release (the H2 class).
  2. Concurrent dwell `DELETE…RETURNING` / `pg_advisory_xact_lock` → exactly one wins.
  3. Wake-index partial-unique / `ON CONFLICT` arm race under concurrent inserts.
  4. BullMQ consumer-group exactly-once (two workers, one event, once).
  5. BullMQ stalled-job redelivery (worker dies holding a job → another picks up).
- **Harness:** `*.it.test.ts` behind an env flag, dedicated CI job (§14). Never
  in the default `bun test`.
- **No pg-mem.**

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Under-extracted state refs → a wait never wakes (silent stuck) | Rigorous, tested reference extraction (§8.3) + the `state.<kind>:*` wildcard fallback + the durable timeout timer backstop; never silent |
| At-least-once delivery → double-execute | Keep all idempotency guards (per-run advisory lock `run-state-store.ts:194`, dedupe, atomic dwell claim `dwell-store.ts:121`) — necessary, not redundant |
| BullMQ job-lock expiry on long dispatch → redelivery double-fire | Short Stage-2 jobs (one run); lock renewal (§15.4); long work suspends rather than blocks |
| Big-bang migration regresses a domain's behavior | Behavior-preserving refactor; full unit suite + surgical integration tests; phased internally (§16) |
| Breaking hook removal breaks downstream subscribers | Inventory-first (§9); changesets flag every removed hook; in-repo consumers migrated same effort |
| Wake-index cardinality / hot keys | Indexed `ref` intersection (§8.1); high-frequency samples escape-hatched not entities (§5); wildcard refs only on extraction uncertainty |
| Fakes drift from real BullMQ/PG semantics | The surgical integration lane (§14) pins the seams fakes can't model |
| Secret value leaking into entity store / change event | Entity writes run `maskDeep` for the owning run (§4.3); secrets are an escape-hatch class (§5); reseed on resume (§3.5) |

---

## 13. Two-stage queue — concrete spec

### 13.1 Queue + hook names

| Stage | Transport | Name / group | Reuses |
|---|---|---|---|
| Emit | hook | `ENTITY_CHANGED` (internal `createHook`, automation-backend) | §3.1 |
| Stage 1 route | `onHook` work-queue | `workerGroup: "automation-entity-route"` | `event-bus.ts:113-131` |
| Stage 2 dispatch | queue | `automation-dispatch`, `consumerGroup: "automation-dispatch-run"` | `queue.ts:27`, BullMQ `:126` |
| Timeout | queue job | `startDelay` to `timeoutAt`, on `automation-dispatch` (or a dedicated `automation-wait-timeout` queue) | `queue.ts:5-20` |

### 13.2 Message payload schemas (zod, in `core/automation-common`)

```ts
// Stage-1 input = the ENTITY_CHANGED hook payload
export const EntityChangedSchema = z.object({
  kind: z.string(),
  id: z.string(),
  prev: z.record(z.unknown()).nullable(),   // null on create
  next: z.record(z.unknown()).nullable(),   // null on remove (tombstone)
  delta: z.record(z.unknown()),             // changed fields only
  changedFields: z.array(z.string()),
  actor: ActorSchema,                        // from HookEventMeta (hooks.ts:20)
  occurredAt: z.string(),                    // ISO
});

// Stage-2 per-run dispatch job
export const DispatchJobSchema = z.discriminatedUnion("reason", [
  z.object({                                 // fresh run from a trigger match
    reason: z.literal("trigger"),
    automationId: z.string(),
    triggerId: z.string(),
    ref: z.string(),                         // `${kind}:${id}`
    changed: EntityChangedSchema,
  }),
  z.object({                                 // resume a suspended wait_until
    reason: z.literal("wake"),
    runId: z.string(),
    waitLockId: z.string(),
    ref: z.string(),
    changed: EntityChangedSchema,
  }),
]);
```

### 13.3 Consumer-group wiring

- Stage 1: `onHook(ENTITY_CHANGED, handler, { mode: "work-queue", workerGroup: "automation-entity-route" })`
  in `afterPluginsReady` (the only place `onHook` is injected,
  `plugin-loader.ts:558`). Exactly-one-instance claim is the existing semantic
  (`event-bus.ts:128`).
- Stage 2: `queueManager.getQueue("automation-dispatch").consume(handler, { consumerGroup: "automation-dispatch-run", maxRetries: 3 })`,
  mirroring the existing delay consumer (`dispatch/delay-queue.ts`) and
  wait-until consumer (`wait-until-queue.ts:43-94`). The handler routes on
  `reason` to `dispatchTrigger` or `resumeRun` (`engine.ts`).

---

## 14. Integration harness — concrete spec

### 14.1 `docker-compose-dev.yml` — add Redis

Add alongside the existing `postgres` service (`docker-compose-dev.yml:4-11`):

```yaml
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
```

### 14.2 Env flag + file convention

- Flag: `CHECKSTACK_IT=1` gates the integration lane. `*.it.test.ts` files
  `describe.skipIf(!process.env.CHECKSTACK_IT)(...)` so the default `bun test`
  (CI `pr-checks.yml:131`) never runs them. No `*.it.test.ts` exist today
  (greenfield convention).
- Connection env: `CHECKSTACK_IT_PG_URL`, `CHECKSTACK_IT_REDIS_URL` (default to the
  compose ports).

### 14.3 CI job shape

Add an `integration` job to `.github/workflows/pr-checks.yml` (mirror the `test`
job at `:115-150`), with `services: { postgres, redis }`, run
`CHECKSTACK_IT=1 bun test --filter '*.it.test.ts'`, upload output, and add it to
`report.needs` (`:208`). Keep it a separate job so the fast lane stays fast.

### 14.4 The 5 tests — exact target + assertion

| # | File | Target | Assertion |
|---|---|---|---|
| 1 | `core/backend-api/src/advisory-lock.it.test.ts` | `createAdvisoryLockService` (`advisory-lock.ts:78`) | Two `tryAcquire(sameKey)` on real PG: first returns handle, second returns `null`; after `release()` the third succeeds; killing the holding connection auto-releases. |
| 2 | `core/automation-backend/src/dispatch/dwell.it.test.ts` | dwell `delete` claim (`dwell-store.ts:121`) | Two concurrent `delete(id)` on real PG → exactly one returns a row (`RETURNING`), the other empty. |
| 3 | `core/automation-backend/src/entity/wake-index.it.test.ts` | wake-index insert (§8.2) | Concurrent inserts of the same `(waitLockId, ref)` under `ON CONFLICT DO NOTHING` → exactly one row; intersection lookup returns the wait. |
| 4 | `core/automation-backend/src/dispatch/stage1.it.test.ts` | Stage-1 work-queue (`workerGroup: "automation-entity-route"`) | Two workers, one `ENTITY_CHANGED` emit on real Redis/BullMQ → handler runs exactly once. |
| 5 | `core/automation-backend/src/dispatch/stage2-stalled.it.test.ts` | BullMQ stalled redelivery on `automation-dispatch` | A Stage-2 worker that dies holding a job → after lock expiry another worker redelivers and completes it once. Load-bearing for §15.5. |

---

## 15. Resolved open items (was §14 "open")

### 15.1 Entity-store layout — DECIDED: generic keyed store + generic transition log

> **REVISED for Model B, then FINALIZED (§0).** The `entity_transitions` table
> below ships unchanged and is the framework's ONLY persistent store: it holds the
> change HISTORY for every kind. The `entity_state` table below is REMOVED — it
> never shipped as the universal store and, in the final design, does not ship at
> all. Under Model B each plugin owns its current state (its own table) or
> computes it on read from its own durable data, and exposes a `read` accessor.
> The `createKeyedStore` opt-in that an intermediate revision kept for "homeless"
> kinds was deleted along with the `entity_state` table (the `health` aggregate
> is now compute-on-read over `health_check_runs`, not keyed-store-backed). The
> "declarable indexes map onto the generic store" mechanism is dropped — there is
> no `indexes` option and no per-kind expression indexes. Read the `entity_state`
> block below as historical record of a table that was designed but never shipped.

A **single generic keyed store** (one table for all kinds), NOT per-kind tables.

```ts
// core/automation-backend/src/schema.ts (NEW)
export const entityState = pgTable(
  "entity_state",
  {
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    /** Full validated state (zod-parsed before write). */
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.kind, t.entityId] }) }),
);

export const entityTransitions = pgTable(
  "entity_transitions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value").notNull(),
    transitionedAt: timestamp("transitioned_at").defaultNow().notNull(),
  },
  (t) => ({
    // generalizes health_check_state_transitions lookup idx (healthcheck schema.ts:176)
    lookupIdx: index("entity_transitions_lookup_idx").on(
      t.kind, t.entityId, t.field, t.transitionedAt,
    ),
  }),
);
```

**Rationale:** (a) the platform owns ONE schema, so a new entity kind needs zero
migrations (decision §2.1); (b) the wake-index, Stage-1 routing, and scope
enrichment are all kind-agnostic, so a uniform row shape keeps them simple; (c)
jsonb `$type` is the established pattern in this repo (`healthcheck/schema.ts:45-47`,
the `automation_run_state.scopeSnapshot`, `:269+`). **Declarable indexes map onto
the generic store as Postgres expression indexes on `state->>'field'`** generated
by the `defineEntity` impl at load time (Phase 1/2), one expression index per
`EntityIndexSpec`, named `entity_state_<kind>_<name>_idx`. Per-kind physical
tables were rejected: they reintroduce per-domain migrations and special-case the
generic pipeline for no query-planner win at this scale (entity counts are
operator-scale: thousands, not millions).

### 15.2 SLO classification — DECIDED (see §9.2): SLO budget is the entity; thresholds become derived conditions.

### 15.3 Wake-index storage + extraction grammar — DECIDED (see §8): child table
`automation_wake_index(ref)` with an intersection join; grammar covers structured
`state`/`numeric_state` + template member-expressions; `state.<kind>:*` wildcard
fallback when uncertain.

### 15.4 BullMQ job-lock renewal + durations — DECIDED

The BullMQ worker currently sets no `lockDuration` (`bullmq-queue.ts:139-155`), so
the default 30s lock + 30s stalled check + 1 maxStalledCount apply. Decision:
- Keep Stage-2 jobs **short** (one run; any `delay`/`wait_until` suspends and
  releases the job — they already persist a wait lock and return, `engine.ts`).
- Set explicit `lockDuration: 30_000` and rely on BullMQ's **automatic lock
  renewal** (the worker renews at `lockDuration/2` while the processor promise is
  pending — no manual `extendLock` needed for our short jobs). Set
  `stalledInterval: 30_000`, `maxStalledCount: 1` explicitly (make the defaults
  intentional) in `bullmq-queue.ts` worker options.
- No job is allowed to block longer than `lockDuration`; the suspend-on-wait
  invariant guarantees this. This is asserted by IT test #5 (§14.4).

### 15.5 Per-run advisory lock vs Stage-2 job lock — DECIDED: keep BOTH (different scopes)

The BullMQ job lock guards "one worker processes this *job*"; the per-run Postgres
advisory lock (`run-state-store.ts:194`) guards "one instance walks this *run*"
across ALL wake paths (Stage-2 dispatch, the stalled sweeper, a manual run, a wake
event). These are not interchangeable: redelivery of a Stage-2 job after a crash,
plus a concurrent sweeper recovery, can both target the same run — only the
advisory lock serializes them. Replacing the advisory lock with the job lock would
leave the sweeper/manual/wake paths unguarded. **Keep both.** The advisory lock
stays the single serialization point for `resumeRun`/`recoverStalledRun`; the job
lock only prevents duplicate Stage-2 workers on the same job.

### 15.6 Escape-hatch declaration API + lint rule — DECIDED

```ts
// returned from defineEntity's sibling, on the entity extension point
declareNonReactiveState(input: {
  /** Drizzle table object or table name the data lives in. */
  table: string;
  /** One of the §5 classes — forces the author to pick a reason. */
  reason: "raw-sample" | "sensitive" | "externally-owned" | "bookkeeping";
  /** Free-text justification surfaced in the lint message + docs. */
  note: string;
}): void;
```

- The lint rule (`eslint-plugin-checkstack`, a new rule
  `no-unmanaged-entity-state`) flags: (a) a `createHook` whose id matches a
  removed-hook naming shape (`*.created/.updated/.deleted/.changed/.resolved`) in
  a backend plugin, and (b) direct `db.update`/`db.insert` writes to a column of a
  migrated domain's former state table. It consumes the set of
  `declareNonReactiveState({ table })` calls (collected at lint time from a
  generated manifest, or via a project-config allowlist of table names) to
  suppress matches on declared-non-reactive tables. Severity per the project's
  config — not escalated (`code-style-guide.md`).

---

## 16. Phasing (Big Bang, but internally ordered, individually shippable)

Each step is a self-contained PR with its own changeset + tests; later steps
depend on earlier ones.

1. **Integration harness** — add Redis to `docker-compose-dev.yml`; add the
   `integration` CI job to `.github/workflows/pr-checks.yml`; scaffold the 5
   `*.it.test.ts` files (§14). *Touches:* `docker-compose-dev.yml`,
   `.github/workflows/pr-checks.yml`, the 5 test files.
2. **Entity state machine core** — `defineEntity` + `declareNonReactiveState`
   extension point, generic `entity_state` + `entity_transitions` tables +
   migration, the `ENTITY_CHANGED` hook, diff/emit/transition logic, the
   generalized scope enrichment, declarable expression-index generation. *Touches:*
   `core/automation-backend/src/entity/*` (new), `core/automation-backend/src/schema.ts`,
   `core/automation-backend/drizzle/*` (new migration), `core/automation-common/src/schemas.ts`
   (`EntityChangedSchema`, `DispatchJobSchema`), `core/automation-backend/src/dispatch/state-scope.ts`.
3. **Enforcement** — load-time validation in the `defineEntity` impl; the
   `no-unmanaged-entity-state` lint rule. *Touches:* `core/automation-backend/src/entity/*`,
   the eslint plugin package.
4. **Migrate all state-owning domains** to `defineEntity` (Big Bang, §10);
   service mutations route through the handle; remove the entity hooks (§9), keep
   the non-entity ones; SLO thresholds re-authored as derived conditions (§9.2).
   *Touches:* `core/{incident,maintenance,healthcheck,catalog,dependency,satellite,slo}-backend/src/*`
   (router.ts, automations.ts, index.ts, hooks.ts, queue-executor.ts per §10) +
   each plugin's changeset (`BREAKING CHANGES:` for removed hooks).
5. **Reactive dispatch pipeline** — two-stage `ENTITY_CHANGED`→route→dispatch
   queues (§13); reactive `wait_until` via the wake-index (§8); add
   `automation_wake_index` table + migration; remove `wait-until-queue.ts` and the
   sweeper's `until` re-tick; remove the `template` trigger. *Touches:*
   `core/automation-backend/src/dispatch/{engine.ts,trigger-subscriber.ts,run-state.ts,stalled-sweeper.ts}`,
   delete `wait-until-queue.ts`, `core/automation-backend/src/schema.ts` + migration,
   `core/automation-backend/src/builtin-triggers.ts`.
6. **Durability consolidation** — set explicit BullMQ `lockDuration`/`stalledInterval`/
   `maxStalledCount` (§15.4); confirm BOTH locks retained (§15.5); lean on stalled
   redelivery for in-flight crash recovery (keep the heartbeat sweeper for runs
   that hold no job). *Touches:* `plugins/queue-bullmq-backend/src/bullmq-queue.ts`,
   `core/automation-backend/src/dispatch/stalled-sweeper.ts`.
7. **Docs + changesets** — `defineEntity` + escape-hatch plugin-author guide under
   `docs/src/content/docs/`; breaking-change notes; testing doctrine. *Touches:*
   `docs/src/content/docs/*`, `.changeset/*`.

---

## 17. Durability consolidation (detail)

Reactive + queue-driven lets us shrink the custom durability code:
- **In-flight crash recovery → BullMQ stalled-job redelivery.** A Stage-2 dispatch
  job whose worker dies is redelivered after lock expiry (§15.4). Retires most of
  the custom heartbeat sweeper for *running* work (proven by IT test #5).
- **Suspended runs need no heartbeat.** They are durable wait-locks woken by
  events; nothing to sweep. The only failure mode — "wake event missed before the
  run was registered as waiting" — is handled by a re-evaluate-on-registration
  guard + the durable wait-lock (the desired state survives).
- **Idempotency guards stay** (§12): per-run advisory lock, dedupe, atomic dwell
  claim. Work-queue is at-least-once.
- **Job-lock duration vs long dispatch:** Stage-2 jobs are short (one run); long
  actions suspend (delay/wait) rather than block (§15.4).

---

## 18. Cross-cutting (repo rules)

- No `any`, no `eslint-disable`; zod 4; typed object args.
  `bun run typecheck:references:generate` after dep changes (`typecheck.md`).
  Changesets per package (beta = minor, `BREAKING CHANGES:` for the hook removals +
  the move to plugin-backed reactive entities — see §0). Docs under
  `docs/src/content/docs/` in the same effort.
  No em-dashes. Conventional commits. Run `bun run typecheck` + `bun run lint` +
  `bun test` before declaring any step done.
