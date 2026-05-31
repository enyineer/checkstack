# Reactive automation engine + unified entity state machine

> **Status:** planned (design locked 2026-05-31, not started)
> **Branch:** TBD (off `integration/automation+script-editor`, or `main` once that lands)
> **Goal:** make the automation engine **fully reactive** — no polling of state to
> detect conditions — and introduce a single, enforced **entity state machine**
> that every plugin uses to expose reactive state. State changes flow through a
> work-queue pipeline; triggers and waiting automations react to them; only one
> instance claims each event and fans dispatch out across instances. Designed for
> horizontal scale.

Self-contained handoff. Pick up from this document alone.

---

## 1. Why

- **Polling doesn't scale horizontally.** The current `wait_until` and the
  `template` trigger re-evaluate conditions on a timer; with N pods this is N×
  redundant work, and it grows with the number of in-flight waits. Eliminate
  condition/state polling entirely.
- **State handling is fragmented.** Incident, maintenance, health, SLO,
  dependency, catalog, satellite each reimplement their own slice of "store
  entity state + emit an ad-hoc change hook + (sometimes) expose a current-state
  query." Phase 13 hand-built health-transition tracking; everyone else lacks it.
  Unify this into one primitive with great plugin DX.
- **Make the right way the only way.** Plugin authors should hook into one shared
  state machine; the platform hides the queue / event / wake-index complexity;
  off-pattern entity state is structurally non-reactive (and therefore invisible
  to automations), so compliance is the path of least resistance.

---

## 2. Locked decisions

