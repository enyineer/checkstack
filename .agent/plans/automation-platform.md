# Automation platform — implementation plan

> **Status:** in progress
> **Branch:** `feat/automation-platform` (off `main`, after PR #221 merged at 2026-05-29T05:31:32Z)
> **Started:** 2026-05-29
> **Original ask:** auto-close integration artifacts (Jira tickets, Slack messages, PagerDuty alerts, etc.) when a Checkstack incident is resolved.
> **Evolved into:** Home Assistant-style generic automation platform that any plugin can register triggers and actions into. Replaces the current `integration-backend` subscription model.

This file is the persistent handoff for a multi-session feature. A future chat should be able to pick up by reading **only this document** — no prior conversation context required.

---

## 1. Vision

Checkstack becomes a **plugin-extensible automation platform**, in the spirit of Home Assistant:

- Plugins (incident, system, healthcheck, satellite, slo, dependency, notification, maintenance, integration-jira, integration-teams, integration-webex, integration-webhook, integration-script) register **triggers** and **actions** into shared registries.
- Operators build **automations**: triggers + optional conditions + ordered actions, with full control-flow primitives.
- Templates, intellisense, and a YAML round-trip make it powerful without being a code-only tool.

Showcase use case (drives the design): create a Jira ticket on `incident.created`, transition it to Done on `incident.resolved`, plus the same lifecycle for Teams / Webex / webhook / script.

---

## 2. Locked design decisions

These were settled during the multi-turn design conversation. Treat as non-negotiable unless explicitly revisited with the user.

### Architecture

- **Generic automation platform** at the core, not an integration-specific feature. Plugins register triggers + actions via extension points (mirrors `integrationEventExtensionPoint` / `integrationProviderExtensionPoint` patterns).
- **Replaces** `integration-backend`'s event registry, provider registry, and delivery coordinator. The `connection-store` (Jira credentials, Azure AD client secrets, etc.) is the ONLY surviving piece — it stays, possibly under a new minimal `integration-backend` or extracted to a `connection-backend`.
- **Auto-migrate** existing `webhookSubscriptions` to single-trigger single-action automations at upgrade. Idempotent + reversible. `automations.managedBy = "migrated-subscription:<id>"` records origin.
- **Clean cut**, no shim. The legacy integration surface is dropped in the same PR sequence that introduces automations.

### Editor model — Home Assistant style, NOT graph-based

- Stacked, collapsible card list (Triggers section / Conditions section / Actions section). Drag-to-reorder. NOT a node canvas.
- Reasoning: integration workflows are sequential state-machines over the incident lifecycle, not data-flow DAGs. Conditions/parallel/repeat are clumsy as graph nodes but natural as block actions.
- The `Dependency Graph` view stays a graph because system dependencies are genuinely DAG-shaped — different beast.

### Triggers

- **Explicit trigger nodes / declarations** — operator lists triggers explicitly (not a flow-level header).
- `id` field is **auto-derived from `event` when unique**; only surfaced in the UI when there are duplicates (e.g. two triggers for `incident.created` with different filters).
- Each trigger has optional `filter` (template returning truthy/falsy) and `config` (used by triggers like `time.cron` that need their own configuration).
- Trigger registration declares a `contextKey` extractor (e.g. `incidentId` for incident triggers) used to scope artifact lookups.

### Control-flow primitives (FULL set, day 1)

All 9 primitives must ship together (user explicitly said "don't be lazy, full catalog"):

1. **`action: <plugin>.<action>` + `config: {...}`** — call a registered action. Produces typed artifact.
2. **`choose: [{when, then}, ...] + else: [...]`** — if/elif/else.
3. **`parallel: [actions...]`** — concurrent fan-out, wait-for-all.
4. **`delay: { seconds: N } | { template: "..." }`** — sleep.
5. **`repeat: { count | for_each | while | until, sequence: [...] }`** — all 4 repeat modes with `max_iterations` safety.
6. **`variables: { name: value }`** — define locals.
7. **`condition: "..."`** — mid-run guard, halts unless `continue_on_error`.
8. **`stop: { reason?, error? }`** — explicit halt.
9. **`wait_for_trigger: { event, filter?, timeout_seconds?, context_key? }`** — durable suspend until matching event.

Each action also supports: `id`, `description`, `enabled`, `continue_on_error`.

Automation-level: `mode: single | parallel | queued | restart`, `max_runs`.

### Multi-trigger UX

- **Per-trigger tabs** are the default narrowing UI inside a `choose` block. Operator sees one tab per upstream trigger event.
- **Advanced "unified script" mode** exposes the full discriminated union for power users (`switch (context.trigger.eventId)`).
- Internally always a `choose` keyed on `trigger.eventId` or `trigger.id`.

### Templating — universal

- **One template engine** used everywhere: Monaco fields, plain template inputs, bash/SSH script bodies, YAML `when:` conditions, action `config.*` fields.
- Syntax: `{{ expression }}`. Expressions support paths, pipes/filters, comparison/boolean operators, ternaries, literals.
- **Minimal language** — no loops or blocks in templates. For real logic, use a `script` action.
- Variable scope: `trigger.*`, `nodes.<id>.artifact.*` (or `artifacts.<type>.*` when unambiguous), `config.*`, `variables.*`, `repeat.item/index`, platform helpers (`now()`).

### Intellisense

- **Static types from zod schemas** are the source of truth (NOT runtime sampling like n8n).
- Generate `.d.ts` from the flow's topology and feed Monaco via `addExtraLib`.
- Same generated scope drives the **VariablePicker** dropdown for non-Monaco template fields.
- Discriminated union narrowing for multi-trigger downstream.
- Live sample data overlay is **deferred to a polish phase**; types alone are enough for correctness.

### Selectors / config form metadata

Already-established pattern extended:
- `x-secret`, `x-hidden`, `x-options-resolver`, `x-depends-on`, `x-editor-types` (existing).
- **New:** `x-template: "text" | "code" | "bash" | "json" | "yaml"` declaring the field's templating mode + which Monaco variant to use. The "fx" toggle (template-mode switch) appears next to typed inputs whose schema allows templating.

### Artifacts

- First-class entity. Each provider action declares `produces?: ArtifactType` and `consumes?: ArtifactType[]` (typed).
- Storage keyed by `(automationId, contextKey, artifactType)` and additionally `actionId` when the operator assigned one.
- `contextKey` defaults to `trigger.payload.incidentId` (provider-declared on trigger event registration). Generalizes beyond incidents (e.g. `systemId`).
- Idempotency: existing artifact for the same key → close calls return success without re-doing.
- Subscription/automation disabled at resolve time → **still close** (artifact was created while enabled; honor the contract). Deleted → skip silently.

### YAML round-trip

- YAML editor and visual editor are two views of the same `definition` (zod-validated).
- JSON Schema (derived from zod) feeds Monaco's YAML language service for live diagnostics.
- Round-trip without semantic loss; YAML comments are NOT preserved on save (acceptable for v1).
- Type-aware template validation at save time (e.g. `{{ artifacts.jira_issue.url }}` is only valid if some upstream action produces `jira_issue` in scope).

### GitOps

- New kind: `Automation`. Spec schema = `AutomationDefinitionSchema`. Reconcile = upsert by name. Provenance lock makes UI read-only when managed declaratively.
- Defer to a later phase; not blocking the MVP.

### Connection store

- The Jira credentials / Azure AD secrets store survives — it's the genuinely integration-specific concern.
- Probably stays inside the new minimal `integration-backend` (just a credentials plugin) or extracted to a new `connection-backend`. Decision **TBD when we get there**.

---

## 3. Architecture reference — patterns to mirror

When implementing the automation-backend, mirror these existing patterns precisely. Reference file:line provided so you don't have to grep.

### Plugin lifecycle (3 phases)

- **Phase 1 — `register(env)`** ([`core/backend/src/plugin-manager/plugin-loader.ts:263-301`](../../core/backend/src/plugin-manager/plugin-loader.ts)): declare schema, services, extension points, access rules, routers, cleanup, subscription specs. No DB access. Plugins can `env.getExtensionPoint()` and call into other plugins' extension points — calls are buffered via Proxy until the implementation registers (see [`core/backend/src/plugin-manager/extension-points.ts:7-85`](../../core/backend/src/plugin-manager/extension-points.ts)).
- **Phase 2 — `init({ deps })`** ([`core/backend/src/plugin-manager/plugin-loader.ts:342-488`](../../core/backend/src/plugin-manager/plugin-loader.ts)): topologically sorted. Resolved deps available. NO RPC calls to other plugins yet. Migrations run before `init()` in this phase.
- **Phase 3 — `afterPluginsReady({ ...deps, onHook, emitHook, eventBus })`** ([`core/backend/src/plugin-manager/plugin-loader.ts:558-674`](../../core/backend/src/plugin-manager/plugin-loader.ts)): full DI. **Only place `onHook` and `emitHook` are injected.**

### Extension points

- Factory: `createExtensionPoint<T>(id: string)` — [`core/backend-api/src/extension-point.ts:9-11`](../../core/backend-api/src/extension-point.ts).
- Real example: `integrationEventExtensionPoint` ([`core/integration-backend/src/index.ts:70-95`](../../core/integration-backend/src/index.ts)).
- Plugin registers implementation in Phase 1; other plugins get-and-call. Buffer drains when the implementation registers.

### Hooks

- Factory: `createHook<T>(id: string)` — [`core/backend-api/src/hooks.ts:14-16`](../../core/backend-api/src/hooks.ts).
- `onHook` subscription modes (discriminated union):
  - `mode: "broadcast"` — every backend instance gets a copy.
  - `mode: "work-queue", workerGroup: string, maxRetries?: number` — exactly one instance processes. **USE FOR AUTOMATION DISPATCH.**
  - `mode: "instance-local"` — no queue at all.
- Implementation: [`core/backend/src/services/event-bus.ts`](../../core/backend/src/services/event-bus.ts).
- Subscribers can ONLY register in `afterPluginsReady`.

### Queue manager (cron + intervals come for free)

- Public interface: [`core/queue-api/src/queue.ts:53-173`](../../core/queue-api/src/queue.ts).
- `scheduleRecurring(data, { jobId, cronPattern | intervalSeconds, priority?, startDelay? })` — `time.cron` and `time.interval` triggers ride this.
- Manager: [`core/queue-api/src/queue-plugin.ts:60-121`](../../core/queue-api/src/queue-plugin.ts).
- Backed by BullMQ in production ([`core/queue-bullmq-backend/src/bullmq-queue.ts`](../../core/queue-bullmq-backend/src/bullmq-queue.ts)) or in-memory in tests.

### GitOps kinds

- Extension point: `entityKindExtensionPoint` — [`core/gitops-backend/src/index.ts:47-48`](../../core/gitops-backend/src/index.ts).
- Kind definition shape: [`core/gitops-common/src/entity-kind-registry.ts:60-94`](../../core/gitops-common/src/entity-kind-registry.ts).
- Real example: System kind registration — [`core/catalog-backend/src/index.ts:52-89`](../../core/catalog-backend/src/index.ts).
- Provenance lock for UI read-only: [`core/gitops-frontend/src/hooks/useProvenanceLocks.ts:10-43`](../../core/gitops-frontend/src/hooks/useProvenanceLocks.ts).

### Frontend plugin

- `createFrontendPlugin({ metadata, routes, extensions, foreignSignals })`.
- Real example: [`core/integration-frontend/src/index.tsx:16-49`](../../core/integration-frontend/src/index.tsx).
- oRPC client: `usePluginClient(SomeApi)` — auto-injects `.useQuery()` / `.useMutation()`.
- `foreignSignals: [SOME_SIGNAL]` for cross-plugin cache invalidation.

### Drizzle

- Per-plugin migrations live in `<plugin>/drizzle/`. Generated by `drizzle-kit generate`.
- Runtime application: [`core/backend/src/plugin-manager/plugin-loader.ts:400-450`](../../core/backend/src/plugin-manager/plugin-loader.ts). Each plugin gets its own PostgreSQL schema.
- Recent reference migration: [`core/healthcheck-backend/drizzle/0013_clean_fabian_cortez.sql`](../../core/healthcheck-backend/drizzle/0013_clean_fabian_cortez.sql).

### Conventions (do not forget!)

- After ANY change to `package.json` `dependencies` / `devDependencies` (including adding `workspace:*` deps), run `bun run typecheck:references:generate` and commit the resulting `tsconfig.json` updates.
- Run `bun run typecheck` and `bun run lint` before declaring anything done.
- Add a changeset (`bunx @changesets/cli add`) for every affected package. Beta = minor bump with `BREAKING CHANGES:` notes in the body, never major.
- Never use `any`. Never `// eslint-disable-next-line @typescript-eslint/no-explicit-any`. Use `unknown` + narrowing or model the type.
- Always use bun's test runner (`bun test`).
- No EM-dashes in new content.

---

## 4. Full trigger / action catalog (target end-state)

Compiled from a full hook + RPC mutation inventory of all backend plugins. Use this as the source of truth for what to register.

### Triggers (events)

**incident-backend** ([`core/incident-backend/src/hooks.ts`](../../core/incident-backend/src/hooks.ts)):
- `incident.created` (contextKey: `incidentId`) — payload `{ incidentId, systemIds, title, description?, severity, status, createdAt }`
- `incident.updated` (contextKey: `incidentId`)
- `incident.resolved` (contextKey: `incidentId`) — payload `{ incidentId, systemIds, title, severity, resolvedAt }`

**maintenance-backend** ([`core/maintenance-backend/src/hooks.ts:13-36`](../../core/maintenance-backend/src/hooks.ts)):
- `maintenance.created` (contextKey: `maintenanceId`)
- `maintenance.updated` (contextKey: `maintenanceId`)

**healthcheck-backend** ([`core/healthcheck-backend/src/hooks.ts:13-58`](../../core/healthcheck-backend/src/hooks.ts)):
- `healthcheck.system.degraded` (contextKey: `systemId`)
- `healthcheck.system.healthy` (contextKey: `systemId`)
- (consider adding) `healthcheck.assignment.created`, `healthcheck.check.failed`, `healthcheck.flapping_detected`

**catalog-backend** ([`core/catalog-backend/src/hooks.ts:12-44`](../../core/catalog-backend/src/hooks.ts)):
- `system.created`, `system.updated`, `system.deleted`, `system.health_changed` (existing)

**dependency-backend** ([`core/dependency-backend/src/hooks.ts:11-36`](../../core/dependency-backend/src/hooks.ts))

**slo-backend** ([`core/slo-backend/src/hooks.ts:12-76`](../../core/slo-backend/src/hooks.ts)):
- `slo.budget.warning` / `slo.budget.critical` / `slo.budget.exhausted`
- `slo.streak.broken`
- `slo.achievement.unlocked`
- `slo.weekly.digest` (cron, Monday 09:00 UTC)

**satellite-backend** ([`core/satellite-backend/src/hooks.ts:14-16`](../../core/satellite-backend/src/hooks.ts)): needs new hooks for connected/disconnected/heartbeat_lost — currently sparse.

**auth-backend** ([`core/auth-backend/src/hooks.ts:11-13`](../../core/auth-backend/src/hooks.ts))

**signal-backend** ([`core/signal-backend/src/hooks.ts:8-19`](../../core/signal-backend/src/hooks.ts))

**Built-in (automation-backend itself):**
- `time.cron` — config `{ pattern: string }`, payload `{ scheduledAt }`. Implementation: `queueManager.scheduleRecurring({ cronPattern, ... })`.
- `time.interval` — config `{ seconds: number }`. Implementation: `queueManager.scheduleRecurring({ intervalSeconds, ... })`.
- `template` — config `{ value_template: string, poll_seconds: number }`. Fires when the template's truthiness flips false→true.

### Actions (callable from automations)

**incident**:
- `incident.create` — args `{ title, description?, severity, systemIds, status? }`
- `incident.resolve` — args `{ incidentId, resolutionNote? }`
- `incident.add_update` — args `{ incidentId, message, statusChange? }`
- `incident.update_status` — args `{ incidentId, status }`

**system / catalog**:
- `system.set_maintenance`, `system.clear_maintenance`, `system.update_metadata`

**healthcheck**:
- `healthcheck.run_now`, `healthcheck.disable_assignment`, `healthcheck.enable_assignment`

**notification**:
- `notification.send`

**maintenance**:
- `maintenance.create`, `maintenance.update`, `maintenance.add_update`

**dependency**:
- `dependency.create`, `dependency.remove`

**slo**:
- `slo.reset_budget` (if useful)

**integration-jira** (refactored from current provider): `jira.create_issue` (produces `jira.issue`), `jira.transition_issue` (consumes `jira.issue`), `jira.add_comment` (consumes `jira.issue`).

**integration-teams**: `teams.post_message` (produces `teams.message`), `teams.edit_message` (consumes `teams.message`).

**integration-webex**: `webex.post_message` (produces `webex.message`), `webex.edit_message` (consumes `webex.message`).

**integration-webhook**: `webhook.send` (optionally produces `webhook.delivery`).

**integration-script**: `script.run` (optionally produces `script.result`).

**Built-in (automation-backend)**: `log`, `notify_user`, `http.request` (?).

---

## 5. Phase plan with checkboxes

### Phase 0 — Foundation (this session)

- [x] Design alignment locked
- [x] Branch `feat/automation-platform` off `main`
- [x] Platform internals explored (plugin lifecycle, extension points, hooks, queue manager)
- [x] GitOps kind registration pattern explored
- [x] Frontend package conventions explored
- [x] Drizzle migration workflow explored
- [x] Full hook + action catalog inventoried across all plugins
- [x] **Package scaffolds created:**
  - [x] `core/template-engine/` — `package.json`, `tsconfig.json`, `src/index.ts`
  - [x] `core/automation-common/` — `package.json`, `tsconfig.json`, `src/plugin-metadata.ts`, `src/access.ts`, `src/routes.ts`, `src/index.ts`
  - [x] `core/automation-backend/` — `package.json`, `tsconfig.json`, `drizzle.config.ts`
  - [x] `core/automation-frontend/` — `package.json`, `tsconfig.json`
- [x] **`@checkstack/template-engine` complete:**
  - [x] `src/types.ts` — `TemplateContext`, `ParsedTemplate`, `ParsedCondition`, `SourcePosition`, `SourceRange`, `Filter`, `FilterRegistry`
  - [x] `src/errors.ts` — `TemplateError`, `TemplateParseError`, `TemplateRenderError`, `UnknownFilterError`, `pointRange`
  - [x] `src/tokenizer.ts` — full tokenizer with mode switching for literal text vs expressions
  - [x] `src/ast.ts` — AST node types (literal, identifier, member, index, ternary, binary, unary, pipe)
  - [x] `src/parser.ts` — recursive descent parser with full operator precedence (ternary → pipe → || → && → ==/!= → comparison → unary → postfix → primary). Exports `parseTemplate(source)` and `parseCondition(source)`.
  - [x] `src/renderer.ts` — evaluator with strict/lax modes. Exports `render()`, `evaluate()`, `evaluateBoolean()`.
  - [x] `src/filters.ts` — `createFilterRegistry()` + `createDefaultFilterRegistry()` with 13 built-ins: `default`, `upper`, `lower`, `capitalize`, `trim`, `truncate`, `length`, `json`, `iso`, `date`, `join`, `replace`, `not`. Plus `isTruthy()` (centralized truthiness rule).
  - [x] `src/__tests__/parser.test.ts` — 11 tests
  - [x] `src/__tests__/renderer.test.ts` — 21 tests
  - [x] **32/32 tests passing** via `bun test`
- [x] **`@checkstack/automation-common` complete:**
  - [x] `src/schemas.ts` — All schemas: `TriggerSchema`, recursive `ConditionSchema`, all 9 action primitive schemas (`ProviderActionSchema`, `ChooseActionSchema`, `ParallelActionSchema`, `DelayActionSchema`, `RepeatActionSchema`, `VariablesActionSchema`, `ConditionGuardActionSchema`, `StopActionSchema`, `WaitForTriggerActionSchema`), `ActionSchema` (recursive union), `AutomationModeSchema`, `AutomationDefinitionSchema`, `AutomationSchema`, run state schemas, artifact schema, all API input schemas, registry-info schemas.
  - [x] `src/signals.ts` — `AUTOMATION_DEFINITION_CHANGED`, `AUTOMATION_RUN_STARTED`, `AUTOMATION_RUN_COMPLETED`, `AUTOMATION_RUN_STEP_COMPLETED`
  - [x] `src/rpc-contract.ts` — Full oRPC contract with 15 endpoints
- [x] Workspace wired: `bun install` clean; `bun run typecheck:references:generate` updated 125 packages cleanly
- [x] Persistent plan written to `.agent/plans/automation-platform.md` (this file)

### Phase 1 — automation-backend foundation ✅ COMPLETE

- [x] **Extension points** in `core/automation-backend/src/extension-points.ts`:
  - [x] `automationTriggerExtensionPoint` with `registerTrigger<T>(definition, pluginMetadata)`
  - [x] `automationActionExtensionPoint` with `registerAction<TConfig, TArtifact>(definition, pluginMetadata)`
  - [ ] `automationConditionExtensionPoint` (deferred — template-based conditions cover the v1 surface; revisit only if a plugin needs a custom condition)
  - [x] `automationArtifactTypeExtensionPoint` with `registerArtifactType<T>(definition, pluginMetadata)`
- [x] **Trigger definition type** in `action-types.ts` — supports both hook-backed and setup-backed (cron/interval) triggers via mutually-exclusive `hook?` / `setup?` fields; `contextKey` extractor; per-trigger `configSchema` for setup-backed triggers.
- [x] **Action definition type** — `config: Versioned<TConfig>` (versioned for safe migration), optional `produces: ArtifactTypeRef` + `consumes: ArtifactTypeRef[]`, `execute(context)`. `ActionExecutionContext` includes pre-resolved config (templates already rendered), `consumedArtifacts`, run identity, scoped logger, and `getService<T>` for DI.
- [x] **Artifact type definition** — `id`, `displayName`, zod `schema`. Registered separately so actions reference them by type-id.
- [x] **Registries** mirroring `event-registry.ts` + `provider-registry.ts`:
  - [x] `createTriggerRegistry()` — namespace to `{pluginId}.{id}`, duplicate detection, JSON Schema generation, category grouping, rejects triggers with no hook AND no setup.
  - [x] `createActionRegistry()` — same namespacing + JSON Schema generation + category grouping.
  - [x] `createArtifactTypeRegistry()` — same conventions.
- [x] **Drizzle schema** in `core/automation-backend/src/schema.ts`:
  - [x] `automations(id text pk, name, description, status, definition jsonb, managed_by, created_at, updated_at)` + status/managed_by indexes
  - [x] `automation_runs(id text pk, automation_id fk, trigger_id, trigger_event_id, trigger_payload jsonb, context_key, status, error_message, started_at, finished_at)` + 3 indexes
  - [x] `automation_run_steps(id text pk, run_id fk, action_path, action_id, action_kind, provider_action_id, status, attempts, error_message, result_payload jsonb, started_at, finished_at)` + run index
  - [x] `automation_artifacts(id text pk, automation_id fk, run_id fk, step_id fk, action_id, artifact_type, data jsonb, context_key, closed_at, created_at)` + 3 lookup indexes: `(automation_id, context_key, artifact_type, created_at)`, `(automation_id, action_id, created_at)`, `(automation_id, closed_at)`
  - [x] `automation_wait_locks(id text pk, run_id fk, action_path, event_id, context_key, filter_template, timeout_at, created_at)` + event-lookup + timeout-sweep indexes
- [x] Migration generated: `drizzle/0000_acoustic_diamondback.sql` (5 tables, 9 indexes, 3 FKs).
- [x] **Service refs** for cross-plugin queries:
  - [x] `automationArtifactStoreRef` — `ArtifactStore` interface with `record`, `find`, `findAll`, `markClosed`.
  - [x] `automationRegistriesRef` — read-only `{ triggers, actions, artifactTypes }` view.
- [x] **Plugin definition** in `core/automation-backend/src/index.ts` — full lifecycle wiring: registers 3 extension points in Phase 1, creates artifact store + publishes services in Phase 2, logs registered counts in Phase 3, registers 3 command-palette commands (`Manage Automations` / `Create Automation` / `Template Playground`). Trigger fan-in and RPC router are stubbed with `TODO(phase-2)` / `TODO(phase-4)` markers — implementation lands in the named phases.
- [x] **Registry unit tests** (`registries.test.ts`) — 18 tests covering all three registries: namespacing, duplicate detection, category grouping, JSON Schema generation, contextKey preservation, multi-plugin isolation, setup-backed trigger registration, action execute context flow. **All passing.**
- [x] Full repo `bun run typecheck` clean; new packages `bun run lint` clean (zero warnings).

**Files created in Phase 1:**

```
core/automation-backend/src/
├── action-types.ts          # TriggerDefinition / ActionDefinition / ArtifactTypeDefinition + Registered* variants
├── trigger-registry.ts
├── action-registry.ts
├── artifact-type-registry.ts
├── extension-points.ts      # 3 extension points + 2 service refs
├── schema.ts                # 5 tables
├── artifact-store.ts        # createArtifactStore() — record/find/findAll/markClosed
├── index.ts                 # full plugin entry with re-exports
└── registries.test.ts
core/automation-backend/drizzle/
└── 0000_acoustic_diamondback.sql
```

**Schema correction during Phase 1:** Renamed `choose` block field `then` → `sequence` to match Home Assistant's actual YAML convention (HA uses `sequence` inside choose blocks, not `then`) and to avoid the `unicorn/no-thenable` rule. Any future docs / templates / migrations should use `sequence`.

### Phase 2 — Dispatch engine ✅ COMPLETE

- [x] **Dispatch foundation** (`src/dispatch/`):
  - [x] `types.ts` — internal types (`DispatchDeps`, `DispatchContext`, `ActionPath`, `StepOutcome`, `SequenceOutcome`, `RunStore` interface, run/step/wait-lock value types). `formatActionPath` utility produces strings like `actions[1].choose[0].sequence[2]` for audit logs.
  - [x] `action-kind.ts` — `detectActionKind()` discriminator inspecting which of the 9 keys is present (`action` / `choose` / `parallel` / `delay` / `repeat` / `variables` / `condition` / `stop` / `wait_for_trigger`).
  - [x] `scope.ts` — `buildInitialScope` / `extendVariables` / `withRepeatContext` / `resolveConsumedArtifacts`. Scope shape: `trigger.id/eventId/payload`, `variables.*`, `artifacts.<type|actionId>.*`, `repeat.item/index`, `now`.
  - [x] `render.ts` — `renderValue` (recursive over arrays/objects, strings through template engine), `renderString`, `renderExpression` (returns typed primitive instead of stringified).
  - [x] `condition.ts` — `evaluateCondition` / `evaluateAllConditions` handling both template-string conditions and `{ and | or | not }` combinators.
- [x] **Run-state persistence** (`src/dispatch/run-state.ts`) — Drizzle-backed `RunStore` implementing every method required by the engine: `createRun`, `updateRunStatus`, `loadRun`, `countActiveRuns`, `hasActiveRun`, `cancelActiveRuns`, `createStep`, `updateStep`, `createWaitLock`, `findWaitLocksFor`, `deleteWaitLock`, `sweepExpiredWaitLocks`.
- [x] **Automation CRUD store** (`src/automation-store.ts`) — `create`, `update`, `delete`, `toggle`, `getById`, `list`, plus the dispatch-engine queries `findEnabledByTriggerEvent` and `listEnabled`. Parses `definition` jsonb through `AutomationDefinitionSchema` on every read for safety.
- [x] **Engine + all 9 primitives** (`src/dispatch/engine.ts`) — single file (~700 lines) for related-logic locality. Exports `dispatchTrigger` (fresh-run entry) and `resumeRun` (post-wait resume).
  - [x] `action` — render config templates, validate against zod, resolve `consumes` from artifact store, call `execute`, persist `produces` artifact, update scope's `artifacts.<type>` and `artifacts.<actionId>`, record step success.
  - [x] `choose` — evaluate each `when`, recurse into first match's `sequence`, fall through to `else` if no match.
  - [x] `parallel` — `Promise.all` across branches, aggregate (suspension wins → suspended; failure → failed unless `continue_on_error`).
  - [x] `delay` — fixed `seconds` or templated `template`. Inline `setTimeout`; queue-backed long delays deferred to a follow-up.
  - [x] `repeat` — all four modes (`count`, `for_each`, `while`, `until`) with `max_iterations` safety (default 1000). Exposes `repeat.index` (always) and `repeat.item` (for_each only) to inner scope.
  - [x] `variables` — render values, push into the `variables` namespace via `extendVariables`.
  - [x] `condition` (guard) — evaluate; halt run with non-error status when falsy, fail step.
  - [x] `stop` — record step success, terminate run with `success` or `failed` depending on `error: bool`.
  - [x] `wait_for_trigger` — persist `automation_wait_locks` row, return suspended outcome. **v1 limitation:** only top-level waits supported (nested waits fail fast with a clear error). Resumption tracking machinery for nested waits is deferred to a follow-up.
- [x] **Trigger fan-in** (`src/dispatch/trigger-subscriber.ts`):
  - [x] `setupTriggerSubscriptions` iterates registered triggers in `afterPluginsReady`.
  - [x] Hook-backed triggers: `onHook(hook, listener, { mode: "work-queue", workerGroup: "automation-trigger-${qualifiedId}" })`. **Always work-queue** for horizontal-scale safety.
  - [x] Setup-backed triggers: invokes `trigger.setup` per (automation, triggerConfig) pair across enabled automations referencing the trigger.
  - [x] On firing: (1) wakes matching wait locks (filter template re-evaluated, `resumeRun` called, lock deleted); (2) routes to fresh runs for every enabled automation referencing the event.
- [x] **Concurrency modes** all four implemented in `respectConcurrencyMode`:
  - [x] `single`: skips if any run is active.
  - [x] `parallel`: starts a new run up to `max_runs`.
  - [x] `queued`: same cap as parallel in v1 (real FIFO coordination deferred — behaviour is still safe under work-queue mode).
  - [x] `restart`: cancels active runs then starts fresh.
- [x] **Run state lifecycle**: `running → success | failed | waiting | cancelled` writes via `RunStore.updateRunStatus`. Step writes via `createStep` + `updateStep`.
- [x] **Plugin entry rewired** (`src/index.ts`) — `init` constructs run-store / artifact-store / automation-store / `DispatchDeps`; `afterPluginsReady` receives `onHook` from runtime and threads through `setupTriggerSubscriptions`; cleanup callback disposes subscriptions on shutdown.
- [x] **Tests** (`src/dispatch/engine.test.ts` + `src/dispatch/test-fixtures.ts`) — 21 tests covering every primitive plus edge cases:
  - action: register-and-execute, templated config, unknown action, continue_on_error, halt on failure, consumed-artifact resolution, disabled-skip
  - choose: matched-branch, else-fallthrough, no-match-no-else
  - parallel: concurrent fan-out
  - delay: inline sleep
  - repeat: count / for_each / while-with-max
  - variables: scope-extension visible to downstream actions
  - condition (guard): truthy passes, falsy halts
  - stop: success vs failed by `error` flag
  - wait_for_trigger: suspends + records wait lock + `resumeRun` completes
  - run lifecycle: empty automation transitions running → success
- [x] **`@checkstack/automation-backend` tests: 39/39 passing** (18 registry + 21 dispatch). `bun test` < 100ms.
- [x] Full repo `bun run typecheck` clean. Package `bun run lint` clean (zero warnings).

**Files added in Phase 2:**

```
core/automation-backend/src/
├── automation-store.ts                   # CRUD + trigger-event lookup + listEnabled
├── dispatch/
│   ├── types.ts                          # RunStore interface, DispatchDeps, ActionPath
│   ├── action-kind.ts                    # detectActionKind (9 discriminator)
│   ├── scope.ts                          # build/extend/repeat/resolve-artifacts
│   ├── render.ts                         # renderValue / renderString / renderExpression
│   ├── condition.ts                      # evaluateCondition + and/or/not
│   ├── run-state.ts                      # createRunStore (Drizzle impl of RunStore)
│   ├── engine.ts                         # walker + all 9 primitives + dispatchTrigger/resumeRun
│   ├── trigger-subscriber.ts             # fan-in, concurrency, wait resumption
│   ├── test-fixtures.ts                  # in-memory RunStore/ArtifactStore + helpers
│   └── engine.test.ts                    # 21 primitive tests
└── index.ts                              # plugin entry — onHook routed into trigger-subscriber
```

**Notable v1 limitations (documented inline + here):**

- `wait_for_trigger` and `delay` are supported at the top-level `actions:` list and inside any depth of nested `choose` branches. They are explicitly rejected inside `parallel` or `repeat` bodies — operators see a clear error both at runtime and (Phase 4) at definition-validation time. Suspension inside parallel/repeat needs branch-level coordination state which is the only deferred follow-up.
- `mode: "queued"` currently behaves like `mode: "parallel"` within `max_runs`. Real FIFO coordination needs its own coordination queue and is a follow-up. Behaviour stays safe (no double-fire) under work-queue mode.

**Schema note (carried from Phase 1):** Choose branches use `sequence:` (not `then:`) to match Home Assistant's actual convention and avoid `unicorn/no-thenable`.

### Phase 2.5 — Durability layer ✅ COMPLETE

Built immediately after Phase 2 in the same session — restart safety, horizontal scaling, nested-wait resumption, and queue-backed delays are all production-grade in this PR; nothing here is half-finished.

- [x] **Schema additions** (`schema.ts` + migration `0001_mute_vindicator.sql`):
  - [x] `automation_run_state(run_id pk, scope_snapshot jsonb, last_action_path, last_heartbeat_at, updated_at)` + heartbeat index. One row per active/waiting run.
  - [x] `automation_wait_locks.kind` column (`"trigger" | "delay"`) + `automation_wait_locks_run_idx` for run-detail queries.
- [x] **RunStateStore** (`dispatch/run-state-store.ts`):
  - [x] `upsert` writes scope + last action path on every successful step.
  - [x] `load` rehydrates on resume.
  - [x] `clear` drops state at terminal run status.
  - [x] `heartbeat` bumps the timestamp without rewriting scope.
  - [x] `findStalledRunIds(threshold)` powers the sweeper.
  - [x] `tryAdvisoryLock` / `releaseAdvisoryLock` use Postgres `pg_try_advisory_lock(hashtextextended(runId, 0))`. Session-scoped — auto-release on process death is exactly the recovery property we need.
- [x] **Engine refactor** (`dispatch/engine.ts`):
  - [x] `walkSequence` accepts `resumeRemainder: ActionPath`. When set, skips ahead through nested containers; when the remainder reaches length 1, that index is the resumed action — treated as already-done; afterwards walking continues normally.
  - [x] `executeChoose` consumes `["choose", branchIdx, "sequence", …]` from the remainder and routes into the right branch's sequence walker. Any depth of `choose` nesting works.
  - [x] After every successful step + on suspension, `checkpoint(ctx, path)` writes scope snapshot + last action path. Failed steps don't checkpoint — recovery picks up the prior known-good state.
  - [x] `finaliseRun` clears the snapshot on terminal status, persists it on suspended status.
  - [x] **Queue-backed delay**: `executeDelay` persists a `kind: "delay"` wait lock with `timeoutAt`, enqueues a `automation-delay` queue job with `startDelay`, returns suspended. Crash-safe because the lock survives Redis loss; the sweeper picks it up via `timeoutAt`.
  - [x] **`resumeRun`**: parses `waitedAtPath`, validates suspension-allowed path, takes advisory lock, rebuilds context from snapshot, walks with remainder. Skips silently if another instance holds the lock.
  - [x] **`recoverStalledRun`**: entry point for the sweeper. Loads snapshot, computes remainder from `lastActionPath`, walks. Fails the run if no snapshot exists (refuses to re-run from scratch — could double-fire side effects).
- [x] **Stalled-run sweeper** (`dispatch/stalled-sweeper.ts`):
  - [x] `startStalledSweeper` runs every 30s (default), scans for runs whose heartbeat is older than 60s (default).
  - [x] Per stalled run: try advisory lock; if acquired, look up automation, call `recoverStalledRun`, release lock.
  - [x] Also sweeps expired wait locks: `kind: "delay"` past timeout → resume the run (covers queue-job-loss case); `kind: "trigger"` past timeout → fail the run with "wait timed out".
  - [x] Lock acquisition is per-runId hashed — two sweepers on different instances will not contend on the same run.
- [x] **Delay queue consumer** (`dispatch/delay-queue.ts`):
  - [x] `startDelayQueueConsumer` registers `automation-delay-resume` consumer group on the `automation-delay` queue.
  - [x] On job firing: load wait lock, load run + automation, delete lock, call `resumeRun` (which takes the advisory lock).
- [x] **Plugin entry wiring** (`index.ts`):
  - [x] `queueManager` injected via `coreServices.queueManager`.
  - [x] `RunStateStore` constructed in `init` + threaded into `DispatchDeps`.
  - [x] `afterPluginsReady` starts trigger subscriptions + delay queue consumer + stalled sweeper.
  - [x] `registerCleanup` disposes all three on shutdown.
- [x] **Path navigation** (`dispatch/path-nav.ts`):
  - [x] `parseActionPath` / `formatActionPath` round-trip. `actions[0].choose[0].sequence[1]` ↔ `["actions", 0, "choose", 0, "sequence", 1]`.
  - [x] `isSuspensionAllowedAtPath` rejects any path containing `parallel` / `repeat` — used both at runtime in `executeWaitForTrigger` / `executeDelay` and at resumption-path validation in `resumeRun` / `recoverStalledRun`.
- [x] **Tests** (10 new tests added; 46/46 dispatch tests passing total):
  - [x] Queue-backed delay end-to-end: suspends, enqueues job with `startDelay`, resumes correctly.
  - [x] Delay rejected inside parallel.
  - [x] Nested wait inside choose: resumes from `actions[0].choose[0].sequence[1]` and completes the post-wait sibling.
  - [x] Wait rejected inside parallel.
  - [x] Scope snapshot written after each successful step; cleared on terminal status.
  - [x] `recoverStalledRun` resumes from the persisted snapshot: step-1 marked done, step-2 + step-3 fire.
  - [x] `recoverStalledRun` fails the run if the snapshot is missing (refuses double-side-effect).
  - [x] Advisory lock blocks a second resumer; works again after release.
  - [x] All existing primitive tests continue to pass after the refactor.

**Full repo verification:**
- `bun run typecheck` clean
- `bun run lint` clean (zero warnings, `--max-warnings 0` enforced)
- `bun test` (full repo) — **2216 pass / 0 fail / 5 skipped** across 188 test files

**What this gives the operator:**

| Concern | How it's solved |
|---|---|
| Process restart mid-run | Stalled sweeper picks up runs whose heartbeat is older than threshold; `recoverStalledRun` rebuilds context from snapshot + resumes from the next sibling after `last_action_path`. |
| Horizontal scaling — no double-fire | Trigger subscriptions are `mode: "work-queue"`. Resume entry points (manual, sweeper, delay consumer, wait-lock match) all take a per-runId Postgres advisory lock before walking — at most one instance executes a run at a time. |
| Close the Jira created earlier | `wait_for_trigger` is fully nested-resume capable. The close-on-resolve automation can wait inside the same `choose` branch that opened the ticket; on resume the engine continues past the wait and into `jira.transition_issue` with the artifact still in scope. |
| Long delays survive restart | Every delay persists a `kind: "delay"` wait lock + enqueues a queue job with `startDelay`. Either the queue fires and resumes the run, or the sweeper catches the expired lock — both paths are idempotent through the advisory lock. |

The only suspension scenario explicitly NOT supported in v1 is suspension inside `parallel` / `repeat` bodies. That needs branch-level coordination state and is the only deferred follow-up. The runtime rejects it with a clear error and validation will reject it at edit-time in Phase 4.

### Phase 2.6 — Suspensions anywhere (parallel + repeat + sequence primitive) ✅ COMPLETE

The Phase 2.5 limitation is removed: waits and delays now work inside parallel branches and repeat iterations as first-class behaviour, not as a deferred follow-up. No half-finished functionality.

- [x] **`sequence` action primitive (the 10th):**
  - [x] `SequenceInput` interface + `SequenceActionSchema` added to `@checkstack/automation-common`, registered in the `ActionSchema` union.
  - [x] `detectActionKind` extended to recognize `"sequence"`.
  - [x] `executeSequence` handler in the engine: identical walking semantics to a top-level action list, including suspension propagation and resume routing via `["sequence", innerIdx, …]` remainder.
  - [x] Enables multi-action parallel branches (`{ parallel: [{ sequence: [create, wait, close] }, ...] }`) so the close-Jira-on-resolve case fits naturally in one parallel branch.
- [x] **`executeParallel` resume support:**
  - [x] Per-branch terminal outcomes persisted as `step.result_payload.branchOutcomes` (`{ "0": { status: "completed" }, "1": { status: "suspended" }, ... }`).
  - [x] Initial execution: `Promise.all` across branches; if any branch suspends, the step is marked `waiting` with the accumulated `branchOutcomes`.
  - [x] Resume: routes via `["parallel", branchIdx, …]` remainder, walks only the suspended branch, updates that one slot in `branchOutcomes`, recomputes whether the parallel is now done.
  - [x] Two simultaneously-suspended branches resume independently — the run stays in `waiting` until both have completed; the second resume triggers the walk past the parallel.
  - [x] Failure semantics preserved: any branch failing fails the parallel unless `continue_on_error: true`.
  - [x] `RunStore.findStepByPath(runId, actionPath)` added so resumes can rehydrate the step's `branchOutcomes` (most-recent step row by `started_at desc`).
- [x] **`executeRepeat` resume support:**
  - [x] On suspension the step's `result_payload` records `{ iterations: <progressed-so-far>, forEachList?: <cached> }`.
  - [x] For `for_each`: the materialized list is cached on the step so a resume sees the same iteration order even if the source expression's scope drifted.
  - [x] Resume: routes via `["repeat", iterIdx, "sequence", …]` remainder, walks the suspended iteration's body from the wait point, then `runRepeatLoop` continues with iteration `iterIdx + 1` per the mode (count / for_each / while / until). `while`/`until` conditions are re-evaluated from the post-iteration scope (correct: that's the same point the original execution would have evaluated them).
