---
title: "v1 Polishing Plan"
description: "Phased refactor and polish work to tighten contracts, UX consistency, observability, and dead-code removal ahead of a v1.0 cut. Excludes net-new features."
---

# v1 Polishing Plan

> **Status**: Drafted 2026-05-26, no phases shipped yet.
> **Scope**: Refactoring + polish only. Net-new features (PagerDuty plugin, on-call rotations, audit logging, full public status pages) are explicitly out of scope and tracked separately for v1.1.
> **Shape**: 12 phases, each commit-sized and independently mergeable. Foundations first, then sweeps, then independent polish, then cleanup.

## Goals

1. Stabilise the contract surface (pagination, error shapes) so v1.0 doesn't lock in inconsistencies that are painful to change post-release.
2. Ship a unified empty / loading / error UX so every page in the product feels like it came from the same team.
3. Establish baseline observability (correlation IDs, structured logger context) before the user base grows.
4. Close out half-finished features that have foundations already (alert silencing tests, users/teams gaps) and delete empty shells (status-frontend/status-page-backend).
5. Tighten a handful of high-blast-radius backend paths (silent notification delivery, plugin-loader hook emissions).

## Non-Goals

- New plugin types or feature work (PagerDuty, on-call, audit log).
- Schema rewrites — only additive columns/tables where strictly needed (delivery tracking).
- Test backfill across the whole repo. Only the notification router + alert-silencing read-path get test coverage in this plan.

---

## Phase 0: Discovery Summary (Allowed APIs)

This phase is **already done** — the facts below are the platform truths every implementation phase must build on. Do NOT invent APIs beyond what's listed here; if you need something not listed, add it explicitly as a sub-task in the relevant phase, do not paper over.

### Contracts

- `RpcContext` is defined at [core/backend-api/src/rpc.ts:36-56](../../../../../core/backend-api/src/rpc.ts) with fields `{ pluginMetadata, db, logger, fetch, auth, user?, healthCheckRegistry, collectorRegistry, queuePluginRegistry, queueManager, cachePluginRegistry, cacheManager, emitHook }`.
- The shared oRPC factory is `export const os = baseOs.$context<RpcContext>()` at the same file (line 72). Plugins call `implement(contract).$context<RpcContext>().use(autoAuthMiddleware)`.
- `autoAuthMiddleware` lives at `core/backend-api/src/rpc.ts:101-233`. New middleware goes alongside it, not inside plugin routers.
- Pagination today is **three incompatible shapes**:
  - `core/notification-common/src/schemas.ts` → `PaginationInputSchema` with `limit (1-100, default 20) + offset (default 0)` plus domain extras.
  - `core/integration-common/src/rpc-contract.ts` → inline `{ page, pageSize }` (page-based).
  - `core/slo-common/src/rpc-contract.ts` → bare `limit` only.

### Logger

- Interface: [core/backend-api/src/types.ts:4-9](../../../../../core/backend-api/src/types.ts) — `info/warn/error/debug(message, ...args)`. Varargs only, no metadata object on the interface.
- Implementation: Winston, in [core/backend/src/logger.ts](../../../../../core/backend/src/logger.ts). Already supports `.child({...})` — used today in [core/backend/src/plugin-manager/plugin-loader.ts](../../../../../core/backend/src/plugin-manager/plugin-loader.ts) to bind `{ plugin: pluginId }`.

### UI primitives that already exist

- `EmptyState` (`{ title, description?, icon?, steps?: ReactNode[], actions?: ReactNode }`).
- `LoadingSpinner` (`{ size?: "sm"|"md"|"lg" }`, already respects `usePerformance`).
- `Alert` with variants `default|success|warning|error|info`.
- `Table` + sub-components — thin HTML wrapper, **no responsive props**.
- `useToast()` — in-house, returns `{ show, success, error, warning, info }`. No external library.
- `usePerformance()` — returns `{ isLowPower, isLoaded, manualLowPower, toggleManualLowPower }`. Used in ~23 files; rarely used by plugin pages.
- Storybook is mandatory for new components — 61 stories live in [core/ui/stories/](../../../../../core/ui/stories/).

