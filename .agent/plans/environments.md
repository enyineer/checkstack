# Environments — instance-wide, many-to-many with systems, custom fields in health-check templating

> **Status:** planned (design drafted 2026-06-01, not started)
> **Branch:** off `main` (or the current integration branch once it lands)
> **Issue:** #248
> **Goal:** a first-class, instance-global **Environment** concept. An environment
> carries arbitrary **custom fields** (`baseUrl`, `region`, `tier`, ...). Any system
> belongs to **multiple** environments (many-to-many). A health check **fans out
> into one run per environment** (the env set is selected per assignment), and an
> environment's custom fields become available in **health-check config templating**
> (`{{ environment.baseUrl }}`) and in script collectors (`CHECKSTACK_ENV_*` /
> `globalThis.context.environment`), so one check configuration covers N environments
> without duplication.

Self-contained handoff. Every current-state claim carries a `file:line` anchor
verified against the tree at draft time. Pick up from this document alone.

---

## 1. Why

- **Static connection details force check duplication.** The HTTP collector takes
  a literal `url: z.string().url()`
  (`plugins/healthcheck-http-backend/src/request-collector.ts:30`). Monitoring "the
  same service in staging and prod" today means cloning the whole check with
  hand-edited URLs.
- **No environment primitive exists.** Verified: every `environment` match in the
  backend is `process.env` / editor false-positive. There is no table, schema,
  GitOps kind, or run-context field for it.
- **All building blocks already exist.** The catalog provides free-form `metadata`
  (`core/catalog-backend/src/schema.ts:18`, `:42`), a many-to-many join precedent
  (`systems_groups`, `:47-60`), GitOps kind + kind-extension registration
  (`core/catalog-backend/src/index.ts:161`, `:201`), and a curated run-context that
  already threads into every collector
  (`core/backend-api/src/collector-strategy.ts:24-27`, built at
  `core/healthcheck-backend/src/queue-executor.ts:513-520`). The feature is an
  additive composition of these patterns plus a templating-context extension and a
  per-environment run dimension — not new infrastructure.

---

## 2. Locked decisions (the resolution model)

These are decided in the issue and reaffirmed here. Open questions with recommended
decisions are in §11 (flagged where user sign-off is required).

1. **Per-environment fan-out, selected per assignment.** The health-check
   *assignment* row (`systemHealthChecks`,
   `core/healthcheck-backend/src/schema.ts:76-117`) gains an optional
   `environmentIds: string[] | null` selector. Semantics:
   - `null` ⇒ **all** environments the system currently belongs to.
   - non-empty array ⇒ exactly those (intersected with the system's current env
     set; a removed env drops out).
   - empty array `[]` ⇒ **opt-out**: run once with **no** environment in context.
2. **One run per effective environment.** When a check runs for a system, resolve
   the effective env set from the assignment, then execute **one run per effective
   environment**, each with that environment's custom fields injected into
   `CollectorRunContext.environment`. A check with an empty effective set runs
   exactly once with `environment` unset.
3. **Run identity is `(systemId, configurationId, environmentId)`.** This dimension
   threads through run storage, the reactive `health` entity, aggregates, and the
   transition log so per-environment results stay distinct (§5, §7).
4. **Catalog-owned (reuse, do not fork a plugin).** Environments live in
   `core/catalog-*`, reusing the system/group entity + GitOps machinery. Confirmed
   in §11.1.

---

## 3. Current-state facts (verified, file:line anchored)

### 3.1 Catalog schema — the patterns to copy

`core/catalog-backend/src/schema.ts`:
- `systems` (`:14-21`): `id text pk`, `name text notNull`, `description text`,
  `metadata json default({})`, `createdAt`/`updatedAt timestamp`.
- `groups` (`:38-45`): `id text pk`, `name text notNull`, `metadata json default({})`,
  timestamps. **No `description` column** (asymmetry with `systems`).
- `systemsGroups` (`:47-60`): the M:N join — `systemId text notNull references systems.id onDelete cascade`,
  `groupId text notNull references groups.id onDelete cascade`,
  `primaryKey(t.systemId, t.groupId)` (note: positional `primaryKey(a, b)` form,
  not the object form). **This is the exact template for `systems_environments`.**
- Tables are `pgTable` (schemaless); runtime schema set via `search_path`
  (`:13` comment).

### 3.2 Catalog domain schemas

`core/catalog-common/src/types.ts`:
- `SystemSchema` (`:7-14`): `id`, `name`, `description: z.string().nullable()`,
  `metadata: z.record(z.string(), z.unknown()).nullable()`, `createdAt/updatedAt: z.date()`.
