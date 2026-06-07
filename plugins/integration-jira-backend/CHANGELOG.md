# @checkstack/integration-jira-backend

## 0.3.7

### Patch Changes

- @checkstack/automation-backend@0.5.7

## 0.3.6

### Patch Changes

- @checkstack/automation-backend@0.5.6

## 0.3.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/integration-common@0.7.3
  - @checkstack/automation-backend@0.5.5
  - @checkstack/integration-backend@0.4.5
  - @checkstack/integration-jira-common@0.1.21

## 0.3.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/automation-backend@0.5.4
  - @checkstack/integration-backend@0.4.4

## 0.3.3

### Patch Changes

- @checkstack/automation-backend@0.5.3
- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/integration-backend@0.4.3
- @checkstack/integration-common@0.7.2
- @checkstack/integration-jira-common@0.1.20

## 0.3.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/automation-backend@0.5.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/integration-backend@0.4.2
  - @checkstack/integration-common@0.7.2
  - @checkstack/integration-jira-common@0.1.20

## 0.3.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/automation-backend@0.5.1
  - @checkstack/integration-backend@0.4.1
  - @checkstack/integration-common@0.7.1
  - @checkstack/integration-jira-common@0.1.19

## 0.3.0

### Minor Changes

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/backend-api@0.21.0
  - @checkstack/automation-backend@0.5.0
  - @checkstack/integration-backend@0.4.0
  - @checkstack/common@0.13.0
  - @checkstack/integration-common@0.7.0
  - @checkstack/integration-jira-common@0.1.18

## 0.2.2

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/automation-backend@0.4.0
  - @checkstack/integration-backend@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
  - @checkstack/backend-api@0.19.0
  - @checkstack/automation-backend@0.3.0
  - @checkstack/integration-backend@0.3.0

## 0.2.0

### Minor Changes