1. **Framework-owned entity storage.** The platform owns the entity-state store;
   plugins declare entities and mutate through a returned handle. No plugin-owned
   entity table. (Indexes/derived queries are declarable through the entity API so
   flexibility isn't lost.)
2. **Explicit, reason-annotated escape hatch** for data that is intentionally NOT
   a reactive entity (see §5). Its purpose is to *enable strict enforcement* —
   declare intent so enforcement can flag everything unmarked.
3. **Breaking + clean hook migration.** Entity-state-change hooks are removed and
   replaced by the entity's auto-emitted change events (breaking). Non-entity
   hooks (scheduled reports, action outcomes, derived signals, time ticks) are
   kept. A full **hook inventory comes first** (§8) to classify every hook.
4. **Big Bang migration.** All state-owning domains move to the entity state
   machine in this effort (not incremental).
5. **Testing doctrine (§9):** unit/fakes for all logic + happy paths (default,
   fast lane); a **surgical** real-services integration lane (real Postgres + real
   Redis/BullMQ, env-gated) for ONLY the handful of external-runtime-contract
   assertions fakes cannot model. No pg-mem (half-fidelity middle tier rejected).
6. **No polling of state.** Time-driven timers (`delay`, `for:` dwell, `cron`/
   `interval` triggers) are kept — they are not state-polling. The `template`
   trigger (polls a condition) is **removed** (its real cases are covered by the
   reactive `numeric_state`/`state` triggers).

---

## 3. Core primitive — the entity state machine (`defineEntity`)

One declaration; everything derived. The returned handle is the **only** typed
path to reactive state.

```ts
const incident = defineEntity({
  kind: "incident",
  // zod = single source of truth: typing, validation, scope projection,
  // UI/editor introspection, change-event shape.
  state: z.object({ status: IncidentStatus, severity: Severity, systemIds: z.array(z.string()) }),
  indexes: [/* declarable secondary indexes */],
});

await incident.set(id, next);     // persist + diff + (if changed) emit change(kind:id, delta)
await incident.patch(id, partial); //   + project to scope + update wake-index + record transition
incident.get(id);
```

From `defineEntity` the platform **auto-derives all** of:
- **Storage** in the framework-owned entity store (no plugin migration for entity state).
- **Validation** (zod) on every write.
- **Change event**, keyed by `kind:id`, emitted only on an actual diff (no-op if unchanged), carrying the delta.
- **Scope projection** — `state.<kind>.<id>.<field>` available to conditions/templates uniformly.
- **Wake-index** entry so suspended waits referencing this entity are woken on change.
- **Transition tracking for free** — `in-state-since`, `in-state-for-ms`,
  transition-count/window — generalizing Phase 13's health-specific transitions to
  every entity (a platform entity-transition log).

DX win: each of incident/maintenance/health/etc. stops reimplementing storage +
ad-hoc hook + current-state query + since/duration; one declaration replaces all.

---

## 4. Generic reactive state model (domain-agnostic)

There is nothing health- or system-specific in the engine. The reactive unit is a
generic **state reference** `state.<kind>.<id>[.<field>]`. Health is one `kind`;
incident, maintenance, slo, dependency, catalog, satellite, and **plugin-custom**
kinds are just more.

- **State sources** are registered via `defineEntity` (an extension point). Each
  provides a resolver (current state by ref, for scope pre-resolution + wake
  re-evaluation) and its change events (auto-derived).
- **Reference extraction is uniform:** parse a condition/template, extract every
  `state.*` reference it touches, regardless of kind. (No domain baked in — under-
  extraction means a wait never wakes, so this needs the same rigor as the dwell
  arming logic; covered by tests.)
- **Wake-index is over arbitrary keys.** A suspended wait records its full
  dependency set (any kinds); the router wakes any wait whose set intersects a
  changed key.
- **Plugin-custom state sources are first-class from day one** — the whole point
  of the generality.

---

## 5. The escape hatch (enables strict enforcement)

Data that looks like state but is intentionally **not** a reactive entity must be
declared as such, with a reason. This is what lets enforcement be strict on
everything unmarked. Legitimate classes:
- **High-frequency / high-cardinality raw samples** (e.g. raw healthcheck run
  rows) — the *aggregate* is the entity; raw samples are not (a firehose would
  melt the wake-index).
- **Sensitive values** (secret values) — must never enter reactive scope/change
  events (leak surface; see the secrets masking work). Metadata may be an entity;
  the value is excluded.
- **Externally-owned state we cannot observe** (e.g. a Jira issue's live status) —
  no change event without polling (the antipattern); model the artifact we
  created, not a pretend-live entity.
- **Internal operational bookkeeping** (cursors, caches, heartbeat timestamps).

Shape: an explicit, reason-carrying declaration (not a soft "skip" flag). Default
is "entity state ⇒ `defineEntity`"; the hatch is the annotated exception.

---

## 6. Enforcement — make the right way the only *reactive* way

Layered, structural-first (carrot + structural stick, not blanket rejection):
1. **Structural (primary):** no typed path emits an entity-change event or exposes
   entity state into scope except through `defineEntity`. Off-pattern entity state
   is non-reactive by construction — invisible to automations/conditions/UI.
2. **Framework-owned storage:** entity state lives in the platform store, so there
   is no table to hand-roll for it.
3. **Load-time validation:** the loader hard-fails a *malformed* entity
   registration (bad schema / missing identity).
4. **Lint backstop:** a custom rule flags manual change-ish hook emits or direct
   entity-state writes once the API exists; the escape-hatch annotation suppresses
   false positives on legitimate non-entity data.

Not doing: blanket "plugin won't load if it has any non-conforming data" — that
punishes legitimate non-entity data. The stick is "your entity isn't reactive,"
except for malformed registrations.

---

## 7. Reactive dispatch pipeline (the two-stage queue)

State changes drive everything through the existing hook/work-queue infra,
generalized:

- **Stage 1 — route (one instance claims):** a state-change event lands on a
  work-queue (`mode: "work-queue"`, one instance per group). The claimer does only
  cheap, indexed routing: find interested **triggers** (automations subscribed to
  this event — existing) **+ waiting runs** whose wake-index dependency set
  includes this changed ref (new).
- **Stage 2 — dispatch fan-out:** for each interested automation/run, enqueue a
  per-run job onto a second work-queue; any instance executes one run. Spreads
  execution load; keeps stage 1 fast.

**Reactive `wait_until`:** on suspend, extract the referenced state refs, register
the wait-lock in the wake-index against those refs, persist; the run is a durable
wait-lock with **no active job and no polling**. A relevant state-change event
wakes it (stage 1 → re-enrich the referenced state → sync re-evaluate the
condition → resume if true). A single durable **timeout timer** (queue job at the
deadline) handles timeout — one deadline, not a re-check loop. Time-boundary
conditions use a timer at the boundary. Remove the poll re-check job + the sweeper
condition re-tick entirely.

**`template` trigger removed.** `numeric_state` + `state` triggers cover the real
reactive cases.

**Kept (not polling):** `delay`, `for:` dwell, `cron`/`interval` triggers, timeout
timers.

---

## 8. Durability consolidation

Reactive + queue-driven lets us *shrink* the custom durability code:
- **In-flight crash recovery → BullMQ stalled-job redelivery.** A stage-2 dispatch
  job whose worker dies is redelivered by BullMQ after lock expiry. This retires
  most of the custom heartbeat sweeper for *running* work. (Must be proven against
  real Redis — §9 test 5.)
- **Suspended runs need no heartbeat.** They are durable wait-locks woken by
  events; nothing to sweep. Failure mode is only "wake event missed before the run
  was registered as waiting" → handled by a re-evaluate-on-registration guard +
  the durable wait-lock (the desired state survives).
- **Idempotency guards stay.** Work-queue is at-least-once (retries), so the
  hardened guards remain necessary: per-run advisory lock / job-lock on resume,
  dedupe, atomic dwell `DELETE…RETURNING` claim, and the C1/H1 fixes.
- **Job-lock duration vs long dispatch:** keep stage-2 jobs short (one run) + renew
  the lock; long actions already suspend (delay/wait) rather than block.

---

## 9. Hook inventory + breaking migration (Big Bang)

**First task before any code:** enumerate every hook across all plugins and
classify. First-pass (to be finalized by a grep of `*/src/hooks.ts`):

| Hook(s) | Class | Disposition |
|---|---|---|
| `incident.created/updated/resolved` | entity-state-change (incident.status) | **remove**, replaced by incident entity change events |
| `maintenance.created/updated` | entity (maintenance window) | **remove**, replaced by entity change |
| `healthcheck.system.degraded/healthy/health_changed` | entity (system aggregate health) | **remove**, replaced by entity change |
| `catalog.system.created/updated/deleted` | entity (catalog system) | **remove**, replaced by entity change |
| `dependency.created/updated/deleted` | entity (dependency edge) | **remove**, replaced by entity change |
| `satellite.connected/disconnected/heartbeat_lost` | entity (satellite connection state) | **remove**, replaced by entity change |
| `slo.budget.warning/critical/exhausted`, `slo.streak.broken` | derived edges over the SLO budget entity | SLO budget is the entity; these become derived conditions OR kept as semantic events — **decide in inventory** |
| `healthcheck.check.completed` | non-entity (high-frequency raw sample) | **keep** (escape-hatch class; also a wake source for numeric conditions) |
| `healthcheck.flapping_detected` | derived signal | **keep** |
| `notification.delivered/failed` | action outcome | **keep** |
| `slo.weekly.digest` | scheduled report | **keep** |
| `slo.achievement.unlocked` | one-shot event | **keep** |
| `time.cron/interval` | time trigger | **keep** |
| `time.template` (poll) | polling trigger | **remove** (reactive numeric_state/state cover it) |

Migration: all entity domains refactor to `defineEntity` in one effort; service
mutations route through the entity handle (auto-emit + auto-wake); the removed
hooks are a breaking change (changesets note it). Behavior must be preserved
(tests are the safety net).

---

## 10. Testing doctrine

- **Unit lane (fakes, default, fast):** all logic + happy paths — `defineEntity`
  behavior, reference extraction, wake-index lookups, stage-1 routing, stage-2
  fan-out logic, condition eval, scope projection, masking, migration mapping. The
  bulk of coverage.
- **Integration lane (real Postgres + real Redis/BullMQ, env-gated, surgical):**
  ONLY assertions that verify our code against real third-party runtime semantics
  fakes cannot model — "test what we expect might break at the boundary." Fixed
  minimal set:
  1. Advisory-lock connection affinity + release (same pooled session; auto-release
     on connection death) — the H2 class; covers installer election, GC-vs-install,
     per-run resume lock, migration resumer, incident dedupe, the concurrency lock.
  2. Two concurrent transactions racing the dwell `DELETE…RETURNING` /
     `pg_advisory_xact_lock` → exactly one wins.
  3. Partial-unique-index / `ON CONFLICT` arm race under concurrent inserts.
  4. BullMQ consumer-group exactly-once (two workers, one event, once).
  5. BullMQ stalled-job redelivery (worker dies holding a job → another picks it up)
     — load-bearing for the "crash recovery for free" simplification.
- **Harness:** `*.it.test.ts` behind an env flag, run in a dedicated CI job using
  `docker-compose-dev.yml` (+ a Redis service). Never in the default `bun test`.
- **No pg-mem.**

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Under-extracted state refs → a wait never wakes (silent stuck) | Rigorous, tested reference extraction + a re-evaluate-on-registration guard; the timeout timer is a backstop |
| At-least-once delivery → double-execute | Keep all idempotency guards (advisory/job lock, dedupe, atomic claim) — they are necessary, not redundant |
| BullMQ job-lock expiry on long dispatch → redelivery double-fire | Short stage-2 jobs (one run); lock renewal; long work suspends rather than blocks |
| Big-bang migration regresses a domain's behavior | Behavior-preserving refactor; full unit suite + the surgical integration tests; phased internally (harness → SM → migrate → pipeline) |
| Breaking hook removal breaks downstream subscribers | Inventory-first; changesets flag every removed hook; downstream within the repo migrated in the same effort |
| Wake-index cardinality / hot keys | Indexed key-intersection lookup; namespace/key design kept tight; high-frequency samples are escape-hatched, not entities |
| Fakes drift from real BullMQ/PG semantics | The surgical integration lane exists precisely to pin the seams fakes can't model |

---

## 12. Phasing (Big Bang, but internally ordered)

1. **Integration harness first** (the 5 real-services tests' scaffolding) — so the
   re-architecture lands against high-fidelity boundary tests from the start.
2. **Entity state machine + state-source model + framework storage + enforcement**
   (`defineEntity`, scope projection, transition tracking, wake-index, lint rule).
3. **Migrate all state-owning domains** to `defineEntity` (Big Bang); hook inventory
   executed; entity hooks removed, non-entity kept.
4. **Reactive dispatch pipeline** — two-stage event→route→dispatch queues; reactive
   `wait_until` via wake-index; remove the poll re-check + sweeper condition re-tick;
   remove the `template` trigger.
5. **Durability consolidation** — lean on BullMQ stalled-job redelivery; retire the
   custom heartbeat sweeper for in-flight work; keep idempotency guards.
6. **Docs + changesets** — plugin-author guide for `defineEntity` + the escape hatch;
   breaking-change notes; the testing doctrine.

---

## 13. Cross-cutting (repo rules)

- No `any`, no `eslint-disable`; zod 4; typed object args. `typecheck:references:generate`
  after dep changes. Changesets per package (beta = minor, `BREAKING CHANGES:` for the
  hook removals + framework-owned storage). Docs under `docs/src/content/docs/` in the
  same effort. No em-dashes. Conventional commits.

## 14. Open items to resolve during implementation

- Exact entity-store schema/layout (one table per kind vs a generic keyed store) and
  how declarable indexes map onto it.
- Final SLO hook classification (derived-condition vs kept semantic event).
- Wake-index storage + the reference-extraction grammar coverage (which condition/
  template shapes are supported; fallback when extraction is uncertain).
- BullMQ job-lock renewal mechanism + chosen lock durations.
- Whether the per-run advisory lock can be fully replaced by the stage-2 job lock,
  or both are retained.
- The escape-hatch declaration's concrete API shape + how the lint rule consumes it.