### UI primitives that DO NOT exist (so we can build them once, sweep many)

- `ResponsiveTable`, `Skeleton`, `ListEmptyState`, `QueryErrorState`, `usePerformanceClass` helper.
- No `onMutate` (optimistic) usage anywhere in the codebase.

### Process

- Test runner: `bun test` (root for all, `cd <pkg> && bun test` for one package, `bun test src/foo.test.ts` for one file). `.e2e.ts` excluded.
- Typecheck: `bun run typecheck` from repo root. Run `bun run typecheck:references:generate` after touching any workspace `package.json` deps.
- Lint: `bun run lint`.
- Changesets: every package touched goes in the frontmatter as `patch` or `minor`. **Never `major` while in beta** — flag breaking changes in the body as `**BREAKING CHANGE**`.
- Docs: new architectural surfaces need a page under [docs/src/content/docs/](../../../../../docs/src/content/docs/) in the same PR. Required frontmatter: `title:` (+ `description:` recommended).

### Half-finished features — verified state

- **Status pages**: `core/status-frontend/` and `core/status-page-backend/` are empty directories with only `node_modules/` and `dist/`. No `package.json`, no source, zero importers, not in workspace config. **Verdict: delete.**
- **Alert silencing (`suppressNotifications`)**: fully wired. Schemas in [core/incident-backend/src/schema.ts](../../../../../core/incident-backend/src/schema.ts) and [core/maintenance-backend/src/schema.ts](../../../../../core/maintenance-backend/src/schema.ts), write path through `IncidentEditor` + `MaintenanceEditor`, read path through `hasActiveIncidentWithSuppression()` called by healthcheck queue executor and dependency notifications. **Verdict: add test coverage + doc the dispatch filter, no UI work needed.**
- **Users & Teams admin**: 95% complete. `UsersTab.tsx` (249 LOC), `RolesTab.tsx` (238), `TeamsTab.tsx` (591), `ApplicationsTab.tsx` (462) all implemented. **Verdict: close the small gaps (inline role assignment on user creation, document team access semantics), defer audit-trail and export to v1.1.**

---

## Phase 1 — Foundation: Canonical Pagination Contract

**Goal**: One Zod schema for paginated list inputs, exported from `@checkstack/common`. Everything downstream uses it.

**What to implement**:

1. In [core/common/src/](../../../../../core/common/src/) (or wherever the shared zod barrel lives — check via grep before creating) add:
   ```ts
   export const PaginationInput = z.object({
     limit: z.number().int().min(1).max(100).default(20),
     offset: z.number().int().min(0).default(0),
   });
   export type PaginationInput = z.infer<typeof PaginationInput>;

   export const PaginatedResult = <T extends z.ZodTypeAny>(item: T) =>
     z.object({
       items: z.array(item),
       total: z.number().int().min(0),
       limit: z.number().int(),
       offset: z.number().int(),
     });
   ```
2. Add a unit test asserting defaults, bounds, and type inference.
3. Do NOT migrate consumers in this phase — that's Phase 4.

**Files**:
- New schema in `core/common/src/pagination.ts` + export from the package barrel.
- New test `core/common/src/pagination.test.ts`.

**Docs**: New page `docs/src/content/docs/architecture/pagination.md` documenting the canonical shape, the page-based-vs-offset decision, and the `unreadOnly`-style domain-extension pattern (compose with `.extend({...})`, do not redefine).

**Changeset**: `@checkstack/common` → `minor` (new export).

**Verify**: `bun test core/common`; `bun run typecheck` clean.

**Anti-patterns**:
- Do NOT add `page`/`pageSize` aliases on the canonical schema — pick one shape and stick with it.
- Do NOT auto-cap pagination beyond `max(100)` without a separate phase + discussion.

---