- e2d6f25: feat(automation): connection picker for integration actions + restore Integrations menu

  Connection-backed automation actions (Jira, Teams, Webex) now render a
  working connection picker plus cascading provider dropdowns in the
  visual editor, and the Integrations entry is back in the user menu.

  **Contract.** `ActionDefinition` gained an optional
  `connectionProviderId` (and it is surfaced on `ActionInfoSchema` and
  mapped in the `listActions` router). It carries the integration
  provider's fully-qualified id, derived from the provider plugin's own
  `pluginMetadata.pluginId` (never a hardcoded string), so the editor
  knows which provider backs an action's dropdowns and it matches the
  `qualifiedId` the integration provider registry assigns.

  **Providers.** Jira, Teams and Webex each export
  `*_PROVIDER_LOCAL_ID` / `*_PROVIDER_QUALIFIED_ID`, register their
  provider with the local id, and add a `CONNECTION_OPTIONS`
  (`"connectionOptions"`) resolver name. Their `post_message` /
  issue actions set `connectionProviderId` and expose `connectionId`
  as an `x-options-resolver` dropdown instead of a hidden field.

  **Frontend bridge.** A new `useConnectionOptionResolvers` hook
  (`@checkstack/automation-frontend`, which now depends on
  `@checkstack/integration-common`) turns an action's
  `x-options-resolver` schema fields into live data: the
  `connectionOptions` resolver lists the provider's connections via
  `listConnections`, and every other resolver name is forwarded to
  `getConnectionOptions` for the selected `connectionId`, passing the
  live form values as `context` for dependent fields. `ProviderActionBody`
  now passes this map to `DynamicForm` (it was previously missing
  entirely, so connection-backed actions had no working dropdowns).

  **frontend-api.** `usePluginClient` procedures now also expose a typed
  imperative `.call(input)` alongside `.useQuery` / `.useMutation`, for
  async callbacks that cannot host a hook (such as a `DynamicForm`
  options resolver). Additive, non-breaking.

  **Integrations menu.** Re-added `IntegrationMenuItem` and a new
  `IntegrationsLandingPage`, wired into `integration-frontend` as a list
  route and a `UserMenuItemsSlot` entry under the "Configuration" group.

  **Action card polish.** The action editor's secondary metadata (id,
  description, failure behaviour) is now grouped into one quiet settings
  panel with consistent small uppercase "eyebrow" labels, so the action's
  own configuration stays the focal point. The raw failure checkbox was
  replaced with the standard `Checkbox` control, and the provider action
  picker / configuration sections gained consistent section headers and a
  divider. The per-step "type" dropdown was removed: an action's kind is
  fixed at creation, so changing it now means adding a new step and
  deleting the old one (avoids the surprising full-config reset that
  switching kinds used to trigger).

  **Add-step picker.** Adding a step now opens a Home-Assistant-style
  dialog where the operator decides the step type up front: an "Actions"
  tab lists the registered provider actions grouped by category
  (searchable; picking one presets the step's `action`), and a "Blocks"
  tab lists the structural building blocks (choose / parallel / repeat /
  etc.). Because the concrete action is chosen here, the in-card action
  switcher was removed - a step's action is fixed once created. Composite
  blocks now start with an empty child list (filled via the nested
  add-step picker) instead of seeding an unconfigurable empty action.

- 41c77f4: feat(jira): register Jira automation actions + `jira.issue` artifact type

  Adds three Jira actions to the Automation platform:

  - `jira.create_issue` — produces the new `jira.issue` artifact type
    (`issueKey`, `projectKey`, `issueUrl`, `id`, `status?`)
  - `jira.transition_issue` — consumes `jira.issue` (or accepts an
    explicit `issueKey`), idempotent against already-applied transitions
  - `jira.add_comment` — consumes `jira.issue` (or accepts an explicit
    `issueKey`)

  Extends the Jira client with `getTransitions`, `getIssueStatus`,
  `transitionIssue` (handles 204 No Content, comment in ADF for Cloud /
  plain text for Data Center), and `addComment`. Adds a new
  `JIRA_RESOLVERS.TRANSITION_OPTIONS` cascading dropdown driven by
  `connectionId` + `issueKey`. `@checkstack/integration-backend` now
  re-exports the `ConnectionStore` interface so action plugins can take
  it as a typed dep.

- 41c77f4: feat(automation): one-time migration of webhook subscriptions + remove legacy integration backend

  **BREAKING CHANGES** (platform is in BETA — no major bump):

  - `IntegrationProvider` no longer carries `config` (subscription
    config) or `deliver`. The interface now models a connection provider
    only: connection schema + `getConnectionOptions` + `testConnection`.
  - The legacy subscription / delivery-log / event endpoints
    (`listSubscriptions`, `createSubscription`, `getDeliveryLogs`,
    `listEventTypes`, …) are removed from `integrationContract`.
  - `delivery-coordinator`, `hook-subscriber`, `event-registry`, and the
    `integrationEventExtensionPoint` are deleted. Plugins that
    previously called `integrationEvents.registerEvent(...)` now
    register their hooks as automation triggers via
    `automationTriggerExtensionPoint.registerTrigger(...)`.
  - Frontend pages `IntegrationsPage` and `DeliveryLogsPage` are gone;
    the integration plugin's only remaining UI is connection
    management. Subscription management lives under `/automation/...`.
  - `webhook_subscriptions` and `delivery_logs` tables stay in the
    database for one release as a safety net (no code reads or writes
    them), and will be dropped in a follow-up migration.

  **New**:

  - `jira.create_issue`, `teams.post_message`, `webex.post_message`,
    `webhook.send`, `integration-script.run_shell`, and
    `integration-script.run_script` actions registered against the
    Automation Platform with matching `*.message`, `*.delivery`,
    `shell.result`, and `script.result` artifact types. The script
    plugin exposes **two** actions — `run_shell` runs bash via the
    shared `ShellScriptRunner` (Monaco `shell` editor), `run_script`
    runs an ESM module in a Bun subprocess via `EsmScriptRunner`
    (Monaco `typescript` editor + `defineIntegration` helper) — to
    preserve the legacy provider split. `jira.create_issue` keeps the
    dynamic field-mapping dropdown (driven by
    `JIRA_RESOLVERS.FIELD_OPTIONS`).
  - One-time data migration runs on boot in
    `automation-backend.afterPluginsReady`. It reads
    `webhook_subscriptions` via a new service RPC
    `IntegrationApi.listLegacySubscriptions`, translates each row into
    a single-trigger / single-action automation (marked with
    `managed_by = "migrated-subscription:<id>"`), and is idempotent
    across restarts.
  - Failed translations are recorded in a new
    `automation_migration_failures` table and surfaced via
    `AutomationApi.listMigrationFailures` /
    `acknowledgeMigrationFailure` so admins can review and re-create
    failed entries by hand.

- 41c77f4: fix(automation): qualify action `produces` / `consumes` with the owning plugin id

  `context.artifacts` showed up untyped (no fields) in the script editor
  because action `produces` / `consumes` were hand-written full strings
  (`"jira.issue"`) that did not match the artifact-type registry's
  qualified id. The registry derives `${pluginId}.${id}`, and the plugin's
  id is the package name `integration-jira`, so the artifact type actually
  registers as `integration-jira.issue` — the editor's schema lookup
  (`produces` vs registered `qualifiedId`) missed, leaving the artifact's
  fields unknown. (Runtime store/consume happened to agree with each other
  on the short string, so it "worked" but typed nothing.)

  The action registry now qualifies `produces` with the owning plugin id,
  exactly as it already qualifies the action's own `id` and as the
  artifact-type registry qualifies the artifact type id — so the three can
  never drift. Actions declare the **local** artifact id:

  - `produces: "issue"` → registered as `integration-jira.issue`,
  - `consumes: ["issue"]` → resolved against the owning plugin's namespace
    at run time; `consumedArtifacts` is keyed by the local id, so an
    action's `execute` reads `consumedArtifacts["issue"]`.

  All five artifact-producing integration plugins (jira / teams / webex /
  webhook / script) now declare local ids. With `produces` matching the
  registered artifact type, the editor types `context.artifacts[...]` with
  the real schema (e.g. `issueKey`, `projectKey`, `issueUrl`).

  **BREAKING (beta):** the fully-qualified artifact type ids change from
  the short form to the plugin-prefixed form, e.g. `jira.issue` →
  `integration-jira.issue`. This affects how artifacts are referenced in
  templates (`{{ artifact.integration-jira.issue.issueKey }}`), the TS
  script `context.artifacts["integration-jira.issue"]`, and shell env names
  (`$CHECKSTACK_ARTIFACT_INTEGRATION_JIRA_ISSUE_ISSUEKEY`). Artifacts are
  per-run and ephemeral, so no stored-data migration is needed.

  Note: this keeps the same-plugin produce→consume handoff (the current
  pattern). Cross-plugin artifact consumption would need a follow-up to
  allow a fully-qualified `consumes` ref.

### Patch Changes

- 41c77f4: fix(integration): resolve `connectionStoreRef` lazily inside action `execute`

  The Phase 6/7/8 refactor wired every integration backend's
  `registerInit` deps to include `connectionStore: connectionStoreRef`,
  expecting `integration-backend` to register the service before the
  sort. But `integration-backend` calls `env.registerService(connection
StoreRef, ...)` from inside its own `init()`, not at `register()`
  time — so at topological-sort time the `providedBy` map doesn't know
  the service exists yet, and the sort can put a consumer (e.g.
  `integration-teams`) ahead of `integration-backend`. The dev server
  then fails at boot with:

  > Service 'integration.connectionStore' not found for plugin
  > 'integration-teams'

  This change drops the init-time dep from every integration plugin and
  resolves the connection store **lazily at action-execute time** via
  `context.getService(connectionStoreRef)`. By the time any action's
  `execute` runs, every plugin has finished init + afterPluginsReady,
  so the service is always available. Tests updated to thread a mock
  store through a typed `getService` stub in the action context.

  No behaviour change at runtime — the actions hit the connection store
  at the same moment they always did (just inside `execute` rather than
  through a captured init-time closure).

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [e1a2077]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [6d52276]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/automation-backend@0.2.0
  - @checkstack/integration-backend@0.2.0
  - @checkstack/integration-common@0.6.0
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/integration-jira-common@0.1.17

## 0.1.15

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/integration-backend@0.1.30

## 0.1.14

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/integration-backend@0.1.29
  - @checkstack/integration-common@0.5.0
  - @checkstack/integration-jira-common@0.1.16

## 0.1.13

### Patch Changes

- a06b899: Template autocomplete on Jira template fields, plus a sweep of dead code across integration / notification plugins.

  **FIXES**

  - Jira subscription dialog now offers `{{ payload.* }}` autocomplete on its three template fields (`summaryTemplate`, `descriptionTemplate`, field-mapping `template`). Each was declared as `configString({})` with empty metadata, so `DynamicForm` fell through to a plain `<Input>` and the `templateProperties` chain that `CreateSubscriptionDialog` already pipes in from the event's payload schema bypassed them entirely. Tagged all three with `"x-editor-types": ["raw"]` so they now route through `MultiTypeEditorField` → `RawEditor` (the textarea with the `{{ … }}` popup) — the same path webhook templates already used.

  **INTERNAL CLEANUP — dead code removed**

  Every removal here was verified with a repo-wide `grep` for external consumers; nothing in this changeset alters a public surface that anyone actually imports.

  - `@checkstack/integration-jira-common`:
    - Deleted `src/rpc-contract.ts` entirely. The Jira-specific `jiraContract` / `JiraApi` (connection-CRUD endpoints — `listConnections`, `getConnection`, `createConnection`, `updateConnection`, `deleteConnection`, `testConnection`) was never registered with the backend router and had zero client consumers. All connection management goes through the generic `integrationContract` in `@checkstack/integration-common`.
    - Removed seven dead Zod schemas + their inferred types from `src/schemas.ts`: `CreateJiraConnectionInputSchema`, `UpdateJiraConnectionInputSchema`, `JiraConnectionRedactedSchema`, `JiraFieldMappingSchema`, `JiraSubscriptionConfigSchema`, `JiraConnectionSchema`, plus their `…Input` / `…Redacted` / `…FieldMapping` / `…Config` / `…Connection` type aliases. The subscription config was duplicated against the canonical, metadata-tagged version in `jira-backend/src/provider.ts`; the connection schemas were marked `@deprecated` and only referenced by the now-removed RPC contract or the deprecated function below.
    - Removed orphaned npm deps `@orpc/contract` and `@checkstack/integration-common` from the package's `dependencies` (they were only used by the deleted RPC contract).
  - `@checkstack/integration-jira-backend`:
    - Removed `createJiraClientFromConnection` from `src/jira-client.ts`. The function was marked `@deprecated` ("Use createJiraClientFromConfig with generic connection management") and had zero callers; removing it dropped the last consumer of `JiraConnection` / `JiraConnectionSchema`. The modern `createJiraClientFromConfig` (using `JiraConnectionConfig` with cloud/datacenter auth modes) is the canonical entry point.
  - `@checkstack/integration-teams-backend` + `@checkstack/integration-webex-backend`:
    - Removed the `// Re-export for testing` blocks from each plugin's `src/index.ts`. The Teams plugin re-exported `teamsProvider` / `TeamsConnectionSchema` / `TeamsSubscriptionSchema` / `buildAdaptiveCard`; the Webex plugin re-exported `webexProvider` / `WebexConnectionSchema` / `WebexSubscriptionSchema`. Both `provider.test.ts` files were retargeted from `./index` to `./provider`, eliminating the indirection and matching the convention used by the other backend-only integration plugins.
  - `@checkstack/notification-telegram-backend`:
    - Removed the broken `bundle` field from `package.json` that referenced `@checkstack/notification-telegram-common` and `@checkstack/notification-telegram-frontend` — neither package existed (the directories were empty leftovers with no `package.json`, so not even workspace members). The empty directories were deleted; `bun install` is clean afterwards. `bunx @checkstack/scripts plugin-pack` for this plugin would otherwise have tried to bundle non-existent packages.

  No tests changed behaviour. 2040 tests pass, lint + typecheck clean.

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/integration-jira-common@0.1.15
  - @checkstack/integration-backend@0.1.28

## 0.1.12

### Patch Changes

- b33fb4d: Refresh `bun.lock` to clear MEDIUM-severity Trivy advisories on transitive
  runtime dependencies. No public API change — bumping every workspace
  package that lists `@orpc/server` as a direct dep so consumers re-resolve
  the optional `ws` peer to the patched release on their next install.

  - `ws` `8.20.0` → `8.20.1` (CVE-2026-45736). Pulled into the install tree
    as `@orpc/server`'s optional WebSocket peer; Bun auto-installs it into
    every backend package that depends on `@orpc/server`, so a stale 8.20.0
    ships in the consumer's `node_modules` until the parent package
    re-resolves.
  - `brace-expansion` `5.0.5` → `5.0.6` (CVE-2026-45149). Pulled in only
    through dev tooling (`minimatch@10` via `@typescript-eslint` and
    `storybook`'s `glob@13`), so it does not ship to consumers and no
    workspace `package.json` lists it; the lockfile bump alone clears the
    finding for the Docker image and the local dev tree. No version bump
    is attributed to this advisory.

  The fix lives entirely in `bun.lock` — no `package.json`, `overrides`, or
  `resolutions` change is needed because both parent ranges (`minimatch@10
→ brace-expansion@^5.0.5`, `@orpc/server / storybook / happy-dom →
ws@>=8.18.x`) already accept the patched releases, and `bun install`
  keeps the resolved versions sticky after the initial `bun update`.

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/integration-backend@0.1.27

## 0.1.11

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/integration-common@0.4.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/integration-backend@0.1.26
  - @checkstack/integration-jira-common@0.1.14

## 0.1.10

### Patch Changes

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/integration-backend@0.1.25
  - @checkstack/integration-common@0.3.2
  - @checkstack/integration-jira-common@0.1.13

## 0.1.9

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/integration-common@0.3.1
  - @checkstack/integration-jira-common@0.1.12
  - @checkstack/integration-backend@0.1.24

## 0.1.8

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/integration-backend@0.1.23
  - @checkstack/common@0.7.0
  - @checkstack/integration-common@0.3.0
  - @checkstack/integration-jira-common@0.1.11

## 0.1.7

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/integration-backend@0.1.22
  - @checkstack/backend-api@0.14.0

## 0.1.6

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/integration-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/integration-backend@0.1.21
  - @checkstack/integration-jira-common@0.1.11

## 0.1.5

### Patch Changes

- 8d1ef12: ## Downstream consumer bumps for the anomaly detection + cache system rollout

  Packages on this branch were updated as part of the anomaly detection feature (schema annotations on result fields, plugin metadata for the modular cache system) but were not listed in the upstream changesets.

  - **`@checkstack/healthcheck-common`** (minor) — new RPC contract additions and schema changes supporting per-field anomaly metadata.
  - **`@checkstack/cache-memory-common`** (minor) — new package providing access rules + plugin metadata for the in-memory cache backend.
  - **healthcheck plugins** (patch) — adopt the new `x-anomaly-*` schema annotations on their result fields so anomaly detection works automatically against their checks. No public API changes.
  - **integration / notification / auth / queue / collector plugins** (patch) — minor internal updates as consumers of upstream API changes (cache plugin registry, schema additions). No public API changes.

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/integration-jira-common@0.1.10
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/integration-backend@0.1.20
  - @checkstack/integration-common@0.2.9

## 0.1.4

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/integration-backend@0.1.19

## 0.1.3

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
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/integration-backend@0.1.18
  - @checkstack/integration-common@0.2.8
  - @checkstack/integration-jira-common@0.1.9

## 0.1.2

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/integration-backend@0.1.17

## 0.1.1

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/integration-backend@0.1.16

## 0.1.0

### Minor Changes

- 23c80bc: ### Jira Data Center Support

  Added support for on-premise Jira Data Center installations alongside existing Jira Cloud support:

  - **Authentication mode switching**: New `authMode` field (`cloud` | `datacenter`) on connection configuration. Cloud uses Basic Auth (email + API token), Data Center uses Bearer Auth (Personal Access Token).
  - **API version routing**: Automatically selects REST API v3 for Cloud and v2 for Data Center.
  - **Description format**: Cloud uses Atlassian Document Format (ADF), Data Center uses plain text.
  - **Connection schema v2**: Backward-compatible — defaults to `cloud` mode for existing connections.

  ### DynamicForm `x-hidden-when` Conditional Visibility

  New generic platform feature for conditionally hiding form fields based on sibling field values:

  - Added `x-hidden-when` metadata extension to `ConfigMeta` and `JsonSchemaProperty`.
  - DynamicForm automatically hides fields and skips their validation when conditions match.
  - Used by Jira integration to hide the email field when `authMode` is `datacenter`.

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/integration-backend@0.1.15

## 0.0.19

### Patch Changes

- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/integration-backend@0.1.14

## 0.0.18

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
- Updated dependencies [b839ccb]
  - @checkstack/backend-api@0.8.2
  - @checkstack/common@0.6.4
  - @checkstack/integration-backend@0.1.13
  - @checkstack/integration-common@0.2.7
  - @checkstack/integration-jira-common@0.1.8

## 0.0.17

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/integration-backend@0.1.12
  - @checkstack/integration-common@0.2.6
  - @checkstack/integration-jira-common@0.1.7

## 0.0.16

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/integration-backend@0.1.11

## 0.0.15

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/integration-backend@0.1.10

## 0.0.14

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/integration-backend@0.1.9
  - @checkstack/integration-common@0.2.5
  - @checkstack/integration-jira-common@0.1.6

## 0.0.13

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/integration-backend@0.1.8
  - @checkstack/integration-common@0.2.4
  - @checkstack/integration-jira-common@0.1.5

## 0.0.12

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/integration-backend@0.1.7
  - @checkstack/integration-common@0.2.3
  - @checkstack/integration-jira-common@0.1.4

## 0.0.11

### Patch Changes

- Updated dependencies [66a3963]
- Updated dependencies [66a3963]
  - @checkstack/integration-backend@0.1.6
  - @checkstack/backend-api@0.5.0

## 0.0.10

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/common@0.5.0
  - @checkstack/integration-backend@0.1.5
  - @checkstack/integration-common@0.2.2
  - @checkstack/integration-jira-common@0.1.3

## 0.0.9

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/integration-backend@0.1.4
  - @checkstack/integration-common@0.2.1
  - @checkstack/integration-jira-common@0.1.2

## 0.0.8

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/integration-backend@0.1.3

## 0.0.7

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/integration-common@0.2.0
  - @checkstack/integration-backend@0.1.2
  - @checkstack/integration-jira-common@0.1.1

## 0.0.6

### Patch Changes

- @checkstack/backend-api@0.3.1
- @checkstack/integration-backend@0.1.1

## 0.0.5

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/common@0.2.0
  - @checkstack/integration-backend@0.1.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/integration-jira-common@0.1.0

## 0.0.4

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/integration-backend@0.0.4
  - @checkstack/integration-common@0.0.4
  - @checkstack/integration-jira-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/integration-backend@0.0.3
  - @checkstack/integration-common@0.0.3
  - @checkstack/integration-jira-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/integration-backend@0.0.2
  - @checkstack/integration-common@0.0.2
  - @checkstack/integration-jira-common@0.0.2

## 0.0.3

### Patch Changes

- 4c5aa9e: Fix `IntegrationProvider.testConnection` generic type

  - **Breaking**: `testConnection` now receives `TConnection` (connection config) instead of `TConfig` (subscription config)
  - **Breaking**: `RegisteredIntegrationProvider` now includes `TConnection` generic parameter
  - Removed `testConnection` from webhook provider (providers without `connectionSchema` cannot have `testConnection`)
  - Fixed Jira provider to use `JiraConnectionConfig` directly in `testConnection`

  This aligns the interface with the actual behavior: `testConnection` tests connection credentials, not subscription configuration.

- Updated dependencies [4c5aa9e]
- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/integration-backend@0.1.0
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/integration-common@0.1.1
  - @checkstack/integration-jira-common@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/integration-common@0.1.0
  - @checkstack/integration-backend@0.0.2
  - @checkstack/integration-jira-common@0.0.2
