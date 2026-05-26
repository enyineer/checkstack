# @checkstack/healthcheck-frontend

## 0.19.5

### Patch Changes

- f23f3c9: Retrofit the highest-traffic configuration list tables
  (`HealthCheckList`, `SloConfigPage`, and the integration
  `DeliveryLogsPage`) onto the `ResponsiveTable` + `MobileCardList`
  primitives from `@checkstack/ui`. On `sm` and up each page still
  renders the unchanged 5- to 7-column table; below that breakpoint a
  sibling stacked-card layout surfaces the same data with the resource
  name + status badge at the top, secondary columns in a muted line, and
  the existing action buttons in a right-aligned footer. The
  `HealthCheckListSkeleton` placeholder mirrors both branches so the page
  no longer jumps when data resolves. No business logic, column order,
  or query inputs changed.
- f23f3c9: Establish the canonical optimistic-UI pattern for oRPC mutations
  (`onMutate` snapshot / patch, `onError` rollback, `onSettled`
  invalidate) and apply it to the two highest-frequency toggles where
  perceived latency was most visible:

  - `markAsRead` on the Notifications page — clicking the check on a
    notification card now flips the read state immediately instead of
    waiting for the round-trip.
  - `pauseConfiguration` / `resumeConfiguration` on the Health Check
    Config page — pause/resume now flip the row's badge instantly,
    rolling back on server error.

  The wrapper type for `useMutation` on each plugin client gained an
  optional `TContext` generic so optimistic sites can return a snapshot
  from `onMutate` and consume it in `onError` without `unknown` casts.
  The runtime behaviour and the auto-invalidation on success are
  unchanged; the change is additive on the type surface only.

  Full pattern and "when NOT to use it" guidance live in
  `docs/frontend/optimistic-updates.md`.

- f23f3c9: Gate decorative motion and blur effects behind
  `usePerformance().isLowPower` on a focused set of high-traffic plugin
  pages (Dashboard, Dependency map, System node, Notification bell,
  Announcement banner / cards, Anomaly field overrides editor, SLO
  attribution chart, Catalog droppable group). Hover scales, backdrop
  blurs, `animate-pulse`/`animate-ping` accents, and entry transitions
  now drop to static states on low-power devices; functional UX
  transitions (Drawer/Dialog open-close, colour transitions) are left
  alone.

  Standardise the post-mutation error-toast voice on plugin pages by
  migrating multi-clause `toast.error(extractErrorMessage(error, "Failed
to X"))` call sites onto the `toastError(toast, "Failed to X", error)`
  helper from `@checkstack/ui`. The helper applies the canonical
  `"action: message"` prefix and 100-character truncation in one place,
  and the now-orphaned `extractErrorMessage` imports are dropped from
  the affected files. No business logic or component APIs changed.

- f23f3c9: Standardise the empty / loading / error story on key list pages using
  the shared `ListEmptyState`, `QueryErrorState`, and `Skeleton`
  primitives from `@checkstack/ui`. Each affected page now branches
  through the same `isLoading -> isError -> empty -> data` ladder, so
  failed queries surface a retry-able inline error instead of silently
  rendering an empty table, and loading states match the final layout
  rather than flashing a generic spinner. No layout, business logic, or
  query input shapes changed.
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/auth-frontend@0.6.5
  - @checkstack/frontend-api@0.5.2
  - @checkstack/dashboard-frontend@0.7.5
  - @checkstack/gitops-frontend@0.4.5
  - @checkstack/ui@1.10.0
  - @checkstack/anomaly-common@1.2.2
  - @checkstack/catalog-common@2.2.2
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/satellite-common@0.5.2
  - @checkstack/tips-frontend@0.2.5
  - @checkstack/signal-frontend@0.1.4

## 0.19.4

### Patch Changes

- a06b899: Fix stale healthcheck editor on reopen after save.

  Deleting a collector from a healthcheck, saving, then reopening the
  editor used to show the deleted collector reappear — only a full page
  refresh cleared it. The editor's `getConfiguration` query was being
  served stale-while-revalidate on remount, and `useInitOnceForKey`
  fired with that stale value before the background refetch landed.

  Setting `gcTime: 0` on the loader query drops the cached entry on
  unmount, so the next mount has nothing stale to serve and the form
  seeds from fresh data.

  The wider rule has been written up at
  `docs/src/content/docs/frontend/query-invalidation.md` (Pillar 3) and
  a pointer added to `.agent/rules/code-style-guide.md`. tl;dr:
  within-plugin mutations are auto-invalidated by the oRPC client (no
  manual `refetch()` needed); cross-plugin mutations must invalidate
  explicitly; one-shot editor forms must use `gcTime: 0` on their loader.