## Phase 2 — Foundation: Shared UI Primitives

**Goal**: Ship the four missing UI building blocks the frontend sweeps depend on. This phase can be split into two PRs (2a: list/error/skeleton, 2b: responsive table + helpers) if the diff feels too large.

**What to implement** in [core/ui/src/components/](../../../../../core/ui/src/components/):

1. `ListEmptyState.tsx` — thin wrapper around existing `EmptyState` with a defaulted icon + tighter prop surface for list contexts: `{ resource: string; description?: string; actions?: ReactNode }`. Renders "No <resource> yet" headlines.
2. `QueryErrorState.tsx` — accepts `{ error: unknown; onRetry: () => void; resource?: string }`, uses existing `Alert` variant `error`, calls `extractErrorMessage(error)`, renders a retry button.
3. `Skeleton.tsx` — simple pulsing block respecting `usePerformance().isLowPower` (falls back to static `bg-muted`). Props: `{ className? }`.
4. `ResponsiveTable.tsx` — accepts the same children as the current `Table` but stacks rows as cards under the `sm` breakpoint. Internally renders two structures (table + cards) with `hidden`/`sm:hidden` toggling. Cell metadata via a small `column` prop on `TableHead`. If the prop-shape gets gnarly, fall back to a separate `<MobileCardList>` companion component for the mobile representation — document either choice.
5. `usePerformanceClass.ts` — hook that returns `(active: string, lowPowerFallback?: string) => string`. Use sites: `className={perfClass("transition-colors duration-200")}`.
6. `toastTemplates.ts` — tiny helpers:
   ```ts
   export const toastSuccess = (toast, action: string) => toast.success(action);
   export const toastError = (toast, action: string, error: unknown) =>
     toast.error(truncate(`${action}: ${extractErrorMessage(error)}`, 100));
   ```
   No DSL, no template strings hidden behind keys.

**Storybook**: Mandatory. One `.stories.tsx` per new component / hook. Match the existing pattern (Meta + autodocs).

**Tests**: `bun test` unit tests for `Skeleton`, `QueryErrorState`, and `usePerformanceClass`. `ResponsiveTable` gets a smoke test (renders both branches without crashing).

**Files**:
- `core/ui/src/components/ListEmptyState.tsx` + story + test
- `core/ui/src/components/QueryErrorState.tsx` + story + test
- `core/ui/src/components/Skeleton.tsx` + story + test
- `core/ui/src/components/ResponsiveTable.tsx` + story + smoke test
- `core/ui/src/hooks/usePerformanceClass.ts` + story (or doc snippet) + test
- `core/ui/src/utils/toastTemplates.ts` + test
- Update [core/ui/src/index.ts](../../../../../core/ui/src/index.ts) barrel.

**Docs**: Update `docs/src/content/docs/frontend/` with a short page (or extend existing UI primitives page) listing the new primitives.

**Changeset**: `@checkstack/ui` → `minor`.

**Verify**: `bun test core/ui`; Storybook build clean (`bun --filter=@checkstack/ui run build-storybook` or equivalent — confirm command in `core/ui/package.json`).

**Anti-patterns**:
- Do NOT replace the existing `Table` — `ResponsiveTable` is additive. Callers opt in.
- Do NOT introduce a toast factory function pattern (`createToast`) — keep the templates as plain helpers callers compose.
- Do NOT add `dangerouslySetInnerHTML` or markdown rendering inside `QueryErrorState`. Plain text only.

---

## Phase 3 — Foundation: Correlation IDs + Structured Logger Context

**Goal**: Every log line through `RpcContext.logger` is automatically annotated with `{ correlationId, pluginId, userId? }`. Cross-procedure tracing becomes possible.

**What to implement**:

1. Extend the `Logger` interface at [core/backend-api/src/types.ts](../../../../../core/backend-api/src/types.ts) with a second optional metadata argument:
   ```ts
   info(message: string, meta?: Record<string, unknown>): void;
   ```
   Keep varargs compatibility for callers who pass an error object — handle both shapes in the Winston adapter.
