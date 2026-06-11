# @checkstack/integration-teams-backend

## 0.2.3

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/automation-backend@0.9.0
  - @checkstack/integration-backend@0.6.2

## 0.2.2

### Patch Changes

- @checkstack/automation-backend@0.8.1

## 0.2.1

### Patch Changes

- Updated dependencies [6005271]
- Updated dependencies [748268c]
- Updated dependencies [4134ed9]
- Updated dependencies [4134ed9]
- Updated dependencies [079369a]
- Updated dependencies [079369a]
  - @checkstack/automation-backend@0.8.0
  - @checkstack/backend-api@0.22.0
  - @checkstack/integration-backend@0.6.1

## 0.2.0

### Minor Changes

- ebef442: feat(automation): gate integration actions on the runAs service account's permissions

  **BREAKING.** Integration automation actions resolve credentials through a
  trusted service rather than the bounded `runAs` client, so they previously
  bypassed the runAs least-privilege model entirely: anyone able to author an
  automation could create Jira tickets, send Teams/Webex messages, etc. on any
  configured connection, with a zero-permission service account. This closes that
  gap.

  - **Actions declare `requiredAccessRules`** and the dispatch engine enforces
    them against the resolved `runAs` principal BEFORE the action runs (failing
    the step if missing) - the authorization point integration actions lacked.
  - **Each integration plugin defines per-action access rules**, e.g.
    `integration-jira.create_issue.manage` / `search_issues.read` /
    `transition_issue.manage` / `add_comment.manage`,
    `integration-teams.post_message.manage`,
    `integration-webex.post_message.manage`.
  - **`automation.propose` checks the same up front**, surfacing a per-action
    missing-permission error on the review card; `listActions` now exposes each
    action's `requiredAccessRules`, and `getBindableApplications` now returns each
    app's effective `accessRules`.
  - **New `integration.read` rule** gates `listConnectionSummaries` /
    `resolveConnectionOptions` (previously open to any authenticated user), so
    discovering connections and resolving their field options requires a grant.
  - **The AI assistant picks a capable runAs up front.**
    `automation.listServiceAccounts` now returns each account's `accessRules` and
    `automation.getCapabilitySchema` returns each action's `requiredAccessRules`,
    so the model selects a service account whose permissions cover the actions it
    uses instead of proposing and being rejected. When the operator did not name a
    runAs and more than one account qualifies, it ASKS which to use rather than
    choosing the automation's identity itself; when none has the needed rules it
    says which rule(s) to grant.

  **Migration:** existing automations whose service account does not hold the new
  rules will fail at the gated action until an admin grants the matching rule(s)
  to the service account's role (e.g. add `integration-jira.create_issue.manage`).
  Admin (`*`) service accounts are unaffected. Grant `integration.read` to roles
  that author integration-using automations so the editor's connection pickers and
  dropdowns keep working for non-admins.

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/integration-backend@0.6.0
  - @checkstack/automation-backend@0.7.0
  - @checkstack/backend-api@0.21.7

## 0.1.12

### Patch Changes

- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
  - @checkstack/automation-backend@0.6.0
  - @checkstack/integration-backend@0.5.0

## 0.1.11

### Patch Changes

- @checkstack/automation-backend@0.5.8
- @checkstack/backend-api@0.21.6
- @checkstack/integration-backend@0.4.6

## 0.1.10

### Patch Changes

- @checkstack/automation-backend@0.5.7

## 0.1.9

### Patch Changes

- @checkstack/automation-backend@0.5.6

## 0.1.8

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/common@0.15.0
  - @checkstack/automation-backend@0.5.5
  - @checkstack/integration-backend@0.4.5

## 0.1.7

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/automation-backend@0.5.4
  - @checkstack/integration-backend@0.4.4

## 0.1.6

### Patch Changes

- @checkstack/automation-backend@0.5.3
- @checkstack/backend-api@0.21.3
- @checkstack/common@0.14.1
- @checkstack/integration-backend@0.4.3

## 0.1.5

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/automation-backend@0.5.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/integration-backend@0.4.2

## 0.1.4

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/automation-backend@0.5.1
  - @checkstack/integration-backend@0.4.1

## 0.1.3

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

## 0.1.2

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/automation-backend@0.4.0
  - @checkstack/integration-backend@0.3.1

## 0.1.1

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

## 0.1.0

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
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0

## 0.0.35

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/integration-backend@0.1.30

## 0.0.34

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/integration-backend@0.1.29

## 0.0.33

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
  - @checkstack/backend-api@0.16.0
  - @checkstack/integration-backend@0.1.28

## 0.0.32

### Patch Changes

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/integration-backend@0.1.27

## 0.0.31

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/backend-api@0.15.2
  - @checkstack/integration-backend@0.1.26

## 0.0.30

### Patch Changes

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0
  - @checkstack/backend-api@0.15.1
  - @checkstack/integration-backend@0.1.25

## 0.0.29

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
  - @checkstack/backend-api@0.15.0
  - @checkstack/common@0.8.0
  - @checkstack/integration-backend@0.1.24

## 0.0.28

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/integration-backend@0.1.23
  - @checkstack/common@0.7.0

## 0.0.27

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/integration-backend@0.1.22
  - @checkstack/backend-api@0.14.0

## 0.0.26

### Patch Changes

- @checkstack/backend-api@0.13.1
- @checkstack/integration-backend@0.1.21

## 0.0.25

### Patch Changes

- 8d1ef12: ## Downstream consumer bumps for the anomaly detection + cache system rollout

  Packages on this branch were updated as part of the anomaly detection feature (schema annotations on result fields, plugin metadata for the modular cache system) but were not listed in the upstream changesets.

  - **`@checkstack/healthcheck-common`** (minor) — new RPC contract additions and schema changes supporting per-field anomaly metadata.
  - **`@checkstack/cache-memory-common`** (minor) — new package providing access rules + plugin metadata for the in-memory cache backend.
  - **healthcheck plugins** (patch) — adopt the new `x-anomaly-*` schema annotations on their result fields so anomaly detection works automatically against their checks. No public API changes.
  - **integration / notification / auth / queue / collector plugins** (patch) — minor internal updates as consumers of upstream API changes (cache plugin registry, schema additions). No public API changes.

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/integration-backend@0.1.20

## 0.0.24

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/integration-backend@0.1.19

## 0.0.23

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

## 0.0.22

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/integration-backend@0.1.17

## 0.0.21

### Patch Changes

- @checkstack/backend-api@0.10.1
- @checkstack/integration-backend@0.1.16

## 0.0.20

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

## 0.0.17

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/integration-backend@0.1.12

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

## 0.0.13

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/common@0.6.1
  - @checkstack/integration-backend@0.1.8

## 0.0.12

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/integration-backend@0.1.7

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

## 0.0.9

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/integration-backend@0.1.4

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
  - @checkstack/integration-backend@0.1.2

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

## 0.0.4

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/integration-backend@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/integration-backend@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/integration-backend@0.0.2

## 0.1.0

### Minor Changes

- 4c5aa9e: Add Microsoft Teams integration provider - sends events to Teams channels via Graph API

  - Connection schema for Azure AD App credentials (Tenant ID, Client ID, Client Secret)
  - Dynamic team/channel selection via Graph API
  - Adaptive Cards for rich event display
  - Client credentials flow for app-only authentication
  - Comprehensive documentation for Azure AD setup and permissions

### Patch Changes

- Updated dependencies [4c5aa9e]
- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/integration-backend@0.1.0
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