- a06b899: Overhaul shell + inline-script health checks with real shell semantics, real ESM execution, and upstream Node/Bun IntelliSense.

  **BREAKING CHANGES**

  - **Shell collector** — the `Execute Script` collector now takes a single `script` string instead of `{ command, args }`. Existing configs are auto-migrated to v2: `command` + `args` are joined with POSIX single-quote escaping into the new `script` field, so behaviour is preserved. Custom UIs that hard-coded `command`/`args` field names need to switch to `script`.
  - **Inline collector** — scripts are now executed as real ES modules in a Bun subprocess (was: `new Function()` inside a Web Worker). The legacy `return X;` style still works (it's auto-wrapped in an async IIFE), but mixed scripts that `import` _and_ `return` at the top level need to use `export default` for their result.

  **FIXES**

  - Shell scripts containing pipes, redirects, `awk`, command substitution, conditionals etc. no longer fail with `ENOENT`. The collector now runs through `sh -c <script>` instead of passing the full expression as `Bun.spawn`'s argv[0]. This was the original `awk … failed with ENOENT` regression.
  - Inline scripts can now `import { loadavg } from "node:os"` (and any other `node:*` or `bun` import). They could not before, because the executor wrapped user code inside `new Function(...)` and ran it in a Web Worker that had no Node module access; the wrapper also made top-level `import` syntactically invalid (`Unexpected token '{'`).
  - Healthcheck editor fields no longer reset while you're editing. The page was re-running its form-state init `useEffect` on every refetch of the configuration query — and that query is invalidated on every realtime `HEALTH_CHECK_RUN_COMPLETED` signal across the platform, so in-progress edits got wiped within seconds. Replaced the naive `useEffect([existingConfig])` with a new `useInitOnceForKey` hook from `@checkstack/ui` that initialises the form only on first load per healthcheck id and ignores background refetches. The hook's decision logic is a pure function (`shouldInitForKey`) and is unit-tested in `useInitOnceForKey.test.ts`.
  - Switching between healthcheck collectors no longer mis-applies the previous collector's tokenizer / language service to the new editor. `MultiTypeEditorField` was reusing the same React instance across collector switches (same `key="script"` in both `DynamicForm` renders) and `selectedType` was initialised from `useState` only once on first mount. After a shell→typescript switch the new collector's TS content rendered through the shell branch (no TS highlighting, no IntelliSense); the reverse direction tokenised shell content through TS and surfaced nonsense errors like `2304 "Cannot find name 'and'"` on shell comments. Now a `useEffect` re-derives `selectedType` whenever `editorTypes` changes to a set that doesn't contain the current selection.
  - Monaco workers are now bundled locally via Vite `?worker` imports and wired up through `MonacoEnvironment.getWorker` in a new `monacoWorkers.ts` module. The default `@monaco-editor/loader` CDN path silently failed CORS on worker scripts in some browsers, leaving Monaco's TS service with only the generic `editorWorkerService` — which is enough for tokenizer-only languages like shell but breaks TypeScript's semantic features entirely. Same module configures the TS service singleton (compiler options, eager-model-sync, diagnostics-options-ignore-1108) at module load instead of inside per-editor `onMount`, so the service starts pre-configured regardless of which language opens first. Migrated from the deprecated `monaco.languages.typescript.*` path to `monaco.typescript.*` (the old path is marked `{ deprecated: true }` in monaco-editor 0.55).
  - `defineIntegration` / `defineHealthCheck` callback parameters are now typed against the schema. Previously the virtual module declared them as `(ctx: unknown) => …`, so writing `defineIntegration(async (context) => { console.log(context.event.eventId) })` produced `'context' is of type 'unknown'. (18046)`. The result type and the shared `IntegrationScriptContext` / `HealthCheckScriptContext` interfaces are now generated together in `scriptContext.ts`, so both the function-arg form and the ambient `declare const context` reference the same schema-typed shape.
  - The shell starter template no longer uses Linux-only `/proc/loadavg` (which fails on macOS satellites with `awk: can't open file /proc/loadavg`). It now reads the 1-minute load average via `uptime` and parses both the Linux (`load average: 0.00, 0.01, 0.05`) and macOS (`load averages: 0.45 0.55 0.65`) output formats with a portable `sed`/`awk`/`tr` pipeline.
  - Starter-template seeding is now self-healing. `DynamicForm`'s schema-defaults `useEffect` fires AFTER child seed effects in React's child-before-parent order, so the previous one-shot seed got clobbered back to `""` by the defaults call on first mount and never re-fired. Replaced the `[]`-deps effect with a two-effect pattern: an observer that latches `hasSeededRef = true` the first time `value` is observed non-empty, and a seed effect that keeps re-installing the starter while the latch is open. Once the seed sticks the latch closes; subsequent edits and realtime refetches don't re-trigger.

  **NEW**

  - The Monaco editor for inline scripts now mounts the real upstream `@types/node` + `bun-types` declarations as a virtual filesystem (lazy-loaded as its own JS chunk), so IntelliSense covers the full Node/Bun stdlib, the `Bun` global, `process.env`, `Buffer`, etc. DOM types are deliberately excluded so suggestions stay focused on the backend surface. `context.config` is typed from the collector's own JSON Schema.
  - New `healthcheckScriptContext` / `integrationScriptContext` helpers (exported from `@checkstack/ui`) build a complete editor bundle in one call: TS declarations (`context.config` / `context.event.payload` + the virtual `@checkstack/healthcheck` / `@checkstack/integration` result-type modules), starter templates per language, and the shell env-var list (with platform-injected `EVENT_ID` / `DELIVERY_ID` / `PAYLOAD_*` for integrations). Both call sites — `CollectorSection.tsx` and `CreateSubscriptionDialog.tsx` — were rewired to use them, fixing a long-standing wiring gap where IntelliSense for injected values silently never reached the editor.
  - Inline scripts can now `import { defineHealthCheck } from "@checkstack/healthcheck"` (or `defineIntegration` for integrations) for a typed return-shape assertion. The editor catches `{ success: "yes" }` as a type error against `HealthCheckScriptResult`. The runtime is just an identity function — the collector rewrites the import to a sibling helper file in the temp dir before executing.
  - Shell editors now autocomplete env-vars after `$` and `${`. The completion list is supplied by `healthcheckScriptContext` (safe-vars whitelist) and `integrationScriptContext` (whitelist + `EVENT_ID` etc. + `PAYLOAD_*` flattened from the event's payload schema). The matcher is pure and unit-tested in `shellEnvVarMatcher.test.ts` so regex regressions are caught locally.
  - Empty editor fields are now seeded with a working starter template per language (inline TS uses `defineHealthCheck`, inline shell does the `awk` load-average check, integration TS shows `defineIntegration` with `context.event`, integration shell lists the `$EVENT_ID` / `$PAYLOAD_*` env vars). Users see a runnable example instead of a blank canvas; once they edit, we leave their content alone.
  - Hardened concurrency + cleanup model documented and tested: each invocation gets its own `mkdtemp` directory + UUID result marker; the `finally` block clears the timeout handle, kills any surviving subprocess (idempotent), and removes the temp directory on success, throw, _and_ timeout. New `concurrency.test.ts` proves 20 parallel inline scripts don't cross wires and that the temp-dir count returns to baseline after throws and timeouts.

  **TESTING**

  Tight unit tests added so changes to the editor surface don't need smoke testing:

  - `scriptContext.test.ts` — 18 tests covering the generated type declarations (including explicit regression guards for `defineIntegration` / `defineHealthCheck` callback params being typed against the shared context interface rather than `unknown`), starter templates (including a guard that the shell starter doesn't depend on Linux-only `/proc/loadavg`), shell env-vars for both healthcheck + integration flavours, plus the schema-flattening utility.
  - `shellEnvVarMatcher.test.ts` — 12 tests covering the bare `$` / braced `${` / partial-name / case-insensitive matching logic that powers Monaco's shell completion.
  - `inline-script-normaliser.test.ts` — 13 tests covering the legacy `return X;` → IIFE wrap path, the ESM-passthrough path, and the `@checkstack/healthcheck` import rewriter.
  - `inline-script-collector.test.ts` — 18 tests including ones that actually execute a script importing `defineHealthCheck` (named-import form) AND using the global `defineHealthCheck` (no import) to prove both code paths resolve at runtime.
  - `concurrency.test.ts` — 4 tests proving 20 parallel runs don't collide and that the temp-dir count returns to baseline after success, throw, and timeout.
  - `useInitOnceForKey.test.ts` — 10 tests proving the healthcheck-editor form state isn't reset when react-query refetches in the background (the original "fields reset while I'm typing" regression).
  - `starterTemplateSelector.test.ts` — 7 tests for the pure decision function powering empty-field seeding.
  - `security.test.ts` — added an integration test that actually executes the portable load-average pipeline through `Bun.spawn` on the current OS, catching `/proc/loadavg`-style regressions at CI time on macOS runners.

  **SECURITY**

  - Same env-var whitelist as before (`PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `HOSTNAME`, `SHELL`). Backend secrets in the satellite process's environment remain invisible to user scripts.

  See `docs/src/content/docs/backend/script-healthchecks.md` for the full user-facing guide.

- Updated dependencies [a06b899]
  - @checkstack/ui@1.9.0
  - @checkstack/anomaly-common@1.2.1
  - @checkstack/catalog-common@2.2.1
  - @checkstack/dashboard-frontend@0.7.4
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/auth-frontend@0.6.4
  - @checkstack/gitops-frontend@0.4.4
  - @checkstack/tips-frontend@0.2.4
  - @checkstack/satellite-common@0.5.1

## 0.19.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/auth-frontend@0.6.3
  - @checkstack/dashboard-frontend@0.7.3
  - @checkstack/gitops-frontend@0.4.3
  - @checkstack/tips-frontend@0.2.3

## 0.19.2

### Patch Changes

- b627562: Bump direct and transitive dependencies to clear MEDIUM-severity advisories
  that Trivy now surfaces alongside CRITICAL/HIGH.

  Direct version bumps in package.json:

  - `@checkstack/catalog-backend`, `@checkstack/gitops-backend`,
    `@checkstack/healthcheck-frontend`: `uuid` `^13.0.0` → `^14.0.0`
    (GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6). Also
    dropped the now-redundant `@types/uuid` devDependency — uuid 14 ships
    its own types and the npm `@types/uuid` package is a stub.
  - `@checkstack/gitops-backend`: `yaml` `^2.7.0` → `^2.8.3`
    (GHSA-48c2-rrv3-qjmp, stack overflow on deeply nested collections).
  - `@checkstack/dev-server`: `vite` `^5.4.0` → `^8.0.12`
    (GHSA-4w7w-66w2-5vf9, path traversal in optimized-deps `.map` handling)
    and `@vitejs/plugin-react` `^4.3.4` → `^6.0.1` to stay inside the new
    vite peer range.

  Root `overrides` / `resolutions` to bypass transitive pins that block the
  walk:

  - `dompurify` `^3.4.3` — `monaco-editor@0.55.1` pins `dompurify@3.2.7`
    exactly, so the only way to pick up the eight DOMPurify XSS / prototype
    pollution advisories (GHSA-v2wj-7wpq-c8vv et al.) is an override.
    Affects `@checkstack/ui`, which is the only consumer of monaco.
  - `uuid` `^14.0.0` — also forces `bullmq`'s nested `uuid@11.1.0`
    (vulnerable per GHSA-w5hq-g745-h8pq) to the patched line. Affects
    `@checkstack/queue-bullmq-backend`.
  - `yaml` `^2.9.0` — covers transitive resolutions that would otherwise
    pin pre-2.8.3 yaml.

  The CI image scan (`.github/workflows/pr-checks.yml`) and the local
  `bun run audit:*` helper now include `MEDIUM` alongside `CRITICAL,HIGH`,
  so future MEDIUM regressions fail the pipeline. The production Dockerfile
  also strips vendored `test/`, `tests/`, `__tests__/`, `benchmark/`,
  `benchmarks/`, `example/` and `examples/` folders from `node_modules`
  before the runtime stage — those tarball artefacts ship their own
  nested `package.json` (`benchmark`, `tedious-benchmarks`, etc.) which
  Trivy was scanning as if they were real packages.

- Updated dependencies [b627562]
  - @checkstack/ui@1.8.2
  - @checkstack/auth-frontend@0.6.2
  - @checkstack/dashboard-frontend@0.7.2
  - @checkstack/gitops-frontend@0.4.2
  - @checkstack/tips-frontend@0.2.2

## 0.19.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/anomaly-common@1.2.0
  - @checkstack/satellite-common@0.5.0
  - @checkstack/auth-frontend@0.6.1
  - @checkstack/dashboard-frontend@0.7.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/gitops-frontend@0.4.1
  - @checkstack/tips-frontend@0.2.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.19.0

### Minor Changes

- 3547670: Wire the new tips infrastructure across the frontends:

  **Empty-state coaching.** Replace generic "no items" copy with onboarding
  guidance — short description, three numbered steps and a primary CTA — on
  every EmptyState that has a meaningful next action. Affects: catalog
  (systems + groups), dashboard, health-check page, integrations (subscriptions

  - provider connections), GitOps providers + secrets, GitOps provenance,
    SLO config + overview, maintenance config, satellites, plugin manager,
    incident config, announcements. Read-only EmptyStates (incident history,
    maintenance history, plugin events) get clearer descriptions explaining
    what would populate them.

  **First-run anchored tips.** Add `<Tip>` popovers to the most important
  "Create" affordances so first-time users see a one-line explanation of
  what they're about to make and why it matters: catalog “Add System” /
  “Add Group”, healthcheck “Create Check”, integrations “New Subscription”,
  GitOps “Add Provider”, SLO “Create SLO”, maintenance “Create Maintenance”,
  satellite “Create Satellite”, plugin-manager “Install plugin”, incident
  “Report Incident”, announcement “New Announcement”. Each tip is dismissed
  per user (server-backed when signed in, localStorage otherwise) and
  namespaced through `qualifyTipId(plugin, …)` so it cannot escape the
  plugin's own namespace.

  **Welcome banner on the dashboard.** A `<TipBanner>` at the top of the
  dashboard introduces Checkstack's main flow ("add a system, then a health
  check") with a one-click jump into the catalog.

### Patch Changes

- 950d6ec: Fix mobile UserMenu items rendering at zero height, group menu items by
  section, and unstack cramped card headers on small viewports.

  - **UserMenu mobile bug**: On mobile, the user-menu Sheet rendered every
    menu item as a grid row, which combined with `flex-shrink: 1` on each
    item collapsed the buttons whose internal layout uses `display: flex`
    (the items registered with `useNavigate` rather than `<Link>`) to zero
    content height. Switched the mobile container to a flex column with
    `[&>*]:shrink-0` and added `min-h-0` so the sheet scrolls correctly
    when the list overflows.

  - **UserMenu grouping**: Slot extensions now accept an optional `group`
    field. The user menu buckets `UserMenuItemsSlot` extensions by `group`
    and renders each group under a labeled header (`Workspace`,
    `Reliability`, `Configuration`, `Documentation`, `Account`). Existing
    core plugins are tagged with the appropriate group; third-party plugins
    can pick any of these or supply their own label. Untagged extensions
    render last with no header. `UserMenuItemsBottomSlot` is unaffected.

  - **Card header responsiveness**: `CardHeaderRow` (the primitive shared by
    Incident, Maintenance, Auth, Catalog, GitOps and other config cards) now
    stacks vertically on narrow viewports and only switches to a single row
    at the `sm` breakpoint, so titles and adjacent filter controls (e.g.
    status `Select`, "Show resolved" checkbox) no longer cram together on
    mobile. Refactored the Incident and Maintenance config pages to use the
    primitive instead of a hand-rolled `flex items-center justify-between`
    row, and made their `Select` triggers full-width on mobile.

- Updated dependencies [42abfff]
- Updated dependencies [42abfff]
- Updated dependencies [3547670]
- Updated dependencies [f6f9a5c]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [3547670]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
  - @checkstack/anomaly-common@1.1.0
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/satellite-common@0.4.0
  - @checkstack/gitops-frontend@0.4.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/tips-frontend@0.2.0
  - @checkstack/auth-frontend@0.6.0
  - @checkstack/dashboard-frontend@0.7.0
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/signal-frontend@0.1.2

## 0.18.2

### Patch Changes

- 50e5f5f: Runtime plugin system: install + uninstall plugins from npm, GitHub releases
  (including private GitHub Enterprise instances), or tarball uploads at
  runtime, with multi-package bundles, dependency-derived compatibility checks,
  multi-instance coordination via a Postgres artifact store, and
  single-coordinator destructive cleanup.

  Highlights:

  - New `PluginSource` discriminated union and `PluginInstaller` /
    `PluginInstallerRegistry` interfaces in `@checkstack/backend-api`. The
    GitHub variant accepts an optional `apiBaseUrl` so deployments backed by
    GitHub Enterprise can install from `https://ghe.example.com/api/v3`
    instead of `api.github.com`.
  - New `installPackageMetadataSchema` (Zod) in `@checkstack/common` validates
    every plugin's `package.json` at install time. Required fields: `name`,
    `version`, `description`, `author`, `license`, `checkstack.type`,
    `checkstack.pluginId`. Optional: `checkstack.bundle`,
    `checkstack.usageInstructions`, `checkstack.allowInstallScripts`.
  - New `pluginManagerContract` in `@checkstack/pluginmanager-common` with
    `list`, `previewInstall`, `install`, `previewUninstall`, `uninstall`, and
    `events` procedures.
  - New `@checkstack/pluginmanager-frontend` admin UI: installed-plugins list
    with per-row uninstall (typed-confirmation modal, schema/configs/cascade
    toggles), install page with NPM / Tarball Upload / GitHub Release tabs
    (Catalog tab disabled — coming soon), and an events page surfacing the
    install/uninstall audit log.
  - New `bunx @checkstack/scripts plugin-pack` CLI for plugin authors —
    per-package mode produces an npm-shaped tarball; `--bundle` mode produces
    an outer tarball containing every sibling declared in
    `package.json#checkstack.bundle`. Published to npm so external authors
    can `bunx` it directly without a workspace checkout.
  - Compatibility derived from `package.json#dependencies` ranges
    (`semver.satisfies` against the platform's loaded `@checkstack/*`
    versions) — no separate `compatibility` field.
  - Multi-instance: originator persists artifacts + `plugins` rows + broadcasts
    install/uninstall; receiving instances do in-process register/unregister
    only. Destructive ops (drop schema, delete plugin_configs, delete
    artifacts, delete `plugins` rows) run exactly once on the originator.
  - Fresh-instance bootstrap: `loadPlugins()` hydrates any
    `is_uninstallable=true` plugin missing from `node_modules` from the
    artifact store before normal Phase 1 register.
  - New schema: `plugin_artifacts` (tarball storage), `plugin_install_events`
    (audit/error log). `plugins` extended with `version`, `metadata`,
    `source`, `bundle_id`, `is_primary`. Local plugin sync now writes
    `version` from each plugin's `package.json` so the admin UI shows real
    versions instead of `—`.
  - Tarball-upload endpoint (`POST /api/pluginmanager/upload-tarball`) for
    the install UI; access-gated by `pluginmanager.plugin.manage`.
  - Plugin Manager menu link added to the user menu (main grid, alongside
    Profile / Notification Settings / etc.).

  Cross-cutting changes:

  - Backend request/response logging now flows through `rootLogger` (winston)
    instead of `hono/logger`. 5xx responses include the response body inline
    so swallowed early-return errors are visible in the log.
  - The `/api/:pluginId/*` dispatcher now logs which core service is missing
    or which `pluginId` had no metadata when it 500s.
  - New `registerCorePluginMetadata` on `PluginManager` for core routers
    (like the plugin manager itself) that need their metadata visible to the
    RPC dispatcher without going through the full plugin lifecycle.
  - ESLint: `unicorn/no-null` is now disabled globally. Drizzle distinguishes
    between `null` (writes a real SQL NULL) and `undefined` (skip the column
    on insert), so treating them as interchangeable produced latent bugs at
    the persistence boundary. The bulk of the patch-bumped packages above
    reflect lint-fix touches that landed when this rule was relaxed.
  - Workspace-wide license normalization to `Elastic-2.0` (matches
    `LICENSE.md`). Every `package.json` in the workspace now declares the
    same SPDX identifier; the patch bumps capture this.

  Plugin packages (every `plugins/*`): added a `pack` npm script
  (`bunx @checkstack/scripts plugin-pack`), mirrored each plugin's
  `pluginId` from `plugin-metadata.ts` into `package.json#checkstack.pluginId`
  so install-time validation passes, stubbed any missing required metadata
  fields (`description`, `author`, `license`), and added
  `checkstack.bundle` to multi-package plugin primaries (telegram, rcon, ssh,
  jira, queue-bullmq, queue-memory, cache-memory).

  Breaking changes:

  - The legacy single-method `PluginInstaller` interface (`install(packageName)`)
    is removed. Callers must use `coreServices.pluginInstallerRegistry`.
  - The old `pluginAdminContract` and `createPluginAdminRouter` are removed.
    Replaced by `pluginManagerContract` in `@checkstack/pluginmanager-common`
    and `createPluginManagerRouter` in `core/backend`.
  - `@checkstack/test-utils-backend` no longer exports
    `createMockPluginInstaller` / `MockPluginInstaller` (the legacy interface
    it shimmed is gone).

  Note: bumps are limited to `minor` (for packages with new public API
  surface) and `patch` (for downstream consumers, license normalization,
  and lint fixes). No `major` bumps despite the `PluginInstaller` removal —
  the legacy interface had no third-party consumers in the wild before this
  runtime plugin system landed, and the contract surface is the same shape
  modulo the rename.

- Updated dependencies [50e5f5f]
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/dashboard-frontend@0.6.1
  - @checkstack/gitops-frontend@0.3.8
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/anomaly-common@1.0.1
  - @checkstack/auth-frontend@0.5.33
  - @checkstack/frontend-api@0.4.2
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/satellite-common@0.3.2

## 0.18.1

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/anomaly-common@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/dashboard-frontend@0.6.0
  - @checkstack/frontend-api@0.4.1
  - @checkstack/auth-frontend@0.5.32
  - @checkstack/ui@1.7.0
  - @checkstack/satellite-common@0.3.1
  - @checkstack/gitops-frontend@0.3.7

## 0.18.0

### Minor Changes

- a914b31: Streamline system → healthcheck assignment flow by allowing in-context creation in both directions.

  - Adds an "Assign to systems" multi-select section to the healthcheck create flow (new "Systems" tree node), so a fresh check can be wired to one or more systems in a single save.
  - Adds a "+ Create new check" button on the system assignment IDE that opens the create flow pre-targeted at that system; on save, the new check is auto-assigned and the user is returned to the assignment IDE.
  - Pre-selects the originating system when the create flow is entered with a `?systemId=` query param, and forwards that param through the strategy picker.
  - Includes an info banner noting that health checks are reusable templates and can be assigned to additional systems at any time, to preserve the "configs are reusable" mental model.

- ac1e5d4: Refactor Status Timeline and Assertion charts to use Recharts with cursor-tracking tooltips, downsampling, and proportional pass/fail stacking.

  - Replaces div-based bar strips with Recharts `BarChart`, so hovering anywhere over the chart resolves the closest bucket.
  - Adds a lightweight time x-axis with smart tick formatting based on the bucket interval.
  - Caps bar count (60 for Status Timeline, 50 for Assertion) by aggregating adjacent buckets, so individual bars stay clickable on dense ranges.
  - Each downsampled Assertion bar is now stacked proportionally — green height shows passed runs and red height shows failed runs across the aggregated window, instead of a worst-case binary color.

### Patch Changes

- 208ad71: Centralize realtime cache invalidation: signals now carry their owning `pluginId` end-to-end, and a single `SignalAutoInvalidator` mounted near the React Query client invalidates `[[pluginId]]` for every incoming signal automatically.

  **Breaking change to `createSignal`** (`@checkstack/signal-common`): the factory now takes a single object argument with `pluginMetadata`, `event`, and `payloadSchema`. The signal id is constructed as `${pluginMetadata.pluginId}.${event}` and the resulting `Signal` carries a `pluginId` field. The `SignalMessage` wire envelope and `ServerToClientMessage` `signal` variant gained a `pluginId` field so the frontend can route invalidations without parsing the id.

  ```ts
  // Before
  export const ANOMALY_STATE_CHANGED = createSignal(
    "anomaly.state_changed",
    z.object({ ... }),
  );

  // After
  export const ANOMALY_STATE_CHANGED = createSignal({
    pluginMetadata,
    event: "state_changed",
    payloadSchema: z.object({ ... }),
  });
  ```

  **New plugin field**: `FrontendPlugin.foreignSignals?: Signal<unknown>[]` lets a plugin opt its `[[pluginId]]` cache into invalidation when another plugin's signal fires (e.g. `dependency-frontend` declares `[SYSTEM_STATUS_CHANGED]` because dependency payloads embed system status). Same-plugin signals must NOT be listed — they are always auto-invalidated.

  **Removed boilerplate**: per-component `useSignal(X, () => refetch())` and `useSignal(X, () => queryClient.invalidateQueries(...))` calls have been removed across `incident-frontend`, `maintenance-frontend`, `healthcheck-frontend`, `slo-frontend`, `dependency-frontend`, `satellite-frontend`, `announcement-frontend`, `notification-frontend`, and `dashboard-frontend`. The `NotificationBell` unread count is now derived directly from the `getUnreadCount` query (auto-invalidated) instead of a local state mirror.

  **User-visible bug fix**: the system detail page anomaly widget (`SystemAnomalyWidget`) now updates in real-time when anomalies change, with no per-widget signal subscription required. The dashboard status page also stays fresh on `ANOMALY_STATE_CHANGED`, `ANOMALY_BASELINE_UPDATED`, and `ANOMALY_TREND_DETECTED`.

  UI-state consumers that legitimately need a `useSignal` (the dashboard activity terminal, the queue lag alert, and the rolling-preset date refresh in `useHealthCheckData`) keep their handlers; the auto-invalidator runs alongside them.

- Updated dependencies [208ad71]
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.4.0
  - @checkstack/anomaly-common@0.3.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/satellite-common@0.3.0
  - @checkstack/dashboard-frontend@0.5.1
  - @checkstack/auth-frontend@0.5.31
  - @checkstack/catalog-common@1.5.3
  - @checkstack/gitops-frontend@0.3.6
  - @checkstack/ui@1.6.1

## 0.17.1

### Patch Changes

- 42b0832: Refactor auto-chart layout to make collector grouping more dominant. Chart titles now show only the metric label (e.g. "Avg Response Time") instead of the prefixed "{collectorId}: Metric" form. Collector groups display the collector name as a heading with a badge containing the full collector id. Cards now stack at full width and their contents are center-aligned.

## 0.17.0

### Minor Changes

- 8d1ef12: ## Anomaly Detection & UI Improvements

  ### Anomaly Detection Enhancements (Phase 2)

  - **`@checkstack/anomaly-backend`**: Implemented background baseline analyzer jobs and anomaly trend deviation detection mechanics.
  - **`@checkstack/anomaly-common`**: Added new baseline statistical logic and inference rules.
  - **`@checkstack/anomaly-frontend`**: Added new Anomaly Widget and refactored system detail rendering to be more human-readable.
  - **`@checkstack/dashboard-frontend`**: Refined the global anomaly widget and fixed hardcoded access gating to render appropriately.
  - **`@checkstack/healthcheck-backend`**: Connected executor telemetry to the anomaly pipeline.
  - **`@checkstack/healthcheck-frontend`**: Reconciled baseline display consistency in Drawer and charts.

  ### Notification Identifiers

  - **`@checkstack/incident-backend`**: Resolved system IDs to human-readable System Names within Incident notifications to eliminate ID-only alert content.
  - **`@checkstack/maintenance-backend`**: Adopted the same resolution strategy for Maintenance notifications to keep parity.

  ### UI Experience

  - **`@checkstack/incident-frontend`**: Fixed the "Back to X" BackLink to properly use `react-router` hook `useNavigate` instead of doing a full application reload.
  - **`@checkstack/healthcheck-frontend`**: Implemented `useNavigate` for seamless SPA back-linking.
  - **`@checkstack/integration-frontend`**: Updated connections and delivery logs links to navigate without hard reloads.

- 8d1ef12: Phase 2 of anomaly detection: trend drift detection.

  The background baseline analyzer now computes a linear regression slope across each field's chronologically-ordered history and runs a `detectDrift` evaluator that catches gradual "creeping degradation" never reaching the 3σ spike threshold. Drifts share the same `anomalies` table as spike anomalies via a new `kind` column (`spike` | `drift`, default `spike`); the existing suspicious → anomaly → recovered lifecycle is reused, ticking at the analyzer's hourly cadence with a default 2-run confirmation window.

  User-facing additions: a Trend Drift toggle and threshold slider on both the template and assignment anomaly settings panels (with per-field overrides), drift rows in the System Anomaly widget, dashed regression-line overlays on the auto-generated line charts, and a new `ANOMALY_TREND_DETECTED` signal for live UI updates. Plugin authors can disable drift per chartable field via `x-anomaly-drift-enabled: false` or tighten/loosen it via `x-anomaly-drift-threshold`.

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/anomaly-common@0.2.0
  - @checkstack/dashboard-frontend@0.5.0
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/satellite-common@0.2.1
  - @checkstack/auth-frontend@0.5.30
  - @checkstack/catalog-common@1.5.2
  - @checkstack/frontend-api@0.3.11
  - @checkstack/gitops-frontend@0.3.5
  - @checkstack/signal-frontend@0.0.16

## 0.16.5

### Patch Changes

- c4e7560: Fix data integrity, cache invalidation, and mobile UI issues

  - **Centralized mutation cache invalidation**: Every mutation now automatically invalidates its plugin's query cache on success via the shared `createProcedureHook` in `orpc-query.tsx`. This ensures all views stay in sync without requiring individual components to remember manual `invalidateQueries` calls.
  - **Fixed oRPC query key matching**: Query keys use nested arrays (`[["pluginId"]]`) to correctly match oRPC's `[pathArray, options]` key structure. Fixed the broken flat-string pattern in `SystemBadgeDataProvider`.
  - **Fixed hourly aggregation duplication**: Added `NULLS NOT DISTINCT` to the `health_check_aggregates` unique constraint so local runs (`source_id = NULL`) correctly conflict-match instead of creating duplicate hourly buckets. Includes a migration to clean up existing duplicates.
  - **Fixed modal scrolling on mobile**: Added `max-height` + `overflow-y-auto` to `ConfirmationModal`, and refactored `Dialog` from translate-centering to flex-centering with `dvh` units for reliable mobile scroll containment.

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/dashboard-frontend@0.4.6
  - @checkstack/ui@1.5.1
  - @checkstack/auth-frontend@0.5.29
  - @checkstack/catalog-common@1.5.1
  - @checkstack/gitops-frontend@0.3.4

## 0.16.4

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0
  - @checkstack/dashboard-frontend@0.4.5

## 0.16.3

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/gitops-frontend@0.3.3
  - @checkstack/dashboard-frontend@0.4.4

## 0.16.2

### Patch Changes

- @checkstack/dashboard-frontend@0.4.3
- @checkstack/auth-frontend@0.5.28
- @checkstack/catalog-common@1.4.1

## 0.16.1

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/auth-frontend@0.5.27
  - @checkstack/dashboard-frontend@0.4.2
  - @checkstack/gitops-frontend@0.3.2

## 0.16.0

### Minor Changes

- 80cbc51: Enforce GitOps provenance lock on backend API endpoints to prevent manual configuration drift for synchronized resources.

### Patch Changes

- @checkstack/dashboard-frontend@0.4.1

## 0.15.0

### Minor Changes

- bb1fea0: Redesign system detail page with hero banner, two-column layout, plugin metric tiles, and health check slide-over drawer.

  ### New Components

  - **MetricTile** (`@checkstack/ui`): Compact stat tile with icon, label, value, variant coloring
  - **Sheet** (`@checkstack/ui`): Slide-over drawer built on Radix Dialog primitives

  ### New Extension Slot

  - **SystemOverviewMetricsSlot** (`@checkstack/catalog-common`): Plugin-contributed at-a-glance metric tiles in the system detail hero banner

  ### Layout Changes

  - System detail page now uses a hero banner with breadcrumb, status badges, and metric tile strip
  - Two-column layout: monitoring content (left) and system context (right)
  - Health checks rendered as compact card rows instead of heavy accordions
  - Clicking a health check opens a slide-over drawer with summary tiles, timeline charts, and recent runs
  - Right column uses lightweight borderless sections with dividers instead of heavy Card wrappers

  ### Plugin Extensions

  - Health check, SLO, Incident, and Maintenance plugins each contribute a metric tile to the hero banner

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/dashboard-frontend@0.4.0
  - @checkstack/ui@1.4.0
  - @checkstack/catalog-common@1.4.0
  - @checkstack/auth-frontend@0.5.26
  - @checkstack/gitops-frontend@0.3.1

## 0.14.2

### Patch Changes

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/gitops-frontend@0.3.0
  - @checkstack/dashboard-frontend@0.3.35

## 0.14.1

### Patch Changes

- Updated dependencies [86bab6a]
  - @checkstack/gitops-frontend@0.2.1
  - @checkstack/dashboard-frontend@0.3.34

## 0.14.0

### Minor Changes

- 6c40b5b: ### GitOps Ecosystem: Healthcheck Kind Registration (Phase 5)

  **gitops-common**: Added required `resolveEntityRef` to `ReconcileContext`, enabling extension reconcilers to resolve cross-kind entity references (e.g., healthcheck refs in System extensions).

  **gitops-backend**: Updated reconciler to populate `resolveEntityRef` by querying local provenance — no RPC round-trip needed.

  **healthcheck-backend**: Registered `kind: Healthcheck` and `System → healthchecks` extension with the EntityKindRegistry:

  - Validates strategy configs against registered strategy schemas at reconcile time
  - Validates collector configs against registered collector schemas at reconcile time
  - Manages system ↔ healthcheck associations with automatic stale removal

  **healthcheck-frontend**: Added GitOps provenance locking to the HealthCheck IDE editor — GitOps-managed health checks show a lock banner and disable editing.

  **catalog-backend**: Updated test fixtures for new required `resolveEntityRef` context field.

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [4b0934d]
  - @checkstack/gitops-frontend@0.2.0
  - @checkstack/ui@1.3.6
  - @checkstack/dashboard-frontend@0.3.33
  - @checkstack/auth-frontend@0.5.25

## 0.13.6

### Patch Changes

- aa2b3aa: fix: remove arbitrary hardcoded assertions in jenkins collectors (queue-info, node-health, job-status) to prevent silent fallback assertion failures, instead properly threading transport execution errors directly to the SingleRunChartGrid UI display widget via a new `_collectorError` result payload property.

## 0.13.5

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/auth-frontend@0.5.24
  - @checkstack/dashboard-frontend@0.3.32

## 0.13.4

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/auth-frontend@0.5.23
  - @checkstack/dashboard-frontend@0.3.31

## 0.13.3

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/auth-frontend@0.5.22
  - @checkstack/dashboard-frontend@0.3.30

## 0.13.2

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/dashboard-frontend@0.3.29
  - @checkstack/auth-frontend@0.5.21

## 0.13.1

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/auth-frontend@0.5.20
  - @checkstack/dashboard-frontend@0.3.28

## 0.13.0

### Minor Changes

- 26d8bae: Distributed satellite health checks and Assignment IDE page

  **Satellite System**

  - New `satellite-backend`, `satellite-common`, `satellite-frontend`, and `satellite` agent packages for distributed health check execution
  - WebSocket-based satellite connectivity with authentication, heartbeats, and live configuration push
  - Satellite management UI with create dialog, status badges, and list page

  **Live Configuration Updates**

  - Added `assignmentChanged` hook to `healthcheck-backend` for cross-plugin communication
  - `satellite-backend` subscribes to assignment changes and pushes config updates to connected satellites in real-time

  **Assignment IDE Page**

  - Replaced the 1028-line modal-based `SystemHealthCheckAssignment` component with a full-page IDE layout
  - New modular components: `AssignmentTree`, `GeneralPanel`, `ThresholdsPanel`, `RetentionPanel`, `ExecutionPanel`
  - Added unassign capability and sorted assignment lists for stable ordering

  **Shared IDE Primitives**

  - Extracted `IDETreeNode`, `IDETreeSection`, `IDEStatusBar`, `IDELayout` to `@checkstack/ui` for cross-plugin reuse
  - Migrated existing health check IDE editor to use shared primitives

  **Infrastructure**

  - Added `Dockerfile.satellite` for containerized satellite deployment
  - WebSocket route registry in `@checkstack/backend` and `@checkstack/backend-api`

- 26d8bae: Source attribution and filtering for satellite health checks

  **Source Attribution**

  - Fixed satellite result attribution: runs from satellites now correctly display their source instead of defaulting to "Local"
  - Added `sourceId` and `sourceLabel` to both public and detailed history API responses

  **Source Filtering**

  - Added `sourceFilter` parameter to `getHistory`, `getDetailedHistory`, and `getDetailedAggregatedHistory` RPC endpoints
  - Source filter supports "local" (core-only), specific satellite UUID, or all sources
  - Filter applies to all three aggregation tiers (raw, hourly, daily)

  **Frontend**

  - System detail accordion shows source filter buttons (All / Local / per-satellite) next to date range filter
  - Filter applies to both charts and recent runs table
  - Source column added to the recent runs table with Local/Remote badges
  - Health check history detail page includes per-satellite source filter buttons

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/satellite-common@0.2.0
  - @checkstack/auth-frontend@0.5.19
  - @checkstack/dashboard-frontend@0.3.27

## 0.12.1

### Patch Changes

- d1a2796: Enforce stricter code quality standards and eliminate AI slop anti-patterns.

  **New utility**

  - `extractErrorMessage(error, fallback?)` in `@checkstack/common` for consistent error extraction

  **ESLint rules**

  - `react-hooks/rules-of-hooks` and `exhaustive-deps` for hook correctness
  - `no-console` in frontend packages — forces `toast` over silent `console.error`
  - `no-restricted-syntax` banning `instanceof Error` — forces `extractErrorMessage`
  - Custom `no-eslint-disable-any` rule preventing `@typescript-eslint/no-explicit-any` circumvention

  **Refactoring**

  - Replace 141 `instanceof Error` boilerplate patterns across the codebase
  - Replace swallowed `console.error` with user-visible `toast.error()` feedback
  - Remove 15 redundant `as` type casts in IntegrationsPage and ProviderConnectionsPage
  - Consolidate 3 identical callback handlers into `handleDialogClose`
  - Fix conditional React hook call in `FormField.tsx`
  - Fix unstable useMemo deps in `Dashboard.tsx`
  - Replace `useEffect`→`setState` with derived `useMemo` in `RegisterPage.tsx`
  - Rewrite `keystore.test.ts` with typed `DrizzleMockChain` (eliminating 7 `any` suppressions)
  - Delete obvious comments in `encryption.ts` and Teams `provider.ts`

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/ui@1.2.1
  - @checkstack/auth-frontend@0.5.18
  - @checkstack/dashboard-frontend@0.3.26
  - @checkstack/frontend-api@0.3.9
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/signal-frontend@0.0.15

## 0.12.0

### Minor Changes

- 54a5f80: ### Health Check Editor Redesign — IDE-Style Experience

  Replaces the modal-based health check editor with a full-page, IDE-style experience:

  - **Strategy Picker Page**: New `/config/create` page with categorized strategy discovery, search filtering, and grouped card grid layout
  - **IDE Editor Page**: New `/config/:configId/edit` page with a split-view layout — explorer tree on the left, editor panel on the right
  - **Strategy Categories**: Introduces `StrategyCategory` enum with 16 categories (Networking, Database, Infrastructure, etc.) — all 13 strategy plugins now declare their category
  - **New RPC Endpoint**: Added `getConfiguration` (singular by ID) for efficient single-resource fetching on the edit page
  - **Explorer Tree**: Left-hand navigation with General, Check Items (collectors), and Access Control sections, with real-time validation indicators
  - **Validation Status Bar**: Bottom bar showing aggregated validation issues with clickable navigation
  - **Unsaved Changes Guard**: Browser `beforeunload` protection when the form is dirty
  - **Responsive Design**: Split-view on desktop, stacked layout on mobile
  - **Deleted**: Legacy `HealthCheckEditor.tsx` modal component

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/dashboard-frontend@0.3.25

## 0.11.8

### Patch Changes

- 1f191cf: Add SYSTEM_STATUS_CHANGED signal and dependency-driven notification improvements

  **healthcheck-common:**

  - New `SYSTEM_STATUS_CHANGED` signal that fires only on system-level health status transitions (healthy ↔ degraded ↔ unhealthy), providing a low-noise alternative to `HEALTH_CHECK_RUN_COMPLETED` for coarse-grained reactivity

  **healthcheck-backend:**

  - Broadcast `SYSTEM_STATUS_CHANGED` signal at both status transition code paths in the queue executor

  **healthcheck-frontend:**

  - Switch `SystemHealthBadge` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` to reduce unnecessary refetch noise

  **dashboard-frontend:**

  - Switch `SystemBadgeDataProvider` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` for more efficient badge updates

  **maintenance-frontend:**

  - Clarify that notification suppression toggle also applies to downstream dependency-driven notifications

  **incident-frontend:**

  - Clarify that notification suppression toggle also applies to downstream dependency-driven notifications

- Updated dependencies [1f191cf]
- Updated dependencies [3f36a64]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/dashboard-frontend@0.3.24
  - @checkstack/catalog-common@1.3.0

## 0.11.7

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/ui@1.2.0
  - @checkstack/auth-frontend@0.5.17
  - @checkstack/dashboard-frontend@0.3.23

## 0.11.6

### Patch Changes

- Updated dependencies [e01945b]
  - @checkstack/auth-frontend@0.5.16
  - @checkstack/dashboard-frontend@0.3.22

## 0.11.5

### Patch Changes

- Updated dependencies [95aa716]
  - @checkstack/ui@1.1.5
  - @checkstack/auth-frontend@0.5.15
  - @checkstack/dashboard-frontend@0.3.21

## 0.11.4

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/auth-frontend@0.5.14
  - @checkstack/ui@1.1.4
  - @checkstack/catalog-common@1.2.11
  - @checkstack/dashboard-frontend@0.3.20

## 0.11.3

### Patch Changes

- 6c743d4: Resolve AJV version mismatch and update to 8.18.0 for security reasons. Also fixed a TypeScript error in the HealthCheck latency chart caused by the Recharts v3 API change.
- Updated dependencies [67158e2]
- Updated dependencies [6c743d4]
  - @checkstack/auth-frontend@0.5.13
  - @checkstack/catalog-common@1.2.10
  - @checkstack/common@0.6.4
  - @checkstack/dashboard-frontend@0.3.19
  - @checkstack/frontend-api@0.3.8
  - @checkstack/healthcheck-common@0.8.4
  - @checkstack/signal-frontend@0.0.14
  - @checkstack/ui@1.1.3

## 0.11.2

### Patch Changes

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7
  - @checkstack/auth-frontend@0.5.12
  - @checkstack/catalog-common@1.2.9
  - @checkstack/dashboard-frontend@0.3.18
  - @checkstack/ui@1.1.2

## 0.11.1

### Patch Changes

- Updated dependencies [0ebbe56]
- Updated dependencies [a340781]
- Updated dependencies [8d2660d]
  - @checkstack/common@0.6.3
  - @checkstack/ui@1.1.1
  - @checkstack/dashboard-frontend@0.3.17
  - @checkstack/auth-frontend@0.5.11
  - @checkstack/catalog-common@1.2.8
  - @checkstack/frontend-api@0.3.6
  - @checkstack/healthcheck-common@0.8.3
  - @checkstack/signal-frontend@0.0.13

## 0.11.0

### Minor Changes

- 84dd430: ## Single Run Auto-Charts

  Added `SingleRunChartGrid` component to display auto-generated charts for individual health check runs when viewing run history details.

  ### Features

  - Renders charts based on the strategy's `resultSchema` metadata (same as aggregated charts)
  - Supports all chart types: gauge, counter, boolean, text, status
  - Groups fields by collector instance with assertion status display
  - Updated `useStrategySchemas` hook to also return `resultSchema` for single-run visualization

  ### Changes

  - Simplified `ExpandedResultView` to show only basic run metadata (status, latency, connection)
  - Collector results and detailed data now displayed via `SingleRunChartGrid`

### Patch Changes

- c842373: ## Animated Numbers & Availability Stats Live Updates

  ### Features

  - **AnimatedNumber component** (`@checkstack/ui`): New reusable component that displays numbers with a smooth "rolling" animation when values change. Uses `requestAnimationFrame` with eased interpolation for a polished effect.
  - **useAnimatedNumber hook** (`@checkstack/ui`): Underlying hook for the animation logic, can be used directly for custom implementations.
  - **Live availability updates**: Availability stats (31-day and 365-day) now automatically refresh when new health check runs are received via signals.

  ### Usage

  ```tsx
  import { AnimatedNumber } from "@checkstack/ui";

  <AnimatedNumber
    value={99.95}
    suffix="%"
    decimals={2}
    duration={500}
    className="text-2xl font-bold text-green-500"
  />;
  ```

- c842373: ## Fix Counter Chart Multiplier Display

  Hide redundant "(1×)" multiplier suffix for single-value counters in auto-charts. For aggregated counter values like "Errors", the displayed value itself represents the count, so showing "(1×)" adds no information and is confusing.

- Updated dependencies [c842373]
  - @checkstack/ui@1.1.0
  - @checkstack/auth-frontend@0.5.10
  - @checkstack/dashboard-frontend@0.3.16

## 0.10.0

### Minor Changes

- 3dd1914: Migrate health check strategies to VersionedAggregated with \_type discriminator

  All 13 health check strategies now use `VersionedAggregated` for their `aggregatedResult` property, enabling automatic bucket merging with 100% mathematical fidelity.

  **Key changes:**

  - **`_type` discriminator**: All aggregated state objects now include a required `_type` field (`"average"`, `"rate"`, `"counter"`, `"minmax"`) for reliable type detection
  - The `HealthCheckStrategy` interface now requires `aggregatedResult` to be a `VersionedAggregated<AggregatedResultShape>`
  - Strategy/collector `mergeResult` methods return state objects with `_type` (e.g., `{ _type: "average", _sum, _count, avg }`)
  - `mergeAggregatedBucketResults`, `combineBuckets`, and `reaggregateBuckets` now require `registry` and `strategyId` parameters
  - `HealthCheckService` constructor now requires both `registry` and `collectorRegistry` parameters
  - Frontend `extractComputedValue` now uses `_type` discriminator for robust type detection

  **Breaking Change**: State objects now require `_type`. Merge functions automatically add `_type` to output. The bucket merging functions and `HealthCheckService` now require additional required parameters.

## 0.9.1

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/ui@1.0.0
  - @checkstack/common@0.6.2
  - @checkstack/auth-frontend@0.5.9
  - @checkstack/dashboard-frontend@0.3.15
  - @checkstack/catalog-common@1.2.7
  - @checkstack/frontend-api@0.3.5
  - @checkstack/healthcheck-common@0.8.2
  - @checkstack/signal-frontend@0.0.12

## 0.9.0

### Minor Changes

- 1b9cb25: Unified chart data to always use aggregated history with fixed target points.

  **Breaking Changes:**

  - Removed `RawDiagramContext` type - chart context no longer has a `type` discriminator
  - Removed `TypedHealthCheckRun` type export - charts only use aggregated buckets now
  - Removed `createStrategyDiagramExtension` deprecated function
  - Removed `isAggregated` and `retentionConfig` from `useHealthCheckData` return value

  **Migration:**

  - Strategy diagram extensions should use `createDiagramExtensionFactory` instead of `createStrategyDiagramExtension`
  - Extensions no longer need separate `rawComponent` and `aggregatedComponent` - use a single `component` prop
  - `HealthCheckDiagramSlotContext` now always contains `buckets` array (no `type` field)

  **Benefits:**

  - Simplified frontend logic - no more mode switching based on retention config
  - Consistent chart visualization regardless of selected time range
  - Backend's cross-tier aggregation engine automatically selects optimal data source

  **Other Changes:**

  - Added warning message when configuring sub-minute check intervals, alerting users about potential performance implications

### Patch Changes

- f1ebac2: - Fixed raw data visualization being cut off when viewing "Last 24 hours" timeframe. The `useHealthCheckData` hook was incorrectly applying pagination limits to chart data queries, causing only the oldest runs to be displayed when there were more runs than the limit. Charts now fetch all runs within the selected date range.
  - Updated Status Timeline visualization for raw data to show stacked status distribution (green/yellow/red proportions) instead of the previous "worst status wins" approach. This makes the raw data view consistent with the aggregated data view.

## 0.8.2

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/catalog-common@1.2.6
  - @checkstack/ui@0.5.3
  - @checkstack/dashboard-frontend@0.3.14
  - @checkstack/auth-frontend@0.5.8

## 0.8.1

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-frontend@0.5.7
  - @checkstack/catalog-common@1.2.5
  - @checkstack/common@0.6.1
  - @checkstack/dashboard-frontend@0.3.13
  - @checkstack/frontend-api@0.3.4
  - @checkstack/healthcheck-common@0.8.1
  - @checkstack/signal-frontend@0.0.11
  - @checkstack/ui@0.5.2

## 0.8.0

### Minor Changes

- d6f7449: Add availability statistics display to HealthCheckSystemOverview

  - New `getAvailabilityStats` RPC endpoint that calculates availability percentages for 31-day and 365-day periods
  - Availability is calculated as `(healthyRuns / totalRuns) * 100`
  - Data is sourced from both daily aggregates and recent raw runs to include the most up-to-date information
  - Frontend displays availability stats with color-coded badges (green ≥99.9%, yellow ≥99%, red <99%)
  - Shows total run counts for each period

### Patch Changes

- Updated dependencies [d6f7449]
  - @checkstack/healthcheck-common@0.8.0
  - @checkstack/dashboard-frontend@0.3.12

## 0.7.2

### Patch Changes

- e58e994: Fix runtime error in AutoChartGrid when mapping over values with undefined elements

  The filter functions `getAllBooleanValuesWithTime` and `getAllStringValuesWithTime` incorrectly checked `v !== null` instead of `v !== undefined`, allowing undefined elements to pass through and crash when accessing `.value`.

## 0.7.1

### Patch Changes

- deec10c: Fix production crash when opening health check accordion and enable sourcemaps

  - Fixed TypeError in `HealthCheckLatencyChart` where recharts Tooltip content function was returning `undefined` instead of `null`, causing "can't access property 'value', o is undefined" error
  - Enabled production sourcemaps in Vite config for better debugging of production errors

## 0.7.0

### Minor Changes

- 1f81b60: ### Clickable Run History with Deep Linking

  **Backend (`healthcheck-backend`):**

  - Added `getRunById` service method to fetch a single health check run by ID

  **Schema (`healthcheck-common`):**

  - Added `getRunById` RPC procedure for fetching individual runs
  - Added `historyRun` route for deep linking to specific runs (`/history/:systemId/:configurationId/:runId`)

  **Frontend (`healthcheck-frontend`):**

  - Table rows in Recent Runs and Run History now navigate to detailed view instead of expanding inline
  - Added "Selected Run" card that displays when navigating to a specific run
  - Extracted `ExpandedResultView` into reusable component
  - Fixed layout shift during table pagination by preserving previous data while loading
  - Removed accordion expansion in favor of consistent navigation UX

### Patch Changes

- 7a4c70e: Improved chart ordering consistency and status timeline readability

  - **Chart ordering**: All charts now display data from left (oldest) to right (newest) for consistency
    - Fixed `HealthCheckSparkline` to reverse status dots order
    - Fixed `AutoChartGrid` `getAllValues()` to return values in chronological order
    - Fixed `getLatestValue()` to return the newest run's value instead of the oldest
  - **Status timeline redesign**: Replaced thin bar charts with readable equal-width segment strips
    - Raw data: Each run gets equal visual space with 1px gaps between segments
    - Aggregated data: Each bucket shows stacked proportional segments for healthy/degraded/unhealthy
    - Added time span display in aggregated tooltips (e.g., "Jan 20, 09:00 - 10:00")
    - Removed Recharts dependency for timeline, now uses pure CSS flexbox
  - **Label update**: Renamed "Response Latency" chart to "Execution Duration" for accuracy
  - **UI polish**: Added "~" prefix to duration formats in AggregatedDataBanner

- 090143b: ### Health Check Aggregation & UI Fixes

  **Backend (`healthcheck-backend`):**

  - Fixed tail-end bucket truncation where the last aggregated bucket was cut off at the interval boundary instead of extending to the query end date
  - Added `rangeEnd` parameter to `reaggregateBuckets()` to properly extend the last bucket
  - Fixed cross-tier merge logic (`mergeTieredBuckets`) to prevent hourly aggregates from blocking fresh raw data

  **Schema (`healthcheck-common`):**

  - Added `bucketEnd` field to `AggregatedBucketBaseSchema` so frontends know the actual end time of each bucket

  **Frontend (`healthcheck-frontend`):**

  - Updated all components to use `bucket.bucketEnd` instead of calculating from `bucketIntervalSeconds`
  - Fixed aggregation mode detection: changed `>` to `>=` so 7-day queries use aggregated data when `rawRetentionDays` is 7
  - Added ref-based memoization in `useHealthCheckData` to prevent layout shift during signal-triggered refetches
  - Exposed `isFetching` state to show loading spinner during background refetches
  - Added debounced custom date range with Apply button to prevent fetching on every field change
  - Added validation preventing start date >= end date in custom ranges
  - Added sparkline downsampling: when there are 60+ data points, they are aggregated into buckets with informative tooltips

  **UI (`ui`):**

  - Fixed `DateRangeFilter` presets to use true sliding windows (removed `startOfDay` from 7-day and 30-day ranges)
  - Added `disabled` prop to `DateRangeFilter` and `DateTimePicker` components
  - Added `onCustomChange` prop to `DateRangeFilter` for debounced custom date handling
  - Improved layout: custom date pickers now inline with preset buttons on desktop
  - Added responsive mobile layout: date pickers stack vertically with down arrow
  - Added validation error display for invalid date ranges

- bc58c3f: ### Fix layout shift in paginated tables

  - Preserve previous table data during loading to prevent layout shift
  - Add inline loading spinner in table headers without affecting layout
  - Add opacity to table rows during loading to indicate data refresh

- Updated dependencies [1f81b60]
- Updated dependencies [090143b]
  - @checkstack/healthcheck-common@0.7.0
  - @checkstack/ui@0.5.1
  - @checkstack/dashboard-frontend@0.3.11
  - @checkstack/auth-frontend@0.5.6

## 0.6.0

### Minor Changes

- 11d2679: Add ability to pause health check configurations globally. When paused, health checks continue to be scheduled but execution is skipped for all systems using that configuration. Users with manage access can pause/resume from the Health Checks config page.

### Patch Changes

- 223081d: Add icon support to PageLayout and improve mobile responsiveness

  **PageLayout Icons:**

  - Added required `icon` prop to `PageLayout` and `PageHeader` components that accepts a Lucide icon component reference
  - Icons are rendered with consistent `h-6 w-6 text-primary` styling
  - Updated all page components to include appropriate icons in their headers

  **Mobile Layout Improvements:**

  - Standardized responsive padding in main app shell (`p-3` on mobile, `p-6` on desktop)
  - Added `CardHeaderRow` component for mobile-safe card headers with proper wrapping
  - Improved `DateRangeFilter` responsive behavior with vertical stacking on mobile
  - Migrated pages to use `PageLayout` for consistent responsive behavior

- Updated dependencies [11d2679]
- Updated dependencies [223081d]
  - @checkstack/healthcheck-common@0.6.0
  - @checkstack/ui@0.5.0
  - @checkstack/auth-frontend@0.5.5
  - @checkstack/dashboard-frontend@0.3.10

## 0.5.0

### Minor Changes

- ac3a4cf: ### Dynamic Bucket Sizing for Health Check Visualization

  Implements industry-standard dynamic bucket sizing for health check data aggregation, following patterns from Grafana/VictoriaMetrics.

  **What changed:**

  - Replaced fixed `bucketSize: "hourly" | "daily" | "auto"` with dynamic `targetPoints` parameter (default: 500)
  - Bucket interval is now calculated as `(endDate - startDate) / targetPoints` with a minimum of 1 second
  - Added `bucketIntervalSeconds` to aggregated response and individual buckets
  - Updated chart components to use dynamic time formatting based on bucket interval

  **Why:**

  - A 24-hour view with 1-second health checks previously returned 86,400+ data points, causing lag
  - Now returns ~500 data points regardless of timeframe, ensuring consistent chart performance
  - Charts still preserve visual fidelity through proper aggregation

  **Breaking Change:**

  - `bucketSize` parameter removed from `getAggregatedHistory` and `getDetailedAggregatedHistory` endpoints
  - Use `targetPoints` instead (defaults to 500 if not specified)

  ***

  ### Collector Aggregated Charts Fix

  Fixed issue where collector auto-charts (like HTTP request response time charts) were not showing in aggregated data mode.

  **What changed:**

  - Added `aggregatedResultSchema` to `CollectorDtoSchema`
  - Backend now returns collector aggregated schemas via `getCollectors` endpoint
  - Frontend `useStrategySchemas` hook now merges collector aggregated schemas
  - Service now calls each collector's `aggregateResult()` when building buckets
  - Aggregated collector data stored in `aggregatedResult.collectors[uuid]`

  **Why:**

  - Previously only strategy-level aggregated results were computed
  - Collectors like HTTP Request Collector have their own `aggregateResult` method
  - Without calling these, fields like `avgResponseTimeMs` and `successRate` were missing from aggregated buckets

### Patch Changes

- 095cf4e: ### Cross-Tier Data Aggregation

  Implements intelligent cross-tier querying for health check history, enabling seamless data retrieval across raw, hourly, and daily storage tiers.

  **What changed:**

  - `getAggregatedHistory` now queries all three tiers (raw, hourly, daily) in parallel
  - Added `NormalizedBucket` type for unified bucket format across tiers
  - Added `mergeTieredBuckets()` to merge data with priority (raw > hourly > daily)
  - Added `combineBuckets()` and `reaggregateBuckets()` for re-aggregation to target bucket size
  - Raw data preserves full granularity when available (uses target bucket interval)

  **Why:**

  - Previously, the API only queried raw runs, which are retained for a limited period (default 7 days)
  - For longer time ranges, data was missing because hourly/daily aggregates weren't queried
  - The retention job only runs periodically, so we can't assume tier boundaries based on config
  - Querying all tiers ensures no gaps in data coverage

  **Technical details:**

  - Additive metrics (counts, latencySum) are summed correctly for accurate averages
  - p95 latency uses max of source p95s as conservative upper-bound approximation
  - `aggregatedResult` (strategy-specific) is preserved for raw-only buckets

- 538e45d: Fixed 24-hour date range not returning correct data and improved chart display

  - Fixed missing `endDate` parameter in raw data queries causing data to extend beyond selected time range
  - Fixed incorrect 24-hour date calculation using `setHours()` - now uses `date-fns` `subHours()` for correct date math
  - Refactored `DateRangePreset` from string union to enum for improved type safety and IDE support
  - Exported `getPresetRange` function for reuse across components
  - Changed chart x-axis domain from `["auto", "auto"]` to `["dataMin", "dataMax"]` to remove padding gaps

- Updated dependencies [ac3a4cf]
- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/healthcheck-common@0.5.0
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/dashboard-frontend@0.3.9
  - @checkstack/auth-frontend@0.5.4
  - @checkstack/catalog-common@1.2.4
  - @checkstack/frontend-api@0.3.3
  - @checkstack/signal-frontend@0.0.10

## 0.4.10

### Patch Changes

- d1324e6: Removed redundant inner scroll wrapper from HealthCheckEditor - Dialog now handles scrolling
- Updated dependencies [d1324e6]
- Updated dependencies [1f1f6c2]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0
  - @checkstack/dashboard-frontend@0.3.8
  - @checkstack/auth-frontend@0.5.3

## 0.4.9

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/healthcheck-common@0.4.2
  - @checkstack/auth-frontend@0.5.2
  - @checkstack/dashboard-frontend@0.3.7
  - @checkstack/frontend-api@0.3.2
  - @checkstack/ui@0.3.1
  - @checkstack/signal-frontend@0.0.9

## 0.4.8

### Patch Changes

- @checkstack/dashboard-frontend@0.3.6

## 0.4.7

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-frontend@0.5.1
  - @checkstack/dashboard-frontend@0.3.5
  - @checkstack/catalog-common@1.2.2
  - @checkstack/frontend-api@0.3.1
  - @checkstack/healthcheck-common@0.4.1
  - @checkstack/signal-frontend@0.0.8

## 0.4.6

### Patch Changes

- Updated dependencies [10aa9fb]
- Updated dependencies [d94121b]
  - @checkstack/auth-frontend@0.5.0
  - @checkstack/ui@0.2.4
  - @checkstack/dashboard-frontend@0.3.4

## 0.4.5

### Patch Changes

- Updated dependencies [cad3073]
  - @checkstack/dashboard-frontend@0.3.3

## 0.4.4

### Patch Changes

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3
  - @checkstack/auth-frontend@0.4.1
  - @checkstack/dashboard-frontend@0.3.2

## 0.4.3

### Patch Changes

- dd07c14: Fix collector add button failing in HTTP contexts by replacing `crypto.randomUUID()` with the `uuid` package

## 0.4.2

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-frontend@0.4.0
  - @checkstack/dashboard-frontend@0.3.1

## 0.4.1

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/dashboard-frontend@0.3.0
  - @checkstack/auth-frontend@0.3.1
  - @checkstack/catalog-common@1.2.1
  - @checkstack/ui@0.2.2

## 0.4.0

### Minor Changes

- 7a23261: ## TanStack Query Integration

  Migrated all frontend components to use `usePluginClient` hook with TanStack Query integration, replacing the legacy `forPlugin()` pattern.

  ### New Features

  - **`usePluginClient` hook**: Provides type-safe access to plugin APIs with `.useQuery()` and `.useMutation()` methods
  - **Automatic request deduplication**: Multiple components requesting the same data share a single network request
  - **Built-in caching**: Configurable stale time and cache duration per query
  - **Loading/error states**: TanStack Query provides `isLoading`, `error`, `isRefetching` states automatically
  - **Background refetching**: Stale data is automatically refreshed when components mount

  ### Contract Changes

  All RPC contracts now require `operationType: "query"` or `operationType: "mutation"` metadata:

  ```typescript
  const getItems = proc()
    .meta({ operationType: "query", access: [access.read] })
    .output(z.array(itemSchema))
    .query();

  const createItem = proc()
    .meta({ operationType: "mutation", access: [access.manage] })
    .input(createItemSchema)
    .output(itemSchema)
    .mutation();
  ```

  ### Migration

  ```typescript
  // Before (forPlugin pattern)
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  // After (usePluginClient pattern)
  const client = usePluginClient(MyPluginApi);
  const { data: items, isLoading } = client.getItems.useQuery({});
  ```

  ### Bug Fixes

  - Fixed `rpc.test.ts` test setup for middleware type inference
  - Fixed `SearchDialog` to use `setQuery` instead of deprecated `search` method
  - Fixed null→undefined warnings in notification and queue frontends

### Patch Changes

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/dashboard-frontend@0.2.0
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/catalog-common@1.2.0
  - @checkstack/healthcheck-common@0.4.0
  - @checkstack/ui@0.2.1
  - @checkstack/signal-frontend@0.0.7

## 0.3.0

### Minor Changes

- 9faec1f: # Unified AccessRule Terminology Refactoring

  This release completes a comprehensive terminology refactoring from "permission" to "accessRule" across the entire codebase, establishing a consistent and modern access control vocabulary.

  ## Changes

  ### Core Infrastructure (`@checkstack/common`)

  - Introduced `AccessRule` interface as the primary access control type
  - Added `accessPair()` helper for creating read/manage access rule pairs
  - Added `access()` builder for individual access rules
  - Replaced `Permission` type with `AccessRule` throughout

  ### API Changes

  - `env.registerPermissions()` → `env.registerAccessRules()`
  - `meta.permissions` → `meta.access` in RPC contracts
  - `usePermission()` → `useAccess()` in frontend hooks
  - Route `permission:` field → `accessRule:` field

  ### UI Changes

  - "Roles & Permissions" tab → "Roles & Access Rules"
  - "You don't have permission..." → "You don't have access..."
  - All permission-related UI text updated

  ### Documentation & Templates

  - Updated 18 documentation files with AccessRule terminology
  - Updated 7 scaffolding templates with `accessPair()` pattern
  - All code examples use new AccessRule API

  ## Migration Guide

  ### Backend Plugins

  ```diff
  - import { permissionList } from "./permissions";
  - env.registerPermissions(permissionList);
  + import { accessRules } from "./access";
  + env.registerAccessRules(accessRules);
  ```

  ### RPC Contracts

  ```diff
  - .meta({ userType: "user", permissions: [permissions.read.id] })
  + .meta({ userType: "user", access: [access.read] })
  ```

  ### Frontend Hooks

  ```diff
  - const canRead = accessApi.usePermission(permissions.read.id);
  + const canRead = accessApi.useAccess(access.read);
  ```

  ### Routes

  ```diff
  - permission: permissions.entityRead.id,
  + accessRule: access.read,
  ```

- 827b286: Add array assertion operators for string array fields

  New operators for asserting on array fields (e.g., playerNames in RCON collectors):

  - **includes** - Check if array contains a specific value
  - **notIncludes** - Check if array does NOT contain a specific value
  - **lengthEquals** - Check if array length equals a value
  - **lengthGreaterThan** - Check if array length is greater than a value
  - **lengthLessThan** - Check if array length is less than a value
  - **isEmpty** - Check if array is empty
  - **isNotEmpty** - Check if array has at least one element

  Also exports a new `arrayField()` schema factory for creating array assertion schemas.

### Patch Changes

- f533141: Enforce health result factory function usage via branded types

  - Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
  - Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
  - Added branded `HealthResultField<T>` type to mark schemas created by factory functions
  - Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
  - Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
  - Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error

- Updated dependencies [9faec1f]
- Updated dependencies [95eeec7]
- Updated dependencies [f533141]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/healthcheck-common@0.3.0
  - @checkstack/ui@0.2.0
  - @checkstack/signal-frontend@0.0.6

## 0.2.0

### Minor Changes

- 8e43507: # Teams and Resource-Level Access Control

  This release introduces a comprehensive Teams system for organizing users and controlling access to resources at a granular level.

  ## Features

  ### Team Management

  - Create, update, and delete teams with name and description
  - Add/remove users from teams
  - Designate team managers with elevated privileges
  - View team membership and manager status

  ### Resource-Level Access Control

  - Grant teams access to specific resources (systems, health checks, incidents, maintenances)
  - Configure read-only or manage permissions per team
  - Resource-level "Team Only" mode that restricts access exclusively to team members
  - Separate `resourceAccessSettings` table for resource-level settings (not per-grant)
  - Automatic cleanup of grants when teams are deleted (database cascade)

  ### Middleware Integration

  - Extended `autoAuthMiddleware` to support resource access checks
  - Single-resource pre-handler validation for detail endpoints
  - Automatic list filtering for collection endpoints
  - S2S endpoints for access verification

  ### Frontend Components

  - `TeamsTab` component for managing teams in Auth Settings
  - `TeamAccessEditor` component for assigning team access to resources
  - Resource-level "Team Only" toggle in `TeamAccessEditor`
  - Integration into System, Health Check, Incident, and Maintenance editors

  ## Breaking Changes

  ### API Response Format Changes

  List endpoints now return objects with named keys instead of arrays directly:

  ```typescript
  // Before
  const systems = await catalogApi.getSystems();

  // After
  const { systems } = await catalogApi.getSystems();
  ```

  Affected endpoints:

  - `catalog.getSystems` → `{ systems: [...] }`
  - `healthcheck.getConfigurations` → `{ configurations: [...] }`
  - `incident.listIncidents` → `{ incidents: [...] }`
  - `maintenance.listMaintenances` → `{ maintenances: [...] }`

  ### User Identity Enrichment

  `RealUser` and `ApplicationUser` types now include `teamIds: string[]` field with team memberships.

  ## Documentation

  See `docs/backend/teams.md` for complete API reference and integration guide.

- 97c5a6b: Add UUID-based collector identification for better multiple collector support

  **Breaking Change**: Existing health check configurations with collectors need to be recreated.

  - Each collector instance now has a unique UUID assigned on creation
  - Collector results are stored under the UUID key with `_collectorId` and `_assertionFailed` metadata
  - Auto-charts correctly display separate charts for each collector instance
  - Charts are now grouped by collector instance with clear headings
  - Assertion status card shows pass/fail for each collector
  - Renamed "Success" to "HTTP Success" to clarify it's about HTTP request success
  - Fixed deletion of collectors not persisting to database
  - Fixed duplicate React key warnings in auto-chart grid

### Patch Changes

- 97c5a6b: Fix Radix UI accessibility warning in dialog components by adding visually hidden DialogDescription components
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/ui@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/catalog-common@1.0.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0
  - @checkstack/frontend-api@0.0.4
  - @checkstack/signal-frontend@0.0.5

## 0.1.0

### Minor Changes

- f5b1f49: Added support for nested collector result display in auto-charts and history table.

  - Updated `schema-parser.ts` to traverse `collectors.*` nested schemas and extract chart fields with dot-notation paths
  - Added `getFieldValue()` support for dot-notation paths like `collectors.request.responseTimeMs`
  - Added `ExpandedResultView` component to `HealthCheckRunsTable.tsx` that displays:
    - Connection info (status, latency, connection time)
    - Per-collector results as structured cards with key-value pairs

- f5b1f49: Added JSONPath assertions for response body validation and fully qualified strategy IDs.

  **JSONPath Assertions:**

  - Added `healthResultJSONPath()` factory in healthcheck-common for fields supporting JSONPath queries
  - Extended AssertionBuilder with jsonpath field type showing path input (e.g., `$.data.status`)
  - Added `jsonPath` field to `CollectorAssertionSchema` for persistence
  - HTTP Request collector body field now supports JSONPath assertions

  **Fully Qualified Strategy IDs:**

  - HealthCheckRegistry now uses scoped factories like CollectorRegistry
  - Strategies are stored with `pluginId.strategyId` format
  - Added `getStrategiesWithMeta()` method to HealthCheckRegistry interface
  - Router returns qualified IDs so frontend can correctly fetch collectors

  **UI Improvements:**

  - Save button disabled when collector configs have invalid required fields
  - Fixed nested button warning in CollectorList accordion

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/catalog-common@0.0.3
  - @checkstack/frontend-api@0.0.3
  - @checkstack/signal-frontend@0.0.4

## 0.0.3

### Patch Changes

- cb82e4d: Improved `counter` and `pie` auto-chart types to show frequency distributions instead of just the latest value. Both chart types now count occurrences of each unique value across all runs/buckets, making them more intuitive for visualizing data like HTTP status codes.

  Changed HTTP health check chart annotations: `statusCode` now uses `pie` chart (distribution view), `contentType` now uses `counter` chart (frequency count).

  Fixed scrollbar hopping when health check signals update the accordion content. All charts now update silently without layout shift or loading state flicker.

  Refactored health check visualization architecture:

  - `HealthCheckStatusTimeline` and `HealthCheckLatencyChart` now accept `HealthCheckDiagramSlotContext` directly, handling data transformation internally
  - `HealthCheckDiagram` refactored to accept context from parent, ensuring all visualizations share the same data source and update together on signals
  - `HealthCheckSystemOverview` simplified to use `useHealthCheckData` hook for consolidated data fetching with automatic signal-driven refresh

  Added `silentRefetch()` method to `usePagination` hook for background data refreshes without showing loading indicators.

  Fixed `useSignal` hook to use a ref pattern internally, preventing stale closure issues. Callbacks now always access the latest values without requiring manual memoization or refs in consumer components.

  Added signal handling to `useHealthCheckData` hook for automatic chart refresh when health check runs complete.

- Updated dependencies [cb82e4d]
  - @checkstack/healthcheck-common@0.0.3
  - @checkstack/signal-frontend@0.0.3
  - @checkstack/ui@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/catalog-common@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/healthcheck-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

## 0.2.0

### Minor Changes

- a65e002: Add command palette commands and deep-linking support

  **Backend Changes:**

  - `healthcheck-backend`: Add "Manage Health Checks" (⇧⌘H) and "Create Health Check" commands
  - `catalog-backend`: Add "Manage Systems" (⇧⌘S) and "Create System" commands
  - `integration-backend`: Add "Manage Integrations" (⇧⌘G), "Create Integration Subscription", and "View Integration Logs" commands
  - `auth-backend`: Add "Manage Users" (⇧⌘U), "Create User", "Manage Roles", and "Manage Applications" commands
  - `command-backend`: Auto-cleanup command registrations when plugins are deregistered

  **Frontend Changes:**

  - `HealthCheckConfigPage`: Handle `?action=create` URL parameter
  - `CatalogConfigPage`: Handle `?action=create` URL parameter
  - `IntegrationsPage`: Handle `?action=create` URL parameter
  - `AuthSettingsPage`: Handle `?tab=` and `?action=create` URL parameters

### Patch Changes

- 0afa204: Subscribe health check charts and history table to real-time signal updates. Charts now display the full data for the selected time range independently from the paginated history table, and both update automatically when a health check run completes.
- 32ea706: ### User Menu Loading State Fix

  Fixed user menu items "popping in" one after another due to independent async permission checks.

  **Changes:**

  - Added `UserMenuItemsContext` interface with `permissions` and `hasCredentialAccount` to `@checkstack/frontend-api`
  - `LoginNavbarAction` now pre-fetches all permissions and credential account info before rendering the menu
  - All user menu item components now use the passed context for synchronous permission checks instead of async hooks
  - Uses `qualifyPermissionId` helper for fully-qualified permission IDs

  **Result:** All menu items appear simultaneously when the user menu opens.

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkstack/ui@0.1.2
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/healthcheck-common@0.1.1
  - @checkstack/signal-frontend@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/catalog-common@0.1.1
  - @checkstack/ui@0.1.1

## 0.1.0

### Minor Changes

- ae19ff6: Add configurable state thresholds for health check evaluation

  **@checkstack/backend-api:**

  - Added `VersionedData<T>` generic interface as base for all versioned data structures
  - `VersionedConfig<T>` now extends `VersionedData<T>` and adds `pluginId`
  - Added `migrateVersionedData()` utility function for running migrations on any `VersionedData` subtype

  **@checkstack/backend:**

  - Refactored `ConfigMigrationRunner` to use the new `migrateVersionedData` utility

  **@checkstack/healthcheck-common:**

  - Added state threshold schemas with two evaluation modes (consecutive, window)
  - Added `stateThresholds` field to `AssociateHealthCheckSchema`
  - Added `getSystemHealthStatus` RPC endpoint contract

  **@checkstack/healthcheck-backend:**

  - Added `stateThresholds` column to `system_health_checks` table
  - Added `state-evaluator.ts` with health status evaluation logic
  - Added `state-thresholds-migrations.ts` with migration infrastructure
  - Added `getSystemHealthStatus` RPC handler

  **@checkstack/healthcheck-frontend:**

  - Updated `SystemHealthBadge` to use new backend endpoint

- 0babb9c: Add public health status access and detailed history for admins

  **Permission changes:**

  - Added `healthcheck.status.read` permission with `isPublicDefault: true` for anonymous access
  - `getSystemHealthStatus`, `getSystemHealthOverview`, and `getHistory` now public
  - `getHistory` no longer returns `result` field (security)

  **New features:**

  - Added `getDetailedHistory` endpoint with `healthcheck.manage` permission
  - New `/healthcheck/history` page showing paginated run history with expandable result JSON

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.0.2