2. In the Winston implementation, attach a base child logger per request via middleware (see step 3). Maintain the existing `.child({ plugin })` call site behaviour.
3. New middleware `correlationMiddleware` next to `autoAuthMiddleware` in [core/backend-api/src/rpc.ts](../../../../../core/backend-api/src/rpc.ts):
   - Pulls `x-correlation-id` from request headers; generates a UUIDv4 if absent.
   - Returns a new `RpcContext` with `logger = ctx.logger.child({ correlationId, pluginId: ctx.pluginMetadata.pluginId, userId: ctx.user?.id })`.
   - Echoes the `x-correlation-id` back on the response.
4. Update every plugin router that calls `implement(contract).$context<RpcContext>().use(autoAuthMiddleware)` to also `.use(correlationMiddleware)`. Order matters — correlation runs first.

**Files**:
- `core/backend-api/src/types.ts` — extend `Logger`.
- `core/backend-api/src/rpc.ts` — new middleware + export.
- `core/backend/src/logger.ts` — Winston adapter update if needed (likely already supports object metadata).
- All `plugins/*/backend/src/router.ts` and `core/*/src/router.ts` — add middleware call. Sweep with grep.

**Docs**: New page `docs/src/content/docs/backend/observability.md` documenting:
- The correlation ID contract (header name, generation, propagation).
- The metadata fields auto-injected per request.
- How to do `logger.child({...})` for a tighter scope inside a handler.

**Changeset**: `@checkstack/backend-api`, `@checkstack/backend` → `minor`. Note in body: this is a behavioural change for downstream plugin authors (new middleware required), but the old code keeps working at runtime — the logger metadata is just empty without it. Flag as `**BREAKING CHANGE**` if any plugin's router test snapshots include log output.

**Verify**:
- `bun run typecheck` clean.
- Add one integration-style test that asserts a correlation ID survives a procedure call.
- Smoke: hit any endpoint with `curl -H 'x-correlation-id: test-abc'` and grep server logs for `correlationId=test-abc`.

**Anti-patterns**:
- Do NOT generate correlation IDs inside handlers — middleware is the only generation site.
- Do NOT log secrets in the metadata object. The new shape makes structured logging easier, but `meta` flows to the log destination directly.

---

## Phase 4 — Sweep: Pagination Across All `*-common` Contracts

**Goal**: Every paginated endpoint in the codebase uses `PaginationInput` from `@checkstack/common`. Deprecate the page-based shape in `integration-common`.

**What to implement**:

1. Grep all `*-common/src/rpc-contract.ts` files for `limit`, `offset`, `pageSize`, `page` schema fields.
2. For each procedure:
   - Replace the inline pagination fields with `PaginationInput.extend({ ...domain-extras })`.
   - If the procedure currently uses `page`/`pageSize`, migrate the handler to `offset` arithmetic (`offset = (page - 1) * pageSize`) but keep the client API on the new shape — no transitional aliasing.
3. Frontend call sites: sweep `useQuery({ ... input: { page, pageSize } })` patterns to `{ limit, offset }`.

**Known consumers from Phase 0 discovery**:
- `notification-common` — already close, drop `unreadOnly` into an `.extend({...})`.
- `integration-common` — `getEventLog` page-based, migrate to offset.
- `slo-common` — bare `limit`, extend to full shape.
- Likely others — verify with `grep -rn "pageSize\|page: z" core/ plugins/`.

**Files**: Every `*-common` package + its matching frontend usage. Run `bun run typecheck:references:generate` afterwards.

**Docs**: Update the Phase 1 pagination page with a "Migrated procedures" appendix list.

**Changeset**: Patch on every `*-common` and `*-frontend` touched. Body: `**BREAKING CHANGE** — pagination input shape changed from \`{ page, pageSize }\` to \`{ limit, offset }\` on \`getEventLog\` and other listed procedures. External callers must update their input.`