- [x] **`executeWaitForTrigger` + `executeDelay`** no longer reject paths containing `parallel` / `repeat`. Both work anywhere in the action tree.
- [x] **`resumeRun`** drops the `isSuspensionAllowedAtPath` gate — resumes happily route through any container the path traverses.
- [x] **`recoverStalledRun` (sweeper recovery)** refined:
  - [x] Mid-`parallel`-branch stall with no wait lock → refuse and fail the run (branch concurrency state genuinely lost — running both is double-fire, picking one is non-deterministic).
  - [x] Mid-`repeat`-iteration stall → safe to recover (iterations are sequential and the path encodes which iteration's body to resume).
  - [x] Intentional waits inside parallel / repeat are unaffected because they ride the wait-lock resume path (`sweepExpiredWaitLocks` + `wakeWaitingRuns`), not the heartbeat-stall path.
- [x] **Tests (5 new tests):**
  - [x] Wait inside parallel branch: suspends, resumes the single suspended branch, continues past the parallel. Path `actions[0].parallel[1][0]` (the trailing `[0]` is the single-action branch wrapper).
  - [x] Two parallel branches each suspended on different events: first resume leaves run waiting; second resume completes the parallel and continues to the next action.
  - [x] Delay inside parallel branch: same flow as above with a `kind: "delay"` wait lock + queue job.
  - [x] Wait inside repeat iteration via nested choose: suspends mid-iteration-1, resumes, completes iterations 1 + 2. Path `actions[0].repeat[1].sequence[1].choose[0].sequence[0]`.
  - [x] `for_each` repeat with mid-iteration wait: caches the list, resumes after the third item suspended, completes remaining iterations.
  - [x] Multi-action parallel branch via `sequence`: full create + wait + close lifecycle inside one parallel branch, sibling branch finishes normally, both join, post-parallel action runs.
- [x] **Quality gates** — `bun test` (full repo): **2221 pass / 0 fail / 5 skipped** across 188 files. `typecheck` clean. `lint` clean.

**No suspension scenarios are deferred.** Waits and delays work everywhere they can be placed by the schema. The only remaining restriction is the stalled-sweeper safety boundary on mid-parallel-without-wait-lock recovery, which is correct rather than half-finished — there's nothing safe to do in that case.

### Phase 3 — Artifact storage ✅ COMPLETE (rolled into Phase 2)

- [x] `src/artifact-store.ts`:
  - [x] `record` — writes to `automation_artifacts` (called by the engine on every successful action with `produces`).
  - [x] `find` / `findAll` — narrows by `(automationId, contextKey?, artifactType?, actionId?)`, latest by `createdAt desc`, optional `onlyOpen` (defaults true) to skip closed artifacts.
  - [x] `markClosed` — sets `closedAt` (for downstream close actions).
- [x] Engine integration:
  - [x] After a successful provider action, the engine reads `registered.produces` and calls `artifactStore.record(...)` with the action's returned `artifact`.
  - [x] In-memory scope's `artifacts.<type>` and `artifacts.<actionId>` are immediately updated so subsequent actions in the same run can reference them without a DB round-trip.
  - [x] When an action declares `consumes`, `resolveConsumedArtifacts` queries the store by type within the current run's `contextKey` scope and feeds the data into `consumedArtifacts` on the action's execution context.
- [x] Conflict policy (documented in `scope.ts`): when multiple actions in the same automation produced the same artifact type, the most-recent OPEN artifact wins; operators wanting explicit producer pinning should reference by `id` (the engine auto-populates `artifacts.<actionId>` whenever an action assigns an id).

### Phase 4 — Backend RPC router ✅ COMPLETE

Mirrors `core/integration-backend/src/router.ts`. The contract was first
refactored from `oc.router({...})` (raw oRPC) to the project's `proc()`
pattern with `userType`, `operationType`, and `access` metadata so
`autoAuthMiddleware` enforces auth + access automatically. Also exported
`AutomationApi` via `createClientDefinition` for the frontend client.

- [x] `listAutomations` — paginated, filter by status (delegates to `automationStore.list`)
- [x] `getAutomation` — 404 on unknown id
- [x] `createAutomation` — Zod validation via `automationStore.create`; broadcasts `AUTOMATION_DEFINITION_CHANGED:created`
- [x] `updateAutomation` — existence check + Zod re-validation; broadcasts `updated`
- [x] `deleteAutomation` — existence check + delete; broadcasts `deleted`
- [x] `toggleAutomation` — existence check + status flip; broadcasts `updated`
- [x] `validateDefinition` — runs `AutomationDefinitionSchema.safeParse`; flattens `ZodIssue.path` (string/number array) to match `ValidateDefinitionResultSchema`
- [x] `manualRun` — picks trigger by id (or first one when omitted), extracts contextKey via the registered trigger's extractor function, calls `dispatchTrigger` directly, broadcasts `AUTOMATION_RUN_COMPLETED`
- [x] `listRuns` — paginated, filter by `automationId`/`status`; direct drizzle queries against `automation_runs`
- [x] `getRun` — loads run + all steps (asc by `started_at`) + all artifacts (asc by `created_at`)
- [x] `cancelRun` — idempotent for terminal-status runs; otherwise updates status + tears down wait locks + clears per-run state, then broadcasts `AUTOMATION_RUN_COMPLETED:cancelled`
- [x] `listTriggers` / `listActions` / `listArtifactTypes` — registry introspection, mapped to `TriggerInfo` / `ActionInfo` / `ArtifactTypeInfo`. `contextKey` is intentionally omitted from `TriggerInfo` (the runtime form is a function `(payload) => string | undefined`, not a serialisable path)
- [x] `renderTemplate` — uses `parseTemplate`/`render` or `parseCondition`/`evaluateBoolean` from `@checkstack/template-engine` with the dispatch deps' default filter registry; `TemplateError` is mapped to `{ message, line, column }` from `error.range.start`
- [x] Access control: all reads on `automationAccess.read`, all mutations on `automationAccess.manage`. `validateDefinition` and `renderTemplate` are read-gated since they're inspection tools that don't change state
- [x] Plugin entry wires `signalService` from `coreServices`, constructs the router via `createAutomationRouter`, and registers it with `rpc.registerRouter(router, automationContract)` (replacing the `void rpc` Phase-4 placeholder)
- [x] Tests (`src/router.test.ts`, 24 tests): every CRUD path (happy + 404), `validateDefinition` valid/invalid, `manualRun` (404/missing-trigger/default-trigger + signal), `cancelRun` (404/idempotency/teardown+signal), registry listings, `renderTemplate` template/condition/parse-error. Uses in-memory `AutomationStore` + the existing `makeDispatchDeps` fixture + `createMockSignalService`. Drizzle-chain stubs (`fluentSelect`/`fluentUpdate`/`fluentDelete`) cover the run-table queries without a real DB

**Implementation notes**:
- For signal assertions, mock-signal-service filters by `signal.id` (not `signal.event`). Always assert against `SIGNAL_CONST.id`.
- `manualRun` calls `dispatchTrigger` directly (not in the background). Since the engine returns "waiting" immediately when an action suspends, the response is prompt for typical flows. For long synchronous action sequences with no waits, the HTTP request will block until completion — fine for an operator's "Run Now" use case.
- Used `fluent*` chain helpers in tests because `createMockDb` doesn't compose the `.from().where().orderBy().limit().offset()` ordering the runs router needs.

### Phase 5 — Incident triggers + Jira reference (showcase) ✅ COMPLETE

- [x] **incident-backend** registers in `register()` phase using `env.getExtensionPoint(automationTriggerExtensionPoint)`:
  - [x] `incident.created` trigger — payload includes `incidentId`, `systemIds`, `title`, `description?`, `severity`, `status`, `createdAt`; `contextKey: (p) => p.incidentId`
  - [x] `incident.updated` trigger — adds `statusChange?` over the created payload
  - [x] `incident.resolved` trigger — `incidentId`, `systemIds`, `title`, `severity`, `resolvedAt`
- [x] **incident-backend** registers actions in `init()` after creating `IncidentService` (closure-captured):
  - [x] `incident.create` — config: `{ title, description?, severity, systemIds, initialMessage?, suppressNotifications? }`; produces an incident-artifact-shaped result; calls `service.createIncident`
  - [x] `incident.resolve` — config: `{ incidentId, message? }`; returns `success: false` with a "not found" error when the id doesn't exist
  - [x] `incident.add_update` — config: `{ incidentId, message, statusChange? }`
  - [x] `incident.update_status` — config: `{ incidentId, status, message? }`; delegates to `service.addUpdate` with a generated "Status changed to X" message when none provided
- [x] **integration-jira-backend** refactor:
  - [x] `jira.issue` artifact type registered in `register()` — zod schema `{ issueKey, projectKey, issueUrl: z.url(), id, status? }`
  - [x] Jira client extended with `getIssueStatus`, `getTransitions`, `transitionIssue`, `addComment`. `transitionIssue` reads transitions + current status in parallel and short-circuits with `{ alreadyApplied: true }` when the destination already matches; rejects unknown transition ids; uses ADF body for Cloud / plain text for Data Center on comments; bypasses the JSON-parsing `request` helper for the 204-returning transitions endpoint
  - [x] `jira.create_issue` action — produces `jira.issue`; rate-limit handling re-uses the integration provider's `retryAfterMs: 60_000` pattern
  - [x] `jira.transition_issue` action — consumes `jira.issue` (falls back to upstream artifact's `issueKey` when config omits it); refreshes the artifact with the post-transition status name
  - [x] `jira.add_comment` action — consumes `jira.issue`; returns `{ commentId, issueKey }`
  - [x] `JIRA_RESOLVERS.TRANSITION_OPTIONS` cascading resolver wired into the existing `getConnectionOptions` handler; depends on `connectionId` + `issueKey`, returns `value: t.id, label: "Name → Destination"`
- [x] **integration-backend** re-exports `ConnectionStore` so the Jira automation deps can be typed without `any`
- [x] **Tests** (60 tests total across 4 new files, 0 failing, 2263 repo-wide pass):
  - `core/incident-backend/src/automations.test.ts` — 5 tests covering all 4 action happy/error paths
  - `plugins/integration-jira-backend/src/jira-client.test.ts` — +7 tests for transitions (parse, short-circuit, POST with comment, unknown transition) + comments (ADF vs plain text). Includes a new `setupFetchSequence` helper for multi-call flows
  - `plugins/integration-jira-backend/src/automations.test.ts` — 6 tests covering create (happy + missing-connection), transition (upstream-artifact resolution + missing-key), comment (happy path), and the `jira.issue` schema (valid + bad URL)
- [x] **Changesets**:
  - `.changeset/automation-phase-4-rpc-router.md` (automation-backend / automation-common minor)
  - `.changeset/automation-phase-5-incident-triggers-actions.md` (incident-backend minor)
  - `.changeset/automation-phase-5-jira-actions.md` (integration-jira-backend minor, integration-backend patch)

**Implementation notes**:
- Actions register at `init()` (not `register()`) because they capture deps (`IncidentService`, `ConnectionStore`) created during init. Triggers register in `register()` since they only need hook references.
- Action `execute` callbacks use closure-captured deps instead of `ctx.getService(serviceRef)` because the dispatch engine's `getService` is still a throwing stub. Wiring it up properly through `BackendPluginRegistry` is out of scope for Phase 5 — closure is sufficient and matches how the existing Jira integration provider captures `ConnectionStore`.
- For heterogeneous `TriggerDefinition[]`, declare the array as `TriggerDefinition<unknown>[]` and cast each entry — without this, TypeScript collapses the union into the first member's payload shape and the loop fails to typecheck.
- The 204-No-Content response from Jira's transitions POST needs a fetch that bypasses `request<T>` (which always calls `response.json()`). The bypass is inline rather than refactoring `request` — fine for one call site.
- `resolveIssueKey` in `jira/automations.ts` is the canonical pattern for "config takes priority, fall back to upstream artifact" — copy it when adding more `consumes`-based actions.

### Phase 6 + 7 + 8 — Migration + provider refactor + legacy removal ✅ COMPLETE (bundled)

Done in a single PR per user direction ("one-time migration, remove
legacy integration code in this PR"). Notes on what shipped:

**Migration** ([core/automation-backend/src/migration/from-webhook-subscriptions.ts](../../core/automation-backend/src/migration/from-webhook-subscriptions.ts))

- [x] Pull legacy rows via service RPC `IntegrationApi.listLegacySubscriptions` — plugins are sandboxed to their own schema (no `SafeDatabase` cross-table queries), so service-to-service RPC is the only path
- [x] Per-row mapping in `buildDefinitionFor`:
  - `providerId` → action qualifiedId (`integration-jira.jira` → `integration-jira.create_issue`, …)
  - `eventId` → trigger event (1:1, passed straight to `trigger.event`)
  - `providerConfig` → action config (per-provider translator handling renamed fields like `summaryTemplate` → `summary`, `bodyTemplate` → `body`, `messageTemplate` → `markdown`, and Jira's `fieldMappings[].template` → `value`)
  - `systemFilter` → top-level condition. Empty → no condition. Single id → one template string. Multiple → `{ or: [...] }` combinator
  - `enabled` → `status` (`"enabled"` / `"disabled"`)
- [x] Defaults for Teams + Webex when the legacy subscription didn't supply a body — generates a sensible `{{ trigger.payload | json(2) }}` template so existing subscriptions keep firing until the operator edits them
- [x] Idempotent across boots: skips rows that already have an automation with `managed_by = "migrated-subscription:<id>"`
- [x] Validation via `AutomationDefinitionSchema.safeParse` before insert — surfaces structural errors as failure rows instead of crashing the dispatch engine on first run
- [x] Runs on `afterPluginsReady` so the integration RPC is reachable and all triggers/actions have registered
- [x] Tests: 11 cases in [from-webhook-subscriptions.test.ts](../../core/automation-backend/src/migration/from-webhook-subscriptions.test.ts) covering unknown providers, all 5 known providers (Jira + field-mapping rename, Teams default body, Webex template-or-fallback, webhook body rename, script/shell unification), and systemFilter → conditions (empty, single, multi)

**Failure surface** ([automation_migration_failures](../../core/automation-backend/src/schema.ts))

- [x] New `automation_migration_failures` table — one row per subscription that couldn't migrate (`subscriptionId` unique, full `providerConfig` snapshot, reason + detail)
- [x] `onConflictDoUpdate` on insert so re-runs refresh the row instead of duplicating
- [x] RPC: `AutomationApi.listMigrationFailures` (read) + `acknowledgeMigrationFailure` (delete a single row) — admin reviews, fixes by hand (recreates as automation), acknowledges
- [x] No notification-platform integration: chose a simple DB-backed + RPC surface over wiring the notification system. Admins see the list when they visit `/automation/migration-failures` (page to be added in Phase 12)

**Provider refactor**

- [x] **integration-jira-backend**: `deliver` removed from provider; `jira.create_issue` action keeps `fieldMappings` with the cascading dropdown driven by `JIRA_RESOLVERS.FIELD_OPTIONS`. Provider keeps connection schema + `testConnection` + `getConnectionOptions`. `JiraSubscriptionConfigSchema`, `DynamicJiraFieldMappingSchema`, and the legacy `template-engine.ts` were deleted
- [x] **integration-teams-backend**: `teams.post_message` action wraps the message body in a minimal Adaptive Card (no more auto-generated payload dump). Provider keeps connection + Graph API token helper, exported for the action
- [x] **integration-webex-backend**: `webex.post_message` action posts markdown to a room. Provider keeps connection + room-options resolver
- [x] **integration-webhook-backend**: `webhook.send` action. No connection — the plugin is action-only now (no provider registration). Auth (`bearer` / `basic` / `header` / `none`), custom headers, retryable status codes preserved 1:1
- [x] **integration-script-backend**: `script.run` action. No connection. The legacy `script` and `shell` provider variants converged on a single action (`integration-script.run`); the migration script maps both legacy ids to it. The legacy `PAYLOAD_*` env-flattening is gone — operators reference template values directly (`{{ trigger.payload.foo }}`) instead

**Legacy removal**

- [x] Deleted: `delivery-coordinator.ts`, `hook-subscriber.ts`, `event-registry.ts`, all their tests
- [x] Stripped `integration-backend/src/router.ts` to connection-only + the new `listLegacySubscriptions` service endpoint. `integration-common/src/rpc-contract.ts` matches
- [x] Stripped `IntegrationProvider` interface: dropped `config` (subscription config), `deliver`, `supportedEvents`. New shape is connection-only with optional `testConnection` + `getConnectionOptions`. `IntegrationProvider<TConnection>` is now single-arg (was `<TConfig, TConnection>`)
- [x] `webhook_subscriptions` table is **kept in DB** (schema entry retained so the service RPC can read it) for one release as backup. `delivery_logs` table is **kept in DB** but no longer modelled in the TS schema. Both will be dropped in a follow-up migration once we've shipped at least one release without regressions
- [x] Updated `integration-frontend`: deleted `IntegrationsPage`, `DeliveryLogsPage`, `CreateSubscriptionDialog`, `IntegrationMenuItem`. Plugin entry only routes `/connections/:providerId` to `ProviderConnectionsPage` now. Subscription / migration-failure UIs will be added under `/automation/...` in Phase 12
- [x] Plugins that previously registered hooks via `integrationEventExtensionPoint.registerEvent(...)` now register them via `automationTriggerExtensionPoint.registerTrigger(...)`. Migrated:
  - `incident-backend` (Phase 5, already had triggers)
  - `healthcheck-backend` (`healthcheck.system.degraded`, `healthcheck.system.healthy`)
  - `maintenance-backend` (`maintenance.created`, `maintenance.updated`)
  - `slo-backend` (6 triggers: budget warning/critical/exhausted, streak.broken, achievement.unlocked, weekly.digest)
- [x] Removed `@checkstack/integration-backend` / `integration-common` deps from those plugins; added `@checkstack/automation-backend` instead

**Implementation notes**

- The legacy `script` and `shell` providers collapsed to one `integration-script.run` action because their config shapes overlapped to the point of confusion. The migration handles both ids
- `jiraProvider`, `teamsProvider`, and `webexProvider` still register through `integrationProviderExtensionPoint` (alongside their automation action registration). That's required, not vestigial: the action config exposes a `connectionId` field whose dropdown is populated by `IntegrationApi.listConnections({ providerId })`, and the cascading `x-options-resolver` dropdowns (`projectKey`, `teamId`, `roomId`, …) call `IntegrationApi.getConnectionOptions(...)` which delegates to the provider's `getConnectionOptions`. Both endpoints look the provider up in `providerRegistry`, so skipping registration would 404 the editor for any connection-bound action. webhook and script plugins skip the registration because their actions don't take a `connectionId`
- For TS heterogeneous action arrays (`IntegrationProvider<unknown>`), I had to cast through `IntegrationProvider<SampleConnection>` in the registry test to dodge structural mismatches — same pattern as the trigger array in `incident-backend/src/automations.ts`
- The migration helpfully wraps `listLegacySubscriptions` in a try/catch — if integration-backend isn't running (greenfield install), we just log a warning and skip rather than blocking the boot
- `acknowledgeMigrationFailure` uses `delete().returning()` to surface a 404 when the id doesn't match — operators don't end up with silent no-ops if they click "acknowledge" twice
- Legacy `webhook_subscriptions` / `delivery_logs` DB rows survive on existing installs as dead data. The follow-up cleanup PR adds a drizzle migration that drops both

### Phase 9 — Remaining plugin trigger/action catalog

Implement triggers + actions per plugin. Follow the same pattern: register in `register()` phase. Each section is its own commit / PR-able chunk.

- [x] **system / catalog**: catalog-backend ships `catalog.created`, `catalog.updated`, `catalog.deleted` triggers + `catalog.update_metadata` action + `catalog.system_record` artifact type (action / artifact names use `system_record` / `update_metadata` since the trigger ids are tied to the catalog entity lifecycle while the action operates on system metadata specifically). New `catalogHooks.systemUpdated` (with `changedFields` discriminator) emitted from both the RPC handler and the action. Action factory takes `emitHook` and registers in `afterPluginsReady` — the precedent for all mutation actions in this phase. The `system.health_changed` trigger is owned by the **healthcheck** chunk; `set_maintenance` / `clear_maintenance` are owned by the **maintenance** chunk.
- [x] **healthcheck**: triggers `healthcheck.system_degraded`, `healthcheck.system_healthy`, the umbrella `healthcheck.system_health_changed` (fires on every aggregated-health transition), plus the new `healthcheck.check_failed` (fires alongside `checkCompleted` whenever an individual run's status isn't `healthy`) and `healthcheck.flapping_detected` (fires from inside the auto-incident evaluator whenever the unhealthy-transition count crosses the policy threshold, regardless of `autoOpenIncidentOnUnhealthy`). Actions `healthcheck.run_now`, `healthcheck.enable_assignment`, `healthcheck.disable_assignment` + `healthcheck.assignment` artifact type. New service method `setAssignmentEnabled` flips the row's `enabled` flag without touching the surrounding config; `HEALTH_CHECK_QUEUE` exported so the `run_now` action can enqueue a one-off job. The flapping hook re-fires on every additional transition past the threshold — debounce on `(systemId, configurationId)` in the automation if "page once and only once" is wanted.
- [x] **satellite**: new hooks `satelliteHooks.connected`, `satelliteHooks.disconnected`, `satelliteHooks.heartbeatLost`. Emitted from the WS handler (auth completion / `onClose`) and the heartbeat monitor (online → offline transition only). Triggers `satellite.connected`, `satellite.disconnected`, `satellite.heartbeat_lost` registered. No mutation actions for satellite in this phase.
- [x] **slo**: 6 triggers already shipped in earlier work — `slo.budget_warning`, `slo.budget_critical`, `slo.budget_exhausted`, `slo.streak_broken`, `slo.achievement_unlocked`, `slo.weekly_digest`. Hooks are all emitted by the existing SLO dispatch + weekly-digest job paths. No actions in plan for slo — operators react to the triggers via other actions.
- [x] **dependency**: triggers `dependency.created`, `dependency.updated`, `dependency.deleted` + the new `dependency.impact_propagated` (fires once per upstream event from `evaluateAndNotifyDownstream` with the list of downstream systems whose derived state actually moved). Actions `dependency.create`, `dependency.remove` + `dependency.edge` artifact type. The impact-propagated hook fires regardless of notification suppression so an automation can react even when the user-facing notifications are skipped.
- [x] **notification**: new hooks `notificationHooks.delivered`, `notificationHooks.failed` — emitted from the shared `dispatchWithAttempt` funnel via a late-bound `hookSink` populated in `afterPluginsReady`, so every external delivery path (subscription fan-out + transactional send) surfaces uniformly. Triggers `notification.delivered`, `notification.failed` registered. Action `notification.send` wraps the existing service-mode `sendTransactional` RPC + `notification.send_result` artifact type.
- [x] **maintenance**: triggers `maintenance.created`, `maintenance.updated` (refactored out of the inline `register()` block into `automations.ts`) + actions `maintenance.create`, `maintenance.update`, `maintenance.add_update`, plus `maintenance.set_system` (the deferred `system.set_maintenance` — schedules a now+`durationMinutes` window covering one system) and `maintenance.clear_system` (the deferred `system.clear_maintenance` — closes every active/scheduled window covering a given system). Artifact type `maintenance.window`.

### Phase 10 — Built-in triggers from automation-backend

- [x] `automation.cron` trigger — uses `queueManager.scheduleRecurring({ cronPattern, jobId })`. Setup-backed; jobId derived from `(automationId, triggerId)`. Per-tick fire-callbacks live in a module-scoped `tickHandlers` map keyed by jobId; a single consumer on the shared `automation-builtin-triggers` queue dispatches. Restart works the same way regardless of queue backend: `setupTriggerSubscriptions` re-runs every enabled automation's `setup()` in `afterPluginsReady` on every boot, and `setup()` calls `scheduleRecurring(...)` again — on a BullMQ/Redis queue that's an in-place update of the surviving recurring job; on the in-memory queue (whose recurring-schedule map is wiped at shutdown) it re-creates the schedule from scratch. Either way the schedule is back in place before the consumer would dispatch.
- [x] `automation.interval` trigger — same shape as `automation.cron`, scheduling with `intervalSeconds`. `startDelay = intervalSeconds` so the operator doesn't see a tick the instant they save the automation.
- [x] `automation.template` trigger — interval-based; on each tick evaluates `config.value_template` via `template-engine.evaluateBoolean` against `{ now }` and fires on the false → true edge. `previousTruthy` lives in the `setup()` closure; teardown drops it. Invalid templates throw at setup time so the operator sees the error in the editor rather than as silently-never-firing.
- [x] Built-in actions `automation.log` (level-tagged line into the run logger; no artifact) and `automation.notify_user` (thin wrapper over `NotificationApi.sendTransactional` so the core install has a "notify a user" action without depending on the integration-notification plugin) + `automation.notify_user_result` artifact type. The built-in catalog is registered directly via the trigger/action registries in `init()` (no extension-point round-trip needed — automation-backend owns the registry).

### Phase 11 — UI primitives (`@checkstack/ui`) ✅ COMPLETE

- [x] **`VariableScopeResolver`** lives in `@checkstack/automation-common` as `resolveVariableScope`. Walks the definition top-down following an `ActionPath` of `{ slot, whenIndex?, index }` segments and accumulates: `trigger.event` + `trigger.payload.*` (as a **discriminated union over `trigger.event`** — every field surfaces, with `conditionalOnTriggers` annotating fields that come from a subset of subscribed triggers), `var.*` from upstream `Variables` actions in the same sequence slot, `artifact.<plugin>.<type>` from upstream Provider actions with `produces`, and `repeat.index` / `repeat.item` only when the path descends through a `repeat`. Conservative on purpose — does NOT bubble vars/artifacts out of branches because the editor can't statically prove which branch runs. **Condition-aware** — when descending through a `choose-when`, the branch's `when:` expression is parsed and matched against `trigger.event == "X"`, `!= "X"`, `||`/`&&` of those, and `{ and | or }` combinators; the narrowed trigger set is passed to the union builder so an action inside `'trigger.event == "incident.created"'` sees only that variant in scope (the `conditionalOnTriggers` annotation disappears). Nested branches compound. Anything outside the covered patterns falls back to the full union.
- [x] **`generateAutomationContextTypes`** lives in `@checkstack/automation-frontend` (consumes the resolver + the registry info, emits a TS `declare const context: { … }` declaration for Monaco's `addExtraLib`). Emits a real discriminated union: `type AutomationTrigger = { event: "incident.created"; payload: PA } | { event: "incident.resolved"; payload: PB }` so Monaco narrows correctly inside `if (context.trigger.event === "…") { … }` branches. Reuses `jsonSchemaToTypeScript` from `@checkstack/ui` via deep import (the `@checkstack/ui` barrel pulls Monaco's Vite-only `?worker` modules which break bun's test runner).
- [x] **`TemplateValueInput`** — extracted from `KeyValueEditor`'s previously-private `TemplateInput`. Single-line `{{ }}` autocomplete input; `detectTemplateContext` is also exported. `KeyValueEditor` now delegates to the shared component.
- [x] **`VariablePicker`** — hierarchical popover for the explicit "fx" / "Insert variable" workflow. Renders a filterable tree of `VariableNode`s with type chips and `Only when …` hints sourced from the resolver's `conditionalOnTriggers`.
- [x] **`TemplateInput`** — mode switcher (`text` / `code` / `bash` / `json` / `yaml`); `text` delegates to `TemplateValueInput`, all code modes delegate to `CodeEditor` so the visual editor can flip widget purely from the action's `x-editor-types` annotation.
- [x] **`TemplateInputToggle`** — small "fx" pill that flips a typed input into template mode and back. Auto-infers template mode when the saved value already starts with `{{`. Render-prop API for the typed editor so consumers keep control over their own input shape.
- [x] **`ActionCard`** — collapsible card for the visual editor's per-action shell. Decoupled from `DynamicForm`; container blocks (`ChooseBlock` / `ParallelBlock` / `RepeatBlock`) will compose it in Phase 12 with their own children. Toggle / delete / drag handle conditionally rendered.
- [x] **`integration-script.run_script` wiring** — `ScriptContext` docstring + `scriptRunConfigSchema.script` field description now reference `generateAutomationContextTypes`. The runtime payload stays `Record<string, unknown>` (the runner can't know the trigger schema), but the **editor** narrows it per-automation from the subscribed triggers' payload schemas via the new generator. The concrete Monaco `addExtraLib` wiring belongs to Phase 12's action editor card.
- [x] Storybook stories for `TemplateValueInput`, `VariablePicker`, `TemplateInputToggle`, `ActionCard`.

### Phase 12 — automation-frontend pages ✅ COMPLETE

- [x] `AutomationListPage` — paginated table with status toggle, status filter, runs deep-link, delete with confirmation modal.
- [x] `AutomationEditPage` — **Visual + YAML** tab switcher; both tabs read/write the same canonical `definition` state, switching tabs first commits the active tab's edits so neither side wins by accident:
  - [x] Top-level metadata form: name, description, status toggle, mode, max_runs.
  - [x] **Visual tab** ships the full editor. `AutomationDefinitionEditor` composes three sections (triggers, conditions, actions). Built from the Phase 11 primitives (`ActionCard`, `TemplateValueInput`, `VariablePicker`) plus a new `editor/` module:
    - `TriggersEditor` — per-trigger card with combobox event picker (`ItemPicker`), optional `id` / `filter`, and a `DynamicForm` for trigger config when the selected trigger declares one.
    - `ConditionsEditor` + recursive `ConditionEditor` — top-level pre-run gating and the same recursive editor reused inside `choose: when` clauses. Each level picks `expression` / `and` / `or` / `not`; `and` / `or` host child conditions with add/remove buttons; expression mode uses `TemplateValueInput` with inline `VariablePicker`.
    - `ActionListEditor` — drag-to-reorder list via `@dnd-kit/core` + `@dnd-kit/sortable`. Maintains a parallel stable-id array so edits don't churn React keys but reorders do. Add-step popover offers all 10 action kinds with their icons.
    - `ActionEditor` — dispatch component that picks the right per-kind body and wraps it in a shared `ActionCard` (icon, title, category badge, enable toggle, delete, drag handle). Header also exposes a kind-swap `<Select>` that preserves operator-set metadata (id, description, enabled, continue_on_error).
    - Per-kind bodies covering every primitive — Provider (with `DynamicForm` over the action's `configJsonSchema`), Variables (KeyValueEditor with JSON-or-template parsing), Stop, Delay (seconds vs template toggle), WaitForTrigger (event picker + filter + timeout + context_key), ConditionGuard (reuses `ConditionEditor`), Choose (recursive when-branches + optional else), Parallel, Sequence, Repeat (count / for_each / while / until + nested sequence + max_iterations safety net).
    - **Scope-aware autocomplete.** A `useVariableScope({ definition, path })` hook drives template properties for every field — each action card knows its `ActionPath`, so the `{{` autocomplete + `VariablePicker` only ever offers paths actually in scope at that position, including condition-narrowed `trigger.payload.*` inside `when:` branches. Reuses Phase 11's `resolveVariableScope`.
  - [x] **YAML tab** — Monaco `yaml` editor round-tripping the full schema. Switching from YAML to Visual parses the YAML first; bad YAML blocks the switch with a toast so the operator doesn't silently lose their edits.
  - [x] Save: commits the active tab → `validateDefinition` RPC → `createAutomation` / `updateAutomation`. Parse + validation errors render as a destructive Alert with `(line, column)` from the engine.
  - [x] "Run now" calls `manualRun` with the first declared trigger and navigates to the resulting run detail.
- [x] `RunsPage` — per-automation run history with the canonical `RunStatus` filter set.
- [x] `RunDetailPage` — run header, destructive Alert on failure, per-step timeline (status icon + attempts + inline error + collapsible result payload), trigger payload as read-only Monaco JSON, artifacts panel keyed by `artifactType`. Cancel-run button when the run is `running` or `waiting`.
- [x] `TemplatePlaygroundPage` — left/right editors for template + sample context, `template` / `condition` mode switcher, "Render" button calling the `renderTemplate` RPC, error display with line/column.
- [x] Plugin entry `src/index.tsx`: `createFrontendPlugin({ metadata, routes, extensions })`. No `foreignSignals` declared — automation's own signals are auto-invalidated. User menu slot extension contributes "Automations" via `AutomationMenuItems`.
- [ ] Search providers (command palette): deferred — frontend plugins don't currently contribute search providers per the established pattern (those are backend-only via `command-backend`).

### Phase 13 — GitOps Automation kind

- [ ] In `automation-backend/src/index.ts` `register()`:
  - [ ] Get `entityKindExtensionPoint` via `env.getExtensionPoint`
  - [ ] `kindRegistry.registerKind({ apiVersion: CHECKSTACK_API_VERSION, kind: "Automation", specSchema: AutomationDefinitionSchema, reconcile, delete })`
  - [ ] `reconcile`: upsert by entity name; set `automation.managedBy = providerId` so UI knows it's declarative.
- [ ] Frontend UI: when `getProvenanceLock({ kind: "Automation", entityId })` is `isLocked: true`, disable Save/Delete buttons and show a banner.
- [ ] Document the YAML format in `docs/src/content/docs/user-guide/reference/gitops-kinds.md`.

### Phase 14 — Testing

- [ ] Template engine: filter edge cases (null/undefined passthrough, type coercion, date formats), parser error recovery, strict-mode behaviour.
- [ ] Schema validation: every action primitive round-trips through zod and JSON Schema cleanly. Negative test cases (malformed shapes).
- [ ] Dispatch engine, per primitive:
  - [ ] `action` — config rendering, execution, artifact recording, error propagation
  - [ ] `choose` — first-match-wins, else branch, no-match (silent skip)
  - [ ] `parallel` — fan-out, all-complete, error containment
  - [ ] `delay` — short delays inline, long delays via queue scheduling
  - [ ] `repeat` — all 4 modes, max_iterations safety
  - [ ] `variables` — scope shadowing across nested blocks
  - [ ] `condition` (guard) — halt + continue_on_error variants
  - [ ] `stop` — terminal state shaping
  - [ ] `wait_for_trigger` — durability simulated via process restart
- [ ] Concurrency modes: `single`, `parallel`, `queued`, `restart` — each tested with overlapping trigger fires.
- [ ] Migration: every webhookSubscription fixture per provider migrates to a valid automation that the dispatch engine can execute. Idempotency test.
- [ ] End-to-end: full incident lifecycle. Open incident → automation creates Jira issue → close incident → same automation transitions Jira to Done.
- [ ] Edge cases: deleted subscription mid-life, external artifact already closed, retry exhaustion, cooldown.

### Phase 15 — Docs

- [ ] **Architecture** (`docs/src/content/docs/architecture/automation/index.md`): subsystem overview, lifecycle diagrams, extension-point catalog.
- [ ] **User guide:**
  - [ ] Building your first automation (walkthrough)
  - [ ] Triggers reference (per plugin, generated from registry)
  - [ ] Actions reference (per plugin)
  - [ ] All 9 control-flow primitives with examples
  - [ ] Template language reference (filters, operators, scope)
  - [ ] Multi-trigger automations + per-trigger tab UX
  - [ ] Working with artifacts across actions
- [ ] **Plugin-author guide** (`docs/src/content/docs/dev/extending/automations.md`):
  - [ ] Registering a trigger
  - [ ] Registering an action (with `produces` / `consumes`)
  - [ ] Registering an artifact type
- [ ] **GitOps kind reference**: `Automation` YAML format with full example.

### Phase 16 — Release pass

- [ ] Changesets for every affected package — minor bump with `BREAKING CHANGES:` notes (we're in beta, NEVER major):
  - [ ] `@checkstack/template-engine` (new)
  - [ ] `@checkstack/automation-common` (new)
  - [ ] `@checkstack/automation-backend` (new)
  - [ ] `@checkstack/automation-frontend` (new)
  - [ ] `@checkstack/integration-backend` (BREAKING — removed surface)
  - [ ] `@checkstack/integration-common` (BREAKING)
  - [ ] `@checkstack/integration-frontend` (BREAKING — routes changed)
  - [ ] `@checkstack/integration-jira-backend` (BREAKING — provider → action)
  - [ ] `@checkstack/integration-teams-backend` (BREAKING)
  - [ ] `@checkstack/integration-webex-backend` (BREAKING)
  - [ ] `@checkstack/integration-webhook-backend` (BREAKING)
  - [ ] `@checkstack/integration-script-backend` (BREAKING)
  - [ ] Each plugin that registered triggers/actions (incident-backend, healthcheck-backend, system-backend, etc.) — minor.
  - [ ] `@checkstack/ui` — minor (new components)
- [ ] `bun run typecheck:references:generate` (after any package.json changes)
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint` — clean (zero warnings)
- [ ] `bun test` — all green
- [ ] Manual smoke in dev server:
  - [ ] Create a "Test" automation triggered by `time.interval` every 60s with a `log` action; verify run history fills up
  - [ ] Create Jira close-on-resolve automation; trigger an incident; verify Jira ticket; resolve incident; verify ticket transitions
  - [ ] Toggle between visual and YAML editor, save, reload, confirm round-trip
  - [ ] Manual run from UI
  - [ ] Run-detail page shows steps + artifacts
- [ ] Verify auto-migration on a copy of real database state (every shipped provider config shape preserved).
- [ ] Open PR with detailed description summarising the design context, breaking changes, and migration safety.

---

## 6. How to pick this up cleanly

1. **Read this file from the top.** All design context is here — no need to chase the conversation.
2. **Check the branch is up to date** with `main`. If a few PRs have landed since this branch was cut, rebase before going further. Use git rebase (asking the user first if there are conflicts).
3. **Run sanity check:**
   ```bash
   bun install
   bun test core/template-engine/src/__tests__
   bun run typecheck
   ```
   All should pass. If not, fix before proceeding.
4. **Open the todo list in the user-facing chat** (with TodoWrite tool) so the user can see progress.
5. **Pick up at Phase 1**: build extension points + registries + DB schema + plugin definition. That gets to a "loadable plugin with empty dispatch" milestone — a useful first commit.
6. **Pace the work**: commit after each phase. Each phase is a reasonable PR boundary if a single huge PR proves unworkable.
7. **When in doubt, mirror the existing pattern**, not invent a new one. Section 3 above lists exact files to copy from.
8. **Never relax types or skip tests** to make CI green. The user has explicit feedback rules about this (see `.claude/CLAUDE.md`).

---

## 7. Key files created so far (artifact list)

```
core/template-engine/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts
    ├── errors.ts
    ├── tokenizer.ts
    ├── ast.ts
    ├── parser.ts
    ├── renderer.ts
    ├── filters.ts
    └── __tests__/
        ├── parser.test.ts
        └── renderer.test.ts

core/automation-common/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── plugin-metadata.ts
    ├── access.ts
    ├── routes.ts
    ├── schemas.ts
    ├── signals.ts
    └── rpc-contract.ts

core/automation-backend/
├── package.json
├── tsconfig.json
└── drizzle.config.ts

core/automation-frontend/
├── package.json
└── tsconfig.json

.agent/plans/automation-platform.md  (this file)
```

Also: `tsconfig.json` updated at repo root with the new package references (by `bun run typecheck:references:generate`).

---

## 8. Watch-outs / non-obvious things

- **zod 4 not 3**: this repo is on zod 4. Default schema files in `core/scripts/src/templates/` still reference zod 3 — ignore those. Existing packages use `^4.0.0` or `^4.2.1`.
- **No `any`, ever.** The user has strong feedback memory on this. Use `unknown` + narrowing or model the type.
- **Plugin DB schema isolation:** each plugin gets its own PostgreSQL schema named after `pluginId`. The migration runner sets `search_path` per plugin during migrate, then resets to `public`. Don't write cross-plugin queries that assume `public.` schema — go through service refs.
- **Hook subscriptions only in `afterPluginsReady`.** The Phase 2 `init()` does NOT receive `onHook`/`emitHook`. If you find yourself wanting to subscribe in init, you're using the wrong phase.
- **Extension points are called during Phase 1 across plugins in load order.** The buffered Proxy ensures Phase 1 calls from one plugin to another's extension point work regardless of registration order. Don't fight this — just call as needed.
- **Work-queue mode for dispatch.** All trigger subscriptions in the automation dispatcher MUST use `{ mode: "work-queue", workerGroup: "automation-..." }` so multi-instance deployments don't double-fire.
- **YAML library**: `yaml` package (v2.6.1+) is already in `automation-backend` and `automation-frontend` deps for YAML round-tripping.
- **Test runner**: bun, not vitest/jest. `bun test` automatically discovers `*.test.ts` files.
- **Changesets are BLOCKING for CI.** Don't forget them per package.
- **Template engine has 32 unit tests passing** — if any of those break during refactor, fix the engine, not the test.
- **No em-dashes in user-facing content** (rule in `~/.claude/CLAUDE.md`).
- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `chore:`, etc.
- **Ask before committing.** User instruction. Never auto-commit or push.

---

## 9. Open questions to resolve in-session

These were raised but not finalized. Confirm with the user when you reach the relevant phase:

1. **Connection store final home** (Phase 8): keep in a minimal `integration-backend` or extract to new `connection-backend`? Defer until other things land — the answer depends on whether anything else needs credential storage.
2. **Maintenance trigger payloads** — do they carry `systemIds`? Check `core/maintenance-backend/src/hooks.ts` and clarify with user if ambiguous.
3. **Satellite hooks** — currently sparse ([`core/satellite-backend/src/hooks.ts:14-16`](../../core/satellite-backend/src/hooks.ts)). Need new hooks for connected/disconnected/heartbeat_lost. Add or ask user to scope this in a follow-up?
4. **`automation.trigger` action** — should automations be able to manually trigger other automations? Useful for shared sub-flows. Could be a built-in action in Phase 10.
5. **Variable picker live sample data overlay** — deferred to a polish phase. Defer until Phase 12 ships and operators are using it.

---

*Last updated: 2026-05-29. Phases 0, 1, 2, 2.5 (durability), 2.6 (suspensions anywhere + sequence primitive), and 3 complete. **2221 tests passing across the full repo** (32 template-engine + 69 automation-backend = 18 registry + 51 dispatch + the rest of the platform untouched). Full repo `typecheck` + `lint` clean. The platform now has production-grade restart safety, horizontal scaling, suspensions inside any container (choose / parallel / repeat / sequence), and queue-backed delays. Multi-action parallel branches via the new `sequence` primitive close the close-Jira-inside-parallel-branch use case. No half-finished functionality. Next: Phase 4 backend RPC router.*