- `GroupSchema` (`:59-66`): adds `systemIds: z.array(z.string())` ("Required field
  from the service layer", `:62`) and the same `metadata` shape. **This is the
  template for `EnvironmentSchema`.**

### 3.3 Catalog entity-service (CRUD + assignment)

`core/catalog-backend/src/services/entity-service.ts`: `createSystem`/`updateSystem`/
`deleteSystem` (`:87`,`:95`,`:104`), `createGroup`/`updateGroup`/`deleteGroup`
(`:227`,`:235`,`:244`), and the join methods `getGroupsForSystem` (`:278`),
`addSystemToGroup` (`:287`), `removeSystemFromGroup` (`:295`). The reactive-entity
read accessors `getManySystemEntityStates` (`:117`) / `getManyGroupEntityStates`
(`:255`) are the `read` closures wired in `index.ts`.

### 3.4 GitOps kind + kind-extension registration

`core/catalog-backend/src/index.ts`:
- `kindRegistry.registerKind({ kind: "System", specSchema: z.object({}), reconcile, delete })`
  (`:161-198`).
- `kindRegistry.registerKindExtension({ kind: "System", namespace: "groups", specSchema: z.array(entityRefSchema).optional(), reconcile })`
  (`:201-253`) — desired-set reconcile that adds links then prunes stale ones
  (`:213-251`), resolving refs via `context.resolveEntityRef` (`:216`).
- `kind: "Group"` (`:256-290`).
The registry types: `EntityKindDefinition<TSpec>`
(`core/gitops-common/src/entity-kind-registry.ts:60-94`),
`EntityKindExtensionDefinition<TExtensionSpec>` (`:100-128`), `EntityKindRegistry`
(`:181-189`). The extension point `entityKindExtensionPoint` is in
`core/gitops-backend/src/index.ts:46`; `CHECKSTACK_API_VERSION` + `entityRefSchema`
from `@checkstack/gitops-common`.

### 3.5 Reactive catalog entities (Model B)

`core/catalog-backend/src/index.ts:128-150` defines `catalog-system` and
`catalog-group` reactive entities via `entityExtensionPoint.defineEntity` with a
plugin-backed `read`. **An `Environment` is a candidate reactive entity** but is NOT
required for v1 (no automation reasons over environment membership yet) — see §11.6.

### 3.6 The collector run-context contract (the templating injection point)

`core/backend-api/src/collector-strategy.ts`:
```ts
export interface CollectorRunContext {
  check: { id: string; name: string; intervalSeconds: number };
  system: { id: string; name: string };
}                                                       // :24-27
```
Threaded into `CollectorStrategy.execute({ ..., runContext?: CollectorRunContext })`
(`:87-101`). Built once per (config, system) at
`core/healthcheck-backend/src/queue-executor.ts:513-520` and passed to every
collector at `:587-593`.

### 3.7 Run storage / aggregation / transitions (the fan-out dimension)

`core/healthcheck-backend/src/schema.ts`:
- `healthCheckRuns` (`:167-188`): PK `id uuid`, `configurationId uuid FK`,
  `systemId text`, `status`, `latencyMs`, `result jsonb`, `sourceId`/`sourceLabel`,
  `timestamp`. **No environment column today.**
- `healthCheckAggregates` (`:202-252`): `configurationId`, `systemId`, `bucketStart`,
  `bucketSize`, counts, latency stats, `aggregatedResult`, `tdigestState`,
  `sourceId`/`sourceLabel`. Unique constraint
  `(configurationId, systemId, bucketStart, bucketSize, sourceId)` with
  `.nullsNotDistinct()` (`:244-250`).
- `healthCheckStateTransitions` (`:139-165`): `systemId`, `configurationId`,
  `fromStatus`, `toStatus`, `transitionedAt`; `lookupIdx (systemId, toStatus, transitionedAt)`
  (`:155`), `systemRecentIdx (systemId, transitionedAt)` (`:161`).
- `systemHealthChecks` (`:76-117`): the **assignment** row. PK
  `(systemId, configurationId)` (`:115`). Already carries per-assignment
  `stateThresholds`, `retentionConfig`, `satelliteIds`, `includeLocal`,
  `notificationPolicy`. **This is where `environmentIds` lives.**

### 3.8 The reactive `health` entity — keyed by systemId, COMPUTED on read

`core/healthcheck-backend/src/health-entity.ts:1-50`: the `health` entity
(`HEALTH_ENTITY_KIND = "health"`, `:33`) is a Model-B **compute-on-read** entity
with **no current-state row** — its `read` derives `{ status, healthyChecks,
totalChecks }` from `health_check_runs` via `service.getSystemHealthStatus`
(`core/healthcheck-backend/src/service.ts:479-529`, which selects runs filtered by
`systemId` + `configurationId` only). Every evaluation-write goes through
`writeHealthEntity` (`queue-executor.ts:729-761`, `:842+`), whose `apply` inserts the
run + increments the aggregate and returns the recomputed view; the framework diffs
`prev → next` and emits `ENTITY_CHANGED`. **The entity is keyed by `systemId`.** This
is the single most consequential current-state fact for this feature — see §7.

### 3.9 Run scheduling / fan-out

The recurring job is keyed `healthcheck:${configId}:${systemId}`
(`queue-executor.ts:181`), payload `HealthCheckJobPayload { configId, systemId }`
(`:138-141`), scheduled via `scheduleHealthCheck` (`:163-193`) on the
`HEALTH_CHECK_QUEUE` (`:148`). Bootstrap iterates enabled assignments and schedules
one recurring job per (config, system) (`:1193-1232`); orphaned-job cleanup keys off
`healthcheck:${configId}:${systemId}` (`:1240-1248`). One job → one execution → one
run today.

### 3.10 Script-collector exposure

- Shell (`plugins/healthcheck-script-backend/src/execute-collector.ts`): reserved env
  names `CHECKSTACK_CHECK_ID/NAME/INTERVAL_SECONDS`, `CHECKSTACK_SYSTEM_ID/NAME`
  (`:39-43`), mapped by `runContextEnv(ctx)` (`:49-57`), merged under user `config.env`
  and secret env at execute (`:271-275`).
- Inline TS (`plugins/healthcheck-script-backend/src/inline-script-collector.ts`):
  `globalThis.context = { config, check?, system? }` wired by
  `defaultInlineScriptExecutor` (`:80-108`, the `context` object at `:91-95`).
- In-editor test mirror (`core/healthcheck-backend/src/collector-script-test.ts`):
  `buildShellRunContextEnv` sets the same `CHECKSTACK_*` vars (`:87-100`) and the
  inline `context` object (`:110-115`). **Must be updated in lockstep** so the test
  panel reflects the new `environment` surface.

### 3.11 Template engine

`core/template-engine/src/types.ts`: `TemplateContext = Record<string, unknown>`
(`:23`); typical keys `trigger`, `nodes`, `config`, `variables` (`:18-22`).
`core/template-engine/src/renderer.ts`: `render(template, context, options)`
(`:38-61`), `RenderOptions { filters?, strict? }` (`:18-31`) — `strict: true` makes a
missing path **throw** instead of resolving to empty string (`:26-30`). The HTTP
collector's `url` is a plain `z.string().url()` today — **not** rendered through this
engine.

### 3.12 Assignment RPC surface

`core/healthcheck-common/src/schemas.ts`: `AssociateHealthCheckSchema` (`:242-252`) —
`configurationId`, `enabled`, `stateThresholds?`, `satelliteIds?`, `includeLocal`,
`notificationPolicy?`. `core/healthcheck-common/src/routes.ts:10`: assignment route
`/assignments/:systemId`. **This is where `environmentIds` is added.**

### 3.13 Docs

Concept pages live in `docs/src/content/docs/user-guide/concepts/` (sibling to
`systems-and-groups.md`). Reference pages in
`docs/src/content/docs/user-guide/reference/` (`script-health-checks.md`,
`gitops-kinds.md`, `health-checks.md` is a concept page). Catalog frontend editors
are in `core/catalog-frontend/src/components/` (`SystemEditor.tsx`,
`GroupEditor.tsx`, `SystemDetailPage.tsx`) — note: **components/, not pages/** (the
issue said `pages/`; verified the directory is `components/`).

---

## 4. Data model (Drizzle DDL)

### 4.1 `environments` + `systems_environments`

In `core/catalog-backend/src/schema.ts`, copying the `groups` / `systemsGroups`
patterns (add `description` to match `systems`, which `groups` lacks):

```ts
export const environments = pgTable("environments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  // Free-form custom fields (baseUrl, region, tier, ...). Same json+default({})
  // precedent as systems.metadata / groups.metadata. Decided free-form for v1
  // (see §11.3); the values surface in templating verbatim.
  metadata: json("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const systemsEnvironments = pgTable(
  "systems_environments",
  {
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey(t.systemId, t.environmentId),
  }),
);
```

> **Naming note.** Field key is `metadata` (matches `systems`/`groups`); the
> templating namespace exposes it flattened as `environment.<key>` (§6, §11.5), so
> `metadata.baseUrl` ⇒ `{{ environment.baseUrl }}`. Reserved keys `environment.id`
> and `environment.name` are projected from the columns, NOT from `metadata`; a
> `metadata` key colliding with `id`/`name` is shadowed by the column (documented).

### 4.2 `environmentId` dimension on run storage

In `core/healthcheck-backend/src/schema.ts`. **Nullable** `text` (NOT a FK to the
catalog `environments` table — healthcheck and catalog are separate plugins with
separate Postgres schemas; cross-schema FKs are not used here, mirroring how
`systemId` is a bare `text` with no FK to `systems`). `null` means "ran with no
environment" (the opt-out / empty case).

```ts
// healthCheckRuns — add:
environmentId: text("environment_id"),

// healthCheckAggregates — add:
environmentId: text("environment_id"),
// and EXTEND the unique constraint (NULLS NOT DISTINCT so env-less runs
// conflict-match correctly instead of duplicating per bucket):
bucketUnique: unique("health_check_aggregates_bucket_unique").on(
  t.configurationId, t.systemId, t.environmentId,
  t.bucketStart, t.bucketSize, t.sourceId,
).nullsNotDistinct(),

// healthCheckStateTransitions — add:
environmentId: text("environment_id"),
// and EXTEND both indexes to lead with the env dimension:
lookupIdx: index("health_check_state_transitions_lookup_idx").on(
  t.systemId, t.environmentId, t.toStatus, t.transitionedAt,
),
systemRecentIdx: index("health_check_state_transitions_system_recent_idx").on(
  t.systemId, t.environmentId, t.transitionedAt,
),
```

### 4.3 `environmentIds` selector on the assignment

In `core/healthcheck-backend/src/schema.ts`, on `systemHealthChecks` (mirrors the
existing `satelliteIds: jsonb("satellite_ids").$type<string[]>()` at `:99`):

```ts
/**
 * Per-assignment environment selector. null = all environments the system
 * currently belongs to; [] = opt out (run once, no environment); non-empty =
 * exactly those environment ids (intersected with current membership).
 */
environmentIds: jsonb("environment_ids").$type<string[]>(),
```

`null` vs `[]` are **semantically distinct** here (unlike most nullable jsonb in this
schema). jsonb stores both faithfully; the service distinguishes
`row.environmentIds === null` from `length === 0`.

### 4.4 Migrations

Two Drizzle migrations, generated via the repo's drizzle-kit flow (do **not**
hand-write SQL beyond what the generator emits unless a data backfill is needed):
- **catalog-backend migration:** create `environments` + `systems_environments`.
- **healthcheck-backend migration:** add `environment_id` to `health_check_runs`,
  `health_check_aggregates`, `health_check_state_transitions`; drop+recreate the
  aggregates unique constraint and the two transition indexes with the new columns;
  add `environment_ids` jsonb to `system_health_checks`. All additive/nullable — no
  backfill required; existing rows read as `environmentId = null` ("ran with no
  environment"), which is exactly the pre-feature behavior.

---

## 5. Domain schemas + service + RPC signatures

### 5.1 `EnvironmentSchema` (catalog-common)

`core/catalog-common/src/types.ts`, mirroring `GroupSchema`:

```ts
export const EnvironmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  systemIds: z.array(z.string()),              // from the service layer (like Group)
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Environment = z.infer<typeof EnvironmentSchema>;

export const CreateEnvironmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export const UpdateEnvironmentSchema = CreateEnvironmentSchema.partial();
```

### 5.2 EntityService methods (catalog-backend)

Add to `core/catalog-backend/src/services/entity-service.ts`, mirroring the group
methods exactly:

```ts
getEnvironments(): Promise<Environment[]>;
getEnvironment(id: string): Promise<Environment | undefined>;
createEnvironment(data: NewEnvironment, id?: string): Promise<Environment>;
updateEnvironment(id: string, data: Partial<NewEnvironment>): Promise<Environment>;
deleteEnvironment(id: string): Promise<void>;
getEnvironmentsForSystem(systemId: string): Promise<{ environmentId: string }[]>;
getSystemsForEnvironment(environmentId: string): Promise<{ systemId: string }[]>;
addSystemToEnvironment(props: { environmentId: string; systemId: string }): Promise<void>;
removeSystemFromEnvironment(props: { environmentId: string; systemId: string }): Promise<void>;
// Batched resolver for fan-out enrichment (see §6.1):
getEnvironmentsByIds(ids: string[]): Promise<Environment[]>;
```

### 5.3 RPC contract (catalog-common)

Add to the catalog oRPC contract + router, gated by a new
`catalogAccess.environment.manage` access rule (mirror `catalogAccess.system.manage`,
used at `core/catalog-backend/src/index.ts:373`):
- `listEnvironments` (read) → `Environment[]`.
- `getEnvironment({ environmentId })` → `Environment | null`.
- `createEnvironment(CreateEnvironmentSchema)` → `Environment`.
- `updateEnvironment({ environmentId, ...UpdateEnvironmentSchema })` → `Environment`.
- `deleteEnvironment({ environmentId })` → `void`.
- `setSystemEnvironments({ systemId, environmentIds })` → `void` (desired-set assign;
  diff add/remove like the GitOps groups reconcile).
- `getSystemEnvironments({ systemId })` → `Environment[]`.

> **Cross-plugin read for fan-out.** healthcheck-backend resolves a system's
> environments + their custom fields at run time. Expose a service-grade RPC the
> healthcheck plugin calls via `rpcClient.forPlugin(CatalogApi)` (it already holds a
> `CatalogApi` client — `core/healthcheck-backend/src/index.ts:238`):
> `resolveSystemEnvironments({ systemId })` → `Environment[]` (id + name + metadata).
> Add `resolveEnvironments({ environmentIds })` for the explicit-subset case.

### 5.4 Router scheduling reconcile (healthcheck)

The assignment editor changing `environmentIds`, and a system's environment
membership changing in catalog, both affect the fan-out set → the recurring-job set
must be reconciled. See §7.3 for the job-identity decision; the reconcile hook lives
where `scheduleHealthCheck` is already called from the assignment path
(`core/healthcheck-backend/src/router.ts:230-231`) and bootstrap (`:1193-1232`).

---

## 6. Templating + run-context integration

### 6.1 Extend `CollectorRunContext`

`core/backend-api/src/collector-strategy.ts:24-27`:

```ts
export interface CollectorRunContext {
  check: { id: string; name: string; intervalSeconds: number };
  system: { id: string; name: string };
  /**
   * The resolved environment for THIS run, when the check fanned out into one.
   * Absent when the assignment opts out / the system has no environments.
   * `fields` is the environment's free-form custom metadata (verbatim values).
   * Metadata only — never secrets.
   */
  environment?: { id: string; name: string; fields: Record<string, unknown> };
}
```

Built in `queue-executor.ts`: the executor resolves the effective env set (§7), then
for each environment builds a `runContext` with `environment` populated (or omitted
for the env-less case). `environment.fields` is the catalog environment's `metadata`.

### 6.2 Script-side exposure

- **Shell** (`execute-collector.ts`): add reserved names
  `CHECKSTACK_ENV_ID`, `CHECKSTACK_ENV_NAME`, and one var per custom field as
  `CHECKSTACK_ENV_<UPPER_SNAKE_KEY>` (e.g. `baseUrl` → `CHECKSTACK_ENV_BASE_URL`).
  Extend `runContextEnv(ctx)` (`:49-57`) to emit these when `ctx.environment` is set.
  Key transform: camelCase/kebab → UPPER_SNAKE; reuse the platform's existing
  shell-env key helper from `@checkstack/automation-common` if one is exported,
  otherwise a small local `toShellEnvKey` (the recent
  `toShellEnvKey` ReDoS fix lives in automation-common — prefer reusing it). Collision
  of two keys after normalization ⇒ last-write-wins is unacceptable; instead skip +
  log a `warn` (documented limit). User `config.env` still wins over `CHECKSTACK_ENV_*`
  (preserve the merge order at `:271-275`).
- **Inline TS** (`inline-script-collector.ts`): extend the `context` object
  (`:91-95`) to `{ config, check?, system?, environment? }` where
  `environment = { id, name, fields }`. Scripts read `globalThis.context.environment.fields.baseUrl`.
- **Test mirror** (`collector-script-test.ts`): mirror BOTH surfaces in
  `buildShellRunContextEnv` (`:87-100`) and the inline `context` builder (`:110-115`),
  driven by an optional `runContext.environment` on `CollectorTestRunContext`. The
  test panel UI gains an environment picker (or a manual custom-fields entry) so an
  operator previews a specific environment's render.

### 6.3 Config-field templating (the biggest call — §11.4)

> **RECOMMENDED DECISION (needs user sign-off): general collector-config templating
> via the existing template engine, gated to fields opted in with `x-templatable`,
> rendered against `{ environment, check, system }` at execute time.** Rationale and
> alternatives in §11.4.

Concretely (assuming the recommended decision):
- A new config-field meta flag `x-templatable: true` (via the existing
  `withConfigMeta` precedent used for `x-secret-env` in
  `execute-collector.ts:104`) marks a string field as eligible. The HTTP collector's
  `url` becomes
  `configString({ "x-templatable": true }).describe("Full URL. Supports {{ environment.baseUrl }}.")`
  (replacing the bare `z.string().url()` at `request-collector.ts:30` — note `.url()`
  validation moves to *post-render* since the pre-render value contains `{{ }}`).
- A shared **render pass** runs in `queue-executor.ts` AFTER env resolution and
  BEFORE `strategy.createClient` / `collector.execute`: walk the strategy config +
  each collector config, and for every `x-templatable` string field, `render()` it
  (`core/template-engine/src/renderer.ts:38`) against
  `{ environment: runContext.environment?.fields ?? {}, check, system }`. Use
  `strict: false` (missing path → empty string) by default; surface a render error as
  a clear collector failure when `strict` matters. Secrets stay on the **separate**
  `${{ secrets.NAME }}` path (resolved by the secrets resolver,
  `queue-executor.ts:572-585`) — the two syntaxes (`${{ }}` for secrets, `{{ }}` for
  templating) do not collide and are resolved in separate passes (secrets first or
  last is a §11.4 sub-decision; recommend **environment-render first, secrets second**
  so a secret value never gets re-parsed as a template).
- The render pass is a single shared utility (`renderTemplatableConfig`) so every
  collector benefits without per-collector code.

> If user rejects general templating (chooses script-only): drop §6.3 entirely; the
> HTTP `url` stays static and the feature only parameterizes script collectors via
> §6.2. This is the smaller, safer scope.

---

## 7. The run model — concrete fan-out

### 7.1 Effective environment resolution

For a (config, system) pair with assignment `a`:
```
effectiveEnvs(a, system):
  membership = catalog.resolveSystemEnvironments({ systemId })   // current M:N set
  if a.environmentIds === null:        return membership          // "all"
  if a.environmentIds.length === 0:    return []                  // opt-out → env-less
  return membership.filter(e => a.environmentIds.includes(e.id))  // explicit subset ∩ membership
```
An explicit id no longer in membership silently drops (consistent with stale-ref
pruning in the GitOps groups reconcile). The env-less case (`[]` or empty membership
under `null`) yields a single run with `environment` unset.

### 7.2 Execution

In `queue-executor.ts`, the per-job execution (currently one run per
`{ configId, systemId }`) becomes: resolve `effectiveEnvs`; if empty → run once
(`environmentId = null`, `environment` unset — today's behavior exactly); else
**for each env**, build the env-specific `runContext` (§6.1), run the collectors,
and persist a run with `environmentId = env.id`. Runs across environments are
independent (own status, own latency, own result).

### 7.3 Job identity — DECIDED: keep the job per (config, system); fan out INSIDE the job

Two options:
- **(A) Job per (config, system), fan out inside** — keep
  `healthcheck:${configId}:${systemId}` (`queue-executor.ts:181`); the executor loops
  the effective envs and writes N runs per tick.
- **(B) Job per (config, system, env)** — `healthcheck:${configId}:${systemId}:${envId}`.

**Recommendation: (A).** Rationale: (a) zero change to the bootstrap/orphan-cleanup
keying (`:181`, `:1242`) beyond the inner loop; (b) the env set is dynamic
(membership changes, assignment edits) — (B) would require reconciling the recurring
job set on every membership/assignment change (a new failure surface), while (A)
re-reads membership each tick and adapts for free; (c) per-env intervals are
identical (one config interval), so there's no scheduling benefit to (B). Trade-off:
a slow env doesn't get its own retry isolation — acceptable, since collectors already
run with a per-execution hard timeout (`queue-executor.ts:532`,`:547`). **Flag for
sign-off only if per-env independent scheduling/retry is a hard requirement.**

### 7.4 The reactive `health` entity must become env-keyed (the consequential ripple)

`health-entity.ts` keys the entity by `systemId` and computes from `getSystemHealthStatus(systemId)`
(`service.ts:479`), which aggregates runs by `(systemId, configurationId)` IGNORING
environment. If left as-is, fanned-out per-env runs **collapse** into one system-level
status — the issue's explicit anti-goal ("stay distinct rather than collapsing across
environments", #248 Technical notes).

**Decision:** make the `health` entity key `systemId` **or** `systemId:environmentId`,
and add an env-less rollup. Concretely:
- `getSystemHealthStatus` gains an optional `environmentId` filter; the per-env read
  filters `health_check_runs` by `environmentId` too.
- The entity id becomes `system:<systemId>` for the env-less / rollup view and
  `system:<systemId>:env:<environmentId>` for a per-env view (or a structured
  `{ systemId, environmentId }` key — match whatever `HEALTH_ENTITY_KIND` keying the
  reactive engine expects; the engine keys entities by a single string id, so encode
  as `<systemId>` / `<systemId>::<environmentId>`).
- `writeHealthEntity` (`queue-executor.ts:729`,`:842`) is called once per env-run with
  the env-qualified id; the env-less aggregate (whole-system rollup) is recomputed and
  written as a SECOND entity write per tick so existing system-level automations keep
  firing. **This doubles the entity-write surface per tick when envs are present** —
  call it out; the rollup is computed-on-read so no extra storage, only extra
  diff/emit work.

> **This is the single biggest implementation risk and the part most likely to need a
> design review with the reactive-automation-engine owner.** It changes the cardinality
> and id-shape of a core reactive entity. See §11.2 and the risk table. If a lighter
> v1 is acceptable, an alternative is: **store `environmentId` on runs (so history is
> distinct) but keep the `health` entity system-level for v1** (envs visible in
> history/charts, but automations still reason at system granularity). Flagged for
> sign-off in §11.2.

### 7.5 Aggregates + transitions + transition log

`incrementHourlyAggregate` (`queue-executor.ts:743`) and `recordStateTransition`
(`:783`) gain an `environmentId` parameter, written into the new columns (§4.2). The
aggregate unique key now includes `environmentId` so per-env buckets stay separate
(`:244-250` extended). Retention sweeps (`RetentionConfig`, `schema.ts:61-74`) operate
unchanged — the env dimension is just another grouping column.

---

## 8. GitOps

`core/catalog-backend/src/index.ts`, mirroring System/Group + the groups extension:

```ts
// Kind: Environment (mirror "Group" at index.ts:256-290)
kindRegistry.registerKind({
  apiVersion: CHECKSTACK_API_VERSION,
  kind: "Environment",
  specSchema: z.object({
    // Free-form custom fields. z.record keeps GitOps in step with the
    // free-form metadata decision (§11.3).
    fields: z.record(z.string(), z.unknown()).optional(),
  }),
  reconcile: async ({ entity, existingEntityId, context }) => {
    const svc = new EntityService(gitopsDb);
    const name = entity.metadata.title ?? entity.metadata.name;
    const metadata = entity.spec.fields ?? {};
    if (existingEntityId) {
      await svc.updateEnvironment(existingEntityId, { name, description: entity.metadata.description, metadata });
      return { entityId: existingEntityId };
    }
    const env = await svc.createEnvironment({ name, description: entity.metadata.description, metadata });
    return { entityId: env.id };
  },
  delete: async ({ entityId, context }) => {
    if (entityId) await new EntityService(gitopsDb).deleteEnvironment(entityId);
  },
});

// Kind extension: System -> environments (mirror System->groups at :201-253)
kindRegistry.registerKindExtension({
  apiVersion: CHECKSTACK_API_VERSION,
  kind: "System",
  namespace: "environments",
  specSchema: z.array(entityRefSchema).optional(),
  reconcile: async ({ extensionSpec, entityId, context }) => {
    // resolve each ref to an environment id, addSystemToEnvironment,
    // then prune stale associations — byte-for-byte the groups reconcile
    // shape (index.ts:213-251).
  },
});
```

GitOps reference docs page `gitops-kinds.md` (`docs/.../reference/`) gains an
`Environment` section + the `System.spec.environments` extension.

---

## 9. Frontend

In `core/catalog-frontend/src/components/` (NOT `pages/`):
- New `EnvironmentEditor.tsx` (clone `GroupEditor.tsx`): name, description, and a
  key/value custom-fields editor (free-form; see §11.3). A management list page
  reachable from the catalog config area.
- `SystemEditor.tsx` / `SystemDetailPage.tsx`: add an environment multi-select picker
  (clone the existing groups picker), calling `setSystemEnvironments`.
- **Assignment editor** (healthcheck-frontend, where the assignment row is edited):
  add an environment selector with three modes — "All environments" (`null`),
  "Specific" (multi-select → array), "None" (`[]`). Match the existing
  satellite-selection control look & feel.
- **Run history / detail UI** (healthcheck-frontend): per-environment results for one
  check configuration must be presentable (group/tab by environment). The data is
  distinct by `environmentId` (§7); the UI groups on it. Match existing per-source
  (`sourceLabel`) grouping in run history.

Follow the performance rule (`usePerformance` / `isLowPower`) for any new animated
UI; match existing component structure and tokens.

---

## 10. Phasing (each phase shippable, own changeset + tests)

1. **Catalog data model + CRUD + GitOps.** `environments` + `systems_environments`
   tables + migration; `EnvironmentSchema`; EntityService methods; RPC contract +
   router + access rule; `Environment` GitOps kind + `System->environments`
   extension; `resolveSystemEnvironments` cross-plugin read. Frontend
   `EnvironmentEditor` + system-environment picker. **No fan-out yet** — purely the
   catalog primitive. *Touches:* `core/catalog-backend/*`, `core/catalog-common/*`,
   `core/catalog-frontend/*`, catalog migration.
2. **Run-context + script-side exposure.** Extend `CollectorRunContext` with
   `environment`; populate it for the (still single, env-less) run; wire
   `CHECKSTACK_ENV_*` + `globalThis.context.environment` + the test mirror.
   *Touches:* `core/backend-api/src/collector-strategy.ts`,
   `plugins/healthcheck-script-backend/src/{execute,inline-script}-collector.ts`,
   `core/healthcheck-backend/src/{queue-executor,collector-script-test}.ts`.
3. **Run-storage env dimension + per-environment fan-out.** Add `environmentId` to
   runs/aggregates/transitions + migration; `environmentIds` selector on
   `systemHealthChecks` + `AssociateHealthCheckSchema` + assignment route + assignment
   editor UI; the `effectiveEnvs` resolution + fan-out loop in the executor; aggregate
   + transition env-keying. **`health` entity env-keying per the §11.2 decision.**
   Run-history UI grouping by environment. *Touches:*
   `core/healthcheck-backend/*`, `core/healthcheck-common/*`,
   healthcheck-frontend, healthcheck migration.
4. **General config-field templating (CONDITIONAL on §11.4 sign-off).** `x-templatable`
   meta + `renderTemplatableConfig` shared pass in the executor; HTTP `url` becomes
   templatable with post-render `.url()` validation; render ordering vs secrets.
   *Touches:* `core/healthcheck-backend/src/queue-executor.ts`,
   `plugins/healthcheck-http-backend/src/request-collector.ts`, `core/backend-api`
   (the `x-templatable` meta helper).
5. **Docs + changesets.** New environments concept page; templating-variable docs;
   GitOps `Environment` kind docs; assignment-selector docs. Changesets (beta-minor,
   `BREAKING CHANGES:` only if §11.2 changes the `health` entity id-shape in a way
   downstream automations must re-author). `bun run typecheck:references:generate`
   after the new `@checkstack/*` deps (healthcheck-backend → catalog read; any new
   dep edges).

---

## 11. Open questions — recommended decisions + sign-off flags

### 11.1 Data-model home — CONFIRM: catalog reuse
**Decision: catalog-owned.** Environments are a sibling of systems/groups, share the
M:N join machinery, the GitOps kind/extension pattern, and the catalog's notification/
search surfaces. A dedicated plugin would duplicate all of it for no contract benefit.
**No sign-off needed** (matches the issue's assumption).

### 11.2 `environmentId` on run storage + the `health` entity — SIGN-OFF REQUIRED
**Recommended: add `environmentId` to runs/aggregates/transitions (always) AND
env-key the `health` reactive entity (§7.4) so per-env health is reactive.**
Rationale: the issue's stated goal is per-env distinctness; collapsing env health into
a system rollup defeats per-env automations. **But** this changes the cardinality and
id-shape of a core reactive entity (`health-entity.ts`), with ripple into scope
enrichment and any automation that references system health. **User must sign off on
the heavier path vs the lighter v1** (store `environmentId` on runs for distinct
history/charts, keep the `health` entity system-level, defer per-env reactivity).
Recommend the heavier path **only if** per-environment alerting is an explicit near-term
need; otherwise ship the lighter v1 and add env-keyed reactivity as a follow-up.

### 11.3 Custom-field typing — RECOMMEND free-form for v1
**Decision: free-form `metadata` key/value (string-ish values), like
`systems`/`groups`.** It ships fastest, matches the existing precedent, and the
templating surface (`environment.<key>`) works without a declared schema. Declared
per-environment field schemas (enabling editor + templating autocomplete + validation)
are a clean **follow-up** that can layer on top without a data migration (store a
`fieldSchema` jsonb later). **No hard sign-off needed**, but note: autocomplete for
`{{ environment.* }}` will be best-effort (keys discovered from existing environments)
until typing lands.

### 11.4 Templating scope — SIGN-OFF REQUIRED (the biggest call)
**Recommended: general collector-config templating via the template engine, opt-in
per field with `x-templatable`, rendered against `{ environment, check, system }`
(§6.3).** This is what makes `{{ environment.baseUrl }}/healthz` work in the HTTP
`url` — the primary motivating use case. The alternative (script-only exposure via
`CHECKSTACK_ENV_*` / `globalThis.context`) is smaller and safer but **does not solve
the HTTP-collector case**, which is the headline example in the issue. **User must
decide**: general templating (bigger lift: which fields are templatable, post-render
validation, secrets/`${{ }}` vs `{{ }}` ordering) vs script-only (HTTP stays static).
Sub-decisions if general: render env BEFORE secrets (recommended, so secret values are
never re-parsed); `strict: false` default; `.url()` validation moves post-render.

### 11.5 Namespace key — RECOMMEND `environment`
**Decision: `environment`** (not `env`). It reads clearly next to `system` and `check`
in templates and `globalThis.context`, and avoids confusion with OS "env vars". Script
shell prefix: **`CHECKSTACK_ENV_*`** (the issue's suggested prefix; `ENV` is the
natural shell abbreviation and there's no `CHECKSTACK_ENVIRONMENT_*` precedent to
match). **No sign-off needed** unless the user prefers `env` for terseness.

### 11.6 Empty effective env set but the check references `environment.*` — RECOMMEND render-empty + warn
**Decision: render to empty string (engine default, `strict: false`) and emit a single
`warn` log per run** ("check references environment.* but ran with no environment").
Do **not** fail the run (failing would make an env-less misconfiguration look like a
real outage) and do **not** silently skip (the operator should still get a result).
For the HTTP `url` case, an empty render likely yields an invalid URL → the post-render
`.url()` validation fails the collector with a **clear config error**, which is the
correct, visible signal. **No sign-off needed**; documented behavior.

### 11.7 Should `Environment` be a reactive entity? — RECOMMEND no for v1
No automation reasons over environment membership today, and the catalog system/group
entities exist for change-event propagation, not env. Skip `defineEntity` for
`Environment` in v1; add later if an automation use case appears. **No sign-off needed.**

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Env-keying the `health` entity changes a core reactive entity's id-shape | §11.2 sign-off; offer the lighter v1 (env on runs, system-level health); design-review with the automation-engine owner; `BREAKING CHANGES:` in the changeset if id-shape changes |
| Per-env fan-out multiplies runs/aggregates/entity writes per tick | Fan-out bounded by env count (operator-scale, single digits typically); aggregates are upserts; the env-less rollup write is compute-on-read (no extra storage); document the multiplier |
| `null` vs `[]` semantics for `environmentIds` get conflated | Service explicitly distinguishes `=== null` from `length === 0`; unit tests cover all three modes (all/subset/opt-out) |
| General templating breaks `.url()` validation timing | Move `.url()` to post-render; render pass is a shared utility; render errors surface as clear collector failures |
| Secrets `${{ }}` and templating `{{ }}` interfere | Distinct syntaxes, separate passes; render environment BEFORE secrets so secret values are never re-parsed; tests assert non-interference |
| Shell env-key collisions after UPPER_SNAKE normalization | Skip + `warn` on collision (no last-write-wins); reuse the hardened `toShellEnvKey` (ReDoS-safe) from automation-common |
| Cross-plugin env resolution adds latency to every run | Batched `resolveSystemEnvironments`; cache membership per tick; the catalog read is a single indexed join |
| Stale explicit `environmentIds` after an env is deleted | Intersect with current membership at resolve time (§7.1); `onDelete: cascade` on `systems_environments` drops membership rows; assignment array entries that no longer resolve silently drop |
| Test panel diverges from real run env surface | `collector-script-test.ts` updated in the SAME phase as the collectors (Phase 2), with a test asserting parity of the `CHECKSTACK_ENV_*` / `context.environment` shapes |

---

## 13. Test matrix (TDD, `bun test`)

- **Phase 1:** EntityService env CRUD + join add/remove/list (against the catalog
  test DB harness used by group tests); `EnvironmentSchema` parse round-trip;
  `setSystemEnvironments` desired-set diff (add+prune); GitOps `Environment` reconcile
  create/update/delete + `System->environments` extension reconcile + stale-prune
  (mirror the existing kind-registry tests, `kind-registry.test.ts`).
- **Phase 2:** `runContextEnv` emits `CHECKSTACK_ENV_*` for a populated environment
  and omits them when absent; UPPER_SNAKE key transform + collision skip+warn; inline
  `context.environment` shape; `collector-script-test` parity test (panel == real).
- **Phase 3:** `effectiveEnvs` for all three modes (all / subset / opt-out) incl.
  stale-id drop; fan-out writes one run per env with correct `environmentId`; env-less
  case writes one run with `environmentId = null`; aggregate uniqueness per
  `(config, system, env, bucket, source)`; transition rows carry `environmentId`;
  per-env `getSystemHealthStatus` filters correctly; (if §11.2 heavy) env-keyed
  `health` entity emits distinct `ENTITY_CHANGED` per env + the system rollup.
- **Phase 4 (if templating):** `renderTemplatableConfig` renders `{{ environment.baseUrl }}`
  into the HTTP `url`; post-render `.url()` failure on empty env; env-render-before-secrets
  ordering (a secret value containing `{{` is not re-parsed); `strict: false` missing
  path → empty.
- **State-and-scale check (per `.agent/rules/state-and-scale.md`):** environment
  membership + custom fields live ONLY in the catalog Postgres tables
  (`environments`, `systems_environments`); the run-time fan-out re-reads them per tick
  via the cross-plugin RPC, so every pod resolves the same effective env set. No
  pod-local environment state. The `environmentId` on runs/aggregates/transitions is
  durable and globally readable. (The single-process test suite cannot prove this —
  state physically lives in shared Postgres by construction; called out explicitly per
  the rule.)

---

## 14. Docs deliverables (same PR as the contract changes)

- **New concept page** `docs/src/content/docs/user-guide/concepts/environments.md`
  (sibling of `systems-and-groups.md`): what an environment is, custom fields, M:N
  with systems, the per-assignment fan-out model, the env-less default. Frontmatter
  `title` + `description`; sentence-case headings; one runnable example.
- **Templating-variable docs:** extend `reference/script-health-checks.md` with
  `CHECKSTACK_ENV_*` + `globalThis.context.environment`; if §11.4 lands, extend the
  health-checks concept page with the `{{ environment.* }}` config-templating
  variables + the HTTP `url` example.
- **GitOps:** `reference/gitops-kinds.md` gains the `Environment` kind +
  `System.spec.environments` extension.
- These are platform-contract changes (`CollectorRunContext`, a new GitOps kind, new
  RPC surface, new templating vars) → docs MUST ship in the same PR per
  `.agent/rules/architecture.md`.

---

## 15. Cross-cutting (repo rules)

- No `any`, no `eslint-disable`; zod schemas for all validation; typed object args
  with destructuring (`.agent/rules/code-style-guide.md`).
- `bun run typecheck:references:generate` + commit after any new `@checkstack/*` dep
  edge (e.g. healthcheck-backend's catalog read), per `.agent/rules/typecheck.md`.
- Changesets per touched package: **beta = minor**, `BREAKING CHANGES:` text only if
  the §11.2 decision reshapes the `health` entity id (`.agent/rules/changesets.md`).
- State-and-scale answered in §13; no pod-local environment state.
- No em-dashes in new docs/content. Conventional commits. Run
  `bun run typecheck` + `bun run lint` + `bun test` before declaring any phase done.