**Verify**: `bun run typecheck`, `bun run lint`, `bun test` all clean.

**Anti-patterns**:
- Do NOT preserve a back-compat alias layer (no `pageSize: z.number().optional()` fallback that translates to `limit`). The whole point of doing this pre-v1 is that we don't owe back-compat yet.
- Do NOT silently change response shapes in this phase — Paginated**Result** rollout is optional and can be a follow-up.

---

## Phase 5 — Sweep: Empty / Loading / Error States on Key Pages

**Goal**: Every list page in the product uses `ListEmptyState`, `QueryErrorState`, and `Skeleton` (or `LoadingSpinner` where a spinner is the right fit). No more bare `<TableCell colSpan>` empty markers.

**Target pages** (verified locations from Phase 0):
- `core/healthcheck-frontend/src/pages/HealthCheckConfigPage.tsx` + the inner `HealthCheckList`.
- `core/notification-frontend/src/pages/NotificationsPage.tsx`.
- `core/slo-frontend/src/pages/SloConfigPage.tsx` (already partially OK — bring `QueryErrorState` in).
- `core/slo-frontend/src/pages/SloDetailPage.tsx` (no empty/error today).
- Plus any other obvious list pages — sweep via `git grep -l "useQuery\|useInfiniteQuery" core/*-frontend/src/pages plugins/*/frontend/src/pages`.

**What to implement per page**:
1. Wrap the data-driven section in a `query.isLoading ? <Skeleton or spinner> : query.isError ? <QueryErrorState onRetry={query.refetch}/> : items.length === 0 ? <ListEmptyState resource="..."/> : <list>`.
2. Skeletons should mimic the final layout (a few skeleton rows that match the table shape), not a generic block. Reuse a single `<TableSkeletonRows count={3} />` snippet rather than hand-rolled markup per page.
3. Empty-state copy: use product nouns ("No health checks yet", "No notifications yet"). No CTAs unless we already have one.

**Files**: As listed above. No new packages.

**Docs**: Short addition to `docs/src/content/docs/frontend/` covering the standard pattern. Include the exact `query.isLoading / isError / data.length` ternary snippet so future authors copy it.

**Changeset**: `patch` on each frontend package touched.

**Verify**: Boot the dev server, manually exercise: empty DB on the healthchecks page (delete all → see new empty state), throw a transient error (kill backend → see QueryErrorState + retry button), normal load (see skeletons → list).

**Anti-patterns**:
- Do NOT change page layouts beyond the empty/loading/error swap — scope creep here is the #1 risk.
- Do NOT introduce per-page custom skeletons. One shared snippet.

---

## Phase 6 — Sweep: Mobile-Responsive Tables

**Goal**: Key list pages reflow gracefully under the `sm` breakpoint instead of horizontal-scrolling.

**Targets** (verified):
- `HealthCheckList` inside `core/healthcheck-frontend/src/components/`.
- `core/slo-frontend/src/pages/SloConfigPage.tsx` table.
- One or two notification list tables — pick the highest-traffic.

**What to implement**: Replace `<Table>` usage with `<ResponsiveTable>` from Phase 2. Each cell that should hide under `sm` gets a `priority="low"` (or similar — final API decided in Phase 2) prop. Mobile cards stack: title + status + actions; secondary fields drop or move to tap-to-expand if available.

**Files**: ~3 page/component files. No new packages.

**Docs**: Mention `ResponsiveTable` usage in the same frontend doc page as Phase 5.

**Changeset**: `patch` on each frontend package touched.

**Verify**: Resize a browser window to 375px width on each touched page. No horizontal scroll on the main content. Tap targets ≥44px.

**Anti-patterns**:
- Do NOT add CSS overrides per page; if `ResponsiveTable` doesn't handle a case, fix it in `@checkstack/ui` and reuse.

---

## Phase 7 — Sweep: `usePerformanceClass` + Toast Templates Across Plugin Pages

