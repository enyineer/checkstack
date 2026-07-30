# @checkstack/integration-jira-common

## 0.2.11

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
  - @checkstack/common@0.24.0

## 0.2.10

### Patch Changes

- Updated dependencies [6c8b36b]
  - @checkstack/common@0.23.0

## 0.2.9

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0

## 0.2.8

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0

## 0.2.7

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0

## 0.2.6

### Patch Changes

- Updated dependencies [e430fbe]
- Updated dependencies [0d912a3]
  - @checkstack/common@0.19.0

## 0.2.5

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0

## 0.2.4

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

  - @checkstack/common@0.17.0

## 0.2.3

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/common@0.17.0

## 0.2.2

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/common@0.16.0

## 0.2.1

### Patch Changes

- 079369a: Surface each Jira field's value TYPE in the `create_issue` additional-fields
  option list (`fieldOptions`), via the option's `description` — e.g. `labels` is
  shown as "array of string", a story-points field as "number", and a select as
  "option; one of: …". Previously the resolver returned only the field key + name,
  so the model (and the editor) knew the field but had to guess the value shape and
  would, for example, send a bare string for an array-typed field like `labels`.
  The field's `schema.items` (array element type) is now also captured.

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

## 0.1.21

### Patch Changes

- Updated dependencies [56e7c75]
  - @checkstack/common@0.15.0

## 0.1.20

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1

## 0.1.19

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0

## 0.1.18

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/common@0.13.0

## 0.1.17

### Patch Changes

- Updated dependencies [6d52276]
  - @checkstack/common@0.12.0

## 0.1.16

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0

## 0.1.15

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

## 0.1.14

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/integration-common@0.4.0

## 0.1.13

### Patch Changes

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0
  - @checkstack/integration-common@0.3.2

## 0.1.12

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
  - @checkstack/common@0.8.0
  - @checkstack/integration-common@0.3.1

## 0.1.11

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/integration-common@0.3.0

## 0.1.10

### Patch Changes

- 8d1ef12: ## Downstream consumer bumps for the anomaly detection + cache system rollout

  Packages on this branch were updated as part of the anomaly detection feature (schema annotations on result fields, plugin metadata for the modular cache system) but were not listed in the upstream changesets.

  - **`@checkstack/healthcheck-common`** (minor) — new RPC contract additions and schema changes supporting per-field anomaly metadata.
  - **`@checkstack/cache-memory-common`** (minor) — new package providing access rules + plugin metadata for the in-memory cache backend.
  - **healthcheck plugins** (patch) — adopt the new `x-anomaly-*` schema annotations on their result fields so anomaly detection works automatically against their checks. No public API changes.
  - **integration / notification / auth / queue / collector plugins** (patch) — minor internal updates as consumers of upstream API changes (cache plugin registry, schema additions). No public API changes.

- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/integration-common@0.2.9

## 0.1.9

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/integration-common@0.2.8

## 0.1.8

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- Updated dependencies [67158e2]
  - @checkstack/common@0.6.4
  - @checkstack/integration-common@0.2.7

## 0.1.7

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/common@0.6.3
  - @checkstack/integration-common@0.2.6

## 0.1.6

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/common@0.6.2
  - @checkstack/integration-common@0.2.5

## 0.1.5

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/common@0.6.1
  - @checkstack/integration-common@0.2.4

## 0.1.4

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/integration-common@0.2.3

## 0.1.3

### Patch Changes

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0
  - @checkstack/integration-common@0.2.2

## 0.1.2

### Patch Changes

- Updated dependencies [83557c7]
  - @checkstack/common@0.4.0
  - @checkstack/integration-common@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/integration-common@0.2.0

## 0.1.0

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

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [f533141]
  - @checkstack/common@0.2.0
  - @checkstack/integration-common@0.1.0

## 0.0.4

### Patch Changes

- Updated dependencies [8e43507]
  - @checkstack/common@0.1.0

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/common@0.0.2

## 0.0.3

### Patch Changes

- Updated dependencies [a65e002]
  - @checkstack/common@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
  - @checkstack/common@0.1.0