**Goal**: Plugin pages stop ignoring `isLowPower`, and toast voice stops drifting per author.

**What to implement**:

1. `usePerformanceClass` sweep — grep for `transition-`, `animate-`, `hover:scale-`, `backdrop-blur` in `plugins/*/frontend/src/` and `core/*-frontend/src/`. For each occurrence, wrap with `perfClass()` so the effect drops under low power. Skip purely structural utilities (`hover:bg-accent` colour changes are fine to keep — focus on motion/blur).
2. Toast template sweep — grep for `toast.success(`, `toast.error(`. Replace direct calls with `toastSuccess`/`toastError` helpers from Phase 2 where the message includes an error or a multi-clause sentence. Leave simple one-liners alone.

**Files**: Touch many — keep diff minimal per file and avoid drive-by changes.

**Docs**: Update the existing `performance.md` (project root `.agent/rules/performance.md` is a developer-facing rule; user-facing doc is under `docs/src/content/docs/frontend/`) with a one-paragraph "use `usePerformanceClass`" pattern.

**Changeset**: `patch` per affected package.

**Verify**: Manual — toggle `manualLowPower` in the UI and check a couple of swept pages no longer animate. Toasts after a failed mutation render a truncated, action-prefixed message.

**Anti-patterns**:
- Do NOT alter component structure to fit the helper. If a transition is hard to wrap, leave it and note in the PR description.

---

## Phase 8 — Backend: Per-Channel Notification Delivery Tracking

**Goal**: When an external delivery (Discord/Slack/etc.) fails, the failure is surfaced to admins, not just logged.

**What to implement**:

1. New table `notification_delivery_attempts` in [core/notification-backend/src/schema.ts](../../../../../core/notification-backend/src/schema.ts):
   - `id`, `notificationId` (FK), `strategyQualifiedId` (text), `attemptedAt` (timestamp), `status` (enum: `success|failure`), `errorMessage` (text, nullable), `durationMs` (int).
2. Migration via the project's Drizzle workflow (verify command in `core/notification-backend/package.json` scripts — typically `bun run db:migrate:generate`).
3. Update the dispatch loop at [core/notification-backend/src/router.ts](../../../../../core/notification-backend/src/router.ts) (~line 285 per discovery) — wrap each strategy `.send()` in try/catch already exists; persist the attempt row on both branches.
4. New read procedure `getDeliveryAttempts` on the notification contract (input: `PaginationInput.extend({ notificationId? })`).
5. Tiny admin UI surface: render the last N delivery attempts on the notification detail view, or behind an admin-only inspector. Keep this minimal — the v1 goal is *visibility*, not a full delivery dashboard.

**Files**:
- Schema + migration.
- `core/notification-common/src/rpc-contract.ts` — new procedure shape.
- `core/notification-backend/src/router.ts` — write attempts, expose read procedure.
- `core/notification-frontend/...` — small UI surface.

**Docs**: Add `docs/src/content/docs/backend/notifications.md` section on delivery tracking, or a new `notification-delivery.md` page if a notifications doc page doesn't exist.

**Changeset**: `@checkstack/notification-backend` + `@checkstack/notification-common` + `@checkstack/notification-frontend` → `minor`.

**Verify**: Configure a broken external channel (bogus webhook URL), trigger a notification, confirm the failure row exists in the table and renders in the UI.

**Anti-patterns**:
- Do NOT block the dispatch loop on attempt persistence — log + continue if the insert itself errors (don't replace one silent failure with a new one).
- Do NOT introduce a retry mechanism in this phase. Visibility first, retry is a v1.1 conversation.

---

## Phase 9 — Backend: Plugin Loader Hook Emission + Notification Router Tests

Two small backend items grouped because both are short and same area.

### 9a — Hook emission catches in plugin loader

The discovery found only two genuinely silent catches in [core/backend/src/plugin-manager/plugin-loader.ts](../../../../../core/backend/src/plugin-manager/plugin-loader.ts):
- Lines ~496–505: `pluginInitialized` hook emit.
- Lines ~550–561: `accessRulesRegistered` hook emit.

Both currently log the error and continue. **Decision needed in the PR**: should a hook failure halt boot? Recommendation — halt for `pluginInitialized` (early enough to be safe), continue + escalate for `accessRulesRegistered` (boot-blocking it is risky if a single misbehaving plugin can DOS the platform). Document the chosen behaviour inline + in the plugin-system doc.

### 9b — Notification router test coverage

Create `core/notification-backend/src/router.test.ts` following the template from [core/healthcheck-backend/src/router.test.ts](../../../../../core/healthcheck-backend/src/router.test.ts):
- Use `createMockRpcContext` + `call(router.method, input, { context })`.
- Cover: `dispatch` with subscriptions, group provisioning, legacy migration, external delivery with strategy fallback, delivery attempt persistence (after Phase 8).

**Files**: Two: plugin-loader source + new router test file.

**Docs**: Update the plugin-system design doc with the chosen hook-failure policy.

**Changeset**: `@checkstack/backend` → `patch` (behavioural change for one hook).

**Verify**: `bun test core/notification-backend`; `bun test core/backend`.

**Anti-patterns**:
- Do NOT add a generic "halt on any hook failure" knob — pick the right behaviour per hook.

---

## Phase 10 — Backend: Drizzle ↔ Zod Drift CI Check

**Goal**: Catch column/schema drift between `*-backend/schema.ts` (Drizzle) and `*-common/schemas.ts` (Zod) at PR time.

**What to implement**:

1. New script `scripts/check-schema-drift.ts` modelled after [scripts/generate-tsconfig-references.ts](../../../../../scripts/generate-tsconfig-references.ts) (the existing drift-style check).
2. Strategy: introspect each Drizzle table (column name + type) and compare against the matching Zod object (key + inferred zod kind). Mismatches → non-zero exit with a clear diff.
3. Add a `lint:schema-drift` npm script in root `package.json` and add it to the `pr-checks.yml` workflow as a new job (or extend the existing `typecheck` job).

**Files**:
- `scripts/check-schema-drift.ts`.
- Root `package.json` script.
- `.github/workflows/pr-checks.yml` (new job).

**Docs**: Short addition to `docs/src/content/docs/tooling/` describing the check, what it catches, what it doesn't (e.g., it won't catch semantic drift — column renamed in Drizzle, alias in Zod).

**Changeset**: None — tooling/CI change.

**Verify**: Intentionally drift a Zod schema in a local branch, confirm the script fails. Revert, confirm it passes.

**Anti-patterns**:
- Do NOT rewrite Zod schemas to use `drizzle-zod` codegen as part of this phase — that's a bigger architectural conversation. Just enforce manual alignment.
- Do NOT skip drift errors with a permissive enum mapping. If a column genuinely needs to differ, document the exception in the script.

---

## Phase 11 — Frontend: Optimistic UI Pattern + Apply to Two Mutations

**Goal**: Establish the canonical optimistic-update pattern (zero examples exist today) and apply it where the perceived latency win is highest.

**What to implement**:

1. Write the canonical pattern in a short doc: `docs/src/content/docs/frontend/optimistic-updates.md`. Include:
   - When NOT to use it (creates with server-generated IDs, anything irreversible).
   - The `onMutate` / context / `onError` rollback / `onSettled` invalidate cycle.
   - A copy-ready snippet using the project's React Query setup.
2. Apply to two mutations:
   - **`markAsRead`** on `NotificationsPage` — high frequency, clear rollback.
   - **`pauseConfiguration` / `resumeConfiguration`** on `HealthCheckConfigPage` — toggle, low risk.

**Files**: ~2 frontend files + new doc page.

**Changeset**: `patch` on the touched frontend packages.

**Verify**: Throttle the network in dev tools, click "mark as read" — UI flips instantly. Force a backend error, UI flips back.

**Anti-patterns**:
- Do NOT replace `refetch()` patterns project-wide. This phase is two targeted applications; broader rollout is a v1.1 task.

---

## Phase 12 — Cleanup: Half-Finished Features

Three small bundled items. All three can ship in one PR.

### 12a — Delete `core/status-frontend/` and `core/status-page-backend/`

Both directories contain only `node_modules` (and `dist/` in `status-frontend`). No source, no `package.json`, not referenced anywhere, not in workspace config. **Delete them.** Run `bun run typecheck:references:generate` afterwards.

### 12b — Alert silencing: tests + docs only

`suppressNotifications` is fully wired (write paths + read paths verified). What's missing:
- Unit tests for `hasActiveIncidentWithSuppression()` in [core/incident-backend/src/service.ts](../../../../../core/incident-backend/src/service.ts).
- A short doc page `docs/src/content/docs/architecture/alert-silencing.md` describing the contract: incidents/maintenances with `suppressNotifications=true` filter notification dispatch via the read path. Document who calls it (healthcheck queue executor, dependency notifications) and what dispatch paths are NOT covered (so users aren't surprised).

### 12c — Users & Teams admin: close small gaps

Discovery showed the UI is ~95% complete. Remaining gaps for v1:
- Inline role assignment during user creation (currently a separate post-create step) in `UsersTab.tsx`.
- A docs page `docs/src/content/docs/architecture/users-and-teams.md` covering the model: roles, teams, resource-team access, S2S endpoints (`checkResourceTeamAccess`, `getAccessibleResourceIds`).
- Defer audit logging, user/team CSV export, and team-scoped resource-management UI to v1.1 — call this out explicitly in the doc.

**Files**: Deletions + a handful of small edits + 2 new doc pages + tests.

**Changeset**: Mixed.
- `@checkstack/incident-backend` → `patch` (tests only).
- `@checkstack/auth-frontend` → `patch` (UX tweak).
- Workspace cleanup → no changeset (tooling).

**Verify**: `bun run typecheck`, `bun test core/incident-backend`, manual click-through of the user creation flow.

**Anti-patterns**:
- Do NOT add audit logging or CSV export here. They're features, not polish. Defer.
- Do NOT touch the schema during silencing test work. It's already correct.

---

## Phase 13 — Verification

After phases 1–12 have all merged, do a final pass:

1. `bun run typecheck && bun run lint && bun test` from repo root — all clean.
2. `bun run typecheck:references:check` — generator artefacts up to date.
3. Boot the app fresh, click through each touched page:
   - Empty state, loading state, error state for HealthCheckConfigPage, NotificationsPage, SloConfigPage, SloDetailPage.
   - Mobile viewport (375px wide) for HealthCheckList + SloConfigPage tables.
   - Trigger a notification with a broken external channel — see the delivery attempt failure in the inspector.
   - Confirm `x-correlation-id` echoes on response headers and appears in logs.
4. Spot-check Storybook for the new primitives.
5. Run an `ultrareview` (or peer-review) pass on the bundled v1 changes if not already done per-phase.
6. Final docs sweep: every new page added under `docs/src/content/docs/plans/` and `docs/src/content/docs/architecture/` is reachable from the Starlight sidebar.

---

## Phase ordering rationale

- **1–3 are parallel-mergeable foundations.** They define contracts/primitives the sweeps depend on. Land them first so sweeps don't churn.
- **4–7 are sweeps that consume foundations.** They land after their respective foundation; within group, they're independent.
- **8–11 are independent polish.** Each is its own area, can ship any time after foundations.
- **12 is bundled cleanup.** Last because it's the lowest risk and easiest to defer if v1 timeline tightens.
- **13 is verification.** Always last.

A reasonable target cadence: foundation phases in week 1, sweeps in weeks 2–3, independent polish in week 3–4, cleanup + verification in the final week. That puts a v1.0 cut roughly 4–5 weeks out if all phases run sequentially in a single workstream; parallelising shrinks it.
